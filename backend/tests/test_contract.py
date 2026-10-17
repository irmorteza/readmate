import json
import os
from pathlib import Path

import jsonschema

from readmate.core.process_image import process_image
from readmate.engines.fake import FakeEngine

CONTRACT = Path(__file__).resolve().parents[2] / "contract"
FIXTURE = Path(__file__).parent / "fixtures" / "golden.textract.json"


def test_output_matches_schema_and_golden():
    out = process_image(b"jpeg", FakeEngine(FIXTURE))
    schema = json.loads((CONTRACT / "ocr-result.schema.json").read_text(encoding="utf-8"))
    jsonschema.validate(out, schema)
    golden = CONTRACT / "example.json"
    if os.environ.get("UPDATE_GOLDEN") == "1":
        golden.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        return
    assert out == json.loads(golden.read_text(encoding="utf-8"))
