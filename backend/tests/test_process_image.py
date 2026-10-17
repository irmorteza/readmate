from pathlib import Path

import jsonschema
import pytest

from helpers import bx, raw_page
from worttap.core.process_image import process_image
from worttap.engines.fake import FakeEngine

FIXTURES = Path(__file__).parent / "fixtures"


class StubEngine:
    name = "stub"

    def __init__(self, page):
        self.page = page

    def recognize(self, image_bytes: bytes):
        return self.page


def test_process_image_runs_all_stages():
    out = process_image(b"jpeg", FakeEngine(FIXTURES / "golden.textract.json"))
    assert out["version"] == 1 and out["engine"] == "fake"
    texts = [w["text"] for w in out["words"]]
    assert "Vorstellungskraft" in texts  # merge ran
    assert "|" not in [b["raw"] for b in out["boxes"]]  # noise filter ran
    assert "groß" in texts  # normalize ran


def test_four_reference_hyphen_pairs_merge():
    page = raw_page(
        [
            [("war", bx(0.1, 0.10)), ("an-", bx(0.3, 0.10))],
            [("gehaltenem", bx(0.1, 0.14)), ("und", bx(0.4, 0.14)), ("auf-", bx(0.6, 0.14))],
            [("zufangen", bx(0.1, 0.18)), ("die", bx(0.4, 0.18)), ("De-", bx(0.6, 0.18))],
            [("tails", bx(0.1, 0.22)), ("seine", bx(0.4, 0.22)), ("Vorstel-", bx(0.6, 0.22))],
            [("lungskraft", bx(0.1, 0.26))],
        ]
    )
    texts = [w["text"] for w in process_image(b"", StubEngine(page))["words"]]
    for expected in ["angehaltenem", "aufzufangen", "Details", "Vorstellungskraft"]:
        assert expected in texts


def test_blank_page_returns_empty_valid_result():
    import json

    schema = json.loads(
        (Path(__file__).resolve().parents[2] / "contract" / "ocr-result.schema.json").read_text(
            encoding="utf-8"
        )
    )
    out = process_image(b"", StubEngine({"lines": []}))
    assert out["lines"] == out["boxes"] == out["words"] == []
    jsonschema.validate(out, schema)


@pytest.mark.skipif(
    not (FIXTURES / "book_page.textract.json").exists(), reason="reference fixture not captured"
)
def test_reference_page_hyphen_pairs_merge():
    # If Textract misreads one half in the fixture, assert the misread form here and mark it
    # "# known engine error" rather than weakening the merge rule.
    out = process_image(b"", FakeEngine(FIXTURES / "book_page.textract.json"))
    texts = [w["text"] for w in out["words"]]
    for expected in ["angehaltenem", "aufzufangen", "Details", "Vorstellungskraft"]:
        assert expected in texts


def _page_with_conf(lines, confs):
    """raw_page plus per-word confidences keyed by raw text."""
    page = raw_page(lines)
    for line in page["lines"]:
        for w in line["words"]:
            w["conf"] = confs.get(w["text"], w["conf"])
    return page


def test_low_confidence_speck_before_continuation_does_not_corrupt_merge():
    page = _page_with_conf(
        [
            [("Das", bx(0.1, 0.10)), ("Vorstel-", bx(0.3, 0.10))],
            [("i", bx(0.08, 0.14)), ("lungskraft", bx(0.1, 0.14))],
        ],
        {"i": 0.2},
    )
    texts = [w["text"] for w in process_image(b"", StubEngine(page))["words"]]
    assert "Vorstellungskraft" in texts and "Vorsteli" not in texts


def test_misread_low_confidence_first_half_is_not_merged_into_word():
    page = _page_with_conf(
        [
            [("Das", bx(0.1, 0.10)), ("Vorstel-", bx(0.3, 0.10))],
            [("luugskraft", bx(0.1, 0.14)), ("war", bx(0.5, 0.14))],
        ],
        {"luugskraft": 0.3},
    )
    texts = [w["text"] for w in process_image(b"", StubEngine(page))["words"]]
    assert "Vorstel-" in texts and "Vorstelluugskraft" not in texts


def test_speck_line_between_lines_does_not_block_merge():
    page = raw_page(
        [
            [("Das", bx(0.1, 0.10)), ("Vorstel-", bx(0.3, 0.10))],
            [(".", bx(0.15, 0.125, w=0.01, h=0.005))],
            [("lungskraft", bx(0.1, 0.14))],
        ]
    )
    texts = [w["text"] for w in process_image(b"", StubEngine(page))["words"]]
    assert "Vorstellungskraft" in texts


def test_noise_glyph_left_of_continuation_does_not_block_merge():
    # The engine's LINE box still spans the dropped "|", so the indent check must not use it.
    page = raw_page(
        [
            [("Das", bx(0.10, 0.10)), ("Vorstel-", bx(0.30, 0.10))],
            [
                ("|", bx(0.02, 0.14, w=0.01)),
                ("lungskraft", bx(0.10, 0.14)),
                ("war", bx(0.45, 0.14)),
            ],
        ]
    )
    texts = [w["text"] for w in process_image(b"", StubEngine(page))["words"]]
    assert "Vorstellungskraft" in texts
