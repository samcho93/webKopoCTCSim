// Mobile robots: differential-drive AMR and a quadruped. Both share the
// kinematic Body, sensors, SLAM and a task executor for multi-level routes.
import * as THREE from 'three';
import { makeStudyGO2, makeTikiMini, animateLegs } from './robotModels.js';
import { instantiate, go2LegIK, GO2_LEGS, GO2_JOINTS } from './urdfModels.js';
import { Body } from './physics.js';
import { Lidar2D, Lidar3D, gauss } from './sensors.js';
import { GridSlam, wrap } from './slam.js';
import { toWorld } from './geo.js';

let SEQ = 0;

// Robot specs, taken from the robots' own packages (edit there first, then here):
//   TIKI-mini : studyTIKI python/tiki/data/robot.json + tiki_ros/config/tiki.yaml
//   Go2       : unitree_ros go2_description (studyGo2 assets/urdf/go2), studyGo2 sim/protocol.js limits
const RPM = (2 * Math.PI) / 60;
const PRESETS = {
  // TIKI-mini: differential-drive mobile robot (RPLIDAR on the rear mount, front camera). Uses elevators.
  amr: {
    label: 'TIKI-mini', idPrefix: 'tiki', type: '이동로봇 (차동구동)', model: 'tiki',
    baseFrame: 'base_footprint', laserFrame: 'laser_link', laserX: -0.1025,
    wheelRadius: 0.0325, wheelSeparation: 0.1924, maxRpm: 175, tauPid: 0.12,
    radius: 0.14, height: 0.16, step: 0.02, vmax: 0.5, wmax: 3.0,
    lidar: '2d', lidarH: 0.134, lidarBeams: 360, lidarRange: 12,
    camera: { x: 0.06, z: 0.095, pitch: 0.1396, hfov: 69.6 },
    nav: 'elevator', color: 0xf5b80a,
  },
  // Unitree Go2: 12-DoF quadruped (L1 LiDAR under the head). Uses the stairs.
  quadruped: {
    label: 'Go2', idPrefix: 'go2', type: '4족 보행 로봇', model: 'go2',
    baseFrame: 'base', laserFrame: 'base', laserX: 0.289, // ring of the L1 published in base (the URDF radar frame is tilted)
    hipHeight: 0.32, thigh: 0.213, calf: 0.213, hipX: 0.1934, hipY: 0.0465 + 0.0955,
    radius: 0.28, height: 0.42, step: 0.18, vmax: 0.8, wmax: 1.2,
    lidar: '3d', lidarH: 0.28, lidarChannels: 16, lidarRange: 20,
    camera: { x: 0.33, z: 0.36, pitch: 0.1, hfov: 70 },
    nav: 'stairs', color: 0x9aa3ad,
  },
};
const ALIAS = { tiki: 'amr', 'tiki-mini': 'amr', tikimini: 'amr', go2: 'quadruped' };

export class Robot {
  constructor(sim, kind, x, y, z, yaw = 0) {
    kind = ALIAS[String(kind).toLowerCase()] || kind;
    const P = PRESETS[kind];
    this.sim = sim; this.kind = kind; this.P = P;
    this.id = `${P.idPrefix}_${++SEQ}`;
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
      ? new Lidar2D(sim.world, { beams: P.lidarBeams, height: P.lidarH, rangeMax: P.lidarRange })
      : new Lidar3D(sim.world, { channels: P.lidarChannels, azimuth: 360, height: P.lidarH, rangeMax: P.lidarRange });
    this.scanRate = P.lidar === '2d' ? 10 : 5;
    this.scanT = 0;
    this.slam = new GridSlam(sim.building.meta);
    this.slam.reset(this.pose(), this.level.id);
    this.slamOn = true;
    this.pendingOdom = { dx: 0, dy: 0, dyaw: 0 };
    this.lastScan = null;
    this.path = [];
    this.gait = 0;
    // visuals: the robot's own URDF (falls back to a procedural stand-in if it failed to load)
    const inst = instantiate(P.model);
    if (inst) { this.mesh = inst.group; this.urdf = inst.urdf; }
    else this.mesh = kind === 'amr' ? makeStudyGO2({ ...P, length: 0.22, width: 0.22, bodyHeight: 0.06, wheelRadius: 0.0325, wheelTrack: 0.19, accent: 0x222222 }) : makeTikiMini({ ...P, length: 0.6, width: 0.3, bodyHeight: 0.11, accent: 0xb0b4b8 });
    // wheel state for the TIKI driver protocol (PID mode: commands are wheel rpm)
    this.wheel = { mode: 0, cmd: [0, 0], wl: 0, wr: 0, al: 0, ar: 0 };
    this.link = null;          // set by TikiLink while the ROS 2 / Python driver is connected
    this.jointState = { name: [], position: [] };
    sim.scene.add(this.mesh);
    this.scanViz = makeScanViz(P.lidar === '2d' ? P.lidarBeams : P.lidarChannels * 360, P.color);
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
    let v = THREE.MathUtils.clamp(this.cmd.v, -this.P.vmax, this.P.vmax);
    let w = THREE.MathUtils.clamp(this.cmd.w, -this.P.wmax, this.P.wmax);
    if (this.kind === 'amr') {
      const W = this.wheel, P = this.P;
      let tl, tr;
      if (this.link) {
        // external driver: wheel rpm targets (PID mode), first-order motor response
        const on = W.mode === 2;
        tl = on ? THREE.MathUtils.clamp(W.cmd[0], -P.maxRpm, P.maxRpm) * RPM : 0;
        tr = on ? THREE.MathUtils.clamp(W.cmd[1], -P.maxRpm, P.maxRpm) * RPM : 0;
      } else {
        tl = (v - (w * P.wheelSeparation) / 2) / P.wheelRadius;
        tr = (v + (w * P.wheelSeparation) / 2) / P.wheelRadius;
      }
      const k = Math.min(1, dt / P.tauPid);
      W.wl += (tl - W.wl) * k; W.wr += (tr - W.wr) * k;
      W.al += W.wl * dt; W.ar += W.wr * dt;
      v = ((W.wl + W.wr) / 2) * P.wheelRadius;
      w = ((W.wr - W.wl) * P.wheelRadius) / P.wheelSeparation;
    }
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
    this.gait += dist * (this.kind === 'quadruped' ? 22 : 6) + Math.abs(dyaw) * (this.kind === 'quadruped' ? 5 : 2);
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
    const moving = Math.abs(this.speed?.v || 0) + Math.abs(this.speed?.w || 0) > 0.02;
    if (this.urdf && this.kind === 'amr') {
      this.urdf.setJointValue('left_wheel_joint', this.wheel.al);
      this.urdf.setJointValue('right_wheel_joint', this.wheel.ar);
      this.jointState = { name: ['left_wheel_joint', 'right_wheel_joint'], position: [this.wheel.al, this.wheel.ar], velocity: [this.wheel.wl, this.wheel.wr] };
    } else if (this.urdf) {
      // Go2 trot: diagonal pairs in phase, feet follow an ellipse under each hip (2-link IK)
      const P = this.P, name = [], position = [];
      this.urdf.position.z = 0; // base frame is the URDF root
      this.mesh.children[0].position.y = P.hipHeight + (moving ? Math.abs(Math.sin(this.gait)) * 0.008 : 0);
      for (const leg of GO2_LEGS) {
        const ph = this.gait + (leg === 'FL' || leg === 'RR' ? 0 : Math.PI);
        const fx = moving ? Math.sin(ph) * 0.06 : 0;
        const fz = -P.hipHeight + 0.022 + (moving ? Math.max(0, Math.cos(ph)) * 0.06 : 0);
        const [th, ca] = go2LegIK(fx, fz, P.thigh, P.calf);
        const vals = [0, th, ca];
        ['hip', 'thigh', 'calf'].forEach((j, k) => { const n = `${leg}_${j}_joint`; this.urdf.setJointValue(n, vals[k]); name.push(n); position.push(vals[k]); });
      }
      this.jointState = { name, position };
    } else if (this.kind === 'quadruped') animateLegs(this.mesh, this.gait, moving, { ...this.P, hipHeight: 0.3, thigh: 0.18, calf: 0.18 });
    else this.mesh.userData.wheels?.forEach((wh) => (wh.rotation.z = -this.gait / 6 / 0.0325));
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

export { PRESETS, RPM };
void GO2_JOINTS;
