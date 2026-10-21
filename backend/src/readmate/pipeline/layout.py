import statistics
from typing import NamedTuple

from readmate.pipeline.types import OcrLine, OcrResult

# Calibrated on a single book page (spec §5.3); re-tune together with their tests.
GAP_IN_UNITS = 1.0
SHORT_LINE_RATIO = 0.85
INDENT_IN_UNITS = 0.7
WINDOW = 3

_MIN_OVERLAP = 0.5


class Layout(NamedTuple):
    boundary_after: set[int]
    short: set[int]


def _overlaps(a: tuple[float, float], b: tuple[float, float]) -> bool:
    narrower = min(a[1] - a[0], b[1] - b[0])
    if narrower <= 0:
        return False
    return min(a[1], b[1]) - max(a[0], b[0]) >= _MIN_OVERLAP * narrower


def _percentile90(xs: list[float]) -> float:
    return sorted(xs)[int(0.9 * (len(xs) - 1))]


def analyze_layout(result: OcrResult) -> Layout:
    """Which lines close a paragraph (`boundary_after`) and which are short; both are line ids."""
    boxes = {b["id"]: b for b in result["boxes"]}
    lines: list[OcrLine] = [ln for ln in result["lines"] if ln["boxIds"]]
    if not lines:
        return Layout(set(), set())
    unit = statistics.median(b["box"]["h"] for b in result["boxes"])
    extent = {
        ln["id"]: (
            min(boxes[i]["box"]["x"] for i in ln["boxIds"]),
            max(boxes[i]["box"]["x"] + boxes[i]["box"]["w"] for i in ln["boxIds"]),
        )
        for ln in lines
    }

    local_left: dict[int, float] = {}
    short: set[int] = set()
    for ln in lines:
        mine = extent[ln["id"]]
        column = [o for o in lines if o["id"] == ln["id"] or _overlaps(mine, extent[o["id"]])]
        pos = next(i for i, o in enumerate(column) if o["id"] == ln["id"])
        around = column[max(0, pos - WINDOW) : pos] + column[pos + 1 : pos + 1 + WINDOW]
        left = statistics.median(extent[o["id"]][0] for o in around) if around else mine[0]
        local_left[ln["id"]] = left
        column_right = _percentile90([extent[o["id"]][1] for o in column])
        if column_right - left > 0 and (mine[1] - left) / (column_right - left) < SHORT_LINE_RATIO:
            short.add(ln["id"])

    boundary_after: set[int] = set()
    for ln, nxt in zip(lines, lines[1:], strict=False):
        if boxes[ln["boxIds"][-1]]["raw"].endswith("-"):
            continue
        gap = nxt["box"]["y"] - (ln["box"]["y"] + ln["box"]["h"])
        indented = extent[nxt["id"]][0] - local_left[nxt["id"]] >= INDENT_IN_UNITS * unit
        if gap > GAP_IN_UNITS * unit or (ln["id"] in short and indented):
            boundary_after.add(ln["id"])
    return Layout(boundary_after, short)
