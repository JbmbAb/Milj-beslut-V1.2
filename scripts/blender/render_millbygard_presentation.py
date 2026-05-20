from __future__ import annotations

import math
from pathlib import Path

import bpy
from mathutils import Vector


SCENE_DIR = Path(r"C:\Users\jimmy\Desktop\Millbygård\07_exports\blender_scene")
OUTPUT = SCENE_DIR / "millbygard_presentation_render.png"


def look_at(obj: bpy.types.Object, target: Vector):
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def set_world():
    bpy.context.scene.world = bpy.context.scene.world or bpy.data.worlds.new("World")
    bpy.context.scene.world.color = (0.055, 0.06, 0.058)


def make_camera():
    target = Vector((-32, -55, 8))
    cam_data = bpy.data.cameras.new("Kamera - presentationsbild")
    cam = bpy.data.objects.new("Kamera - presentationsbild", cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (-112, -158, 92)
    cam.data.lens = 52
    cam.data.sensor_width = 32
    cam.data.dof.use_dof = True
    cam.data.dof.focus_distance = (Vector(cam.location) - target).length
    cam.data.dof.aperture_fstop = 9
    look_at(cam, target)
    bpy.context.scene.camera = cam


def tune_lights():
    for obj in bpy.data.objects:
        if obj.type == "LIGHT":
            obj.hide_render = True
            obj.hide_viewport = True

    bpy.ops.object.light_add(type="SUN", location=(-90, -120, 160))
    sun = bpy.context.object
    sun.name = "Render Sun - låg kvällsvinkel"
    sun.data.energy = 1.7
    sun.rotation_euler = (math.radians(46), 0, math.radians(-38))

    bpy.ops.object.light_add(type="AREA", location=(-45, -105, 78))
    area = bpy.context.object
    area.name = "Render Soft Fill"
    area.data.energy = 360
    area.data.size = 110


def tune_materials():
    for mat in bpy.data.materials:
        if "Fastighetsgräns" in mat.name:
            mat.diffuse_color = (0.95, 0.95, 0.9, 1.0)
            if mat.use_nodes:
                bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf:
                    bsdf.inputs["Base Color"].default_value = (0.95, 0.95, 0.9, 1.0)
                    bsdf.inputs["Roughness"].default_value = 0.45
        if "Byggnader" in mat.name:
            mat.diffuse_color = (0.78, 0.75, 0.68, 1.0)
            if mat.use_nodes:
                bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
                if bsdf:
                    bsdf.inputs["Base Color"].default_value = (0.78, 0.75, 0.68, 1.0)
                    bsdf.inputs["Roughness"].default_value = 0.62


def add_subtle_base():
    bpy.ops.mesh.primitive_plane_add(size=520, location=(0, 0, -4.5))
    plane = bpy.context.object
    plane.name = "Mörk presentationsbas"
    mat = bpy.data.materials.new("Mörk neutral bas")
    mat.diffuse_color = (0.075, 0.08, 0.075, 1.0)
    mat.use_nodes = True
    bsdf = next((n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (0.075, 0.08, 0.075, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.8
    plane.data.materials.append(mat)


def main():
    set_world()
    tune_materials()
    tune_lights()
    add_subtle_base()
    make_camera()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.resolution_x = 1800
    scene.render.resolution_y = 1180
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 64
    scene.render.film_transparent = False
    scene.render.filepath = str(OUTPUT)
    bpy.ops.render.render(write_still=True)
    print(f"Rendered {OUTPUT}")


if __name__ == "__main__":
    main()
