#!/usr/bin/env python3
"""Local static server with same-origin btcnodes.io proxy (mirrors server.js)."""

from __future__ import annotations

import argparse
import http.client
import http.server
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BTCNODES_API = "https://btcnodes.io/api"
BTCNODES_PROXY_PREFIX = "/api/btcnodes"

XR_HEADERS = {
    "Permissions-Policy": "xr-spatial-tracking=(*)",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
}


class ExplorerHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        for key, value in XR_HEADERS.items():
            self.send_header(key, value)
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?", 1)[0].startswith(BTCNODES_PROXY_PREFIX):
            self.proxy_btcnodes()
            return
        super().do_GET()

    def do_HEAD(self):
        if self.path.split("?", 1)[0].startswith(BTCNODES_PROXY_PREFIX):
            self.proxy_btcnodes(head_only=True)
            return
        super().do_HEAD()

    def proxy_btcnodes(self, head_only: bool = False):
        path = self.path
        suffix = path[len(BTCNODES_PROXY_PREFIX) :]
        if not suffix.startswith("/"):
            suffix = "/" + suffix
        target = BTCNODES_API + suffix

        req = urllib.request.Request(
            target,
            method="HEAD" if head_only else "GET",
            headers={
                "Accept": self.headers.get("Accept", "application/json"),
                "User-Agent": "bitcoinanatomy-explorer-local",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context()) as upstream:
                body = b"" if head_only else upstream.read()
                self.send_response(upstream.status)
                content_type = upstream.headers.get("Content-Type", "application/json")
                self.send_header("Content-Type", content_type)
                if not head_only:
                    self.send_header("Content-Length", str(len(body)))
                for header in ("ratelimit-remaining", "retry-after"):
                    value = upstream.headers.get(header)
                    if value is not None:
                        self.send_header(header, value)
                self.end_headers()
                if not head_only:
                    self.wfile.write(body)
        except urllib.error.HTTPError as err:
            body = err.read()
            self.send_response(err.code)
            self.send_header("Content-Type", err.headers.get("Content-Type", "application/json"))
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as err:
            payload = f'{{"error":"btcnodes proxy failed","detail":"{err}"}}'.encode()
            self.send_response(http.client.BAD_GATEWAY)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            print(f"[btcnodes proxy] {err}", file=sys.stderr)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


def main():
    parser = argparse.ArgumentParser(description="Serve explorer with btcnodes proxy")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = http.server.ThreadingHTTPServer((args.host, args.port), ExplorerHandler)
    print(f"HTTP server: http://{args.host}:{args.port}/")
    print(f"Open  http://{args.host}:{args.port}/network.html")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.server_close()


if __name__ == "__main__":
    main()
