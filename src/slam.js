// Lightweight 2D grid SLAM: noisy odometry prediction + correlative scan
// matching against the map being built + log-odds occupancy mapping.
// One map per building level (the robot knows which level it is on).

const L_OCC = 0.85, L_FREE = -0.4, L_MIN = -4, L_MAX = 6;

export class GridSlam {
  constructor(meta) {
    this.res = meta.resolution; [this.x0, this.y0] = meta.origin; [this.nx, this.ny] = meta.size;
    this.maps = {};
    this.scans = {};
    this.est = null;
    this.trail = [];
    this.matching = true;
  }

  map(level) {
    if (!this.maps[level]) { this.maps[level] = new Float32Array(this.nx * this.ny); this.scans[level] = 0; }
    return this.maps[level];
  }

  reset(pose, level) { this.est = { x: pose.x, y: pose.y, yaw: pose.yaw, level }; this.trail = []; }

  clear() { this.maps = {}; this.scans = {}; this.trail = []; }

  /**
   * odom: incremental motion in the previous robot frame {dx, dy, dyaw} (noisy).
   * ranges/angles: scan in the robot frame. Returns the corrected pose estimate.
   */
  update(level, odom, ranges, angleMin, angleInc, rangeMax) {
    if (!this.est) return null;
    const e = this.est;
    if (e.level !== level) { e.level = level; }
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
    e.x += c * odom.dx - s * odom.dy;
    e.y += s * odom.dx + c * odom.dy;
    e.yaw = wrap(e.yaw + odom.dyaw);

    const m = this.map(level);
    // subsample beams for matching
    const pts = [];
    for (let i = 0; i < ranges.length; i += 2) {
      const r = ranges[i];
      if (!Number.isFinite(r) || r > rangeMax - 0.05) continue;
      pts.push([r * Math.cos(angleMin + i * angleInc), r * Math.sin(angleMin + i * angleInc)]);
    }
    if (this.matching && this.scans[level] > 8 && pts.length > 20) {
      let best = { s: -Infinity, dx: 0, dy: 0, dt: 0 };
      const lin = [-0.1, -0.05, 0, 0.05, 0.1], ang = [-0.035, -0.0175, 0, 0.0175, 0.035];
      for (const dt of ang) {
        const yaw = e.yaw + dt, cc = Math.cos(yaw), ss = Math.sin(yaw);
        const rot = pts.map(([px, py]) => [cc * px - ss * py, ss * px + cc * py]);
        for (const dx of lin) for (const dy of lin) {
          let sc = 0;
          const bx = e.x + dx, by = e.y + dy;
          for (const [rx, ry] of rot) {
            const i = Math.floor((bx + rx - this.x0) / this.res), j = Math.floor((by + ry - this.y0) / this.res);
            if (i < 1 || j < 1 || i >= this.nx - 1 || j >= this.ny - 1) continue;
            const k = j * this.nx + i;
            const v = Math.max(m[k], 0.5 * Math.max(m[k - 1], m[k + 1], m[k - this.nx], m[k + this.nx]));
            if (v > 0) sc += v;
          }
          sc -= 0.3 * (Math.abs(dx) + Math.abs(dy)) * pts.length + 2 * Math.abs(dt) * pts.length;
          if (sc > best.s) best = { s: sc, dx, dy, dt };
        }
      }
      e.x += best.dx; e.y += best.dy; e.yaw = wrap(e.yaw + best.dt);
    }
    this.integrate(m, ranges, angleMin, angleInc, rangeMax);
    this.scans[level]++;
    if (!this.trail.length || Math.hypot(this.trail.at(-1)[0] - e.x, this.trail.at(-1)[1] - e.y) > 0.2) this.trail.push([e.x, e.y, level]);
    return e;
  }

  integrate(m, ranges, angleMin, angleInc, rangeMax) {
    const e = this.est;
    const i0 = Math.floor((e.x - this.x0) / this.res), j0 = Math.floor((e.y - this.y0) / this.res);
    for (let b = 0; b < ranges.length; b++) {
      let r = ranges[b];
      const hit = Number.isFinite(r) && r < rangeMax - 0.05;
      if (!hit) r = Math.min(rangeMax, 6);
      const a = e.yaw + angleMin + b * angleInc;
      const i1 = Math.floor((e.x + r * Math.cos(a) - this.x0) / this.res), j1 = Math.floor((e.y + r * Math.sin(a) - this.y0) / this.res);
      // Bresenham
      let x = i0, y = j0; const dx = Math.abs(i1 - i0), dy = -Math.abs(j1 - j0), sx = i0 < i1 ? 1 : -1, sy = j0 < j1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        if (x === i1 && y === j1) break;
        if (x >= 0 && y >= 0 && x < this.nx && y < this.ny) { const k = y * this.nx + x; m[k] = Math.max(L_MIN, m[k] + L_FREE); }
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x += sx; }
        if (e2 <= dx) { err += dx; y += sy; }
      }
      if (hit && i1 >= 0 && j1 >= 0 && i1 < this.nx && j1 < this.ny) { const k = j1 * this.nx + i1; m[k] = Math.min(L_MAX, m[k] + L_OCC + -L_FREE); }
    }
  }

  /** ROS map_server compatible PGM (P5) + YAML strings. */
  exportPGM(level) {
    const m = this.map(level);
    const head = `P5\n# webKopoCTCSim SLAM ${level}\n${this.nx} ${this.ny}\n255\n`;
    const body = new Uint8Array(this.nx * this.ny);
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const v = m[j * this.nx + i];
      body[(this.ny - 1 - j) * this.nx + i] = v > 0.6 ? 0 : v < -0.6 ? 254 : 205;
    }
    const enc = new TextEncoder().encode(head);
    const out = new Uint8Array(enc.length + body.length); out.set(enc); out.set(body, enc.length);
    const yaml = `image: slam_${level}.pgm\nresolution: ${this.res}\norigin: [${this.x0}, ${this.y0}, 0.0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.196\n`;
    return { pgm: out, yaml };
  }

  /** nav_msgs/OccupancyGrid data (row-major from origin, -1 unknown). */
  occupancyData(level) {
    const m = this.map(level);
    const d = new Array(m.length);
    for (let k = 0; k < m.length; k++) d[k] = m[k] > 0.6 ? 100 : m[k] < -0.6 ? 0 : -1;
    return d;
  }
}

export function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
