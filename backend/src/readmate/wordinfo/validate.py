"""Validation and normalization of the model's word-info output."""

import json
import logging

from readmate.wordinfo.prompt import ARTICLES, EXPRESSION_TYPES, POS
from readmate.wordinfo.request import WordInfoRequest

logger = logging.getLogger("readmate")

LIMITS = {
    "lemma": 64,
    "phonetic": 80,
    "translation": 120,
    "senseInContext": 300,
    "exampleDe": 200,
    "exampleEn": 200,
    "plural": 64,
    "infinitive": 64,
    "text": 120,
    "meaning": 200,
}

_TOP_KEYS = {
    "lemma", "pos", "phonetic", "article", "plural", "translation",
    "senseInContext", "exampleDe", "exampleEn", "separableVerb", "expression",
}  # fmt: skip
_SEPARABLE_KEYS = {"infinitive", "wordIndexes"}
_EXPRESSION_KEYS = {"text", "meaning", "type", "wordIndexes"}
_MIN_INDEXES = 2
_MAX_INDEXES = 12


class InvalidModelOutput(Exception):
    """Model output failed validation. `reason` is short and never holds model text."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


def _string(obj: dict, key: str, *, required: bool, limit_key: str | None = None) -> str:
    value = obj[key]
    if not isinstance(value, str):
        raise InvalidModelOutput(f"{key} is not a string")
    value = value.strip()
    if required and not value:
        raise InvalidModelOutput(f"{key} is empty")
    if len(value) > LIMITS[limit_key or key]:
        raise InvalidModelOutput(f"{key} is too long")
    return value


def _indexes(obj: dict, group: str, size: int) -> list[int]:
    raw = obj["wordIndexes"]
    if not isinstance(raw, list):
        raise InvalidModelOutput(f"{group} wordIndexes is not a list")
    if not _MIN_INDEXES <= len(raw) <= _MAX_INDEXES:
        raise InvalidModelOutput(f"{group} wordIndexes has a bad length")
    for i in raw:
        if type(i) is not int or not 0 <= i < size:
            raise InvalidModelOutput(f"{group} wordIndexes has a bad entry")
    if len(set(raw)) != len(raw):
        raise InvalidModelOutput(f"{group} wordIndexes has duplicates")
    return sorted(raw)


def _group(raw, group: str, keys: set[str]):
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise InvalidModelOutput(f"{group} is not an object or null")
    if set(raw) != keys:
        raise InvalidModelOutput(f"{group} has the wrong keys")
    return raw


def _separable(raw, req: WordInfoRequest) -> dict | None:
    raw = _group(raw, "separableVerb", _SEPARABLE_KEYS)
    if raw is None:
        return None
    infinitive = _string(raw, "infinitive", required=True)
    indexes = _indexes(raw, "separableVerb", len(req.words))
    if req.word_index not in indexes:
        logger.info("group_dropped group=separableVerb")
        return None
    return {"infinitive": infinitive, "wordIndexes": indexes}


def _expression(raw, req: WordInfoRequest) -> dict | None:
    raw = _group(raw, "expression", _EXPRESSION_KEYS)
    if raw is None:
        return None
    text = _string(raw, "text", required=True)
    meaning = _string(raw, "meaning", required=True)
    kind = raw["type"]
    if not isinstance(kind, str) or kind not in EXPRESSION_TYPES:
        raise InvalidModelOutput("expression type is not allowed")
    indexes = _indexes(raw, "expression", len(req.words))
    if req.word_index not in indexes:
        logger.info("group_dropped group=expression")
        return None
    return {"text": text, "meaning": meaning, "type": kind, "wordIndexes": indexes}


def validate_model_output(text: str, stop_reason: str, req: WordInfoRequest) -> dict:
    if stop_reason != "end_turn":
        raise InvalidModelOutput("unexpected stop reason")
    if not isinstance(text, str):
        raise InvalidModelOutput("output is not text")
    try:
        data = json.loads(text)
    except (ValueError, RecursionError):
        raise InvalidModelOutput("output is not valid JSON") from None
    if not isinstance(data, dict):
        raise InvalidModelOutput("output is not a JSON object")
    if set(data) != _TOP_KEYS:
        raise InvalidModelOutput("output has the wrong keys")

    lemma = _string(data, "lemma", required=True)
    pos = data["pos"]
    if not isinstance(pos, str) or pos not in POS:
        raise InvalidModelOutput("pos is not allowed")
    phonetic = _string(data, "phonetic", required=False)
    article = data["article"]
    if not isinstance(article, str) or article not in (*ARTICLES, ""):
        raise InvalidModelOutput("article is not allowed")
    plural = _string(data, "plural", required=False)
    translation = _string(data, "translation", required=True)
    sense = _string(data, "senseInContext", required=True)
    example_de = _string(data, "exampleDe", required=True)
    example_en = _string(data, "exampleEn", required=True)
    separable = _separable(data["separableVerb"], req)
    expression = _expression(data["expression"], req)

    is_noun = pos == "noun"
    return {
        "version": 1,
        "word": req.word,
        "lemma": lemma,
        "pos": pos,
        "phonetic": phonetic,
        "translation": translation,
        "senseInContext": sense,
        "article": (article or None) if is_noun else None,
        "plural": (plural or None) if is_noun else None,
        "exampleDe": example_de,
        "exampleEn": example_en,
        "separableVerb": separable,
        "expression": expression,
    }
