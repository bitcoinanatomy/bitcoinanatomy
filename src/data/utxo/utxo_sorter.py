#!/usr/bin/python3

# written by @bitcoingraffiti on 23-02-2022
# Sorts utxo data by height

import json


f = open('utxo.json')
utxo = json.load(open('utxo.json'))
f.close()

arr.sort(key = lambda utxo: utxo['height'], reverse=True)
