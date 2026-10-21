import json
import threading
import urllib.error
import urllib.request

import pytest
from dev_server import make_server

from helpers import GOLDEN_REQUEST

ORIGIN = "http://localhost:5173"


@pytest.fixture
def base_url(monkeypatch):
    monkeypatch.setenv("OCR_ENGINE", "fake")
    monkeypatch.setenv("PILOT_TOKEN", "dev")
    server = make_server(0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def request(url, method, data=None, headers=None):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def test_options_returns_cors_headers(base_url):
    status, headers, _ = request(base_url + "/ocr", "OPTIONS", headers={"Origin": ORIGIN})
    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Access-Control-Allow-Methods"] == "POST"
    assert headers["Access-Control-Allow-Headers"].lower() == "content-type, x-pilot-token"


def test_post_ocr_returns_json_result(base_url):
    status, headers, body = request(
        base_url + "/ocr",
        "POST",
        data=b"\xff\xd8jpeg",
        headers={"Content-Type": "image/jpeg", "X-Pilot-Token": "dev", "Origin": ORIGIN},
    )
    assert status == 200
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert json.loads(body)["version"] == 1


def test_wrong_token_passes_through_401_with_cors(base_url):
    status, headers, _ = request(
        base_url + "/ocr",
        "POST",
        data=b"x",
        headers={"Content-Type": "image/jpeg", "X-Pilot-Token": "bad"},
    )
    assert status == 401
    assert headers["Access-Control-Allow-Origin"] == ORIGIN


def test_unknown_path_404(base_url):
    status, _, _ = request(base_url + "/nope", "POST", data=b"x")
    assert status == 404


def test_post_word_info_returns_fake_result(base_url):
    status, headers, body = request(
        base_url + "/v1/word-info",
        "POST",
        data=json.dumps(GOLDEN_REQUEST).encode(),
        headers={"Content-Type": "application/json", "X-Pilot-Token": "dev", "Origin": ORIGIN},
    )
    assert status == 200
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert json.loads(body)["meta"]["model"] == "fake"


def test_options_word_info_returns_cors_headers(base_url):
    status, headers, _ = request(base_url + "/v1/word-info", "OPTIONS", headers={"Origin": ORIGIN})
    assert status == 204
    assert headers["Access-Control-Allow-Origin"] == ORIGIN
    assert headers["Access-Control-Allow-Methods"] == "POST"
    assert headers["Access-Control-Allow-Headers"].lower() == "content-type, x-pilot-token"


def test_post_other_path_404(base_url):
    status, _, _ = request(base_url + "/other", "POST", data=b"{}")
    assert status == 404
