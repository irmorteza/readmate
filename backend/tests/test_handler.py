import base64
import json
import logging
from pathlib import Path

import jsonschema
import pytest
from botocore.exceptions import EndpointConnectionError
from botocore.stub import Stubber

from worttap import handler as handler_module
from worttap.engines import textract as textract_module
from worttap.handler import handler

TOKEN = "s3cret-token-xyz"
MAX_BYTES = 5 * 1024 * 1024
FIXTURES = Path(__file__).parent / "fixtures"
SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "contract" / "ocr-result.schema.json").read_text(
        encoding="utf-8"
    )
)


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("PILOT_TOKEN", TOKEN)
    monkeypatch.setenv("OCR_ENGINE", "fake")


def make_event(body=b"\xff\xd8jpeg", token=TOKEN, content_type="image/jpeg", b64=True):
    headers = {}
    if token is not None:
        headers["x-pilot-token"] = token
    if content_type is not None:
        headers["content-type"] = content_type
    if body is not None and b64:
        body = base64.b64encode(body).decode()
    return {"headers": headers, "body": body, "isBase64Encoded": b64}


def call(event):
    resp = handler(event, None)
    return resp["statusCode"], json.loads(resp["body"])


def test_missing_token_401():
    status, body = call(make_event(token=None))
    assert status == 401 and body["error"]["code"] == "UNAUTHORIZED"


def test_wrong_token_401():
    assert call(make_event(token="nope"))[0] == 401


def test_empty_body_400():
    status, body = call(make_event(body=b""))
    assert status == 400 and body["error"]["code"] == "BAD_REQUEST"


def test_none_body_400():
    assert call(make_event(body=None))[0] == 400


def test_invalid_base64_400():
    event = make_event()
    event["body"] = "!!!not base64!!!"
    assert call(event)[0] == 400


def test_wrong_content_type_400():
    assert call(make_event(content_type="text/plain"))[0] == 400


def test_missing_content_type_400():
    assert call(make_event(content_type=None))[0] == 400


def test_content_type_with_charset_param_accepted():
    assert call(make_event(content_type="image/jpeg; charset=binary"))[0] == 200


def test_content_type_case_insensitive():
    assert call(make_event(content_type="Image/JPEG"))[0] == 200


def test_header_names_case_insensitive():
    event = make_event()
    event["headers"] = {"X-Pilot-Token": TOKEN, "Content-Type": "image/jpeg"}
    assert call(event)[0] == 200


def test_body_over_5mb_413():
    status, body = call(make_event(body=b"\xff" * (MAX_BYTES + 1)))
    assert status == 413 and body["error"]["code"] == "TOO_LARGE"


def test_body_exactly_5mb_accepted():
    assert call(make_event(body=b"\xff" * MAX_BYTES))[0] == 200


def test_success_returns_version_1_and_valid_schema():
    status, body = call(make_event())
    assert status == 200 and body["version"] == 1
    jsonschema.validate(body, SCHEMA)


@pytest.fixture
def stubbed_textract(monkeypatch):
    monkeypatch.setenv("OCR_ENGINE", "textract")
    with Stubber(textract_module._client) as stubber:
        yield stubber
        stubber.assert_no_pending_responses()


def test_textract_success_path(stubbed_textract):
    stubbed_textract.add_response(
        "detect_document_text", json.loads((FIXTURES / "mini.textract.json").read_text("utf-8"))
    )
    status, body = call(make_event())
    assert status == 200 and body["engine"] == "textract"
    assert [w["text"] for w in body["words"]] == ["Er", "hatte", "eine", "Idee"]


@pytest.mark.parametrize(
    ("aws_code", "status", "code"),
    [
        ("DocumentTooLargeException", 413, "TOO_LARGE"),
        ("UnsupportedDocumentException", 422, "UNREADABLE_IMAGE"),
        ("BadDocumentException", 422, "UNREADABLE_IMAGE"),
        ("InvalidParameterException", 422, "UNREADABLE_IMAGE"),
        ("ThrottlingException", 429, "BUSY"),
        ("ProvisionedThroughputExceededException", 429, "BUSY"),
        ("InternalServerError", 502, "OCR_FAILED"),
        ("AccessDeniedException", 502, "OCR_FAILED"),
    ],
)
def test_textract_errors_map_per_spec(stubbed_textract, aws_code, status, code):
    stubbed_textract.add_client_error("detect_document_text", service_error_code=aws_code)
    got_status, body = call(make_event())
    assert (got_status, body["error"]["code"]) == (status, code)


def test_connection_error_502(monkeypatch):
    monkeypatch.setenv("OCR_ENGINE", "textract")

    def boom(**kwargs):
        raise EndpointConnectionError(endpoint_url="https://textract.invalid")

    monkeypatch.setattr(textract_module._client, "detect_document_text", boom)
    status, body = call(make_event())
    assert status == 502 and body["error"]["code"] == "OCR_FAILED"


def test_unexpected_exception_500_internal(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(handler_module, "process_image", boom)
    status, body = call(make_event())
    assert status == 500 and body["error"]["code"] == "INTERNAL"
    assert "kaboom" not in body["error"]["message"]


def test_logs_never_contain_token_or_image_bytes(caplog):
    caplog.set_level(logging.DEBUG)
    call(make_event(body=b"\xff\xd8SECRETIMAGEBYTES"))
    call(make_event(token=TOKEN, content_type="text/plain"))
    assert TOKEN not in caplog.text
    assert "SECRETIMAGEBYTES" not in caplog.text
    assert base64.b64encode(b"\xff\xd8SECRETIMAGEBYTES").decode() not in caplog.text


def test_unexpected_error_is_logged_with_traceback_but_client_error_is_not(monkeypatch, caplog):
    def boom(*args, **kwargs):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(handler_module, "process_image", boom)
    caplog.set_level(logging.INFO)
    call(make_event())
    assert any(r.exc_info and r.levelno >= logging.ERROR for r in caplog.records)
    assert TOKEN not in caplog.text
    caplog.clear()
    call(make_event(token="nope"))
    assert not any(r.exc_info for r in caplog.records)
