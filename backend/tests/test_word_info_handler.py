import base64
import json
import logging
from pathlib import Path

import jsonschema
import pytest
from tests.helpers import GOLDEN_REQUEST, TOKEN, call, make_event, ocr_event, word_info_event

from readmate import handler as handler_module
from readmate.handler import _reset_word_info_service, handler
from readmate.wordinfo.service import WordInfoError

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "contract" / "word-info.schema.json").read_text(
        encoding="utf-8"
    )
)


def validate(x, name):
    jsonschema.validate(x, {**SCHEMA, "$ref": f"#/$defs/{name}"})


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("PILOT_TOKEN", TOKEN)
    monkeypatch.setenv("OCR_ENGINE", "fake")
    monkeypatch.setenv("WORD_INFO_ENGINE", "fake")
    monkeypatch.delenv("WORD_INFO_TABLE", raising=False)
    _reset_word_info_service()
    yield
    _reset_word_info_service()


def test_valid_request_200_then_cached():
    status, body = call(word_info_event(GOLDEN_REQUEST))
    assert status == 200
    validate(body, "response")
    assert body["meta"]["cached"] is False
    status, body = call(word_info_event(GOLDEN_REQUEST))
    assert status == 200 and body["meta"]["cached"] is True


def test_wrong_token_beats_everything():
    event = make_event(body=b"not json", token="nope", content_type="text/plain")
    assert call(event)[0] == 401
    assert call(word_info_event(GOLDEN_REQUEST, token="nope", method="GET"))[0] == 401
    assert call(word_info_event(GOLDEN_REQUEST, token=None))[0] == 401


def test_get_is_405():
    status, body = call(word_info_event(GOLDEN_REQUEST, method="GET"))
    assert status == 405 and body["error"]["code"] == "METHOD_NOT_ALLOWED"


def test_wrong_content_type_400():
    status, body = call(word_info_event(GOLDEN_REQUEST, content_type="text/plain"))
    assert status == 400 and body["error"]["code"] == "BAD_REQUEST"


def test_content_type_with_charset_accepted():
    event = word_info_event(GOLDEN_REQUEST, content_type="application/json; charset=utf-8")
    assert call(event)[0] == 200


def test_base64_body_accepted():
    event = word_info_event(GOLDEN_REQUEST, b64=True)
    assert event["isBase64Encoded"] is True
    assert call(event)[0] == 200


def test_invalid_base64_400():
    event = make_event(body=b"x", b64=True)
    event["body"] = "!!!not base64!!!"
    status, body = call(event)
    assert status == 400 and body["error"]["code"] == "BAD_REQUEST"


def test_missing_body_400():
    event = make_event()
    event["body"] = None
    assert call(event)[0] == 400


def test_bad_request_message():
    bad = {**GOLDEN_REQUEST, "wordIndex": 99}
    status, body = call(word_info_event(bad))
    assert status == 400
    assert body["error"] == {"code": "BAD_REQUEST", "message": "wordIndex out of range"}


class _Raises:
    def __init__(self, exc):
        self.exc = exc

    def lookup(self, req, remaining):
        raise self.exc


def test_word_info_error_maps_status_code_and_extra(monkeypatch):
    err = WordInfoError(502, "LOOKUP_FAILED", "Lookup failed.", {"stopReasons": ["max_tokens"]})
    monkeypatch.setattr(handler_module, "_get_word_info_service", lambda: _Raises(err))
    status, body = call(word_info_event(GOLDEN_REQUEST))
    assert status == 502 and body["error"]["code"] == "LOOKUP_FAILED"
    assert body["error"]["stopReasons"] == ["max_tokens"]


def test_word_info_error_without_extra(monkeypatch):
    err = WordInfoError(429, "BUSY", "Busy.")
    monkeypatch.setattr(handler_module, "_get_word_info_service", lambda: _Raises(err))
    status, body = call(word_info_event(GOLDEN_REQUEST))
    assert status == 429 and body["error"] == {"code": "BUSY", "message": "Busy."}


def test_unexpected_exception_500_logs_type_only(monkeypatch, caplog):
    monkeypatch.setattr(
        handler_module, "_get_word_info_service", lambda: _Raises(RuntimeError("stellte secret"))
    )
    with caplog.at_level(logging.INFO, logger="readmate"):
        status, body = call(word_info_event(GOLDEN_REQUEST))
    assert status == 500 and body["error"]["code"] == "INTERNAL"
    assert "route=word-info" in caplog.text and "RuntimeError" in caplog.text
    assert "secret" not in body["error"]["message"]


def test_context_none_uses_15s_fallback(monkeypatch):
    seen = []

    class Spy:
        def lookup(self, req, remaining):
            seen.append(remaining())
            raise WordInfoError(429, "BUSY", "Busy.")

    monkeypatch.setattr(handler_module, "_get_word_info_service", lambda: Spy())
    assert handler(word_info_event(GOLDEN_REQUEST), None)["statusCode"] == 429
    assert seen == [15_000]


def test_context_with_remaining_time_is_used(monkeypatch):
    seen = []

    class Spy:
        def lookup(self, req, remaining):
            seen.append(remaining())
            raise WordInfoError(429, "BUSY", "Busy.")

    class Ctx:
        aws_request_id = "r1"

        def get_remaining_time_in_millis(self):
            return 4321

    monkeypatch.setattr(handler_module, "_get_word_info_service", lambda: Spy())
    handler(word_info_event(GOLDEN_REQUEST), Ctx())
    assert seen == [4321]


def test_ok_log_has_route(caplog):
    with caplog.at_level(logging.INFO, logger="readmate"):
        call(word_info_event(GOLDEN_REQUEST))
    assert any("ok " in r.message and "route=word-info" in r.message for r in caplog.records)
    assert "stellte" not in caplog.text


def test_ocr_without_raw_path_still_runs():
    status, body = call(ocr_event(path=None))
    assert status == 200 and body["version"] == 1


def test_ocr_with_ocr_path_still_runs():
    status, body = call(ocr_event(path="/ocr"))
    assert status == 200 and body["version"] == 1


def test_base64_helper_roundtrip():
    assert base64.b64decode(ocr_event()["body"]) == b"\xff\xd8jpeg"
