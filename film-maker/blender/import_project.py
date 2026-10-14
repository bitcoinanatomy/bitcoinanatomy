"""
Film Maker → Blender importer (Blender 4.2+; written to also run on 4.4+/5.x APIs).

Builds, from an exported bundle.json:
  * one 3D scene per film scene: environments (world colour, key light, props),
    characters and assets as glTF collection instances (or placeholders), and one
    keyframed camera per shot, bound to timeline markers so cameras cut on time;
  * an "EDIT" scene whose Video Sequencer holds the cut: scene strips, storyboards,
    dialog, SFX, score and subtitle text strips.

Usage
  blender --python import_project.py -- path/to/bundle.json
  blender --background --python import_project.py -- path/to/bundle.json --save out.blend
  or open this file in Blender's Text Editor and Run Script (finds bundle.json next to it).

Coordinates: the bundle is Y-up (three.js / glTF); Blender is Z-up: (x, y, z) -> (x, -z, y).
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

# ----------------------------------------------------------------- helpers


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bundle, save = None, None
    i = 0
    while i < len(argv):
        if argv[i] == "--save" and i + 1 < len(argv):
            save = argv[i + 1]
            i += 2
            continue
        if argv[i].endswith(".json"):
            bundle = argv[i]
        i += 1
    if not bundle:
        candidates = []
        if "__file__" in globals():
            candidates.append(os.path.dirname(os.path.abspath(__file__)))
        for t in bpy.data.texts:
            if t.filepath:
                candidates.append(os.path.dirname(bpy.path.abspath(t.filepath)))
        for d in candidates:
            p = os.path.join(d, "bundle.json")
            if os.path.exists(p):
                bundle = p
                break
    if not bundle:
        raise SystemExit("bundle.json not found: pass it after `--`")
    return os.path.abspath(bundle), save


def v3(p):
    """three.js Y-up -> Blender Z-up"""
    return Vector((p[0], -p[2], p[1]))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgb(h, linear=True):
    h = h.lstrip("#")
    rgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [srgb_to_linear(c) for c in rgb] if linear else rgb


def try_set(obj, **props):
    for k, v in props.items():
        try:
            setattr(obj, k, v)
        except (AttributeError, TypeError, ValueError):
            pass


def strips_of(se):
    # Blender 4.4+ renamed `sequences` to `strips`
    return se.strips if hasattr(se, "strips") else se.sequences


def link(obj, collection):
    collection.objects.link(obj)
    return obj


# ----------------------------------------------------------------- library (meshes as collection instances)


class Library:
    def __init__(self, base):
        self.base = base
        self.cache = {}
        self.scene = bpy.data.scenes.get("_library") or bpy.data.scenes.new("_library")

    def collection(self, key, mesh, color, kind):
        if key in self.cache:
            return self.cache[key]
        col = bpy.data.collections.new(f"LIB_{key}")
        self.scene.collection.children.link(col)
        objs = []
        path = os.path.join(self.base, mesh) if mesh else None
        if path and os.path.exists(path):
            before = set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=path)
            objs = [o for o in bpy.data.objects if o not in before]
            for o in objs:
                for c in list(o.users_collection):
                    c.objects.unlink(o)
                col.objects.link(o)
        if not objs:
            objs = [link(self.placeholder(key, color, kind), col)]
        self.cache[key] = col
        return col

    @staticmethod
    def placeholder(name, color, kind):
        me = bpy.data.meshes.new(f"PH_{name}")
        bm = bmesh.new()
        if kind == "character":
            bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.28, radius2=0.28, depth=1.66)
            bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.83))
        else:
            bmesh.ops.create_cube(bm, size=0.6)
            bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.3))
        bm.to_mesh(me)
        bm.free()
        mat = bpy.data.materials.new(f"PH_{name}")
        mat.diffuse_color = (*hex_rgb(color), 1)
        try:
            mat.use_nodes = True
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            if bsdf:
                bsdf.inputs["Base Color"].default_value = (*hex_rgb(color), 1)
        except Exception:
            pass
        me.materials.append(mat)
        return bpy.data.objects.new(f"PH_{name}", me)


def instance(col, name, collection, pos, rot_y_deg=0.0, scale=1.0):
    e = bpy.data.objects.new(name, None)
    e.instance_type = "COLLECTION"
    e.instance_collection = col
    e.location = v3(pos)
    e.rotation_euler = (0, 0, math.radians(rot_y_deg))
    e.scale = (scale, scale, scale)
    return link(e, collection)


# ----------------------------------------------------------------- build


def setup_scene(scene, b, frame_start, frame_end):
    scene.render.fps = b["project"]["fps"]
    scene.render.resolution_x, scene.render.resolution_y = b["project"]["resolution"]
    scene.frame_start = frame_start
    scene.frame_end = frame_end


def world_for(scene, envs_by_frame, library, base=None):
    """World: the environment's HDRI (equirect .hdr) when it has one, else its background colour.
    Colour/strength are keyed at each shot start when the environment changes."""
    world = bpy.data.worlds.new(f"WORLD_{scene.name}")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    nt = world.node_tree
    bg = nt.nodes.get("Background") if nt else None
    # an HDRI world for the first environment that has one (Blender worlds can't cut mid-scene)
    hdri_env = next((e for _, e in envs_by_frame if e and e.get("hdri")), None)
    if bg and hdri_env and base:
        path = os.path.join(base, hdri_env["hdri"])
        if os.path.exists(path):
            tex = nt.nodes.new("ShaderNodeTexEnvironment")
            tex.image = bpy.data.images.load(path, check_existing=True)
            mapping = nt.nodes.new("ShaderNodeMapping")
            coord = nt.nodes.new("ShaderNodeTexCoord")
            # three.js equirect u=0.5 faces -X; Blender's faces +X, and Blender is Z-up
            mapping.inputs["Rotation"].default_value[2] = math.radians(180 - hdri_env.get("hdriRotation", 0))
            nt.links.new(coord.outputs["Generated"], mapping.inputs["Vector"])
            nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
            nt.links.new(tex.outputs["Color"], bg.inputs[0])
            bg.inputs[1].default_value = hdri_env.get("hdriIntensity", 1.0)
            return
    for frame, env in envs_by_frame:
        color = hex_rgb(env["background"]) if env else [0.002, 0.002, 0.004]
        strength = 1.0 + (env["lighting"]["ambient"] if env else 0.3)
        if bg:
            bg.inputs[0].default_value = (*color, 1)
            bg.inputs[1].default_value = strength
            if len(envs_by_frame) > 1:
                bg.inputs[0].keyframe_insert("default_value", frame=frame)
                bg.inputs[1].keyframe_insert("default_value", frame=frame)
        else:
            world.color = color


def set_interp(kind):
    prefs = bpy.context.preferences.edit
    old = prefs.keyframe_new_interpolation_type
    prefs.keyframe_new_interpolation_type = {"linear": "LINEAR", "constant": "CONSTANT"}.get(kind, "BEZIER")
    return old


def ease_between(obj, f0, f1):
    """Constant-interpolated cast keys hold between shots; walks inside a shot ease (bezier)."""
    ad = obj.animation_data
    if not ad or not ad.action:
        return
    for fc in ad.action.fcurves:
        if fc.data_path not in ("location", "rotation_euler"):
            continue
        for kp in fc.keyframe_points:
            if f0 <= kp.co.x < f1:
                kp.interpolation = "BEZIER"


def build_film_scene(b, sc, lib, prefix):
    scene = bpy.data.scenes.new(f"{prefix}{sc['id']} {sc['title']}"[:63])
    setup_scene(scene, b, sc["frame_start"], sc["frame_end"])
    root = scene.collection
    envs = b["library"]["environments"]

    # environments used by the shots of this scene (shots may override the scene env)
    env_ids = []
    for sh in sc["shots"]:
        if sh["environment"] and sh["environment"] not in env_ids:
            env_ids.append(sh["environment"])
    env_groups = {}
    for env_id in env_ids:
        env = envs.get(env_id)
        if not env:
            continue
        col = bpy.data.collections.new(f"ENV_{env_id}")
        root.children.link(col)
        objs = []
        for i, p in enumerate(env["props"]):
            a = b["library"]["assets"].get(p["asset"])
            if not a:
                continue
            lc = lib.collection(f"asset_{p['asset']}", a["mesh"], a["color"], "asset")
            objs.append(instance(lc, f"{p['asset']}.{i:02d}", col, p["position"], p["rotationY"], a["scale"] * p["scale"]))
        l = env["lighting"]
        sun = bpy.data.lights.new(f"KEY_{env_id}", "SUN")
        sun.energy = l["key"] * 3
        sun.color = hex_rgb(l["keyColor"])
        key = link(bpy.data.objects.new(f"KEY_{env_id}", sun), col)
        key.location = v3(l["keyPosition"])
        key.rotation_euler = (-key.location).to_track_quat("-Z", "Y").to_euler()
        objs.append(key)
        env_groups[env_id] = objs

    # cut environment visibility on shot boundaries
    if len(env_groups) > 1:
        for sh in sc["shots"]:
            for env_id, objs in env_groups.items():
                hidden = env_id != sh["environment"]
                for o in objs:
                    o.hide_render = hidden
                    o.hide_viewport = hidden
                    o.keyframe_insert("hide_render", frame=sh["frame_start"])
                    o.keyframe_insert("hide_viewport", frame=sh["frame_start"])
    world_for(scene, [(sh["frame_start"], envs.get(sh["environment"]) if sh["environment"] else None) for sh in sc["shots"]], lib, lib.base)

    # characters: one instance per scene, keyed (constant) to each shot's blocking and hidden when absent
    cast = bpy.data.collections.new(f"CAST_{sc['id']}")
    root.children.link(cast)
    cast_ids = []
    for sh in sc["shots"]:
        for c in sh["characters"]:
            if c["id"] not in cast_ids:
                cast_ids.append(c["id"])
    old = set_interp("constant")
    try:
        for cid in cast_ids:
            ch = b["library"]["characters"].get(cid, {"mesh": None, "color": "#8aa4ff", "scale": 1})
            lc = lib.collection(f"char_{cid}", ch["mesh"], ch["color"], "character")
            obj = instance(lc, cid, cast, [0, 0, 0], 0, ch["scale"])
            for sh in sc["shots"]:
                here = next((c for c in sh["characters"] if c["id"] == cid), None)
                if here:
                    obj.location = v3(here["position"])
                    obj.rotation_euler = (0, 0, math.radians(here.get("rotationY", 0)))
                    obj.keyframe_insert("location", frame=sh["frame_start"])
                    obj.keyframe_insert("rotation_euler", frame=sh["frame_start"])
                    # walks within the shot: eased keys from the start mark through each move
                    for m in here.get("moves", []):
                        obj.location = v3(m["position"])
                        obj.rotation_euler = (0, 0, math.radians(m.get("rotationY", 0)))
                        obj.keyframe_insert("location", frame=m["frame"])
                        obj.keyframe_insert("rotation_euler", frame=m["frame"])
                    if here.get("moves"):
                        ease_between(obj, sh["frame_start"], here["moves"][-1]["frame"])
                    # expression changes, kept as a custom property (frame -> name) for riggers to drive the face
                    if here.get("expressions"):
                        timeline = dict(obj.get("expressions", {}))
                        timeline.update({str(e["frame"]): e["expression"] for e in here["expressions"]})
                        obj["expressions"] = timeline
                obj.hide_render = obj.hide_viewport = here is None
                obj.keyframe_insert("hide_render", frame=sh["frame_start"])
                obj.keyframe_insert("hide_viewport", frame=sh["frame_start"])
    finally:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = old

    # extra per-shot assets
    placed = set()
    for sh in sc["shots"]:
        for i, aid in enumerate(sh["assets"]):
            if aid in placed:
                continue
            placed.add(aid)
            a = b["library"]["assets"].get(aid)
            if a:
                lc = lib.collection(f"asset_{aid}", a["mesh"], a["color"], "asset")
                instance(lc, aid, cast, [2 + i * 1.5, 0, 1], 0, a["scale"])

    # cameras: one per shot, target empty + Track To, keyed position/target/lens
    cams = bpy.data.collections.new(f"CAMERAS_{sc['id']}")
    root.children.link(cams)
    for sh in sc["shots"]:
        cd = bpy.data.cameras.new(f"CAM_{sh['id']}")
        cd.sensor_fit = "VERTICAL"
        cd.sensor_height = 24.0
        cam = link(bpy.data.objects.new(f"CAM_{sc['id']}_{sh['id']}", cd), cams)
        tgt = link(bpy.data.objects.new(f"CAM_{sc['id']}_{sh['id']}_target", None), cams)
        tgt.empty_display_size = 0.2
        con = cam.constraints.new("TRACK_TO")
        con.target = tgt
        con.track_axis = "TRACK_NEGATIVE_Z"
        con.up_axis = "UP_Y"
        old = set_interp(sh["camera"]["ease"])
        try:
            for k in sh["camera"]["keys"]:
                cam.location = v3(k["position"])
                tgt.location = v3(k["target"])
                cd.lens = 12.0 / math.tan(math.radians(k["fov"]) / 2)
                cam.keyframe_insert("location", frame=k["frame"])
                tgt.keyframe_insert("location", frame=k["frame"])
                cd.keyframe_insert("lens", frame=k["frame"])
        finally:
            bpy.context.preferences.edit.keyframe_new_interpolation_type = old
        m = scene.timeline_markers.new(sh["name"][:63], frame=sh["frame_start"])
        m.camera = cam
        if scene.camera is None:
            scene.camera = cam
        cam["film_maker"] = json.dumps({"shot": sh["id"], "description": sh["description"]})
    return scene


def build_edit(b, scene, film_scenes, base):
    setup_scene(scene, b, b["frame_start"], b["frame_end"])
    se = scene.sequence_editor_create()
    strips = strips_of(se)
    ab = lambda p: os.path.join(base, p)

    for sc, fs in film_scenes:
        s = strips.new_scene(name=sc["title"][:63], scene=fs, channel=1, frame_start=sc["frame_start"])
        try_set(s, frame_final_end=sc["frame_end"] + 1)

    for i, s in enumerate(b["strips"]["storyboard"]):
        path = ab(s["file"])
        if not os.path.exists(path):
            continue
        n = f"board_{i:03d}"
        if path.lower().endswith((".mp4", ".mov", ".webm")):
            st = strips.new_movie(name=n, filepath=path, channel=2, frame_start=s["frame_start"], fit_method="FIT")
            if st.frame_final_end > s["frame_end"]:
                st.frame_final_end = s["frame_end"]
        else:
            st = strips.new_image(name=n, filepath=path, channel=2, frame_start=s["frame_start"], fit_method="FIT")
            st.frame_final_duration = max(1, s["frame_end"] - s["frame_start"])
        try_set(st, blend_alpha=1.0)

    def sound(items, channel, prefix):
        for i, s in enumerate(items):
            if not s.get("file") or not os.path.exists(ab(s["file"])):
                continue
            st = strips.new_sound(name=f"{prefix}_{i:03d}", filepath=ab(s["file"]), channel=channel, frame_start=s["frame_start"] - s.get("offset_frames", 0))
            st.frame_final_start = s["frame_start"]
            if st.frame_final_end > s["frame_end"]:
                st.frame_final_end = s["frame_end"]
            try_set(st, volume=s.get("gain", 1.0))

    sound(b["strips"]["dialog"], 3, "dialog")
    sound(b["strips"]["sfx"], 4, "sfx")
    sound(b["strips"]["score"], 5, "score")

    for i, s in enumerate(b["strips"]["subtitles"]):
        try:
            st = strips.new_effect(name=f"sub_{i:03d}", type="TEXT", channel=6, frame_start=s["frame_start"], frame_end=s["frame_end"])
        except TypeError:
            st = strips.new_effect(name=f"sub_{i:03d}", type="TEXT", channel=6, frame_start=s["frame_start"], length=s["frame_end"] - s["frame_start"])
        st.text = s["text"]
        try_set(st, font_size=40, wrap_width=0.85, use_box=True, box_margin=0.01, align_y="BOTTOM", location=(0.5, 0.06), use_shadow=True)

    # global intro/outro credits: colour background + text strips (+ a scrolling roll)
    def effect(name, kind, channel, fs, fe):
        try:
            return strips.new_effect(name=name, type=kind, channel=channel, frame_start=fs, frame_end=fe)
        except TypeError:
            return strips.new_effect(name=name, type=kind, channel=channel, frame_start=fs, length=fe - fs)

    sizes = {"xl": 120, "lg": 80, "md": 46, "sm": 30}
    anchors = {"center": (0.5, 0.5), "bottom-left": (0.08, 0.12), "top": (0.5, 0.82)}
    for cr in b.get("credits", []):
        bg = effect(f"{cr['kind']}_bg", "COLOR", 7, cr["frame_start"], cr["frame_end"])
        try_set(bg, color=hex_rgb(cr["background"], linear=False))
        for i, card in enumerate(cr["cards"]):
            st = effect(f"{cr['kind']}_card_{i:02d}", "TEXT", 8, card["frame_start"], card["frame_end"])
            st.text = "\n".join(l["text"] for l in card["lines"])
            biggest = max((sizes.get(l["size"], 46) for l in card["lines"]), default=46)
            try_set(st, font_size=biggest, location=anchors.get(card["align"], (0.5, 0.5)), align_x="CENTER" if card["align"] != "bottom-left" else "LEFT",
                    align_y="CENTER", color=(*hex_rgb(cr["color"], linear=False), 1.0))
        if cr.get("roll"):
            r = cr["roll"]
            st = effect(f"{cr['kind']}_roll", "TEXT", 9, r["frame_start"], r["frame_end"])
            st.text = r["text"]
            try_set(st, font_size=40, align_x="CENTER", align_y="TOP", color=(*hex_rgb(cr["color"], linear=False), 1.0))
            try:
                st.location = (0.5, 0.0)
                st.keyframe_insert("location", frame=r["frame_start"])
                st.location = (0.5, 2.2)
                st.keyframe_insert("location", frame=r["frame_end"])
            except Exception:
                pass

    # name the channels when supported (4.0+)
    names = {1: "Scenes", 2: "Storyboard", 3: "Dialog", 4: "SFX", 5: "Score", 6: "Subtitles", 7: "Credits BG", 8: "Credits", 9: "Credit roll"}
    if hasattr(se, "channels"):
        for ch, nm in names.items():
            try:
                se.channels[ch].name = nm
            except Exception:
                pass


def main():
    bundle_path, save = parse_args()
    base = os.path.dirname(bundle_path)
    with open(bundle_path, encoding="utf-8") as f:
        b = json.load(f)
    if b.get("format") != "film-maker-bundle":
        raise SystemExit("not a film-maker bundle")
    ep = b["episode"]
    prefix = f"{ep['id']}_"

    # reuse the empty startup scene as the edit scene
    edit = bpy.data.scenes.get("Scene") if not bpy.data.filepath else None
    if edit:
        for name in ("Cube", "Light", "Camera"):
            o = bpy.data.objects.get(name)
            if o:
                bpy.data.objects.remove(o)
        edit.name = f"EDIT {ep['id']} {ep['title']}"[:63]
    else:
        edit = bpy.data.scenes.new(f"EDIT {ep['id']} {ep['title']}"[:63])

    lib = Library(base)
    film = [(sc, build_film_scene(b, sc, lib, prefix)) for sc in b["scenes"]]
    build_edit(b, edit, film, base)

    if bpy.context.window:
        bpy.context.window.scene = edit
    print(f"[film-maker] built {len(film)} scenes + edit for {ep['id']} {ep['title']} ({b['frame_end']} frames)")
    if save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(save))
        print(f"[film-maker] saved {save}")


main()
