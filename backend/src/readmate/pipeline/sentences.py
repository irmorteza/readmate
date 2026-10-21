from readmate.pipeline.layout import analyze_layout
from readmate.pipeline.punctuation import display_text, ends_by_punctuation
from readmate.pipeline.types import OcrBox, OcrResult, OcrSentence, OcrWord


def _make(entries: list[list[OcrWord]], kinds: list, boxes: dict[int, OcrBox]) -> list[OcrSentence]:
    return [
        {
            "id": i,
            "kind": kind,
            "wordIds": [w["id"] for w in words],
            "text": " ".join(display_text(w, boxes) for w in words),
        }
        for i, (words, kind) in enumerate(zip(entries, kinds, strict=True))
    ]


def segment_sentences(result: OcrResult) -> list[OcrSentence]:
    """Group the page's words into entries of kind sentence / fragment / incomplete (spec §4-§6)."""
    words = result["words"]
    if not words:
        return []
    boxes = {b["id"]: b for b in result["boxes"]}
    line_last_box = {ln["id"]: ln["boxIds"][-1] for ln in result["lines"] if ln["boxIds"]}
    layout = analyze_layout(result)

    entries: list[list[OcrWord]] = []
    current: list[OcrWord] = []
    for i, word in enumerate(words):
        current.append(word)
        last_box = boxes[word["boxIds"][-1]]
        end = ends_by_punctuation(last_box["raw"])
        if end and i + 1 < len(words) and words[i + 1]["text"][:1].islower():
            end = False
        if (
            line_last_box.get(last_box["lineId"]) == last_box["id"]
            and last_box["lineId"] in layout.boundary_after
        ):
            end = True
        if end:
            entries.append(current)
            current = []
    if current:
        entries.append(current)

    punct = [ends_by_punctuation(boxes[e[-1]["boxIds"][-1]]["raw"]) for e in entries]
    kinds = ["sentence" if p else "fragment" for p in punct]

    for k, entry in enumerate(entries):
        if entry[0]["text"][:1].islower():
            if not any(punct[:k]):
                kinds[k] = "incomplete"
            break

    punct_after = False
    for k in range(len(entries) - 1, -1, -1):
        if punct[k]:
            punct_after = True
        elif not punct_after:
            last_box = boxes[entries[k][-1]["boxIds"][-1]]
            if last_box["lineId"] not in layout.short or last_box["raw"].endswith("-"):
                kinds[k] = "incomplete"
    return _make(entries, kinds, boxes)


def fallback_sentences(result: OcrResult) -> list[OcrSentence]:
    """One fragment per line that has words; a word belongs to the line of its first box."""
    boxes = {b["id"]: b for b in result["boxes"]}
    by_line: dict[int, list[OcrWord]] = {}
    for word in result["words"]:
        by_line.setdefault(boxes[word["boxIds"][0]]["lineId"], []).append(word)
    entries = [by_line[ln["id"]] for ln in result["lines"] if ln["id"] in by_line]
    return _make(entries, ["fragment"] * len(entries), boxes)
