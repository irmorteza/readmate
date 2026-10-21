import pytest

from helpers import bx, raw_page
from readmate.pipeline.hyphenation import merge_hyphenated
from readmate.pipeline.normalize import normalize
from readmate.pipeline.punctuation import display_text, ends_by_punctuation


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("Haus.", True), ("Haus!", True), ("Haus?", True), ("Haus…", True), ("Haus...", True),
        ("Haus.“", True), ("Haus.«", True), ("Haus.»", True), ("Haus.)", True), ("Haus.]", True),
        ("Haus?«", True), ("1989.", True),
        ("Haus", False), ("Haus,", False), ("Haus:", False), ("Haus;", False),
        ("z.", False), ("B.", False), ("S.", False), ("J.", False),
        ("z.B.", False), ("d.h.", False), ("u.a.", False), ("3.10.", False),
        ("usw.", False), ("Dr.", False), ("Mio.", False), ("St.", False), ("(vgl.", False),
        ("3.", False), ("31.", False),
        ("Komm!‹«", True), ("ja.›", True), ("›Dr.", False), ("›z.B.", False),
        ("ab...", True),  # ellipsis is checked before the dotted-abbreviation rule
    ],
)
def test_ends_by_punctuation(raw, expected):
    assert ends_by_punctuation(raw) is expected


def _word(page, i=0):
    r = merge_hyphenated(normalize(raw_page(page)))
    return r["words"][i], {b["id"]: b for b in r["boxes"]}


def test_display_text_keeps_punctuation():
    w, b = _word([[("»Sind", bx(0.1, 0.1))]])
    assert display_text(w, b) == "»Sind"
    w, b = _word([[("›Sind", bx(0.1, 0.1))]])
    assert display_text(w, b) == "›Sind"
    w, b = _word([[("Arbeit.", bx(0.1, 0.1))]])
    assert display_text(w, b) == "Arbeit."
    w, b = _word([[("Vorstel-", bx(0.1, 0.1))], [("lungskraft.“", bx(0.1, 0.14))]])
    assert w["text"] == "Vorstellungskraft"
    assert display_text(w, b) == "Vorstellungskraft.“"
