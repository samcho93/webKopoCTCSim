// Live VALEM espresso machines from AurenSim (samcho93/aurensim, vendored in src/vendor/aurensim),
// running their real controller firmware inside the building:
//   AUREN-PRO (AURA ONE) : ESP32-P4 main + 2x ESP32-S3 group boards, firmware compiled to WASM (threads ->
//                          needs crossOriginIsolated, provided by coi-serviceworker on GitHub Pages) +
//                          AuraPlant physics (boiler, pump, groups, cups) - AurenSim runtime-web.js
//   AUREN M (BELLA ONE)  : STM32F103 emulator running BellaOneMC.elf + plant model in a worker - sim-worker.js
// Ported from AurenSim's aurasim/js/main.js and bella/js/main.js (state -> 3D, LCD/OLED, inputs).
// Clicking a machine boots its firmware; then its buttons / LCD / knobs / cups / portafilter work like the
// physical machine: press a shot button and the espresso is extracted into the cup.
import * as THREE from 'three';
import { toWorld } from './geo.js';

const BASE = import.meta.env.BASE_URL;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function idleLcd(lcd, title, temp, sub) {
  if (!lcd) return;
  const c = lcd.canvas, g = c.getContext('2d'), w = c.width, h = c.height;
  g.fillStyle = '#0b0f14'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#8fa3b5'; g.font = `600 ${Math.round(h * 0.055)}px "Segoe UI", sans-serif`; g.fillText(title, w * 0.05, h * 0.1);
  g.fillStyle = '#ffffff'; g.font = `300 ${Math.round(h * 0.3)}px "Segoe UI", sans-serif`; g.textAlign = 'center'; g.fillText(temp, w * 0.47, h * 0.6);
  g.fillStyle = '#4fb3e8'; g.font = `500 ${Math.round(h * 0.06)}px "Segoe UI", sans-serif`; g.fillText(sub, w / 2, h * 0.88); g.textAlign = 'left';
  lcd.tex.needsUpdate = true;
}

function place(root, it) {
  // AurenSim frame: y up, front = +z. Plan yaw = direction the machine faces.
  root.position.copy(toWorld(it.x, it.y, it.lv.elevation + it.top));
  root.rotation.set(0, Math.PI / 2 + it.yaw, 0);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
}

// ======================================================================== AUREN-PRO
export class AuraStation {
  constructor(building, it, toast) { Object.assign(this, { building, it, toast }); this.S = null; this.state = 'idle'; }

  async init() {
    this.A = await import('./vendor/aurensim/aura/js/machine.js');
    const { buildEffects } = await import('./vendor/aurensim/aura/js/effects.js');
    this.A.restoreDim(this.A.DIM_AURA);
    const holder = new THREE.Group();
    const R = this.R = this.A.buildMachine(holder, 'aura');
    this.building.groups[this.it.lv.id].add(R.root);
    place(R.root, this.it);
    // LCD canvases (P4 800x480 / S3 480x320) shared with the 3D screens
    this.LCD = {};
    for (const [id, W, H] of [['p4', 800, 480], ['s3g1', 480, 320], ['s3g2', 480, 320]]) {
      if (!R.lcd[id]) continue;
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
      for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
      this.LCD[id] = { cv, ctx, img, dirty: null };
      R.lcd[id].canvas = cv; R.lcd[id].tex.image = cv; R.lcd[id].tex.needsUpdate = true;
    }
    idleLcd(R.lcd.p4, 'AUREN-PRO', '— 클릭 —', '클릭하면 펌웨어(ESP32-P4/S3) 부팅');
    idleLcd(R.lcd.s3g1, 'GROUP 1', '93.0', 'STANDBY');
    idleLcd(R.lcd.s3g2, 'GROUP 2', '93.0', 'STANDBY');
    this.FX = buildEffects(R.root, R);
    this.btnMask = 0;
    return this;
  }

  get root() { return this.R?.root; }
  send(m) { this.rt?.send(m); }

  async boot() {
    if (this.state !== 'idle') return;
    if (!window.crossOriginIsolated) {
      this.state = 'blocked';
      idleLcd(this.R.lcd.p4, 'AUREN-PRO', 'WASM', '이 페이지는 교차 출처 격리가 꺼져 있음 — 새로고침');
      this.toast('AUREN-PRO 펌웨어는 WASM 스레드가 필요합니다 — 페이지를 새로고침해 주세요');
      return;
    }
    this.state = 'booting';
    this.toast('AUREN-PRO 펌웨어 부팅 중… (ESP32-P4 + S3 x2, WASM)');
    try {
      const { startWebRuntime } = await import('./vendor/aurensim/aura/js/runtime-web.js');
      this.rt = await startWebRuntime({ onMessage: (m) => this.#onMsg(m), onFrame: (u8) => this.#onFrame(u8), model: 'aura' });
      this.state = 'running';
      this.toast('AUREN-PRO 준비 — 그룹 버튼(컵 아이콘)을 누르면 추출합니다');
    } catch (e) { this.state = 'idle'; console.warn(e); this.toast(`AUREN-PRO 부팅 실패: ${e.message}`); }
  }

  #onMsg(m) {
    switch (m.type) {
      case 'state': this.S = m.plant; break;
      case 'bl': if (this.R.lcd[m.board]) this.R.lcd[m.board].mat.emissiveIntensity = 0.12 + 0.95 * m.v / 100; break;
      case 'power': if (!m.on) this.#blank(m.board); break;
      case 'mainPower': this.mainPower = m.on; this.#powerSwitch(); break;
      case 'hello': this.mainPower = m.mainPower !== false; this.#powerSwitch(); break;
    }
  }

  #powerSwitch() {
    const ps = this.R.powerSwitch;                        // AUREN-PRO: red rotary switch, handle horizontal = ON
    if (ps?.rotary) ps.rotary.rotation.z = this.mainPower ? Math.PI / 2 : 0;
  }

  #blank(id) { const L = this.LCD[id]; if (!L) return; const d = L.img.data; for (let i = 0; i < d.length; i += 4) d[i] = d[i + 1] = d[i + 2] = 0; L.dirty = [0, 0, L.cv.width, L.cv.height]; }

  // P4: 800x480 RGB565 LE. S3: panel 320x480 RGB565 BE, rotated back to 480x320 (AurenSim main.js)
  #onFrame(u8) {
    if (u8[0] !== 1) return;
    const id = ['p4', 's3g1', 's3g2'][u8[1]], L = this.LCD[id]; if (!L) return;
    const dv = new DataView(u8.buffer, u8.byteOffset + 2);
    const x = dv.getUint16(0, true), y = dv.getUint16(2, true), w = dv.getUint16(4, true), h = dv.getUint16(6, true);
    const px = new DataView(u8.buffer, u8.byteOffset + 10);
    const d = L.img.data, W = L.cv.width;
    let x0, y0, x1, y1;
    if (id === 'p4') {
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const v = px.getUint16((r * w + c) * 2, true), o = ((y + r) * W + (x + c)) * 4;
        d[o] = ((v >> 11) & 31) * 255 / 31; d[o + 1] = ((v >> 5) & 63) * 255 / 63; d[o + 2] = (v & 31) * 255 / 31;
      }
      x0 = x; y0 = y; x1 = x + w; y1 = y + h;
    } else {
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        const v = px.getUint16((r * w + c) * 2, false);
        const lx = y + r, ly = 319 - (x + c), o = (ly * W + lx) * 4;
        d[o] = ((v >> 11) & 31) * 255 / 31; d[o + 1] = ((v >> 5) & 63) * 255 / 63; d[o + 2] = (v & 31) * 255 / 31;
      }
      x0 = y; x1 = y + h; y0 = 320 - (x + w); y1 = 320 - x;
    }
    const D = L.dirty;
    L.dirty = D ? [Math.min(D[0], x0), Math.min(D[1], y0), Math.max(D[2], x1), Math.max(D[3], y1)] : [x0, y0, x1, y1];
  }

  #flush() {
    for (const [id, L] of Object.entries(this.LCD)) {
      if (!L.dirty) continue;
      const [x0, y0, x1, y1] = L.dirty; L.dirty = null;
      L.ctx.putImageData(L.img, 0, 0, x0, y0, x1 - x0, y1 - y0);
      this.R.lcd[id].tex.needsUpdate = true;
    }
  }

  /** Click on the machine (hit = raycast hit). Returns true when handled. */
  click(hit) {
    if (this.state === 'idle') { this.boot(); return true; }
    if (this.state !== 'running') { this.toast('AUREN-PRO 부팅 중…'); return true; }
    const u = hit.object.userData || {}, S = this.S;
    if (u.kind === 'lcd' && hit.uv) {
      const L = this.LCD[u.board]; if (!L) return true;
      const x = hit.uv.x * L.cv.width, y = (1 - hit.uv.y) * L.cv.height;
      this.send({ type: 'touch', board: u.board, p: 1, x, y });
      setTimeout(() => this.send({ type: 'touch', board: u.board, p: 0, x, y }), 120);
    } else if (u.kind === 'btn') {
      // firmware debounces 2 x 30 ms -> hold like a finger
      this.btnMask |= 1 << u.bit; this.send({ type: 'btn', mask: this.btnMask });
      hit.object.position.z = u.z0 - 0.0025;
      setTimeout(() => { this.btnMask &= ~(1 << u.bit); this.send({ type: 'btn', mask: this.btnMask }); hit.object.position.z = u.z0; }, 200);
    } else if (u.kind === 'power') this.send({ type: 'mainPower', on: !this.mainPower });
    else if (u.kind === 'knob' && S) this.send({ type: 'knob', i: u.i, v: S.knob[u.i] > 0.1 ? 0 : 0.7 });
    else if (u.kind === 'cup') this.send({ type: 'cmd', name: 'emptyCup', arg: u.which });
    else if (u.kind === 'portafilter') { this.send({ type: 'cmd', name: 'freshPuck', arg: u.g }); this.toast(`그룹${u.g + 1} 포터필터: 새 원두로 교체`); }
    else if (u.kind === 'pitcher') this.send({ type: 'cmd', name: 'newMilk', arg: u.i });
    else this.toast('AUREN-PRO — 그룹 버튼·LCD·스팀 노브·잔·포터필터를 클릭');
    return true;
  }

  update(dt) {
    if (!this.R) return;
    this.#flush();
    const S = this.S, R = this.R, DIM = this.A.DIM;
    if (S) {
      const A = S.act;
      for (const b of R.buttons) {
        const on = !!A.led[b.userData.bit], lm = b.userData.led || b.material, tgt = b.userData.led ? 2.2 : 0.9;
        lm.emissiveIntensity += ((on ? tgt : 0) - lm.emissiveIntensity) * Math.min(1, dt * 20);
        b.userData.icon.material.color.setScalar(on ? 1.0 : 0.45);
      }
      const needle = (n, v) => { if (!n) return; const a = 0.75 * Math.PI + 1.5 * Math.PI * Math.min(1.04, Math.max(0, v / n.max)); n.pivot.rotation.z += (-a - Math.PI / 2 - n.pivot.rotation.z) * Math.min(1, dt * 10); };
      needle(R.needles.pump, S.line.pGauge ?? S.line.pOut);
      needle(R.needles.boiler, S.steam.pres);
      R.knobs.forEach((k, i) => { const t = -S.knob[i] * Math.PI * 1.5; k.spin.rotation.z += (t - k.spin.rotation.z) * Math.min(1, dt * 15); });
      const setCup = (key, c, coffee) => {
        const cup = R.cups[key]; if (!cup) return; cup.group.visible = c.present;
        const f = Math.min(1, c.ml / c.cap), hh = Math.max(0.0001, f * cup.h * 0.95);
        cup.liq.visible = c.ml > 0.5; cup.liq.scale.y = hh; cup.liq.position.y = 0.008 + hh / 2;
        cup.liq.material.color.set(coffee ? 0x2a1408 : 0x8fb6cc); cup.liq.material.opacity = coffee ? 1 : 0.55; cup.liq.material.transparent = !coffee;
        cup.crema.visible = coffee && c.ml > 3; cup.crema.position.y = 0.008 + hh + 0.0003;
      };
      S.groups.forEach((g, i) => setCup(i, g.cup, g.puck.kind === 'coffee'));
      setCup('hw', S.hw.cup, false);
      S.pitcher.forEach((p, i) => { const pt = R.pitchers[i]; if (!pt) return; pt.group.visible = p.present; const h = Math.min(0.1, p.ml / 600 * 0.1 * (1 + p.foam * 0.3)); pt.milk.scale.y = Math.max(0.0001, h); pt.milk.position.y = 0.002 + h / 2; });
      S.groups.forEach((g, i) => { if (R.portafilters[i]) R.portafilters[i].visible = g.puck.kind !== 'none'; if (R.pucks) R.pucks[i].visible = g.puck.kind === 'coffee'; });
      if (R.dripWater) R.dripWater.position.y = DIM.trayY - 0.011 + Math.min(0.009, S.dripML / 1500 * 0.009);
      const lb = A.ledbar / 255;
      if (R.ledbar) { R.ledbar.mesh.material.emissiveIntensity = lb * 2.2; R.ledbar.light.intensity = lb * 9; }
    }
    this.FX.update(S, dt);
  }
}

// ======================================================================== AUREN M
export class BellaStation {
  constructor(building, it, toast) { Object.assign(this, { building, it, toast }); this.S = null; this.M = null; this.state = 'idle'; }

  async init() {
    const B = await import('./vendor/aurensim/bella/js/machine.js');
    const { buildEffects } = await import('./vendor/aurensim/bella/js/effects.js');
    this.DIM = B.DIM;
    const holder = new THREE.Group();
    const R = this.R = await B.buildMachine(holder);
    this.building.groups[this.it.lv.id].add(R.root);
    place(R.root, this.it);
    this.FX = buildEffects(R.root, R);
    this.oledPx = new Uint8Array(8192); this.oledDirty = true;
    this.btnDown = [0, 0, 0, 0]; this.btnT0 = [0, 0, 0, 0]; this.pfU = 1;
    this.#drawIdle();
    return this;
  }

  get root() { return this.R?.root; }
  send(m, tr) { this.worker?.postMessage(m, tr || []); }

  #drawIdle() {
    const g = this.R.oled.cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#fff'; g.font = 'bold 14px monospace'; g.textAlign = 'center'; g.fillText('AUREN M', 64, 26); g.font = '10px monospace'; g.fillText('CLICK TO BOOT', 64, 46);
    this.R.oled.tex.needsUpdate = true;
  }

  async boot() {
    if (this.state !== 'idle') return;
    this.state = 'booting';
    this.toast('AUREN M 펌웨어 부팅 중… (STM32F103 에뮬레이터)');
    try {
      this.worker = new Worker(new URL('./vendor/aurensim/bella/js/sim-worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this.#onMsg(e.data);
      const r = await fetch(`${BASE}equipment/auren/bella/fw/BellaOneMC.elf`);
      if (!r.ok) throw new Error(`firmware ${r.status}`);
      const buf = await r.arrayBuffer();
      this.send({ type: 'load', buf, name: 'BellaOneMC.elf' }, [buf]);
    } catch (e) { this.state = 'idle'; console.warn(e); this.toast(`AUREN M 부팅 실패: ${e.message}`); }
  }

  async #onMsg(m) {
    if (m.type === 'state') {
      this.S = m.plant; this.M = m.mcu;
      if (m.oled) { const p = m.oled; for (let i = 0; i < 8192; i++) this.oledPx[i] = (p[i >> 3] >> (i & 7)) & 1; this.oledDirty = true; }
      // fast-forward the cold boiler, then real time
      const hot = this.S.boiler.T >= 86;
      if (this.warmup && hot) { this.warmup = false; this.send({ type: 'speed', v: 1 }); this.toast('AUREN M 예열 완료 — Shot 버튼을 누르면 추출합니다'); }
    } else if (m.type === 'loaded') {
      this.state = 'running';
      await sleep(1200);
      for (let n = 0; n < 5; n++) {                          // Power (④, short press): firmware leaves standby
        this.#press(3);
        if (await this.#waitVar((v) => v.power_On_flag === 1, 1500)) break;
      }
      await this.enableHeating();
      this.warmup = true; this.send({ type: 'speed', v: 12 });
      this.toast('AUREN M 전원 ON — 보일러 예열 중(빠르게)…');
    } else if (m.type === 'error') this.toast(`AUREN M: ${m.msg}`);
  }

  /** Resolves when the firmware variables satisfy pred (or after timeout ms). */
  async #waitVar(pred, ms = 3000) {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { const v = this.M?.vars; if (v && pred(v)) return true; await sleep(60); }
    return false;
  }

  /**
   * The firmware's factory setting is "Water Heating = OFF". Turn it on the way the manual says, through the
   * machine's own menu: Settings (③) -> Water Heating -> Heater On -> Settings (save) -> Exit, checking the
   * firmware variables after each press (menu_select_step / selectedIndex / heater_off_flag).
   */
  async enableHeating() {
    const V = () => this.M?.vars || {};
    await sleep(1500);                                       // EEPROM settings are applied shortly after power-on
    if (V().heater_off_flag === 0) return;
    const tap = async (i) => { this.#press(i); await sleep(380); };
    await tap(2);
    if (!(await this.#waitVar((v) => v.menu_select_step === 2, 2500))) return;
    const target = 6;                                        // MENU index of "Water Heating"
    for (let n = 0; n < 12 && V().selectedIndex !== target; n++) {
      const before = V().selectedIndex;
      await tap(1);
      if (V().selectedIndex === before || ((V().selectedIndex - target + 9) % 9) > ((before - target + 9) % 9)) await tap(0);
    }
    if (V().selectedIndex !== target) return;
    await tap(2);                                            // edit Water Heating
    await this.#waitVar((v) => v.menu_select_step === 70, 2000);
    for (const i of [0, 1]) {                                // toggle to "Heater On" and save with Settings
      await tap(i); await tap(2);
      if (await this.#waitVar((v) => v.heater_off_flag === 0, 1500)) break;
      if (V().menu_select_step !== 70) { await tap(2); await this.#waitVar((v) => v.menu_select_step === 70, 1500); }
    }
    // leave the settings menu (Exit = last entry)
    for (let n = 0; n < 12 && V().menu_select_step !== 0; n++) {
      if (V().menu_select_step === 2 && V().selectedIndex === 8) { await tap(2); break; }
      await tap(1);
    }
    this.toast(V().heater_off_flag === 0 ? 'AUREN M 설정: Water Heating = Heater On' : 'AUREN M: Water Heating 설정을 확인하세요 (설정 ③)');
  }

  #press(i) {
    if (this.btnDown[i]) return;
    this.btnDown[i] = 1; this.send({ type: 'btn', i, down: true });
    setTimeout(() => { this.btnDown[i] = 0; this.send({ type: 'btn', i, down: false }); }, 160);   // debounce 20 ms -> hold like a finger
  }

  click(hit) {
    if (this.state === 'idle') { this.boot(); return true; }
    if (this.state !== 'running') { this.toast('AUREN M 부팅 중…'); return true; }
    const u = hit.object.userData || {};
    if (u.kind === 'btn') this.#press(u.i);
    else if (u.kind === 'mainSwitch') this.send({ type: 'cmd', name: 'mainSwitch', arg: !this.S?.mainSwitch });
    else if (u.kind === 'pf') { this.send({ type: 'cmd', name: 'freshPuck' }); this.toast('AUREN M 포터필터: 새 원두 담고 탬핑 → 체결'); }
    else if (u.kind === 'cup') this.send({ type: 'cmd', name: 'emptyCup' });
    else if (u.kind === 'bottle') this.send({ type: 'cmd', name: 'tankFill' });
    else this.toast('AUREN M — 버튼(Shot1 · Shot2 · Select · Power)·잔·포터필터를 클릭');
    return true;
  }

  #drawOled() {
    if (!this.oledDirty || !this.M) return; this.oledDirty = false;
    const M = this.M, on = M.powered && M.oledOn, lv = 0.55 + 0.45 * (M.contrast / 255);
    const octx = this.R.oled.cv.getContext('2d'), img = octx.createImageData(128, 64), d = img.data;
    const [r, g, b] = [225 * lv, 242 * lv, 255 * lv];
    for (let i = 0; i < 8192; i++) { const v = on && this.oledPx[i]; d[i * 4] = v ? r : 0; d[i * 4 + 1] = v ? g : 0; d[i * 4 + 2] = v ? b : 0; d[i * 4 + 3] = 255; }
    octx.putImageData(img, 0, 0); this.R.oled.tex.needsUpdate = true;
  }

  update(dt) {
    if (!this.R) return;
    this.#drawOled();
    const S = this.S, R = this.R, DIM = this.DIM;
    if (S) {
      R.buttons.forEach((b, i) => {
        const on = S.mainSwitch && S.out.led[i];
        b.ledMat.emissiveIntensity += ((on ? 3.2 : 0) - b.ledMat.emissiveIntensity) * Math.min(1, dt * 25);
        b.ledMat.color.set(on ? 0xbfe8ff : 0x223040);
        const z = this.btnDown[i] ? -0.0016 : 0; b.cap.position.z += (z - b.cap.position.z) * Math.min(1, dt * 30);
      });
      const th = Math.PI * 0.75 + Math.PI * 1.5 * Math.min(1.03, Math.max(0, S.line.Pg ?? S.line.P) / 16);
      R.needle.rotation.z += (-(th + Math.PI / 2) - R.needle.rotation.z) * Math.min(1, dt * 12);
      R.sw.rocker.rotation.x = S.mainSwitch ? -0.22 : 0.22;
      const want = S.pf.kind !== 'none' ? 1 : 0;
      this.pfU += Math.sign(want - this.pfU) * Math.min(Math.abs(want - this.pfU), dt * 1.6);
      const g = R.pf.group, u = this.pfU, turn = u > 0.5 ? (1 - u) * 2 : 1, drop = u > 0.5 ? 0 : (0.5 - u) * 2;
      g.visible = u > 0.01; g.rotation.y = -0.75 * turn;
      g.position.set(DIM.groupC.x, DIM.groupC.y - 0.055 * drop, DIM.groupC.z + 0.22 * drop * drop);
      R.pf.puck.material.color.set(S.pf.kind === 'blind' ? 0xd8dbe0 : S.pf.fresh ? 0x3a2414 : 0x22150c);
      const c = R.cup; c.group.visible = S.cup.present;
      const f = Math.min(1, S.cup.ml / S.p.cupCap), hh = Math.max(0.0002, f * c.liqH);
      c.liq.visible = S.cup.ml > 0.3; c.liq.scale.set(c.rIn, hh, c.rIn); c.liq.position.y = c.base + hh / 2;
      const coffeeFrac = S.cup.ml > 0 ? S.cup.coffee / S.cup.ml : 0;
      c.liq.material.color.set(coffeeFrac > 0.4 ? 0x2a1406 : 0xa9cde0); c.liq.material.transparent = coffeeFrac <= 0.4; c.liq.material.opacity = coffeeFrac > 0.4 ? 1 : 0.5;
      c.crema.visible = coffeeFrac > 0.4 && S.cup.ml > 8; c.crema.scale.setScalar(c.rIn - 0.0004); c.crema.position.y = c.base + hh + 0.0002;
      const bt = R.bottle, wf = Math.min(1, S.tank.ml / S.p.tankCap), wh = Math.max(0.0005, wf * (bt.h - 0.012));
      bt.water.visible = S.tank.ml > 5; bt.water.scale.y = wh; bt.water.position.y = 0.005 + wh / 2; bt.surf.position.y = 0.005 + wh; bt.surf.visible = bt.water.visible;
    }
    this.FX.update(S, dt, this.pfU > 0.98, false);
  }
}

/** Creates the live stations listed in building.json (equipment "auren-pro" / "auren-m"). */
export async function createAurenStations(building, toast) {
  const out = [];
  for (const lv of building.levels) for (const e of lv.equipment || []) {
    const it = { ...e, lv };
    try {
      if (e.model === 'auren-pro') out.push(await new AuraStation(building, it, toast).init());
      else if (e.model === 'auren-m') out.push(await new BellaStation(building, it, toast).init());
    } catch (err) { console.warn(`${e.model} failed`, err); }
  }
  return out;
}
