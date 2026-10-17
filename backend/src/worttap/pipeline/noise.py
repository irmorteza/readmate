import copy
import statistics

from worttap.pipeline.types import OcrResult

MIN_CONF = 0.40
MIN_HEIGHT_RATIO = 0.4
MAX_HEIGHT_RATIO = 2.5


def filter_noise(result: OcrResult) -> OcrResult:
    out = copy.deepcopy(result)
    if not out["boxes"]:
        return out
    median_h = statistics.median(b["box"]["h"] for b in out["boxes"])
    lo, hi = MIN_HEIGHT_RATIO * median_h, MAX_HEIGHT_RATIO * median_h

    def is_noise(box) -> bool:
        return (
            not any(c.isalnum() for c in box["raw"])
            or box["conf"] < MIN_CONF
            or box["box"]["h"] < lo
            or box["box"]["h"] > hi
        )

    dropped = {b["id"] for b in out["boxes"] if is_noise(b)}
    out["boxes"] = [b for b in out["boxes"] if b["id"] not in dropped]
    for word in out["words"]:
        word["boxIds"] = [i for i in word["boxIds"] if i not in dropped]
    out["words"] = [w for w in out["words"] if w["boxIds"]]
    for line in out["lines"]:
        line["boxIds"] = [i for i in line["boxIds"] if i not in dropped]
    out["lines"] = [line for line in out["lines"] if line["boxIds"]]
    live_lines = {b["id"]: b["lineId"] for b in out["boxes"]}
    for word in out["words"]:
        kept = {live_lines[i] for i in word["boxIds"]}
        word["lineIds"] = [lid for lid in word["lineIds"] if lid in kept]
    return out
