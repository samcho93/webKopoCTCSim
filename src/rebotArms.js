// reBot Arm B601-DM (Seeed; samcho93/studyReBotDevArm, assets/robot/DM, CERN-OHL-W-2.0) on desks
// (level.equipment "rebot-arm"). The mesh is baked by tools/build_rebot.py (one decimated, vertex-coloured
// mesh per link + the joint chain). Every arm moves on its own, forever: random joint-space targets that
//  - keep every link above the desk top and inside the arm's own reach circle (REACH) on its desk,
//  - are checked along the whole interpolated path before the move starts,
//  - and, while moving, keep a clearance (CLEAR) from every other arm's links — an arm that would get too
//    close stops and goes back to where it came from.
// Desk pitch in 306 is 1.55 m, so two reach circles (2 x 0.62 m) never overlap; the guard is the backstop.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toWorld } from './geo.js';

const BASE = import.meta.env.BASE_URL;
const REACH = 0.62;          // max horizontal distance of any link point from the arm's base (m)
const ABOVE = 0.05;          // min height of the wrist / gripper points above the desk top (m)
const CLEAR = 0.2;           // min distance between links of two different arms (m)
const VMAX = 0.9;            // rad/s for the joint that moves the most
const ARM_JOINTS = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'];
// joint ranges used for free motion (inside the URDF limits, away from the folded / lying poses)
const RANGE = { joint1: [-2.4, 2.4], joint2: [-2.7, -0.45], joint3: [-2.6, -0.35], joint4: [-1.5, 1.4], joint5: [-1.4, 1.4], joint6: [-2.8, 2.8] };
const HOME = { joint1: 0, joint2: -1.2, joint3: -1.5, joint4: 0.3, joint5: 0, joint6: 0 };
const POINT_LINKS = ['link3', 'link4', 'link5', 'link6', 'end_link', 'finger_left_link', 'finger_right_link'];

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rnd = (a, b) => a + Math.random() * (b - a);

async function loadTemplate() {
  const dir = `${BASE}equipment/rebot/`;
  const [gltf, chain] = await Promise.all([
    new GLTFLoader().loadAsync(`${dir}rebot.glb`),
    fetch(`${dir}rebot.json`).then((r) => r.json()),
  ]);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.28 });
  const geoms = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    const c = g.attributes.color;
    if (c) {                                   // trimesh writes sRGB bytes; three expects linear vertex colours
      const col = new THREE.Color();
      for (let i = 0; i < c.count; i++) { col.setRGB(c.getX(i), c.getY(i), c.getZ(i), THREE.SRGBColorSpace); c.setXYZ(i, col.r, col.g, col.b); }
    }
    g.computeVertexNormals();
    geoms[o.name] = g;
  });
  return { geoms, mat, joints: chain.joints };
}

class Arm {
  constructor(tpl, n) {
    this.n = n;
    this.root = new THREE.Group(); this.root.name = `rebot-arm-${n}`;
    const urdf = new THREE.Group(); urdf.rotation.x = -Math.PI / 2;    // URDF z-up -> three y-up
    this.root.add(urdf);
    const links = { base_link: new THREE.Group() };
    urdf.add(links.base_link);
    this.movers = {}; this.joints = {};
    for (const j of tpl.joints) {
      const frame = new THREE.Group();
      frame.position.fromArray(j.xyz);
      frame.quaternion.setFromEuler(new THREE.Euler(j.rpy[0], j.rpy[1], j.rpy[2], 'ZYX'));
      const mover = new THREE.Group(); frame.add(mover);
      const child = new THREE.Group(); mover.add(child);
      links[j.parent].add(frame); links[j.child] = child;
      this.movers[j.name] = { mover, axis: new THREE.Vector3().fromArray(j.axis).normalize(), type: j.type };
      this.joints[j.name] = j;
    }
    for (const [name, g] of Object.entries(tpl.geoms)) {
      if (!links[name]) continue;
      const m = new THREE.Mesh(g, tpl.mat); m.castShadow = true; m.receiveShadow = true;
      links[name].add(m);
    }
    this.links = links;
    this.q = { ...HOME, finger_left: 0.02, finger_right: 0.02 };
    this.apply(this.q);
    this.move = null; this.wait = rnd(0.2, 2.5);
    this.pts = POINT_LINKS.map(() => new THREE.Vector3());
  }

  apply(q) {
    for (const [name, v] of Object.entries(q)) {
      const m = this.movers[name]; if (!m) continue;
      if (m.type === 'prismatic') m.mover.position.copy(m.axis).multiplyScalar(v);
      else m.mover.quaternion.setFromAxisAngle(m.axis, v);
    }
  }

  /** World positions of the arm's key link points (after apply + updateMatrixWorld). */
  points(out = this.pts) {
    this.root.updateMatrixWorld(true);
    POINT_LINKS.forEach((name, i) => this.links[name].getWorldPosition(out[i]));
    return out;
  }

  /** Is configuration q inside this arm's own workspace (above the desk, within REACH of the base)? */
  inWorkspace(q, tmp) {
    this.apply(q);
    const pts = this.points(tmp);
    const b = this.root.position;
    for (const p of pts) {
      if (p.y < b.y + ABOVE) return false;
      if (Math.hypot(p.x - b.x, p.z - b.z) > REACH) return false;
    }
    return true;
  }
}

export class RebotArms {
  constructor(building) {
    this.building = building;
    this.arms = [];
    this.tmp = POINT_LINKS.map(() => new THREE.Vector3());
  }

  async load() {
    const items = this.building.levels.flatMap((lv) => (lv.equipment || []).filter((e) => e.model === 'rebot-arm').map((e) => ({ ...e, lv })));
    if (!items.length) return 0;
    const tpl = await loadTemplate();
    for (const it of items) {
      const arm = new Arm(tpl, this.arms.length + 1);
      arm.root.position.copy(toWorld(it.x, it.y, it.lv.elevation + it.top));
      arm.root.rotation.y = it.yaw;
      arm.lv = it.lv;
      this.building.groups[it.lv.id].add(arm.root);
      arm.points();
      this.arms.push(arm);
    }
    return this.arms.length;
  }

  #plan(arm) {
    const from = { ...arm.q };
    for (let tries = 0; tries < 40; tries++) {
      const to = { ...from };
      for (const j of ARM_JOINTS) to[j] = rnd(...RANGE[j]);
      const g = Math.random() < 0.5 ? 0.0 : rnd(0.02, 0.045);   // open / close the gripper on the way
      to.finger_left = g; to.finger_right = g;
      let ok = true;
      for (let k = 1; k <= 8 && ok; k++) {
        const t = k / 8, q = {};
        for (const j of Object.keys(to)) q[j] = from[j] + (to[j] - from[j]) * t;
        ok = arm.inWorkspace(q, this.tmp);
      }
      if (!ok) continue;
      const span = Math.max(...ARM_JOINTS.map((j) => Math.abs(to[j] - from[j])));
      arm.apply(from);
      return { from, to, t: 0, dur: Math.max(1.2, span / VMAX) * rnd(1, 1.6) };
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
