import json
from pathlib import Path

from readmate.engines.textract import from_textract
from readmate.pipeline.types import RawPage

_FIXTURES = Path(__file__).resolve().parents[3] / "tests" / "fixtures"


def _default_fixture() -> Path:
    real = _FIXTURES / "book_page.textract.json"
    return real if real.exists() else _FIXTURES / "mini.textract.json"


class FakeEngine:
    """Returns a recorded Textract response; for local dev and tests."""

    name = "fake"

    def __init__(self, fixture_path: Path | None = None):
        self.fixture_path = fixture_path or _default_fixture()

    def recognize(self, image_bytes: bytes) -> RawPage:
        return from_textract(json.loads(self.fixture_path.read_text(encoding="utf-8")))
