"""Amazon Textract adapter: converts a DetectDocumentText response to a RawPage."""

from worttap.pipeline.types import Box, RawLine, RawPage, RawWord


def _box(block: dict) -> Box:
    bb = block["Geometry"]["BoundingBox"]
    return {"x": bb["Left"], "y": bb["Top"], "w": bb["Width"], "h": bb["Height"]}


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
