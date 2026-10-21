import ast
import os
import subprocess
import sys
from pathlib import Path

from tests.helpers import GOLDEN_REQUEST, TOKEN, call, ocr_event, word_info_event

from readmate.handler import _reset_word_info_service

SRC = Path(__file__).resolve().parents[1] / "src"


def test_importing_the_handler_pulls_in_no_llm_sdk():
    code = (
        "import sys, readmate.handler; "
        "bad = [m for m in ('anthropic', 'pydantic', 'httpx', 'httpx2', "
        "'readmate.engines.anthropic_word_info') if m in sys.modules]; print(bad)"
    )
    out = subprocess.run(
        [sys.executable, "-c", code],
        cwd=SRC,
        env={**os.environ, "PYTHONPATH": str(SRC)},
        capture_output=True,
        text=True,
        check=True,
    )
    assert out.stdout.strip() == "[]"


def test_sdk_import_failure_gives_503_and_ocr_still_works(monkeypatch, caplog):
    monkeypatch.setenv("PILOT_TOKEN", TOKEN)
    monkeypatch.setenv("OCR_ENGINE", "fake")
    monkeypatch.delenv("WORD_INFO_TABLE", raising=False)
    monkeypatch.setenv("WORD_INFO_ENGINE", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY_PARAM", "/readmate/anthropic-api-key")
    monkeypatch.setitem(sys.modules, "anthropic", None)  # import anthropic -> ImportError
    monkeypatch.delitem(sys.modules, "readmate.engines.anthropic_word_info", raising=False)
    _reset_word_info_service()
    try:
        status, body = call(word_info_event(GOLDEN_REQUEST))
        assert status == 503 and body["error"]["code"] == "NOT_CONFIGURED"
        assert "word-info engine import failed" in caplog.text
        assert call(ocr_event())[0] == 200  # OCR_ENGINE=fake
    finally:
        _reset_word_info_service()


def test_no_module_outside_engines_imports_anthropic():
    for path in SRC.joinpath("readmate").rglob("*.py"):
        if "engines" in path.relative_to(SRC / "readmate").parts:
            continue
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = (
                [a.name for a in node.names]
                if isinstance(node, ast.Import)
                else [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else []
            )
            assert not any(n == "anthropic" or n.startswith("anthropic.") for n in names), path


def test_no_module_imports_a_provider_engine_at_module_level():
    # engine modules are reached only through word_info_registry.load_engine_class
    for path in SRC.joinpath("readmate").rglob("*.py"):
        for node in ast.parse(path.read_text(encoding="utf-8")).body:
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in node.names] + [getattr(node, "module", "") or ""]
                assert not any(n.endswith("anthropic_word_info") for n in names), path
