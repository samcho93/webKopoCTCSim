// Elevator cars with landing doors. Bodies standing in the car ride along.
import * as THREE from 'three';
import { GeoBuilder, toWorld } from './geo.js';

const SPEED = 1.6, ACC = 0.8, DOOR_T = 1.6, DWELL = 4.0;

export class Elevator {
  constructor(def, building, scene) {
    this.def = def;
    this.id = def.id;
    this.building = building;
    this.levels = def.levels.map((id) => building.byId[id]);
    this.z = this.levels[0].elevation;
    this.v = 0;
    this.queue = [];
    this.door = 0;          // 0 closed .. 1 open
    this.doorTarget = 0;
    this.dwell = 0;
    this.listeners = [];

    const [cx0, cy0, cx1, cy1] = def.car;
    this.car = def.car;
    const g = new THREE.Group(); g.name = `car-${def.id}`;
    const mk = (key, build) => { const b = new GeoBuilder(); build(b); const m = new THREE.Mesh(b.build(), building.materials[key]); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
    const H = 2.4, t = 0.05;
    mk('carFloor', (b) => b.box(cx0, cy0, -0.08, cx1, cy1, 0));
    mk('steel', (b) => b.box(cx1, def.door[0], -0.08, def.doorX + 0.15, def.door[1], 0)); // sill plate
    mk('car', (b) => {
      b.box(cx0, cy0, 0, cx0 + t, cy1, H);           // back (west)
      b.box(cx0, cy0, 0, cx1, cy0 + t, H);           // south
      b.box(cx0, cy1 - t, 0, cx1, cy1, H);           // north
      b.box(cx0, cy0, H, cx1, cy1, H + 0.06);        // roof
      b.box(cx1 - t, cy0, 0, cx1, def.door[0], H);   // front returns
      b.box(cx1 - t, def.door[1], 0, cx1, cy1, H);
      b.box(cx1 - t, def.door[0], 2.15, cx1, def.door[1], H);
      b.box(cx0 + t, cy0 + 0.3, 0.9, cx0 + 0.09, cy1 - 0.3, 0.95); // handrail
    });
    const light = new THREE.PointLight(0xfff3e0, 4, 4, 1.5);
    light.position.copy(toWorld((cx0 + cx1) / 2, (cy0 + cy1) / 2, 2.2)); g.add(light);
    // car door panels (two leaves sliding along y)
    this.carDoors = [0, 1].map((i) => mk('landingDoor', (b) => {
      const w = (def.door[1] - def.door[0]) / 2;
      b.box(cx1 - 0.02, 0, 0, cx1 + 0.02, w, 2.15);
    }));
    scene.add(g);
    this.group = g;

    // landing doors on every served level
    this.landing = this.levels.map((lv) => {
      const w = (def.door[1] - def.door[0]) / 2;
      const leaves = [0, 1].map(() => {
        const b = new GeoBuilder(); b.box(def.doorX + 0.155, 0, 0, def.doorX + 0.185, w, 2.15);
        const m = new THREE.Mesh(b.build(), building.materials.landingDoor);
        m.castShadow = true; building.groups[lv.id].add(m); return m;
      });
      return { lv, leaves };
    });
    this.update(0);
  }

  get levelIndex() {
    let best = 0, d = Infinity;
    this.levels.forEach((lv, i) => { const dd = Math.abs(lv.elevation - this.z); if (dd < d) { d = dd; best = i; } });
    return best;
  }
  get level() { return this.levels[this.levelIndex]; }
  get atLevel() { return Math.abs(this.level.elevation - this.z) < 0.01 && this.v === 0; }
  get doorOpen() { return this.door > 0.95; }

  call(levelId) {
    const i = this.levels.findIndex((l) => l.id === levelId);
    if (i < 0) return false;
    if (this.queue.includes(i)) return true;
    if (this.atLevel && this.levelIndex === i) { this.doorTarget = 1; this.dwell = DWELL; return true; }
    this.queue.push(i);
    return true;
  }

  holdOpen() { if (this.atLevel) { this.doorTarget = 1; this.dwell = DWELL; } }

  /** Plan-space test: is (x,y) within the car footprint? */
  contains(x, y, pad = 0) {
    const [x0, y0, x1, y1] = this.car;
    return x > x0 + pad && x < x1 - pad && y > y0 + pad && y < y1 - pad;
  }

  /** Car floor incl. the sill plate that bridges the gap to the landing. */
  floorContains(x, y) {
    const [x0, y0, x1, y1] = this.car;
    if (x > x0 - 0.02 && x < x1 + 0.02 && y > y0 - 0.02 && y < y1 + 0.02) return true;
    return x >= x1 && x < this.def.doorX + 0.2 && y > this.def.door[0] && y < this.def.door[1];
  }

  update(dt) {
    // doors
    const dd = dt / DOOR_T;
    this.door = this.doorTarget > this.door ? Math.min(1, this.door + dd) : Math.max(0, this.door - dd);
    if (this.doorOpen && this.dwell > 0) { this.dwell -= dt; if (this.dwell <= 0) this.doorTarget = 0; }
    // motion
    if (this.queue.length && this.door === 0) {
      const target = this.levels[this.queue[0]].elevation;
      const dz = target - this.z;
      const stopDist = (this.v * this.v) / (2 * ACC);
      const dir = Math.sign(dz);
      if (Math.abs(dz) < 0.005) {
        this.z = target; this.v = 0; this.queue.shift();
        this.doorTarget = 1; this.dwell = DWELL;
        for (const f of this.listeners) f(this);
      } else {
        const want = Math.abs(dz) <= stopDist + 0.01 ? Math.max(0.15, Math.sqrt(2 * ACC * Math.abs(dz))) : SPEED;
        const vAbs = Math.min(want, Math.abs(this.v) + ACC * dt);
        this.v = dir * vAbs;
        const step = this.v * dt;
        this.z = Math.abs(step) >= Math.abs(dz) ? target : this.z + step;
      }
    } else if (this.queue.length && this.doorOpen) {
      this.doorTarget = 0; this.dwell = 0;
    }
    this.group.position.y = this.z;
    const w = (this.def.door[1] - this.def.door[0]) / 2;
    const off = this.door * (w - 0.05);
    const [d0, d1] = this.def.door;
    this.carDoors[0].position.set(0, 0, -(d0 - off));
    this.carDoors[1].position.set(0, 0, -(d0 + w + off));
    this.landing.forEach(({ lv, leaves }, i) => {
      const o = i === this.levelIndex && this.atLevel ? off : 0;
      leaves[0].position.set(0, lv.elevation, -(d0 - o));
      leaves[1].position.set(0, lv.elevation, -(d0 + w + o));
    });
  }

  /** Dynamic collision boxes in plan coords: [x0,y0,x1,y1,z0,z1]. */
  blockers() {
    const out = [];
    const [cx0, cy0, cx1, cy1] = this.car;
    const z = this.z;
    out.push([cx0 - 0.1, cy0, cx0 + 0.05, cy1, z, z + 2.4]);
    out.push([cx0, cy0 - 0.1, cx1, cy0 + 0.05, z, z + 2.4]);
    out.push([cx0, cy1 - 0.05, cx1, cy1 + 0.1, z, z + 2.4]);
    const [d0, d1] = this.def.door;
    const gap = this.door * (d1 - d0);
    const mid = (d0 + d1) / 2;
    if (gap < 0.8) out.push([cx1 - 0.05, d0, cx1 + 0.05, d1, z, z + 2.2]); // car door
    this.levels.forEach((lv, i) => {
      const open = i === this.levelIndex && this.atLevel && this.door > 0.8;
      if (!open) out.push([this.def.doorX + 0.12, d0 - 0.05, this.def.doorX + 0.22, d1 + 0.05, lv.elevation, lv.elevation + 2.2]);
    });
    void mid;
    return out;
  }
}
