import json
from pathlib import Path

from worttap.engines.textract import from_textract

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str = "mini") -> dict:
    return json.loads((FIXTURES / f"{name}.textract.json").read_text(encoding="utf-8"))


def test_lines_in_returned_order():
    page = from_textract(load())
    assert [line["text"] for line in page["lines"]] == ["Er hatte,", "eine Idee"]


def test_words_resolved_via_child_relationship():
    page = from_textract(load())
    assert [[w["text"] for w in line["words"]] for line in page["lines"]] == [
        ["Er", "hatte,"],
        ["eine", "Idee"],
    ]


def test_bounding_box_mapped_to_xywh():
    page = from_textract(load())
    assert page["lines"][0]["words"][1]["box"] == {"x": 0.25, "y": 0.1, "w": 0.25, "h": 0.05}
    assert page["lines"][0]["box"] == {"x": 0.1, "y": 0.1, "w": 0.4, "h": 0.05}


def test_confidence_divided_by_100():
    page = from_textract(load())
    assert page["lines"][0]["words"][0]["conf"] == 0.995
    assert page["lines"][0]["conf"] == 0.99


def test_ignores_other_block_types():
    page = from_textract(load())
    assert sum(len(line["words"]) for line in page["lines"]) == 4


def test_response_without_lines_gives_empty_page():
    assert from_textract({"Blocks": []}) == {"lines": []}
