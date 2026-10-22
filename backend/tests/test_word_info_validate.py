import copy
import json
import logging
from dataclasses import replace

import pytest

from readmate.wordinfo.request import WordInfoRequest
from readmate.wordinfo.validate import LIMITS, InvalidModelOutput, validate_model_output

REQ = WordInfoRequest(
    word="stellte",
    word_index=1,
    kind="sentence",
    words=("Sie", "stellte", "ihn", "ihrer", "Mutter", "vor"),
    target="en",
)


def good() -> dict:
    return {
        "lemma": "vorstellen",
        "pos": "verb",
        "phonetic": "/ˈʃtɛltə/",
        "article": "",
        "plural": "",
        "translation": "introduced",
        "senseInContext": "She introduced him to her mother.",
        "exampleDe": "Darf ich Ihnen meinen Kollegen vorstellen?",
        "exampleEn": "May I introduce my colleague to you?",
        "exampleTranslation": "May I introduce my colleague to you?",
        "separableVerb": {"infinitive": "vorstellen", "wordIndexes": [5, 1]},
        "expression": None,
    }


def run(obj: dict, stop: str = "end_turn") -> dict:
    return validate_model_output(json.dumps(obj), stop, REQ)


def test_valid_output_becomes_contract_body():
    out = run(good())
    assert list(out) == [
        "version", "word", "lemma", "pos", "phonetic", "translation", "senseInContext",
        "article", "plural", "exampleDe", "exampleEn", "exampleTranslation", "separableVerb",
        "expression",
    ]  # fmt: skip
    assert out["version"] == 1 and out["word"] == "stellte"
    assert out["separableVerb"] == {"infinitive": "vorstellen", "wordIndexes": [1, 5]}
    assert out["article"] is None and out["plural"] is None
    assert out["expression"] is None
    assert out["lemma"] == "vorstellen" and out["pos"] == "verb"


def test_strings_are_stripped():
    o = good()
    o["translation"] = "  introduced \n"
    o["phonetic"] = " /x/ "
    out = run(o)
    assert out["translation"] == "introduced" and out["phonetic"] == "/x/"


def test_noun_keeps_article_and_plural():
    o = good()
    o.update(pos="noun", article="die", plural="Mütter", separableVerb=None)
    out = run(o)
    assert out["article"] == "die" and out["plural"] == "Mütter"


def test_noun_with_empty_article_and_plural_gets_none():
    o = good()
    o.update(pos="noun", separableVerb=None)
    out = run(o)
    assert out["article"] is None and out["plural"] is None


def test_article_and_plural_cleared_for_non_nouns():
    o = good()
    o.update(article="der", plural="Dinge")
    out = run(o)
    assert out["article"] is None and out["plural"] is None


def test_expression_kept_and_sorted():
    o = good()
    o["separableVerb"] = None
    o["expression"] = {
        "text": "jemanden vorstellen",
        "meaning": "to introduce someone",
        "type": "verb-pattern",
        "wordIndexes": [5, 2, 1],
    }
    out = run(o)
    assert out["expression"] == {
        "text": "jemanden vorstellen",
        "meaning": "to introduce someone",
        "type": "verb-pattern",
        "wordIndexes": [1, 2, 5],
    }
    assert list(out["expression"]) == ["text", "meaning", "type", "wordIndexes"]


def test_group_without_tapped_index_is_dropped(caplog):
    o = good()
    o["separableVerb"]["wordIndexes"] = [2, 3]
    with caplog.at_level(logging.INFO, logger="readmate"):
        out = run(o)
    assert out["separableVerb"] is None
    recs = [r for r in caplog.records if "group_dropped" in r.getMessage()]
    assert recs and all(r.name == "readmate" for r in recs)
    assert "vorstellen" not in " ".join(r.getMessage() for r in recs)


def test_expression_without_tapped_index_is_dropped(caplog):
    o = good()
    o["expression"] = {"text": "a b", "meaning": "m", "type": "idiom", "wordIndexes": [2, 3]}
    with caplog.at_level(logging.INFO, logger="readmate"):
        out = run(o)
    assert out["expression"] is None
    assert any("group_dropped" in r.getMessage() for r in caplog.records)


@pytest.mark.parametrize("stop", ["max_tokens", "refusal", "tool_use", ""])
def test_bad_stop_reason_is_invalid(stop):
    with pytest.raises(InvalidModelOutput):
        run(good(), stop)


def _expr(**kw):
    e = {"text": "a b", "meaning": "m", "type": "idiom", "wordIndexes": [1, 2]}
    e.update(kw)
    return e


@pytest.mark.parametrize(
    "mutate",
    [
        lambda o: o.pop("lemma"),
        lambda o: o.update(extra=1),
        lambda o: o.update(pos="Verb"),
        lambda o: o.update(article="den"),
        lambda o: o.update(translation="   "),
        lambda o: o.update(translation="x" * 121),
        lambda o: o.update(senseInContext=5),
        lambda o: o.update(lemma="x" * 65),
        lambda o: o.update(phonetic="x" * 81),
        lambda o: o.update(plural="x" * 65),
        lambda o: o.update(exampleDe="x" * 201),
        lambda o: o.update(exampleEn=""),
        lambda o: o.update(exampleTranslation=""),
        lambda o: o.update(exampleTranslation="x" * 201),
        lambda o: o.update(exampleTranslation=5),
        lambda o: o.pop("exampleTranslation"),
        lambda o: o.update(phonetic=None),
        lambda o: o.update(separableVerb={"infinitive": "  ", "wordIndexes": [1, 5]}),
        lambda o: o.update(separableVerb="vorstellen"),
        lambda o: o.update(separableVerb={"infinitive": "v" * 65, "wordIndexes": [1, 5]}),
        lambda o: o["separableVerb"].update(wordIndexes=[1, 6]),
        lambda o: o["separableVerb"].update(wordIndexes=[1, -1]),
        lambda o: o["separableVerb"].update(wordIndexes=[1, 1]),
        lambda o: o["separableVerb"].update(wordIndexes=[1]),
        lambda o: o["separableVerb"].update(wordIndexes=list(range(13))),
        lambda o: o["separableVerb"].update(wordIndexes=[True, 5]),
        lambda o: o["separableVerb"].update(wordIndexes=[1.0, 5]),
        lambda o: o["separableVerb"].update(wordIndexes="15"),
        lambda o: o["separableVerb"].update(extra="x"),
        lambda o: o["separableVerb"].pop("infinitive"),
        lambda o: o.update(expression=_expr(type="proverb")),
        lambda o: o.update(expression=_expr(extra=1)),
        lambda o: o.update(expression=_expr(text="x" * 121)),
        lambda o: o.update(expression=_expr(meaning="x" * 201)),
        lambda o: o.update(expression=_expr(meaning=" ")),
        lambda o: o.update(expression=_expr(wordIndexes=[True, 2])),
        lambda o: o.update(expression=[]),
    ],
)  # fmt: skip
def test_invalid_outputs_raise(mutate):
    o = good()
    mutate(o)
    with pytest.raises(InvalidModelOutput):
        run(o)


@pytest.mark.parametrize(
    "text",
    ["", "not json", "[]", "null", "5", '"x"', pytest.param("[" * 100000, id="deep-nesting")],
)
def test_non_object_text_is_invalid(text):
    with pytest.raises(InvalidModelOutput):
        validate_model_output(text, "end_turn", REQ)


def test_non_string_text_is_invalid():
    with pytest.raises(InvalidModelOutput):
        validate_model_output(None, "end_turn", REQ)  # type: ignore[arg-type]


def test_reason_never_contains_model_text():
    o = good()
    o["translation"] = "SECRET-X" * 20
    with pytest.raises(InvalidModelOutput) as ei:
        run(o)
    assert "SECRET-X" not in ei.value.reason
    assert ei.value.reason and str(ei.value) == ei.value.reason


@pytest.mark.parametrize(
    "mutate",
    [
        lambda o: o.update(pos="SECRET-X"),
        lambda o: o.update(extraSECRET="SECRET-X"),
        lambda o: o.update(article="SECRET-X"),
        lambda o: o["separableVerb"].update(SECRETkey=1),
        lambda o: o.update(expression=_expr(type="SECRET-X")),
    ],
)
def test_reason_never_echoes_values_or_keys(mutate):
    o = good()
    mutate(o)
    with pytest.raises(InvalidModelOutput) as ei:
        run(o)
    assert "SECRET" not in ei.value.reason


def test_bad_stop_reason_not_echoed():
    with pytest.raises(InvalidModelOutput) as ei:
        run(good(), "SECRET-X")
    assert "SECRET-X" not in ei.value.reason


def test_input_not_mutated_and_limits_pinned():
    o = good()
    before = copy.deepcopy(o)
    run(o)
    assert o == before
    assert LIMITS == {
        "lemma": 64, "phonetic": 80, "translation": 120, "senseInContext": 300,
        "exampleDe": 200, "exampleEn": 200, "exampleTranslation": 200, "plural": 64,
        "infinitive": 64, "text": 120, "meaning": 200,
    }  # fmt: skip


@pytest.mark.parametrize(
    "mutate",
    [
        lambda o: o.__setitem__("lemma", "x\ud800"),
        lambda o: o.__setitem__("translation", "\udc00y"),
        lambda o: o["separableVerb"].__setitem__("infinitive", "vor\ud800"),
        lambda o: o.__setitem__(
            "expression",
            {"text": "a\ud800", "meaning": "m", "type": "idiom", "wordIndexes": [1, 2]},
        ),
        lambda o: o.__setitem__(
            "expression",
            {"text": "a", "meaning": "m\ud800", "type": "idiom", "wordIndexes": [1, 2]},
        ),
    ],
)
def test_lone_surrogate_is_rejected_without_model_text(mutate):
    o = good()
    mutate(o)
    with pytest.raises(InvalidModelOutput) as exc:
        validate_model_output(json.dumps(o), "end_turn", REQ)
    assert "\ud800" not in exc.value.reason and "\udc00" not in exc.value.reason
    assert "is not valid text" in exc.value.reason


def test_en_example_translation_is_exampleEn():
    o = good()
    o["exampleTranslation"] = "Darf ich Ihnen meinen Kollegen vorstellen?"
    out = run(o)
    assert out["exampleTranslation"] == out["exampleEn"]


def test_other_target_keeps_example_translation():
    o = good()
    o["exampleTranslation"] = "  آیا می‌توانم همکارم را معرفی کنم؟ "
    out = validate_model_output(json.dumps(o), "end_turn", replace(REQ, target="fa"))
    assert out["exampleTranslation"] == "آیا می‌توانم همکارم را معرفی کنم؟"


def test_expression_inside_separable_verb_is_dropped(caplog):
    o = good()
    o["expression"] = {
        "text": "stellen vor", "meaning": "SECRET-M", "type": "verb-pattern", "wordIndexes": [5, 1]
    }
    with caplog.at_level(logging.INFO, logger="readmate"):
        out = run(o)
    assert out["expression"] is None and out["separableVerb"] is not None
    messages = [r.getMessage() for r in caplog.records]
    assert any("group_dropped group=expression reason=separable" in m for m in messages)
    assert "SECRET-M" not in " ".join(messages)


def test_expression_with_an_extra_word_is_kept():
    o = good()
    o["separableVerb"]["wordIndexes"] = [1, 5]
    o["expression"] = {"text": "a b c", "meaning": "m", "type": "idiom", "wordIndexes": [1, 2, 5]}
    out = run(o)
    assert out["expression"]["wordIndexes"] == [1, 2, 5]


def test_lemma_becomes_infinitive_when_separable_present():
    o = good()
    o["lemma"] = "an"
    assert run(o)["lemma"] == "vorstellen"


def test_lemma_not_overridden_when_separable_group_dropped():
    o = good()
    o["lemma"] = "stellen"
    o["separableVerb"]["wordIndexes"] = [2, 3]
    out = run(o)
    assert out["separableVerb"] is None and out["lemma"] == "stellen"
