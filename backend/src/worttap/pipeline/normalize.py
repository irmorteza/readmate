from worttap.pipeline.types import OcrBox, OcrLine, OcrResult, OcrWord, RawPage

_STRIP = ",.;:!?»«„“”\"'‘’‚()[]"


def clean_word(raw: str) -> str:
    """Strip leading/trailing punctuation; inner hyphens/apostrophes and a trailing hyphen stay."""
    return raw.strip(_STRIP)


def normalize(raw: RawPage) -> OcrResult:
    lines: list[OcrLine] = []
    boxes: list[OcrBox] = []
    words: list[OcrWord] = []
    for line_id, line in enumerate(raw["lines"]):
        box_ids = []
        for w in line["words"]:
            box_id = len(boxes)
            word_id = len(words)
            boxes.append(
                {
                    "id": box_id,
                    "raw": w["text"],
                    "lineId": line_id,
                    "conf": w["conf"],
                    "box": dict(w["box"]),
                    "wordId": word_id,
                }
            )
            words.append(
                {
                    "id": word_id,
                    "text": clean_word(w["text"]),
                    "boxIds": [box_id],
                    "lineIds": [line_id],
                }
            )
            box_ids.append(box_id)
        lines.append(
            {"id": line_id, "text": line["text"], "box": dict(line["box"]), "boxIds": box_ids}
        )
    return {"version": 1, "engine": "", "lines": lines, "boxes": boxes, "words": words}
