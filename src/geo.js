// Geometry helpers. Plan frame: x east (grid 1->5), y north (grid A->D), z up.
// three.js frame: X = x, Y = z, Z = -y.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const toWorld = (x, y, z, out = new THREE.Vector3()) => out.set(x, z, -y);
export const toPlan = (v) => ({ x: v.x, y: -v.z, z: v.y });

/** Accumulates triangles with world-space (metre) UVs. */
export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; }
  get empty() { return this.p.length === 0; }

  // quad with corners in plan coords [x,y,z]; normal in plan coords; uv axes picked from normal
  quad(a, b, c, d, nrm) {
    const [nx, ny, nz] = nrm;
    const uvOf = (q) => {
      if (Math.abs(nz) > 0.5) return [q[0], q[1]];
      if (Math.abs(nx) > Math.abs(ny)) return [q[1] * Math.sign(nx), q[2]];
      return [-q[0] * Math.sign(ny), q[2]];
    };
    for (const q of [a, b, c, a, c, d]) {
      this.p.push(q[0], q[2], -q[1]);
      this.n.push(nx, nz, -ny);
      this.uv.push(...uvOf(q));
    }
  }

  tri(a, b, c) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), C = new THREE.Vector3(...c);
    const n = B.clone().sub(A).cross(C.clone().sub(A)).normalize();
    for (const q of [a, b, c]) {
      this.p.push(q[0], q[2], -q[1]);
      this.n.push(n.x, n.z, -n.y);
      this.uv.push(q[0], q[1]);
    }
  }

  /** Axis aligned box. faces: {top,bottom,xn,xp,yn,yp} booleans (default all). */
  box(x0, y0, z0, x1, y1, z1, faces = null) {
    const f = (k) => !faces || faces[k] !== false;
    if (f('top')) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    if (f('bottom')) this.quad([x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [0, 0, -1]);
    if (f('yn')) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    if (f('yp')) this.quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [0, 1, 0]);
    if (f('xn')) this.quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]);
    if (f('xp')) this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Map of material-key -> GeoBuilder. */
export class MultiBuilder {
  constructor() { this.b = new Map(); }
  get(key) { if (!this.b.has(key)) this.b.set(key, new GeoBuilder()); return this.b.get(key); }
  entries() { return [...this.b.entries()].filter(([, v]) => !v.empty); }
}

/** Boolean raster of plan rectangles (same grid as the extractor). */
export class PlanMask {
  constructor(meta, rects = []) {
    this.res = meta.resolution; [this.x0, this.y0] = meta.origin; [this.nx, this.ny] = meta.size;
    this.d = new Uint8Array(this.nx * this.ny);
    for (const r of rects) this.fill(r, 1);
  }
  fill([x0, y0, x1, y1], v) {
    const i0 = Math.max(0, Math.round((x0 - this.x0) / this.res)), i1 = Math.min(this.nx, Math.round((x1 - this.x0) / this.res));
    const j0 = Math.max(0, Math.round((y0 - this.y0) / this.res)), j1 = Math.min(this.ny, Math.round((y1 - this.y0) / this.res));
    for (let j = j0; j < j1; j++) this.d.fill(v, j * this.nx + i0, j * this.nx + i1);
  }
  has(x, y) {
    const i = Math.floor((x - this.x0) / this.res), j = Math.floor((y - this.y0) / this.res);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return false;
    return this.d[j * this.nx + i] === 1;
  }
}

/** Subtract axis aligned holes from a rectangle list. */
export function subtractRects(rects, holes) {
  let cur = rects.map((r) => r.slice());
  for (const h of holes) {
    const next = [];
    for (const r of cur) {
      const [ax0, ay0, ax1, ay1] = r, [bx0, by0, bx1, by1] = h;
      if (bx0 >= ax1 || bx1 <= ax0 || by0 >= ay1 || by1 <= ay0) { next.push(r); continue; }
      if (ay0 < by0) next.push([ax0, ay0, ax1, by0]);
      if (by1 < ay1) next.push([ax0, by1, ax1, ay1]);
      const yy0 = Math.max(ay0, by0), yy1 = Math.min(ay1, by1);
      if (ax0 < bx0) next.push([ax0, yy0, bx0, yy1]);
      if (bx1 < ax1) next.push([bx1, yy0, ax1, yy1]);
    }
    cur = next;
  }
  return cur;
}

export function merge(geoms) {
  const g = geoms.filter(Boolean);
  if (!g.length) return null;
  return g.length === 1 ? g[0] : mergeGeometries(g, false);
}
