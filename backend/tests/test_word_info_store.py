import json

import boto3
import pytest
from botocore.stub import Stubber

from readmate.wordinfo.store import (
    CACHE_TTL_S,
    COUNTER_TTL_S,
    DailyLimitReached,
    DynamoStore,
    LruCache,
    MemoryStore,
    StoreUnavailable,
)

NOW = 1_700_000_000
ALLOWED_ATTRS = {"pk", "response", "model", "promptVersion", "createdAt", "expiresAt"}


@pytest.fixture
def dynamo():
    client = boto3.client(
        "dynamodb",
        region_name="eu-central-1",
        aws_access_key_id="testing",
        aws_secret_access_key="testing",
    )
    with Stubber(client) as stubber:
        yield DynamoStore("t", client=client, now=lambda: NOW), stubber


def test_ttl_constants():
    assert CACHE_TTL_S == 90 * 86400
    assert COUNTER_TTL_S == 3 * 86400


def test_get_returns_decoded_response(dynamo):
    store, stubber = dynamo
    body = {"a": "ä", "b": [1, 2]}
    stubber.add_response(
        "get_item",
        {"Item": {"pk": {"S": "wi#k"}, "response": {"S": json.dumps(body)}}},
        {"TableName": "t", "Key": {"pk": {"S": "wi#k"}}},
    )
    assert store.get("k") == body
    stubber.assert_no_pending_responses()


def test_get_miss_returns_none(dynamo):
    store, stubber = dynamo
    stubber.add_response("get_item", {}, {"TableName": "t", "Key": {"pk": {"S": "wi#k"}}})
    assert store.get("k") is None


@pytest.mark.parametrize("raw", ["not json", "[1, 2]", '"str"', "null"])
def test_get_undecodable_item_is_a_miss(dynamo, raw):
    store, stubber = dynamo
    stubber.add_response(
        "get_item",
        {"Item": {"pk": {"S": "wi#k"}, "response": {"S": raw}}},
        {"TableName": "t", "Key": {"pk": {"S": "wi#k"}}},
    )
    assert store.get("k") is None


def test_get_item_without_response_attribute_is_a_miss(dynamo):
    store, stubber = dynamo
    stubber.add_response(
        "get_item",
        {"Item": {"pk": {"S": "wi#k"}}},
        {"TableName": "t", "Key": {"pk": {"S": "wi#k"}}},
    )
    assert store.get("k") is None


def test_get_client_error_is_store_unavailable(dynamo):
    store, stubber = dynamo
    stubber.add_client_error("get_item", "ProvisionedThroughputExceededException")
    with pytest.raises(StoreUnavailable):
        store.get("k")


def test_put_request_shape(dynamo):
    store, stubber = dynamo
    response = {"word": "Straße", "n": 1}
    stubber.add_response(
        "put_item",
        {},
        {
            "TableName": "t",
            "Item": {
                "pk": {"S": "wi#k"},
                "response": {"S": json.dumps(response, ensure_ascii=False, separators=(",", ":"))},
                "model": {"S": "m1"},
                "promptVersion": {"S": "v1"},
                "createdAt": {"N": "1700000000"},
                "expiresAt": {"N": "1707776000"},
            },
        },
    )
    store.put("k", response, "m1", "v1")
    stubber.assert_no_pending_responses()


def test_put_stores_only_allowed_attributes(dynamo):
    store, stubber = dynamo
    captured = {}

    def capture(params, **_):
        captured.update(params)

    client = store._client
    client.meta.events.register("provide-client-params.dynamodb.PutItem", capture)
    stubber.add_response("put_item", {})
    store.put("k", {"x": 1}, "m", "v")
    assert set(captured["Item"]) == ALLOWED_ATTRS
    assert set(captured["Item"]) <= ALLOWED_ATTRS


def test_put_client_error_is_store_unavailable(dynamo):
    store, stubber = dynamo
    stubber.add_client_error("put_item", "InternalServerError")
    with pytest.raises(StoreUnavailable):
        store.put("k", {}, "m", "v")


def _counter_params(cap):
    return {
        "TableName": "t",
        "Key": {"pk": {"S": "count#2023-11-14"}},
        "UpdateExpression": "ADD calls :one SET expiresAt = :exp",
        "ConditionExpression": "attribute_not_exists(calls) OR calls < :cap",
        "ExpressionAttributeValues": {
            ":one": {"N": "1"},
            ":cap": {"N": str(cap)},
            ":exp": {"N": "1700259200"},
        },
        "ReturnValues": "UPDATED_NEW",
    }


def test_increment_daily_returns_new_count(dynamo):
    store, stubber = dynamo
    stubber.add_response(
        "update_item",
        {"Attributes": {"calls": {"N": "7"}, "expiresAt": {"N": "1700259200"}}},
        _counter_params(500),
    )
    result = store.increment_daily(500)
    assert result == 7
    assert isinstance(result, int)


def test_increment_daily_conditional_failure_is_limit(dynamo):
    store, stubber = dynamo
    stubber.add_client_error("update_item", "ConditionalCheckFailedException")
    with pytest.raises(DailyLimitReached):
        store.increment_daily(500)


def test_increment_daily_other_error_is_store_unavailable(dynamo):
    store, stubber = dynamo
    stubber.add_client_error("update_item", "ProvisionedThroughputExceededException")
    with pytest.raises(StoreUnavailable):
        store.increment_daily(500)


def test_increment_daily_malformed_response_is_store_unavailable(dynamo):
    store, stubber = dynamo
    stubber.add_response("update_item", {}, _counter_params(500))
    with pytest.raises(StoreUnavailable):
        store.increment_daily(500)


def test_memory_store_roundtrip():
    store = MemoryStore(now=lambda: NOW)
    assert store.get("k") is None
    store.put("k", {"a": 1}, "m", "v")
    assert store.get("k") == {"a": 1}


def test_memory_store_counter_cap_and_day_reset():
    clock = [NOW]
    store = MemoryStore(now=lambda: clock[0])
    assert store.increment_daily(2) == 1
    assert store.increment_daily(2) == 2
    with pytest.raises(DailyLimitReached):
        store.increment_daily(2)
    clock[0] += 86400
    assert store.increment_daily(2) == 1


def test_lru_evicts_least_recently_used():
    lru = LruCache(2)
    lru.put("a", {"v": 1})
    lru.put("b", {"v": 2})
    assert lru.get("a") == {"v": 1}  # refreshes a
    lru.put("c", {"v": 3})  # evicts b
    assert lru.get("b") is None
    assert lru.get("a") == {"v": 1}
    assert lru.get("c") == {"v": 3}


def test_lru_put_existing_refreshes():
    lru = LruCache(2)
    lru.put("a", {"v": 1})
    lru.put("b", {"v": 2})
    lru.put("a", {"v": 9})  # refreshes a
    lru.put("c", {"v": 3})  # evicts b
    assert lru.get("b") is None
    assert lru.get("a") == {"v": 9}
