from __future__ import annotations

from pathlib import Path
import math

import bpy
from mathutils import Vector


SCENE_DIR = Path(r"C:\Users\jimmy\Desktop\Millbygård\07_exports\blender_scene")
INPUT = SCENE_DIR / "millbygard_LADAN_RENSAD.blend"
OUTPUT_BLEND = SCENE_DIR / "millbygard_PRESENTATION_TYDLIG.blend"
OUTPUT_PNG = SCENE_DIR / "millbygard_PRESENTATION_TYDLIG.png"


def mat(name, color):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = color
    m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = 0.65
    return m


def look_at(obj, target):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_marker_plane():
    # A visible cleaned/usable yard area in front of the barn cluster.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(-35, -56, 1.15))
    marker = bpy.context.object
    marker.name = "Markerad gårdsyta utan servitut"
    marker.dimensions = (52, 22, 0.18)
    marker.rotation_euler[2] = math.radians(-3)
    marker.data.materials.append(mat("Tydlig gul gårdsyta", (1.0, 0.74, 0.10, 0.72)))
    marker.show_transparent = True
    return marker


def add_roof_blocks():
    roof_mat = mat("Röda tak - presentation", (0.62, 0.11, 0.055, 1))
    wall_mat = mat("Ljusa byggnadsväggar - presentation", (0.86, 0.82, 0.72, 1))

    buildings = bpy.data.objects.get("Byggnader")
    if buildings:
        buildings.data.materials.clear()
        buildings.data.materials.append(wall_mat)

    # Simple roof caps placed over the most visible imported building blocks.
    roofs = [
        ("Tak lada", (-44, -76, 12.3), (23, 10, 1.0), -4),
        ("Tak bostad", (-10, -63, 9.4), (15, 13, 0.9), -20),
        ("Tak komplement", (-3, -30, 5.0), (9, 7, 0.7), -38),
        ("Tak liten byggnad", (-26, -91, 5.7), (8, 5, 0.6), -6),
    ]
    for name, loc, scale, rot in roofs:
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
        obj = bpy.context.object
        obj.name = name
        obj.dimensions = scale
        obj.rotation_euler[2] = math.radians(rot)
        obj.data.materials.append(roof_mat)


def add_clean_boundary():
    # Keep only an easy-to-read outline around the yard parcel instead of the noisy internal lines.
    curve = bpy.data.curves.new("Ren situationslinje runt gården", "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = 0.45
    points = [(-82, -84, 2), (-78, -39, 2), (-25, -21, 2), (15, -52, 2), (-18, -88, 2), (-82, -84, 2)]
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for p, co in zip(spline.points, points):
        p.co = (co[0], co[1], co[2], 1)
    obj = bpy.data.objects.new("Ren vit situationsgräns", curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat("Vit situationslinje", (1, 1, 0.92, 1)))


def setup_camera_lights():
    for obj in bpy.data.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True

    bpy.ops.object.light_add(type="SUN", location=(-70, -120, 120))
    sun = bpy.context.object
    sun.name = "Tydlig presentationssol"
    sun.data.energy = 2.4
    sun.rotation_euler = (math.radians(48), 0, math.radians(-32))

    bpy.ops.object.light_add(type="AREA", location=(-35, -70, 70))
    fill = bpy.context.object
    fill.name = "Mjuk fyllnad"
    fill.data.energy = 520
    fill.data.size = 90

    cam_data = bpy.data.cameras.new("Kamera - tydlig gårdsbild")
    cam = bpy.data.objects.new("Kamera - tydlig gårdsbild", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (-100, -135, 78)
    cam.data.lens = 58
    look_at(cam, Vector((-32, -58, 7)))
    bpy.context.scene.camera = cam


def main():
    add_roof_blocks()
    add_marker_plane()
    add_clean_boundary()
    setup_camera_lights()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.view_settings.view_transform = "Standard"
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1200
    scene.render.filepath = str(OUTPUT_PNG)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT_BLEND))
    bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
