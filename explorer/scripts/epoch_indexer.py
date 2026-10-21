#!/usr/bin/env python3
"""
Epoch Indexer — generate or update difficulty epoch JSON files
==============================================================
Fetches per-block data for Bitcoin difficulty epochs and writes them
in the format expected by the Bitcoin Anatomy explorer's difficulty.html.

Two modes
---------
  RPC mode  (recommended, local node)  — full block stats (size, weight, nTx)
  API mode  (fallback, no node needed) — uses mempool.space REST API

Output format (per file)
------------------------
  [[block0, block1, ...]]   where each block is:
  [
    {"height": N},
    {"time": unix_ts},
    {"nTx": N},
    {"chainwork": "hex"},
    {"nonce": N},
    {"size": N},
    {"weight": N},
    {"block_in_cycle": N},
    {"time_difference": seconds_since_prev},
  ]

File naming
-----------
  rcp_bitcoin_block_data_XXXXXXX.json   (zero-padded to 7 digits, start block)

Usage
-----
  # Generate epochs 471–481 from local Bitcoin Core node:
  python3 epoch_indexer.py --epochs 471-481 --rpc-url http://127.0.0.1:8332 --rpc-user bitcoin --rpc-password yourpassword

  # Generate epoch 481 only, from mempool.space (no node needed):
  python3 epoch_indexer.py --epochs 481 --api

  # Update just the current in-progress epoch (cron-friendly):
  python3 epoch_indexer.py --current --api

  # Custom output directory:
  python3 epoch_indexer.py --epochs 471-481 --rpc-url http://host:8332 --rpc-user u --rpc-password p --out-dir /path/to/data/difficulty_epochs
"""

import argparse, base64, json, os, sys, time, urllib.request, urllib.error

BLOCKS_PER_EPOCH = 2016
MEMPOOL_API      = 'https://mempool.space/api'
BATCH_SIZE       = 100   # batch RPC calls per request

DEFAULT_OUT_DIR  = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                '..', 'data', 'difficulty_epochs')

# ── HTTP helpers ──────────────────────────────────────────────────────────────

def http_get(url, retries=3):
    for i in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=15) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == retries - 1:
                raise
            time.sleep(2 * (i + 1))

def rpc_batch(rpc_url, auth_header, calls):
    """Send a batch of RPC calls, return list of results in order."""
    payload = json.dumps([
        {'jsonrpc': '1.0', 'id': i, 'method': m, 'params': p or []}
        for i, (m, p) in enumerate(calls)
    ]).encode()
    req = urllib.request.Request(rpc_url, data=payload,
          headers={'Content-Type': 'text/plain', 'Authorization': auth_header})
    with urllib.request.urlopen(req, timeout=120) as r:
        results = json.loads(r.read())
    results.sort(key=lambda x: x['id'])
    for r in results:
        if r.get('error'):
            raise RuntimeError(r['error'])
    return [r['result'] for r in results]

# ── Epoch generation via RPC ──────────────────────────────────────────────────

def generate_epoch_rpc(epoch, tip, rpc_url, auth_header, out_dir):
    epoch_start = epoch * BLOCKS_PER_EPOCH
    epoch_end   = min(epoch_start + BLOCKS_PER_EPOCH - 1, tip)
    heights     = list(range(epoch_start, epoch_end + 1))
    count       = len(heights)

    print(f'  Fetching {count} block hashes...', end='', flush=True)
    hashes = []
    for i in range(0, count, BATCH_SIZE):
        hashes += rpc_batch(rpc_url, auth_header,
                             [('getblockhash', [h]) for h in heights[i:i+BATCH_SIZE]])
        sys.stdout.write(f'\r  Hashes: {min(i+BATCH_SIZE, count)}/{count}   ')
        sys.stdout.flush()

    print(f'\r  Fetching {count} blocks (verbosity=1)...', end='', flush=True)
    block_data = []
    for i in range(0, count, BATCH_SIZE):
        block_data += rpc_batch(rpc_url, auth_header,
                                 [('getblock', [bh, 1]) for bh in hashes[i:i+BATCH_SIZE]])
        sys.stdout.write(f'\r  Blocks: {min(i+BATCH_SIZE, count)}/{count}   ')
        sys.stdout.flush()

    blocks = []
    for i, blk in enumerate(block_data):
        h         = blk['height']
        time_diff = (blk['time'] - block_data[i-1]['time']) if i > 0 else blk['time']
        blocks.append([
            {'height':        h},
            {'time':          blk['time']},
            {'nTx':           blk.get('nTx', 0)},
            {'chainwork':     blk.get('chainwork', '0')},
            {'nonce':         blk.get('nonce', 0)},
            {'size':          blk.get('size', 0)},
            {'weight':        blk.get('weight', 0)},
            {'block_in_cycle': h - epoch_start},
            {'time_difference': time_diff},
        ])

    _save(epoch_start, blocks, out_dir, count)
    return count

# ── Epoch generation via mempool.space API ────────────────────────────────────

def generate_epoch_api(epoch, tip, out_dir):
    epoch_start = epoch * BLOCKS_PER_EPOCH
    epoch_end   = min(epoch_start + BLOCKS_PER_EPOCH - 1, tip)
    count       = epoch_end - epoch_start + 1

    # Load existing blocks so we can resume partial files
    fname = f'rcp_bitcoin_block_data_{epoch_start:07d}.json'
    fpath = os.path.join(out_dir, fname)
    existing = []
    try:
        with open(fpath) as f:
            d = json.load(f)
        existing = d[0]
        print(f'  Resuming from {len(existing)} existing blocks')
    except FileNotFoundError:
        pass

    have = {b[0]['height'] for b in existing}
    need_start = epoch_start + len(existing)

    if need_start > epoch_end:
        print(f'  Already complete ({len(existing)} blocks)')
        return len(existing)

    print(f'  Fetching blocks {need_start}→{epoch_end} from mempool.space...')
    new_blocks = []
    height = need_start
    while height <= epoch_end:
        batch_end = min(height + 14, epoch_end)
        url = f'{MEMPOOL_API}/v1/blocks/{batch_end}'
        try:
            batch = http_get(url)
        except Exception as e:
            print(f'\n  Error at {batch_end}: {e}')
            break
        for blk in sorted(batch, key=lambda b: b['height']):
            h = blk['height']
            if h < height or h > epoch_end or h in have:
                continue
            prev_time = existing[-1][1]['time'] if existing else (new_blocks[-1][1]['time'] if new_blocks else blk['timestamp'])
            new_blocks.append([
                {'height':        h},
                {'time':          blk['timestamp']},
                {'nTx':           blk.get('tx_count', 0)},
                {'chainwork':     blk.get('chainwork', '0')},
                {'nonce':         blk.get('nonce', 0)},
                {'size':          blk.get('size', 0)},
                {'weight':        blk.get('weight', 0)},
                {'block_in_cycle': h - epoch_start},
                {'time_difference': blk['timestamp'] - prev_time},
            ])
            have.add(h)
            height = h + 1
        sys.stdout.write(f'\r  {height - epoch_start}/{count} blocks...')
        sys.stdout.flush()
        time.sleep(0.15)

    all_blocks = existing + new_blocks
    all_blocks.sort(key=lambda b: b[0]['height'])
    # Recalculate time_differences sequentially
    for i, b in enumerate(all_blocks):
        b[8]['time_difference'] = (b[1]['time'] - all_blocks[i-1][1]['time']) if i > 0 else b[1]['time']

    _save(epoch_start, all_blocks, out_dir, count)
    return len(all_blocks)

# ── File writer ───────────────────────────────────────────────────────────────

def _save(epoch_start, blocks, out_dir, total_expected):
    os.makedirs(out_dir, exist_ok=True)
    fname = f'rcp_bitcoin_block_data_{epoch_start:07d}.json'
    fpath = os.path.join(out_dir, fname)
    with open(fpath, 'w') as f:
        json.dump([blocks], f, separators=(',', ':'))
    n = len(blocks)
    status = 'complete' if n >= total_expected else f'{n}/{total_expected} in-progress'
    print(f'\r  Saved {n} blocks → {fname}  [{status}]')

# ── CLI ───────────────────────────────────────────────────────────────────────

def parse_epochs(spec, current_epoch):
    """Parse '471', '471-481', 'current', or 'all'."""
    spec = spec.strip()
    if spec == 'current':
        return [current_epoch]
    if spec == 'all':
        return list(range(0, current_epoch + 1))
    if '-' in spec:
        a, b = spec.split('-', 1)
        return list(range(int(a), int(b) + 1))
    return [int(spec)]

def main():
    parser = argparse.ArgumentParser(description='Bitcoin Epoch Indexer')
    parser.add_argument('--epochs',       default='current',
                        help='Epochs to generate: "471", "471-481", "current", "all"')
    parser.add_argument('--rpc-url',      default=None,
                        help='Bitcoin Core RPC URL (e.g. http://127.0.0.1:8332)')
    parser.add_argument('--rpc-user',     default=None)
    parser.add_argument('--rpc-password', default=None)
    parser.add_argument('--api',          action='store_true',
                        help='Use mempool.space API instead of RPC (slower, no node needed)')
    parser.add_argument('--out-dir',      default=None,
                        help=f'Output directory (default: {DEFAULT_OUT_DIR})')
    args = parser.parse_args()

    out_dir = args.out_dir or os.environ.get('EPOCH_OUT_DIR', DEFAULT_OUT_DIR)

    # Determine tip
    if args.rpc_url and not args.api:
        auth_header = 'Basic ' + base64.b64encode(
            f'{args.rpc_user}:{args.rpc_password}'.encode()).decode()
        payload = json.dumps({'jsonrpc':'1.0','id':'tip','method':'getblockcount','params':[]}).encode()
        req = urllib.request.Request(args.rpc_url, data=payload,
              headers={'Content-Type':'text/plain','Authorization':auth_header})
        with urllib.request.urlopen(req, timeout=15) as r:
            tip = json.loads(r.read())['result']
        use_rpc = True
    else:
        tip = int(urllib.request.urlopen(f'{MEMPOOL_API}/blocks/tip/height', timeout=10).read())
        use_rpc = False
        if args.rpc_url:
            print('Note: --rpc-url ignored because --api flag is set')

    current_epoch = tip // BLOCKS_PER_EPOCH
    epochs = parse_epochs(args.epochs, current_epoch)
    print(f'Node tip: {tip}  |  Current epoch: {current_epoch}')
    print(f'Mode: {"RPC (" + args.rpc_url + ")" if use_rpc else "mempool.space API"}')
    print(f'Epochs to generate: {epochs[0]}–{epochs[-1]}  ({len(epochs)} total)')
    print(f'Output dir: {out_dir}\n')

    for epoch in epochs:
        epoch_start = epoch * BLOCKS_PER_EPOCH
        if epoch_start > tip:
            print(f'Epoch {epoch}: skipping (beyond tip {tip})')
            continue
        print(f'Epoch {epoch} (blocks {epoch_start}–{min(epoch_start+BLOCKS_PER_EPOCH-1, tip)}):')
        if use_rpc:
            generate_epoch_rpc(epoch, tip, args.rpc_url, auth_header, out_dir)
        else:
            generate_epoch_api(epoch, tip, out_dir)

    print('\nDone.')

if __name__ == '__main__':
    main()
