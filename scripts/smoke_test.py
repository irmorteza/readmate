"""Post-deploy smoke checks for ReadMate (stdlib only, so CI needs no install).

Usage:
    python scripts/smoke_test.py --api-url https://x.lambda-url.../ \
        --frontend-origin https://staging.xxx.amplifyapp.com --sha <commit sha>

Exits 0 when every check passes, 1 otherwise (failures go to stderr).
"""

import argparse
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlparse

BAD_TOKEN = "smoke-test-invalid"
ASSET_RE = re.compile(r"""/assets/[^"'\s>]+\.js""")


class CheckError(Exception):
    pass


def _request(
    url: str,
    *,
    method: str = "GET",
    data: bytes | None = None,
    headers=None,
    timeout: float,
) -> tuple[int, bytes, dict[str, str]]:
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as err:
        return err.code, err.read(), dict(err.headers)
    except (urllib.error.URLError, OSError, ValueError) as err:
        raise CheckError(f"{method} {url} failed: {err}") from err


def _check_backend(api_url: str, frontend_origin: str, timeout: float) -> list[str]:
    url = api_url.rstrip("/") + "/ocr"
    try:
        status, _, _ = _request(
            url,
            method="POST",
            data=b"smoke",
            headers={"X-Pilot-Token": BAD_TOKEN, "Content-Type": "image/jpeg"},
            timeout=timeout,
        )
    except CheckError as err:
        return [f"backend unreachable: {err}"]
    if status != 401:
        return [f"backend auth check: expected HTTP 401 for a bad token, got {status}"]
    return _check_cors(url, frontend_origin.rstrip("/"), timeout)


def _check_cors(url: str, origin: str, timeout: float) -> list[str]:
    """The browser's preflight must be answered for the deployed frontend's origin."""
    try:
        _, _, headers = _request(
            url,
            method="OPTIONS",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-pilot-token",
            },
            timeout=timeout,
        )
    except CheckError as err:
        return [f"backend CORS preflight failed: {err}"]
    allowed = {k.lower(): v for k, v in headers.items()}.get(
        "access-control-allow-origin"
    )
    if allowed != origin:
        message = (
            f"CORS: backend does not allow origin {origin} "
            f"(Access-Control-Allow-Origin was {allowed!r}); the app would be blocked in the browser"
        )
        return [message]
    return []


def _check_frontend(api_url: str, origin: str, sha: str, timeout: float) -> list[str]:
    origin = origin.rstrip("/")
    try:
        status, body, _ = _request(origin + "/", timeout=timeout)
    except CheckError as err:
        return [f"frontend unreachable: {err}"]
    if status != 200:
        return [f"frontend GET {origin}/ returned {status}, expected 200"]
    failures = []
    html = body.decode("utf-8", errors="replace")
    if "<title>ReadMate" not in html:
        failures.append("frontend page title is not 'ReadMate'")
    match = ASSET_RE.search(html)
    if not match:
        return failures + [
            "frontend page links no /assets/*.js bundle (broken zip layout?)"
        ]
    asset = match.group(0)
    try:
        status, js_bytes, _ = _request(origin + asset, timeout=timeout)
    except CheckError as err:
        return failures + [f"frontend asset unreachable: {err}"]
    if status != 200:
        return failures + [f"frontend asset {asset} returned {status}, expected 200"]
    js = js_bytes.decode("utf-8", errors="replace")
    api_host = urlparse(api_url).netloc
    if api_host not in js:
        failures.append(
            f"bundle does not contain the current API host {api_host} "
            "(built against a stale backend URL?)"
        )
    if sha[:7] not in js:
        failures.append(
            f"bundle does not contain the commit SHA {sha[:7]} (stale or wrong build?)"
        )
    return failures


def run_checks(
    api_url: str, frontend_origin: str, sha: str, timeout: float = 15.0
) -> list[str]:
    """Run every check; returns failure messages (empty list means all passed)."""
    return _check_backend(api_url, frontend_origin, timeout) + _check_frontend(
        api_url, frontend_origin, sha, timeout
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--api-url", required=True)
    parser.add_argument("--frontend-origin", required=True)
    parser.add_argument("--sha", required=True)
    args = parser.parse_args(argv)
    failures = run_checks(args.api_url, args.frontend_origin, args.sha)
    for failure in failures:
        print(f"FAIL: {failure}", file=sys.stderr)
    if failures:
        return 1
    print("smoke test passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
