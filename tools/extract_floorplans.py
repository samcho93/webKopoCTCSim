"""
Floor-plan PDF -> building.json + per-floor occupancy maps.

The source PDF (interior design drawings, A3 1:100, 9 sheets: B1, 1F..8F) is
vector based. Line weights encode element types:
    0.72 pt black  -> structural / masonry walls, columns, core
    0.60 pt black  -> partitions, glazing, door leaves, stair treads
    0.48 pt black  -> fixed furniture (desks, tables, benches, racks)
Everything is rasterised at RES metres/cell in plan coordinates whose origin
is the intersection of grid lines 1 and A (x along 1->5, y along A->D),
cleaned with morphology, then converted to axis-aligned boxes (greedy
meshing) which the web viewer extrudes into 3D.

usage: python tools/extract_floorplans.py <plans.pdf> [out_dir]
"""
import json
import math
import os
import sys

import fitz  # PyMuPDF
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

RES = 0.05                     # metres per cell
X0, Y0 = -1.5, -1.5            # raster origin (plan metres)
NX, NY = 620, 420              # raster size -> 31 m x 21 m
PT_PER_M = 27.88               # measured from the column grid bubbles
GRID1_PT, GRIDA_PT = 172.5, 157.5   # unrotated PDF coords of grid 1 / grid A

GRID_X = {"1": 0.0, "2": 5.7, "3": 13.2, "4": 20.7, "5": 27.1}
GRID_Y = {"A": 0.0, "B": 5.8, "C": 12.4, "D": 17.2}

# page index -> level definition. elevation = top of slab (m)
LEVELS = [
    dict(id="B1", name="지하 1층", elevation=-4.0, height=4.0, ceiling=2.7),
    dict(id="1F", name="1층", elevation=0.0, height=4.5, ceiling=2.7),
    dict(id="2F", name="2층", elevation=4.5, height=3.6, ceiling=2.6),
    dict(id="3F", name="3층", elevation=8.1, height=3.6, ceiling=2.6),
    dict(id="4F", name="4층", elevation=11.7, height=3.6, ceiling=2.4),
    dict(id="5F", name="5층", elevation=15.3, height=3.6, ceiling=2.4),
    dict(id="6F", name="6층", elevation=18.9, height=3.6, ceiling=2.4),
    dict(id="7F", name="7층", elevation=22.5, height=3.6, ceiling=2.4),
    dict(id="8F", name="8층", elevation=26.1, height=3.6, ceiling=2.5),
]

# Vertical circulation (plan metres), read off the drawings.
STAIRS = [
    # Stair #1 (south-west). Flights run along +y, floor landing on the south.
    dict(id="S1", name="계단실 #1", box=[0.0, 0.0, 2.75, 5.1], axis="y",
         landing="south", flightA=[0.05, 1.25], flightB=[1.45, 2.70],
         run=[2.0, 4.15], doors=[[2.5, 0.5, 3.0, 1.5], [3.1, 0.7, 3.5, 1.6, "1F"]],
         levels=["B1", "1F", "2F", "3F", "4F", "5F", "6F", "7F"]),
    # Stair #2 (north-west). Flights run along x, floor landing on the east.
    dict(id="S2", name="계단실 #2", box=[0.0, 14.0, 4.05, 17.2], axis="x",
         landing="east", flightA=[15.75, 17.15], flightB=[14.05, 15.38],
         run=[1.45, 4.0], doors=[[4.2, 13.7, 5.2, 14.2], [4.05, 14.1, 5.2, 17.1]], levels=["1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F"]),
]
ELEVATORS = [
    dict(id="EV1", name="엘리베이터 (13인승)", shaft=[0.75, 10.1, 2.72, 12.2],
         car=[1.22, 10.4, 2.62, 12.0], door=[10.75, 11.65], doorX=2.72,
         levels=["1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F"]),
    dict(id="EV2", name="엘리베이터 (17인승)", shaft=[0.75, 7.9, 2.72, 10.0],
         car=[1.03, 8.03, 2.62, 9.92], door=[8.5, 9.45], doorX=2.72,
         levels=["1F", "2F", "3F", "4F", "5F", "6F", "7F", "8F"]),
]

# Room labels (centre points, plan metres), transcribed from the sheets.
# Renovations applied on top of the 2015 drawings (plan metres, [x0, y0, x1, y1]).
#   clear  : remove walls / partitions / furniture inside the rect (layers: wall, part, furn)
#   wall   : add a solid wall
#   rooms  : drop / rename room labels
#   desk   : add a fixed bench/table (furniture layer -> 3D desk, collision, nav maps)
#   equip  : place an equipment model (rendered at runtime: hplc1260, m400-robot-cafe)
#   solid  : occupied in the nav/ROS maps only (equipment drawn at runtime, e.g. the cafe counter)
#   copy   : copy the furniture / partition layout of one room region to another (optionally mirrored in x):
#            src [x0,y0,x1,y1], to=[x, y] (lower-left corner of the copy), mirror=True/False


def _lab_grid(x0, x1, y0, y1, cols, rows, w, d, model, yaw):
    """Evenly spaced benches (w x d) in [x0,x1] x [y0,y1] with one model on each."""
    ops = []
    px, py = (x1 - x0) / cols, (y1 - y0) / rows
    for r in range(rows):
        for c in range(cols):
            cx, cy = round(x0 + px * (c + 0.5), 3), round(y0 + py * (r + 0.5), 3)
            ops.append(dict(op="desk", rect=[round(cx - w / 2, 3), round(cy - d / 2, 3), round(cx + w / 2, 3), round(cy + d / 2, 3)], top=0.75))
            ops.append(dict(op="equip", model=model, x=cx, y=cy, top=0.75, yaw=yaw))
    return ops


EDITS = {
    "1F": [
        # parked car: Kia Carnival (5155 x 1995 x 1775 mm, wheelbase 3090), dark grey, nose-in in the
        # first marked bay (lines x 21.2 / 23.7, y 13.0-17.0)
        dict(op="equip", model="car-carnival", x=22.45, y=14.35, top=0.0, yaw=1.5708,
             props=dict(color="#3b3e43", plate="177하 4649")),
        dict(op="solid", rect=[21.4, 11.7, 23.5, 17.0]),
    ],
    "3F": [
        # 307 준비실 merged into 308 실습실 #2: the 307 doorway stays as the front door,
        # the 308 doorway is walled up and a new rear door opens at the east end of 308
        dict(op="clear", rect=[17.8, 9.95, 19.5, 17.2], layers=["furn"]),              # 307 table + counter
        dict(op="clear", rect=[19.42, 9.95, 19.9, 16.9], layers=["wall", "part"]),     # 307|308 partition (+ 308 door jamb)
        dict(op="wall", rect=[19.75, 9.7, 20.85, 9.9]),                               # old 308 doorway -> corridor wall
        dict(op="clear", rect=[25.4, 9.6, 26.3, 9.95], layers=["wall", "part", "furn"]),  # new rear door of 308
        dict(op="rooms", drop=["307 준비실"], rename={"308 실습실 #2": "308 실습실 #2 (구 307 준비실 통합)"}),
        # 305: cafesim M400 robot cafe against the corridor-side (north) wall. Origin = counter centre
        # line 0.33 m in front of the wall face (y 7.2); counter 2.6 m, UR5e pedestal + pickup table in front
        dict(op="equip", model="m400-robot-cafe", x=24.65, y=6.87, top=0.0, yaw=0.0),
        dict(op="solid", rect=[23.33, 6.45, 25.97, 7.2]),        # counter
        dict(op="solid", rect=[24.18, 5.25, 24.86, 6.23]),       # robot pedestal + pickup table
        dict(op="rooms", rename={"305 프로젝트실 #4": "305 프로젝트실 #4 · M400 로봇 카페"}),
        # 301: desks removed, exhibition of 10 Unitree Go2 (display only, click = step in place 5x),
        # 2 columns x 5 rows facing the corridor door (north)
        dict(op="clear", rect=[10.95, 0.3, 13.25, 7.1], layers=["furn"]),
        *[op for x in (11.55, 12.45) for y in (1.1, 2.2, 3.3, 4.4, 5.5) for op in (
            dict(op="equip", model="go2-display", x=x, y=y, top=0.0, yaw=1.5708),
            dict(op="solid", rect=[round(x - 0.2, 2), round(y - 0.4, 2), round(x + 0.2, 2), round(y + 0.4, 2)]))],
        dict(op="rooms", rename={"301 프로젝트실 #1": "301 프로젝트실 #1 · Go2 전시"}),
        # 308 (merged with 307): the original desks (0.75 x 2.05 m, long side front-to-back as drawn) re-laid
        # 4 across x 3 down at the original column pitch (1.55 m), clear of both doors; two TIKI-mini per desk
        dict(op="clear", rect=[17.9, 9.95, 26.8, 17.15], layers=["furn"]),
        *[op for x0 in (19.7, 21.25, 22.8, 24.35) for y0 in (10.15, 12.55, 14.95) for op in (
            dict(op="desk", rect=[x0, y0, round(x0 + 0.75, 2), round(y0 + 2.05, 2)], top=0.75),
            dict(op="equip", model="tiki-display", x=round(x0 + 0.375, 3), y=round(y0 + 0.525, 3), top=0.75, yaw=3.1416),
            dict(op="equip", model="tiki-display", x=round(x0 + 0.375, 3), y=round(y0 + 1.525, 3), top=0.75, yaw=3.1416))],
        # 302 / 303 become professors' offices furnished like 304 (L desk with PIN-UP partition, meeting table,
        # low cabinets, entrance counter). 302 (door at its west end): same layout against its east wall;
        # 303 (door at its east end): mirrored against its west wall so the doorway stays clear.
        dict(op="clear", rect=[13.45, 0.3, 16.75, 6.95], layers=["furn", "part"]),
        dict(op="clear", rect=[16.9, 0.3, 20.2, 6.95], layers=["furn", "part"]),
        dict(op="copy", src=[8.3, 0.2, 10.9, 7.25], to=[16.75 - 2.6, 0.2]),
        dict(op="copy", src=[8.3, 0.2, 10.9, 7.25], to=[16.9, 0.2], mirror=True),
        dict(op="rooms", rename={"302 프로젝트실 #2": "302 교수연구실", "303 프로젝트실 #3": "303 교수연구실"}),
        # 302: window-side desk keeps an empty KERNDU slot (KERNDU CAD stays private, not built)
        dict(op="equip", model="kerndu", x=16.2, y=0.62, top=0.75, yaw=1.5708),
        # 305: AUREN-PRO + AUREN M (AurenSim, live firmware) on the wide table (x 21.15-22.4, y 1.85-5.1, counter top 0.9 m),
        # fronts facing the room (east)
        dict(op="equip", model="auren-pro", x=21.8, y=4.2, top=0.9, yaw=0.0),
        dict(op="equip", model="auren-m", x=21.8, y=2.6, top=0.9, yaw=0.0),
    ],
    "8F": [
        # 805 의생물공정실습실: 15 benches (3 rows x 5) with an Agilent 1260 HPLC each (studyHPLC1260 model),
        # instrument fronts face south (-y) toward the aisle
        dict(op="clear", rect=[10.4, 7.9, 23.4, 15.3], layers=["furn"]),
        *_lab_grid(11.8, 22.9, 8.6, 14.8, cols=5, rows=3, w=1.5, d=0.9, model="hplc1260", yaw=-1.5708),
    ],
}


ROOMS = {
    "B1": [("MDF실", 1.7, 14.4), ("휴게실", 5.1, 14.4), ("전기실", 10.2, 14.4),
           ("발전기실", 1.3, 8.7), ("기계실", 9.5, 6.1), ("강당", 19.4, 12.3),
           ("장비실", 26.1, 16.4), ("창고", 14.1, 16.9), ("계단실 #1", 1.3, 3.4),
           ("계단실 #3 & 창고", 18.7, 3.2), ("서고 & 창고", 22.9, 3.4)],
    "1F": [("계단실 #2", 3.0, 15.8), ("관리실", 7.0, 15.6), ("화장실(남)", 9.8, 15.8),
           ("장애인 화장실", 11.9, 15.8), ("화장실(여)", 14.2, 15.6), ("우편실", 7.0, 11.8),
           ("로비", 7.4, 8.1), ("INFORMATION", 11.4, 9.4), ("방풍실", 5.5, 2.3),
           ("계단실 #1", 1.2, 3.0), ("카페 & 주방", 13.8, 2.7), ("주차장", 20.6, 14.0),
           ("CAR LIFT", 18.7, 3.3), ("TURN TABLE", 18.4, 9.8)],
    "2F": [("계단실 #2", 3.0, 15.6), ("홀", 4.4, 10.5), ("강사대기실", 8.1, 15.2),
           ("대회의실", 16.8, 14.2), ("학장실", 24.6, 14.2), ("화장실(남)", 5.5, 6.2),
           ("화장실(여)", 5.5, 3.0), ("소회의실", 9.1, 3.9), ("사무실", 16.3, 5.8),
           ("탕비실", 24.3, 8.6), ("창고", 24.3, 2.2), ("계단실 #1", 1.3, 3.0)],
    "3F": [("306 실습실 #1", 11.9, 13.5), ("307 준비실", 18.7, 13.5), ("308 실습실 #2", 23.4, 13.5),
           ("휴게공간", 24.8, 8.6), ("304 교수연구실 #1", 9.8, 3.4), ("301 프로젝트실 #1", 12.0, 3.4),
           ("302 프로젝트실 #2", 14.9, 3.4), ("303 프로젝트실 #3", 18.5, 3.4),
           ("305 프로젝트실 #4", 24.3, 3.4), ("홀", 4.4, 10.5), ("화장실(남)", 5.5, 6.2),
           ("화장실(여)", 5.5, 3.0), ("계단실 #1", 1.3, 3.0), ("계단실 #2", 3.0, 15.6)],
    "4F": [("405 컴퓨터실습실 #1", 11.9, 13.5), ("406 실습실 #3 (스마트팩토리)", 22.5, 13.5),
           ("402 프로젝트실 #5", 8.8, 3.9), ("401 교수연구실 #2", 12.1, 3.9),
           ("403 교수연구실 #3", 15.9, 3.9), ("404 교수연구실 #4", 19.6, 3.9), ("쇼룸", 24.1, 5.8),
           ("홀", 4.4, 10.5), ("화장실(남)", 5.5, 6.2), ("화장실(여)", 5.5, 3.0),
           ("계단실 #1", 1.3, 3.0), ("계단실 #2", 3.0, 15.6)],
    "5F": [("503 컴퓨터실습실 #2", 11.9, 13.5), ("서버실", 18.9, 14.9), ("준비실", 18.9, 11.9),
           ("504 컴퓨터실습실 #3", 23.9, 13.5), ("프로젝트실 #7", 25.3, 8.4), ("프로젝트실 #8", 25.3, 3.9),
           ("501 교수연구실 #5", 9.8, 3.4), ("502 프로젝트실 #6", 16.3, 3.9), ("홀", 4.4, 10.5),
           ("화장실(남)", 5.5, 6.2), ("화장실(여)", 5.5, 3.0), ("계단실 #1", 1.3, 3.0),
           ("계단실 #2", 3.0, 15.6)],
    "6F": [("604 컴퓨터실습실 #4", 11.9, 13.5), ("605 컴퓨터실습실 #5", 22.9, 13.5),
           ("601 이론강의실 #1", 10.2, 3.4), ("602 이론강의실 #2", 17.1, 3.4),
           ("603 이론강의실 #3", 23.4, 3.4), ("휴게공간 / 프린트 스테이션", 24.0, 8.6),
           ("홀", 4.4, 10.5), ("화장실(남)", 5.5, 6.2), ("화장실(여)", 5.5, 3.0),
           ("계단실 #1", 1.3, 3.0), ("계단실 #2", 3.0, 15.6)],
    "7F": [("707 이론강의실 #4", 10.7, 13.5), ("706 분자진단 실험실", 21.5, 13.3),
           ("708 휴게공간 #2", 8.8, 3.9), ("701 교수연구실 #6", 11.9, 3.9),
           ("702 교수연구실 #7", 15.2, 3.9), ("703 재료실", 18.2, 5.1), ("704 D/F RM.", 18.2, 1.1),
           ("705 세포배양실", 23.4, 3.9), ("홀", 4.4, 10.5), ("화장실(남)", 5.5, 6.2),
           ("화장실(여)", 5.5, 3.0), ("계단실 #1", 1.3, 3.0), ("계단실 #2", 3.0, 15.6)],
    "8F": [("801 교수연구실 #8", 7.9, 12.8), ("805 의생물공정실습실", 17.3, 11.9),
           ("802 재료실", 7.0, 6.0), ("803 정밀분석실", 10.5, 6.0), ("804 프로테옴실", 17.3, 5.8),
           ("화장실(남)", 0.9, 4.6), ("화장실(여)", 5.1, 6.7), ("홀", 4.4, 10.5),
           ("계단실 #2", 3.0, 15.6), ("옥상정원", 14.0, 1.5)],
}


def to_plan(pt):
    """Unrotated PDF point -> plan metres (sheets are stored rotated 270deg)."""
    return ((pt.y - GRID1_PT) / PT_PER_M, (pt.x - GRIDA_PT) / PT_PER_M)


def to_cell(m):
    return ((m[0] - X0) / RES, (m[1] - Y0) / RES)


def bezier(p0, p1, p2, p3, n=10):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3
        out.append(fitz.Point(a * p0.x + b * p1.x + c * p2.x + d * p3.x,
                              a * p0.y + b * p1.y + c * p2.y + d * p3.y))
    return out


class Curve(list):
    pass


def it_kind(pl):
    return "curve" if isinstance(pl, Curve) else "line"


def open_doorways(arc, solid_layers):
    """Door swings (quarter arcs, r = 0.7..1.3 m) mark doorways that the sheets
    draw closed. Clear the wall band along every arc-bbox side that lies on a wall."""
    lab, n = ndi.label(ndi.binary_dilation(arc, np.ones((3, 3), bool)), np.ones((3, 3), bool))
    solid = np.zeros_like(arc)
    for L in solid_layers:
        solid |= L
    carve = np.zeros_like(arc)
    count = 0
    for sl in ndi.find_objects(lab):
        h, w = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if not (13 <= h <= 28 and 13 <= w <= 28):
            continue
        comp = lab[sl] > 0
        if comp.mean() > 0.35:
            continue
        j0, j1, i0, i1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        B = 4
        sides = [  # (band slice rows, band slice cols)
            (slice(max(j0 - B, 0), j0 + B), slice(i0 + 1, i1 - 1)),
            (slice(j1 - B, min(j1 + B, NY)), slice(i0 + 1, i1 - 1)),
            (slice(j0 + 1, j1 - 1), slice(max(i0 - B, 0), i0 + B)),
            (slice(j0 + 1, j1 - 1), slice(i1 - B, min(i1 + B, NX))),
        ]
        for rs, cs in sides:
            band = solid[rs, cs]
            if band.size == 0:
                continue
            along = band.any(axis=0) if band.shape[1] > band.shape[0] else band.any(axis=1)
            if along.mean() > 0.6:
                carve[rs, cs] = True
                count += 1
    return carve, count


def inside(m, margin=1.0):
    return -margin <= m[0] <= 27.1 + margin and -margin <= m[1] <= 17.2 + margin


def rasterise(page):
    layers = {k: Image.new("L", (NX, NY), 0) for k in ("wall", "part", "furn", "arc")}
    draw = {k: ImageDraw.Draw(v) for k, v in layers.items()}
    segs, curves = [], []
    for dr in page.get_drawings():
        w = round(dr.get("width") or 0, 2)
        col, fill = dr.get("color"), dr.get("fill")
        polys = []
        for it in dr["items"]:
            if it[0] == "l":
                polys.append([it[1], it[2]])
            elif it[0] == "re":
                r = it[1]; polys.append([r.tl, r.tr, r.br, r.bl, r.tl])
            elif it[0] == "qu":
                q = it[1]; polys.append([q.ul, q.ur, q.lr, q.ll, q.ul])
            elif it[0] == "c":
                polys.append(Curve(bezier(*it[1:5])))
        for pl in polys:
            m = [to_plan(p) for p in pl]
            if not all(inside(q) for q in m):
                continue
            xy = [to_cell(q) for q in m]
            if fill is not None and abs(fill[0] - 0.46) < 0.02 and len(xy) > 2:
                xs = [q[0] for q in m]; ys = [q[1] for q in m]
                if (max(xs) - min(xs)) * (max(ys) - min(ys)) < 4.0:
                    draw["wall"].polygon(xy, fill=255)
                continue
            if col is None or max(col) > 0.05:
                continue
            if it_kind(pl) == "curve" and w <= 0.3:
                draw["arc"].line(xy, fill=255, width=1)   # door swings
                continue
            key = {0.72: "wall", 0.6: "part", 0.48: "furn"}.get(w)
            if key == "part" and not isinstance(pl, Curve):
                segs.extend(zip(xy[:-1], xy[1:]))
            elif key == "part":
                curves.append(xy)
                draw[key].line(xy, fill=255, width=1)
            elif key:
                draw[key].line(xy, fill=255, width=1)
    out = {k: np.array(v) > 0 for k, v in layers.items()}
    # Partitions are drawn as parallel line pairs. Single lines are floor-level
    # edges (OA-floor ramps, finish changes), door leaves, counter edges: drop them.
    allp = Image.new("L", (NX, NY), 0); ad = ImageDraw.Draw(allp)
    for a, b in segs:
        ad.line([a, b], fill=255, width=1)
    for xy in curves:
        ad.line(xy, fill=255, width=1)
    ref = (np.array(allp) > 0) | out["wall"]
    keep = ImageDraw.Draw(layers["part"])
    for a, b in segs:
        if paired(a, b, ref) or envelope(a, b):
            keep.line([a, b], fill=255, width=1)
    out["part"] = np.array(layers["part"]) > 0
    out["part_all"] = np.array(allp) > 0
    return out


def envelope(a, b):
    """Single lines on the building envelope are glazing: keep them."""
    x = X0 + (a[0] + b[0]) / 2 * RES; y = Y0 + (a[1] + b[1]) / 2 * RES
    return x < 0.45 or x > 26.65 or y < 0.45 or y > 16.75 or (x > 19.5 and y < 6.5 and math.hypot(x - 20.7, y - 6.4) > 5.6)


def paired(a, b, ref):
    ax, ay = a; bx, by = b
    L = math.hypot(bx - ax, by - ay)
    if L < 1e-6:
        return False
    if L < 6:          # short pieces (< 0.3 m): jambs, mullions -> keep
        return True
    dx, dy = (bx - ax) / L, (by - ay) / L
    nx, ny = -dy, dx
    hits = n = 0
    t = 1.0
    while t < L - 1:
        px, py = ax + dx * t, ay + dy * t
        n += 1
        found = False
        for k in (2, 3, 4, 5, 6, 7):
            for sgn in (1, -1):
                i = int(round(px + sgn * nx * k)); j = int(round(py + sgn * ny * k))
                if 0 <= i < NX and 0 <= j < NY and ref[j, i]:
                    found = True; break
            if found:
                break
        hits += found
        t += 2
    return n == 0 or hits / n >= 0.5


def fill_small_holes(mask, max_area_m2):
    holes = ndi.binary_fill_holes(mask) & ~mask
    lab, n = ndi.label(holes)
    if n == 0:
        return mask
    sizes = ndi.sum(holes, lab, range(1, n + 1))
    small = np.isin(lab, np.nonzero(sizes * RES * RES <= max_area_m2)[0] + 1)
    return mask | small


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def rect_mask(box, pad=0.0):
    x0, y0, x1, y1 = box
    m = np.zeros((NY, NX), bool)
    i0 = int(round((x0 + pad - X0) / RES)); i1 = int(round((x1 - pad - X0) / RES))
    j0 = int(round((y0 + pad - Y0) / RES)); j1 = int(round((y1 - pad - Y0) / RES))
    m[max(j0, 0):max(j1, 0), max(i0, 0):max(i1, 0)] = True
    return m


def desk_mask(rects):
    m = np.zeros((NY, NX), bool)
    for r in rects:
        m |= rect_mask(r)
    return m


def greedy_rects(mask):
    """Merge set cells into maximal-ish axis aligned rectangles."""
    mask = mask.copy()
    rects = []
    for j in range(NY):
        row = mask[j]
        i = 0
        while i < NX:
            if not row[i]:
                i += 1; continue
            i2 = i
            while i2 < NX and row[i2]:
                i2 += 1
            j2 = j + 1
            while j2 < NY and mask[j2, i:i2].all():
                j2 += 1
            mask[j:j2, i:i2] = False
            rects.append([round(X0 + i * RES, 3), round(Y0 + j * RES, 3),
                          round(X0 + i2 * RES, 3), round(Y0 + j2 * RES, 3)])
            i = i2
    return rects


def footprint_of(solid):
    closed = ndi.binary_dilation(solid, disk(12))
    outside = ~closed
    lab, _ = ndi.label(outside)
    border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    ext = np.isin(lab, list(border))
    fp = ndi.binary_erosion(~ext, disk(12), border_value=1)
    return ndi.binary_fill_holes(fp | solid & ~ext)


def main():
    pdf = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "..", "public", "data")
    os.makedirs(os.path.join(out, "maps"), exist_ok=True)
    doc = fitz.open(pdf)
    assert len(doc) == len(LEVELS), "expected 9 sheets (B1, 1F..8F)"

    raw = [rasterise(doc[i]) for i in range(len(doc))]
    # Common footprint from a typical floor (3F); 8F has its own set-back.
    typical = raw[3]["wall"] | raw[3]["part_all"]
    fp_common = footprint_of(typical)
    fp_8f = footprint_of(raw[8]["wall"] | raw[8]["part_all"]) & fp_common

    levels_out = []
    for idx, lv in enumerate(LEVELS):
        L = raw[idx]
        wall = ndi.binary_closing(L["wall"], disk(3))
        wall = fill_small_holes(wall, 1.2)
        part = ndi.binary_closing(L["part"], np.ones((3, 3), bool))
        part = fill_small_holes(part, 0.3) & ~wall
        furn = fill_small_holes(L["furn"], 2.0)
        furn = ndi.binary_opening(furn, np.ones((3, 3), bool)) & ~wall & ~part
        doors, ndoor = open_doorways(L["arc"], [wall, part])
        wall &= ~doors; part &= ~doors; furn &= ~doors

        # vertical circulation is modelled procedurally: clear the raster there
        for s in STAIRS:
            if lv["id"] in s["levels"]:
                inner = rect_mask(s["box"], 0.06)
                part &= ~inner; furn &= ~inner
                wall &= ~rect_mask(s["box"], 0.12)
                # fire doors are drawn closed on the sheets: keep the doorway open
                for d in s.get("doors", []):
                    if len(d) > 4 and d[4] != lv["id"]:
                        continue
                    m = rect_mask(d[:4])
                    wall &= ~m; part &= ~m; furn &= ~m
        for e in ELEVATORS:
            if lv["id"] in e["levels"]:
                inner = rect_mask(e["shaft"], 0.0)
                part &= ~inner; furn &= ~inner; wall &= ~inner
                door = rect_mask([e["doorX"] - 0.2, e["door"][0], e["doorX"] + 0.35, e["door"][1]])
                wall &= ~door; part &= ~door

        rooms = list(ROOMS.get(lv["id"], []))
        desks, equipment = [], []
        solid = np.zeros((NY, NX), bool)
        for e in EDITS.get(lv["id"], []):
            if e["op"] == "clear":
                m = rect_mask(e["rect"])
                if "wall" in e["layers"]: wall &= ~m
                if "part" in e["layers"]: part &= ~m
                if "furn" in e["layers"]: furn &= ~m
            elif e["op"] == "wall":
                m = rect_mask(e["rect"])
                wall |= m; part &= ~m; furn &= ~m
            elif e["op"] == "rooms":
                rooms = [(e.get("rename", {}).get(n, n), x, y) for n, x, y in rooms if n not in e.get("drop", [])]
            elif e["op"] == "desk":
                m = rect_mask(e["rect"])
                furn |= m; wall &= ~m; part &= ~m
                desks.append(e["rect"])
            elif e["op"] == "copy":
                x0, y0, x1, y1 = e["src"]
                i0, j0 = int(round((x0 - X0) / RES)), int(round((y0 - Y0) / RES))
                i1, j1 = int(round((x1 - X0) / RES)), int(round((y1 - Y0) / RES))
                ti, tj = int(round((e["to"][0] - X0) / RES)), int(round((e["to"][1] - Y0) / RES))
                for layer in (furn, part):
                    patch = layer[j0:j1, i0:i1].copy()
                    if e.get("mirror"):
                        patch = patch[:, ::-1]
                    layer[tj:tj + patch.shape[0], ti:ti + patch.shape[1]] |= patch
            elif e["op"] == "solid":
                solid |= rect_mask(e["rect"])
            elif e["op"] == "equip":
                equipment.append(dict(model=e["model"], x=e["x"], y=e["y"], top=e["top"], yaw=e["yaw"], **e.get("props", {})))

        if lv["id"] == "8F":
            fp = fp_8f            # set-back envelope; the rest is roof terrace
        elif lv["id"] in ("B1", "1F"):
            fp = fp_common | footprint_of(L["wall"] | L["part_all"])
        else:
            fp = fp_common
        near_ext = ndi.binary_dilation(~fp, disk(8))
        facade_wall = wall & near_ext
        facade_glass = part & near_ext
        int_wall = wall & ~facade_wall
        int_glass = part & ~facade_glass

        occ = (wall | part | furn | solid)
        # ROS map_server style: 0 = occupied, 254 = free, 205 = unknown
        img = np.full((NY, NX), 205, np.uint8)
        walk = fp if lv["id"] != "8F" else fp_common
        img[walk] = 254
        img[ndi.binary_dilation(occ, np.ones((2, 2), bool))] = 0
        Image.fromarray(img[::-1]).save(os.path.join(out, "maps", f"{lv['id']}.png"))
        with open(os.path.join(out, "maps", f"{lv['id']}.yaml"), "w", encoding="utf-8") as f:
            f.write(f"image: {lv['id']}.pgm\nresolution: {RES}\norigin: [{X0}, {Y0}, 0.0]\n"
                    "negate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n")
        Image.fromarray(img[::-1]).save(os.path.join(out, "maps", f"{lv['id']}.pgm"))

        rec = dict(lv)
        rec.update(
            walls=greedy_rects(int_wall), facade=greedy_rects(facade_wall),
            glass=greedy_rects(int_glass), facadeGlass=greedy_rects(facade_glass),
            furniture=greedy_rects(furn & ~desk_mask(desks)) + desks, footprint=greedy_rects(fp),
            terrace=greedy_rects(fp_common & ~fp_8f) if lv["id"] == "8F" else [],
            rooms=[dict(name=n, x=x, y=y) for n, x, y in rooms],
            equipment=equipment,
            map=f"maps/{lv['id']}.png",
        )
        levels_out.append(rec)
        print(lv["id"], "doors", ndoor, {k: len(rec[k]) for k in ("walls", "facade", "glass", "facadeGlass", "furniture", "footprint")})

    data = dict(
        meta=dict(name="한국폴리텍대학 분당융합기술교육원", units="m", resolution=RES,
                  origin=[X0, Y0], size=[NX, NY], gridX=GRID_X, gridY=GRID_Y,
                  frame="plan x: grid 1->5 (east), plan y: grid A->D (north), z up",
                  source="2015-12-14 interior plans IP-01..IP-28 (1:100)"),
        levels=levels_out, stairs=STAIRS, elevators=ELEVATORS,
    )
    # atomic write (a dev server may be reading the old file at the same moment on Windows)
    target = os.path.join(out, "building.json")
    tmp = target + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    for attempt in range(20):
        try:
            os.replace(tmp, target)
            break
        except OSError:
            import time
            time.sleep(0.25)
    else:
        raise OSError("could not replace " + target)
    print("wrote", os.path.join(out, "building.json"))


if __name__ == "__main__":
    main()
