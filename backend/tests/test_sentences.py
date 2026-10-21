import json
from pathlib import Path

import jsonschema
import pytest

from helpers import bx, raw_page, text_line
from readmate.engines.fake import FakeEngine
from readmate.pipeline.hyphenation import merge_hyphenated
from readmate.pipeline.noise import filter_noise
from readmate.pipeline.normalize import normalize
from readmate.pipeline.sentences import fallback_sentences, segment_sentences

FIXTURES = Path(__file__).parent / "fixtures"
SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "contract" / "ocr-result.schema.json").read_text(
        encoding="utf-8"
    )
)
FULL = "Es war ein langer Tag und"


def prepared(page):
    return merge_hyphenated(filter_noise(normalize(page)))


def run(*lines):
    return segment_sentences(prepared(raw_page(list(lines))))


def kinds(entries):
    return [e["kind"] for e in entries]


def check_invariants(result, entries):
    assert [i for e in entries for i in e["wordIds"]] == [w["id"] for w in result["words"]]
    assert [e["id"] for e in entries] == list(range(len(entries)))
    assert all(e["kind"] in ("sentence", "fragment", "incomplete") for e in entries)


def book():
    return prepared(FakeEngine(FIXTURES / "book_page.textract.json").recognize(b""))


EXPECTED = [
    (0, 15, "sentence"), (16, 35, "sentence"), (36, 61, "sentence"), (62, 69, "sentence"),
    (71, 79, "sentence"), (81, 95, "sentence"), (96, 108, "sentence"), (109, 119, "sentence"),
    (120, 137, "sentence"), (138, 145, "sentence"), (146, 154, "sentence"),
    (155, 159, "fragment"), (161, 171, "sentence"), (172, 190, "sentence"), (191, 191, "fragment"),
]


def test_book_fixture_entries():
    r = book()
    entries = segment_sentences(r)
    assert [(e["wordIds"][0], e["wordIds"][-1], e["kind"]) for e in entries] == EXPECTED
    check_invariants(r, entries)
    assert [e["id"] for e in entries] == list(range(15))
    assert entries[11]["text"] == "»Sind Sie die Mutter von"
    jsonschema.validate({**r, "engine": "fake", "sentences": entries}, SCHEMA)


def test_kommst_du_fragte_er_is_one_entry():
    assert len(run(text_line("„Kommst du?“ fragte er. Dann ging er.", 0.1))) == 2


def test_unlisted_abbreviation_before_lowercase():
    assert len(run(text_line("Siehe Abs. drei hier. Ende.", 0.1))) == 2


def test_mid_sentence_ellipsis_before_lowercase():
    assert len(run(text_line("Er dachte... und ging weiter. Ende.", 0.1))) == 2


def _cancel_page(last):
    return run(
        text_line(FULL, 0.10),
        text_line("der Abend kam sehr spät", 0.14),
        text_line("Er kam nach Hause.", 0.18, right=0.5),
        last,
    )


def test_cancel_never_removes_boundary():
    assert len(_cancel_page(text_line("und dann schlief er ein.", 0.22, x=0.14))) == 2
    assert len(_cancel_page(text_line("und dann schlief er ein.", 0.30))) == 2


def test_colon_semicolon_comma_do_not_end():
    assert kinds(run(text_line("Er sagte: ja; nein, gut.", 0.1))) == ["sentence"]


def test_ordinal_date_does_not_end():
    assert len(run(text_line("Am 3. Oktober kam er.", 0.1))) == 1


def test_hyphen_merged_word_ends_sentence():
    out = run(text_line("Das ist die Vorstel-", 0.10), text_line("lungskraft. Neu hier.", 0.14))
    assert out[0]["text"] == "Das ist die Vorstellungskraft."
    assert out[1]["text"] == "Neu hier."
    assert sum("Vorstellungskraft" in e["text"] for e in out) == 1


def test_first_lowercase_is_incomplete():
    assert kinds(run(text_line("zufangen. Ich sah es.", 0.1))) == ["incomplete", "sentence"]


def test_page_number_then_lowercase():
    out = run(text_line("7", 0.10, x=0.45, right=0.48), text_line("weiter ging es. Ende.", 0.25))
    assert kinds(out) == ["fragment", "incomplete", "sentence"]


def test_last_full_line_without_punctuation_is_incomplete():
    assert kinds(run(text_line("Er ging. Dann kam der", 0.1))) == ["sentence", "incomplete"]


def test_trailing_page_number_is_fragment():
    out = run(
        text_line("Er ging.", 0.10),
        text_line("Sie kam.", 0.14),
        text_line("Es regnete.", 0.18),
        text_line("7", 0.30, x=0.45, right=0.48),
    )
    assert kinds(out) == ["sentence", "sentence", "sentence", "fragment"]


def test_heading_mid_page_is_fragment():
    out = run(
        text_line("Kapitel Zwei", 0.10, right=0.4),
        text_line("Er ging. Sie kam.", 0.25),
    )
    assert kinds(out) == ["fragment", "sentence", "sentence"]


def test_page_ends_in_unmerged_hyphen():
    assert kinds(run(text_line("Er sah die Vorstel-", 0.1)))[-1] == "incomplete"


def test_two_columns_in_reading_order():
    out = run(
        text_line("Links eins.", 0.10, x=0.05, right=0.45),
        text_line("Links zwei", 0.14, x=0.05, right=0.45),
        text_line("Rechts drei.", 0.10, x=0.55, right=0.95),
    )
    assert [e["text"] for e in out] == ["Links eins.", "Links zwei Rechts drei."]


def test_dropped_standalone_period_merges_sentences():
    page = [
        ("Er", bx(0.1, 0.1)),
        ("ging", bx(0.25, 0.1)),
        (".", bx(0.4, 0.1, w=0.01)),
        ("Sie", bx(0.5, 0.1)),
        ("kam.", bx(0.65, 0.1)),
    ]
    assert len(run(page)) == 1


@pytest.mark.parametrize(
    "lines",
    [
        [],
        [[("Hallo", bx(0.1, 0.1))]],
        [text_line("Er kam heute.", 0.1)],
        [[("Er", bx(0.1, 0.1))], [("kam", bx(0.1, 0.14))], [("heute", bx(0.1, 0.18))]],
        [text_line("7 12 2024", 0.1)],
        [
            text_line("Links eins hier.", 0.10, x=0.05, right=0.45),
            text_line("Links zwei hier.", 0.14, x=0.05, right=0.45),
            text_line("Links drei hier.", 0.18, x=0.05, right=0.45),
            text_line("Rechts allein", 0.10, x=0.6, right=0.9),
        ],
    ],
)
def test_small_inputs(lines):
    r = prepared(raw_page(lines))
    check_invariants(r, segment_sentences(r))


def test_all_short_list_page():
    names = ["Brot", "Milch", "Käse", "Eier", "Obst", "Reis"]
    lines = [text_line(n, 0.10 + 0.04 * i, right=0.3) for i, n in enumerate(names)]
    r = prepared(raw_page(lines))
    check_invariants(r, segment_sentences(r))


def test_empty_or_quote_text_word():
    box = {"x": 0.1, "y": 0.1, "w": 0.1, "h": 0.03}
    r = {
        "version": 1,
        "engine": "",
        "lines": [{"id": 0, "text": '" 7', "box": box, "boxIds": [0, 1]}],
        "boxes": [
            {"id": 0, "raw": '"', "lineId": 0, "conf": 0.9, "box": box, "wordId": 0},
            {"id": 1, "raw": "7.", "lineId": 0, "conf": 0.9, "box": box, "wordId": 1},
        ],
        "words": [
            {"id": 0, "text": "", "boxIds": [0], "lineIds": [0]},
            {"id": 1, "text": "7", "boxIds": [1], "lineIds": [0]},
        ],
    }
    check_invariants(r, segment_sentences(r))


def test_fallback_one_fragment_per_line():
    r = book()
    entries = fallback_sentences(r)
    assert len(entries) == 23
    assert set(kinds(entries)) == {"fragment"}
    assert [i for e in entries for i in e["wordIds"]] == [w["id"] for w in r["words"]]
    assert entries[11]["text"] == "da."
