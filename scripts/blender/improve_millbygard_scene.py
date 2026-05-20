from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


SCENE_DIR = Path(r"C:\Users\jimmy\Desktop\Millbygård\07_exports\blender_scene")
OUTPUT_BLEND = SCENE_DIR / "millbygard_scene_improved.blend"
PREVIEW_RENDER = SCENE_DIR / "millbygard_scene_improved_preview.png"
ORTHO_IMAGE = SCENE_DIR / "ortho_texture.png"
SERVITUDE_SEGMENTS_TO_REMOVE = {
    # Internal property/servitude line crossing the barn/yard area.
    "Property_Boundary_Source_curve_010",
    "Property_Boundary_Source_curve_011",
}


def material_principled(name: str, color: tuple[float, float, float, float], roughness: float = 0.75):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
    mat.diffuse_color = color
    return mat


def terrain_ortho_material():
    mat = bpy.data.materials.get("Ortofoto på terräng") or bpy.data.materials.new("Ortofoto på terräng")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    tex = nodes.new("ShaderNodeTexImage")
    tex.name = "Millbygard_Ortho_Texture"
    tex.image = bpy.data.images.load(str(ORTHO_IMAGE), check_existing=True)
    tex.extension = "CLIP"
    tex.image.colorspace_settings.name = "sRGB"
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mat.node_tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    bsdf.inputs["Roughness"].default_value = 0.9
    mat.diffuse_color = (0.72, 0.76, 0.62, 1.0)
    return mat


def uv_map_xy(obj: bpy.types.Object):
    mesh = obj.data
    min_x = min((obj.matrix_world @ v.co).x for v in mesh.vertices)
    max_x = max((obj.matrix_world @ v.co).x for v in mesh.vertices)
    min_y = min((obj.matrix_world @ v.co).y for v in mesh.vertices)
    max_y = max((obj.matrix_world @ v.co).y for v in mesh.vertices)
    width = max_x - min_x or 1.0
    height = max_y - min_y or 1.0

    uv_layer = mesh.uv_layers.get("Ortho_XY") or mesh.uv_layers.new(name="Ortho_XY")
    mesh.uv_layers.active = uv_layer
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vert = mesh.vertices[mesh.loops[loop_index].vertex_index]
            world = obj.matrix_world @ vert.co
            uv_layer.data[loop_index].uv = ((world.x - min_x) / width, (world.y - min_y) / height)


def look_at(obj: bpy.types.Object, target: Vector):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def scene_bounds(mesh_objects: list[bpy.types.Object]):
    coords = []
    for obj in mesh_objects:
        coords.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    min_v = Vector((min(v.x for v in coords), min(v.y for v in coords), min(v.z for v in coords)))
    max_v = Vector((max(v.x for v in coords), max(v.y for v in coords), max(v.z for v in coords)))
    return min_v, max_v


def add_camera(name: str, location: tuple[float, float, float], target: Vector, focal_length: float):
    cam_data = bpy.data.cameras.new(name)
    cam = bpy.data.objects.new(name, cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = location
    cam.data.lens = focal_length
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (Vector(location) - target).length
    cam.data.dof.aperture_fstop = 8
    look_at(cam, target)
    return cam


def main():
    bpy.context.scene.unit_settings.system = "METRIC"
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 96
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.render.resolution_x = 1600
    bpy.context.scene.render.resolution_y = 1100

    terrain = bpy.data.objects.get("Terrain_DEM")
    buildings = bpy.data.objects.get("Buildings_Extruded")

    if terrain:
        uv_map_xy(terrain)
        terrain.data.materials.clear()
        terrain.data.materials.append(terrain_ortho_material())
        terrain.name = "Terräng med ortofoto"
        terrain.data.name = "Terräng med ortofoto mesh"
        bpy.context.view_layer.objects.active = terrain
        terrain.select_set(True)
        bpy.ops.object.shade_smooth()
        terrain.select_set(False)

    if buildings:
        buildings.data.materials.clear()
        buildings.data.materials.append(material_principled("Byggnader - varm grå", (0.58, 0.54, 0.48, 1.0)))
        buildings.name = "Byggnader"

    boundary_mat = material_principled("Fastighetsgräns - blå", (0.0, 0.28, 1.0, 1.0))
    boundary_mat.use_nodes = True
    for obj in bpy.data.objects:
        if obj.name in SERVITUDE_SEGMENTS_TO_REMOVE:
            obj.hide_viewport = True
            obj.hide_render = True
            obj.name = f"{obj.name}_removed_servitut"
            continue
        if obj.name.startswith("Property_Boundary_Source_curve"):
            obj.data.materials.clear()
            obj.data.materials.append(boundary_mat)
            obj.data.bevel_depth = 0.18
            obj.data.resolution_u = 2
            obj.show_in_front = True
        elif obj.name == "Property_Boundary_Source":
            obj.hide_viewport = True
            obj.hide_render = True

    photo_collection = bpy.data.collections.new("Dolda fotopunkter")
    bpy.context.scene.collection.children.link(photo_collection)
    for obj in list(bpy.data.objects):
        if obj.name.startswith("Photo_Point_"):
            obj.hide_viewport = True
            obj.hide_render = True
            for coll in list(obj.users_collection):
                coll.objects.unlink(obj)
            photo_collection.objects.link(obj)

    light_mat = material_principled("Arbetsmarkering - orange", (1.0, 0.42, 0.05, 1.0))
    for obj in bpy.data.objects:
        if "workarea" in obj.name.lower():
            obj.data.materials.clear()
            obj.data.materials.append(light_mat)

    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and not obj.hide_render]
    min_v, max_v = scene_bounds(meshes)
    center = (min_v + max_v) / 2
    span = max(max_v.x - min_v.x, max_v.y - min_v.y)

    bpy.ops.object.light_add(type="SUN", location=(center.x - 80, center.y - 140, center.z + 120))
    sun = bpy.context.object
    sun.name = "Presentation Sun"
    sun.data.energy = 2.2
    sun.rotation_euler = (math.radians(48), 0, math.radians(-35))

    bpy.ops.object.light_add(type="AREA", location=(center.x + 35, center.y - 60, center.z + 80))
    area = bpy.context.object
    area.name = "Presentation Softbox"
    area.data.energy = 450
    area.data.size = 85

    for obj in [o for o in bpy.data.objects if o.type == "CAMERA"]:
        obj.hide_render = True

    overview = add_camera(
        "Kamera - översikt",
        (center.x - span * 0.55, center.y - span * 0.95, max_v.z + span * 0.82),
        center,
        34,
    )
    add_camera(
        "Kamera - låg situationsvy",
        (center.x - span * 0.35, center.y - span * 0.65, max_v.z + span * 0.20),
        Vector((center.x, center.y, center.z + 8)),
        42,
    )
    bpy.context.scene.camera = overview

    empty = bpy.data.objects.new("Scencentrum", None)
    empty.location = center
    bpy.context.collection.objects.link(empty)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    bpy.context.scene.render.filepath = str(PREVIEW_RENDER)
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
