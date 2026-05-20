from __future__ import annotations

from pathlib import Path

import bpy


SCENE_DIR = Path(r"C:\Users\jimmy\Desktop\Millbygård\07_exports\blender_scene")
OUTPUT = SCENE_DIR / "millbygard_UTAN_servitut_genom_ladan.blend"

REMOVE_NAMES = {
    "Property_Boundary_Source_curve_010",
    "Property_Boundary_Source_curve_011",
    "Property_Boundary_Source_curve_010_removed_servitut",
    "Property_Boundary_Source_curve_011_removed_servitut",
}


def main():
    removed = []
    for obj in list(bpy.data.objects):
        if obj.name in REMOVE_NAMES:
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)

    # Keep the raw source mesh out of view so it cannot show the original line in Blender.
    for obj in bpy.data.objects:
        if obj.name.startswith("Property_Boundary_Source") and obj.type == "MESH":
            obj.hide_viewport = True
            obj.hide_render = True

    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print("Saved", OUTPUT)
    print("Removed", ", ".join(removed) if removed else "none")


if __name__ == "__main__":
    main()
