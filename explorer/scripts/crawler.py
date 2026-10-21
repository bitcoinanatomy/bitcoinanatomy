#!/usr/bin/env python3
"""
Bitcoin P2P Network Crawler
============================
Maps the clearnet Bitcoin network by performing full P2P handshakes
(VERSION → VERACK → GETADDR) recursively from DNS seeds.

No external dependencies — pure Python stdlib.

Output
------
  <cache_dir>/btc_nodes.json
    {
      "generated_at": <unix timestamp>,
      "count": <int>,
      "nodes": [{"addr": "1.2.3.4", "port": 8333, "services": 1033,
                 "userAgent": "/Satoshi:28.1.0/", "timestamp": 0}, ...]
    }

Usage
-----
  python3 crawler.py [--timeout 300] [--max-workers 64] [--out /path/to/btc_nodes.json]
"""

import argparse
import hashlib
import json
import os
import queue
import random
import socket
import struct
import sys
import threading
import time
from datetime import datetime, timezone

# ── Bitcoin P2P constants ─────────────────────────────────────────────────────
MAGIC            = b'\xf9\xbe\xb4\xd9'
PORT             = 8333
PROTOCOL_VERSION = 70015
SERVICES         = 1
USER_AGENT       = '/btc-crawler:0.1/'
START_HEIGHT     = 0
CONNECT_TIMEOUT  = 8
READ_TIMEOUT     = 10
MAX_WORKERS      = 64

DNS_SEEDS = [
    'seed.bitcoin.sipa.be',
    'dnsseed.bluematt.me',
    'dnsseed.bitcoin.dashjr-list-group.net',
    'seed.bitcoinstats.com',
    'seed.bitcoin.jonasschnelli.ch',
    'seed.btc.petertodd.net',
    'seed.bitcoin.sprovoost.nl',
    'dnsseed.emzy.de',
    'seed.bitcoin.wiz.biz',
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def varstr(s: bytes) -> bytes:
    b = s.encode() if isinstance(s, str) else s
    l = len(b)
    if l < 0xfd:
        return bytes([l]) + b
    return b'\xfd' + struct.pack('<H', l) + b

def varint(n: int) -> bytes:
    if n < 0xfd:
        return bytes([n])
    if n <= 0xffff:
        return b'\xfd' + struct.pack('<H', n)
    return b'\xfe' + struct.pack('<I', n)

def checksum(payload: bytes) -> bytes:
    return hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]

def build_message(command: str, payload: bytes) -> bytes:
    cmd = command.encode().ljust(12, b'\x00')
    return MAGIC + cmd + struct.pack('<I', len(payload)) + checksum(payload) + payload

def build_version(peer_ip: str) -> bytes:
    ts       = int(time.time())
    services = struct.pack('<Q', SERVICES)
    payload  = (
        struct.pack('<i', PROTOCOL_VERSION)
        + services
        + struct.pack('<q', ts)
        + services + b'\x00' * 10 + b'\xff\xff' + socket.inet_aton(peer_ip) + struct.pack('>H', PORT)
        + services + b'\x00' * 18
        + struct.pack('>H', PORT)
        + struct.pack('<Q', random.getrandbits(64))
        + varstr(USER_AGENT)
        + struct.pack('<i', START_HEIGHT)
    )
    return build_message('version', payload)

def recv_message(sock):
    header = b''
    while len(header) < 24:
        chunk = sock.recv(24 - len(header))
        if not chunk:
            raise ConnectionError('connection closed')
        header += chunk
    magic, command, length, cksum = (
        header[:4], header[4:16].rstrip(b'\x00').decode(errors='replace'),
        struct.unpack('<I', header[16:20])[0], header[20:24],
    )
    payload = b''
    while len(payload) < length:
        chunk = sock.recv(min(65536, length - len(payload)))
        if not chunk:
            raise ConnectionError('incomplete payload')
        payload += chunk
    return command, payload

def parse_addr(payload: bytes):
    addrs = []
    offset = 0
    count, vlen = 0, 1
    b = payload[0]
    if b < 0xfd:
        count = b; offset = 1
    elif b == 0xfd:
        count = struct.unpack('<H', payload[1:3])[0]; offset = 3
    for _ in range(count):
        if offset + 30 > len(payload):
            break
        ts     = struct.unpack('<I', payload[offset:offset+4])[0]
        svc    = struct.unpack('<Q', payload[offset+4:offset+12])[0]
        ip_raw = payload[offset+12:offset+28]
        port   = struct.unpack('>H', payload[offset+28:offset+30])[0]
        offset += 30
        # Decode mapped IPv4
        if ip_raw[:12] == b'\x00'*10 + b'\xff\xff':
            ip = socket.inet_ntoa(ip_raw[12:])
        else:
            try:
                ip = socket.inet_ntop(socket.AF_INET6, ip_raw)
            except Exception:
                continue
        addrs.append({'addr': ip, 'port': port, 'services': svc, 'timestamp': ts})
    return addrs

def crawl_peer(ip, port, result_lock, found, visited, work_queue, timeout_at, user_agents):
    key = f'{ip}:{port}'
    try:
        sock = socket.create_connection((ip, port), timeout=CONNECT_TIMEOUT)
        sock.settimeout(READ_TIMEOUT)
        sock.sendall(build_version(ip))
        got_version = got_verack = got_addr = False
        while time.time() < timeout_at:
            try:
                cmd, payload = recv_message(sock)
            except Exception:
                break
            if cmd == 'version':
                sock.sendall(build_message('verack', b''))
                ua_start = 80
                if ua_start < len(payload):
                    ua_len = payload[ua_start]
                    if ua_start + 1 + ua_len <= len(payload):
                        ua = payload[ua_start+1:ua_start+1+ua_len].decode(errors='replace')
                        with result_lock:
                            if ua and key not in user_agents:
                                user_agents[key] = ua
                got_version = True
            elif cmd == 'verack':
                sock.sendall(build_message('getaddr', b''))
                got_verack = True
            elif cmd == 'addr':
                addrs = parse_addr(payload)
                with result_lock:
                    for a in addrs:
                        akey = f"{a['addr']}:{a['port']}"
                        if akey not in found:
                            found[akey] = a
                        if akey not in visited:
                            work_queue.put((a['addr'], a['port']))
                got_addr = True
                break
        sock.close()
    except Exception:
        pass

def resolve_seeds():
    ips = []
    for seed in DNS_SEEDS:
        try:
            results = socket.getaddrinfo(seed, PORT, socket.AF_INET)
            for r in results:
                ips.append(r[4][0])
        except Exception:
            pass
    return list(set(ips))

def main():
    parser = argparse.ArgumentParser(description='Bitcoin P2P Network Crawler')
    parser.add_argument('--timeout',     type=int, default=300,  help='Total crawl time in seconds (default: 300)')
    parser.add_argument('--max-workers', type=int, default=MAX_WORKERS, help='Max concurrent threads (default: 64)')
    parser.add_argument('--out',         type=str, default=None, help='Output JSON path (default: <script_dir>/../cache/btc_nodes.json)')
    args = parser.parse_args()

    default_out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cache', 'btc_nodes.json')
    out_path = args.out or os.environ.get('BTC_NODES_OUT', default_out)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

    print(f'Bitcoin P2P Crawler — timeout={args.timeout}s workers={args.max_workers}')
    print(f'Output: {out_path}')

    timeout_at  = time.time() + args.timeout
    found       = {}
    visited     = set()
    user_agents = {}
    result_lock = threading.Lock()
    work_queue  = queue.Queue()

    print('Resolving DNS seeds...')
    seed_ips = resolve_seeds()
    print(f'  {len(seed_ips)} seed IPs from {len(DNS_SEEDS)} seeds')
    for ip in seed_ips:
        work_queue.put((ip, PORT))

    active = threading.Semaphore(args.max_workers)
    threads = []

    while time.time() < timeout_at:
        try:
            ip, port = work_queue.get(timeout=2)
        except queue.Empty:
            if not any(t.is_alive() for t in threads):
                break
            continue

        key = f'{ip}:{port}'
        with result_lock:
            if key in visited:
                continue
            visited.add(key)

        active.acquire()
        def worker(ip=ip, port=port):
            try:
                crawl_peer(ip, port, result_lock, found, visited, work_queue, timeout_at, user_agents)
            finally:
                active.release()

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        threads.append(t)

        with result_lock:
            n = len(found)
        if n % 1000 == 0 and n > 0:
            elapsed = args.timeout - (timeout_at - time.time())
            print(f'  {n} nodes found, {len(visited)} visited ({elapsed:.0f}s elapsed)')

    for t in threads:
        t.join(timeout=2)

    nodes = []
    for key, a in found.items():
        nodes.append({
            'addr':      a['addr'],
            'port':      a['port'],
            'services':  a.get('services', 0),
            'userAgent': user_agents.get(key, ''),
            'timestamp': a.get('timestamp', 0),
        })

    out = {
        'generated_at': int(time.time()),
        'count':        len(nodes),
        'nodes':        nodes,
    }
    with open(out_path, 'w') as f:
        json.dump(out, f, separators=(',', ':'))

    print(f'\nDone. {len(nodes)} nodes saved to {out_path}')

if __name__ == '__main__':
    main()
