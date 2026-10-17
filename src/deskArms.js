// Robot arms on desks (level.equipment), each moving on its own, forever:
//   "rebot-arm" : Seeed reBot Arm B601-DM (samcho93/studyReBotDevArm, CERN-OHL-W-2.0)        — 3F 306
//   "so101-arm" : SO-ARM101 (samcho93/studySO-ARM101, meshes TheRobotStudio/SO-ARM100, Apache-2.0) — 3F 308
// Meshes are baked by tools/build_arm.py (one decimated, vertex-coloured mesh per link + the joint chain).
// Free motion = random joint-space targets that
//  - keep every link above the desk top and inside the arm's own workspace on its desk
//    (a reach circle, and for 308 also a box that keeps clear of the two TIKI-mini beside the arm),
//  - are checked along the whole interpolated path before the move starts,
//  - and, while moving, keep a clearance (CLEAR) from every other arm's links — an arm that would get too
//    close stops and goes back to where it came from.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toWorld } from './geo.js';

const BASE = import.meta.env.BASE_URL;
const CLEAR = 0.2;           // min distance between links of two different arms (m)

export const ARM_MODELS = {
  'rebot-arm': {
    file: 'rebot/rebot', label: 'reBot Arm B601-DM',
    reach: 0.62, above: 0.05, vmax: 0.9,
    range: { joint1: [-2.4, 2.4], joint2: [-2.7, -0.45], joint3: [-2.6, -0.35], joint4: [-1.5, 1.4], joint5: [-1.4, 1.4], joint6: [-2.8, 2.8] },
    gripper: { finger_left: [0, 0.045], finger_right: [0, 0.045] },
    points: ['link3', 'link4', 'link5', 'link6', 'end_link', 'finger_left_link', 'finger_right_link'],
  },
  'so101-arm': {
    file: 'so101/so101', label: 'SO-ARM101',
    reach: 0.4, above: 0.03, vmax: 1.1,
    box: [0.34, 0.25],       // |local x| (across the desk), |local z| (along the desk, TIKI-mini at +-0.5 m)
    range: { shoulder_pan: [-1.8, 1.8], shoulder_lift: [-1.6, 1.6], elbow_flex: [-1.6, 1.6], wrist_flex: [-1.6, 1.6], wrist_roll: [-2.6, 2.6] },
    gripper: { gripper: [0, 1.2] },
    points: ['upper_arm_link', 'lower_arm_link', 'wrist_link', 'gripper_link', 'gripper_frame_link', 'moving_jaw_so101_v1_link'],
  },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rnd = (a, b) => a + Math.random() * (b - a);

async function loadTemplate(cfg) {
  const url = `${BASE}equipment/${cfg.file}`;
  const [gltf, chain] = await Promise.all([new GLTFLoader().loadAsync(`${url}.glb`), fetch(`${url}.json`).then((r) => r.json())]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.2 });
  const geoms = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry, c = g.attributes.color;
    if (c) {                                   // trimesh writes sRGB bytes; three expects linear vertex colours
      const col = new THREE.Color();
      for (let i = 0; i < c.count; i++) { col.setRGB(c.getX(i), c.getY(i), c.getZ(i), THREE.SRGBColorSpace); c.setXYZ(i, col.r, col.g, col.b); }
    }
    g.computeVertexNormals();
    geoms[o.name] = g;
  });
  return { cfg, geoms, mat, joints: chain.joints };
}

class Arm {
  constructor(tpl, n) {
    this.cfg = tpl.cfg; this.n = n;
    this.root = new THREE.Group(); this.root.name = `${tpl.cfg.label}-${n}`;
    const urdf = new THREE.Group(); urdf.rotation.x = -Math.PI / 2;    // URDF z-up -> three y-up
    this.root.add(urdf);
    const links = { [tpl.joints[0].parent]: new THREE.Group() };
    urdf.add(links[tpl.joints[0].parent]);
    this.movers = {};
    for (const j of tpl.joints) {
      const frame = new THREE.Group();
      frame.position.fromArray(j.xyz);
      frame.quaternion.setFromEuler(new THREE.Euler(j.rpy[0], j.rpy[1], j.rpy[2], 'ZYX'));
      const mover = new THREE.Group(); frame.add(mover);
      const child = new THREE.Group(); mover.add(child);
      links[j.parent].add(frame); links[j.child] = child;
      if (j.type !== 'fixed') this.movers[j.name] = { mover, axis: new THREE.Vector3().fromArray(j.axis).normalize(), type: j.type };
    }
    for (const [name, g] of Object.entries(tpl.geoms)) {
      if (!links[name]) continue;
      const m = new THREE.Mesh(g, tpl.mat); m.castShadow = true; m.receiveShadow = true;
      links[name].add(m);
    }
    this.links = links;
    this.pts = this.cfg.points.map(() => new THREE.Vector3());
    this.move = null; this.wait = rnd(0.2, 2.5);
  }

  apply(q) {
    for (const [name, v] of Object.entries(q)) {
      const m = this.movers[name]; if (!m) continue;
      if (m.type === 'prismatic') m.mover.position.copy(m.axis).multiplyScalar(v);
      else m.mover.quaternion.setFromAxisAngle(m.axis, v);
    }
  }

  /** World positions of the arm's key link points (after apply). */
  points(out = this.pts) {
    this.root.updateMatrixWorld(true);
    this.cfg.points.forEach((name, i) => this.links[name].getWorldPosition(out[i]));
    return out;
  }

  /** Is configuration q inside this arm's own workspace on its desk? */
  inWorkspace(q, tmp, loc) {
    this.apply(q);
    const pts = this.points(tmp), b = this.root.position, { reach, above, box } = this.cfg;
    for (let i = 0; i < this.cfg.points.length; i++) {
      const p = pts[i];
      if (p.y < b.y + above) return false;
      if (Math.hypot(p.x - b.x, p.z - b.z) > reach) return false;
      if (box) { this.root.worldToLocal(loc.copy(p)); if (Math.abs(loc.x) > box[0] || Math.abs(loc.z) > box[1]) return false; }
    }
    return true;
  }

  randomQ() {
    const q = {};
    for (const [j, r] of Object.entries(this.cfg.range)) q[j] = rnd(...r);
    const open = Math.random() < 0.5;
    for (const [j, [a, b]] of Object.entries(this.cfg.gripper)) q[j] = open ? rnd(a + (b - a) * 0.5, b) : a;
    return q;
  }
}

export class DeskArms {
  constructor(building) {
    this.building = building;
    this.arms = [];
    this.tmp = Array.from({ length: 8 }, () => new THREE.Vector3());
    this.loc = new THREE.Vector3();
  }

  async load() {
    const items = this.building.levels.flatMap((lv) => (lv.equipment || []).filter((e) => ARM_MODELS[e.model]).map((e) => ({ ...e, lv })));
    const tpls = {};
    for (const m of new Set(items.map((it) => it.model))) tpls[m] = await loadTemplate(ARM_MODELS[m]);
    for (const it of items) {
      const arm = new Arm(tpls[it.model], this.arms.filter((a) => a.cfg === tpls[it.model].cfg).length + 1);
      arm.root.position.copy(toWorld(it.x, it.y, it.lv.elevation + it.top));
      arm.root.rotation.y = it.yaw;
      arm.lv = it.lv;
      this.building.groups[it.lv.id].add(arm.root);
      // a valid start pose inside the arm's own workspace
      let q = arm.randomQ();
      for (let k = 0; k < 400 && !arm.inWorkspace(q, this.tmp, this.loc); k++) q = arm.randomQ();
      arm.q = q; arm.apply(q); arm.points();
      this.arms.push(arm);
    }
    return this.arms.length;
  }

  #plan(arm) {
    const from = { ...arm.q };
    for (let tries = 0; tries < 40; tries++) {
      const to = arm.randomQ();
      let ok = true;
      for (let k = 1; k <= 16 && ok; k++) {
        const t = k / 16, q = {};
        for (const j of Object.keys(to)) q[j] = from[j] + (to[j] - from[j]) * t;
        ok = arm.inWorkspace(q, this.tmp, this.loc);
      }
      if (!ok) continue;
      const span = Math.max(...Object.keys(arm.cfg.range).map((j) => Math.abs(to[j] - from[j])));
      arm.apply(from);
      return { from, to, t: 0, dur: Math.max(1.0, span / arm.cfg.vmax) * rnd(1, 1.6) };
    }
    arm.apply(from);
    return null;
  }

  #tooClose(arm) {
    const P = arm.points();
    for (const o of this.arms) {
      if (o === arm || o.lv !== arm.lv || o.root.position.distanceToSquared(arm.root.position) > 4) continue;
      for (const a of P) for (const b of o.pts) if (a.distanceToSquared(b) < CLEAR * CLEAR) return true;
    }
    return false;
  }

  update(dt) {
    for (const arm of this.arms) {
      if (!this.building.groups[arm.lv.id].visible) continue;
      if (!arm.move) {
        arm.wait -= dt;
        if (arm.wait > 0) continue;
        arm.move = this.#plan(arm);
        if (!arm.move) { arm.wait = 0.5; continue; }
      }
      const m = arm.move;
      m.t = Math.min(1, m.t + dt / m.dur);
      const e = ease(m.t), q = {};
      for (const j of Object.keys(m.to)) q[j] = m.from[j] + (m.to[j] - m.from[j]) * e;
      arm.apply(q);
      if (this.#tooClose(arm)) {                 // backstop: never enter another arm's space — reverse
        arm.apply(arm.q); arm.points();
        arm.move = { from: { ...arm.q }, to: { ...m.from }, t: 0, dur: m.dur * 0.6 };
        continue;
      }
      arm.q = q;
      if (m.t >= 1) { arm.move = null; arm.wait = rnd(0.3, 1.8); }
    }
  }
}
