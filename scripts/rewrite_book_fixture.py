"""Replace the text of the reference-page Textract fixture, keeping its geometry (stdlib only).

Usage (from the repo root):
    python scripts/rewrite_book_fixture.py [--src PATH] [--out PATH]

Reads the fixture (default backend/tests/fixtures/book_page.textract.json) and
scripts/book_fixture_text.json (one string per LINE, words separated by single spaces) and writes the
fixture with every WORD's Text replaced word for word and every LINE's Text rebuilt from its words.
Ids, Geometry, Confidence and Relationships are untouched. Each new word must match the word it
replaces in leading punctuation, trailing punctuation and kind (uppercase, lowercase, digits, or
punctuation only); anything else aborts without writing.
"""

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "backend/tests/fixtures/book_page.textract.json"
MAPPING = ROOT / "scripts/book_fixture_text.json"
SHAPE = re.compile(r"^([^\w]*)(\w*)(.*)$")


def shape(text):
    lead, core, tail = SHAPE.match(text).groups()
    if not core:
        kind = "-"
    elif core.isdigit():
        kind = "D"
    else:
        kind = "U" if core[0].isupper() else "l"
    return lead, kind, tail


def rewrite(data, lines):
    blocks = data["Blocks"]
    words = {b["Id"]: b for b in blocks if b["BlockType"] == "WORD"}
    line_blocks = [b for b in blocks if b["BlockType"] == "LINE"]
    if len(line_blocks) != len(lines):
        raise ValueError(f"{len(line_blocks)} LINE blocks, {len(lines)} mapped lines")
    for n, (line, text) in enumerate(zip(line_blocks, lines)):
        ids = [i for rel in line.get("Relationships", []) for i in rel["Ids"]]
        new = text.split(" ")
        if len(ids) != len(new):
            raise ValueError(f"line {n}: {len(ids)} words, {len(new)} mapped")
        for i, word in zip(ids, new):
            if shape(words[i]["Text"]) != shape(word):
                raise ValueError(f"line {n}: word {word!r} does not fit its slot")
            words[i]["Text"] = word
        line["Text"] = text
    return data


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=FIXTURE)
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    data = json.loads(args.src.read_text(encoding="utf-8"))
    lines = json.loads(MAPPING.read_text(encoding="utf-8"))
    try:
        rewrite(data, lines)
    except ValueError as e:
        sys.exit(f"rewrite_book_fixture: {e}")
    out = args.out or args.src
    text = json.dumps(data, indent=2, ensure_ascii=False).replace("\n", "\r\n")
    out.write_bytes(text.encode("utf-8"))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
