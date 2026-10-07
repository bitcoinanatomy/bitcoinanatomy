#!/usr/bin/env python3
"""
Bitcoin P2P Network Crawler
============================
Maps the clearnet Bitcoin network (public IPv4 and IPv6) by performing
P2P handshakes (VERSION → SENDADDRV2 → VERACK → GETADDR) from DNS seeds,
then dialing recently gossiped peers first.

No external dependencies — pure Python stdlib.

Output
------
  explorer/data/btc_nodes.json
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
import base64
import hashlib
import ipaddress
import json
import os
import queue
import random
import signal
import socket
import struct
import threading
import time

# ── Bitcoin P2P constants ─────────────────────────────────────────────────────
MAGIC            = b'\xf9\xbe\xb4\xd9'
PORT             = 8333
PROTOCOL_VERSION = 70016
SERVICES         = 1          # NODE_NETWORK
USER_AGENT       = '/btc-crawler:0.2/'
START_HEIGHT     = 0
CONNECT_TIMEOUT  = 5
READ_TIMEOUT     = 8
ADDR_LISTEN      = 4          # keep reading briefly so a trickle of addr msgs is kept
MAX_WORKERS      = 128
# Only spend dials on addresses gossiped recently. Older ones are still saved.
DIAL_MAX_AGE     = 3 * 24 * 3600

DNS_SEEDS = [
    'seed.bitcoin.sipa.be',
    'dnsseed.bluematt.me',
    'dnsseed.bitcoin.dashjr-list-group.net',
    'seed.bitcoinstats.com',
    'seed.bitcoin.jonasschnelli.ch',
    'seed.btc.petertodd.net',
    'seed.btc.petertodd.org',
    'seed.bitcoin.sprovoost.nl',
    'dnsseed.emzy.de',
    'seed.bitcoin.wiz.biz',
    'seed.mainnet.achownodes.xyz',
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

def encode_ip(ip: str) -> bytes:
    """16-byte IPv6 form used by version/addr. IPv4 is written as IPv4-mapped."""
    try:
        return b'\x00' * 10 + b'\xff\xff' + socket.inet_aton(ip)
    except OSError:
        return socket.inet_pton(socket.AF_INET6, ip)

def netaddr(ip: str, port: int) -> bytes:
    services = struct.pack('<Q', SERVICES)
    return services + encode_ip(ip) + struct.pack('>H', port)

def is_public(ip: str) -> bool:
    """Clearnet unicast only — drops private, loopback, link-local, multicast, reserved."""
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return addr.is_global

def canonical_ip(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return ip
    if addr.version == 6 and addr.ipv4_mapped:
        return str(addr.ipv4_mapped)
    return str(addr)

def build_version(peer_ip: str, peer_port: int) -> bytes:
    ts       = int(time.time())
    services = struct.pack('<Q', SERVICES)
    payload  = (
        struct.pack('<i', PROTOCOL_VERSION)
        + services
        + struct.pack('<q', ts)
        + netaddr(peer_ip, peer_port)
        + netaddr('0.0.0.0', PORT)
        + struct.pack('<Q', random.getrandbits(64))
        + varstr(USER_AGENT)
        + struct.pack('<i', START_HEIGHT)
        + b'\x01'  # relay
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

def read_varint(buf: bytes, offset: int):
    if offset >= len(buf):
        return None, offset
    b = buf[offset]
    if b < 0xfd:
        return b, offset + 1
    if b == 0xfd and offset + 3 <= len(buf):
        return struct.unpack('<H', buf[offset+1:offset+3])[0], offset + 3
    if b == 0xfe and offset + 5 <= len(buf):
        return struct.unpack('<I', buf[offset+1:offset+5])[0], offset + 5
    return None, offset

def parse_addr(payload: bytes):
    """Legacy `addr` (IPv4-mapped and IPv6)."""
    addrs = []
    count, offset = read_varint(payload, 0)
    if count is None:
        return addrs
    for _ in range(count):
        if offset + 30 > len(payload):
            break
        ts     = struct.unpack('<I', payload[offset:offset+4])[0]
        svc    = struct.unpack('<Q', payload[offset+4:offset+12])[0]
        ip_raw = payload[offset+12:offset+28]
        port   = struct.unpack('>H', payload[offset+28:offset+30])[0]
        offset += 30
        if ip_raw[:12] == b'\x00'*10 + b'\xff\xff':
            ip = socket.inet_ntoa(ip_raw[12:])
        else:
            try:
                ip = socket.inet_ntop(socket.AF_INET6, ip_raw)
            except Exception:
                continue
        addrs.append({'addr': canonical_ip(ip), 'port': port, 'services': svc, 'timestamp': ts, 'network': 'clearnet'})
    return addrs

def parse_addrv2(payload: bytes):
    """BIP155 addrv2. Keeps clearnet IPv4 (id 1) and IPv6 (id 2); skips Tor/I2P/CJDNS."""
    addrs = []
    count, offset = read_varint(payload, 0)
    if count is None:
        return addrs
    for _ in range(min(count, 10000)):
        if offset + 4 > len(payload):
            break
        ts = struct.unpack('<I', payload[offset:offset+4])[0]
        offset += 4
        svc, offset = read_varint(payload, offset)
        if svc is None or offset >= len(payload):
            break
        netid = payload[offset]
        offset += 1
        alen, offset = read_varint(payload, offset)
        if alen is None or offset + alen + 2 > len(payload):
            break
        raw = payload[offset:offset+alen]
        offset += alen
        port = struct.unpack('>H', payload[offset:offset+2])[0]
        offset += 2
        ip = None
        network = 'clearnet'
        if netid == 1 and alen == 4:
            ip = socket.inet_ntoa(raw)
        elif netid == 2 and alen == 16:
            try:
                ip = socket.inet_ntop(socket.AF_INET6, raw)
            except Exception:
                ip = None
        elif netid == 3 and alen == 10:
            ip = base64.b32encode(raw).decode().lower() + '.onion'
            network = 'tor'
        elif netid == 4 and alen == 32:
            ip = base64.b32encode(raw).decode().lower().rstrip('=') + '.onion'
            network = 'tor'
        if ip:
            addrs.append({
                'addr': canonical_ip(ip) if network == 'clearnet' else ip,
                'port': port,
                'services': svc,
                'timestamp': ts,
                'network': network,
            })
    return addrs

def remember(addrs, result_lock, found, scheduled, work_queue, now):
    """Save public clearnet and Tor addresses. Dial recent clearnet peers only."""
    with result_lock:
        for a in addrs:
            ip, port = a['addr'], a['port']
            network = a.get('network') or ('tor' if str(ip).endswith('.onion') else 'clearnet')
            a['network'] = network
            if not ip or port == 0:
                continue
            if network == 'clearnet' and not is_public(ip):
                continue
            akey = f'{ip}:{port}'
            prev = found.get(akey)
            if prev is None or a.get('timestamp', 0) >= prev.get('timestamp', 0):
                found[akey] = a
            if network != 'clearnet' or akey in scheduled:
                continue
            ts = a.get('timestamp', 0) or 0
            if ts and now - ts > DIAL_MAX_AGE:
                continue
            scheduled.add(akey)
            # PriorityQueue is smallest-first; negate so fresh timestamps win.
            work_queue.put((-ts, akey, ip, port))

def read_user_agent(payload: bytes) -> str:
    # version(4)+services(8)+ts(8)+addr_recv(26)+addr_from(26)+nonce(8) = 80
    ua_len, offset = read_varint(payload, 80)
    if ua_len is None or offset + ua_len > len(payload):
        return ''
    return payload[offset:offset+ua_len].decode(errors='replace')

def crawl_peer(ip, port, result_lock, found, scheduled, work_queue, timeout_at, user_agents, stats):
    key = f'{ip}:{port}'
    sock = None
    with result_lock:
        stats['connections'] += 1
    try:
        sock = socket.create_connection((ip, port), timeout=CONNECT_TIMEOUT)
        sock.settimeout(READ_TIMEOUT)
        sock.sendall(build_version(ip, port))
        sent_getaddr = False
        addr_deadline = None
        while time.time() < timeout_at[0]:
            if addr_deadline is not None and time.time() >= addr_deadline:
                break
            try:
                cmd, payload = recv_message(sock)
            except Exception:
                break
            if cmd == 'version':
                ua = read_user_agent(payload)
                with result_lock:
                    stats['handshakes'] += 1
                    if ua:
                        user_agents[key] = ua
                    stats['recent'].append({
                        'addr': ip,
                        'port': port,
                        'userAgent': ua,
                        'at': int(time.time()),
                    })
                    if len(stats['recent']) > 12:
                        del stats['recent'][:-12]
                # sendaddrv2 must go out before verack or the peer stays on legacy addr.
                sock.sendall(build_message('sendaddrv2', b''))
                sock.sendall(build_message('verack', b''))
            elif cmd == 'verack' and not sent_getaddr:
                sock.sendall(build_message('getaddr', b''))
                sent_getaddr = True
                addr_deadline = time.time() + ADDR_LISTEN
            elif cmd == 'addr':
                remember(parse_addr(payload), result_lock, found, scheduled, work_queue, time.time())
                if addr_deadline is None:
                    addr_deadline = time.time() + ADDR_LISTEN
            elif cmd == 'addrv2':
                remember(parse_addrv2(payload), result_lock, found, scheduled, work_queue, time.time())
                if addr_deadline is None:
                    addr_deadline = time.time() + ADDR_LISTEN
            elif cmd == 'ping':
                sock.sendall(build_message('pong', payload[:8]))
    except Exception:
        pass
    finally:
        with result_lock:
            stats['connections'] = max(0, stats['connections'] - 1)
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass

def resolve_seeds():
    ips = []
    for seed in DNS_SEEDS:
        for family in (socket.AF_INET, socket.AF_INET6):
            try:
                results = socket.getaddrinfo(seed, PORT, family, socket.SOCK_STREAM)
            except Exception:
                continue
            for r in results:
                ip = canonical_ip(r[4][0])
                if is_public(ip):
                    ips.append(ip)
    return list(dict.fromkeys(ips))

def network_of(addr: str, network: str = '') -> str:
    if network == 'tor' or str(addr).endswith('.onion'):
        return 'tor'
    return 'clearnet'

def summarize(found, user_agents, now=None):
    now = now or time.time()
    clearnet = tor = recent = 0
    for a in found.values():
        if network_of(a.get('addr', ''), a.get('network', '')) == 'tor':
            tor += 1
        else:
            clearnet += 1
        ts = a.get('timestamp') or 0
        if ts and now - ts <= 24 * 3600:
            recent += 1
    counts = {}
    for ua in user_agents.values():
        if not ua:
            continue
        counts[ua] = counts.get(ua, 0) + 1
    clients = [{'userAgent': ua, 'count': n} for ua, n in sorted(counts.items(), key=lambda kv: -kv[1])[:12]]
    return clearnet, tor, recent, clients

def write_status(status_path, state, started_at, timeout, workers, found, visited_n, stats, queued, user_agents):
    clearnet, tor, recent, clients = summarize(found, user_agents)
    doc = {
        'state': state,
        'pid': os.getpid(),
        'started_at': started_at,
        'timeout': timeout,
        'workers': workers,
        'nodes': clearnet + tor,
        'clearnet': clearnet,
        'tor': tor,
        'seen_24h': recent,
        'clients': clients,
        'visited': visited_n,
        'handshakes': stats['handshakes'],
        'connections': stats['connections'],
        'queued': queued,
        'recent': list(stats['recent']),
        'updated_at': int(time.time()),
    }
    tmp = status_path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
    os.replace(tmp, status_path)

def write_cache(out_path, found, user_agents):
    """Atomically write the archive the dashboard serves at /api/addrman."""
    nodes = []
    for key, a in found.items():
        nodes.append({
            'addr':      a['addr'],
            'port':      a['port'],
            'services':  a.get('services', 0),
            'userAgent': user_agents.get(key, ''),
            'timestamp': a.get('timestamp', 0),
            'network': network_of(a.get('addr', ''), a.get('network', '')),
        })
    out = {
        'generated_at': int(time.time()),
        'count':        len(nodes),
        'nodes':        nodes,
    }
    tmp = out_path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    os.replace(tmp, out_path)
    return len(nodes)


def main():
    parser = argparse.ArgumentParser(description='Bitcoin P2P Network Crawler')
    parser.add_argument('--timeout',     type=int, default=300,  help='Total crawl time in seconds (default: 300)')
    parser.add_argument('--max-workers', type=int, default=MAX_WORKERS, help='Max concurrent threads (default: 64)')
    parser.add_argument('--out',         type=str, default=None, help='Output JSON path (default: <script_dir>/../cache/btc_nodes.json)')
    args = parser.parse_args()

    default_out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'btc_nodes.json')
    out_path = args.out or os.environ.get('BTC_NODES_OUT', default_out)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

    print(f'Bitcoin P2P Crawler — timeout={args.timeout}s workers={args.max_workers}')
    print(f'Output: {out_path}  (served as /api/addrman)')

    started_at  = int(time.time())
    timeout_at  = [time.time() + args.timeout]
    last_save   = 0
    found       = {}
    visited     = set()
    scheduled   = set()
    user_agents = {}
    stats       = {'connections': 0, 'handshakes': 0, 'recent': []}
    result_lock = threading.Lock()
    work_queue  = queue.PriorityQueue()
    cache_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cache')
    os.makedirs(cache_dir, exist_ok=True)
    status_path = os.path.join(cache_dir, 'crawler_status.json')
    stop = {'flag': False}

    def _request_stop(signum, _frame):
        stop['flag'] = True
        timeout_at[0] = time.time()

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    print('Resolving DNS seeds...')
    seed_ips = resolve_seeds()
    print(f'  {len(seed_ips)} seed IPs from {len(DNS_SEEDS)} seeds')
    now = int(time.time())
    remember(
        [{'addr': ip, 'port': PORT, 'services': 0, 'timestamp': now} for ip in seed_ips],
        result_lock, found, scheduled, work_queue, now,
    )

    active = threading.Semaphore(args.max_workers)
    threads = []
    write_status(status_path, 'running', started_at, args.timeout, args.max_workers,
                 found, 0, stats, work_queue.qsize(), user_agents)

    while time.time() < timeout_at[0] and not stop['flag']:
        try:
            _prio, key, ip, port = work_queue.get(timeout=2)
        except queue.Empty:
            if not any(t.is_alive() for t in threads):
                break
            continue

        with result_lock:
            if key in visited:
                continue
            visited.add(key)

        active.acquire()
        def worker(ip=ip, port=port):
            try:
                crawl_peer(ip, port, result_lock, found, scheduled, work_queue, timeout_at, user_agents, stats)
            finally:
                active.release()

        t = threading.Thread(target=worker, daemon=True)
        t.start()
        threads.append(t)

        now = time.time()
        if now - last_save >= 2:
            with result_lock:
                n = write_cache(out_path, found, user_agents)
                visited_n = len(visited)
                write_status(status_path, 'running', started_at, args.timeout, args.max_workers,
                             found, visited_n, stats, work_queue.qsize(), user_agents)
            last_save = now
            elapsed = now - started_at
            print(f'  saved {n} nodes, {visited_n} visited ({elapsed:.0f}s elapsed)')

    for t in threads:
        t.join(timeout=2)

    with result_lock:
        n = write_cache(out_path, found, user_agents)
        write_status(status_path, 'stopped' if stop['flag'] else 'done', started_at, args.timeout,
                     args.max_workers, found, len(visited), stats, work_queue.qsize(), user_agents)
    print(f'\nDone. {n} nodes saved to {out_path}')

if __name__ == '__main__':
    main()
