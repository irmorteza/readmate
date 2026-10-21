import base64
import json

from readmate.handler import handler
from readmate.pipeline.types import Box, RawPage

TOKEN = "s3cret-token-xyz"

GOLDEN_REQUEST = {
    "word": "stellte",
    "wordIndex": 1,
    "sentence": {
        "kind": "sentence",
        "words": ["Er", "stellte", "sich", "den", "Gästen", "vor."],
    },
    "target": "en",
}


def make_event(
    path="/v1/word-info",
    method="POST",
    body=b"",
    token=TOKEN,
    content_type="application/json",
    b64=False,
):
    """Build a Function URL (payload v2) event with rawPath, method and headers."""
    headers = {}
    if token is not None:
        headers["x-pilot-token"] = token
    if content_type is not None:
        headers["content-type"] = content_type
    if isinstance(body, str):
        body = body.encode("utf-8")
    if body is not None and b64:
        body = base64.b64encode(body).decode()
    elif body is not None:
        body = body.decode("utf-8")
    event = {
        "headers": headers,
        "body": body,
        "isBase64Encoded": b64,
        "requestContext": {"http": {"method": method}},
    }
    if path is not None:
        event["rawPath"] = path
    return event


def word_info_event(req, **over):
    return make_event(body=json.dumps(req, ensure_ascii=False).encode("utf-8"), **over)


def ocr_event(**over):
    kwargs = {"path": "/ocr", "body": b"\xff\xd8jpeg", "content_type": "image/jpeg", "b64": True}
    kwargs.update(over)
    return make_event(**kwargs)


def call(event):
    resp = handler(event, None)
    return resp["statusCode"], json.loads(resp["body"])


def raw_page(lines: list[list[tuple[str, Box]]], conf: float = 0.99) -> RawPage:
    """Build a RawPage from lines of (text, box) words; line box/text derived from its words."""
    out = []
    for words in lines:
        xs = [b["x"] for _, b in words]
        ys = [b["y"] for _, b in words]
        x2 = [b["x"] + b["w"] for _, b in words]
        y2 = [b["y"] + b["h"] for _, b in words]
        out.append(
            {
                "text": " ".join(t for t, _ in words),
                "conf": conf,
                "box": {
                    "x": min(xs),
                    "y": min(ys),
                    "w": max(x2) - min(xs),
                    "h": max(y2) - min(ys),
                },
                "words": [{"text": t, "conf": conf, "box": b} for t, b in words],
            }
        )
    return {"lines": out}


def bx(x: float, y: float, w: float = 0.1, h: float = 0.03) -> Box:
    return {"x": x, "y": y, "w": w, "h": h}


def text_line(
    text: str, y: float, x: float = 0.1, right: float = 0.9, h: float = 0.03
) -> list[tuple[str, Box]]:
    """Words of `text` spread evenly between `x` and `right`, for use with `raw_page`."""
    words = text.split(" ")
    gap = 0.01
    w = (right - x - gap * (len(words) - 1)) / len(words)
    return [(t, bx(x + i * (w + gap), y, w, h)) for i, t in enumerate(words)]
