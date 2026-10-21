from readmate.pipeline.normalize import _STRIP
from readmate.pipeline.types import OcrBox, OcrWord

CLOSING = "“”\"'’‘»«›‹)]"
OPENING = "„‚»«›‹“([\"'"
ABBREVIATIONS = frozenset(
    "usw bzw Dr Nr ca etc vgl ggf evtl Prof Mio Mrd Jh Str St".split()
)


def ends_by_punctuation(raw: str) -> bool:
    """Whether a box's raw text ends a sentence (spec §4 rules 1-4; no lowercase cancel)."""
    s = raw.rstrip(CLOSING)
    if s.endswith(("...", "…")):
        return True
    if s.endswith(("!", "?")):
        return True
    if not s.endswith("."):
        return False
    token = s[:-1].lstrip(OPENING)
    if "." in token:
        return False
    if len(token) == 1 and token.isalpha():
        return False
    if token in ABBREVIATIONS:
        return False
    if token.isdigit() and len(token) <= 2:
        return False
    return True


def display_text(word: OcrWord, boxes: dict[int, OcrBox]) -> str:
    """Word text with the opening/closing punctuation that `clean_word` stripped put back."""
    text = word["text"]
    if not text:
        return ""
    first = boxes[word["boxIds"][0]]["raw"]
    last = boxes[word["boxIds"][-1]]["raw"]
    leading = first[: len(first) - len(first.lstrip(_STRIP))]
    trailing = last[len(last.rstrip(_STRIP)) :]
    return leading + text + trailing
