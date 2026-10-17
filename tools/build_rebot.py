"""Bake the Seeed reBot Arm B601-DM (samcho93/studyReBotDevArm, assets/robot/DM) for the web.

The upstream visual STLs are ~430k triangles per arm. This merges every link's visuals into one mesh
with vertex colours (URDF material colours), decimates it, and writes
  public/equipment/rebot/rebot.glb   one node per link, link frame, URDF z-up metres
  public/equipment/rebot/rebot.json  joint chain (origin xyz/rpy, axis, limits)

usage: python -I tools/build_rebot.py D:/Work/Web/studyReBotDevArm/assets/robot/DM public/equipment/rebot
"""
import json
import os
import sys
import xml.etree.ElementTree as ET

import fast_simplification
import numpy as np
import trimesh

KEEP = 0.07          # fraction of triangles kept per visual mesh
MIN_TRIS = 160


def floats(s, n=3):
    return [float(v) for v in (s or " ".join(["0"] * n)).split()]


def rpy_matrix(r, p, y):
    cr, sr, cp, sp, cy, sy = np.cos(r), np.sin(r), np.cos(p), np.sin(p), np.cos(y), np.sin(y)
    return np.array([[cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
                     [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
                     [-sp, cp * sr, cp * cr]])


def main(src, out):
    urdf = next(os.path.join(src, "urdf", f) for f in os.listdir(os.path.join(src, "urdf")) if f.endswith(".urdf"))
    root = ET.parse(urdf).getroot()
    colours = {m.get("name"): floats(m.find("color").get("rgba"), 4) for m in root.findall("material") if m.find("color") is not None}
    scene = trimesh.Scene()
    stats = []
    for link in root.findall("link"):
        parts = []
        for vis in link.findall("visual"):
            mesh_el = vis.find("geometry/mesh")
            if mesh_el is None:
                continue
            path = os.path.normpath(os.path.join(os.path.dirname(urdf), mesh_el.get("filename")))
            m = trimesh.load(path, force="mesh")
            n0 = len(m.faces)
            target = max(MIN_TRIS, int(n0 * KEEP))
            if n0 > target:
                v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int64), 1 - target / n0)
                m = trimesh.Trimesh(v, f, process=True)
            o = vis.find("origin")
            if o is not None:
                T = np.eye(4)
                T[:3, :3] = rpy_matrix(*floats(o.get("rpy")))
                T[:3, 3] = floats(o.get("xyz"))
                m.apply_transform(T)
            rgba = colours.get(vis.find("material").get("name") if vis.find("material") is not None else "", [0.5, 0.5, 0.5, 1])
            m.visual = trimesh.visual.ColorVisuals(m, face_colors=np.tile(np.array(rgba) * 255, (len(m.faces), 1)).astype(np.uint8))
            parts.append(m)
            stats.append((os.path.basename(path), n0, len(m.faces)))
        if parts:
            merged = trimesh.util.concatenate(parts)
            scene.add_geometry(merged, node_name=link.get("name"), geom_name=link.get("name"))
    joints = []
    for j in root.findall("joint"):
        o = j.find("origin")
        lim = j.find("limit")
        joints.append(dict(
            name=j.get("name"), type=j.get("type"), parent=j.find("parent").get("link"), child=j.find("child").get("link"),
            xyz=floats(o.get("xyz")) if o is not None else [0, 0, 0], rpy=floats(o.get("rpy")) if o is not None else [0, 0, 0],
            axis=floats(j.find("axis").get("xyz")) if j.find("axis") is not None else [1, 0, 0],
            lower=float(lim.get("lower")) if lim is not None else 0.0, upper=float(lim.get("upper")) if lim is not None else 0.0))
    os.makedirs(out, exist_ok=True)
    scene.export(os.path.join(out, "rebot.glb"))
    with open(os.path.join(out, "rebot.json"), "w", encoding="utf-8") as f:
        json.dump(dict(robot=root.get("name"), source="samcho93/studyReBotDevArm assets/robot/DM (CERN-OHL-W-2.0)", joints=joints), f, indent=1)
    print("triangles", sum(s[1] for s in stats), "->", sum(s[2] for s in stats), "| glb", os.path.getsize(os.path.join(out, "rebot.glb")) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
