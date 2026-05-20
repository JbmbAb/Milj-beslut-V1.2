from __future__ import annotations

from pathlib import Path

import bpy
from mathutils import Vector


SCENE_DIR = Path(r"C:\Users\jimmy\Desktop\Millbygård\07_exports\blender_scene")
OUTPUT = SCENE_DIR / "millbygard_LADAN_RENSAD.blend"


def object_bounds_xy(obj: bpy.types.Object):
    if obj.type == "CURVE":
        pts = []
        for spline in obj.data.splines:
            seq = spline.bezier_points if spline.bezier_points else spline.points
            for point in seq:
                co = point.co
                pts.append(obj.matrix_world @ (co.to_3d() if hasattr(co, "to_3d") else co))
        if not pts:
            return None
        return min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts)

    if hasattr(obj.data, "vertices"):
        pts = [obj.matrix_world @ v.co for v in obj.data.vertices]
        if not pts:
            return None
        return min(p.x for p in pts), max(p.x for p in pts), min(p.y for p in pts), max(p.y for p in pts)

    return None


def overlaps(a, b):
    aminx, amaxx, aminy, amaxy = a
    bminx, bmaxx, bminy, bmaxy = b
    return not (amaxx < bminx or aminx > bmaxx or amaxy < bminy or aminy > bmaxy)


def main():
    # Covers the visible barn/yard cluster with margin.
    barn_yard_area = (-90.0, 25.0, -95.0, 5.0)
    removed = []

    for obj in list(bpy.data.objects):
        if not obj.name.startswith("Property_Boundary_Source"):
            continue
        bounds = object_bounds_xy(obj)
        if bounds and overlaps(bounds, barn_yard_area):
            removed.append(obj.name)
            bpy.data.objects.remove(obj, do_unlink=True)

    for obj in bpy.data.objects:
        obj.select_set(False)

    bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT))
    print("Saved", OUTPUT)
    print("Removed", len(removed), "objects")
    for name in removed:
        print(" -", name)


if __name__ == "__main__":
    main()
