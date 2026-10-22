"""Lazy, in-memory loading of the Anthropic API key from SSM Parameter Store.

The key is never logged, never placed in an exception message and never returned
to callers other than the engine that needs it.
"""

import logging
import threading

from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger("readmate")

_MESSAGE = "api key unavailable"
_cached: str | None = None
_lock = threading.Lock()


class SecretUnavailable(Exception):  # noqa: N818 - name fixed by the plan
    def __init__(self) -> None:
        super().__init__(_MESSAGE)


def _reset_for_tests() -> None:
    global _cached
    _cached = None


def get_api_key(param_name: str, client=None) -> str:
    global _cached
    if _cached is not None:
        return _cached
    with _lock:
        if _cached is not None:
            return _cached
        value = _fetch(param_name, client)
        _cached = value
        return value


def _fetch(param_name: str, client) -> str:
    # Failures are recorded as a fixed reason and raised outside the except
    # blocks, so the original exception never lands in __context__.
    reason = None
    value = None
    try:
        if client is None:
            import boto3

            client = boto3.client("ssm")
        response = client.get_parameter(Name=param_name, WithDecryption=True)
        value = response["Parameter"]["Value"]
    except ClientError as err:
        reason = str(err.response.get("Error", {}).get("Code", "unknown"))[:64]
    except BotoCoreError as err:
        reason = type(err).__name__
    except (KeyError, TypeError):
        reason = "malformed response"
    if reason is None and (not isinstance(value, str) or not value.strip()):
        reason = "empty value"
    if reason is not None:
        logger.warning("word-info api key lookup failed: %s", reason)
        raise SecretUnavailable from None
    return value.strip()
