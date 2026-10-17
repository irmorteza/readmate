import copy
import re

from readmate.pipeline.normalize import clean_word
from readmate.pipeline.types import OcrLine, OcrResult

_BROKEN_WORD = re.compile(r"[^\W\d_]-$")
_MIN_OVERLAP = 0.5
_MAX_GAP_IN_LINE_HEIGHTS = 1.5
# "Vor- und Nachteile": a hyphen before one of these is a suspended hyphen, not a line break.
_CONJUNCTIONS = {"und", "oder", "bis", "sowie", "bzw", "wie", "als"}


def _find_next_line(line: OcrLine, lines: list[OcrLine]) -> OcrLine | None:
    """Nearest line below `line` in the same column and close enough to be its continuation."""
    lb = line["box"]
    best: OcrLine | None = None
    best_gap = float("inf")
    for other in lines:
        ob = other["box"]
        if other["id"] == line["id"] or ob["y"] <= lb["y"]:
            continue
        overlap = min(lb["x"] + lb["w"], ob["x"] + ob["w"]) - max(lb["x"], ob["x"])
        if overlap < _MIN_OVERLAP * min(lb["w"], ob["w"]):
            continue
        gap = ob["y"] - (lb["y"] + lb["h"])
        if gap >= _MAX_GAP_IN_LINE_HEIGHTS * lb["h"]:
            continue
        if gap < best_gap:
            best, best_gap = other, gap
    return best


def merge_hyphenated(result: OcrResult) -> OcrResult:
    out = copy.deepcopy(result)
    boxes = {b["id"]: b for b in out["boxes"]}
    words = {w["id"]: w for w in out["words"]}
    consumed: set[int] = set()
    removed_words: set[int] = set()

    for line in out["lines"]:
        if not line["boxIds"]:
            continue
        last = boxes[line["boxIds"][-1]]
        if last["id"] in consumed or not _BROKEN_WORD.search(last["raw"]):
            continue
        nxt = _find_next_line(line, out["lines"])
        if nxt is None or not nxt["boxIds"]:
            continue
        first = boxes[nxt["boxIds"][0]]
        if first["id"] in consumed or not first["raw"][:1].isalpha():
            continue
        if clean_word(first["raw"]).lower() in _CONJUNCTIONS:
            continue
        # The continuation line's real first box may have been filtered out as noise; then
        # `first` is a later word and must not be glued to the stem. Measure against the stem
        # line's first kept box (the column's left edge): the engine's LINE box still spans
        # dropped glyphs such as a gutter bar, so it would misjudge a good continuation.
        column_left = boxes[line["boxIds"][0]]["box"]["x"]
        if first["box"]["x"] - column_left > nxt["box"]["h"]:
            continue
        stem = last["raw"] if not first["raw"][0].islower() else last["raw"][:-1]
        word = words[last["wordId"]]
        word["text"] = clean_word(stem + first["raw"])
        word["boxIds"] = [last["id"], first["id"]]
        word["lineIds"] = [line["id"], nxt["id"]]
        removed_words.add(first["wordId"])
        first["wordId"] = word["id"]
        consumed.update((last["id"], first["id"]))

    out["words"] = [w for w in out["words"] if w["id"] not in removed_words]
    return out
