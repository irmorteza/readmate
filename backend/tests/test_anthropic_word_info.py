from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from readmate.engines import anthropic_word_info
from readmate.engines.anthropic_word_info import AnthropicWordInfoEngine
from readmate.engines.base import EngineError, EngineReply
from readmate.wordinfo.secrets import SecretUnavailable

_REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def thinking_block():
    return SimpleNamespace(type="thinking", thinking="hmm")


def text_block(text):
    return SimpleNamespace(type="text", text=text)


def msg(content, stop_reason, input_tokens, output_tokens):
    return SimpleNamespace(
        content=content,
        stop_reason=stop_reason,
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
    )


class FakeClient:
    def __init__(self, reply=None, error=None):
        self.calls = []
        self._reply = reply
        self._error = error
        self.messages = SimpleNamespace(create=self._create)

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self._error is not None:
            raise self._error
        return self._reply


def status_error(status):
    response = httpx2.Response(status, request=_REQUEST, text="SECRET BODY")
    cls = {429: anthropic.RateLimitError, 500: anthropic.InternalServerError}.get(
        status, anthropic.APIStatusError
    )
    return cls("SECRET MESSAGE", response=response, body={"error": "SECRET BODY"})


def test_request_parameters():
    client = FakeClient(reply=msg([thinking_block(), text_block('{"a":1}')], "end_turn", 900, 300))
    eng = AnthropicWordInfoEngine("k", "claude-haiku-5-5", "low", client=client)
    r = eng.explain("SYS", "USER", {"type": "object"}, 8.0)
    kw = client.calls[0]
    assert kw["model"] == "claude-haiku-5-5" and kw["max_tokens"] == 1500 and kw["system"] == "SYS"
    assert kw["messages"] == [{"role": "user", "content": "USER"}]
    assert kw["output_config"] == {
        "effort": "low",
        "format": {"type": "json_schema", "schema": {"type": "object"}},
    }
    assert isinstance(kw["timeout"], anthropic.Timeout)
    assert kw["timeout"].read == 8.0 and kw["timeout"].connect == 2.0
    assert not {"temperature", "top_p", "top_k", "thinking", "tools", "tool_choice"} & kw.keys()
    assert r == EngineReply('{"a":1}', "end_turn", 900, 300)


def test_no_text_block_gives_empty_text():
    client = FakeClient(reply=msg([thinking_block()], "max_tokens", 10, 20))
    eng = AnthropicWordInfoEngine("k", "m", client=client)
    assert eng.explain("s", "u", {}, 8.0) == EngineReply("", "max_tokens", 10, 20)


def test_engine_attributes():
    eng = AnthropicWordInfoEngine("k", "m", client=FakeClient())
    assert (eng.name, eng.model, eng.effort, eng.MAX_TOKENS) == ("anthropic", "m", "low", 1500)


@pytest.mark.parametrize(
    "exc,kind,detail",
    [
        (anthropic.APITimeoutError(request=_REQUEST), "transient", "APITimeoutError:"),
        (anthropic.APIConnectionError(request=_REQUEST), "transient", "APIConnectionError:"),
        (status_error(429), "busy", "RateLimitError:429"),
        (status_error(529), "busy", "APIStatusError:529"),
        (status_error(500), "transient", "InternalServerError:500"),
        (status_error(400), "fatal", "APIStatusError:400"),
        (status_error(401), "fatal", "APIStatusError:401"),
        (status_error(404), "fatal", "APIStatusError:404"),
    ],
)
def test_errors_are_mapped(exc, kind, detail):
    eng = AnthropicWordInfoEngine("k", "m", client=FakeClient(error=exc))
    with pytest.raises(EngineError) as info:
        eng.explain("s", "u", {}, 8.0)
    assert info.value.kind == kind
    assert info.value.detail == detail
    assert "SECRET" not in str(info.value) and "SECRET" not in info.value.detail


def test_default_client_is_configured_without_network(monkeypatch):
    seen = {}
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: seen.update(kw) or object())
    AnthropicWordInfoEngine("k", "m")
    assert seen["api_key"] == "k"
    assert seen["max_retries"] == 0
    assert seen["timeout"].read == 8.0 and seen["timeout"].connect == 2.0


def test_from_env_reads_key_param_and_effort(monkeypatch):
    names = []
    monkeypatch.setattr(anthropic_word_info, "get_api_key", lambda name: names.append(name) or "k")
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: object())
    eng = AnthropicWordInfoEngine.from_env(
        {"ANTHROPIC_API_KEY_PARAM": "/readmate/anthropic-api-key", "WORD_INFO_EFFORT": "medium"},
        "claude-haiku-5-5",
    )
    assert names == ["/readmate/anthropic-api-key"]
    assert (eng.model, eng.effort) == ("claude-haiku-5-5", "medium")


def test_from_env_defaults_effort_low(monkeypatch):
    monkeypatch.setattr(anthropic_word_info, "get_api_key", lambda name: "k")
    monkeypatch.setattr(anthropic, "Anthropic", lambda **kw: object())
    eng = AnthropicWordInfoEngine.from_env({"ANTHROPIC_API_KEY_PARAM": "/p"}, "m")
    assert eng.effort == "low"


def test_from_env_without_param_raises_secret_unavailable():
    with pytest.raises(SecretUnavailable):
        AnthropicWordInfoEngine.from_env({}, "m")


def _validation_error():
    response = httpx2.Response(200, request=_REQUEST, text="SECRET BODY")
    return anthropic.APIResponseValidationError(response, {"x": "SECRET BODY"}, message="SECRET")


def test_other_api_error_is_fatal_without_message():
    eng = AnthropicWordInfoEngine("k", "m", client=FakeClient(error=_validation_error()))
    with pytest.raises(EngineError) as info:
        eng.explain("s", "u", {}, 8.0)
    assert info.value.kind == "fatal"
    assert info.value.detail == "APIResponseValidationError:200"
    assert info.value.__suppress_context__ is True and info.value.__cause__ is None
    assert "SECRET" not in str(info.value) and "SECRET" not in info.value.detail


@pytest.mark.parametrize(
    "reply",
    [
        SimpleNamespace(content=None, stop_reason="end_turn", usage=None),
        SimpleNamespace(content=[SimpleNamespace(type="text")], stop_reason="x", usage=None),
        SimpleNamespace(content=[], stop_reason="end_turn"),
        SimpleNamespace(content=[], stop_reason="end_turn", usage=SimpleNamespace()),
        None,
    ],
)
def test_malformed_response_shape_is_fatal(reply):
    eng = AnthropicWordInfoEngine("k", "m", client=FakeClient(reply=reply))
    with pytest.raises(EngineError) as info:
        eng.explain("s", "u", {}, 8.0)
    assert (info.value.kind, info.value.detail) == ("fatal", "MalformedResponse:")


def test_unrelated_bug_in_client_is_not_swallowed():
    eng = AnthropicWordInfoEngine("k", "m", client=FakeClient(error=RuntimeError("bug")))
    with pytest.raises(RuntimeError):
        eng.explain("s", "u", {}, 8.0)
