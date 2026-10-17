"""Send a photo to Textract once and save the raw response as a test fixture.

Usage: python scripts/capture_fixture.py <image> <name>
Uses the local AWS credentials; region eu-central-1.
"""

import json
import sys
from pathlib import Path

import boto3

FIXTURES = Path(__file__).resolve().parents[1] / "backend" / "tests" / "fixtures"


def main(image: str, name: str) -> None:
    client = boto3.client("textract", region_name="eu-central-1")
    response = client.detect_document_text(Document={"Bytes": Path(image).read_bytes()})
    response.pop("ResponseMetadata", None)
    out = FIXTURES / f"{name}.textract.json"
    out.write_text(json.dumps(response, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out} ({len(response['Blocks'])} blocks)")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
