#!/usr/bin/python3

# adaptation from: https://github.com/eklitzke/utxodump/blob/master/utxodump.py
# adjusted by @bitcoingraffiti on 22-02-2022
# Dumps all fields except the script pub key

import argparse
import binascii
import enum
import operator
import os
import json

from collections import defaultdict
from typing import Tuple

import leveldb


class RowType(enum.Enum):

    COIN = 'C'
    COINS = 'c'
    BLOCK_FILES = 'f'
    TXINDEX = 't'
    BLOCK_INDEX = 'b'
    BEST_BLOCK = 'B'
    HEAD_BLOCK = 'H'
    FLAG = 'F'
    REINDEX_FLAG = 'R'
    LAST_BLOCK = 'l'
    OBFUSCATE = '\x0e'


# Prefix for coins.
COIN = 67

# The obfuscation key.
OBFUSCATE_KEY = bytearray(b'\x0e\x00obfuscate_key')

# set path to your local bitcoin core
BITCOINCORE_PATH = '/Users/sjorsvanheuveln/Library/Application Support/Bitcoin'


def get_obfuscate_key(conn: leveldb.LevelDB) -> bytearray:
    """Load the obfuscation key from the database."""
    secret = conn.Get(OBFUSCATE_KEY)
    assert secret[0] == 8 and len(secret) == 9
    return secret[1:]


def decrypt(ciphertext: bytearray, key: bytearray):
    """Decrypt data using an XOR cipher."""
    for i, c in enumerate(ciphertext):
        ciphertext[i] = c ^ key[i % len(key)]


def decode_varint(val: bytearray) -> Tuple[int, int]:
    """Decode a varint. Returns the value and number of bytes consumed."""
    n = 0
    for i, c in enumerate(val):
        n = (n << 7) | (c & 0x7f)
        if c & 0x80:
            n += 1
        else:
            return n, i + 1
    assert False  # not reached


def decompress_amount(x: int) -> int:
    """Decompress an output amount."""
    if x == 0:
        return 0
    x -= 1
    e = x % 10
    x //= 10
    n = 0
    if e < 9:
        d = (x % 9) + 1
        x //= 9
        n = x * 10 + d
    else:
        n = x + 1
    while e:
        n *= 10
        e -= 1
    return n


def decode_key(key: bytearray) -> Tuple[str, int]:
    """Decode key to (txid, vout)."""
    assert key[0] == COIN
    txid = binascii.hexlify(key[1:33][::-1]).decode('utf8')
    compressed_vout = key[33:]
    vout, declen = decode_varint(compressed_vout)
    assert declen == len(compressed_vout)
    return txid, vout


def decode_val(val: bytearray) -> Tuple[int, int, int, int]:
    """Decode val to (height, coinbase, amount)."""
    code, consumed = decode_varint(val)
    coinbase = code & 1
    height = code >> 1
    txval, rem = decode_varint(val[consumed:])
    return height, coinbase, decompress_amount(txval), len(val) - rem


def locate_db(testnet: bool, name: str) -> str:
    """Guess where the chainstate directory is."""
    datadir = os.path.expanduser(BITCOINCORE_PATH)
    if testnet:
        datadir = os.path.join(datadir, 'testnet3')
    return os.path.join(datadir, name)

def dump_chainstate_csv(conn: leveldb.LevelDB):
    secret = get_obfuscate_key(conn)
    with open('utxo.json', 'w', encoding='utf-8') as file:
        for k, v in conn.RangeIter(b'C', b'D', include_value=True):
            txid, vout = decode_key(k)
            decrypt(v, secret)
            height, coinbase, amount, sz = decode_val(v)

            utxo = {
                "txid": txid,
                "vout": vout,
                "height": height,
                "coinbase": coinbase,
                "amount": amount,
                "scriptsize": sz,
            }

            json.dump(utxo, file, sort_keys=True)
            file.write('\n')

def summarize(conn: leveldb.LevelDB):
    counts = defaultdict(int)
    for k, v in conn.RangeIter():
        assert isinstance(k, bytearray)
        kind = chr(k[0])
        counts[kind] += 1

    code_to_name = {t.value: t.name for t in RowType}
    for k, v in sorted(
            counts.items(), key=operator.itemgetter(1), reverse=True):
        print('{:15s} {}'.format(code_to_name[k], v))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        '-b',
        '--blocks',
        action='store_true',
        help='Scan the block index (rather than chainstate)')
    parser.add_argument(
        '-t',
        '--testnet',
        action='store_true',
        help='Testnet mode (ignored if --datadir is used)')
    parser.add_argument(
        '-s',
        '--summarize',
        action='store_true',
        help='Summarize information about key types')
    parser.add_argument('-d', '--database', help='Path to database directory')
    args = parser.parse_args()

    if args.database:
        is_blocks = 'blocks/index' in args.dadatabase
        conn = leveldb.LevelDB(args.database)
    else:
        is_blocks = args.blocks
        db = locate_db(args.testnet, 'blocks/index'
                       if args.blocks else 'chainstate')
        conn = leveldb.LevelDB(db)

    try:
        if is_blocks or args.summarize:
            summarize(conn)
        else:
            dump_chainstate_csv(conn)
    except (IOError, KeyboardInterrupt):
        pass


if __name__ == '__main__':
    main()