import os, sys
print (sys.version)

## brew install python
## python -m ensurepip --upgrade    OR    python3 -m ensurepip --upgrade
## pip install python-bitcoinrpc    OR    pip3 install python-bitcoinrpc
## command: "/usr/local/bin/python3",
## chmod -R u+rwX,go+rX,go-w /Users/.../bitcoinanatomy/src/data/rcp_block_data 


from bitcoinrpc.authproxy import AuthServiceProxy, JSONRPCException




from datetime import datetime
import json
import socket
from os import walk






print('-----------------------------------------------')
print("\n")
# rpc_user and rpc_password are set in the bitcoin.conf file
rpc_connection = AuthServiceProxy("http://%s:%s@192.168.0.102:8332"%("mynode", "13Xu4dSoPPKt8AaeBdmjeA5k"))
best_block_hash = rpc_connection.getbestblockhash()
best_block_height = rpc_connection.getblockcount()


# Current block height 683878 ~340 difficulty adjustments
print("best_block_hash: " + best_block_hash)
print("best_block_height: " + str(best_block_height))
print("\n")


data_folder = 'rcp_bitcoin_block_data_v6'
data_file_name = data_folder+'_'
data_files = next(walk(data_folder), (None, None, []))[2]


fetch_num_of_blocks = 2016
bottomBlock = 0
topBlock = fetch_num_of_blocks-1
difficultyPeriod = 0
prevtime_prevCycle = 0

# ------- CYCLE ALL DIFFICULTY ADJUSTMENTS -------- #

for i in range( 1, round(best_block_height/1) ):

  if i % fetch_num_of_blocks == 0:


    print("###################################################################################")
    print("\n")
    print(str(difficultyPeriod) + ' : ' + str(bottomBlock) + ' -> ' + str(topBlock))


    # ---- CHECK IF FILE EXISTS ---- #
    # print(data_file_name+str(bottomBlock)+'.json')
    # print(data_files)


    if ( data_file_name+str(bottomBlock).rjust(7, '0')+'.json' in data_files):
        print ("File Exists")
    else:
        print ("No File")
        # ---- CREATE NEW FILE ---- #
        with open(data_folder+'/'+data_file_name+str(bottomBlock).rjust(7, '0')+'.json', 'w') as f:
            f.write('[[]]')



    # define file to store data
    block_data_file = os.path.dirname(__file__) + '/'+data_folder+'/'+data_file_name+str(bottomBlock).rjust(7, '0')+'.json'


    print('----- READ ' + block_data_file)
    print()
    block_distances = []




    with open(block_data_file, "r+") as file:
        data = json.load(file)
        # print(data)

        block_data = data[0]
        length = len(block_data)


        if length > 0:
            print("STARTED")
            last_block = block_data[length-1]
            last_height = last_block[0]["height"]
            fetch_start_at = last_height+1
            prevtime = last_block[1]["time"]
        else:
            print("EMPTY")
            last_height = bottomBlock
            if i == 0 :
                fetch_start_at = 0
            else:
                fetch_start_at = bottomBlock

            # CALCULATE PREV TIME WITH LAST BLOCK OF PREVIOUS FILE
            prevtime = 0
        print("last_time ---- "+str(prevtime))
        print("last_height -- "+str(last_height))








        print("\n")
        print(str(length)+" / "+str(topBlock-bottomBlock+1)+" BLOCKS IN FILE | LAST HEIGHT ON THE FILE at "+str(last_height))
        print("FETCH "+str(fetch_num_of_blocks)+" blocks | STARTING at "+str(fetch_start_at)+" | STOP at "+str(topBlock))



        if length != 0 and (length + bottomBlock) != (last_height+1):
            print('############## -- ERROR: Possible repeated blocks -- ##############')
            break


        for height in range( fetch_start_at, last_height + fetch_num_of_blocks+1 ):

            if last_height < topBlock-1:
                # get block data
                commands = [ [ "getblockhash", height] ]
                block_hashes = rpc_connection.batch_(commands)
                blocks = rpc_connection.batch_([ [ "getblock", h ] for h in block_hashes ])



                block_RCPdata = [[
                    {"height"     : block["height"]},
                    {"time"       : block["time"]},
                    {"nTx"        : block["nTx"]},
                    {"chainwork"  : block["chainwork"]},
                    {"nonce"      : block["nonce"]},
                    {"size"       : block["size"]},
                    {"weight"     : block["weight"]}
                ] for block in blocks ]

                '''
                print(blocks)
                # for testing
                if blocks[0]['height'] == 2050:
                    exit()
                '''

                for block in block_RCPdata:
                    if block[0]['height'] <= topBlock:
                        # print(topBlock-1)
                        # print(block[0]['height'])
                        # Calculate time difference

                        block_in_cycle = block[0]['height'] % fetch_num_of_blocks
                        block.append({"block_in_cycle" : block_in_cycle})

                        if block_in_cycle == 0:
                            if block[0]['height'] == 0:
                                # Genesis block
                                difference = block[1]['time'] - 0
                            else:
                                # First block of each cycle
                                difference = block[1]['time'] - prevtime_prevCycle
                        else:
                            # All other blocks
                            difference = block[1]['time'] - prevtime

                        dt_Current = datetime.fromtimestamp(block[1]['time'])
                        dt_Previous = datetime.fromtimestamp(prevtime)
                        block.append({"time_difference" : difference})

                        print(block)

                        if block_in_cycle == fetch_num_of_blocks-1:
                            # record timestamp of the last block of the previous cycle
                            prevtime_prevCycle = block[1]['time']
                        else:
                            # update the time of the previous block
                            prevtime = block[1]['time']


                        # add block to file
                        with open(block_data_file, "r+") as file:
                            data = json.load(file)
                            data[0].append(block)
                            file.seek(0)
                            # json.dump(data, file, indent=3)
                            json.dump(data, file, separators=(',', ':'))
                            file.write("\n")
                    else:
                        break
            else:
                print('----- COMPLETE ------')
                print(bottomBlock)
                break



        print("\n\n")

        '''
        '''



    bottomBlock = bottomBlock + fetch_num_of_blocks
    topBlock = topBlock + fetch_num_of_blocks

    difficultyPeriod = difficultyPeriod + 1
