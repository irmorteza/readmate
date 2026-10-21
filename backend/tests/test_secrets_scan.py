"""No git-tracked file may contain an Anthropic API key."""

import re
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
# Built from pieces so this file does not match its own pattern.
KEY_PATTERN = re.compile("sk-" + "ant-" + r"[A-Za-z0-9_-]{20,}")


def test_no_tracked_file_contains_an_anthropic_api_key():
    listing = subprocess.run(
        ["git", "ls-files", "-z"], cwd=REPO, check=True, capture_output=True
    ).stdout
    names = [n for n in listing.decode("utf-8").split("\0") if n]
    assert names
    offenders = []
    for name in names:
        path = REPO / name
        if not path.is_file():
            continue
        try:
            text = path.read_bytes().decode("utf-8")
        except UnicodeDecodeError:
            continue
        if KEY_PATTERN.search(text):
            offenders.append(name)
    assert not offenders, offenders
