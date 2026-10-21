import logging

import boto3
import pytest
from botocore.stub import Stubber

from readmate.wordinfo import secrets
from readmate.wordinfo.secrets import SecretUnavailable, get_api_key

PARAM = "/readmate/anthropic-api-key"
VALUE = "sk-test-VALUE-123"
EXPECTED_PARAMS = {"Name": PARAM, "WithDecryption": True}


@pytest.fixture(autouse=True)
def _fresh():
    secrets._reset_for_tests()
    yield
    secrets._reset_for_tests()


def make_client():
    client = boto3.client(
        "ssm",
        region_name="eu-central-1",
        aws_access_key_id="x",
        aws_secret_access_key="x",
    )
    return client, Stubber(client)


def ok_response(value=VALUE):
    return {"Parameter": {"Name": PARAM, "Type": "SecureString", "Value": value}}


def assert_clean(exc, caplog):
    assert str(exc.value) == "api key unavailable"
    assert exc.value.__cause__ is None
    assert exc.value.__context__ is None
    assert exc.value.__suppress_context__ is True
    assert VALUE not in str(exc.value)
    assert VALUE not in caplog.text


def test_not_matching_real_key_prefix():
    assert not VALUE.startswith("sk-ant-")


def test_success_is_fetched_once_then_cached(caplog):
    client, stub = make_client()
    stub.add_response("get_parameter", ok_response(), EXPECTED_PARAMS)
    with stub, caplog.at_level(logging.DEBUG):
        assert get_api_key(PARAM, client) == VALUE
        assert get_api_key(PARAM, client) == VALUE
        stub.assert_no_pending_responses()
    assert VALUE not in caplog.text


def test_parameter_not_found_then_later_success(caplog):
    client, stub = make_client()
    stub.add_client_error("get_parameter", "ParameterNotFound", expected_params=EXPECTED_PARAMS)
    stub.add_response("get_parameter", ok_response(), EXPECTED_PARAMS)
    with stub, caplog.at_level(logging.DEBUG):
        with pytest.raises(SecretUnavailable) as exc:
            get_api_key(PARAM, client)
        assert_clean(exc, caplog)
        assert get_api_key(PARAM, client) == VALUE
    assert VALUE not in caplog.text


def test_access_denied(caplog):
    client, stub = make_client()
    stub.add_client_error(
        "get_parameter",
        "AccessDeniedException",
        service_message=f"denied {VALUE}",
        expected_params=EXPECTED_PARAMS,
    )
    with stub, caplog.at_level(logging.DEBUG):
        with pytest.raises(SecretUnavailable) as exc:
            get_api_key(PARAM, client)
    assert_clean(exc, caplog)
    assert exc.value.__context__ is None


@pytest.mark.parametrize("value", ["", "   "])
def test_empty_value(value, caplog):
    client, stub = make_client()
    stub.add_response("get_parameter", ok_response(value), EXPECTED_PARAMS)
    with stub, caplog.at_level(logging.DEBUG):
        with pytest.raises(SecretUnavailable) as exc:
            get_api_key(PARAM, client)
    assert_clean(exc, caplog)
    assert secrets._cached is None


def test_botocore_error(caplog):
    from botocore.exceptions import EndpointConnectionError

    class Broken:
        def get_parameter(self, **kwargs):
            raise EndpointConnectionError(endpoint_url=f"https://x/{VALUE}")

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(SecretUnavailable) as exc:
            get_api_key(PARAM, Broken())
    assert_clean(exc, caplog)


def test_malformed_response(caplog):
    class Odd:
        def get_parameter(self, **kwargs):
            return {"Parameter": {}}

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(SecretUnavailable) as exc:
            get_api_key(PARAM, Odd())
    assert_clean(exc, caplog)


def test_failure_logs_only_a_fixed_message(caplog):
    client, stub = make_client()
    stub.add_client_error("get_parameter", "ParameterNotFound", expected_params=EXPECTED_PARAMS)
    with stub, caplog.at_level(logging.DEBUG):
        with pytest.raises(SecretUnavailable):
            get_api_key(PARAM, client)
    assert "ParameterNotFound" in caplog.text
