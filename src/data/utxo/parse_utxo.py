#!/usr/bin/python3

# adaptation from: https://github.com/eklitzke/utxodump/blob/master/utxodump.py
# written by @bitcoingraffiti on 22-02-2022

# README #
# the main function copies the chainstate automatically wen bitcoin core path is set
# this is required as parsing leveldb corrupts the database
# current parser dumps all fields except the script pub key


import binascii
import enum
import os
import json
import leveldb

from numpy import digitize, array
from collections import defaultdict
from typing import Tuple




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
BITCOINCORE_PATH = '/Users/sjorsvanheuveln/Library/Application\ Support/Bitcoin/chainstate'

#stores the aggregated utxos per blockheight
UTXO_HEIGHT = {}


def copy_chainstate():
    """copies the chainstate if dir doesn't exist yet or is empty"""
    if not os.path.isdir('chainstate') or len(os.listdir('./chainstate')) == 0:
        print('Copying chainstate ...');
        os.system("rsync --delete -av " + BITCOINCORE_PATH + " ./")

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


def aggregate_utxo(utxo):
    """order utxo by height and aggregate"""
    if utxo['height'] in UTXO_HEIGHT:
        UTXO_HEIGHT[utxo['height']]['amount'] += utxo['amount']
        UTXO_HEIGHT[utxo['height']]['n'] += 1
    else:
        UTXO_HEIGHT[utxo['height']] = {'amount': utxo['amount'], 'n': 1, 'epoch': get_difficulty_epoch(utxo['height'])}


def get_difficulty_epoch(height):
    """determine difficulty epoch per height"""
    bins = list(range(0, 1000000, 2016)) 
    epoch = digitize(height, bins)

    return int(epoch)


def dump_chainstate_csv(conn: leveldb.LevelDB):
    """utxo parser"""
    secret = get_obfuscate_key(conn)
    i=0

    for k, v in conn.RangeIter(b'C', b'D', include_value=True):
        i+=1
        #txid, vout = decode_key(k)
        decrypt(v, secret)
        height, coinbase, amount, sz = decode_val(v)

        utxo = {
            #"txid": txid,
            #"vout": vout,
            "height": height,
            #"coinbase": coinbase,
            "amount": amount,
            #"scriptsize": sz,
        }

        aggregate_utxo(utxo)
        print(i, end='\r')
        
        # uncomment break for smaller samples
        # if len(UTXO_HEIGHT) == 10000:
        #     break

    with open('utxo_by_height.json', 'w') as fp:
        json.dump(UTXO_HEIGHT, fp, sort_keys=True) #indent=4 for prettyprint


def main():
    """make sure to set your bitcoin core path on top"""
    copy_chainstate()
    conn = leveldb.LevelDB('chainstate')
    dump_chainstate_csv(conn)

if __name__ == '__main__':
    main()