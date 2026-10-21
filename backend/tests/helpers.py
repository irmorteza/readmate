from readmate.pipeline.types import Box, RawPage


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
