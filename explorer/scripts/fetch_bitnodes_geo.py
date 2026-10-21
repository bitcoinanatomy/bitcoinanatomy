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
    {"1.2.3.4": {"lat": 37.75, "lng": -97.82, "city": "...", "country": "US",
                 "org": "...", "asn": "AS1234", "timezone": "...", "hostname": "..."}, ...}

Usage
-----
  python3 fetch_bitnodes_geo.py [--out /path/to/bitnodes_geo_cache.json]
"""

import json, time, urllib.request, urllib.error, sys, os, argparse
from concurrent.futures import ThreadPoolExecutor, as_completed

BITNODES_BASE = 'https://bitnodes.io/api/v1/nodes/'
PAGE_SIZE     = 100
MAX_WORKERS   = 8

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

    geo_cache = {}

    def process_page(page_data):
        results = page_data.get('results', {})
        for key, fields in results.items():
            # key format: "ip:port" or "[ipv6]:port"
            ip = key.rsplit(':', 1)[0].strip('[]')
            if not fields or len(fields) < 8:
                continue
            lat = fields[7] if len(fields) > 7 else None
            lng = fields[8] if len(fields) > 8 else None
            if lat is None or lng is None:
                continue
            geo_cache[ip] = {
                'lat':      lat,
                'lng':      lng,
                'city':     fields[10] if len(fields) > 10 else None,
                'country':  fields[9]  if len(fields) > 9  else None,
                'org':      fields[12] if len(fields) > 12 else None,
                'asn':      fields[11] if len(fields) > 11 else None,
                'timezone': fields[13] if len(fields) > 13 else None,
                'hostname': fields[5]  if len(fields) > 5  else None,
            }

    process_page(first)

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_page, p): p for p in range(2, n_pages + 1)}
        done = 1
        for fut in as_completed(futures):
            try:
                process_page(fut.result())
            except Exception as e:
                print(f'\n  Error on page {futures[fut]}: {e}')
            done += 1
            sys.stdout.write(f'\r  Processed {done}/{n_pages} pages — {len(geo_cache)} IPs with geo   ')
            sys.stdout.flush()

    print(f'\nTotal: {len(geo_cache)} IPs with geo data')
    with open(out_path, 'w') as f:
        json.dump(geo_cache, f, separators=(',', ':'))
    print(f'Saved → {out_path}')

if __name__ == '__main__':
    main()
