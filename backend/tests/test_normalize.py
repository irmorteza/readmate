from helpers import bx, raw_page
from worttap.pipeline.normalize import clean_word, normalize


def two_lines():
    return raw_page(
        [
            [("Er", bx(0.1, 0.1)), ("hatte,", bx(0.25, 0.1))],
            [("eine", bx(0.1, 0.2)), ("Idee", bx(0.3, 0.2))],
        ]
    )


def test_one_box_and_word_per_raw_word():
    r = normalize(two_lines())
    assert len(r["boxes"]) == 4 and len(r["words"]) == 4
    for box in r["boxes"]:
        word = r["words"][box["wordId"]]
        assert word["boxIds"] == [box["id"]]
        assert word["lineIds"] == [box["lineId"]]


def test_line_text_and_box_ids():
    r = normalize(two_lines())
    assert [line["text"] for line in r["lines"]] == ["Er hatte,", "eine Idee"]
    assert [line["boxIds"] for line in r["lines"]] == [[0, 1], [2, 3]]
    assert [b["lineId"] for b in r["boxes"]] == [0, 0, 1, 1]


def test_clean_word_strips_outer_punctuation():
    assert clean_word("hatte,") == "hatte"
    assert clean_word("»Ja«") == "Ja"
    assert clean_word("„Haus“") == "Haus"


def test_clean_word_keeps_inner_hyphen_and_apostrophe():
    assert clean_word("Max-Planck") == "Max-Planck"
    assert clean_word("geht's") == "geht's"


def test_clean_word_keeps_trailing_hyphen_of_broken_word():
    assert clean_word("Vorstel-") == "Vorstel-"


def test_raw_preserved_exactly():
    r = normalize(two_lines())
    assert r["boxes"][1]["raw"] == "hatte,"
    assert r["words"][1]["text"] == "hatte"


def test_empty_page_gives_empty_result():
    r = normalize({"lines": []})
    assert r == {"version": 1, "engine": "", "lines": [], "boxes": [], "words": []}
