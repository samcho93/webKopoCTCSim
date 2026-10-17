// M400 robot cafe (samcho93/cafesim, vendored in src/vendor/cafesim) running inside the building.
//
// The real in-browser simulator runs: LocalLink -> @cafesim/core Platform (coffee machine, ice maker,
// cup dispenser, card terminal and their serial protocols) and the UR5e RobotCell (studyUR kinematics)
// that does the customer's cup moves. This module is the small "stage" RobotCell needs:
// scene / slotPos / obstacles in cafe coordinates (counter top = y 0, x along the counter,
// z toward the customer, metres), placed into the building by translating one group.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LocalLink, createMachine } from './vendor/cafesim/viewer/link.js';
import robotCafe from './vendor/cafesim/platforms/m400-robot/platform.js';
import { MODEL_BUILDERS } from './vendor/cafesim/viewer/scene/models.js';
import { CupLayer, KIND_COLOR } from './vendor/cafesim/viewer/scene/cups.js';
import { woodTexture, textTexture } from './vendor/cafesim/viewer/scene/textures.js';
import { RobotCell } from './vendor/cafesim/viewer/robot/RobotCell.js';
import { toWorld } from './geo.js';

const BASE = import.meta.env.BASE_URL;
const FLOOR = 0.89;          // counter top above the floor

export class CafeStation {
  /**
   * placement: { level, x, y } plan position of the cafe origin (counter centre line, 0.33 m in
   * front of the wall the counter stands against). The counter runs along +x, customers stand at -y.
   */
  constructor(building, placement, { onToast = () => {}, autoOrder = 45 } = {}) {
    this.building = building;
    this.definition = robotCafe;
    this.lv = building.byId[placement.level];
    this.toast = onToast;
    this.autoOrderEvery = autoOrder;      // s between automatic demo orders (0 = off)
    this.orderT = 6;
    this.busyOrder = false;
    this.orders = 0;

    const G = new THREE.Group();
    G.name = 'm400-robot-cafe';
    G.position.copy(toWorld(placement.x, placement.y, this.lv.elevation + FLOOR));
    building.groups[this.lv.id].add(G);
    G.updateMatrixWorld(true);
    // Stage interface used by RobotCell
    this.scene = G;
    this.frame = G;
    this.urBase = `${BASE}equipment/m400/ur`;
    this.slotPos = new Map();
    this.obstacles = [];
    this.units = [];

    this.link = new LocalLink(this.definition, { autoAssist: false });
    this.machine = createMachine(this.link, this.definition);
    this.#buildCounter();
    this.#buildUnits();
    this.cups = new CupLayer(G, (slot) => this.slotPos.get(slot) ?? null);
    this.#buildEffects();
    this.#buildStatusBoard();
    this.link.on('snap', (s) => { this.snapshot = s; this.cups.sync(s.world); });
    this.snapshot = this.link.snapshot;

    this.robot = new RobotCell({ stage: this, link: this.link, definition: this.definition });
    this.robot.on?.('status', () => this.#drawStatus());
    this.ready = this.robot.load().then(() => { this.robotReady = true; this.#drawStatus(); }).catch((e) => { console.warn('UR5e load failed', e); this.toast(`로봇 카페: UR5e 로딩 실패 (${e.message})`); });
  }

  // ------------------------------------------------------------------ construction (from cafesim Stage)
  #buildCounter() {
    const s = this.scene;
    const { width = 2.6, depth = 0.72 } = this.definition.layout?.counter ?? {};
    const top = new THREE.Mesh(new RoundedBoxGeometry(width, 0.04, depth, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0xece7df, roughness: 0.55 }));
    top.position.set(0, -0.02, 0.06);
    top.receiveShadow = top.castShadow = true;
    const wood = woodTexture(); wood.repeat.set(width / 1.2, 1);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 0.84, depth - 0.06), new THREE.MeshStandardMaterial({ map: wood, roughness: 0.7 }));
    cab.position.set(0, -0.46, 0.04); cab.castShadow = cab.receiveShadow = true;
    const kick = new THREE.Mesh(new THREE.BoxGeometry(width - 0.04, 0.05, 0.01), new THREE.MeshStandardMaterial({ color: 0x3a3029 }));
    kick.position.set(0, -0.86, 0.36);
    s.add(top, cab, kick);
    for (let x = -width / 2 + width / 4; x < width / 2; x += width / 4) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.84, 0.002), new THREE.MeshStandardMaterial({ color: 0x5a3b22 }));
      seam.position.set(x, -0.46, 0.04 + (depth - 0.06) / 2 + 0.001);
      s.add(seam);
    }
    const p = this.definition.layout?.pickup ?? [-1.08, 0, 0.16];
    this.slotPos.set('pickup', new THREE.Vector3(p[0], 0.001, p[2]));
    this.obstacles.push({ name: '카운터', min: [-width / 2, -0.9, 0.06 - depth / 2], max: [width / 2, 0, 0.06 + depth / 2] }, { name: '벽', min: [-4, -1, -0.6], max: [4, 3, -0.33] });
    const table = this.definition.layout?.pickupTable;
    if (table) {
      const [tw, td] = table.size ?? [0.6, 0.36];
      const t = new THREE.Mesh(new RoundedBoxGeometry(tw, 0.035, td, 2, 0.008), new THREE.MeshStandardMaterial({ color: 0xece7df, roughness: 0.5 }));
      t.position.set(p[0], -0.0175, p[2]); t.castShadow = t.receiveShadow = true; s.add(t);
      const legMat = new THREE.MeshStandardMaterial({ color: 0x5b5148, metalness: 0.3, roughness: 0.5 });
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.85, 0.035), legMat);
        leg.position.set(p[0] + sx * (tw / 2 - 0.04), -0.46, p[2] + sz * (td / 2 - 0.04)); leg.castShadow = true; s.add(leg);
      }
      const label = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.04), new THREE.MeshBasicMaterial({ map: textTexture(256, 64, [{ text: '픽업대', size: 30, color: '#6b6258', y: 32 }]), transparent: true }));
      label.rotation.x = -Math.PI / 2; label.position.set(p[0], 0.002, p[2] + td / 2 - 0.03); s.add(label);
      this.obstacles.push({ name: '픽업 테이블', min: [p[0] - tw / 2, -0.9, p[2] - td / 2], max: [p[0] + tw / 2, 0, p[2] + td / 2] });
    }
  }

  #buildUnits() {
    const G = this.scene;
    for (const u of this.definition.layout?.units ?? []) {
      const devDef = this.definition.devices.find((d) => d.key === u.device);
      const builder = MODEL_BUILDERS[u.model];
      if (!builder) continue;
      const model = builder(devDef?.options ?? {});
      model.group.position.set(...u.position);
      if (u.rotation) model.group.rotation.y = u.rotation;
      model.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      G.add(model.group);
      G.updateMatrixWorld(true);
      // slot positions in cafe coordinates
      const local = (v) => G.worldToLocal(model.group.localToWorld(v.clone()));
      for (const [name, v] of Object.entries(model.slots ?? {})) this.slotPos.set(`${u.device}:${name}`, local(v));
      if (u.payment && model.anchors?.card) this.slotPos.set(`${u.payment}:slot`, local(model.anchors.card));
      for (const o of model.obstacles ?? []) {
        const at = (v) => v.map((x, i) => x + u.position[i]);
        this.obstacles.push({ name: o.name, min: at(o.min), max: at(o.max) });
      }
      this.units.push({ ...u, model });
    }
  }

  #buildEffects() {
    this.streams = Array.from({ length: 6 }, () => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, 1, 10, 1, true), new THREE.MeshStandardMaterial({ color: 0x3b2416, transparent: true, opacity: 0.85, roughness: 0.1 }));
      m.visible = false; this.scene.add(m); return m;
    });
    this.iceBits = new THREE.InstancedMesh(new THREE.BoxGeometry(0.014, 0.014, 0.014), new THREE.MeshStandardMaterial({ color: 0xeef8ff, transparent: true, opacity: 0.8 }), 24);
    this.iceBits.count = 0; this.iceBits.frustumCulled = false;
    this.scene.add(this.iceBits);
  }

  /** Coffee-machine screen (the cafesim viewer shows the kiosk iframe there): order + robot status. */
  #buildStatusBoard() {
    const unit = this.units.find((u) => u.model.anchors?.screen);
    const c = document.createElement('canvas'); c.width = 512; c.height = 320;
    this.statusCanvas = c;
    this.statusTex = new THREE.CanvasTexture(c); this.statusTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.statusTex, toneMapped: false });
    if (unit) {
      const { screen, screenSize } = unit.model.anchors;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(screenSize.w, screenSize.h), mat);
      m.position.copy(this.scene.worldToLocal(unit.model.group.localToWorld(screen.clone()))); m.position.z += 0.002;
      m.rotation.y = unit.model.group.rotation.y;
      this.scene.add(m);
    }
    // wall sign above the counter
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.3), new THREE.MeshBasicMaterial({ map: textTexture(1024, 256, [{ text: 'M400 ROBOT CAFE', size: 92, color: '#3b2416', y: 100 }, { text: 'cafeSim · UR5e (studyUR)', size: 44, color: '#7a6450', y: 190 }]), transparent: true }));
    sign.position.set(0, 1.05, -0.325);
    this.scene.add(sign);
    this.#drawStatus();
  }

  #drawStatus() {
    const g = this.statusCanvas.getContext('2d'), W = 512, H = 320;
    g.fillStyle = '#10151c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#6b3f1f'; g.fillRect(0, 0, W, 54);
    g.fillStyle = '#fff'; g.font = '700 28px Arial, sans-serif'; g.fillText('M400 로봇 카페', 18, 37);
    g.font = '500 20px Arial, sans-serif'; g.fillStyle = '#ffd9a8'; g.textAlign = 'right'; g.fillText(`주문 ${this.orders}`, W - 16, 36); g.textAlign = 'left';
    const lines = [];
    if (!this.robotReady) lines.push('UR5e 로봇 준비 중…');
    else lines.push(this.robot.status || '대기 중');
    const guide = this.snapshot?.guide?.[0]?.text;
    if (guide) lines.push(guide);
    if (this.current) lines.push(`☕ ${this.current}`);
    g.fillStyle = '#e8edf2'; g.font = '22px Arial, sans-serif';
    let y = 96;
    for (const ln of lines) for (const part of wrap(ln, 30)) { g.fillText(part, 18, y); y += 32; if (y > H - 10) break; }
    this.statusTex.needsUpdate = true;
  }

  // ------------------------------------------------------------------ orders
  /** Pay + order a menu item through the real machine protocol (same calls the kiosk makes). */
  async order(itemId = null, temp = null) {
    if (this.busyOrder || !this.robotReady) return false;
    const menu = this.definition.menu;
    const item = itemId ? menu.find((m) => m.id === itemId) : menu[this.orders % menu.length];
    if (!item) return false;
    this.busyOrder = true;
    const t = temp ?? item.temps?.[this.orders % (item.temps?.length || 1)] ?? item.temps?.[0];
    this.current = `${item.name ?? item.id}${t ? ` (${t === 'ice' ? 'ICE' : 'HOT'})` : ''}`;
    this.orders++;
    this.toast(`로봇 카페 주문: ${this.current}`);
    this.#drawStatus();
    try {
      await this.machine.pay(item.price);
      await this.machine.order(item, { temp: t });
    } catch (e) {
      console.warn('cafe order failed', e);
      this.toast(`로봇 카페 주문 실패: ${e.message}`);
    } finally {
      this.busyOrder = false;
      this.current = null;
      this.orderT = this.autoOrderEvery;
      this.#drawStatus();
    }
    return true;
  }

  // ------------------------------------------------------------------ per frame
  update(dt, t) {
    const snap = this.snapshot;
    this.cups.tick(dt);
    if (this.robotReady) {
      this.robot.frame?.();
      for (const v of this.cups.views.values()) if (v.slot === 'robot:gripper') v.group.position.copy(this.robot.carriedCupPosition(v.type));
    }
    if (snap) {
      for (const u of this.units) u.model.update?.(snap.devices[u.device], u.payment ? snap.devices[u.payment] : null, t, snap.world, u.device);
      this.#updateStreams(snap, t);
    }
    if (this.autoOrderEvery && this.robotReady && !this.busyOrder && !this.robot.busy) {
      this.orderT -= dt;
      if (this.orderT <= 0) this.order();
    }
    this.statusT = (this.statusT ?? 0) - dt;
    if (this.statusT <= 0) { this.statusT = 0.5; this.#drawStatus(); }
  }

  #updateStreams(snap, t) {
    let i = 0;
    const G = this.scene;
    const show = (top, bottomY, color, width = 1) => {
      const m = this.streams[i++];
      if (!m) return;
      const len = Math.max(0.01, top.y - bottomY);
      m.visible = true;
      m.scale.set(width * (1 + Math.sin(t * 40 + i) * 0.15), len, width);
      m.position.set(top.x, bottomY + len / 2, top.z);
      m.material.color.copy(color);
    };
    const local = (u, v) => G.worldToLocal(u.model.group.localToWorld(v.clone()));
    for (const u of this.units) {
      const dev = snap.devices[u.device];
      if (dev?.streams && u.model.anchors?.spoutTops) {
        const seen = new Set();
        for (const s of dev.streams) {
          const key = `${s.spout}-${s.kind}-${s.sub}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const top = local(u, u.model.anchors.spoutTops[s.spout - 1]);
          const slot = `${u.device}:spout${s.spout}`;
          const bottom = this.cups.topOf(slot) ?? this.slotPos.get(slot)?.y ?? 0.1;
          show(top, Math.min(bottom - 0.03, top.y - 0.02), KIND_COLOR(s.kind, s.sub), s.kind === 'coffee' ? 0.8 : 1.1);
        }
      }
      if (dev?.dispensing && u.model.anchors?.nozzle) {
        const top = local(u, u.model.anchors.nozzle);
        const bottom = this.cups.topOf(`${u.device}:tray`) ?? 0.09;
        if (dev.dispensing.phase === 'water') show(top, bottom - 0.03, KIND_COLOR('water'), 1.2);
        else {
          const m = new THREE.Matrix4();
          this.iceBits.count = 10;
          for (let k = 0; k < 10; k++) {
            const f = (t * 2.2 + k / 10) % 1;
            m.makeRotationFromEuler(new THREE.Euler(k + t * 3, k * 2, 0));
            m.setPosition(top.x + Math.sin(k * 7.1) * 0.012, top.y - f * (top.y - bottom + 0.02), top.z + Math.cos(k * 3.3) * 0.012);
            this.iceBits.setMatrixAt(k, m);
          }
          this.iceBits.instanceMatrix.needsUpdate = true;
        }
      }
      if (!snap.devices[u.device]?.dispensing && u.model.anchors?.nozzle) this.iceBits.count = 0;
    }
    for (; i < this.streams.length; i++) this.streams[i].visible = false;
  }
}

function wrap(text, n) {
  const out = []; let s = String(text);
  while (s.length > n) { out.push(s.slice(0, n)); s = s.slice(n); }
  out.push(s);
  return out;
}
