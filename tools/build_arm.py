"""Bake a desk robot arm for the web: one decimated, vertex-coloured mesh per link + the joint chain.

  <out>/<name>.glb   one node per link, link frame, URDF z-up metres
  <out>/<name>.json  joint chain in parent-first order (origin xyz/rpy, axis, limits)

Seeed reBot Arm B601-DM (samcho93/studyReBotDevArm, assets/robot/DM; URDF + STL, ~430k triangles):
  python -I tools/build_arm.py rebot D:/Work/Web/studyReBotDevArm/assets/robot/DM public/equipment/rebot
SO-ARM101 (samcho93/studySO-ARM101: so101_new_calib.urdf + its mesh bundle assets/mesh/so101-meshes.bin,
meshes from TheRobotStudio/SO-ARM100, Apache-2.0):
  python -I tools/build_arm.py so101 D:/Work/Web/studySO-ARM101 public/equipment/so101
"""
import json
import os
import struct
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


def decimate(m):
    n0 = len(m.faces)
    target = max(MIN_TRIS, int(n0 * KEEP))
    if n0 > target:
        v, f = fast_simplification.simplify(m.vertices.astype(np.float32), m.faces.astype(np.int64), 1 - target / n0)
        m = trimesh.Trimesh(v, f, process=True)
    return m


def place(m, xyz, rpy, rgba):
    T = np.eye(4)
    T[:3, :3] = rpy_matrix(*rpy)
    T[:3, 3] = xyz
    m.apply_transform(T)
    m.visual = trimesh.visual.ColorVisuals(m, face_colors=np.tile(np.array(rgba) * 255, (len(m.faces), 1)).astype(np.uint8))
    return m


def urdf_visuals(urdf, root):
    """{link: [(trimesh, xyz, rpy, rgba)]} from the URDF's own STL visuals."""
    colours = {m.get("name"): floats(m.find("color").get("rgba"), 4) for m in root.findall("material") if m.find("color") is not None}
    out = {}
    for link in root.findall("link"):
        for vis in link.findall("visual"):
            mesh_el = vis.find("geometry/mesh")
            if mesh_el is None:
                continue
            path = os.path.normpath(os.path.join(os.path.dirname(urdf), mesh_el.get("filename")))
            o = vis.find("origin")
            mat = vis.find("material")
            out.setdefault(link.get("name"), []).append((trimesh.load(path, force="mesh"),
                floats(o.get("xyz")) if o is not None else [0, 0, 0], floats(o.get("rpy")) if o is not None else [0, 0, 0],
                colours.get(mat.get("name") if mat is not None else "", [0.5, 0.5, 0.5, 1])))
    return out


def so101_visuals(repo):
    """{link: [...]} from studySO-ARM101's quantised mesh bundle (format: assets/js/so101-meshes.js)."""
    b = open(os.path.join(repo, "assets/mesh/so101-meshes.bin"), "rb").read()
    assert b[:8] == b"SO101MSH"
    n = struct.unpack("<I", b[12:16])[0]
    head = json.loads(b[16:16 + n].decode("utf-8"))
    base, unit, meshes = 16 + n, head["unit"], []
    for m in head["meshes"]:
        q = np.frombuffer(b, np.uint16, m["vcount"] * 3, base + m["pos"]).reshape(-1, 3)
        f = np.frombuffer(b, np.uint16, m["icount"] * 3, base + m["idx"]).reshape(-1, 3)
        meshes.append((np.array(m["min"]) + q * unit, f))
    rgba = {"print": [1.0, 0.82, 0.12, 1], "servo": [0.1, 0.1, 0.1, 1]}
    return {link: [(trimesh.Trimesh(*meshes[v["mesh"]], process=True), v["xyz"], v["rpy"], rgba.get(v["mat"], [0.6, 0.6, 0.6, 1]))
                   for v in vis] for link, vis in head["links"].items()}


def main(kind, src, out):
    if kind == "so101":
        urdf = os.path.join(src, "ros2_ws/src/so_arm101_description/urdf/so101_new_calib.urdf")
        root = ET.parse(urdf).getroot()
        visuals, source = so101_visuals(src), "samcho93/studySO-ARM101 (meshes: TheRobotStudio/SO-ARM100, Apache-2.0)"
    else:
        urdf = next(os.path.join(src, "urdf", f) for f in os.listdir(os.path.join(src, "urdf")) if f.endswith(".urdf"))
        root = ET.parse(urdf).getroot()
        visuals, source = urdf_visuals(urdf, root), "samcho93/studyReBotDevArm assets/robot/DM (CERN-OHL-W-2.0)"
    scene = trimesh.Scene()
    n0 = n1 = 0
    for link, parts in visuals.items():
        meshes = []
        for m, xyz, rpy, rgba in parts:
            n0 += len(m.faces)
            meshes.append(place(decimate(m), xyz, rpy, rgba))
            n1 += len(meshes[-1].faces)
        scene.add_geometry(trimesh.util.concatenate(meshes), node_name=link, geom_name=link)
    joints = []
    for j in root.findall("joint"):
        o = j.find("origin")
        lim = j.find("limit")
        joints.append(dict(
            name=j.get("name"), type=j.get("type"), parent=j.find("parent").get("link"), child=j.find("child").get("link"),
            xyz=floats(o.get("xyz")) if o is not None else [0, 0, 0], rpy=floats(o.get("rpy")) if o is not None else [0, 0, 0],
            axis=floats(j.find("axis").get("xyz")) if j.find("axis") is not None else [1, 0, 0],
            lower=float(lim.get("lower")) if lim is not None else 0.0, upper=float(lim.get("upper")) if lim is not None else 0.0))
    # parent-first order (the SO-101 URDF lists children before parents)
    done, ordered = {j["parent"] for j in joints} - {j["child"] for j in joints}, []
    while len(ordered) < len(joints):
        for j in joints:
            if j not in ordered and j["parent"] in done:
                ordered.append(j); done.add(j["child"])
    os.makedirs(out, exist_ok=True)
    scene.export(os.path.join(out, f"{kind}.glb"))
    with open(os.path.join(out, f"{kind}.json"), "w", encoding="utf-8") as f:
        json.dump(dict(robot=root.get("name"), source=source, joints=ordered), f, indent=1)
    print(kind, "triangles", n0, "->", n1, "| glb", os.path.getsize(os.path.join(out, f"{kind}.glb")) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
