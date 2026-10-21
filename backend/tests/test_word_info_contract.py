import json
import os
from pathlib import Path

import jsonschema
import pytest
from tests.helpers import GOLDEN_REQUEST, TOKEN, call, word_info_event

from readmate import handler as handler_module
from readmate.engines.fake_word_info import FakeWordInfoEngine
from readmate.wordinfo.request import parse_request
from readmate.wordinfo.service import WordInfoError, WordInfoService
from readmate.wordinfo.store import MemoryStore

CONTRACT = Path(__file__).resolve().parents[2] / "contract"
SCHEMA = json.loads((CONTRACT / "word-info.schema.json").read_text(encoding="utf-8"))
GOLDEN_PATH = CONTRACT / "word-info.example.json"


def validate(x, name):
    jsonschema.validate(x, {**SCHEMA, "$ref": f"#/$defs/{name}"})


def lookup_golden() -> dict:
    service = WordInfoService(
        lambda: FakeWordInfoEngine(), MemoryStore(), "fake", 500, clock=lambda: 0.0
    )
    return service.lookup(parse_request(json.dumps(GOLDEN_REQUEST).encode()), lambda: 15_000)


def test_golden_matches_fake_service():
    out = lookup_golden()
    if os.environ.get("UPDATE_GOLDEN") == "1":
        text = json.dumps(
            {"request": GOLDEN_REQUEST, "response": out}, indent=2, ensure_ascii=False
        )
        GOLDEN_PATH.write_bytes((text + "\n").encode("utf-8"))
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    assert golden == {"request": GOLDEN_REQUEST, "response": out}


def test_golden_validates():
    golden = json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))
    validate(golden["request"], "request")
    validate(golden["response"], "response")
    assert golden["response"]["expression"] is None
    assert golden["response"]["separableVerb"]["wordIndexes"] == [1, 5]
    assert golden["response"]["meta"]["model"] == "fake"
    assert golden["response"]["meta"]["latencyMs"] == 0


def test_error_body_from_handler_validates(monkeypatch):
    err = WordInfoError(
        502, "LOOKUP_FAILED", "Lookup failed.", {"stopReasons": ["max_tokens"], "outputTokens": [3]}
    )

    class Raises:
        def lookup(self, req, remaining):
            raise err

    monkeypatch.setenv("PILOT_TOKEN", TOKEN)
    monkeypatch.setattr(handler_module, "_get_word_info_service", lambda: Raises())
    status, body = call(word_info_event(GOLDEN_REQUEST))
    assert status == 502
    validate(body, "error")


def test_plain_error_body_validates():
    validate({"error": {"code": "BUSY", "message": "x"}}, "error")
    with pytest.raises(jsonschema.ValidationError):
        validate({"error": {"code": "BUSY"}}, "error")


def test_schema_response_required_matches_validator_keys():
    out = lookup_golden()
    keys = [k for k in out if k != "meta"]
    assert SCHEMA["$defs"]["response"]["required"] == [*keys, "meta"]
    assert set(SCHEMA["$defs"]["response"]["properties"]) == set(out)


def test_request_schema_rejects_bad_target():
    bad = {**GOLDEN_REQUEST, "target": "fr"}
    with pytest.raises(jsonschema.ValidationError):
        validate(bad, "request")
