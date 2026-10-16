// Builds the 3D building from building.json (generated from the floor-plan PDF).
import * as THREE from 'three';
import { GeoBuilder, MultiBuilder, PlanMask, subtractRects, toWorld } from './geo.js';
import { T, sign, stoneSet, officeFacade } from './textures.js';

const SLAB = 0.25;

function mat(key) {
  const m = MATS[key];
  return m;
}
let MATS = null;

function stoneMat(set, meters, bumpScale) {
  for (const t of [set.map, set.bump, set.rough]) t.repeat.set(1 / meters, 1 / meters);
  return new THREE.MeshStandardMaterial({ map: set.map, bumpMap: set.bump, bumpScale, roughnessMap: set.rough, roughness: 1, envMapIntensity: 0.55 });
}

function makeMaterials(envMap) {
  const tex = (fn, meters) => { const t = fn(); t.repeat.set(1 / meters, 1 / meters); return t; };
  const std = (o) => new THREE.MeshStandardMaterial({ envMapIntensity: 0.6, ...o });
  MATS = {
    vinyl: std({ map: tex(T.vinyl, 2.4), roughness: 0.55 }),
    stone: std({ map: tex(T.stone, 2.4), roughness: 0.25, metalness: 0.0 }),
    epoxy: std({ map: tex(T.epoxy, 4), roughness: 0.35 }),
    carpet: std({ map: tex(T.carpet, 2), roughness: 0.95 }),
    asphalt: std({ map: tex(T.asphalt, 6), roughness: 0.9 }),
    paving: std({ map: tex(T.paving, 4), roughness: 0.85 }),
    rubber: std({ map: tex(T.rubber, 2), roughness: 0.8 }),
    paint: std({ map: tex(T.paint, 2), color: 0xe2ddd3, roughness: 0.9 }),
    frameInt: std({ color: 0xa3a8ad, metalness: 0.6, roughness: 0.35 }),
    tileWall: std({ map: tex(T.tileWall, 1.2), roughness: 0.4 }),
    concrete: std({ map: tex(T.concrete, 3), roughness: 0.9 }),
    facadeStone: stoneMat(stoneSet('limestone', { cols: 2, rows: 4, base: '#e9dcc2', joint: '#a8987c', vary: 0.035, speckle: ['#b9ad96', '#f4efe4', '#9c9079'], grain: 0.12, rough: [0.62, 0.78], seed: 8 }), 2.4, 0.9),
    stoneBand: stoneMat(stoneSet('limestoneBand', { cols: 2, rows: 1, base: '#ece1cc', joint: '#ad9f86', vary: 0.025, speckle: ['#bdb19c', '#f6f2ea'], grain: 0.1, rough: [0.55, 0.7], seed: 18 }), 2.4, 0.6),
    granite: stoneMat(stoneSet('granite', { cols: 2, rows: 4, base: '#4a4d52', joint: '#2b2d30', vary: 0.03, speckle: ['#111214', '#8d9096', '#c3c5c8', '#2a2c2f'], grain: 0.35, rough: [0.18, 0.32], seed: 9 }), 2.4, 0.5),
    ceiling: std({ map: tex(T.ceiling, 2.4), emissiveMap: tex(T.ceilingEmit, 2.4), emissive: new THREE.Color(0xfff6e6), emissiveIntensity: 1.4, roughness: 0.9, side: THREE.DoubleSide }),
    glassInt: new THREE.MeshPhysicalMaterial({ color: 0xcfe3e6, metalness: 0.0, roughness: 0.05, transparent: true, opacity: 0.22, envMapIntensity: 1.0, depthWrite: false, side: THREE.DoubleSide }),
    // low-E reflective blue glazing (as on the street photos): mostly mirror of the sky
    glassExt: new THREE.MeshPhysicalMaterial({ color: 0x5f8db0, metalness: 0.9, roughness: 0.025, transparent: true, opacity: 0.86, envMapIntensity: 1.35, depthWrite: false, side: THREE.DoubleSide, specularIntensity: 1, clearcoat: 1, clearcoatRoughness: 0.02 }),
    frame: std({ color: 0x2b2f34, metalness: 0.75, roughness: 0.32 }),
    steel: std({ color: 0x9aa1a8, metalness: 0.9, roughness: 0.25 }),
    desk: std({ map: tex(T.wood, 1.2), color: 0xf0e2c8, roughness: 0.55 }),
    wood: std({ map: tex(T.wood, 1.2), roughness: 0.6 }),
    cabinet: std({ color: 0xd8d4cc, roughness: 0.6 }),
    leg: std({ color: 0x55595e, metalness: 0.6, roughness: 0.4 }),
    stair: std({ map: tex(T.stone, 2.4), color: 0xd9d4ca, roughness: 0.45 }),
    nosing: std({ color: 0x2c2c2c, roughness: 0.8 }),
    shaft: std({ map: tex(T.concrete, 3), roughness: 0.9, color: 0x8a8a88 }),
    car: std({ color: 0xb8bcc0, metalness: 0.85, roughness: 0.25 }),
    carFloor: std({ map: tex(T.granite, 1.2), roughness: 0.3 }),
    landingDoor: std({ color: 0xa9adb2, metalness: 0.85, roughness: 0.3 }),
    plant: std({ color: 0x4f7a3a, roughness: 0.9 }),
    soil: std({ color: 0x5b4632, roughness: 1 }),
    trunk: std({ color: 0x5a4330, roughness: 1 }),
    neighbor: std({ map: tex(() => officeFacade('a'), 3.4), roughness: 0.55, metalness: 0.15 }),
    neighbor2: std({ map: tex(() => officeFacade('b', { frame: '#8d8f91', glass: '#3b5468', spandrel: '#d8d2c6', seed: 7 }), 3.0), roughness: 0.55, metalness: 0.15 }),
    neighborRoof: std({ map: tex(T.concrete, 3), color: 0x8f918e, roughness: 0.95 }),
    roof: std({ map: tex(T.concrete, 3), color: 0x9c9f9a, roughness: 0.95 }),
    lineYellow: std({ color: 0xf2c230, roughness: 0.6 }),
    lineWhite: std({ color: 0xf2f2f2, roughness: 0.6 }),
  };
  for (const m of Object.values(MATS)) if (envMap) m.envMap = envMap;
  return MATS;
}

/** Least-squares circle through raster cells of a curved facade. */
function fitArc(cells) {
  if (cells.length < 25) return null;
  // x^2 + y^2 + D x + E y + F = 0
  let Sxx = 0, Sxy = 0, Syy = 0, Sx = 0, Sy = 0, N = 0, Sxz = 0, Syz = 0, Sz = 0;
  const pts = cells.map(([a, b, c, d]) => [(a + c) / 2, (b + d) / 2]);
  for (const [x, y] of pts) {
    const z = -(x * x + y * y);
    Sxx += x * x; Sxy += x * y; Syy += y * y; Sx += x; Sy += y; N++; Sxz += x * z; Syz += y * z; Sz += z;
  }
  const M = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, N]], B = [Sxz, Syz, Sz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const d0 = det(M); if (Math.abs(d0) < 1e-9) return null;
  const col = (i) => M.map((row, j) => row.map((v, k) => (k === i ? B[j] : v)));
  const D = det(col(0)) / d0, E = det(col(1)) / d0, F = det(col(2)) / d0;
  const xc = -D / 2, yc = -E / 2, r = Math.sqrt(xc * xc + yc * yc - F);
  if (!(r > 2 && r < 15)) return null;
  const set = new Set();
  let a0 = Infinity, a1 = -Infinity;
  cells.forEach((c, i) => {
    const [x, y] = pts[i];
    if (Math.abs(Math.hypot(x - xc, y - yc) - r) > 0.35) return;
    set.add(c);
    const a = Math.atan2(y - yc, x - xc);
    a0 = Math.min(a0, a); a1 = Math.max(a1, a);
  });
  if (set.size < 20 || a1 - a0 < 0.3) return null;
  return { xc, yc, r, a0, a1, cells: set };
}

/** True when the outward side of a facade face points to the outside of the footprint. */
function outward(mask, x, y, nx, ny) {
  return !mask.has(x + nx * 0.35, y + ny * 0.35);
}

export class Building {
  constructor(data, scene, envMap) {
    this.data = data;
    this.meta = data.meta;
    this.scene = scene;
    this.materials = makeMaterials(envMap);
    this.root = new THREE.Group(); this.root.name = 'building';
    scene.add(this.root);
    this.levels = data.levels.map((lv, i) => ({ ...lv, index: i }));
    this.byId = Object.fromEntries(this.levels.map((l) => [l.id, l]));
    this.physics = [];  // world-space geometries used for collision (floors, walls, ramps, furniture)
    this.sensors = [];  // world-space geometries seen by sensors (visual geometry)
    this.groups = {};
    this.ceilings = {};
    this.labels = {};
    this.fpMask = new PlanMask(this.meta, this.levels[3].footprint);
    for (const lv of this.levels) this.buildLevel(lv);
    this.buildRoof();
    this.buildStairs();
    this.buildShafts();
    this.site = this.buildSite();
    this.buildSignage();
  }

  levelTop(lv) { return lv.elevation + lv.height - SLAB; }

  addMeshes(mb, parent, { physics = true, sensors = true, cast = true, receive = true } = {}) {
    for (const [key, b] of mb.entries()) {
      const g = b.build();
      const m = new THREE.Mesh(g, mat(key));
      m.castShadow = cast && !key.startsWith('glass');
      m.receiveShadow = receive;
      m.userData.matKey = key;
      parent.add(m);
      if (physics && !key.startsWith('ceiling')) this.physics.push(g);
      if (sensors && !key.startsWith('ceiling')) this.sensors.push(g);
    }
  }

  slabHoles(lv) {
    const holes = [];
    for (const s of this.data.stairs) {
      const k = s.levels.indexOf(lv.id);
      if (k <= 0) continue; // lowest level of the stair keeps its slab
      const [x0, y0, x1, y1] = s.box;
      if (s.axis === 'y') holes.push([x0, s.run[0], x1, y1]);
      else holes.push([x0, y0, s.run[1], y1]);
    }
    for (const e of this.data.elevators) {
      if (e.levels.indexOf(lv.id) > 0) holes.push(e.shaft);
    }
    return holes;
  }

  buildLevel(lv) {
    const g = new THREE.Group(); g.name = `level-${lv.id}`;
    this.root.add(g); this.groups[lv.id] = g;
    const z0 = lv.elevation, zTop = this.levelTop(lv), zc = z0 + lv.ceiling;
    const mb = new MultiBuilder();
    const fp = new PlanMask(this.meta, lv.footprint);
    const terrace = new PlanMask(this.meta, lv.terrace || []);

    // ---- slab (top = floor finish)
    const floorKey = lv.id === 'B1' ? 'epoxy' : lv.id === '1F' ? 'stone' : 'vinyl';
    const holes = this.slabHoles(lv);
    const slabRects = subtractRects(lv.footprint.concat(lv.terrace || []), holes);
    for (const [x0, y0, x1, y1] of slabRects) {
      const onTerrace = terrace.has((x0 + x1) / 2, (y0 + y1) / 2);
      mb.get(onTerrace ? 'paving' : floorKey).box(x0, y0, z0 - SLAB, x1, y1, z0, { bottom: false, xn: false, xp: false, yn: false, yp: false });
      mb.get('concrete').box(x0, y0, z0 - SLAB, x1, y1, z0, { top: false, xn: false, xp: false, yn: false, yp: false });
    }
    // slab edge band on the outside
    this.slabEdges(mb, slabRects, z0 - SLAB, z0, lv.id === '1F' || lv.id === 'B1' ? 'granite' : 'facadeStone');

    // 1F parking: asphalt overlay with bay markings
    if (lv.id === '1F') {
      mb.get('asphalt').box(14.75, 5.6, z0, 27.1, 17.2, z0 + 0.01, { bottom: false });
      for (let x = 21.2; x < 27; x += 2.5) mb.get('lineWhite').box(x, 13.0, z0 + 0.01, x + 0.12, 17.0, z0 + 0.012, { bottom: false });
      mb.get('lineYellow').box(14.9, 5.7, z0 + 0.01, 15.05, 17.1, z0 + 0.012, { bottom: false });
    }

    // ---- interior walls
    const wallH = zTop;
    for (const [x0, y0, x1, y1] of lv.walls) {
      const wet = x0 > 3.5 && x1 < 8.6 && y1 < 7.6 && y0 > 0.4 && lv.index >= 2; // toilet core
      mb.get(wet ? 'tileWall' : 'paint').box(x0, y0, z0, x1, y1, wallH);
    }
    // ---- interior partitions: thin = glass, thick = drywall
    for (const [x0, y0, x1, y1] of lv.glass) {
      const t = Math.min(x1 - x0, y1 - y0), len = Math.max(x1 - x0, y1 - y0);
      if (t <= 0.06 && len >= 0.6) {
        mb.get('glassInt').box(x0, y0, z0, x1, y1, zc);
        mb.get('frameInt').box(x0 - 0.01, y0 - 0.01, zc - 0.05, x1 + 0.01, y1 + 0.01, zc);
        mb.get('frameInt').box(x0 - 0.01, y0 - 0.01, z0, x1 + 0.01, y1 + 0.01, z0 + 0.08);
      } else {
        mb.get('paint').box(x0, y0, z0, x1, y1, Math.min(zc + 0.15, wallH));
      }
    }

    // ---- facade
    const outerKey = lv.id === '1F' || lv.id === 'B1' ? 'granite' : 'facadeStone';
    const parapetZ = z0 + 1.1;
    for (const r of lv.facade) {
      const [x0, y0, x1, y1] = r;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (terrace.has(cx, cy)) { this.facadeBox(mb, r, z0, parapetZ, fp, outerKey); continue; }
      const t = Math.min(x1 - x0, y1 - y0), len = Math.max(x1 - x0, y1 - y0);
      const windows = lv.id !== 'B1' && lv.id !== '1F' && t <= 0.5 && len >= 1.2;
      if (!windows) { this.facadeBox(mb, r, z0, wallH, fp, outerKey); continue; }
      const s0 = z0 + 0.9, s1 = Math.min(z0 + 2.45, wallH - 0.2);
      this.facadeBox(mb, r, z0, s0, fp, outerKey);
      this.facadeBox(mb, r, s1, wallH, fp, outerKey);
      // window: glazing in the middle of the wall thickness + frame
      const alongX = (x1 - x0) >= (y1 - y0);
      const gx0 = alongX ? x0 : cx - 0.015, gx1 = alongX ? x1 : cx + 0.015;
      const gy0 = alongX ? cy - 0.015 : y0, gy1 = alongX ? cy + 0.015 : y1;
      mb.get('glassExt').box(gx0, gy0, s0, gx1, gy1, s1);
      mb.get('frame').box(x0, y0, s0, x1, y1, s0 + 0.05);
      mb.get('frame').box(x0, y0, s1 - 0.05, x1, y1, s1);
      const n = Math.max(1, Math.round(len / 1.5));
      for (let k = 0; k <= n; k++) {
        const a = (alongX ? x0 : y0) + (len * k) / n;
        if (alongX) mb.get('frame').box(Math.max(x0, a - 0.03), gy0 - 0.03, s0, Math.min(x1, a + 0.03), gy1 + 0.03, s1);
        else mb.get('frame').box(gx0 - 0.03, Math.max(y0, a - 0.03), s0, gx1 + 0.03, Math.min(y1, a + 0.03), s1);
      }
    }
    // curtain wall glazing (incl. the curved SE corner)
    const mullionCells = new Set();
    // the curved SE bay: fit a circle to its raster cells and build it smooth
    const arc = lv.index >= 2 ? fitArc(lv.facadeGlass.filter(([a, b, c, d]) => (a + c) / 2 > 19 && (b + d) / 2 < 7 && !terrace.has((a + c) / 2, (b + d) / 2))) : null;
    if (arc) this.curvedBay(mb, arc, lv, z0, zc, wallH);
    for (const r of lv.facadeGlass) {
      const [x0, y0, x1, y1] = r;
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      if (arc && arc.cells.has(r)) continue;
      if (terrace.has(cx, cy)) { mb.get('steel').box(x0, y0, z0 + 1.05, x1, y1, z0 + 1.1); mb.get('glassInt').box(x0, y0, z0, x1, y1, z0 + 1.05); continue; }
      mb.get('glassExt').box(x0, y0, z0, x1, y1, wallH);
      // projecting stone floor ledge (the thick bands of the curved bay on the photos)
      if (lv.index >= 2) {
        const e = 0.34;
        mb.get('stoneBand').box(x0 - e, y0 - e, z0 - 0.4, x1 + e, y1 + e, z0 - 0.02, null);
        if (lv.id === '7F') mb.get('stoneBand').box(x0 - e, y0 - e, z0 + lv.height - 0.45, x1 + e, y1 + e, z0 + lv.height - 0.02, null);
      }
      // horizontal transoms at sill and ceiling height + spandrel at slab
      mb.get('frame').box(x0 - 0.02, y0 - 0.02, z0, x1 + 0.02, y1 + 0.02, z0 + 0.06);
      mb.get('frame').box(x0 - 0.02, y0 - 0.02, zc, x1 + 0.02, y1 + 0.02, zc + 0.06);
      const len = Math.max(x1 - x0, y1 - y0);
      if (len >= 1.0) {
        const alongX = (x1 - x0) >= (y1 - y0);
        const n = Math.max(1, Math.round(len / 1.2));
        for (let k = 0; k <= n; k++) {
          const a = (alongX ? x0 : y0) + (len * k) / n;
          if (alongX) mb.get('frame').box(a - 0.025, y0 - 0.03, z0, a + 0.025, y1 + 0.03, wallH);
          else mb.get('frame').box(x0 - 0.03, a - 0.025, z0, x1 + 0.03, a + 0.025, wallH);
        }
      } else {
        // curved glazing is a chain of small cells: one mullion per ~1 m cell
        const key = `${Math.floor(cx / 1.1)},${Math.floor(cy / 1.1)}`;
        if (!mullionCells.has(key)) {
          mullionCells.add(key);
          mb.get('frame').box(cx - 0.03, cy - 0.03, z0, cx + 0.03, cy + 0.03, wallH);
        }
      }
    }

    // ---- furniture (fixed furniture layer of the drawings)
    for (const r of lv.furniture) this.furniture(mb, r, z0, zc);

    // terrace planters + shrubs
    if (lv.terrace && lv.terrace.length) this.terraceGreen(mb, lv, z0);

    this.addMeshes(mb, g);

    // ---- ceiling (separate so cutaway can hide it)
    const cb = new MultiBuilder();
    for (const [x0, y0, x1, y1] of subtractRects(lv.footprint, holes.concat(this.data.stairs.filter((s) => s.levels.includes(lv.id)).map((s) => s.box)))) {
      cb.get('ceiling').quad([x0, y1, zc], [x1, y1, zc], [x1, y0, zc], [x0, y0, zc], [0, 0, -1]);
    }
    const cg = new THREE.Group(); cg.name = `ceiling-${lv.id}`; g.add(cg);
    this.addMeshes(cb, cg, { physics: false, sensors: false, cast: false });
    this.ceilings[lv.id] = cg;
  }

  /** Smooth cylindrical curtain wall with mullions, transoms and projecting stone ledges. */
  curvedBay(mb, arc, lv, z0, zc, wallH) {
    const { xc, yc, r, a0, a1 } = arc;
    const L = r * (a1 - a0), n = Math.max(8, Math.ceil(L / 0.25));
    const P = (a, rr, z) => [xc + rr * Math.cos(a), yc + rr * Math.sin(a), z];
    const ring = (key, rIn, rOut, zb, zt, caps = true) => {
      const b = mb.get(key);
      for (let i = 0; i < n; i++) {
        const u = a0 + ((a1 - a0) * i) / n, v = a0 + ((a1 - a0) * (i + 1)) / n, m = (u + v) / 2;
        const no = [Math.cos(m), Math.sin(m), 0], ni = [-no[0], -no[1], 0];
        b.quad(P(u, rOut, zb), P(v, rOut, zb), P(v, rOut, zt), P(u, rOut, zt), no);
        b.quad(P(v, rIn, zb), P(u, rIn, zb), P(u, rIn, zt), P(v, rIn, zt), ni);
        if (caps) {
          b.quad(P(u, rIn, zt), P(u, rOut, zt), P(v, rOut, zt), P(v, rIn, zt), [0, 0, 1]);
          b.quad(P(v, rIn, zb), P(v, rOut, zb), P(u, rOut, zb), P(u, rIn, zb), [0, 0, -1]);
        }
      }
    };
    ring('glassExt', r - 0.012, r + 0.012, z0, wallH, false);
    ring('frame', r - 0.04, r + 0.04, z0, z0 + 0.07);      // sill transom
    ring('frame', r - 0.04, r + 0.04, zc, zc + 0.07);      // head transom
    ring('stoneBand', r - 0.3, r + 0.36, z0 - 0.4, z0 - 0.02);  // floor ledge
    if (lv.id === '7F') ring('stoneBand', r - 0.3, r + 0.42, z0 + lv.height - 0.5, z0 + lv.height - 0.02);
    const nm = Math.max(2, Math.round(L / 1.2));
    for (let k = 0; k <= nm; k++) {
      const a = a0 + ((a1 - a0) * k) / nm, [x, y] = P(a, r, 0);
      mb.get('frame').box(x - 0.035, y - 0.035, z0, x + 0.035, y + 0.035, wallH);
    }
  }

  facadeBox(mb, [x0, y0, x1, y1], z0, z1, fp, outerKey) {
    if (z1 - z0 < 0.01) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const side = (k, nx, ny, px, py) => (outward(fp, px, py, nx, ny) ? outerKey : 'paint');
    const faces = [
      ['xn', -1, 0, x0, cy], ['xp', 1, 0, x1, cy], ['yn', 0, -1, cx, y0], ['yp', 0, 1, cx, y1],
    ];
    for (const [k, nx, ny, px, py] of faces) {
      const only = { top: false, bottom: false, xn: false, xp: false, yn: false, yp: false, [k]: true };
      mb.get(side(k, nx, ny, px, py)).box(x0, y0, z0, x1, y1, z1, only);
    }
    mb.get(outerKey).box(x0, y0, z0, x1, y1, z1, { xn: false, xp: false, yn: false, yp: false });
  }

  slabEdges(mb, rects, z0, z1, key) {
    for (const [x0, y0, x1, y1] of rects) {
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const test = (x, y) => !this.fpMask.has(x, y) || x > 27.3 || y < -0.2;
      if (test(x0 - 0.1, cy)) mb.get(key).box(x0, y0, z0, x1, y1, z1, { top: false, bottom: false, xp: false, yn: false, yp: false });
      if (test(x1 + 0.1, cy)) mb.get(key).box(x0, y0, z0, x1, y1, z1, { top: false, bottom: false, xn: false, yn: false, yp: false });
      if (test(cx, y0 - 0.1)) mb.get(key).box(x0, y0, z0, x1, y1, z1, { top: false, bottom: false, xn: false, xp: false, yp: false });
      if (test(cx, y1 + 0.1)) mb.get(key).box(x0, y0, z0, x1, y1, z1, { top: false, bottom: false, xn: false, xp: false, yn: false });
    }
  }

  furniture(mb, [x0, y0, x1, y1], z0, zc) {
    const w = x1 - x0, d = y1 - y0, t = Math.min(w, d), L = Math.max(w, d);
    if (t < 0.12) return; // whiteboards / thin trims
    if (t < 0.5 && L > 1.6) { // cabinets, lockers, racks along walls
      mb.get('cabinet').box(x0, y0, z0, x1, y1, z0 + Math.min(1.8, zc - 0.3));
      return;
    }
    if (L > 3.2) { // long counters / benches
      mb.get('cabinet').box(x0 + 0.02, y0 + 0.02, z0, x1 - 0.02, y1 - 0.02, z0 + 0.86);
      mb.get('wood').box(x0, y0, z0 + 0.86, x1, y1, z0 + 0.9);
      return;
    }
    // desk / table: top + legs (lidars at low height see only the legs)
    const top = z0 + 0.72, th = 0.03, lg = 0.05, ins = 0.04;
    mb.get('desk').box(x0, y0, top, x1, y1, top + th);
    const nx = Math.max(1, Math.round(w / 1.2)), ny = Math.max(1, Math.round(d / 1.2));
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) {
      if (i > 0 && i < nx && j > 0 && j < ny) continue;
      const lx = x0 + ins + (w - 2 * ins - lg) * (i / nx), ly = y0 + ins + (d - 2 * ins - lg) * (j / ny);
      mb.get('leg').box(lx, ly, z0, lx + lg, ly + lg, top);
    }
    // modesty panel for desk rows
    if (t > 0.5 && t < 0.9) {
      if (w >= d) mb.get('leg').box(x0 + 0.1, (y0 + y1) / 2 - 0.01, z0 + 0.3, x1 - 0.1, (y0 + y1) / 2 + 0.01, top);
      else mb.get('leg').box((x0 + x1) / 2 - 0.01, y0 + 0.1, z0 + 0.3, (x0 + x1) / 2 + 0.01, y1 - 0.1, top);
    }
  }

  terraceGreen(mb, lv, z0) {
    // planter strip inside the parapet along the south and east terrace edge
    const spots = [];
    for (let x = 1; x < 22; x += 2.6) spots.push([x, 0.6]);
    for (let y = 2; y < 16; y += 2.6) spots.push([26.4, y]);
    for (const [x, y] of spots) {
      if (!new PlanMask(this.meta, lv.terrace).has(x, y)) continue;
      mb.get('soil').box(x - 0.6, y - 0.4, z0, x + 0.6, y + 0.4, z0 + 0.45);
      mb.get('plant').box(x - 0.45, y - 0.3, z0 + 0.45, x + 0.45, y + 0.3, z0 + 1.0);
    }
  }

  buildRoof() {
    const top = this.levels[this.levels.length - 1];
    const z = top.elevation + top.height - SLAB;
    const mb = new MultiBuilder();
    const holes = this.data.elevators.map((e) => e.shaft);
    for (const [x0, y0, x1, y1] of top.footprint) {
      mb.get('roof').box(x0, y0, z, x1, y1, z + SLAB, { bottom: false });
      mb.get('concrete').box(x0, y0, z, x1, y1, z + SLAB, { top: false, xn: false, xp: false, yn: false, yp: false });
    }
    this.slabEdges(mb, top.footprint, z, z + SLAB, 'facadeStone');
    // parapet ring from the 8F facade boxes
    for (const r of top.facade.concat(top.facadeGlass)) {
      const [x0, y0, x1, y1] = r;
      if (new PlanMask(this.meta, top.terrace).has((x0 + x1) / 2, (y0 + y1) / 2)) continue;
      mb.get('facadeStone').box(x0, y0, z + SLAB, x1, y1, z + SLAB + 0.9);
    }
    // elevator machine room / stair penthouse
    mb.get('facadeStone').box(0.0, 7.6, z + SLAB, 3.1, 12.5, z + SLAB + 2.8);
    mb.get('facadeStone').box(0.0, 14.0, z + SLAB, 4.4, 17.2, z + SLAB + 2.8);
    // rooftop units
    for (let i = 0; i < 4; i++) mb.get('steel').box(8 + i * 3.2, 9, z + SLAB, 10.2 + i * 3.2, 11.2, z + SLAB + 1.4);
    const g = new THREE.Group(); g.name = 'roof'; this.root.add(g); this.roof = g;
    this.addMeshes(mb, g);
  }

  buildStairs() {
    this.stairRamps = [];
    this.stairPaths = {}; // `${stairId}:${fromId}` -> plan waypoints with z
    const mb = new MultiBuilder();
    const pb = new GeoBuilder(); // physics ramps
    for (const s of this.data.stairs) {
      for (let k = 0; k < s.levels.length; k++) {
        const A = this.byId[s.levels[k]];
        const B = k + 1 < s.levels.length ? this.byId[s.levels[k + 1]] : null;
        const [bx0, by0, bx1, by1] = s.box;
        // floor landing finish on every level
        if (s.axis === 'y') mb.get('stair').box(bx0, by0, A.elevation, bx1, s.run[0], A.elevation + 0.02, { bottom: false });
        else mb.get('stair').box(s.run[1], by0, A.elevation, bx1, by1, A.elevation + 0.02, { bottom: false });
        if (!B) continue;
        const H = B.elevation - A.elevation, half = H / 2;
        const zA = A.elevation, zM = zA + half, zB = B.elevation;
        const n = Math.round(half / 0.17), rise = half / n;
        const [r0, r1] = s.run, run = r1 - r0, tread = run / n;
        // mid landing
        if (s.axis === 'y') { mb.get('stair').box(bx0, r1, zM - 0.2, bx1, by1, zM); pb.box(bx0, r1, zM - 0.2, bx1, by1, zM); }
        else { mb.get('stair').box(bx0, by0, zM - 0.2, r0, by1, zM); pb.box(bx0, by0, zM - 0.2, r0, by1, zM); }
        const flights = s.axis === 'y'
          ? [{ lat: s.flightA, from: r0, to: r1, z: zA }, { lat: s.flightB, from: r1, to: r0, z: zM }]
          : [{ lat: s.flightA, from: r1, to: r0, z: zA }, { lat: s.flightB, from: r0, to: r1, z: zM }];
        const path = [];
        for (const f of flights) {
          const dir = Math.sign(f.to - f.from);
          for (let i = 0; i < n; i++) {
            const a = f.from + dir * tread * i, b = a + dir * tread;
            const lo = Math.min(a, b), hi = Math.max(a, b);
            const zt = f.z + rise * (i + 1);
            const [l0, l1] = f.lat;
            if (s.axis === 'y') {
              mb.get('stair').box(l0, lo, zt - rise - 0.18, l1, hi, zt);
              const ny = dir > 0 ? lo : hi - 0.04;
              mb.get('nosing').box(l0, ny, zt - 0.005, l1, ny + 0.04, zt + 0.003, { bottom: false });
            } else {
              mb.get('stair').box(lo, l0, zt - rise - 0.18, hi, l1, zt);
              const nx = dir > 0 ? lo : hi - 0.04;
              mb.get('nosing').box(nx, l0, zt - 0.005, nx + 0.04, l1, zt + 0.003, { bottom: false });
            }
          }
          // ramp for physics (walk surface across tread nosings)
          const [l0, l1] = f.lat, z0 = f.z, z1 = f.z + half;
          const P = s.axis === 'y'
            ? [[l0, f.from, z0], [l1, f.from, z0], [l1, f.to, z1], [l0, f.to, z1]]
            : [[f.from, l1, z0], [f.from, l0, z0], [f.to, l0, z1], [f.to, l1, z1]];
          pb.tri(P[0], P[1], P[2]); pb.tri(P[0], P[2], P[3]);
          pb.tri(P[0], P[2], P[1]); pb.tri(P[0], P[3], P[2]);
          const mid = (l0 + l1) / 2;
          if (s.axis === 'y') path.push([mid, f.from - dir * 0.3, z0], [mid, f.to + dir * 0.25, z1]);
          else path.push([f.from - dir * 0.3, mid, z0], [f.to + dir * 0.25, mid, z1]);
          // handrail on the outer wall side
          const rl = s.axis === 'y' ? (f.lat === s.flightA ? l0 + 0.05 : l1 - 0.05) : (f.lat === s.flightA ? l1 - 0.05 : l0 + 0.05);
          this.handrail(mb, s.axis, rl, f.from, f.to, z0 + 0.9, z1 + 0.9);
        }
        // divider wall between the two flights
        const dv = s.axis === 'y' ? [s.flightA[1], r0, s.flightB[0], r1] : [r0, s.flightB[1], r1, s.flightA[0]];
        mb.get('paint').box(dv[0], dv[1], zA, dv[2], dv[3], zB);
        pb.box(dv[0], dv[1], zA, dv[2], dv[3], zB);
        this.stairPaths[`${s.id}:${A.id}>${B.id}`] = path;
        this.stairPaths[`${s.id}:${B.id}>${A.id}`] = path.slice().reverse();
      }
    }
    const g = new THREE.Group(); g.name = 'stairs'; this.root.add(g); this.stairsGroup = g;
    this.addMeshes(mb, g, { physics: false });
    this.physics.push(pb.build());
    this.stairMeshesByLevel = null;
  }

  handrail(mb, axis, lat, a, b, z0, z1) {
    const n = 12;
    for (let i = 0; i < n; i++) {
      const u0 = a + (b - a) * (i / n), u1 = a + (b - a) * ((i + 1) / n);
      const lo = Math.min(u0, u1), hi = Math.max(u0, u1), z = z0 + (z1 - z0) * ((i + 0.5) / n);
      if (axis === 'y') mb.get('steel').box(lat - 0.02, lo, z - 0.02, lat + 0.02, hi, z + 0.02);
      else mb.get('steel').box(lo, lat - 0.02, z - 0.02, hi, lat + 0.02, z + 0.02);
    }
  }

  buildShafts() {
    // shaft walls run the full height (raster walls are cleared inside the shaft)
    const mb = new MultiBuilder();
    for (const e of this.data.elevators) {
      const lvls = e.levels.map((id) => this.byId[id]);
      const zBot = lvls[0].elevation - 1.2, zTop = this.levelTop(lvls[lvls.length - 1]) + SLAB + 2.6;
      const [x0, y0, x1, y1] = e.shaft, t = 0.15;
      mb.get('shaft').box(x0 - t, y0 - t, zBot, x0, y1 + t, zTop);
      mb.get('shaft').box(x0, y0 - t, zBot, x1 + t, y0, zTop);
      mb.get('shaft').box(x0, y1, zBot, x1 + t, y1 + t, zTop);
      mb.get('shaft').box(x0, y0, zBot - 0.2, x1, y1, zBot);
      // front wall with one opening per landing
      for (const lv of lvls) {
        const zf = lv.elevation, zt = this.levelTop(lv);
        mb.get('paint').box(x1, y0 - t, zf, x1 + t, e.door[0], zt);
        mb.get('paint').box(x1, e.door[1], zf, x1 + t, y1 + t, zt);
        mb.get('paint').box(x1, e.door[0], zf + 2.15, x1 + t, e.door[1], zt);
        // stainless door frame: two jambs + header
        mb.get('steel').box(x1 + t, e.door[0] - 0.08, zf, x1 + t + 0.03, e.door[0], zf + 2.2, { xn: false });
        mb.get('steel').box(x1 + t, e.door[1], zf, x1 + t + 0.03, e.door[1] + 0.08, zf + 2.2, { xn: false });
        mb.get('steel').box(x1 + t, e.door[0] - 0.08, zf + 2.15, x1 + t + 0.03, e.door[1] + 0.08, zf + 2.25, { xn: false });
        // landing slab sill + gap filler between levels
        mb.get('paint').box(x1, y0 - t, zt, x1 + t, y1 + t, zt + SLAB);
      }
    }
    const g = new THREE.Group(); g.name = 'shafts'; this.root.add(g);
    this.addMeshes(mb, g);
  }

  buildSite() {
    const g = new THREE.Group(); g.name = 'site'; this.scene.add(g);
    const mb = new MultiBuilder();
    // ground ring around the footprint (keep the footprint itself open for B1 cutaway)
    const zg = -0.03;
    mb.get('paving').box(-6, -6, zg - 0.1, 33, -0.3, zg, { bottom: false });
    mb.get('paving').box(-6, 17.5, zg - 0.1, 33, 23, zg, { bottom: false });
    mb.get('paving').box(-6, -0.3, zg - 0.1, -0.3, 17.5, zg, { bottom: false });
    mb.get('asphalt').box(27.35, -0.3, zg - 0.1, 33, 17.5, zg, { bottom: false });
    mb.get('asphalt').box(-60, -18, zg - 0.12, 90, -6, zg - 0.02, { bottom: false });
    mb.get('asphalt').box(33, -6, zg - 0.12, 45, 60, zg - 0.02, { bottom: false });
    mb.get('paving').box(-60, -60, zg - 0.14, 90, 80, zg - 0.04, { bottom: false });
    // road markings
    for (let x = -55; x < 85; x += 6) mb.get('lineWhite').box(x, -12.1, zg - 0.019, x + 3, -11.95, zg - 0.015, { bottom: false });
    // neighbours (simple massing, as in the street photos)
    const nb = [[-22, 2, -8, 20, 24], [30.5, 24, 46, 40, 18], [-24, 26, -6, 44, 31], [6, 26, 22, 40, 15], [36, -2, 48, 18, 12]];
    for (const [x0, y0, x1, y1, h] of nb) {
      const k = (x0 + y0) % 2 ? 'neighbor2' : 'neighbor';
      mb.get(k).box(x0, y0, 0, x1, y1, h, { top: false, bottom: false });
      mb.get('neighborRoof').box(x0, y0, h, x1, y1, h + 0.01, { bottom: false });
      mb.get('neighborRoof').box(x0 - 0.2, y0 - 0.2, h - 0.3, x1 + 0.2, y1 + 0.2, h + 0.6, { bottom: false });
    }
    // street trees + lamp posts on the south sidewalk
    const trees = [];
    for (let x = -4; x < 32; x += 6.5) {
      mb.get('trunk').box(x - 0.1, -4.18, 0, x + 0.1, -3.98, 2.4);
      mb.get('soil').box(x - 0.6, -4.7, -0.02, x + 0.6, -3.5, 0.02);
      trees.push([x, -4.08]);
    }
    for (let y = 1; y < 17; y += 6) trees.push([30.5, y]);
    for (let x = -1; x < 30; x += 9) {
      mb.get('frame').box(x - 0.06, -1.9, 0, x + 0.06, -1.78, 4.2);
      mb.get('lineWhite').box(x - 0.35, -2.05, 4.2, x + 0.35, -1.6, 4.5);
    }
    this.addMeshes(mb, g, { physics: true, sensors: true });
    // foliage: clusters of low-poly blobs
    const leafGeo = new THREE.IcosahedronGeometry(1, 1);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x56783a, roughness: 0.95, flatShading: true });
    const leaf2 = new THREE.MeshStandardMaterial({ color: 0x3d5c2b, roughness: 0.95, flatShading: true });
    const blobs = [[0, 3.4, 0, 1.5], [0.8, 3.0, 0.3, 1.0], [-0.7, 3.1, -0.4, 1.05], [0.1, 4.3, 0.2, 1.0], [-0.3, 2.9, 0.7, 0.9]];
    const inst = new THREE.InstancedMesh(leafGeo, leafMat, trees.length * blobs.length);
    const inst2 = new THREE.InstancedMesh(leafGeo, leaf2, trees.length * 2);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3();
    let k = 0, k2 = 0;
    trees.forEach(([x, y], ti) => {
      const w = toWorld(x, y, 0);
      blobs.forEach(([dx, dz, dy, r], bi) => {
        const j = 0.85 + 0.3 * Math.abs(Math.sin(ti * 3.1 + bi));
        m4.compose(sv.set(w.x + dx, dz, w.z + dy), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ti + bi), new THREE.Vector3(r * j, r * j * 0.85, r * j));
        inst.setMatrixAt(k++, m4);
      });
      for (let b = 0; b < 2; b++) {
        m4.compose(sv.set(w.x + (b ? -0.9 : 0.9), 3.6, w.z + (b ? 0.5 : -0.5)), q, new THREE.Vector3(0.8, 0.7, 0.8));
        inst2.setMatrixAt(k2++, m4);
      }
    });
    inst.castShadow = inst2.castShadow = true;
    g.add(inst, inst2);
    return g;
  }

  buildSignage() {
    const g = new THREE.Group(); g.name = 'signage'; this.root.add(g);
    const plane = (tex, w, h, pos, rotY, emissive = 0) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, emissive: emissive ? 0xffffff : 0, emissiveMap: emissive ? tex : null, emissiveIntensity: emissive }));
      m.position.copy(toWorld(...pos)); m.rotation.y = rotY; g.add(m); return m;
    };
    const top = this.byId['8F'];
    // name signs near the parapet (south and east facades)
    const name = sign('한국폴리텍대학 분당융합기술교육원', { w: 2048, h: 192, font: 'bold 120px "Malgun Gothic", "Noto Sans KR", sans-serif' });
    plane(name, 14, 1.3, [8.0, -0.32, top.elevation - 1.2], 0);
    plane(name, 14, 1.3, [27.42, 10.0, top.elevation - 1.2], Math.PI / 2);
    // vertical sign at the entrance column (as on the street photos)
    const vert = sign('한국폴리텍대학분당융합기술교육원', { w: 256, h: 2600, fg: '#ffffff', bg: '#1d2a50', font: 'bold 150px "Malgun Gothic", "Noto Sans KR", sans-serif', vertical: true });
    plane(vert, 0.6, 6, [-0.35, 2.0, 4.0], -Math.PI / 2);
    // yellow recruitment banner above the 1F parking entrance
    const banner = sign('교육비 전액 정부지원 · 교육수당 지급\nAI·SW 개발자 / 품질관리전문가(바이오·이화학) 취업실무 교육 모집', { w: 2048, h: 256, bg: '#f2b632', fg: '#1d2a50', font: 'bold 64px "Malgun Gothic", "Noto Sans KR", sans-serif' });
    plane(banner, 9.0, 1.1, [22.4, -0.42, 3.8], 0);
    // lobby & parking signs
    const p = sign('P', { w: 256, h: 256, bg: '#1d2a50', fg: '#ffffff', font: 'bold 200px sans-serif' });
    plane(p, 0.8, 0.8, [27.45, 3.5, 3.2], Math.PI / 2, 0.4);
    const lobby = sign('한국폴리텍대학 분당융합기술교육원', { w: 1024, h: 128, fg: '#ffffff', font: 'bold 64px "Malgun Gothic", "Noto Sans KR", sans-serif' });
    plane(lobby, 4.5, 0.55, [6.0, 4.0, 2.2], 0, 0.6);
  }

  /** Make cutaway / single-level / full views. */
  setView(mode, levelId) {
    const sel = levelId ? this.byId[levelId].index : this.levels.length - 1;
    for (const lv of this.levels) {
      const vis = mode === 'exterior' || mode === 'walk' ? true : mode === 'single' ? lv.index === sel : lv.index <= sel;
      this.groups[lv.id].visible = vis;
      this.ceilings[lv.id].visible = mode === 'walk' || (mode === 'exterior') || lv.index < sel;
    }
    const cut = mode === 'cutaway' || mode === 'single';
    this.roof.visible = !cut;
    this.site.visible = !(cut && sel === 0);
    const zMax = cut ? this.levels[sel].elevation + this.levels[sel].ceiling + 0.02 : Infinity;
    const zMin = mode === 'single' ? this.levels[sel].elevation - SLAB - 0.05 : -Infinity;
    if (!this._clip) this._clip = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 0), new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)];
    this._clip[0].constant = zMax;
    this._clip[1].constant = -zMin;
    // renderer-wide clipping planes (main.js applies them for the main view only)
    this.clipPlanes = !cut ? [] : Number.isFinite(zMin) ? this._clip : [this._clip[0]];
  }

  levelAt(z) {
    let best = this.levels[0];
    for (const lv of this.levels) if (z >= lv.elevation - 0.6) best = lv;
    return best;
  }
}
