import json
import re

import pytest

from readmate.engines.base import EngineError, EngineReply
from readmate.engines.fake_word_info import FakeWordInfoEngine
from readmate.wordinfo.languages import CODES
from readmate.wordinfo.prompt import MODEL_OUTPUT_SCHEMA, SYSTEM_PROMPT, build_user_message
from readmate.wordinfo.request import WordInfoRequest
from readmate.wordinfo.validate import validate_model_output

SIX = ("Er", "stellte", "sich", "den", "Gästen", "vor.")


def run(words, index, engine=None, target="en"):
    req = WordInfoRequest(words[index], index, "sentence", tuple(words), target)
    engine = engine or FakeWordInfoEngine()
    reply = engine.explain(SYSTEM_PROMPT, build_user_message(req), MODEL_OUTPUT_SCHEMA, 5.0)
    return req, reply, validate_model_output(reply.text, reply.stop_reason, req)


def test_separable_verb():
    _, _, out = run(SIX, 1)
    assert out["separableVerb"] == {"infinitive": "vorstellen", "wordIndexes": [1, 5]}
    assert out["expression"] is None
    assert out["pos"] == "verb"


def test_verb_pattern_expression():
    words = ["Er", "stellte", "das", "Auto", "zur", "Verfügung."]
    _, _, out = run(words, 1)
    assert out["expression"]["text"] == "zur Verfügung stellen"
    assert out["expression"]["wordIndexes"] == [1, 4, 5]
    assert out["expression"]["type"] == "verb-pattern"
    assert out["separableVerb"] is None


def test_collocation_expression():
    _, _, out = run(["Ich", "habe", "Angst."], 2)
    assert out["expression"]["text"] == "Angst haben"
    assert out["expression"]["wordIndexes"] == [1, 2]
    assert out["expression"]["type"] == "collocation"
    assert out["pos"] == "noun"


def test_other_word_is_generic():
    _, _, out = run(["Das", "Haus,", "ist", "alt."], 1)
    assert out["lemma"] == "Haus"
    assert out["separableVerb"] is None
    assert out["expression"] is None


def test_missing_partner_gives_null_groups():
    _, _, out = run(["Sie", "stellte", "Fragen."], 1)
    assert out["separableVerb"] is None and out["expression"] is None
    _, _, out = run(["Große", "Angst."], 1)
    assert out["expression"] is None


def test_word_with_angle_brackets_is_handled():
    _, _, out = run(["<b>stellte", "x"], 0)
    assert out["lemma"]


def test_reply_metadata():
    _, reply, _ = run(SIX, 1)
    assert reply.stop_reason == "end_turn"
    assert reply.output_tokens == len(reply.text) // 4
    json.loads(reply.text)


def test_records_calls():
    engine = FakeWordInfoEngine()
    run(SIX, 1, engine)
    assert len(engine.calls) == 1
    assert engine.calls[0]["system"] == SYSTEM_PROMPT
    assert engine.calls[0]["schema"] is MODEL_OUTPUT_SCHEMA
    assert engine.calls[0]["timeout_s"] == 5.0
    assert "<tapped_index>1</tapped_index>" in engine.calls[0]["user"]


def test_script_replies_and_errors_in_order():
    first = EngineReply("{}", "end_turn", 1, 2)
    engine = FakeWordInfoEngine([first, EngineError("busy", "429")])
    assert engine.explain("s", "u", {}, 1.0) is first
    with pytest.raises(EngineError) as info:
        engine.explain("s", "u", {}, 1.0)
    assert info.value.kind == "busy" and info.value.detail == "429"
    assert len(engine.calls) == 2


def test_from_env_and_identity():
    engine = FakeWordInfoEngine.from_env({}, "fake")
    assert isinstance(engine, FakeWordInfoEngine)
    assert engine.name == "fake" and engine.model == "fake"


def test_en_output_has_example_translation():
    _, _, out = run(SIX, 1)
    assert out["exampleTranslation"] == "This is an example."
    assert out["translation"] == "to introduce" and out["exampleEn"] == "This is an example."


@pytest.mark.parametrize("target", ["fa", "ar"])
def test_rtl_targets_return_non_latin_text(target):
    _, _, out = run(["Ich", "habe", "Angst."], 2, target=target)
    for field in ("translation", "senseInContext", "exampleTranslation"):
        assert not re.search("[A-Za-z]", out[field]), field
        assert out[field]
    assert not re.search("[A-Za-z]", out["expression"]["meaning"])
    assert out["exampleEn"] == "This is an example."


def test_other_targets_are_prefixed():
    _, _, out = run(["Ich", "habe", "Angst."], 2, target="tr")
    assert out["translation"] == "[tr] fear"
    assert out["expression"]["meaning"] == "[tr] to be afraid"
    assert out["exampleTranslation"] == "[tr] This is an example."


def test_every_target_output_validates():
    for code in CODES:
        for words, index in ((SIX, 1), (["Ich", "habe", "Angst."], 2), (["Das", "Haus"], 1)):
            run(words, index, target=code)
