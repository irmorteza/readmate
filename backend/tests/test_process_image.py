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
