"""Word-info cache, in-process LRU and daily call counter.

Provider-neutral. Only the response JSON, model, prompt version and timestamps
are stored; the sentence and the words are never written.
"""

import json
import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from botocore.exceptions import BotoCoreError, ClientError

logger = logging.getLogger("readmate")

CACHE_TTL_S = 90 * 86400
COUNTER_TTL_S = 3 * 86400


class DailyLimitReached(Exception):  # noqa: N818 - name fixed by the plan
    pass


class StoreUnavailable(Exception):  # noqa: N818 - name fixed by the plan
    pass


class CacheStore(Protocol):
    def get(self, key: str) -> dict | None: ...

    def put(self, key: str, response: dict, model: str, prompt_version: str) -> None: ...

    def increment_daily(self, cap: int) -> int: ...


def _utc_date(ts: float) -> str:
    return datetime.fromtimestamp(ts, UTC).strftime("%Y-%m-%d")


class MemoryStore(CacheStore):
    def __init__(self, now: Callable[[], float] = time.time) -> None:
        self._now = now
        self._items: dict[str, dict] = {}
        self._counts: dict[str, int] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> dict | None:
        with self._lock:
            return self._items.get(key)

    def put(self, key: str, response: dict, model: str, prompt_version: str) -> None:
        with self._lock:
            self._items[key] = response

    def increment_daily(self, cap: int) -> int:
        day = _utc_date(self._now())
        with self._lock:
            count = self._counts.get(day, 0)
            if count >= cap:
                raise DailyLimitReached
            self._counts[day] = count + 1
            return count + 1


class DynamoStore(CacheStore):
    def __init__(self, table: str, client=None, now: Callable[[], float] = time.time) -> None:
        if client is None:
            import boto3

            client = boto3.client("dynamodb")
        self._table = table
        self._client = client
        self._now = now

    def get(self, key: str) -> dict | None:
        failed = False
        item = None
        try:
            item = self._client.get_item(
                TableName=self._table, Key={"pk": {"S": f"wi#{key}"}}
            ).get("Item")
        except (ClientError, BotoCoreError):
            failed = True
        if failed:
            raise StoreUnavailable from None
        if not item:
            return None
        # A stored value that does not decode to a JSON object is treated as a
        # miss; the next successful put overwrites it.
        try:
            decoded = json.loads(item["response"]["S"])
        except (KeyError, TypeError, ValueError):
            logger.warning("word-info cache item undecodable; treating as miss")
            return None
        if not isinstance(decoded, dict):
            logger.warning("word-info cache item is not an object; treating as miss")
            return None
        return decoded

    def put(self, key: str, response: dict, model: str, prompt_version: str) -> None:
        now = int(self._now())
        body = json.dumps(response, ensure_ascii=False, separators=(",", ":"))
        failed = False
        try:
            self._client.put_item(
                TableName=self._table,
                Item={
                    "pk": {"S": f"wi#{key}"},
                    "response": {"S": body},
                    "model": {"S": model},
                    "promptVersion": {"S": prompt_version},
                    "createdAt": {"N": str(now)},
                    "expiresAt": {"N": str(now + CACHE_TTL_S)},
                },
            )
        except (ClientError, BotoCoreError):
            failed = True
        if failed:
            raise StoreUnavailable from None

    def increment_daily(self, cap: int) -> int:
        if cap <= 0:
            raise DailyLimitReached
        now = int(self._now())
        limit = False
        failed = False
        result = None
        try:
            result = self._client.update_item(
                TableName=self._table,
                Key={"pk": {"S": f"count#{_utc_date(now)}"}},
                UpdateExpression="ADD calls :one SET expiresAt = :exp",
                ConditionExpression="attribute_not_exists(calls) OR calls < :cap",
                ExpressionAttributeValues={
                    ":one": {"N": "1"},
                    ":cap": {"N": str(cap)},
                    ":exp": {"N": str(now + COUNTER_TTL_S)},
                },
                ReturnValues="UPDATED_NEW",
            )
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
                limit = True
            else:
                failed = True
        except BotoCoreError:
            failed = True
        if limit:
            raise DailyLimitReached from None
        if failed:
            raise StoreUnavailable from None
        try:
            return int(result["Attributes"]["calls"]["N"])
        except (KeyError, TypeError, ValueError):
            raise StoreUnavailable from None


class LruCache:
    def __init__(self, maxsize: int = 256) -> None:
        self._maxsize = maxsize
        self._items: OrderedDict[str, dict] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> dict | None:
        with self._lock:
            if key not in self._items:
                return None
            self._items.move_to_end(key)
            return self._items[key]

    def put(self, key: str, value: dict) -> None:
        with self._lock:
            self._items[key] = value
            self._items.move_to_end(key)
            while len(self._items) > self._maxsize:
                self._items.popitem(last=False)
