// sim-worker.js — Web Worker: STM32F103 에뮬레이터(실펌웨어) + 물리 모델을 실시간으로 함께 돌린다
//  메인 스레드 ⇄ 워커 메시지
//   in : {type:'load', buf, name, eeprom?} {type:'btn', i, down} {type:'cmd', name, arg} {type:'speed', v}
//        {type:'reset'} {type:'power', on} {type:'uart', text} {type:'eepromClear'}
//   out: {type:'state', ...} 약 30Hz, {type:'loaded', info} {type:'eeprom', page} {type:'error', msg}
import { STM32F103 } from './mcu/stm32f103.js';
import { parseFirmware } from './mcu/loader.js';
import { Plant, ntcVolt } from './plant.js';

const EE_PAGE = 0x0800FC00;
const BTN = [[1, 0], [1, 1], [0, 2], [0, 3]];      // Shot1 PB0, Shot2 PB1, Select PA2, Power PA3
let soc = null, fw = null, plant = new Plant(), speed = 1, running = false;
let simT = 0, wall0 = 0, sim0 = 0, perf = { mcps: 0, ratio: 0 };
let oledPx = new Uint8Array(8192), oledSent = -1;
let lastUart = 0, uartBuf = '';
let vars = {};
let powered = true;
const btnState = [0, 0, 0, 0];

function post(m, tr) { self.postMessage(m, tr || []); }

function setupSoc() {
  soc = new STM32F103();
  soc.onGpio = (port, odr) => plant.setGpio(port, odr);
  soc.onFlashWrite = (page) => { if (page === EE_PAGE) post({ type: 'eeprom', page: soc.flash.slice(EE_PAGE - 0x08000000, EE_PAGE - 0x08000000 + 1024) }); };
  soc.log = (s) => { uartBuf += `\n[SIM] ${s}\n`; };
  soc.onReset = (cause) => { if (cause & 0x20000000) uartBuf += '\n[SIM] ── IWDG 리셋 ──\n'; };
}

function load(buf, name, eeprom) {
  try {
    fw = parseFirmware(buf, name);
    if (!soc) setupSoc();
    soc.loadImage(fw.segments);
    const o = EE_PAGE - 0x08000000;
    if (eeprom && eeprom.length === 1024 && soc.flash.subarray(o, o + 1024).every(v => v === 0xFF)) soc.flash.set(eeprom, o);
    soc.powerOnReset();
    applyInputs();
    const pg = soc.flash.slice(o, o + 1024);
    post({ type: 'eeprom', page: pg.every(v => v === 0xFF) ? null : pg });
    simT = 0; sim0 = 0; wall0 = performance.now();
    running = true;
    const sym = (n) => fw.symbols.get(n);
    vars = {};
    for (const [k, t] of [['targetTemp', 'f'], ['currentTemp', 'f'], ['heaterOutput', 'f'], ['integral', 'f'], ['power_On_flag', 'u8'], ['menu_select_step', 'u8'],
      ['g1_ext_seq', 'u8'], ['g1_shot_time', 'u8'], ['g1_shot_set_time', 'u8'], ['heater_off_flag', 'u8'], ['selectedIndex', 'i32'], ['state', 'u8'],
      ['g1_clean_seq', 'u8'], ['g1_drain_seq', 'u8'], ['down_clean_time', 'u8'], ['uwTick', 'u32'], ['auto_power_off_time', 'u8'], ['key_long_down_flag', 'u8'],
      ['g1_phase', 'u8'], ['g1_brew_mode', 'u8'], ['g1_pump_duty', 'u8']]) {
      const s = sym(k); if (s) vars[k] = { a: s.addr, t };
    }
    const size = fw.segments.reduce((a, s) => a + s.data.length, 0);
    post({ type: 'loaded', info: { name, format: fw.format, size, symbols: fw.symbols.size, entry: soc.cpu.pc, vars: Object.keys(vars) } });
  } catch (e) { post({ type: 'error', msg: '펌웨어 로드 실패: ' + e.message }); }
}

function applyInputs() {
  if (!soc) return;
  BTN.forEach(([p, pin], i) => soc.setInput(p, pin, btnState[i] ? 0 : null));
}
function readVar(v) {
  const o = v.a - 0x20000000; if (o < 0 || o + 4 > soc.ram.length) return null;
  const dv = new DataView(soc.ram.buffer);
  switch (v.t) { case 'f': return dv.getFloat32(o, true); case 'u8': return soc.ram[o]; case 'i32': return dv.getInt32(o, true); case 'u32': return dv.getUint32(o, true); }
  return null;
}

/* ── 실시간 루프: 1ms 슬라이스로 MCU ↔ 물리 교차 실행 ── */
const SLICE = 0.002;
function loop() {
  const budget = 24;                                   // ms (메인 스레드 30Hz 와 맞춤)
  const t0 = performance.now();
  if (running && soc) {
    const target = sim0 + (t0 - wall0) / 1000 * speed;
    let ran = 0, c0 = soc.cpu.cycles;
    while (simT < target && performance.now() - t0 < budget) {
      soc.adcIn[0] = ntcVolt(plant.ntc.boiler);
      soc.adcIn[1] = ntcVolt(plant.ntc.pre);
      if (powered && plant.mainSwitch && !soc.cpu.halted) soc.run(soc.hclk * SLICE);
      plant.step(SLICE);
      simT += SLICE; ran += SLICE;
    }
    const wall = performance.now() - t0;
    // 따라가지 못하면 CPI 를 올려(코어만 느린 MCU — 주변장치 클럭·타이밍은 동일) 실시간 유지
    if (simT < target - 0.05) {
      soc.cpu.cpi = Math.min(48, soc.cpu.cpi * 1.15);
      if (target - simT > 1.0) { sim0 = simT; wall0 = performance.now(); }   // 너무 밀리면 기준 재설정
    } else if (wall < budget * 0.45 && soc.cpu.cpi > 1) soc.cpu.cpi = Math.max(1, soc.cpu.cpi / 1.05);
    perf.mcps = wall > 0 ? (soc.cpu.cycles - c0) / soc.cpu.cpi / wall / 1000 : 0;
    perf.ratio = ran / Math.max(1e-3, wall / 1000);
  }
  sendState();
  setTimeout(loop, Math.max(1, 33 - (performance.now() - t0)));
}

function sendState() {
  if (!soc) { post({ type: 'state', plant: plant.snapshot(), mcu: null }); return; }
  let oled = null;
  if (soc.oled.dirty || oledSent < 0) {
    soc.oled.render(oledPx);
    const packed = new Uint8Array(1024);
    for (let i = 0; i < 8192; i++) if (oledPx[i]) packed[i >> 3] |= 1 << (i & 7);
    oled = packed; soc.oled.dirty = false; oledSent = 1;
  }
  if (soc.uartOut) { uartBuf += soc.uartOut; soc.uartOut = ''; }
  const v = {}; for (const k in vars) v[k] = readVar(vars[k]);
  const mcu = {
    cycles: soc.cpu.cycles, pc: soc.cpu.pc, halted: soc.cpu.halted, cpi: soc.cpu.cpi, simT, speed, perf: { ...perf },
    hclk: soc.hclk, oledOn: soc.oled.on, contrast: soc.oled.contrast, vars: v, powered: powered && plant.mainSwitch,
    gpio: soc.gpio.map(g => g.ODR), iwdg: soc.iwdg.on,
  };
  const m = { type: 'state', plant: plant.snapshot(), mcu, oled, uart: uartBuf || null, events: plant.events.splice(0) };
  uartBuf = '';
  post(m, oled ? [oled.buffer] : []);
}

self.onmessage = (e) => {
  const m = e.data;
  switch (m.type) {
    case 'load': load(m.buf, m.name, m.eeprom); break;
    case 'btn': btnState[m.i] = m.down ? 1 : 0; applyInputs(); break;
    case 'cmd':
      if (m.name === 'mainSwitch') {
        const on = !!m.arg;
        if (on && !plant.mainSwitch && soc) { soc.powerOnReset(); applyInputs(); oledSent = -1; uartBuf += '\n[SIM] ── 메인 전원 ON (파워온 리셋) ──\n'; }
        if (!on && soc) { soc.oled.reset(); oledSent = -1; for (let p = 0; p < 3; p++) { soc.gpio[p].ODR = 0; } plant.setGpio(1, 0); plant.setGpio(0, 0x100); }
      }
      plant.cmd(m.name, m.arg); break;
    case 'speed': speed = Math.max(0.1, Math.min(50, +m.v)); sim0 = simT; wall0 = performance.now(); break;
    case 'reset': if (soc) { soc.resetCause = 0x04000000; soc.reset(); applyInputs(); oledSent = -1; uartBuf += '\n[SIM] ── NRST 리셋 ──\n'; } break;
    case 'uart': if (soc) for (const ch of m.text) soc.uartRx.push(ch.charCodeAt(0) & 0xFF); break;
    case 'eepromClear': if (soc) { soc.flash.fill(0xFF, EE_PAGE - 0x08000000, EE_PAGE - 0x08000000 + 1024); soc.resetCause = 0x04000000; soc.reset(); applyInputs(); post({ type: 'eeprom', page: null }); } break;
  }
};
loop();
