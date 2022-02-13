#JUSTIN

import bpy
import math
import time
from datetime import datetime, timedelta
from bpy import context
import builtins as __builtin__
import os, sys
from os import walk
import json
import bmesh
from mathutils import Vector
import random



# ---------- CONSOLE PRINT ----------- #


def console_print(*args, **kwargs):
    for a in context.screen.areas:
        if a.type == 'CONSOLE':
            c = {}
            c['area'] = a
            c['space_data'] = a.spaces.active
            c['region'] = a.regions[-1]
            c['window'] = context.window
            c['screen'] = context.screen
            s = " ".join([str(arg) for arg in args])
            for line in s.split("\n"):
                bpy.ops.console.scrollback_append(c, text=line)

def print(*args, **kwargs):
    """Console print() function."""
    console_print(*args, **kwargs) # to py consoles
    __builtin__.print(*args, **kwargs) # to system console




# ------------- CLASSES -------------- #

def copy_dummy(new_collection):

    # Change the origin ===========================================
    src_obj = bpy.data.objects['UTXOs']


    new_obj = src_obj.copy()

    new_obj.data = src_obj.data.copy()
    new_collection.objects.link(new_obj)


    return new_obj




def bake():
    print ('baking...')

    bpy.ops.object.select_all(action='DESELECT')

    for obj in bpy.data.objects:
        if '_U' in obj.name:
            obj.data = obj.data.copy()
            obj.select_set(True)

    for obj in bpy.data.objects:
        if '_U' in obj.name:
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.join()
            return




def add_driver(source, target, prop, dataPath, index = -1, negative = False, func = ''):
    ''' Add driver to source prop (at index), driven by target dataPath '''

    if index != -1:
        d = source.driver_add( prop, index ).driver
    else:
        d = source.driver_add( prop ).driver

    v = d.variables.new()
    v.name                 = prop
    v.targets[0].id        = target
    v.targets[0].data_path = dataPath

    d.expression = func + "(" + v.name + ")" if func else v.name
    d.expression = d.expression if not negative else "-1 * " + d.expression




def remove_instances():
    print ('Deleting existing geomtery...\n')
    for obj in bpy.data.objects:
        if '_U' in obj.name:
            bpy.data.objects.remove(obj , do_unlink = True)




def create_collection(input_name):

    for col in bpy.data.collections:
        if col.name == input_name:
            return col

    new_collection = bpy.data.collections.new(name=input_name)
    bpy.context.scene.collection.children.link(new_collection)
    return new_collection




def resize_utxo_data(obj, blockValue):


    scale = blockValue / 100



    bpy.context.view_layer.objects.active = obj

    obj.scale = (scale, scale, scale)

    print(bpy.context.view_layer.objects.active)
    print(scale)
    bpy.ops.object.mode_set(mode = 'OBJECT')
    # To do
    # Add bitcoin data as metadata on new object to be referenced later and to help trace:
    # specific blocks, transactions, outputs, coinbase outputs, etc



    return obj




def report(type="START"):
    # This is to help understand the script performance
    print("-------------- " + type + " ------------------------------------------------------------------------------------------ ")
    print("- Max sprials ----------------- %s " % max_spirals)
    print("- Grid layout ----------------- %s " % grid)
    print("- include_transactions -------- %s " % include_transactions)
    print("- bake_after_spiral_creation -- %s " % bake_after_spiral_creation)
    print("- bake_spiral_set ------------- %s " % bake_spiral_set)
    print("- bake_after_creation --------- %s " % bake_after_creation)
    print("- Blocks per spiral ----------- %s " % nof_blocks_per_spiral)
    print("- Spirals --------------------- %s " % nof_spirals)
    print("- Offset ---------------------- %s " % offset_spirals)
    print("- Total blocks ---------------- %s " % str(nof_blocks_per_spiral * nof_spirals))
    if type=="START":
        now = datetime.now()
        date_time = now.strftime("%m/%d/%Y, %H:%M:%S")
        print("- Start time ------------------ %s " % date_time)
    else:
        print("- Exectution time ------------- %s " % str(timedelta(seconds=(time.time() - start_time))))
    print("----------------------------------------------------------------------------------------------------------------------\n")












'''
JUSTIN - PRIORITY 3
Made this into a seperate class so we could run it in seperate processes
using multi-process native to python. Still incomplete...
'''


def build():


    # --------------- INITIALIZE --------------- #

    # define objects
    new_collection = create_collection('OutputUTXO')
    ob_driver      = bpy.data.objects['Driver']
    helix          = bpy.data.objects['OriginUTXO']

    nBestHeight = 0
    index_spiral = 1
    phi_spiral = 0
    spiral_distance = spiral_distance_deg * math.pi / 180
    radius_spiral = radius_spiral_start




    helix.rotation_euler[0] = 0

    bpy.context.preferences.edit.use_global_undo = False

    #remove_instances()

    bpy.data.objects['Driver'].animation_data.action.fcurves[0].keyframe_points[0].co[1] = nof_blocks_per_spiral * nof_spirals





    #  --------------- SPIRAL LOOP --------------- #

    while index_spiral <= (nof_spirals+offset_spirals) and index_spiral <= max_spirals:


        # --- Open json file --- #
        if grid:
            file_index = grid_block[index_spiral-1]
            with open(data_folder+data_files[file_index]) as data_list:
                data = json.load(data_list)
        else:
            # Load data sequnecially
            file_index = index_spiral-1
            with open(data_folder+data_files[index_spiral-1]) as data_list:
                data = json.load(data_list)
                # print(data[0])




        # --- Set up position for each sprial --- #

        if grid:
            # grid layout calculation
            x_offset = ( (index_grid_pos-1) % cols ) * gutter
            if ((index_grid_pos-1) % cols) == 0:
                y_offset = y_offset - gutter
                x_offset = 0

            index_grid_pos += 1

        else:
            # helix layout calculation
            x_offset = helix_groth * (index_spiral - 1)
            y_offset = 0

        # --- Block Loop  --- #
        index_block = 0
        phi_spiral = 0
        radius_outer_end = radius_spiral





        # Offset spirals
        if index_spiral >= offset_spirals:

            print("START BUILDING SPIRAL %s ---------- %s - %s" % ( str(index_spiral), data_files[file_index], str(timedelta(seconds=(time.time() - start_time))) ) )

            # Add blocks for each spiral
            while index_block <= nof_blocks_per_spiral-1:


                if index_block == nof_blocks_per_spiral-1:
                    # igonre the last block
                    block_dinstance = 0
                else:
                    block_dinstance = round( data[0][index_block+1][8]['time_difference'] / 60)


                # print(str(index_block) + ' - ' + str(block_dinstance))


                # Shift a frane if we end up animating that way.
                # If we animate frame by frame we can bake whole difficulty adjustment periods.
                # May be we can back the ones behind to save space.
                bpy.context.scene.frame_set(index_block)



                #copy object and rename

                txN = data[0][index_block-1][2]['nTx']

                new_obj = copy_dummy(new_collection)




                # SATS SIZER **********************************************************
                # Calculate the current blockReaward
                # Todo: Replace with actrual data
                # Temp: Show all bitcoin mined

                # int64 nSubsidy = 50 * COIN;
                COIN = 100000000
                nSubsidy = 50*COIN
                nSubsidy_updated = nSubsidy

                nBestHeight = data[0][index_block][0]['height']


                print("nBestHeight " + str(nBestHeight) + "  ----- /210000 ==== " + str(nBestHeight / 210000))

                #nSubsidy >>= (nBestHeight / 210000);
                nSubsidy = nSubsidy / 2**math.ceil(nBestHeight / 210000)

                fees = 0
                blockValue = nSubsidy + fees
                resize_utxo_data(new_obj, blockValue/COIN)

                # SATS SIZER **********************************************************




                new_obj.name = '_U' + str(index_spiral) + '_B' + str(index_block)
                nBestHeight = nBestHeight + 1


                # Reset location on difficulty adjustment
                '''
                if index_spiral % 2 != 0:
                    radius_spiral = radius_spiral_start + factor_spiral_growth * phi_spiral
                else:
                    radius_spiral = radius_outer_end - factor_spiral_growth * phi_spiral
                '''
                # Remove alternate spiral start, always at the center
                radius_spiral = radius_spiral_start + factor_spiral_growth * phi_spiral



                # New: fetching from json
                arc_distance = factor_block_distance * ( pow( block_dinstance, 0.9) + 1)
                #print("block " + str(index_block +(2016*(index_spiral-1))) + " - distance " + str(block_dinstance) + " - arc distance " + str(arc_distance))



                # phi_spiral = phi_spiral + math.asin(arc_distance / radius_spiral)
                phi_spiral += (180 / math.pi ) * abs(arc_distance) / radius_spiral





                # UTXO SPACER **********************************************************
                # starts placing the sats outside of
                # the diameter of the block spiral

                blocks_center = 5

                x_inner = (radius_spiral + blocks_center) * math.cos(phi_spiral) + x_offset
                y_inner = (radius_spiral + blocks_center) * math.sin(phi_spiral) + radius_helix + y_offset
                z_inner = 0

                # UTXO SPACER **********************************************************


                #stairway
                if index_block > nof_blocks_per_spiral - nof_stairway_blocks:
                    #z_inner = z_inner
                    #z_inner = (index_block - nof_blocks_per_spiral + nof_stairway_blocks) * ( (spiral_distance * fac_stairway_height) /  nof_stairway_blocks) + (index_spiral -1) * spiral_distance * fac_stairway_height
                    z_inner = (index_block  + nof_stairway_blocks - nof_blocks_per_spiral) *  fac_stairway_height


                new_obj.location = (start_value_x_loc + x_inner , start_value_y_loc + y_inner, start_value_z_loc + z_inner)
                new_obj.rotation_euler[2] = phi_spiral





                # Adding drivers
                if (not bake_after_creation) and (not bake_after_spiral_creation):
                    add_driver(new_obj, ob_driver , 'hide_viewport', 'location.z', -1 , False , '1/' +  str((-index_block - ((index_spiral - 1) * nof_blocks_per_spiral) + nof_blocks_per_spiral * nof_spirals) + 1) + '*' )
                    add_driver(new_obj, ob_driver , 'hide_render'  , 'location.z', -1 , False , '1/'  +  str((-index_block - ((index_spiral - 1) * nof_blocks_per_spiral) + nof_blocks_per_spiral * nof_spirals) + 1) + '*' )



                # Recalculate Indeces
                index_block += 1




        # Rotate helix
        if not grid:
            helix.rotation_euler[0] = spiral_distance * (index_spiral - 1)

        bpy.context.view_layer.update()

        for obj in bpy.data.objects:
            if '_U' + str(index_spiral) in obj.name:

                matrixcopy = obj.matrix_world.copy()
                obj.parent = None
                obj.matrix_world = matrixcopy







        # --------------- BAKING SPIRALS --------------- #
        '''
        JUSTIN - PRIORITY 2
        This new section bakes each spirar after it is complete
        It would be great if we could bake each spiral after a couple
        of spirals that remian unbaked:
            spiral 0 to 10: no bake, keep blocks seperare
            spiral 11 to 340: bake spirals
            spiral 341 to 350: no bake
        But keep in mind that for testing, I usually change the
        number of blocks per sprial and the number of spirals
        to calculate.
        '''

        # Bake after sprial
        if bake_after_spiral_creation:

            bpy.ops.object.select_all(action='DESELECT')

            # Select spiral
            for obj in bpy.data.objects:
                if ('_U'+str(index_spiral)) in obj.name:
                    # print(obj)
                    obj.data = obj.data.copy()
                    obj.select_set(True)

            # Bake current spiral
            for obj in bpy.data.objects:
                if ('_U'+str(index_spiral)) in obj.name:
                    print(obj)
                    bpy.context.view_layer.objects.active = obj
                    bpy.ops.object.join()


                    # --------------- BAKING SET OF SPIRALS --------------- #


                    # Bake every X sprials to peed up the process
                    if bake_spiral_set:
                        if index_spiral % spirals_per_set == 0:

                            for obj in bpy.data.objects:
                                if ('_U') in obj.name:
                                    if not ('_U'+str(index_spiral)) in obj.name:
                                        print(obj)
                                        obj.data = obj.data.copy()
                                        obj.select_set(True)

                            for obj in bpy.data.objects:
                                if ('_U') in obj.name:
                                    if not ('_U'+str(index_spiral)) in obj.name:
                                        print(bpy.context.selected_objects)
                                        bpy.context.view_layer.objects.active = obj
                                        bpy.ops.object.join()
                                    break
                            print('\n************************* SET OF SPIRALS BAKED **************************\n')

                    else:
                        # Add visibitlity driver to individual spirals
                        add_driver(obj, ob_driver , 'hide_viewport', 'location.z', -1 , False , '1/' + str((-index_block - ((index_spiral - 1) * nof_blocks_per_spiral) + nof_blocks_per_spiral * nof_spirals) + 1) + '*' )
                        add_driver(obj, ob_driver , 'hide_render'  , 'location.z', -1 , False , '1/' + str((-index_block - ((index_spiral - 1) * nof_blocks_per_spiral) + nof_blocks_per_spiral * nof_spirals) + 1) + '*' )


                    # not sure what the parameters in add driver are
                    # print('1/' +  str((-index_block - ((index_spiral - 1) * nof_blocks_per_spiral) + nof_blocks_per_spiral * nof_spirals) + 1) + '*')
                    print('\n######################## SPRIAL %s BAKED #########################\n' % index_spiral)

                    break


        index_spiral += 1

    if bake_after_creation:
        bake()






# ---------- BLOCK DATA ----------- #

'''
A chart with the block times https://bitinfocharts.com/comparison/bitcoin-confirmationtime.html — This detirmines how far apart the blocks are from eachother
A chart with the difficulty addjusted over time https://www.coinwarz.com/mining/bitcoin/difficulty-chart — This determins how wide each spiral is.
'''

path = os.path.dirname(__file__)
file_path = os.path.dirname(path)

data_folder = file_path+'/rcp_bitcoin_block_data_v6/'
data_file_name = 'rcp_bitcoin_block_data_v6_'
data_files = next(walk(data_folder), (None, None, []))[2]


# List all data files and remove non .jsone os outr
for data_file in data_files:
    if not data_file.endswith('.json'):
        data_files.remove(data_file)


data_files.sort()
max_spirals = len(data_files)




# -------------- RANGES ------------ #

# 2016 blocks per difficulty adjustments
nof_blocks_per_spiral = round(2016)

# Curently at 350 difficulty adjustments
nof_spirals = round(14)

# Skip n spirals
# 210000 / 2016 = 104
offset_spirals = 104+104+100+8
offset_spirals = 104+104+100-8-10
offset_spirals = 300


# -------------- SPIRAL PARAMETERS -------------- #

factor_block_distance = 0.0005

radius_spiral_start = 0.1

# Space betweeb each spiral lines
factor_spiral_growth = .015
factor_spiral_growth = .020


# Removed stairs
# Stairs
nof_stairway_blocks = 5
nof_stairway_blocks = 0

# May tweak
fac_stairway_height = .03


# -------------- GRID LAYOUT PARAMETERS -------------- #

grid = False
cols = 4
gutter = 30

index_grid_pos = 1

grid_block = [0,1,10,23,    32,33,34,35,    103,212,347,348]



# -------------- HELIX LAYOUT PARAMETERS -------------- #

radius_helix = 15
# 180 degrees per halivng
spiral_distance_deg =  1.7307

# 360 degrees per halivng
# spiral_distance_deg =  3.4615

helix_groth = .15




# ------------- CONTRUCT ------------- #

# Script timer
start_time = time.time()


# Baking
bake_after_spiral_creation = True
bake_spiral_set = False
spirals_per_set = 4
bake_after_creation = False

include_transactions = True


start_value_x_loc = 0
start_value_y_loc = 0
start_value_z_loc = 0


x_offset = 0
y_offset = 0
z_offset = 0



report("START")
build()
report("END")



bpy.context.scene.frame_set(1250)
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
