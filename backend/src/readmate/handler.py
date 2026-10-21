"""AWS Lambda entry point (Function URL, payload v2). No business logic lives here."""

import base64
import binascii
import hmac
import json
import logging
import os
import time
from collections.abc import Callable

from botocore.exceptions import BotoCoreError, ClientError

from readmate.core.process_image import process_image
from readmate.engines.base import OcrEngine
from readmate.engines.fake import FakeEngine
from readmate.engines.textract import TextractEngine
from readmate.wordinfo.request import BadRequest, parse_request
from readmate.wordinfo.service import WordInfoError, WordInfoService, service_from_env

logger = logging.getLogger("readmate")
logger.setLevel(logging.INFO)

MAX_BYTES = 5 * 1024 * 1024
WORD_INFO_PATH = "/v1/word-info"
DEFAULT_REMAINING_MS = 15_000

_word_info_service: WordInfoService | None = None

_TOO_LARGE = {"DocumentTooLargeException"}
_UNREADABLE = {"UnsupportedDocumentException", "BadDocumentException", "InvalidParameterException"}
_BUSY = {"ThrottlingException", "ProvisionedThroughputExceededException"}


class HttpError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def map_error(exc: Exception) -> tuple[int, str, str]:
    if isinstance(exc, HttpError):
        return exc.status, exc.code, exc.message
    if isinstance(exc, WordInfoError):
        return exc.status, exc.code, exc.message
    if isinstance(exc, BadRequest):
        return 400, "BAD_REQUEST", exc.message
    if isinstance(exc, ClientError):
        aws_code = exc.response.get("Error", {}).get("Code", "")
        if aws_code in _TOO_LARGE:
            return 413, "TOO_LARGE", "Image is too large."
        if aws_code in _UNREADABLE:
            return 422, "UNREADABLE_IMAGE", "The image could not be read."
        if aws_code in _BUSY:
            return 429, "BUSY", "Service busy, try again in a moment."
        return 502, "OCR_FAILED", "Text recognition failed."
    if isinstance(exc, (BotoCoreError, ConnectionError)):
        return 502, "OCR_FAILED", "Text recognition failed."
    return 500, "INTERNAL", "Internal error."


def _response(status: int, payload: dict) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(payload, ensure_ascii=False),
    }


def _pick_engine() -> OcrEngine:
    return FakeEngine() if os.environ.get("OCR_ENGINE", "textract") == "fake" else TextractEngine()


def _authorize(headers: dict[str, str]) -> None:
    expected = os.environ.get("PILOT_TOKEN", "")
    given = headers.get("x-pilot-token", "")
    if not expected or not hmac.compare_digest(given.encode(), expected.encode()):
        raise HttpError(401, "UNAUTHORIZED", "Missing or wrong token.")


def _decode_body(event: dict, headers: dict[str, str]) -> bytes:
    content_type = headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "image/jpeg":
        raise HttpError(400, "BAD_REQUEST", "Content-Type must be image/jpeg.")
    body = event.get("body")
    if not body or not event.get("isBase64Encoded"):
        raise HttpError(400, "BAD_REQUEST", "Missing or empty body.")
    try:
        data = base64.b64decode(body, validate=True)
    except (binascii.Error, ValueError):
        raise HttpError(400, "BAD_REQUEST", "Body is not valid base64.") from None
    if not data:
        raise HttpError(400, "BAD_REQUEST", "Missing or empty body.")
    if len(data) > MAX_BYTES:
        raise HttpError(413, "TOO_LARGE", "Image is larger than 5 MB.")
    return data


def _get_word_info_service() -> WordInfoService:
    global _word_info_service
    if _word_info_service is None:
        _word_info_service = service_from_env(os.environ)
    return _word_info_service


def _reset_word_info_service() -> None:
    global _word_info_service
    _word_info_service = None


def _remaining_ms(context: object) -> Callable[[], int]:
    getter = getattr(context, "get_remaining_time_in_millis", None)
    if getter is None:
        return lambda: DEFAULT_REMAINING_MS
    return getter


def _decode_json_body(event: dict) -> bytes:
    body = event.get("body")
    if body is None:
        raise HttpError(400, "BAD_REQUEST", "Missing or empty body.")
    if event.get("isBase64Encoded"):
        try:
            return base64.b64decode(body, validate=True)
        except (binascii.Error, ValueError):
            raise HttpError(400, "BAD_REQUEST", "Body is not valid base64.") from None
    return body.encode("utf-8")


def _word_info(event: dict, context: object) -> dict:
    started = time.monotonic()
    request_id = getattr(context, "aws_request_id", "-")
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    _authorize(headers)
    method = (event.get("requestContext") or {}).get("http", {}).get("method", "POST")
    if method != "POST":
        raise HttpError(405, "METHOD_NOT_ALLOWED", "Use POST.")
    content_type = headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type != "application/json":
        raise HttpError(400, "BAD_REQUEST", "Content-Type must be application/json.")
    req = parse_request(_decode_json_body(event))
    result = _get_word_info_service().lookup(req, _remaining_ms(context))
    logger.info(
        "ok request_id=%s route=word-info ms=%d cached=%s",
        request_id,
        (time.monotonic() - started) * 1000,
        result["meta"]["cached"],
    )
    return _response(200, result)


def _ocr(event: dict, context: object) -> dict:
    request_id = getattr(context, "aws_request_id", "-")
    started = time.monotonic()
    headers = {k.lower(): v for k, v in (event.get("headers") or {}).items()}
    _authorize(headers)
    image = _decode_body(event, headers)
    result = process_image(image, _pick_engine())
    logger.info(
        "ok request_id=%s ms=%d boxes=%d words=%d",
        request_id,
        (time.monotonic() - started) * 1000,
        len(result["boxes"]),
        len(result["words"]),
    )
    return _response(200, result)


def handler(event: dict, context: object) -> dict:
    request_id = getattr(context, "aws_request_id", "-")
    is_word_info = event.get("rawPath") == WORD_INFO_PATH
    try:
        return _word_info(event, context) if is_word_info else _ocr(event, context)
    except Exception as exc:
        status, code, message = map_error(exc)
        extra = exc.extra if isinstance(exc, WordInfoError) and exc.extra else {}
        logger.log(
            logging.WARNING if status < 500 else logging.ERROR,
            "error request_id=%s%s code=%s type=%s",
            request_id,
            " route=word-info" if is_word_info else "",
            code,
            type(exc).__name__,
            exc_info=exc if status >= 500 else None,
        )
        return _response(status, {"error": {"code": code, "message": message, **extra}})
