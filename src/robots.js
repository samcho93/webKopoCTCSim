// Mobile robots: differential-drive AMR and a quadruped. Both share the
// kinematic Body, sensors, SLAM and a task executor for multi-level routes.
import * as THREE from 'three';
import { Body } from './physics.js';
import { Lidar2D, Lidar3D, gauss } from './sensors.js';
import { GridSlam, wrap } from './slam.js';
import { toWorld } from './geo.js';

let SEQ = 0;

const PRESETS = {
  amr: { label: 'AMR (차동구동)', radius: 0.27, height: 0.45, step: 0.03, vmax: 0.9, wmax: 1.6, lidar: '2d', lidarH: 0.32, nav: 'elevator', color: 0x2f6fd6 },
  quadruped: { label: '4족 보행 로봇', radius: 0.28, height: 0.6, step: 0.3, vmax: 1.0, wmax: 1.8, lidar: '3d', lidarH: 0.42, nav: 'stairs', color: 0xf0a020 },
};

export class Robot {
  constructor(sim, kind, x, y, z, yaw = 0) {
    const P = PRESETS[kind];
    this.sim = sim; this.kind = kind; this.P = P;
    this.id = `${kind}_${++SEQ}`;
    this.name = `${P.label} #${SEQ}`;
    this.body = new Body(sim.world, { radius: P.radius, height: P.height, step: P.step });
    this.body.place(x, y, z);
    this.yaw = yaw;
    this.cmd = { v: 0, w: 0 };       // commanded body twist
    this.cmdTimeout = 0;
    this.tasks = [];
    this.status = 'idle';
    this.odom = { x: this.body.pos.x, y: this.body.pos.y, yaw };   // noisy odometry frame
    this.odomNoise = 0.02;
    this.lidar = P.lidar === '2d'
      ? new Lidar2D(sim.world, { beams: 360, height: P.lidarH, rangeMax: 16 })
      : new Lidar3D(sim.world, { channels: 16, azimuth: 360, height: P.lidarH, rangeMax: 25 });
    this.scanRate = P.lidar === '2d' ? 10 : 5;
    this.scanT = 0;
    this.slam = new GridSlam(sim.building.meta);
    this.slam.reset(this.pose(), this.level.id);
    this.slamOn = true;
    this.pendingOdom = { dx: 0, dy: 0, dyaw: 0 };
    this.lastScan = null;
    this.path = [];
    this.gait = 0;
    this.mesh = kind === 'amr' ? makeAMR(P) : makeQuadruped(P);
    sim.scene.add(this.mesh);
    this.scanViz = makeScanViz(P.lidar === '2d' ? 360 : 16 * 360, P.color);
    sim.scene.add(this.scanViz);
    this.sync();
  }

  get level() { return this.sim.building.levelAt(this.body.pos.z); }
  pose() { const p = this.body.pos; return { x: p.x, y: p.y, z: p.z, yaw: this.yaw }; }

  setCmd(v, w, hold = 0.5) { this.cmd.v = v; this.cmd.w = w; this.cmdTimeout = hold; }

  /** Navigate to a plan point on a level (multi-level routes use elevators/stairs). */
  goTo(levelId, x, y) {
    const from = { level: this.level.id, x: this.body.pos.x, y: this.body.pos.y };
    const tasks = this.sim.router.route(from, { level: levelId, x, y }, this.P.radius + 0.02, this.P.nav === 'any' ? 'any' : this.P.nav);
    if (!tasks) { this.status = '경로 없음'; return false; }
    this.tasks = tasks; this.status = 'navigating';
    this.path = [];
    this.sim.events.emit('route', this);
    return true;
  }

  cancel() { this.tasks = []; this.path = []; this.cmd.v = this.cmd.w = 0; this.status = 'idle'; }

  update(dt) {
    this.runTasks(dt);
    if (this.cmdTimeout > 0) this.cmdTimeout -= dt; else if (!this.tasks.length) { this.cmd.v = 0; this.cmd.w = 0; }
    const v = THREE.MathUtils.clamp(this.cmd.v, -this.P.vmax, this.P.vmax);
    const w = THREE.MathUtils.clamp(this.cmd.w, -this.P.wmax, this.P.wmax);
    const p = this.body.pos;
    const x0 = p.x, y0 = p.y, yaw0 = this.yaw;
    this.yaw = wrap(this.yaw + w * dt);
    this.body.move(Math.cos(this.yaw) * v * dt, Math.sin(this.yaw) * v * dt, dt);
    // odometry (wheel/leg odometry with noise proportional to motion)
    const ddx = p.x - x0, ddy = p.y - y0, dyaw = wrap(this.yaw - yaw0);
    const c = Math.cos(yaw0), s = Math.sin(yaw0);
    const fx = c * ddx + s * ddy, fy = -s * ddx + c * ddy;
    const dist = Math.hypot(fx, fy);
    const n = this.odomNoise;
    const o = { dx: fx + gauss() * n * dist, dy: fy + gauss() * n * dist * 0.5, dyaw: dyaw + gauss() * n * (Math.abs(dyaw) + 0.3 * dist) };
    const oc = Math.cos(this.odom.yaw), os = Math.sin(this.odom.yaw);
    this.odom.x += oc * o.dx - os * o.dy; this.odom.y += os * o.dx + oc * o.dy; this.odom.yaw = wrap(this.odom.yaw + o.dyaw);
    // accumulate for SLAM (in the frame at the previous scan)
    const pc = Math.cos(this.pendingOdom.dyaw), ps = Math.sin(this.pendingOdom.dyaw);
    this.pendingOdom.dx += pc * o.dx - ps * o.dy; this.pendingOdom.dy += ps * o.dx + pc * o.dy; this.pendingOdom.dyaw += o.dyaw;
    this.speed = { v: dist / Math.max(dt, 1e-6) * Math.sign(v || 1), w: dyaw / Math.max(dt, 1e-6) };

    this.scanT += dt;
    if (this.scanT >= 1 / this.scanRate) { this.scanT = 0; this.doScan(); }
    this.gait += dist * 6 + Math.abs(dyaw) * 2;
    this.sync();
  }

  doScan() {
    const pose = this.pose();
    let ranges, angleMin, angleInc, rangeMax;
    if (this.lidar instanceof Lidar2D) {
      ranges = this.lidar.scan(pose); angleMin = this.lidar.angleMin; angleInc = this.lidar.angleInc; rangeMax = this.lidar.rangeMax;
    } else {
      this.lidar.scan(pose);
      ranges = this.lidar.ring2D; angleMin = -Math.PI; angleInc = (2 * Math.PI) / this.lidar.azimuth; rangeMax = this.lidar.rangeMax;
    }
    this.lastScan = { ranges, angleMin, angleInc, rangeMax, stamp: performance.now() / 1000 };
    if (this.slamOn) this.slam.update(this.level.id, this.pendingOdom, ranges, angleMin, angleInc, rangeMax);
    this.pendingOdom = { dx: 0, dy: 0, dyaw: 0 };
    this.updateScanViz();
    this.sim.events.emit('scan', this);
  }

  updateScanViz() {
    const pos = this.scanViz.geometry.getAttribute('position');
    const pose = this.pose();
    let n = 0;
    if (this.lidar instanceof Lidar2D) {
      const { ranges, angleMin, angleInc } = this.lastScan;
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i]; if (!Number.isFinite(r)) continue;
        const a = pose.yaw + angleMin + i * angleInc;
        pos.setXYZ(n++, pose.x + r * Math.cos(a), pose.z + this.lidar.height, -(pose.y + r * Math.sin(a)));
      }
    } else {
      const P = this.lidar.points, c = Math.cos(pose.yaw), s = Math.sin(pose.yaw);
      for (let k = 0; k < this.lidar.count; k++) {
        const x = P[3 * k], y = P[3 * k + 1], z = P[3 * k + 2];
        pos.setXYZ(n++, pose.x + c * x - s * y, pose.z + this.lidar.height + z, -(pose.y + s * x + c * y));
      }
    }
    pos.needsUpdate = true;
    this.scanViz.geometry.setDrawRange(0, n);
  }

  // ---------------------------------------------------------------- tasks
  runTasks(dt) {
    const t = this.tasks[0];
    if (!t) return;
    const p = this.body.pos;
    if (t.type === 'path') {
      if (!this.path.length) { this.path = t.pts.slice(1); this.status = `주행 중 (${t.level})`; }
      if (this.follow(this.path, dt, this.tasks.length === 1 ? 0.2 : 0.35)) { this.tasks.shift(); this.path = []; if (!this.tasks.length) { this.status = 'arrived'; this.sim.events.emit('arrived', this); } }
    } else if (t.type === 'elevator') {
      const e = this.sim.elevators.find((q) => q.id === t.id);
      t.phase ??= 'call';
      if (t.phase === 'call') { e.call(t.from); t.phase = 'wait'; this.status = `${e.def.name} 호출`; }
      if (t.phase === 'wait') { this.stop(); if (e.atLevel && e.level.id === t.from && e.doorOpen) { e.holdOpen(); t.phase = 'enter'; } else e.call(t.from); }
      if (t.phase === 'enter') {
        e.holdOpen();
        if (this.follow([t.inside], dt, 0.12)) { t.phase = 'turn'; }
      }
      if (t.phase === 'turn') {
        // face the door
        const err = wrap(0 - this.yaw);
        this.cmd.v = 0; this.cmd.w = THREE.MathUtils.clamp(err * 2.5, -this.P.wmax, this.P.wmax);
        if (Math.abs(err) < 0.08) { this.stop(); e.queue.length = 0; e.call(t.to); e.dwell = 0.5; t.phase = 'ride'; this.status = `${t.to}로 이동 중`; }
      }
      if (t.phase === 'ride') { this.stop(); if (e.atLevel && e.level.id === t.to && e.doorOpen) { e.holdOpen(); t.phase = 'exit'; } }
      if (t.phase === 'exit') { e.holdOpen(); if (this.follow([t.exit], dt, 0.3)) { this.tasks.shift(); this.path = []; } }
    } else if (t.type === 'stairs') {
      if (!t.pts) t.pts = this.sim.building.stairPaths[`${t.id}:${t.from}>${t.to}`].map(([x, y]) => [x, y]).concat([t.approach]);
      this.status = `계단 ${t.from}→${t.to}`;
      if (this.follow(t.pts, dt, 0.25, 0.5)) { this.tasks.shift(); this.path = []; }
    }
    void p;
  }

  stop() { this.cmd.v = 0; this.cmd.w = 0; }

  /** Pure-pursuit-ish follower over a list of points (consumed in place). Returns true at the end. */
  follow(pts, dt, tol = 0.2, speedScale = 1) {
    const p = this.body.pos;
    while (pts.length > 1 && Math.hypot(pts[0][0] - p.x, pts[0][1] - p.y) < 0.45) pts.shift();
    if (!pts.length) return true;
    const [gx, gy] = pts[0];
    const d = Math.hypot(gx - p.x, gy - p.y);
    if (pts.length === 1 && d < tol) { pts.shift(); this.stop(); return true; }
    const err = wrap(Math.atan2(gy - p.y, gx - p.x) - this.yaw);
    const vmax = this.P.vmax * speedScale;
    this.cmd.w = THREE.MathUtils.clamp(err * 2.2, -this.P.wmax, this.P.wmax);
    this.cmd.v = Math.abs(err) > 0.9 ? 0 : vmax * Math.cos(err) * Math.min(1, d / 0.6 + 0.25);
    this.cmdTimeout = 0.2;
    return false;
  }

  sync() {
    const p = this.body.pos;
    this.mesh.position.copy(toWorld(p.x, p.y, p.z));
    this.mesh.rotation.y = this.yaw;
    if (this.kind === 'quadruped') animateLegs(this.mesh, this.gait, Math.abs(this.cmd.v) + Math.abs(this.cmd.w) > 0.02);
    else this.mesh.userData.wheels?.forEach((w) => (w.rotation.z = -this.gait * 0.5));
  }

  dispose() {
    this.sim.scene.remove(this.mesh); this.sim.scene.remove(this.scanViz);
  }
}

function makeScanViz(n, color) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setDrawRange(0, 0);
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xff2d55, size: 0.05, sizeAttenuation: true, depthWrite: false }));
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  void color;
  return pts;
}

// Model: local frame X forward (robot x), Y up, Z = -robot y (left).
function makeAMR(P) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.4, metalness: 0.1 });
  const accent = new THREE.MeshStandardMaterial({ color: P.color, roughness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222428, roughness: 0.6 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(P.radius, P.radius, 0.22, 40), body);
  base.position.y = 0.17; g.add(base);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(P.radius + 0.005, P.radius + 0.005, 0.05, 40), accent);
  band.position.y = 0.1; g.add(band);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(P.radius * 0.95, P.radius, 0.04, 40), dark);
  top.position.y = 0.3; g.add(top);
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 20), dark);
  lidar.position.set(0.08, P.lidarH, 0); g.add(lidar);
  const front = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.25), new THREE.MeshStandardMaterial({ color: 0x1ec8ff, emissive: 0x1ec8ff, emissiveIntensity: 1.5 }));
  front.position.set(P.radius - 0.005, 0.2, 0); g.add(front);
  const wheels = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 24), dark);
    w.rotation.x = Math.PI / 2; w.position.set(0, 0.075, s * (P.radius - 0.03));
    const hub = new THREE.Group(); hub.add(w); g.add(hub); wheels.push(w);
  }
  g.userData.wheels = wheels;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function makeQuadruped(P) {
  const g = new THREE.Group();
  const shell = new THREE.MeshStandardMaterial({ color: P.color, roughness: 0.45, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2a2b2e, roughness: 0.5, metalness: 0.3 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.26), shell);
  torso.position.y = 0.44; g.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.2), dark);
  head.position.set(0.34, 0.45, 0); g.add(head);
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.07, 20), dark);
  lidar.position.set(0.1, P.lidarH + 0.02, 0); g.add(lidar);
  const legs = [];
  for (const [fx, sz] of [[0.25, 0.15], [0.25, -0.15], [-0.25, 0.15], [-0.25, -0.15]]) {
    const hip = new THREE.Group(); hip.position.set(fx, 0.42, sz); g.add(hip);
    const thigh = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.06), dark); thigh.position.y = -0.1; hip.add(thigh);
    const knee = new THREE.Group(); knee.position.y = -0.2; hip.add(knee);
    const shin = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.04), shell); shin.position.y = -0.1; knee.add(shin);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), dark); foot.position.y = -0.2; knee.add(foot);
    legs.push({ hip, knee, phase: (fx > 0) === (sz > 0) ? 0 : Math.PI });
  }
  g.userData.legs = legs;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

function animateLegs(g, t, moving) {
  for (const L of g.userData.legs) {
    const ph = t + L.phase;
    const sw = moving ? Math.sin(ph) * 0.45 : 0;
    const lift = moving ? Math.max(0, Math.cos(ph)) * 0.5 : 0;
    L.hip.rotation.z = 0.55 + sw;
    L.knee.rotation.z = -1.1 - lift;
  }
}

export { PRESETS };
