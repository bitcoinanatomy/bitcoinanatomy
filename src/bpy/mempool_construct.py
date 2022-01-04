import bpy
import math
import random

# --- Variables --- #
#baking
bake_after_creation = False


nof_TXs_per_set = 2000
factor_TX_distance = 0.1
radius_TX_set_start = 5
radius_TX_set = radius_TX_set_start
nof_TX_sets = 16


print("start: ")

start_value_x_loc = 0
start_value_y_loc = 0
start_value_z_loc = 0

# Classes
def copy_dummy():
    new_obj = src_obj.copy()
    #new_obj.data = src_obj.data.copy()
    new_collection.objects.link(new_obj)
    return new_obj

def bake():
    print ('baking...')
    bpy.ops.object.select_all(action='DESELECT')
    for obj in bpy.data.objects:
        if '_S' in obj.name:
            obj.data = obj.data.copy()
            obj.select_set(True)
    for obj in bpy.data.objects:
        if '_S' in obj.name:
            bpy.context.view_layer.objects.active = obj
            bpy.ops.object.join()
            return

def add_driver(
        source, target, prop, dataPath,
        index = -1, negative = False, func = ''
    ):
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
    print ('deleting...')
    for obj in bpy.data.objects:
        if '_M' in obj.name:
            bpy.data.objects.remove(obj , do_unlink = True)

def create_collection(input_name):
    for col in bpy.data.collections:
        if col.name == input_name:
            return col
    new_collection = bpy.data.collections.new(name=input_name)
    bpy.context.scene.collection.children.link(new_collection)
    return new_collection

# --- init --- #

index_block_distance = 0
index_TX_set = 1
phi_set_circle = 0


src_obj = bpy.data.objects['Tx_small']

new_collection = create_collection('Output_mempool')


bpy.context.preferences.edit.use_global_undo = False
remove_instances()



# --- Spiral Loop  --- #
while index_TX_set <= nof_TX_sets:


    # --- Block Loop  --- #
    index_block = 1
    phi_set_circle = 0


    while index_block <= nof_TXs_per_set:

        #copy object and rename
        new_obj = copy_dummy()
        new_obj.name = '_M' + str(index_TX_set) + '_T' + str(index_block)

        # distance variation from center
        # radius_TX_set = radius_TX_set_start + (random.randint(0,random.randint(50,200)) / 100)
        radius_TX_set = radius_TX_set_start + random.randint(radius_TX_set_start,((radius_TX_set_start+index_TX_set*100)))/200

        # distance along the spiral (full circle 6.28)
        phi_set_circle = random.randint(0,628) / 100
        '''
        if index_TX_set == 1:
            phi_set_circle = random.randint(0,round(index_block/2)) / 100
        elif index_TX_set == 2:
            phi_set_circle = random.randint(0,round(index_block/2)) / 100
        elif index_TX_set == 3:
            phi_set_circle = random.randint(0,index_block*index_TX_set) / 100
        elif index_TX_set == 4:
            phi_set_circle = random.randint(0,index_block*index_TX_set) / 100
        elif index_TX_set == 5:
            phi_set_circle = random.randint(0,628) / 100
        elif index_TX_set == 6:
            phi_set_circle = random.randint(0,628) / 100
        elif index_TX_set == 7:
            phi_set_circle = random.randint(random.randint(0,628),628) / 100
        elif index_TX_set == 8:
            phi_set_circle = random.randint(0,index_block) / 100
        elif index_TX_set == 9:
            phi_set_circle = random.randint(0,index_block*index_TX_set) / 100
        elif index_TX_set == 10:
            phi_set_circle = random.randint(0,index_block*index_TX_set) / 100
        elif index_TX_set == 11:
            phi_set_circle = random.randint(0,628) / 100
        elif index_TX_set == 12:
            phi_set_circle = random.randint(0,628) / 100
        elif index_TX_set == 13:
            phi_set_circle = random.randint(random.randint(0,628),628) / 100
            radius_TX_set = radius_TX_set_start + (random.randint(0,random.randint(0,300)) / 100)
        elif index_TX_set == 14:
            phi_set_circle = random.randint(random.randint(50,628),628) / 100
            radius_TX_set = radius_TX_set_start + (random.randint(0,random.randint(50,350)) / 100)
        elif index_TX_set == 15:
            phi_set_circle = random.randint(random.randint(100,628),628) / 100
            radius_TX_set = radius_TX_set_start + (random.randint(0,random.randint(150,500)) / 100)
        elif index_TX_set == 16:
            phi_set_circle = random.randint(random.randint(300,628),628) / 100
            radius_TX_set = radius_TX_set_start + (random.randint(0,random.randint(300,600)) / 100)
        '''



        x_inner = radius_TX_set * math.cos(phi_set_circle)
        y_inner = radius_TX_set * math.sin(phi_set_circle)
        z_inner = random.randint(random.randint(-100,0),random.randint(0,100)) /100


        tx_objs = ['Tx_small','Tx_medium','Tx_big','Tx_big2']
        src_obj_name = tx_objs[random.randint(0,random.randint(0,random.randint(0,3)))]
        src_obj = bpy.data.objects[src_obj_name]

        #info
        print("Spiral # " + str(index_TX_set) +  " Block # " + str(index_block) )

        new_obj.location = (start_value_x_loc + x_inner , start_value_y_loc + y_inner, start_value_z_loc + z_inner)
        new_obj.rotation_euler[2] = phi_set_circle

        #adding drivers
        if not bake_after_creation:
            add_driver(new_obj, bpy.data.objects['Mempool_Driver_'+ str(index_TX_set)] , 'hide_viewport', 'location.z', -1 , False , '1/' +  str((-index_block - ((index_TX_set - 1) * nof_TXs_per_set) + nof_TXs_per_set * nof_TX_sets) + 1) + '*' )
            add_driver(new_obj, bpy.data.objects['Mempool_Driver_'+ str(index_TX_set)] , 'hide_render', 'location.z', -1 , False , '1/'  +  str((-index_block - ((index_TX_set - 1) * nof_TXs_per_set) + nof_TXs_per_set * nof_TX_sets) + 1) + '*' )

            # Parent each trasaction
            new_obj.parent = bpy.data.objects['mempool_group_'+ str(index_TX_set)]

            print('mempool_group_'+ str(index_TX_set))

        # Recalculate Indeces
        index_block += 1



    # Close set loop
    bpy.context.view_layer.update()

    for obj in bpy.data.objects:
        if '_M' + str(nof_TX_sets) in obj.name:
            matrixcopy = obj.matrix_world.copy()
            #obj.parent = None
            obj.matrix_world = matrixcopy

    # Parent all transaction sets
    bpy.data.objects['mempool_group_' + str(index_TX_set)].parent = bpy.data.objects['mempool_holder']

    # Position first keyframe of each transaction set driver
    bpy.data.objects['Mempool_Driver_' + str(index_TX_set)].animation_data.action.fcurves[0].keyframe_points[0].co[1] = nof_TXs_per_set * (nof_TX_sets - index_TX_set) + nof_TXs_per_set
    bpy.data.objects['Mempool_Driver_' + str(index_TX_set)].animation_data.action.fcurves[0].keyframe_points[2].co[1] = nof_TXs_per_set * (nof_TX_sets - index_TX_set) + nof_TXs_per_set
    bpy.data.objects['Mempool_Driver_' + str(index_TX_set)].animation_data.action.fcurves[0].keyframe_points[3].co[1] = nof_TXs_per_set * (nof_TX_sets - index_TX_set) + nof_TXs_per_set

    '''
    for keyframe in bpy.data.objects['Mempool_Driver_' + str(index_TX_set)].animation_data.action.fcurves[0].keyframe_points:
        # relative_keyframe_location = keyframe.co[1] - nof_TXs_per_set * (nof_TX_sets - index_TX_set)
        old_nof_TXs_per_set = 500
        old_nof_TX_sets = 4
        relative_keyframe_location = keyframe.co[1] - old_nof_TXs_per_set * (old_nof_TX_sets - index_TX_set)
        print("relative loc: " + str(relative_keyframe_location))
        keyframe.co[1] = relative_keyframe_location + nof_TXs_per_set * (nof_TX_sets - index_TX_set)
    '''


    index_TX_set += 1

if bake_after_creation:
    bake()
