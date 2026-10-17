// runtime-web.js — 서버 없이 브라우저만으로 동작하는 AuraSim 런타임(웹 배포용)
//  - 펌웨어: 저장소 소스를 Emscripten 으로 빌드한 fw/aurasim_p4.js·aurasim_s3.js (WebAssembly, 태스크=Web Worker)
//  - 물리모델: server/physics.js 와 동일 코드(js/physics.js)
//  - server/index.js 와 같은 메시지(hello/state/log/bl/audio/power/boards + LCD 프레임)를 UI 에 전달한다.
// webKopoCTCSim: firmware + physics served from public/equipment/auren/aura
const AURA = `${import.meta.env.BASE_URL}equipment/auren/aura/`;
const T = { HELLO: 0x01, LOG: 0x02, HAL: 0x10, FB: 0x20, BL: 0x21, AUDIO: 0x22, TOUCH: 0x30, RS485: 0x40 };
const BIDX = { p4: 0, s3g1: 1, s3g2: 2 };
const OUT_MAX = 8 << 20;

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
}

class WasmBoard {
  constructor(rt, id, kind, label, args) { Object.assign(this, { rt, id, kind, label, args }); this.mod = null; this.connected = false; this.restarts = 0; this.logs = []; this.backlight = 100; this.running = false; }
  async start() {
    if (this.mod) return;
    this.running = true;
    const factory = { p4: window.AuraP4, p4k: window.AuraP4K, s3: window.AuraS3 }[this.kind];
    const script = `${AURA}fw/aurasim_${this.kind}.js?v=${FWV}`;
    this.log(`[web] 펌웨어(WASM) 부팅 — ${this.label}`);
    try {
      const mod = await factory({
        arguments: ['--id', this.id, ...this.args],
        locateFile: (f) => `${AURA}fw/${f}?v=${FWV}`, mainScriptUrlOrBlob: script,
        print: () => {}, printErr: () => {},
        onExit: (code) => this.onExit(code),
      });
      if (!this.running) { this.kill(mod); return; }
      this.mod = mod;
      this.outBuf = mod._malloc(OUT_MAX); this.inBuf = mod._malloc(256 << 10);
      this.connected = true;
      this.rt.emit({ type: 'power', board: this.id, on: true });
    } catch (e) { this.log('[web] ✖ 펌웨어 로드 실패: ' + e.message); this.running = false; }
  }
  kill(mod) { try { mod.PThread && mod.PThread.terminateAllThreads(); } catch (e) {} }
  stop() {
    this.running = false;
    if (this.mod) { this.kill(this.mod); this.mod = null; }
    this.connected = false;
    this.rt.emit({ type: 'power', board: this.id, on: false });
  }
  onExit(code) {
    const why = code === 3 ? '소프트 리셋(esp_restart)' : code === 2 ? 'abort' : `종료 코드 ${code}`;
    this.log(`[web] 보드 재부팅: ${why}`);
    const m = this.mod; this.mod = null; this.connected = false;
    this.rt.emit({ type: 'power', board: this.id, on: false });
    setTimeout(() => { if (m) this.kill(m); if (this.running) { this.restarts++; this.running = false; this.start(); } }, 300);
  }
  log(line) { this.logs.push(line); if (this.logs.length > 400) this.logs.shift(); this.rt.emit({ type: 'log', board: this.id, line }); }
  push(type, bytes) {
    const m = this.mod; if (!m || bytes.length > (256 << 10)) return;
    m.HEAPU8.set(bytes, this.inBuf);
    m._sim_in_push(type, this.inBuf, bytes.length);
  }
  poll() {
    const m = this.mod; if (!m) return;
    const n = m._sim_out_take(this.outBuf, OUT_MAX); if (!n) return;
    const buf = m.HEAPU8.slice(this.outBuf, this.outBuf + n);    // 공유 메모리 → 복사
    let o = 0;
    while (o + 5 <= n) {
      const type = buf[o], len = buf[o + 1] | (buf[o + 2] << 8) | (buf[o + 3] << 16) | (buf[o + 4] << 24);
      const pay = buf.subarray(o + 5, o + 5 + len); o += 5 + len;
      this.rt.onBoardFrame(this, type, pay);
    }
  }
  status() { return { id: this.id, kind: this.kind, label: this.label, mode: 'web', port: '', running: this.running, connected: this.connected, restarts: this.restarts, backlight: this.backlight }; }
}

let FWV = '';   // 펌웨어 버전(커밋) — 배포마다 URL 이 바뀌어 브라우저 캐시의 옛 펌웨어를 쓰지 않는다
export async function startWebRuntime({ onMessage, onFrame, model = 'aura' }) {
  const kerndu = model === 'kerndu';
  try { FWV = (await (await fetch(`${AURA}fw/build-info.json`, { cache: 'no-store' })).json()).commit || ''; } catch (e) {}
  if (!FWV) FWV = String(Date.now());
  await loadScript(`${AURA}js/physics.js?v=${FWV}`);
  await Promise.all(kerndu ? [loadScript(`${AURA}fw/aurasim_p4k.js?v=${FWV}`)]
                           : [loadScript(`${AURA}fw/aurasim_p4.js?v=${FWV}`), loadScript(`${AURA}fw/aurasim_s3.js?v=${FWV}`)]);
  const { AuraPlant, defaultParams } = window.AuraPhysics;
  const plant = new AuraPlant(); plant.model = model; plant.reset(true);
  let mainPower = true, btnMask = 0, lastSent = {}, paused = false;
  const busStats = { frames: 0, bytes: 0, collisions: 0 };
  const dec = new TextDecoder();

  const rt = {
    emit: (m) => onMessage(m),
    onBoardFrame(b, type, pay) {
      switch (type) {
        case T.LOG: b.log(dec.decode(pay)); break;
        case T.HAL: if (b.id === 'p4') { const k = plant.applyLine(dec.decode(pay)); if (k === 'RDY') { lastSent = {}; sendAllSensors(true); } } break;
        case T.FB: { const f = new Uint8Array(pay.length + 2); f[0] = 1; f[1] = BIDX[b.id]; f.set(pay, 2); onFrame(f); break; }
        case T.BL: b.backlight = pay[0]; onMessage({ type: 'bl', board: b.id, v: pay[0] }); break;
        case T.AUDIO: onMessage({ type: 'audio', board: b.id, ev: pay[0], vol: pay[1] }); break;
        case T.RS485: busWrite(b, pay.slice()); break;
      }
    },
  };
  const boards = kerndu ? { p4: new WasmBoard(rt, 'p4', 'p4k', 'P4 메인 4.3" (KERNDU)', []) } : {
    p4: new WasmBoard(rt, 'p4', 'p4', 'P4 메인 4.3"', []),
    s3g1: new WasmBoard(rt, 's3g1', 's3', 'S3 그룹1 3.5"', ['--gpio', '21=1']),
    s3g2: new WasmBoard(rt, 's3g2', 's3', 'S3 그룹2 3.5"', ['--gpio', '21=0']),
  };
  const boardStatus = () => Object.fromEntries(Object.entries(boards).map(([k, b]) => [k, b.status()]));

  /* RS-485 멀티드롭 버스(115200bps 바이트 시간 뒤 전달) */
  const txFree = new Map();
  function busWrite(src, data) {
    const now = performance.now(), dur = data.length * 10 / 115200 * 1000;
    const start = Math.max(now, txFree.get(src) || 0), end = start + dur; txFree.set(src, end);
    busStats.bytes += data.length; if (data[0] === 0x02) busStats.frames++;
    const deliver = () => { for (const n of Object.values(boards)) if (n !== src) n.push(T.RS485, data); };
    const w = end - now; if (w < 0.5) deliver(); else setTimeout(deliver, w);
  }

  /* 센서 → P4 (HAL 라인) */
  const enc = new TextEncoder();
  const hal = (line) => boards.p4.push(T.HAL, enc.encode(line));
  const sendIf = (k, line, force) => { if (force || lastSent[k] !== line) { lastSent[k] = line; hal(line); } };
  const fmtT = (v) => Number.isFinite(v) ? v.toFixed(2) : 'nan';
  function sendAllSensors(force) {
    for (let i = 0; i < 3; i++) hal(`TEMP ${i} ${fmtT(plant.sensorTemp(i))}`);
    for (let i = 0; i < 2; i++) hal(`AS ${i} ${fmtT(plant.sensorAS(i))}`);
    sendIf('lvl', `LVL ${plant.lvl.high ? 1 : 0} ${plant.lvl.low ? 1 : 0}`, force);
    for (let i = 0; i < 2; i++) sendIf('flow' + i, `FLOW ${i} ${plant.pulses[i]}`, force);
    for (let i = 0; i < 2; i++) hal(`PRES ${i} ${plant.g[i].presSensor.toFixed(2)}`);
    sendIf('btn', `BTN 0x${btnMask.toString(16).padStart(4, '0')}`, force);
  }
  function powerLoss() { plant.applyLine('ALLOFF'); plant.act.led.fill(0); plant.act.ledbar = 0; }

  /* 루프: 물리(5ms) + 센서 + 상태 + 보드 출력 폴링 */
  let last = performance.now(), tFast = 0, tSens = 0, tUi = 0;
  setInterval(() => {
    for (const b of Object.values(boards)) b.poll();
    const now = performance.now(); const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (paused) return;
    const n = Math.ceil(dt / 0.005); for (let i = 0; i < n; i++) plant.step(dt / n);
    tFast += dt; tSens += dt; tUi += dt;
    if (boards.p4.connected) {
      if (tFast >= 0.02) { tFast = 0; sendIf('lvl', `LVL ${plant.lvl.high ? 1 : 0} ${plant.lvl.low ? 1 : 0}`);
        for (let i = 0; i < 2; i++) sendIf('flow' + i, `FLOW ${i} ${plant.pulses[i]}`);
        for (let i = 0; i < 2; i++) sendIf('pres' + i, `PRES ${i} ${plant.g[i].presSensor.toFixed(2)}`); }
      if (tSens >= 0.1) { tSens = 0; sendAllSensors(false); }
    } else powerLoss();
    if (tUi >= 0.05) { tUi = 0; onMessage({ type: 'state', plant: plant.snapshot(), btn: btnMask, bus: busStats, paused, mainPower }); }
  }, 5);
  setInterval(() => onMessage({ type: 'boards', boards: boardStatus() }), 1000);

  async function setMainPower(on) {
    if (on === mainPower) return;
    mainPower = on;
    if (!on) { Object.values(boards).forEach(b => b.stop()); powerLoss(); }
    else for (const b of Object.values(boards)) await b.start();
    onMessage({ type: 'mainPower', on });
    onMessage({ type: 'boards', boards: boardStatus() });
  }

  onMessage({ type: 'hello', model, mainPower, params: plant.P, defaults: defaultParams(), boards: boardStatus(), logs: {} });
  for (const b of Object.values(boards)) b.start();          // 3개 보드 병렬 부팅

  return {
    send(m) {
      switch (m.type) {
        case 'btn': btnMask = m.mask & 0xFFF; sendIf('btn', `BTN 0x${btnMask.toString(16).padStart(4, '0')}`); break;
        case 'touch': { const b = boards[m.board]; if (!b) break; const d = new Uint8Array(5), x = Math.max(0, m.x | 0), y = Math.max(0, m.y | 0);
          d[0] = m.p ? 1 : 0; d[1] = x & 255; d[2] = x >> 8; d[3] = y & 255; d[4] = y >> 8; b.push(T.TOUCH, d); break; }
        case 'knob': plant.knob[m.i] = Math.max(0, Math.min(1, +m.v)); break;
        case 'mainPower': setMainPower(!!m.on); break;
        case 'plantReset': plant.reset(!!m.warm); lastSent = {}; break;
        case 'pause': paused = !!m.on; break;
        case 'param': plant.P[m.key] = m.value; onMessage({ type: 'params', params: plant.P }); break;
        case 'cmd':
          if (m.name === 'emptyCup') plant.emptyCup(m.arg);
          else if (m.name === 'toggleCup') { const c = m.arg === 'hw' ? plant.hw.cup : plant.g[m.arg].cup; c.present = !c.present; if (!c.present) c.ml = 0; }
          else if (m.name === 'freshPuck') plant.freshPuck(m.arg);
          else if (m.name === 'portafilter') { const pk = plant.g[m.arg.g].puck; pk.kind = m.arg.kind; pk.present = m.arg.kind !== 'none'; plant.freshPuck(m.arg.g); }
          else if (m.name === 'newMilk') plant.newMilk(m.arg);
          else if (m.name === 'togglePitcher') { const p = plant.pitcher[m.arg]; p.present = !p.present; if (p.present) plant.newMilk(m.arg); }
          else if (m.name === 'emptyDrip') plant.dripML = 0;
          break;
        case 'board': if (m.action === 'reset' && boards[m.id]) { boards[m.id].stop(); boards[m.id].start(); } break;
      }
    },
  };
}
