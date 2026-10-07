#!/usr/bin/env python3
"""
Attach lat/lng to clearnet addresses gossiped in the last 24 hours.

Matches explorer/data/btc_nodes.json against the bitnodes geo cache first,
then looks up the rest with the ip-api.com batch endpoint (free tier: HTTP,
100 addresses per request). Results land in explorer/cache/ip_geo.json and
are copied onto the archive so the network map can place those peers.

  python3 geolocate_recent.py
"""

import json
import os
import time
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ARCHIVE = os.path.join(ROOT, 'data', 'btc_nodes.json')
BITNODES = os.path.join(ROOT, 'cache', 'bitnodes_geo_cache.json')
GEO_OUT = os.path.join(ROOT, 'cache', 'ip_geo.json')
DAY = 24 * 3600
BATCH = 100
# ip-api free tier allows 45 requests/minute. Stay under that.
PAUSE = 1.4


def load_json(path):
    with open(path) as f:
        return json.load(f)


def recent_clearnet(nodes, now):
    out = []
    seen = set()
    for node in nodes:
        addr = node.get('addr') or ''
        if node.get('network') == 'tor' or addr.endswith('.onion') or not addr:
            continue
        ts = node.get('timestamp') or 0
        if not ts or now - ts > DAY:
            continue
        if addr in seen:
            continue
        seen.add(addr)
        out.append(addr)
    return out


def from_bitnodes(path):
    if not os.path.isfile(path):
        return {}
    data = load_json(path)
    rows = data.get('nodes') if isinstance(data, dict) else data
    found = {}
    for row in rows or []:
        if not isinstance(row, dict) or row.get('lat') is None:
            continue
        lng = row.get('lng') if row.get('lng') is not None else row.get('lon')
        if lng is None:
            continue
        found[row.get('addr')] = {
            'lat': row['lat'],
            'lng': lng,
            'city': row.get('city') or '',
            'country': row.get('country') or '',
        }
    return found


def load_geo(path):
    if not os.path.isfile(path):
        return {}
    data = load_json(path)
    ips = data.get('ips') if isinstance(data, dict) else data
    return ips if isinstance(ips, dict) else {}


def save_geo(path, ips):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    payload = {'generated_at': int(time.time()), 'count': len(ips), 'ips': ips}
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(payload, f, separators=(',', ':'))
    os.replace(tmp, path)


def lookup_batch(addrs):
    body = json.dumps(addrs).encode()
    req = urllib.request.Request(
        'http://ip-api.com/batch?fields=status,query,lat,lon,city,countryCode',
        data=body,
        headers={'Content-Type': 'application/json', 'User-Agent': 'btc-crawler-geo/0.1'},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def stamp_archive(path, ips):
    data = load_json(path)
    placed = 0
    for node in data.get('nodes') or []:
        hit = ips.get(node.get('addr'))
        if not hit or hit.get('lat') is None:
            continue
        node['lat'] = hit['lat']
        node['lng'] = hit['lng']
        if hit.get('city'):
            node['city'] = hit['city']
        if hit.get('country'):
            node['country'] = hit['country']
        placed += 1
    tmp = path + '.tmp'
    with open(tmp, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    os.replace(tmp, path)
    return placed


def main():
    now = time.time()
    archive = load_json(ARCHIVE)
    addrs = recent_clearnet(archive.get('nodes') or [], now)
    print(f'{len(addrs)} clearnet addresses seen in the last 24h')

    known = load_geo(GEO_OUT)
    bitnodes = from_bitnodes(BITNODES)
    added = 0
    for addr in addrs:
        if addr in known and known[addr].get('lat') is not None:
            continue
        hit = bitnodes.get(addr)
        if hit:
            known[addr] = hit
            added += 1
    print(f'  {added} filled from bitnodes cache, {sum(1 for a in addrs if a in known)} already known')

    missing = [a for a in addrs if a not in known or known[a].get('lat') is None]
    print(f'  {len(missing)} still need an IP lookup')
    looked = 0
    for i in range(0, len(missing), BATCH):
        chunk = missing[i:i + BATCH]
        for attempt in range(4):
            try:
                rows = lookup_batch(chunk)
                break
            except urllib.error.HTTPError as err:
                if err.code == 429:
                    time.sleep(10 * (attempt + 1))
                    continue
                raise
        else:
            raise SystemExit('ip-api rate limit did not clear')
        for row in rows:
            if not isinstance(row, dict) or row.get('status') != 'success':
                continue
            query = row.get('query')
            if query is None or row.get('lat') is None or row.get('lon') is None:
                continue
            known[query] = {
                'lat': row['lat'],
                'lng': row['lon'],
                'city': row.get('city') or '',
                'country': row.get('countryCode') or '',
            }
            looked += 1
        save_geo(GEO_OUT, known)
        done = min(i + BATCH, len(missing))
        print(f'  looked up {done}/{len(missing)} ({looked} placed)')
        if done < len(missing):
            time.sleep(PAUSE)

    placed = stamp_archive(ARCHIVE, known)
    print(f'Wrote coordinates onto {placed} archive rows')


if __name__ == '__main__':
    main()
