import copy
import json
from pathlib import Path

import jsonschema
import pytest

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "contract" / "ocr-result.schema.json").read_text(
        encoding="utf-8"
    )
)

VALID = {
    "version": 1,
    "engine": "fake",
    "lines": [
        {"id": 0, "text": "Hallo", "box": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.05}, "boxIds": [0]}
    ],
    "boxes": [
        {
            "id": 0,
            "raw": "Hallo",
            "lineId": 0,
            "conf": 0.99,
            "box": {"x": 0.1, "y": 0.1, "w": 0.2, "h": 0.05},
            "wordId": 0,
        }
    ],
    "words": [{"id": 0, "text": "Hallo", "boxIds": [0], "lineIds": [0]}],
}


def test_schema_accepts_minimal_valid_result():
    jsonschema.validate(VALID, SCHEMA)


def test_schema_rejects_missing_field():
    bad = copy.deepcopy(VALID)
    del bad["words"]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, SCHEMA)


def test_schema_rejects_wrong_version():
    bad = copy.deepcopy(VALID)
    bad["version"] = 2
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, SCHEMA)


def test_schema_rejects_box_out_of_range():
    bad = copy.deepcopy(VALID)
    bad["boxes"][0]["box"]["x"] = 1.5
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(bad, SCHEMA)
