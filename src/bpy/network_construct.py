import bpy
import math
import random
import bmesh

#Variables
obj_name = 'bitcoin_mesh'
NOF_Nodes = 600
Arr_Nodes = []
Arr_Connections = []
bound_L = int(-math.pi)
bound_U = int(math.pi)
location_preciseness = 100000
Radius = 200
Min_Connections_Per_Node = 8
Max_Connections_Per_Node = 20
NOF_Connections = 0
#the smaller, the more likely the connection between close nodes (exponential).
#Dont go too low, otherwise connection probability is too low and it takes too long
distance_threshhold_exponent = .05

#classes

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

def create_collection(input_name):

    for col in bpy.data.collections:
        if col.name == input_name:
            return col

    new_collection = bpy.data.collections.new(name=input_name)
    bpy.context.scene.collection.children.link(new_collection)
    return new_collection

def copy_object( source , new_name , target_collection ):
    new_obj = source.copy()
    new_obj.data = source.data.copy()
    new_obj.animation_data_clear()
    new_obj.name = new_name
    target_collection.objects.link(new_obj)
    return new_obj

def select_object(obj,active,only):
    if only:
        bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    if active:
        bpy.context.view_layer.objects.active = obj

class Node:
  def __init__(self):
    self.phi = random.randrange(bound_L *  location_preciseness, bound_U * location_preciseness) / location_preciseness
    self.teta = random.randrange(bound_L *  location_preciseness, bound_U * location_preciseness) / location_preciseness
    self.connection_nodes = []
    self.x = Radius * math.sin(self.teta) * math.cos(self.phi)
    self.y = Radius * math.sin(self.teta) * math.sin(self.phi)
    self.z = Radius * math.cos(self.teta)

def check_for_connections():
    for Node in Arr_Nodes:
        if len(Node.connection_nodes) < Min_Connections_Per_Node:
            return False
    return True

def p2p_distance( x1 , y1 , z1 , x2 , y2 , z2 ):
    return  math.sqrt(math.pow((x2 - x1),2) + math.pow((y2 - y2),2) + math.pow((z2 - z1),2))

output_collection = create_collection('output')

#Populate Nodes
for N in range(NOF_Nodes):
    New_Node = Node()
    Arr_Nodes.append(New_Node)
    print('Created Node # ' + str(N + 1 ) + ' with randomized coordinates ' + str(Arr_Nodes[ N ].phi) + ' and ' + str(Arr_Nodes[ N ].teta) )

#Create Random Connections until every node has at least min and max Connections defined
while not check_for_connections():
    connection_1 = random.randrange( 0 , NOF_Nodes )
    connection_2 = random.randrange( 0 , NOF_Nodes )

    #calc distance between connection
    dist = p2p_distance(Arr_Nodes[connection_1].x,Arr_Nodes[connection_1].y,Arr_Nodes[connection_1].z,Arr_Nodes[connection_2].x,Arr_Nodes[connection_2].y,Arr_Nodes[connection_2].z)
    dist_randomized = random.randrange( 0 , (Radius * 2) * 100 ) / 100
    decision = math.pow(dist,distance_threshhold_exponent) < (math.pow((Radius * 2),distance_threshhold_exponent) - math.pow((dist_randomized), distance_threshhold_exponent))
    #print(str(dist) + '  ' +  str(dist_randomized) + '   ' + str(decision))


    if decision and connection_1 != connection_2 and len(Arr_Nodes[connection_1].connection_nodes) <  Max_Connections_Per_Node and len(Arr_Nodes[connection_2].connection_nodes) <  Max_Connections_Per_Node:
        Arr_Nodes[connection_1].connection_nodes.append(Arr_Nodes[connection_2])
        Arr_Nodes[connection_2].connection_nodes.append(Arr_Nodes[connection_1])
        NOF_Connections += 1
        Arr_Connections.append([connection_1 , connection_2])

print (str (NOF_Connections) + ' were made!' )p


#delete old objects
for obj in bpy.data.objects:
    if obj_name in obj.name:
        bpy.data.objects.remove(obj, do_unlink=True)

#create mesh
mesh = bpy.data.meshes.new(obj_name)  # add the new mesh
bitcoin_obj = bpy.data.objects.new(mesh.name, mesh)
output_collection.objects.link(bitcoin_obj)
#bpy.context.view_layer.objects.active = bitcoin_obj

#create vertex matrix
verts = []
edges = []
faces = []

for Node in Arr_Nodes:
    verts.append( [ Node.x , Node.y , Node.z ] )

for Connection in Arr_Connections:
    edges.append ( [Connection[0] , Connection[1] ] )

mesh.from_pydata(verts, edges, faces)

select_object(bitcoin_obj,True,True)

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='DESELECT')

me = bitcoin_obj.data
bm = bmesh.from_edit_mesh(me)
bm.select_mode = {'EDGE'}

for edge in bm.edges:
    edge.select_set(True)
    bpy.ops.mesh.split()

bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
me.update()

bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.select_all(action='DESELECT')

#make solid
for i,obj in enumerate(bpy.data.objects):
    if obj_name in obj.name:
        preserve_obj = copy_object(obj , obj.name + '_preserved' , output_collection)

        bpy.ops.object.select_all(action='DESELECT')
        select_object(obj,True,True)
        bpy.ops.object.convert(target='CURVE')
        bpy.context.object.data.bevel_mode = 'OBJECT'
        bpy.context.object.data.bevel_object = bpy.data.objects["connection_diameter"]
        bpy.ops.object.convert(target='MESH')

        bpy.ops.object.select_all(action='DESELECT')

        #parent end node to preserved
        select_object(bpy.data.objects['end_point'],False,True)
        select_object(preserve_obj,True,False)

        bpy.context.view_layer.objects.active = preserve_obj
        bpy.ops.object.parent_set(type='OBJECT', keep_transform=False)
        bpy.context.object.instance_type = 'VERTS'
        bpy.ops.object.duplicates_make_real()
        bpy.data.objects.remove(preserve_obj, do_unlink=True)
        bpy.data.objects['end_point'].select_set(False)

        #select_object(preserve_obj,False,False)
        select_object(obj,True,False)
        bpy.ops.object.join()
        bpy.ops.object.shade_smooth()

obj_driver = bpy.data.objects['driver']
for i,obj in enumerate(output_collection.objects):
    add_driver(obj, obj_driver , 'hide_viewport', 'location.z', -1 , False , '1/'  + str(i) + '*' )
    add_driver(obj, obj_driver , 'hide_render', 'location.z', -1 , False , '1/'  + str(i) + '*' )
