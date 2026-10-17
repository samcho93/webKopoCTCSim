// Lab equipment placed by building.json (level.equipment, from EDITS in the extractor).
//   hplc1260 : Agilent 1260 Infinity II stack — URDF + look from samcho93/studyHPLC1260
//              (assets/robot/hplc1260, sim/js/hplc-look.js).
// All copies are drawn from one baked geometry per material (InstancedMesh: cheap). A copy you click,
// or walk up to, is swapped for a live URDF instance whose joints move like in the studyHPLC1260
// simulator: module front covers / MCT door open (interior visible), purge & injection valves turn.
import * as THREE from 'three';
import URDFLoader from 'urdf-loader';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { upgradeMaterials, addDecals, createPilotScreen, drawPilotFrame } from './hplcLook.js';
import { toWorld } from './geo.js';

const BASE = import.meta.env.BASE_URL;
const BASE_BOTTOM = 0.03;   // base_link plate reaches 3 cm below the URDF origin
const MAX_LIVE = 3;
const MODS = ['pump', 'sampler', 'mct', 'vwd'];
const MOD_TITLE = { pump: 'Quaternary Pump 앞 덮개', sampler: 'Vialsampler 앞 덮개', mct: 'MCT (컬럼 온도조절) 문', vwd: 'VWD 검출기 앞 덮개' };
const PART_TITLE = {
  pump_purge_knob: '퍼지 밸브', pump_purge_body: '퍼지 밸브', sampler_valve_stator: '주입 밸브', sampler_valve_rotor: '주입 밸브',
  pump_head_1: '펌프 헤드', pump_head_2: '펌프 헤드', pump_degasser: '탈기 장치', pump_mcgv: 'MCGV 비례 밸브',
  needle: '니들', needle_head: '니들', sampler_tray: '바이알 트레이', mct_column: '컬럼', mct_heat_exchanger: '열교환기',
  vwd_lamp: '중수소 램프', vwd_flow_cell: '플로우 셀', vwd_optics: '광학부', waste_bottle: '폐액병',
};

async function loadHplc() {
  const dir = `${BASE}equipment/hplc1260/`;
  const plumb = await (await fetch(`${dir}plumbing.json`)).json();
  const robot = await new Promise((res, rej) => new URDFLoader().load(`${dir}hplc1260.urdf`, res, undefined, rej));
  upgradeMaterials(THREE, robot);
  addDecals(THREE, robot, plumb);
  const pilot = createPilotScreen(THREE, robot);
  pilot?.draw((ctx, w, h) => drawPilotFrame(ctx, w, h, 'Instant Pilot', ['Control', 'Method', 'Status', 'Logbook', 'More'], (c) => {
    c.fillStyle = '#9fe870'; c.font = '600 22px Arial, sans-serif'; c.fillText('System Ready', 16, 80);
    c.fillStyle = '#c9d6e3'; c.font = '16px Arial, sans-serif'; c.fillText('Pump  Off   Sampler  Ready', 16, 120); c.fillText('MCT   25.0 C  VWD  Lamp On', 16, 146);
  }, { right: '1260 Infinity II' }));
  robot.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.transparent; o.receiveShadow = true; } });
  return robot;
}

/** Merge every mesh of a model into one geometry per material (model space, z-up URDF frame). */
function bake(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const byMat = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(g);
  });
  const parts = [...byMat].map(([material, gs]) => ({ material, geometry: mergeGeometries(gs, false), renderOrder: material.transparent ? 2 : 0 }));
  const bb = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); bb.union(p.geometry.boundingBox); }
  parts.center = [(bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2];
  return parts;
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class Equipment {
  constructor(building, { onToast = () => {} } = {}) {
    this.building = building;
    this.toast = onToast;
    this.items = [];          // { lv, model, matrix, idx, group (instanced meshes), live }
    this.groups = new Map();  // `${lv}:${model}` -> InstancedMesh[]
    this.pickables = [];
    this.live = [];
    this.tweens = [];
  }

  async load() {
    const items = this.building.levels.flatMap((lv) => (lv.equipment || []).filter((e) => e.model === 'hplc1260').map((e) => ({ ...e, lv })));
    if (!items.length) return 0;
    this.template = await loadHplc();
    const parts = bake(this.template);
    const toThree = new THREE.Matrix4().makeRotationX(-Math.PI / 2);   // URDF z-up -> three y-up
    for (const lv of this.building.levels) {
      const mine = items.filter((it) => it.lv === lv);
      if (!mine.length) continue;
      mine.forEach((it, idx) => {
        // centre the model's footprint on (x, y); plan yaw rotates model x/y the same way
        const [cx, cy] = parts.center, c = Math.cos(it.yaw), s = Math.sin(it.yaw);
        const p = toWorld(it.x - (c * cx - s * cy), it.y - (s * cx + c * cy), lv.elevation + it.top + BASE_BOTTOM);
        it.matrix = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw), new THREE.Vector3(1, 1, 1)).multiply(toThree);
        it.idx = idx;
        it.pos = p;
        this.items.push(it);
      });
      const ims = parts.map(({ material, geometry, renderOrder }) => {
        const im = new THREE.InstancedMesh(geometry, material, mine.length);
        mine.forEach((it) => im.setMatrixAt(it.idx, it.matrix));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = !material.transparent; im.receiveShadow = true;
        im.renderOrder = renderOrder;
        im.computeBoundingSphere();
        im.name = 'equip-hplc1260';
        im.userData.equip = { level: lv.id };
        this.building.groups[lv.id].add(im);
        this.pickables.push(im);
        return im;
      });
      this.groups.set(lv.id, ims);
    }
    return items.length;
  }

  itemOf(levelId, idx) { return this.items.find((it) => it.lv.id === levelId && it.idx === idx); }

  /** Swap a baked copy for a live, articulated URDF instance. */
  activate(item, quiet = false) {
    if (!item || item.live) return item?.live;
    if (this.live.length >= MAX_LIVE) this.deactivate(this.live[0]);
    const robot = this.template.clone(true);
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(item.matrix);
    holder.add(robot);
    holder.userData.equipLive = item;
    this.building.groups[item.lv.id].add(holder);
    for (const im of this.groups.get(item.lv.id)) { im.setMatrixAt(item.idx, ZERO); im.instanceMatrix.needsUpdate = true; }
    item.live = { holder, robot, open: {} };
    this.live.push(item);
    this.pickables.push(holder);
    if (!quiet) this.toast('HPLC 활성화 — 모듈 앞 덮개·밸브를 클릭해 보세요');
    return item.live;
  }

  deactivate(item) {
    if (!item?.live) return;
    item.live.holder.removeFromParent();
    this.pickables.splice(this.pickables.indexOf(item.live.holder), 1);
    for (const im of this.groups.get(item.lv.id)) { im.setMatrixAt(item.idx, item.matrix); im.instanceMatrix.needsUpdate = true; }
    this.tweens = this.tweens.filter((t) => t.robot !== item.live.robot);
    item.live = null;
    this.live.splice(this.live.indexOf(item), 1);
  }

  /** Handle a click ray hit. Returns true when the hit was equipment. */
  click(hit) {
    let o = hit.object;
    if (o.isInstancedMesh && o.userData.equip) {
      this.activate(this.itemOf(o.userData.equip.level, hit.instanceId));
      return true;
    }
    let holder = o; while (holder && !holder.userData.equipLive) holder = holder.parent;
    if (!holder) return false;
    const item = holder.userData.equipLive;
    let link = o; while (link && !link.isURDFLink) link = link.parent;
    const name = link?.name || '';
    const live = item.live;
    const m = /^(pump|sampler|mct|vwd)_door$/.exec(name);
    if (m) {
      live.open[m[1]] = !live.open[m[1]];
      this.#jointTo(live.robot, `${m[1]}_door`, live.open[m[1]] ? 1.6 : 0, 0.7);
      this.toast(`${MOD_TITLE[m[1]]} ${live.open[m[1]] ? '열림' : '닫힘'}`);
      return true;
    }
    if (/purge/.test(name)) {
      live.purge = !live.purge; this.#jointTo(live.robot, 'purge_valve', live.purge ? -Math.PI : 0, 0.5);
      this.toast(`퍼지 밸브 ${live.purge ? '열림' : '닫힘'}`); return true;
    }
    if (/sampler_valve/.test(name)) {
      live.bypass = !live.bypass; this.#jointTo(live.robot, 'injection_valve', live.bypass ? 1.0472 : 0, 0.3);
      this.toast(`주입 밸브 ${live.bypass ? 'Bypass' : 'Mainpass'}`); return true;
    }
    if (/needle|sampler_rail|sampler_tray|vial/.test(name)) {
      // one injection cycle: needle to the vial, down, up, back to the seat
      const r = live.robot, seq = [['needle_x', -0.06], ['needle_y', -0.1], ['needle_z', -0.09], ['needle_z', 0], ['needle_y', 0], ['needle_x', 0]];
      let d = 0; for (const [j, v] of seq) { this.#jointTo(r, j, v, 0.45, d); d += 0.5; }
      this.toast('샘플러: 바이알 흡입 → 주입 동작'); return true;
    }
    const title = PART_TITLE[name];
    this.toast(title ? `HPLC · ${title}` : 'HPLC — 앞 덮개를 클릭하면 열립니다');
    return true;
  }

  #jointTo(robot, name, to, dur, delay = 0) {
    const j = robot.joints[name];
    if (!j) return;
    this.tweens = this.tweens.filter((t) => !(t.robot === robot && t.name === name && delay === 0));
    this.tweens.push({ robot, name, j, to, dur: Math.max(0.05, dur), a: 0, delay, from: null });
  }

  /** dt step; walker (plan pos + level) auto-activates the nearest copy within reach. */
  update(dt, walker) {
    for (const t of this.tweens) {
      if (t.delay > 0) { t.delay -= dt; continue; }
      if (t.from === null) { const a = t.j.angle; t.from = Number(Array.isArray(a) ? a[0] : a) || 0; }
      t.a = Math.min(1, t.a + dt / t.dur);
      const e = t.a < 0.5 ? 2 * t.a * t.a : 1 - Math.pow(-2 * t.a + 2, 2) / 2;
      t.j.setJointValue(t.from + (t.to - t.from) * e);
    }
    this.tweens = this.tweens.filter((t) => t.a < 1);
    if (walker) {
      let best = null, bd = 2.2;
      for (const it of this.items) {
        if (it.lv.id !== walker.level) continue;
        const d = Math.hypot(it.x - walker.x, it.y - walker.y);
        if (d < bd) { bd = d; best = it; }
      }
      if (best && !best.live) this.activate(best, true);
    }
  }
}
