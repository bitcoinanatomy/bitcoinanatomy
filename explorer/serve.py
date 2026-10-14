#!/usr/bin/env python3
"""Local static server with same-origin btcnodes.io proxy (mirrors server.js)."""

from __future__ import annotations

import argparse
import http.client
import http.server
import json
import os
import signal
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BTCNODES_API = "https://btcnodes.io/api"
BTCNODES_PROXY_PREFIX = "/api/btcnodes"
ARCHIVE_FILES = {
    "/api/addrman": ROOT / "data" / "btc_nodes.json",
    "/api/bitnodes-archive": ROOT / "cache" / "bitnodes_geo_cache.json",
}
CRAWLER_SCRIPT = ROOT / "scripts" / "crawler.py"
CRAWLER_STATUS = ROOT / "cache" / "crawler_status.json"
CRAWLER_OUT = ROOT / "data" / "btc_nodes.json"
EPOCH_SCRIPT = ROOT / "scripts" / "epoch_indexer.py"
EPOCH_STATUS = ROOT / "cache" / "epoch_status.json"
EPOCH_OUT = ROOT / "data" / "difficulty_epochs"
_crawler_proc = None
_crawler_lock = threading.Lock()
_epoch_proc = None
_epoch_lock = threading.Lock()

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
        path_only = self.path.split("?", 1)[0]
        if path_only == "/api/crawler":
            self.send_json(200, crawler_status())
            return
        if path_only == "/api/epoch":
            self.send_json(200, epoch_status())
            return
        archive = ARCHIVE_FILES.get(path_only)
        if archive is not None:
            self.send_archive(archive)
            return
        if path_only.startswith(BTCNODES_PROXY_PREFIX):
            self.proxy_btcnodes()
            return
        super().do_GET()

    def do_POST(self):
        path_only = self.path.split("?", 1)[0]
        controls = ("/api/crawler/start", "/api/crawler/stop", "/api/epoch/start", "/api/epoch/stop")
        if path_only not in controls:
            self.send_json(404, {"error": "not found"})
            return
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            self.send_json(403, {"error": "controls are localhost only"})
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except json.JSONDecodeError:
            body = {}
        if path_only == "/api/crawler/start":
            self.send_json(200, crawler_start(body))
        elif path_only == "/api/crawler/stop":
            self.send_json(200, crawler_stop())
        elif path_only == "/api/epoch/start":
            self.send_json(200, epoch_start(body))
        else:
            self.send_json(200, epoch_stop())

    def send_json(self, code: int, doc: dict):
        payload = json.dumps(doc).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_archive(self, file_path: Path):
        if not file_path.is_file():
            payload = b'{"error":"archive not found","detail":"Run explorer/scripts/crawler.py to write cache/btc_nodes.json"}'
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

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


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def archive_breakdown() -> dict:
    if not CRAWLER_OUT.is_file():
        return {}
    try:
        archive = json.loads(CRAWLER_OUT.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    nodes = archive.get("nodes") or []
    clearnet = tor = recent = 0
    counts = {}
    now = time.time()
    for node in nodes:
        addr = str(node.get("addr") or "")
        if node.get("network") == "tor" or addr.endswith(".onion"):
            tor += 1
        else:
            clearnet += 1
        ts = node.get("timestamp") or 0
        if ts and now - ts <= 24 * 3600:
            recent += 1
        ua = node.get("userAgent") or ""
        if ua:
            counts[ua] = counts.get(ua, 0) + 1
    clients = [
        {"userAgent": ua, "count": n}
        for ua, n in sorted(counts.items(), key=lambda kv: -kv[1])[:12]
    ]
    return {
        "nodes": archive.get("count") or len(nodes),
        "clearnet": clearnet,
        "tor": tor,
        "seen_24h": recent,
        "clients": clients,
        "generated_at": archive.get("generated_at"),
    }


def crawler_status() -> dict:
    global _crawler_proc
    doc = {
        "state": "idle",
        "needsNode": False,
        "nodes": 0,
        "visited": 0,
        "handshakes": 0,
        "connections": 0,
        "queued": 0,
        "recent": [],
        "archive": str(CRAWLER_OUT),
    }
    if CRAWLER_STATUS.is_file():
        try:
            saved = json.loads(CRAWLER_STATUS.read_text())
            doc.update(saved)
        except (OSError, json.JSONDecodeError):
            pass
    with _crawler_lock:
        proc = _crawler_proc
        if proc is not None and proc.poll() is None:
            doc["state"] = "running"
            doc["pid"] = proc.pid
        elif proc is not None and doc.get("state") == "running":
            doc["state"] = "done"
    pid = doc.get("pid")
    if doc.get("state") == "running" and isinstance(pid, int) and not _pid_alive(pid):
        doc["state"] = "done"
        doc["connections"] = 0
    if CRAWLER_OUT.is_file():
        breakdown = archive_breakdown()
        if not doc.get("nodes"):
            doc["nodes"] = breakdown.get("nodes", 0)
            doc["generated_at"] = breakdown.get("generated_at")
        if "clearnet" not in doc:
            doc["clearnet"] = breakdown.get("clearnet", 0)
            doc["tor"] = breakdown.get("tor", 0)
            doc["seen_24h"] = breakdown.get("seen_24h", 0)
        elif "seen_24h" not in doc:
            doc["seen_24h"] = breakdown.get("seen_24h", 0)
        if not doc.get("clients"):
            doc["clients"] = breakdown.get("clients", [])
    doc["needsNode"] = False
    return doc


def crawler_start(body: dict) -> dict:
    global _crawler_proc
    timeout = int(body.get("timeout") or 300)
    workers = int(body.get("workers") or 128)
    timeout = max(30, min(timeout, 3600))
    workers = max(1, min(workers, 256))
    with _crawler_lock:
        if _crawler_proc is not None and _crawler_proc.poll() is None:
            already = True
        else:
            already = False
            CRAWLER_OUT.parent.mkdir(parents=True, exist_ok=True)
            _crawler_proc = subprocess.Popen(
                [sys.executable, str(CRAWLER_SCRIPT), "--timeout", str(timeout), "--max-workers", str(workers), "--out", str(CRAWLER_OUT)],
                cwd=str(ROOT),
            )
    status = crawler_status()
    if already:
        return {"ok": False, "error": "crawler already running", **status}
    return {"ok": True, **status}


def crawler_stop() -> dict:
    global _crawler_proc
    with _crawler_lock:
        proc = _crawler_proc
        if proc is not None and proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            return {"ok": True, "state": "stopping"}
    status = crawler_status()
    pid = status.get("pid")
    if status.get("state") == "running" and isinstance(pid, int):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        return {"ok": True, "state": "stopping"}
    return {"ok": False, "error": "crawler is not running", **status}


def epoch_status() -> dict:
    global _epoch_proc
    doc = {
        "state": "idle",
        "tip": None,
        "currentEpoch": None,
        "epoch": None,
        "epochIndex": 0,
        "epochsTotal": 0,
        "blocks": 0,
        "expected": 0,
        "mode": None,
        "epochs": "current",
        "outDir": str(EPOCH_OUT),
        "error": None,
    }
    if EPOCH_STATUS.is_file():
        try:
            doc.update(json.loads(EPOCH_STATUS.read_text()))
        except (OSError, json.JSONDecodeError):
            pass
    with _epoch_lock:
        proc = _epoch_proc
        if proc is not None and proc.poll() is None:
            doc["state"] = "running"
            doc["pid"] = proc.pid
        elif proc is not None and doc.get("state") == "running":
            doc["state"] = "done"
    pid = doc.get("pid")
    if doc.get("state") == "running" and isinstance(pid, int) and not _pid_alive(pid):
        doc["state"] = "done"
    return doc


def epoch_start(body: dict) -> dict:
    global _epoch_proc
    epochs = str(body.get("epochs") or "current").strip() or "current"
    if not all(c.isalnum() or c in "-," for c in epochs):
        return {"ok": False, "error": "epochs must look like current, 481, or 471-481", **epoch_status()}
    use_api = bool(body.get("api", True))
    cmd = [sys.executable, str(EPOCH_SCRIPT), "--epochs", epochs, "--out-dir", str(EPOCH_OUT), "--status-file", str(EPOCH_STATUS)]
    if use_api:
        cmd.append("--api")
    else:
        rpc_url = str(body.get("rpcUrl") or "").strip()
        rpc_user = str(body.get("rpcUser") or "")
        rpc_password = str(body.get("rpcPassword") or "")
        if not rpc_url.startswith("http"):
            return {"ok": False, "error": "rpc url required when api mode is off", **epoch_status()}
        cmd += ["--rpc-url", rpc_url, "--rpc-user", rpc_user, "--rpc-password", rpc_password]
    with _epoch_lock:
        if _epoch_proc is not None and _epoch_proc.poll() is None:
            already = True
        else:
            already = False
            EPOCH_OUT.mkdir(parents=True, exist_ok=True)
            EPOCH_STATUS.parent.mkdir(parents=True, exist_ok=True)
            _epoch_proc = subprocess.Popen(cmd, cwd=str(ROOT))
    status = epoch_status()
    if already:
        return {"ok": False, "error": "epoch indexer already running", **status}
    return {"ok": True, **status}


def epoch_stop() -> dict:
    global _epoch_proc
    with _epoch_lock:
        proc = _epoch_proc
        if proc is not None and proc.poll() is None:
            proc.send_signal(signal.SIGTERM)
            return {"ok": True, "state": "stopping"}
    status = epoch_status()
    pid = status.get("pid")
    if status.get("state") == "running" and isinstance(pid, int):
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass
        return {"ok": True, "state": "stopping"}
    return {"ok": False, "error": "epoch indexer is not running", **status}


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
