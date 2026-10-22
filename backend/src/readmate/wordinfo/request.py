"""Parsing, normalization and cache key for POST /word-info requests."""

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

from . import languages
from .languages import Language

MAX_BODY_BYTES = 16 * 1024
MAX_WORDS = 120
MAX_WORD_CHARS = 64
MAX_TEXT_CHARS = 600
KINDS = ("sentence", "fragment", "incomplete")
TARGETS = languages.CODES

_WS = re.compile(r"\s+")


class BadRequest(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass(frozen=True)
class WordInfoRequest:
    word: str
    word_index: int
    kind: str
    words: tuple[str, ...]
    target: str


def normalize(text: str) -> str:
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        raise BadRequest("text is not valid Unicode") from None
    return _WS.sub(" ", unicodedata.normalize("NFC", text)).strip()


def parse_request(body: bytes) -> WordInfoRequest:
    if len(body) > MAX_BODY_BYTES:
        raise BadRequest("request body too large")
    try:
        data = json.loads(body)
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise BadRequest("body is not valid JSON") from None
    if not isinstance(data, dict):
        raise BadRequest("body must be a JSON object")

    target = data.get("target")
    if target not in TARGETS:
        raise BadRequest("unsupported target")

    sentence = data.get("sentence")
    if not isinstance(sentence, dict):
        raise BadRequest("sentence must be an object")
    kind = sentence.get("kind")
    if kind not in KINDS:
        raise BadRequest("unsupported sentence kind")

    raw_words = sentence.get("words")
    if not isinstance(raw_words, list) or not 1 <= len(raw_words) <= MAX_WORDS:
        raise BadRequest(f"words must be a list of 1 to {MAX_WORDS} strings")
    words: list[str] = []
    for w in raw_words:
        if not isinstance(w, str):
            raise BadRequest("words must be strings")
        n = normalize(w)
        if not n or len(n) > MAX_WORD_CHARS:
            raise BadRequest("invalid word in words")
        words.append(n)
    if len(" ".join(words)) > MAX_TEXT_CHARS:
        raise BadRequest("sentence text too long")

    index = data.get("wordIndex")
    if type(index) is not int or not 0 <= index < len(words):
        raise BadRequest("wordIndex out of range")

    raw_word = data.get("word")
    if not isinstance(raw_word, str):
        raise BadRequest("word must be a string")
    word = normalize(raw_word)
    if not word or len(word) > MAX_WORD_CHARS:
        raise BadRequest("invalid word")
    if word not in words[index]:
        raise BadRequest("word does not match words[wordIndex]")

    return WordInfoRequest(word, index, kind, tuple(words), target)


def cache_key(
    req: WordInfoRequest,
    prompt_version: str,
    model: str,
    table: Mapping[str, Language] = languages.BY_CODE,
) -> str:
    language = table[req.target]
    material = "|".join(
        [
            prompt_version,
            model,
            req.target,
            language.english,
            language.mode,
            req.kind,
            str(req.word_index),
            "".join(req.words),
        ]
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()
