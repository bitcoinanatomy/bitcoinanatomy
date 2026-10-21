#!/usr/bin/env python3
"""
Bitnodes Geo Fetcher
=====================
Downloads geolocated node data from the bitnodes.io paginated API and
writes a clean IP → geo mapping cache.

No external dependencies — pure Python stdlib.

Output
------
  <cache_dir>/bitnodes_geo_cache.json
    {"generated_at": <unix>, "count": <int>,
     "nodes": [{"addr": "1.2.3.4", "port": 8333, "lat": 37.75, "lng": -97.82,
                "city": "...", "country": "US", "userAgent": "/Satoshi:29.0/", ...}]}

Usage
-----
  python3 fetch_bitnodes_geo.py [--out /path/to/bitnodes_geo_cache.json]
"""

import json, time, urllib.request, urllib.error, sys, os, argparse, threading
from concurrent.futures import ThreadPoolExecutor, as_completed

BITNODES_BASE = 'https://btcnodes.io/api/v1/nodes/'
PAGE_SIZE     = 1000
MAX_WORKERS   = 6

def fetch_page(page):
    url = f'{BITNODES_BASE}?page={page}&limit={PAGE_SIZE}'
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(10 * (attempt + 1))
            else:
                raise
        except Exception as e:
            if attempt == 2:
                raise
            time.sleep(2)

def main():
    parser = argparse.ArgumentParser(description='Fetch bitnodes.io geo data')
    parser.add_argument('--out', type=str, default=None,
                        help='Output JSON path (default: <script_dir>/../cache/bitnodes_geo_cache.json)')
    args = parser.parse_args()

    default_out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'cache', 'bitnodes_geo_cache.json')
    out_path = args.out or os.environ.get('BITNODES_GEO_OUT', default_out)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)

    print('Fetching first page to get total count...')
    first = fetch_page(1)
    total   = first.get('count', 0)
    n_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
    print(f'  {total} nodes across {n_pages} pages')

    nodes = []
    seen = set()
    lock = threading.Lock()

    def add_row(row):
        if not isinstance(row, dict):
            return
        lat = row.get('lat')
        lng = row.get('lon') if row.get('lon') is not None else row.get('lng')
        if lat is None or lng is None:
            return
        addr = row.get('address') or row.get('addr') or ''
        port = row.get('port') or 8333
        key = f'{addr}:{port}'
        if not addr:
            return
        node = {
            'addr': addr,
            'port': port,
            'version': row.get('version') or 0,
            'userAgent': row.get('user_agent') or row.get('userAgent') or '',
            'connectedSince': row.get('connected_since') or 0,
            'services': row.get('services') or 0,
            'height': row.get('height') or 0,
            'hostname': row.get('hostname'),
            'city': row.get('city'),
            'country': row.get('country'),
            'lat': lat,
            'lng': lng,
            'timezone': row.get('timezone'),
            'asn': row.get('asn'),
            'org': row.get('organization') or row.get('org'),
        }
        with lock:
            if key in seen:
                return
            seen.add(key)
            nodes.append(node)

    def process_page(page_data):
        results = page_data.get('results') or []
        if isinstance(results, dict):
            # Older API: {"ip:port": [tuple...]} — not used by the current list endpoint.
            return
        for row in results:
            add_row(row)

    def write_cache():
        with lock:
            snapshot = list(nodes)
        payload = {
            'generated_at': int(time.time()),
            'count': len(snapshot),
            'nodes': snapshot,
        }
        tmp = out_path + '.tmp'
        with open(tmp, 'w') as f:
            json.dump(payload, f, separators=(',', ':'))
        os.replace(tmp, out_path)

    process_page(first)
    write_cache()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_page, p): p for p in range(2, n_pages + 1)}
        done = 1
        for fut in as_completed(futures):
            try:
                process_page(fut.result())
            except Exception as e:
                print(f'\n  Error on page {futures[fut]}: {e}')
            done += 1
            sys.stdout.write(f'\r  Processed {done}/{n_pages} pages — {len(nodes)} geolocated nodes   ')
            sys.stdout.flush()
            if done % 5 == 0:
                write_cache()

    write_cache()
    print(f'\nTotal: {len(nodes)} geolocated nodes')
    print(f'Saved → {out_path}')

if __name__ == '__main__':
    main()
