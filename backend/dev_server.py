"""Local development server wrapping the Lambda handler (port 3000, fake OCR by default).

Run from backend/:  .venv/Scripts/python dev_server.py
"""

import base64
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from readmate.handler import handler  # noqa: E402

ALLOWED_ORIGIN = "http://localhost:5173"


class DevRequestHandler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST")
        self.send_header("Access-Control-Allow-Headers", "content-type, x-pilot-token")
        self.send_header("Access-Control-Max-Age", "600")

    def _send(self, status: int, body: bytes = b"", content_type: str = "application/json") -> None:
        self.send_response(status)
        self._cors()
        if body:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self._send(204)

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        if self.path != "/ocr":
            self._send(
                404, json.dumps({"error": {"code": "NOT_FOUND", "message": "Not found"}}).encode()
            )
            return
        event = {
            "headers": {k.lower(): v for k, v in self.headers.items()},
            "body": base64.b64encode(raw).decode(),
            "isBase64Encoded": True,
        }
        response = handler(event, None)
        self._send(response["statusCode"], response["body"].encode("utf-8"))

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print(f"[dev_server] {self.address_string()} {format % args}")


def make_server(port: int = 3000) -> HTTPServer:
    return ThreadingHTTPServer(("127.0.0.1", port), DevRequestHandler)


if __name__ == "__main__":
    os.environ.setdefault("OCR_ENGINE", "fake")
    os.environ.setdefault("PILOT_TOKEN", "dev")
    os.environ.setdefault("AWS_DEFAULT_REGION", "eu-central-1")
    port = int(os.environ.get("DEV_PORT", "3000"))
    server = make_server(port)
    print(f"dev server on http://localhost:{port} (OCR_ENGINE={os.environ['OCR_ENGINE']})")
    server.serve_forever()
