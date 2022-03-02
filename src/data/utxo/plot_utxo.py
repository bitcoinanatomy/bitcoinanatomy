#!/usr/bin/python3

# written by @bitcoingraffiti on 23-02-2022
# Exploratory plotting on the utxoset

# README
# Plotting per height is computationally hard and not very pretty. 
# Data best viewed aggregated per e.g. epoch.

# TODO
# Other variables can be plotted like: scriptsize, coinbase or amount of utxos.

import json
import matplotlib.pyplot as plt

EPOCH = {}

def aggregate_epoch(utxo_set, epochs):
    #combine heights into epochs
    for height, utxo in utxo_set.items():
        if utxo['epoch'] in EPOCH:
            EPOCH[utxo['epoch']]['amount'] += utxo['amount'] #satoshis
            EPOCH[utxo['epoch']]['n'] += utxo['n'] #amount of utxos
        else:
            EPOCH[utxo['epoch']] = {'amount': utxo['amount'], 'n': utxo['n']}

def plot_epoch(utxo_set):
    epochs = [utxo['epoch'] for utxo in utxo_set.values()]
    aggregate_epoch(utxo_set, epochs)

    epochs = list(EPOCH.keys())
    amounts = [epoch['amount'] * pow(10, -8) for epoch in EPOCH.values()]

    plt.bar(epochs, amounts)
    plt.title('UTXO BTC per Epoch', fontsize=12)
    plt.xlabel('difficulty epoch')
    plt.show()

def main():
    f = open('./utxo_by_height.json', 'r')
    utxo_set = json.load(f)
    f.close()

    plot_epoch(utxo_set)

if __name__ == '__main__':
    main()

