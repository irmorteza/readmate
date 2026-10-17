"""Amazon Textract adapter: converts a DetectDocumentText response to a RawPage."""

import boto3

from readmate.pipeline.types import Box, RawLine, RawPage, RawWord

# Created once at import so warm Lambda invocations reuse the connection.
_client = boto3.client("textract")


def _clamp_axis(start: float, size: float) -> tuple[float, float]:
    """Keep an interval inside 0-1; Textract can report boxes slightly outside the image."""
    end = start + size
    if start >= 0 and end <= 1 + 1e-9:
        return start, size
    start_c = min(max(start, 0.0), 1.0)
    return start_c, min(max(end, 0.0), 1.0) - start_c


def _box(block: dict) -> Box:
    bb = block["Geometry"]["BoundingBox"]
    x, w = _clamp_axis(bb["Left"], bb["Width"])
    y, h = _clamp_axis(bb["Top"], bb["Height"])
    return {"x": x, "y": y, "w": w, "h": h}


def from_textract(response: dict) -> RawPage:
    blocks = {b["Id"]: b for b in response.get("Blocks", [])}
    lines: list[RawLine] = []
    for block in response.get("Blocks", []):
        if block["BlockType"] != "LINE":
            continue
        words: list[RawWord] = []
        for rel in block.get("Relationships", []):
            if rel["Type"] != "CHILD":
                continue
            for child_id in rel["Ids"]:
                child = blocks.get(child_id)
                if child is None or child["BlockType"] != "WORD":
                    continue
                words.append(
                    {
                        "text": child["Text"],
                        "conf": child["Confidence"] / 100,
                        "box": _box(child),
                    }
                )
        lines.append(
            {
                "text": block["Text"],
                "conf": block["Confidence"] / 100,
                "box": _box(block),
                "words": words,
            }
        )
    return {"lines": lines}


class TextractEngine:
    name = "textract"

    def recognize(self, image_bytes: bytes) -> RawPage:
        response = _client.detect_document_text(Document={"Bytes": image_bytes})
        return from_textract(response)
