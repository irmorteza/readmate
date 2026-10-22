import copy
import json
import logging

import pytest

from readmate.engines.base import EngineError, EngineReply
from readmate.engines.fake_word_info import FakeWordInfoEngine
from readmate.wordinfo.prompt import PROMPT_VERSION
from readmate.wordinfo.request import WordInfoRequest, cache_key
from readmate.wordinfo.secrets import SecretUnavailable
from readmate.wordinfo.service import (
    ENGINE_TIMEOUT_S,
    RETRY_MIN_REMAINING_MS,
    WordInfoError,
    WordInfoService,
    service_from_env,
)
from readmate.wordinfo.store import DynamoStore, LruCache, MemoryStore, StoreUnavailable

REQ = WordInfoRequest("Haus", 1, "sentence", ("Das", "Haus", "steht."), "en")
MODEL = "fake"
KEY = cache_key(REQ, PROMPT_VERSION, MODEL)
GOOD_TEXT = json.dumps(
    {
        "lemma": "Haus",
        "pos": "other",
        "phonetic": "",
        "article": "",
        "plural": "",
        "translation": "house",
        "senseInContext": "A building.",
        "exampleDe": "Das Haus ist groß.",
        "exampleEn": "The house is big.",
        "exampleTranslation": "The house is big.",
        "separableVerb": None,
        "expression": None,
    }
)


def good(tokens=10):
    return EngineReply(GOOD_TEXT, "end_turn", 5, tokens)


def bad(tokens=3):
    return EngineReply("not json", "end_turn", 5, tokens)


def ms(n=14_000):
    return lambda: n


class SpyStore(MemoryStore):
    def __init__(self, fail_get=False, fail_put=False, fail_inc=False):
        super().__init__()
        self.fail_get, self.fail_put, self.fail_inc = fail_get, fail_put, fail_inc
        self.incs = 0

    def get(self, key):
        if self.fail_get:
            raise StoreUnavailable
        return super().get(key)

    def put(self, key, response, model, prompt_version):
        if self.fail_put:
            raise StoreUnavailable
        super().put(key, response, model, prompt_version)

    def increment_daily(self, cap):
        if self.fail_inc:
            raise StoreUnavailable
        n = super().increment_daily(cap)
        self.incs = n
        return n


def make(script, store=None, cap=100, clock=None):
    engine = FakeWordInfoEngine(script=script)
    store = store if store is not None else SpyStore()
    kwargs = {"clock": clock} if clock else {}
    svc = WordInfoService(lambda: engine, store, MODEL, cap, LruCache(), **kwargs)
    return svc, engine, store


def fail(svc, remaining=None):
    with pytest.raises(WordInfoError) as exc:
        svc.lookup(REQ, remaining or ms())
    return exc.value


def test_constants():
    assert RETRY_MIN_REMAINING_MS == 9_500
    assert ENGINE_TIMEOUT_S == 8.0


def test_miss_calls_engine_once_and_stores_without_meta():
    svc, engine, store = make([good(tokens=42)])
    out = svc.lookup(REQ, ms())
    assert len(engine.calls) == 1
    assert engine.calls[0]["timeout_s"] == ENGINE_TIMEOUT_S
    meta = out["meta"]
    assert meta["cached"] is False
    assert meta["attempts"] == 1
    assert meta["stopReasons"] == ["end_turn"]
    assert meta["outputTokens"] == [42]
    assert meta["model"] == MODEL
    assert meta["promptVersion"] == PROMPT_VERSION
    stored = store.get(KEY)
    assert "meta" not in stored
    assert stored == {k: v for k, v in out.items() if k != "meta"}


def test_second_lookup_hits_lru_and_fresh_service_hits_store():
    svc, engine, store = make([good()])
    svc.lookup(REQ, ms())
    out = svc.lookup(REQ, ms())
    assert len(engine.calls) == 1
    assert out["meta"] == {
        "cached": True,
        "model": MODEL,
        "latencyMs": out["meta"]["latencyMs"],
        "promptVersion": PROMPT_VERSION,
        "attempts": 0,
        "stopReasons": [],
        "outputTokens": [],
    }
    assert "meta" not in store.get(KEY)

    def boom():
        raise AssertionError("factory must not run on a hit")

    fresh = WordInfoService(boom, store, MODEL, 100, LruCache())
    out2 = fresh.lookup(REQ, ms())
    assert out2["meta"]["cached"] is True
    assert out2["meta"]["attempts"] == 0


def test_invalid_then_valid_retries():
    svc, engine, store = make([bad(3), good(7)])
    out = svc.lookup(REQ, ms())
    assert len(engine.calls) == 2
    assert out["meta"]["attempts"] == 2
    assert out["meta"]["stopReasons"] == ["end_turn", "end_turn"]
    assert out["meta"]["outputTokens"] == [3, 7]
    assert store.incs == 2


def test_invalid_twice_is_502_and_not_stored():
    svc, engine, store = make([bad(3), bad(4)])
    err = fail(svc)
    assert (err.status, err.code) == (502, "LOOKUP_FAILED")
    assert err.extra == {"stopReasons": ["end_turn", "end_turn"], "outputTokens": [3, 4]}
    assert len(engine.calls) == 2
    assert store.get(KEY) is None


def test_max_tokens_then_valid():
    svc, _, _ = make([EngineReply("{", "max_tokens", 5, 100), good()])
    out = svc.lookup(REQ, ms())
    assert out["meta"]["stopReasons"] == ["max_tokens", "end_turn"]


def test_transient_without_time_is_not_retried():
    svc, engine, _ = make([EngineError("transient", "Timeout"), good()])
    err = fail(svc, ms(9_499))
    assert (err.status, err.code) == (502, "LOOKUP_FAILED")
    assert len(engine.calls) == 1
    assert not err.extra


def test_transient_with_time_is_retried():
    svc, engine, _ = make([EngineError("transient", "Timeout"), good()])
    out = svc.lookup(REQ, ms(9_500))
    assert len(engine.calls) == 2
    assert out["meta"]["attempts"] == 2
    assert out["meta"]["stopReasons"] == ["end_turn"]


def test_invalid_without_time_is_not_retried():
    svc, engine, _ = make([bad(), good()])
    err = fail(svc, ms(9_499))
    assert len(engine.calls) == 1
    assert err.extra == {"stopReasons": ["end_turn"], "outputTokens": [3]}


def test_busy_twice_is_429():
    svc, engine, _ = make([EngineError("busy", "429"), EngineError("busy", "529")])
    err = fail(svc)
    assert (err.status, err.code) == (429, "BUSY")
    assert len(engine.calls) == 2


def test_fatal_is_502_without_retry():
    svc, engine, store = make([EngineError("fatal", "401"), good()])
    err = fail(svc)
    assert (err.status, err.code) == (502, "LOOKUP_FAILED")
    assert len(engine.calls) == 1
    assert store.incs == 1


def test_unknown_engine_exception_propagates():
    svc, _, _ = make([RuntimeError("bug")])
    with pytest.raises(RuntimeError):
        svc.lookup(REQ, ms())


def test_cap_reached_never_calls_engine():
    store = SpyStore()
    store.increment_daily(1)
    svc, engine, _ = make([good()], store=store, cap=1)
    err = fail(svc)
    assert (err.status, err.code) == (429, "DAILY_LIMIT")
    assert engine.calls == []


def test_cap_reached_on_retry():
    svc, engine, _ = make([bad(), good()], cap=1)
    err = fail(svc)
    assert (err.status, err.code) == (429, "DAILY_LIMIT")
    assert len(engine.calls) == 1


def test_counter_unavailable_is_503():
    svc, engine, _ = make([good()], store=SpyStore(fail_inc=True))
    err = fail(svc)
    assert (err.status, err.code) == (503, "NOT_CONFIGURED")
    assert engine.calls == []


def test_secret_unavailable_is_503_and_counter_untouched(caplog):
    store = SpyStore()

    def factory():
        raise SecretUnavailable

    svc = WordInfoService(factory, store, MODEL, 100, LruCache())
    with caplog.at_level(logging.INFO, logger="readmate"):
        err = fail(svc)
    assert (err.status, err.code) == (503, "NOT_CONFIGURED")
    assert store.incs == 0
    rec = [r for r in caplog.records if "secret unavailable" in r.getMessage()]
    assert rec and not rec[0].exc_info


def test_import_error_is_503_logged_and_not_cached(caplog):
    store = SpyStore()
    engine = FakeWordInfoEngine(script=[good()])
    calls = []

    def factory():
        calls.append(1)
        if len(calls) == 1:
            raise ImportError("wrong arch")
        return engine

    svc = WordInfoService(factory, store, MODEL, 100, LruCache())
    with caplog.at_level(logging.INFO, logger="readmate"):
        err = fail(svc)
    assert (err.status, err.code) == (503, "NOT_CONFIGURED")
    assert store.incs == 0
    rec = [r for r in caplog.records if "word-info engine import failed" in r.getMessage()]
    assert rec and rec[0].exc_info
    out = svc.lookup(REQ, ms())
    assert out["meta"]["attempts"] == 1
    assert len(calls) == 2


def test_engine_is_built_once_after_success():
    engine = FakeWordInfoEngine(script=[good(), good()])
    built = []

    def factory():
        built.append(1)
        return engine

    other = WordInfoRequest("steht", 2, "sentence", REQ.words, "en")
    svc = WordInfoService(factory, MemoryStore(), MODEL, 100, LruCache())
    svc.lookup(REQ, ms())
    svc.lookup(other, ms())
    assert len(built) == 1


def test_store_get_failure_is_a_miss(caplog):
    svc, _, _ = make([good()], store=SpyStore(fail_get=True))
    with caplog.at_level(logging.WARNING, logger="readmate"):
        out = svc.lookup(REQ, ms())
    assert out["meta"]["cached"] is False
    assert any("store unavailable" in r.getMessage() for r in caplog.records)
    assert "Haus" not in caplog.text


def test_store_put_failure_still_answers():
    svc, _, _ = make([good()], store=SpyStore(fail_put=True))
    out = svc.lookup(REQ, ms())
    assert out["meta"]["attempts"] == 1
    assert svc.lookup(REQ, ms())["meta"]["cached"] is True


def test_latency_is_deterministic():
    ticks = iter([100.0, 100.25])
    svc, _, _ = make([good()], clock=lambda: next(ticks))
    assert svc.lookup(REQ, ms())["meta"]["latencyMs"] == 250


def test_one_log_line_without_content(caplog):
    svc, _, _ = make([good(tokens=9)])
    with caplog.at_level(logging.INFO, logger="readmate"):
        svc.lookup(REQ, ms())
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("word_info ")]
    assert len(lines) == 1
    assert lines[0].startswith("word_info cached=False attempts=1 stops=")
    assert "out_tokens=" in lines[0] and "ms=" in lines[0]
    assert "Haus" not in caplog.text and "house" not in caplog.text


def test_service_from_env_fake():
    svc = service_from_env({"WORD_INFO_ENGINE": "fake"})
    assert svc.model == "fake"
    req = WordInfoRequest("Angst", 2, "sentence", ("Ich", "habe", "Angst."), "en")
    out = svc.lookup(req, ms())
    assert out["meta"]["model"] == "fake"


def test_service_from_env_default_is_lazy():
    svc = service_from_env({})
    assert svc.model == "claude-haiku-5-5"


def test_service_from_env_unknown_engine():
    with pytest.raises(ValueError):
        service_from_env({"WORD_INFO_ENGINE": "nope"})


def test_service_from_env_reads_cap_model_and_store():
    svc = service_from_env(
        {"WORD_INFO_ENGINE": "fake", "WORD_INFO_MODEL": "m", "WORD_INFO_DAILY_CAP": "3"}
    )
    assert svc.model == "m"
    assert svc.daily_cap == 3
    assert isinstance(svc.store, MemoryStore)


def test_service_from_env_uses_dynamo_when_table_set(monkeypatch):
    import boto3

    monkeypatch.setenv("AWS_DEFAULT_REGION", "eu-central-1")
    monkeypatch.setattr(boto3, "client", lambda *a, **k: object())
    svc = service_from_env({"WORD_INFO_ENGINE": "fake", "WORD_INFO_TABLE": "t"})
    assert isinstance(svc.store, DynamoStore)


def test_nested_mutation_does_not_leak_into_cache():
    sep = json.loads(GOOD_TEXT)
    sep["separableVerb"] = {"infinitive": "anstehen", "wordIndexes": [1, 2]}
    reply = EngineReply(json.dumps(sep), "end_turn", 5, 10)
    svc, _, store = make([reply])
    first = svc.lookup(REQ, ms())
    first["separableVerb"]["wordIndexes"].append(9)
    second = svc.lookup(REQ, ms())
    assert second["separableVerb"]["wordIndexes"] == [1, 2]
    second["separableVerb"]["wordIndexes"].append(9)
    assert svc.lookup(REQ, ms())["separableVerb"]["wordIndexes"] == [1, 2]
    assert store.get(KEY)["separableVerb"]["wordIndexes"] == [1, 2]


def _dynamo_store_with_empty_cache():
    import boto3
    from botocore.stub import Stubber

    client = boto3.client(
        "dynamodb",
        region_name="eu-central-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    stubber = Stubber(client)
    stubber.add_response("get_item", {})
    stubber.activate()
    return DynamoStore("t", client=client), stubber


@pytest.mark.parametrize("kind", ["memory", "dynamo"])
def test_cap_zero_is_429_and_never_calls_engine(kind):
    stubber = None
    if kind == "dynamo":
        store, stubber = _dynamo_store_with_empty_cache()
    else:
        store = MemoryStore()
    svc, engine, _ = make([good()], store=store, cap=0)
    err = fail(svc)
    assert (err.status, err.code) == (429, "DAILY_LIMIT")
    assert engine.calls == []
    if stubber:
        stubber.assert_no_pending_responses()


def test_malformed_response_engine_error_is_502_not_500():
    svc, engine, _ = make([EngineError("fatal", "MalformedResponse:")])
    err = fail(svc)
    assert (err.status, err.code) == (502, "LOOKUP_FAILED")
    assert len(engine.calls) == 1


def test_cache_hit_returns_current_request_word_and_leaves_cache_untouched():
    punct = WordInfoRequest("vor.", 1, "sentence", ("Das", "vor.", "steht."), "en")
    plain = WordInfoRequest("vor", 1, "sentence", ("Das", "vor.", "steht."), "en")
    key = cache_key(punct, PROMPT_VERSION, MODEL)
    assert key == cache_key(plain, PROMPT_VERSION, MODEL)
    svc, engine, store = make([good()])
    first = svc.lookup(punct, ms())
    assert first["word"] == "vor."
    stored = copy.deepcopy(store.get(key))

    out = svc.lookup(plain, ms())  # LRU hit
    assert out["word"] == "vor"
    assert list(out)[:3] == list(first)[:3] and list(out)[1] == "word"
    assert store.get(key) == stored and stored["word"] == "vor."
    out["lemma"] = "mutated"
    assert svc.lookup(plain, ms())["lemma"] != "mutated"

    fresh = WordInfoService(lambda: engine, store, MODEL, 100, LruCache())
    out2 = fresh.lookup(plain, ms())  # store hit
    assert out2["word"] == "vor" and store.get(key) == stored
    assert len(engine.calls) == 1


@pytest.mark.parametrize("bad", ["", "x" * 201])
def test_invalid_example_translation_for_en_is_still_a_200_on_the_first_attempt(bad):
    body = json.loads(GOOD_TEXT)
    body["exampleTranslation"] = bad
    svc, engine, _ = make([EngineReply(json.dumps(body), "end_turn", 5, 10)])
    out = svc.lookup(REQ, ms())
    assert len(engine.calls) == 1
    assert out["exampleTranslation"] == out["exampleEn"] == "The house is big."
