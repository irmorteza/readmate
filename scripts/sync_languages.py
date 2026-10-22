"""Check contract/languages.json and write its generated copies (stdlib only).

Usage (from the repo root):
    python scripts/sync_languages.py

Writes backend/src/readmate/wordinfo/languages.json and frontend/src/languages.json (byte
copies) and the `target` enum line of contract/word-info.schema.json. Prints the changed paths,
or "languages: up to date".
"""

import json
import re
import sys
from pathlib import Path

SOURCE = "contract/languages.json"
SCHEMA = "contract/word-info.schema.json"
COPIES = ("backend/src/readmate/wordinfo/languages.json", "frontend/src/languages.json")
ENTRY_KEYS = {"code", "english", "native", "dir", "mode"}
CODE_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$")
TARGET_LINE = re.compile(r'^(\s*)"target": \{.*\}(,?)\s*$', re.M)


def check(data: object) -> None:
    if not isinstance(data, dict) or set(data) != {"default", "languages"}:
        raise ValueError("top level must have exactly the keys default and languages")
    entries = data["languages"]
    if not isinstance(entries, list) or not entries:
        raise ValueError("languages must be a non-empty list")
    codes = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != ENTRY_KEYS:
            raise ValueError("each entry must have exactly the keys code/english/native/dir/mode")
        if any(not isinstance(v, str) or not v for v in entry.values()):
            raise ValueError("every entry value must be a non-empty string")
        if not CODE_RE.match(entry["code"]):
            raise ValueError("code must be a BCP 47-like tag")
        if entry["dir"] not in ("ltr", "rtl"):
            raise ValueError("dir must be ltr or rtl")
        if entry["mode"] not in ("translate", "explain"):
            raise ValueError("mode must be translate or explain")
        codes.append(entry["code"])
    if len(set(codes)) != len(codes):
        raise ValueError("codes must be unique")
    if data["default"] not in codes:
        raise ValueError("default must be a listed code")


def _codes(root: Path) -> list[str]:
    data = json.loads((root / SOURCE).read_text(encoding="utf-8"))
    return [entry["code"] for entry in data["languages"]]


def _schema_text(root: Path, codes: list[str]) -> str:
    text = (root / SCHEMA).read_text(encoding="utf-8")
    if len(TARGET_LINE.findall(text)) != 1:
        raise ValueError("the schema must have exactly one target line")
    enum = ", ".join(json.dumps(code) for code in codes)
    new = TARGET_LINE.sub(lambda m: f'{m[1]}"target": {{ "enum": [{enum}] }}{m[2]}', text)
    if json.loads(new)["$defs"]["request"]["properties"]["target"]["enum"] != codes:
        raise ValueError("the schema enum does not match the codes")
    return new


def _same_json(path: Path, source_bytes: bytes) -> bool:
    try:
        return json.loads(path.read_text(encoding="utf-8")) == json.loads(source_bytes)
    except (OSError, ValueError):
        return False


def _enum_matches(root: Path, codes: list[str]) -> bool:
    try:
        schema = json.loads((root / SCHEMA).read_text(encoding="utf-8"))
        return schema["$defs"]["request"]["properties"]["target"] == {"enum": codes}
    except (OSError, ValueError, KeyError):
        return False


def stale(root: Path) -> list[str]:
    source_bytes = (root / SOURCE).read_bytes()
    out = [rel for rel in COPIES if not _same_json(root / rel, source_bytes)]
    if not _enum_matches(root, _codes(root)):
        out.append(SCHEMA)
    return out


def sync(root: Path) -> list[str]:
    source_bytes = (root / SOURCE).read_bytes()
    changed = []
    for rel in COPIES:
        if not _same_json(root / rel, source_bytes):
            (root / rel).parent.mkdir(parents=True, exist_ok=True)
            (root / rel).write_bytes(source_bytes)
            changed.append(rel)
    codes = _codes(root)
    if not _enum_matches(root, codes):
        raw = (root / SCHEMA).read_bytes()
        newline = "\r\n" if b"\r\n" in raw else "\n"
        text = _schema_text(root, codes).replace("\r\n", "\n").replace("\n", newline)
        (root / SCHEMA).write_bytes(text.encode("utf-8"))
        changed.append(SCHEMA)
    return changed


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parents[1]
    try:
        check(json.loads((root / SOURCE).read_text(encoding="utf-8")))
        changed = sync(root)
    except ValueError as exc:
        print(f"languages: {exc}", file=sys.stderr)
        return 1
    print("\n".join(changed) if changed else "languages: up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
