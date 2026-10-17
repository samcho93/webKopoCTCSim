// Exhibition robots (level.equipment):
//   "go2-display"  : Unitree Go2 (studyGo2 URDF) standing; a click = step in place five times, then stop
//   "tiki-display" : TIKI-mini (studyTIKI URDF) on a desk, static
// They are props, not simulated robots (no sensors / navigation / ROS).
import * as THREE from 'three';
import { instantiate, go2LegIK, GO2_LEGS } from './urdfModels.js';
import { toWorld } from './geo.js';

const HIP_H = 0.32, THIGH = 0.213, CALF = 0.213, FOOT_R = 0.022;
const STEPS = 5;            // gait cycles per click
const FREQ = 1.6;           // Hz

function pose(urdf, phase, lift) {
  for (const leg of GO2_LEGS) {
    const ph = phase + (leg === 'FL' || leg === 'RR' ? 0 : Math.PI);
    const up = lift * Math.max(0, Math.sin(ph)) * 0.07;        // swing leg lifts, stance leg stays down
    const [th, ca] = go2LegIK(0, -HIP_H + FOOT_R + up, THIGH, CALF);
    urdf.setJointValue(`${leg}_hip_joint`, 0);
    urdf.setJointValue(`${leg}_thigh_joint`, th);
    urdf.setJointValue(`${leg}_calf_joint`, ca);
  }
}

export class DisplayRobots {
  constructor(building, { onToast = () => {} } = {}) {
    this.building = building;
    this.toast = onToast;
    this.robots = [];
    this.pickables = [];
  }

  /** Call after loadRobotModels(). */
  load() {
    for (const lv of this.building.levels) {
      for (const e of lv.equipment || []) {
        if (e.model === 'tiki-display') { this.#placeTiki(lv, e); continue; }
        if (e.model !== 'go2-display') continue;
        const inst = instantiate('go2');
        if (!inst) continue;
        const { group, urdf } = inst;
        urdf.position.y = HIP_H;
        group.position.copy(toWorld(e.x, e.y, lv.elevation + e.top));
        group.rotation.y = e.yaw;
        group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const r = { group, urdf, phase: 0, left: 0, lv, n: this.robots.length + 1 };
        group.userData.displayRobot = r;
        pose(urdf, 0, 0);
        this.building.groups[lv.id].add(group);
        this.robots.push(r);
        this.pickables.push(group);
      }
    }
    return this.robots.length;
  }

  #placeTiki(lv, e) {
    const inst = instantiate('tiki');
    if (!inst) return;
    // base_footprint is the wheel axle; the body reaches 0.18 m behind it -> centre the body on (x, y)
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw), back = 0.07;
    inst.group.position.copy(toWorld(e.x + c * back, e.y + s * back, lv.elevation + e.top));
    inst.group.rotation.y = e.yaw;
    inst.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.building.groups[lv.id].add(inst.group);
    this.statics = (this.statics || 0) + 1;
  }

  click(hit) {
    let o = hit.object; while (o && !o.userData.displayRobot) o = o.parent;
    if (!o) return false;
    const r = o.userData.displayRobot;
    if (r.left <= 0) { r.left = STEPS * 2 * Math.PI; r.phase = 0; this.toast(`Go2 전시 로봇 #${r.n} — 제자리 걷기 ${STEPS}회`); }
    return true;
  }

  update(dt) {
    for (const r of this.robots) {
      if (r.left <= 0) continue;
      const d = Math.min(r.left, 2 * Math.PI * FREQ * dt);
      r.phase += d; r.left -= d;
      const fade = Math.min(1, r.phase / Math.PI, r.left / Math.PI + 0.001);   // ease in / out
      pose(r.urdf, r.phase, fade);
      r.urdf.position.y = HIP_H + Math.abs(Math.sin(r.phase)) * 0.006 * fade;
      if (r.left <= 0) { pose(r.urdf, 0, 0); r.urdf.position.y = HIP_H; }
    }
  }
}
