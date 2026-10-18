import socket
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import smoke_test  # noqa: E402

SHA = "0123456789abcdef0123456789abcdef01234567"
ASSET = "/assets/index-abc123.js"


class Site:
    """A throwaway local server whose routes can be changed per test."""

    def __init__(self, routes=None, post_status=401):
        self.routes = routes or {}
        self.post_status = post_status
        self.requests = []
        self.preflights = []
        # None echoes the request's Origin (a correctly configured Function URL);
        # a string forces that value; "" sends no Access-Control-Allow-Origin header.
        self.cors_origin = None
        site = self

        class Handler(BaseHTTPRequestHandler):
            def _send(self, status, body=b""):
                self.send_response(status)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                status, body = site.routes.get(self.path, (404, b"not found"))
                self._send(status, body if isinstance(body, bytes) else body.encode())

            def do_OPTIONS(self):
                site.preflights.append((self.path, dict(self.headers)))
                allow = site.cors_origin
                if allow is None:
                    allow = self.headers.get("Origin", "")
                self.send_response(204)
                if allow:
                    self.send_header("Access-Control-Allow-Origin", allow)
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_POST(self):
                length = int(self.headers.get("Content-Length") or 0)
                site.requests.append((self.path, dict(self.headers), self.rfile.read(length)))
                self._send(site.post_status, b'{"error": {"code": "UNAUTHORIZED"}}')

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    @property
    def host(self) -> str:
        return urlparse(self.url).netloc

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def good_frontend(api_host: str, sha: str = SHA, title: str = "<title>ReadMate</title>") -> Site:
    html = f'<html><head>{title}<script src="{ASSET}"></script></head><body></body></html>'
    js = f'const api="https://{api_host}/";const v="{sha}";'
    return Site({"/": (200, html), ASSET: (200, js)})


@pytest.fixture
def sites():
    created = []

    def make(site):
        created.append(site)
        return site

    yield make
    for site in created:
        site.close()


def run(backend, frontend, **kw):
    return smoke_test.run_checks(backend.url + "/", frontend.url, SHA, timeout=3.0, **kw)


def test_all_checks_pass_returns_no_failures(sites):
    backend = sites(Site())
    frontend = sites(good_frontend(backend.host))
    assert run(backend, frontend) == []
    path, headers, body = backend.requests[0]
    assert path == "/ocr"
    assert headers["X-Pilot-Token"] == "smoke-test-invalid"
    assert headers["Content-Type"] == "image/jpeg"
    assert body == b"smoke"


def test_backend_not_401_is_reported(sites):
    backend = sites(Site(post_status=200))
    frontend = sites(good_frontend(backend.host))
    failures = run(backend, frontend)
    assert len(failures) == 1 and "401" in failures[0]


def test_backend_unreachable_is_reported_not_raised(sites):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        dead_port = s.getsockname()[1]
    frontend = sites(good_frontend(f"127.0.0.1:{dead_port}"))
    failures = smoke_test.run_checks(
        f"http://127.0.0.1:{dead_port}/", frontend.url, SHA, timeout=2.0
    )
    assert any("backend" in f.lower() for f in failures)


def test_frontend_unreachable_is_reported_not_raised(sites):
    backend = sites(Site())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        dead_port = s.getsockname()[1]
    failures = smoke_test.run_checks(
        backend.url + "/", f"http://127.0.0.1:{dead_port}", SHA, timeout=2.0
    )
    assert any("frontend" in f.lower() for f in failures)


def test_wrong_title_is_reported(sites):
    backend = sites(Site())
    frontend = sites(good_frontend(backend.host, title="<title>Something else</title>"))
    assert any("title" in f.lower() for f in run(backend, frontend))


def test_missing_asset_link_is_reported(sites):
    backend = sites(Site())
    frontend = sites(Site({"/": (200, "<html><title>ReadMate</title></html>")}))
    assert any("asset" in f.lower() for f in run(backend, frontend))


def test_asset_404_is_reported(sites):
    backend = sites(Site())
    frontend = sites(Site({"/": (200, f'<title>ReadMate</title><script src="{ASSET}"></script>')}))
    assert any(ASSET in f for f in run(backend, frontend))


def test_stale_backend_url_in_bundle_is_reported(sites):
    backend = sites(Site())
    frontend = sites(good_frontend("old-function.lambda-url.eu-central-1.on.aws"))
    failures = run(backend, frontend)
    assert any("api" in f.lower() and backend.host in f for f in failures)


def test_missing_sha_in_bundle_is_reported(sites):
    backend = sites(Site())
    frontend = sites(good_frontend(backend.host, sha="deadbeef" * 5))
    assert any(SHA[:7] in f for f in run(backend, frontend))


def test_trailing_slash_variants_are_tolerated(sites):
    backend = sites(Site())
    frontend = sites(good_frontend(backend.host))
    for api in (backend.url, backend.url + "/"):
        for origin in (frontend.url, frontend.url + "/"):
            assert smoke_test.run_checks(api, origin, SHA, timeout=3.0) == []


def test_main_returns_0_when_ok(sites, capsys):
    backend = sites(Site())
    frontend = sites(good_frontend(backend.host))
    code = smoke_test.main(
        ["--api-url", backend.url + "/", "--frontend-origin", frontend.url, "--sha", SHA]
    )
    assert code == 0
    assert "smoke test passed" in capsys.readouterr().out


def test_main_returns_1_and_prints_failures_to_stderr(sites, capsys):
    backend = sites(Site(post_status=200))
    frontend = sites(good_frontend(backend.host))
    code = smoke_test.main(
        ["--api-url", backend.url + "/", "--frontend-origin", frontend.url, "--sha", SHA]
    )
    captured = capsys.readouterr()
    assert code == 1
    assert "401" in captured.err
    assert "smoke test passed" not in captured.out


def test_cors_preflight_asks_for_the_frontend_origin_method_and_headers(sites):
    backend = sites(Site())
    frontend = sites(good_frontend(backend.host))
    assert run(backend, frontend) == []
    path, headers = backend.preflights[0]
    assert path == "/ocr"
    assert headers["Origin"] == frontend.url  # no trailing slash
    assert headers["Access-Control-Request-Method"] == "POST"
    assert headers["Access-Control-Request-Headers"].lower() == "content-type,x-pilot-token"


def test_cors_not_allowing_the_frontend_origin_is_reported(sites):
    backend = sites(Site())
    backend.cors_origin = "https://some-other-site.example"
    frontend = sites(good_frontend(backend.host))
    failures = run(backend, frontend)
    assert len(failures) == 1
    assert "CORS" in failures[0] and frontend.url in failures[0]


def test_cors_header_missing_is_reported(sites):
    backend = sites(Site())
    backend.cors_origin = ""
    frontend = sites(good_frontend(backend.host))
    assert any("CORS" in f for f in run(backend, frontend))


def test_cors_check_normalizes_a_trailing_slash_on_the_origin(sites):
    backend = sites(Site())
    frontend = sites(good_frontend(backend.host))
    assert smoke_test.run_checks(backend.url, frontend.url + "/", SHA, timeout=3.0) == []
    assert backend.preflights[0][1]["Origin"] == frontend.url
