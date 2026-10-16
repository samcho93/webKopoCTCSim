// Grid navigation: per-level occupancy grids (from the generated maps),
// inflation, A* and a multi-level route planner using elevators / stairs.

export class LevelGrid {
  constructor(meta, img, building, level) {
    this.res = meta.resolution; [this.x0, this.y0] = meta.origin; [this.nx, this.ny] = meta.size;
    this.level = level;
    const c = document.createElement('canvas'); c.width = this.nx; c.height = this.ny;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, this.nx, this.ny).data;
    // image row 0 = north edge (max y); grid row 0 = min y
    this.occ = new Uint8Array(this.nx * this.ny); // 0 free, 1 occupied, 2 unknown
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const v = px[((this.ny - 1 - j) * this.nx + i) * 4];
      this.occ[j * this.nx + i] = v < 50 ? 1 : v > 250 ? 0 : 2;
    }
    // vertical circulation voids are not drivable floor
    for (const s of building.data.stairs) {
      if (!s.levels.includes(level.id)) continue;
      const [x0, y0, x1, y1] = s.box;
      if (s.axis === 'y') this.mark([x0, s.run[0] + 0.05, x1, y1], 1);
      else this.mark([x0, y0, s.run[1] - 0.05, y1], 1);
    }
    for (const e of building.data.elevators) if (e.levels.includes(level.id)) this.mark(e.shaft, 1);
    this.inflated = {};
  }

  mark([x0, y0, x1, y1], v) {
    const [i0, j0] = this.cell(x0, y0), [i1, j1] = this.cell(x1, y1);
    for (let j = Math.max(0, j0); j <= Math.min(this.ny - 1, j1); j++)
      for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) this.occ[j * this.nx + i] = v;
    this.inflated = {};
  }

  cell(x, y) { return [Math.floor((x - this.x0) / this.res), Math.floor((y - this.y0) / this.res)]; }
  center(i, j) { return [this.x0 + (i + 0.5) * this.res, this.y0 + (j + 0.5) * this.res]; }

  /** Cost grid with obstacles inflated by radius (m). 255 = blocked. */
  costmap(radius) {
    radius = Math.round(radius * 100) / 100;
    const key = radius.toFixed(2);
    if (this.inflated[key]) return this.inflated[key];
    const { nx, ny } = this;
    // distance transform (two pass chamfer) in cells
    const INF = 1e9, d = new Float32Array(nx * ny);
    for (let k = 0; k < d.length; k++) d[k] = this.occ[k] ? 0 : INF;
    const a = 1, b = Math.SQRT2;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i; let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + a);
      if (j > 0) { v = Math.min(v, d[k - nx] + a); if (i > 0) v = Math.min(v, d[k - nx - 1] + b); if (i < nx - 1) v = Math.min(v, d[k - nx + 1] + b); }
      d[k] = v;
    }
    for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
      const k = j * nx + i; let v = d[k];
      if (i < nx - 1) v = Math.min(v, d[k + 1] + a);
      if (j < ny - 1) { v = Math.min(v, d[k + nx] + a); if (i < nx - 1) v = Math.min(v, d[k + nx + 1] + b); if (i > 0) v = Math.min(v, d[k + nx - 1] + b); }
      d[k] = v;
    }
    const rc = radius / this.res - 1e-3, soft = rc + 0.45 / this.res;
    const cost = new Uint8Array(nx * ny);
    for (let k = 0; k < d.length; k++) {
      cost[k] = d[k] <= rc ? 255 : d[k] < soft ? Math.round(1 + 40 * (1 - (d[k] - rc) / (soft - rc))) : 1;
    }
    this.inflated[key] = cost;
    this.dist = d;
    return cost;
  }

  nearestFree(x, y, radius, maxR = 3) {
    const cost = this.costmap(radius);
    const [ci, cj] = this.cell(x, y);
    const R = Math.ceil(maxR / this.res);
    for (let r = 0; r <= R; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) continue;
        if (cost[j * this.nx + i] < 255) return this.center(i, j);
      }
    }
    return null;
  }

  /** A* from plan point to plan point. Returns array of [x,y] or null. */
  plan(sx, sy, gx, gy, radius) {
    const cost = this.costmap(radius);
    const { nx, ny } = this;
    const s0 = this.nearestFree(sx, sy, radius, 1.0), g0 = this.nearestFree(gx, gy, radius, 2.0);
    if (!s0 || !g0) return null;
    const [si, sj] = this.cell(...s0), [gi, gj] = this.cell(...g0);
    const start = sj * nx + si, goal = gj * nx + gi;
    const gScore = new Float32Array(nx * ny).fill(Infinity);
    const came = new Int32Array(nx * ny).fill(-1);
    const closed = new Uint8Array(nx * ny);
    const heap = new Heap();
    gScore[start] = 0; heap.push(start, 0);
    const h = (k) => { const i = k % nx, j = (k / nx) | 0; const dx = Math.abs(i - gi), dy = Math.abs(j - gj); return (dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)); };
    const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false, it = 0;
    while (heap.size) {
      const k = heap.pop();
      if (k === goal) { found = true; break; }
      if (closed[k]) continue; closed[k] = 1;
      if (++it > 3000000) break;
      const i = k % nx, j = (k / nx) | 0;
      for (const [di, dj, w] of N) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
        const n = b * nx + a;
        const c = cost[n];
        if (c === 255 || closed[n]) continue;
        const ng = gScore[k] + w * (1 + c * 0.15);
        if (ng < gScore[n]) { gScore[n] = ng; came[n] = k; heap.push(n, ng + h(n)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map((k) => this.center(k % nx, (k / nx) | 0));
    return simplify(pts, cost, this);
  }

  /** Line of sight over the cost grid (no blocked cells). */
  clear(a, b, cost) {
    const [i0, j0] = this.cell(...a), [i1, j1] = this.cell(...b);
    const n = Math.max(Math.abs(i1 - i0), Math.abs(j1 - j0));
    for (let t = 0; t <= n; t++) {
      const i = Math.round(i0 + ((i1 - i0) * t) / Math.max(n, 1)), j = Math.round(j0 + ((j1 - j0) * t) / Math.max(n, 1));
      if (cost[j * this.nx + i] > 20) return false;
    }
    return true;
  }
}

function simplify(pts, cost, grid) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let a = 0;
  while (a < pts.length - 1) {
    let b = pts.length - 1;
    while (b > a + 1 && !grid.clear(pts[a], pts[b], cost)) b--;
    out.push(pts[b]); a = b;
  }
  return out;
}

class Heap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(k, p) {
    const K = this.k, P = this.p; K.push(k); P.push(p);
    let i = K.length - 1;
    while (i > 0) { const q = (i - 1) >> 1; if (P[q] <= P[i]) break; [K[q], K[i]] = [K[i], K[q]]; [P[q], P[i]] = [P[i], P[q]]; i = q; }
  }
  pop() {
    const K = this.k, P = this.p, top = K[0];
    const lk = K.pop(), lp = P.pop();
    if (K.length) {
      K[0] = lk; P[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < K.length && P[l] < P[m]) m = l;
        if (r < K.length && P[r] < P[m]) m = r;
        if (m === i) break;
        [K[m], K[i]] = [K[i], K[m]]; [P[m], P[i]] = [P[i], P[m]]; i = m;
      }
    }
    return top;
  }
}

/** Multi-level router. Produces a task list for a robot. */
export class Router {
  constructor(building, grids) { this.b = building; this.grids = grids; }

  portals(levelId, mode) {
    const out = [];
    if (mode !== 'stairs') for (const e of this.b.data.elevators) {
      if (!e.levels.includes(levelId)) continue;
      const cy = (e.door[0] + e.door[1]) / 2;
      out.push({ type: 'elevator', id: e.id, approach: [e.doorX + 0.9, cy], inside: [(e.car[0] + e.car[2]) / 2 + 0.1, (e.car[1] + e.car[3]) / 2] });
    }
    if (mode !== 'elevator') for (const s of this.b.data.stairs) {
      if (!s.levels.includes(levelId)) continue;
      const [x0, y0, x1, y1] = s.box;
      const approach = s.axis === 'y' ? [(x0 + x1) / 2 + 0.3, (y0 + s.run[0]) / 2] : [(s.run[1] + x1) / 2 + 0.15, (y0 + y1) / 2];
      out.push({ type: 'stairs', id: s.id, approach, levels: s.levels });
    }
    return out;
  }

  /**
   * from/to: {level, x, y}. mode: 'elevator' | 'stairs' | 'any'.
   * Returns [{type:'path', level, pts}, {type:'elevator', id, from, to, inside, exit}, {type:'stairs', id, from, to}]
   */
  route(from, to, radius, mode = 'elevator') {
    if (from.level === to.level) {
      const pts = this.grids[from.level].plan(from.x, from.y, to.x, to.y, radius);
      return pts ? [{ type: 'path', level: from.level, pts }] : null;
    }
    const ids = this.b.levels.map((l) => l.id);
    let best = null;
    for (const p of this.portals(from.level, mode)) {
      if (p.type === 'elevator') {
        const e = this.b.data.elevators.find((q) => q.id === p.id);
        if (!e.levels.includes(to.level)) continue;
        const a = this.grids[from.level].plan(from.x, from.y, ...p.approach, radius);
        const b = this.grids[to.level].plan(...p.approach, to.x, to.y, radius);
        if (!a || !b) continue;
        const L = len(a) + len(b) + 12;
        if (!best || L < best.L) best = { L, tasks: [{ type: 'path', level: from.level, pts: a }, { type: 'elevator', id: p.id, from: from.level, to: to.level, inside: p.inside, exit: p.approach }, { type: 'path', level: to.level, pts: b }] };
      } else {
        if (!p.levels.includes(to.level)) continue;
        const a = this.grids[from.level].plan(from.x, from.y, ...p.approach, radius);
        const b = this.grids[to.level].plan(...p.approach, to.x, to.y, radius);
        if (!a || !b) continue;
        const dl = Math.abs(ids.indexOf(to.level) - ids.indexOf(from.level));
        const L = len(a) + len(b) + dl * 9;
        const tasks = [{ type: 'path', level: from.level, pts: a }];
        const step = Math.sign(ids.indexOf(to.level) - ids.indexOf(from.level));
        for (let i = ids.indexOf(from.level); i !== ids.indexOf(to.level); i += step) {
          tasks.push({ type: 'stairs', id: p.id, from: ids[i], to: ids[i + step], approach: p.approach });
        }
        tasks.push({ type: 'path', level: to.level, pts: b });
        if (!best || L < best.L) best = { L, tasks };
      }
    }
    return best ? best.tasks : null;
  }
}

function len(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
