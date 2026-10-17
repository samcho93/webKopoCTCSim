"""Bake the Kia Carnival model for the web.

Source: "Kia Carnival" by Nieve5677 (https://sketchfab.com/3d-models/kia-carnival-85cc817cc9984fafb879760df5af3ae8),
CC-BY-4.0. The Sketchfab export is ~470k triangles in 45 meshes; this merges the meshes per material
(keeps the material names, which src/parkedCar.js uses to restyle them), decimates the dense ones,
scales the car to the real length (5155 mm) and moves the origin to the centre of the footprint on the
ground with +x = forward, +y = up.

usage: python -I tools/build_car.py F:/Downloads/kia_carnival.glb public/equipment/car/carnival.glb
"""
import os
import sys
from collections import defaultdict

import fast_simplification
import numpy as np
import trimesh

LENGTH = 5.155
KEEP = 0.5            # fraction of triangles kept in meshes above DENSE triangles
DENSE = 6000


def main(src, out):
    scene = trimesh.load(src)
    parts = defaultdict(list)
    for node in scene.graph.nodes_geometry:
        T, name = scene.graph[node]
        m = scene.geometry[name].copy()
        m.apply_transform(T)
        parts[m.visual.material.name].append(m)
    lo, hi = scene.bounds
    centre = np.array([(lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2])
    s = LENGTH / (hi[2] - lo[2])
    # front is +z in the export: rotate +90 deg about y so it becomes +x, then scale
    R = trimesh.transformations.rotation_matrix(np.pi / 2, [0, 1, 0])
    M = trimesh.transformations.scale_matrix(s) @ R @ trimesh.transformations.translation_matrix(-centre)
    out_scene = trimesh.Scene()
    n0 = n1 = 0
    for mat, ms in sorted(parts.items()):
        merged = trimesh.util.concatenate(ms)
        material = ms[0].visual.material
        n0 += len(merged.faces)
        if len(merged.faces) > DENSE:
            v, f = fast_simplification.simplify(merged.vertices.astype(np.float32), merged.faces.astype(np.int64), 1 - KEEP)
            merged = trimesh.Trimesh(v, f, process=True)
        merged.apply_transform(M)
        merged.visual = trimesh.visual.TextureVisuals(material=material)
        n1 += len(merged.faces)
        out_scene.add_geometry(merged, node_name=mat, geom_name=mat)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    out_scene.export(out)
    print("triangles", n0, "->", n1, "| scale", round(s, 4), "| extents", np.round(out_scene.extents, 3), "|", os.path.getsize(out) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
