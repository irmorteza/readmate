import json
from pathlib import Path

from readmate.engines.textract import from_textract

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


def _response_with_word_box(box: dict) -> dict:
    return {
        "Blocks": [
            {
                "BlockType": "LINE",
                "Id": "l",
                "Text": "Rand",
                "Confidence": 99.0,
                "Relationships": [{"Type": "CHILD", "Ids": ["w"]}],
                "Geometry": {"BoundingBox": box},
            },
            {
                "BlockType": "WORD",
                "Id": "w",
                "Text": "Rand",
                "Confidence": 99.0,
                "Geometry": {"BoundingBox": box},
            },
        ]
    }


def test_negative_left_edge_is_clamped_into_0_1():
    page = from_textract(
        _response_with_word_box({"Left": -0.001, "Top": 0.1, "Width": 0.2, "Height": 0.05})
    )
    box = page["lines"][0]["words"][0]["box"]
    assert box["x"] == 0.0
    assert abs(box["w"] - 0.199) < 1e-9


def test_box_running_past_right_and_bottom_edge_is_clamped():
    page = from_textract(
        _response_with_word_box({"Left": 0.95, "Top": 0.98, "Width": 0.1, "Height": 0.05})
    )
    box = page["lines"][0]["words"][0]["box"]
    assert box["x"] == 0.95 and box["y"] == 0.98
    assert abs(box["w"] - 0.05) < 1e-9 and abs(box["h"] - 0.02) < 1e-9
    assert all(0 <= v <= 1 for v in box.values())
