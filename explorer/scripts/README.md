# Explorer Scripts

Data pipeline scripts for the Bitcoin Anatomy Explorer. Collect node network data and generate difficulty epoch files locally — no third-party data sources at runtime.

## Scripts

| Script | Purpose | Dependencies |
|--------|---------|-------------|
| `crawler.py` | Crawl Bitcoin P2P network via GETADDR handshake | None (stdlib only) |
| `fetch_bitnodes_geo.py` | Fetch geolocated IP data from bitnodes.io API | None (stdlib only) |
| `epoch_indexer.py` | Generate per-block epoch JSON files (RPC or mempool.space) | None (stdlib only) |

All scripts require **Python 3.8+** and no external packages.

---

## Quick Start

```bash
cd explorer/scripts/

# 1. Crawl the Bitcoin network (~5 min, ~35k nodes)
python3 crawler.py --timeout 300

# 2. Fetch bitnodes geo data
python3 fetch_bitnodes_geo.py

# 3. Generate epoch files from a local Bitcoin Core node (fast, full data)
python3 epoch_indexer.py --epochs 0-481 \
    --rpc-url http://127.0.0.1:8332 \
    --rpc-user bitcoin \
    --rpc-password yourpassword

# 3b. Or generate from mempool.space API (no node needed, slower)
python3 epoch_indexer.py --epochs 471-481 --api
```

---

## Script Details

### `crawler.py` — Bitcoin P2P Crawler

Connects to Bitcoin DNS seeds, then recursively performs VERSION/VERACK/GETADDR handshakes to discover the full clearnet node graph.

```
Options:
  --timeout N        Total crawl duration in seconds (default: 300)
  --max-workers N    Concurrent threads (default: 64)
  --out PATH         Output JSON path

Environment:
  BTC_NODES_OUT      Alternative to --out

Output: cache/btc_nodes.json
  {"generated_at": 1234567890, "count": 35000, "nodes": [
    {"addr": "1.2.3.4", "port": 8333, "services": 1033,
     "userAgent": "/Satoshi:28.1.0/", "timestamp": 0}
  ]}
```

**Note:** Only discovers *known* addresses via P2P gossip. Does not verify reachability. Complementary to bitnodes.io which verifies reachability.

---

### `fetch_bitnodes_geo.py` — Bitnodes Geo Fetcher

Fetches all nodes from bitnodes.io's paginated API, extracts lat/lng and org info, and writes a clean IP → geo mapping.

```
Options:
  --out PATH         Output JSON path

Environment:
  BITNODES_GEO_OUT   Alternative to --out

Output: cache/bitnodes_geo_cache.json
  {"1.2.3.4": {"lat": 37.75, "lng": -97.82, "city": "Kansas City",
               "country": "US", "org": "AS-NAME", "asn": "AS12345",
               "timezone": "America/Chicago", "hostname": "..."}, ...}
```

---

### `epoch_indexer.py` — Difficulty Epoch Indexer

Generates per-block data files for each 2016-block difficulty epoch. Used by `difficulty.html` to render the block spiral visualization.

```
Options:
  --epochs SPEC      Which epochs: "481", "471-481", "current", "all"
  --rpc-url URL      Bitcoin Core RPC endpoint (e.g. http://127.0.0.1:8332)
  --rpc-user USER    RPC username
  --rpc-password PW  RPC password
  --api              Use mempool.space API instead of RPC (no node needed)
  --out-dir PATH     Output directory (default: data/difficulty_epochs/)

Environment:
  EPOCH_OUT_DIR      Alternative to --out-dir

Output: data/difficulty_epochs/rcp_bitcoin_block_data_XXXXXXX.json
```

**RPC mode** (recommended): requires a synced Bitcoin Core node. Uses batch RPC (100 calls/request) — ~2 min per epoch.

**API mode**: uses mempool.space REST API. Slower, rate-limited, but works without a node. Good for updating the current in-progress epoch.

---

## Automation (this machine)

The dashboard server (`ambro-dashboard.py`) serves all four node data sources:

| Source | API endpoint | Data file |
|--------|-------------|-----------|
| Crawler archive | `/api/addrman` | `cache/btc_nodes.json` |
| Bitnodes archive | `/api/bitnodes-archive` | `cache/bitnodes_geo_cache.json` |
| BTC Nodes live | `/api/btcnodes` | live proxy to btcnodes.io |
| BTC Nodes archive | static | `explorer/js/pvxg-nodes-snapshot-*.json` |

### Cron schedule

```
# Weekly: re-crawl P2P network + refresh bitnodes geo
0 3 * * 0  python3 /path/to/explorer/scripts/crawler.py --timeout 300
0 4 * * 0  python3 /path/to/explorer/scripts/fetch_bitnodes_geo.py

# Every 2h: update current epoch with latest blocks
0 */2 * * * python3 /path/to/explorer/scripts/epoch_indexer.py --current --api
```

### Run everything from scratch

```bash
# Full rebuild on a new machine (with a synced Bitcoin Core node)
cd explorer/scripts/

python3 crawler.py --timeout 300
python3 fetch_bitnodes_geo.py
python3 epoch_indexer.py --epochs all \
    --rpc-url http://127.0.0.1:8332 \
    --rpc-user bitcoin \
    --rpc-password yourpassword

# Without a node (API mode, current epochs only):
python3 epoch_indexer.py --epochs all --api
```

---

## Cache Directory

By default scripts write to `explorer/cache/` (relative to script location). Override with `--out` / `--out-dir` or the corresponding environment variables.

The `cache/` directory is git-ignored (large, machine-specific). Epoch files in `data/difficulty_epochs/` are committed to the repo.
