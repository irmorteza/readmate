"""Deterministic word-info engine for local development and tests (no network)."""

import json
import re
from collections.abc import Mapping

from readmate.engines.base import EngineReply

_PUNCT = ".,;:!?»«„“”\"'()"
_INDEX = re.compile(r"<tapped_index>(\d+)</tapped_index>")
_TARGET = re.compile(r'<target_language code="([^"]+)"')
_WORDS = re.compile(r"<words>\n(.*)\n</words>", re.DOTALL)


def _clean(word: str) -> str:
    return word.strip(_PUNCT)


def _parse(user: str) -> tuple[str, int, list[str]]:
    found = _TARGET.search(user)
    target = found.group(1) if found else "en"
    index = int(_INDEX.search(user).group(1))
    words = []
    for line in _WORDS.search(user).group(1).split("\n"):
        _, _, word = line.partition(" ")
        words.append(word)
    return target, index, words


def _base(lemma: str) -> dict:
    return {
        "lemma": lemma,
        "pos": "other",
        "phonetic": "",
        "article": "",
        "plural": "",
        "translation": "fake translation",
        "senseInContext": "A fake explanation of this word.",
        "exampleDe": "Das ist ein Beispiel.",
        "exampleEn": "This is an example.",
        "exampleTranslation": "This is an example.",
        "separableVerb": None,
        "expression": None,
    }


_RTL_SAMPLES = {
    "fa": ("ترجمهٔ آزمایشی", "توضیح آزمایشی این واژه.", "این یک مثال است."),
    "ar": ("ترجمة تجريبية", "شرح تجريبي لهذه الكلمة.", "هذا مثال."),
}


def _localize(out: dict, target: str) -> dict:
    if target == "en":
        return out
    sample = _RTL_SAMPLES.get(target)
    for field in ("translation", "senseInContext", "exampleTranslation"):
        out[field] = f"[{target}] {out[field]}"
    if out["expression"] is not None:
        out["expression"]["meaning"] = f"[{target}] {out['expression']['meaning']}"
    if sample is not None:
        translation, sense, example = sample
        out.update(translation=translation, senseInContext=sense, exampleTranslation=example)
        if out["expression"] is not None:
            out["expression"]["meaning"] = translation
    return out


def _answer(index: int, words: list[str], target: str = "en") -> dict:
    word = _clean(words[index])
    low = word.lower()
    lowered = [_clean(w).lower() for w in words]
    out = _base(word)
    if low == "stellte":
        verfuegung = next((i for i, w in enumerate(lowered) if w.startswith("verfügung")), None)
        if verfuegung is not None:
            before = verfuegung - 1
            parts = {index, verfuegung}
            if before >= 0 and lowered[before] == "zur":
                parts.add(before)
            out.update(
                pos="verb",
                lemma="stellen",
                translation="to provide",
                expression={
                    "text": "zur Verfügung stellen",
                    "meaning": "to make available",
                    "type": "verb-pattern",
                    "wordIndexes": sorted(parts),
                },
            )
        else:
            candidates = [
                i for i, w in enumerate(lowered) if i != index and w.startswith("vor")
            ]
            particle = candidates[-1] if candidates else None
            if particle is not None:
                out.update(
                    pos="verb",
                    lemma="vorstellen",
                    translation="to introduce",
                    separableVerb={
                        "infinitive": "vorstellen",
                        "wordIndexes": sorted({index, particle}),
                    },
                )
    elif low == "angst":
        have = next((i for i, w in enumerate(lowered) if w.startswith("hab")), None)
        out.update(pos="noun", article="die", plural="Ängste", translation="fear")
        if have is not None:
            out["expression"] = {
                "text": "Angst haben",
                "meaning": "to be afraid",
                "type": "collocation",
                "wordIndexes": sorted({index, have}),
            }
    return _localize(out, target)


class FakeWordInfoEngine:
    name = "fake"
    model = "fake"

    def __init__(self, script: list[EngineReply | Exception] | None = None):
        self.script = list(script) if script is not None else None
        self.calls: list[dict] = []

    @classmethod
    def from_env(cls, env: Mapping[str, str], model: str) -> "FakeWordInfoEngine":
        return cls()

    def explain(self, system: str, user: str, schema: dict, timeout_s: float) -> EngineReply:
        self.calls.append(
            {"system": system, "user": user, "schema": schema, "timeout_s": timeout_s}
        )
        if self.script is not None:
            item = self.script.pop(0)
            if isinstance(item, Exception):
                raise item
            return item
        target, index, words = _parse(user)
        text = json.dumps(_answer(index, words, target), ensure_ascii=False)
        return EngineReply(text, "end_turn", len(user) // 4, len(text) // 4)
