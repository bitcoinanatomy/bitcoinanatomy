#!/usr/bin/python3

# written by @bitcoingraffiti on 23-02-2022
# Exploratory plotting on the utxoset

import json
import matplotlib.pyplot as plt

EPOCH = {}

def aggregate_epoch(utxo_set, epochs):
    for height, utxo in utxo_set.items():
        if utxo['epoch'] in EPOCH:
            EPOCH[utxo['epoch']]['amount'] += utxo['amount']
            EPOCH[utxo['epoch']]['n'] += utxo['n']
        else:
            EPOCH[utxo['epoch']] = {'amount': utxo['amount'], 'n': utxo['n']}

def plot_epoch(utxo_set):
    epochs = [utxo['epoch'] for utxo in utxo_set.values()]
    aggregate_epoch(utxo_set, epochs)


    print(EPOCH)
    epochs = list(EPOCH.keys())
    amounts = [epoch['amount'] * pow(10, -8) for epoch in EPOCH.values()]

    plt.bar(epochs, amounts)
    plt.title('UTXO BTC per Epoch', fontsize=12)
    plt.xlabel('difficulty epoch')
    plt.show()

def plot_height(utxo_set):
    max_height = max(list(utxo_set.keys())
    print('h', max_height)

def main():
    f = open('./utxo_by_height.json', 'r')
    utxo_set = json.load(f)
    f.close()

    #plot_epoch(utxo_set)
    plot_height(utxo_set)

if __name__ == '__main__':
    main()




# PLOTS
# plt.bar(heights, amounts)
# plt.title('UTXO sats per Height')
# plt.xticks(rotation='vertical')
# plt.show()

