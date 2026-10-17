// stm32f103.js — STM32F103C8 SoC 모델 (Cortex-M3 코어 + BELLA ONE 펌웨어가 쓰는 주변장치)
//  RCC · FLASH(프로그램/페이지 소거 = EEPROM 에뮬레이션) · GPIOA/B/C · AFIO · TIM2 · ADC1 · I2C1(+SSD1306 OLED)
//  USART1 · IWDG · SysTick · NVIC · SCB · DBGMCU.  레지스터 정의는 RM0008 / PM0056 기준.
//  시간: CPU 사이클(HCLK) 기반 이벤트 스케줄러. I2C/UART/ADC/플래시 동작 시간은 CPU 정지(stall)로 반영.
'use strict';
import { CortexM3 } from './cm3.js';

const FLASH_SIZE = 128 * 1024, RAM_SIZE = 20 * 1024;
const HSI = 8e6, HSE = 8e6, LSI = 40e3;

/* ───────── SSD1306 128x64 (I2C) ───────── */
export class SSD1306 {
  constructor() { this.ram = new Uint8Array(128 * 8); this.reset(); }
  reset() {
    this.ram.fill(0); this.on = false; this.invert = false; this.allOn = false; this.contrast = 0x7F;
    this.mode = 2; this.col = 0; this.page = 0; this.c0 = 0; this.c1 = 127; this.p0 = 0; this.p1 = 7;
    this.remap = false; this.comRev = false; this.startLine = 0; this.offset = 0; this.mux = 63; this.chargePump = false;
    this.cmd = []; this.need = 0; this.ctrl = -1; this.co = 0; this.dc = 0;
    this.frames = 0; this.dirty = true;
  }
  start() { this.ctrl = -1; }               // 주소 뒤 첫 바이트 = 제어 바이트
  stop() { this.ctrl = -1; }
  byte(b) {
    if (this.ctrl < 0 || this.co) {          // 제어 바이트
      this.ctrl = b; this.co = (b >> 7) & 1; this.dc = (b >> 6) & 1;
      if (this.co) this.co = 2;              // 다음 1바이트만 해당
      return;
    }
    if (this.co === 2) this.co = 1;
    if (this.dc) this.data(b); else this.command(b);
  }
  data(b) {
    this.ram[this.page * 128 + this.col] = b; this.dirty = true;
    if (this.mode === 2) { if (this.col < 127) this.col++; }
    else if (this.mode === 0) {               // 수평
      if (++this.col > this.c1) { this.col = this.c0; if (++this.page > this.p1) this.page = this.p0; }
    } else {                                  // 수직
      if (++this.page > this.p1) { this.page = this.p0; if (++this.col > this.c1) this.col = this.c0; }
    }
  }
  command(b) {
    if (this.need) { this.cmd.push(b); if (--this.need === 0) this.exec(this.cmd); return; }
    const n = { 0x81: 1, 0x20: 1, 0x21: 2, 0x22: 2, 0xA8: 1, 0xD3: 1, 0xD5: 1, 0xD9: 1, 0xDA: 1, 0xDB: 1, 0x8D: 1,
      0x26: 6, 0x27: 6, 0x29: 5, 0x2A: 5, 0xA3: 2 }[b] || 0;
    this.cmd = [b]; this.need = n;
    if (!n) this.exec(this.cmd);
  }
  exec(c) {
    const b = c[0]; this.dirty = true;
    if (b <= 0x0F) { this.col = (this.col & 0xF0) | b; return; }
    if (b <= 0x1F) { this.col = (this.col & 0x0F) | ((b & 0x0F) << 4); return; }
    if (b >= 0x40 && b <= 0x7F) { this.startLine = b & 0x3F; return; }
    if (b >= 0xB0 && b <= 0xB7) { this.page = b & 7; return; }
    switch (b) {
      case 0x20: this.mode = c[1] & 3; break;
      case 0x21: this.c0 = c[1] & 127; this.c1 = c[2] & 127; this.col = this.c0; break;
      case 0x22: this.p0 = c[1] & 7; this.p1 = c[2] & 7; this.page = this.p0; break;
      case 0x81: this.contrast = c[1]; break;
      case 0xA0: this.remap = false; break; case 0xA1: this.remap = true; break;
      case 0xA4: this.allOn = false; break; case 0xA5: this.allOn = true; break;
      case 0xA6: this.invert = false; break; case 0xA7: this.invert = true; break;
      case 0xA8: this.mux = c[1] & 63; break;
      case 0xAE: this.on = false; break; case 0xAF: this.on = true; break;
      case 0xC0: this.comRev = false; break; case 0xC8: this.comRev = true; break;
      case 0xD3: this.offset = c[1] & 63; break;
      case 0x8D: this.chargePump = !!(c[1] & 4); break;
    }
  }
  /** 화면 그대로(사람이 보는 방향) 128x64 픽셀 0/1 */
  render(out) {
    for (let y = 0; y < 64; y++) {
      const row = this.comRev ? y : 63 - y;                    // C8: COM 역방향 → 위쪽이 0페이지
      const ry = (row + this.startLine + this.offset) & 63;
      const visible = row <= this.mux;
      for (let x = 0; x < 128; x++) {
        const col = this.remap ? x : 127 - x;
        let v = (this.ram[(ry >> 3) * 128 + col] >> (ry & 7)) & 1;
        if (this.allOn) v = 1;
        if (this.invert) v ^= 1;
        out[y * 128 + x] = this.on && visible ? v : 0;
      }
    }
    return out;
  }
}

/* ───────── SoC ───────── */
export class STM32F103 {
  constructor() {
    this.flash = new Uint8Array(FLASH_SIZE).fill(0xFF);
    this.flash16 = new Uint16Array(this.flash.buffer); this.flash32 = new Uint32Array(this.flash.buffer);
    this.ram = new Uint8Array(RAM_SIZE);
    this.ram16 = new Uint16Array(this.ram.buffer); this.ram32 = new Uint32Array(this.ram.buffer);
    this.oled = new SSD1306();
    this.ext = [{ mask: 0, val: 0 }, { mask: 0, val: 0 }, { mask: 0, val: 0 }];   // 외부에서 구동하는 입력 핀(버튼)
    this.adcIn = new Float32Array(18);           // 채널별 입력 전압(V)
    this.adcIn[16] = 1.43 - 0.0043 * 2;          // 온도센서(≈25℃) / Vrefint
    this.adcIn[17] = 1.2;
    this.uartOut = '';                           // USART1 TX 누적(호스트가 가져감)
    this.uartRx = [];
    this.onGpio = null;                          // (port, odr) 출력 변화 콜백
    this.onFlashWrite = null;                    // (pageAddr) 플래시 페이지 변경 콜백(EEPROM 저장)
    this.onReset = null;
    this.log = (s) => {};
    this.cpu = new CortexM3(this);
    this.powerOnReset();
  }

  loadImage(segments) {        // [{addr, data:Uint8Array}] — 플래시 영역만
    this.flash.fill(0xFF);
    for (const s of segments) {
      let a = s.addr >>> 0; if (a < FLASH_SIZE) a += 0x08000000;
      if (a < 0x08000000 || a >= 0x08000000 + FLASH_SIZE) continue;
      this.flash.set(s.data.subarray(0, Math.min(s.data.length, 0x08000000 + FLASH_SIZE - a)), a - 0x08000000);
    }
  }

  powerOnReset() { this.ram.fill(0); this.resetCause = 0x0C000000; this.reset(); }   // PORRSTF|PINRSTF
  reset() {
    this.regs = new Map();
    this.rcc = { CR: 0x00000083, CFGR: 0, CIR: 0, APB2RSTR: 0, APB1RSTR: 0, AHBENR: 0x14, APB2ENR: 0, APB1ENR: 0, BDCR: 0, CSR: this.resetCause };
    this.fl = { ACR: 0x30, SR: 0, CR: 0x80, AR: 0, keyStage: 0, optKey: 0 };
    this.gpio = [0, 1, 2].map(() => ({ CRL: 0x44444444, CRH: 0x44444444, ODR: 0, LCKR: 0 }));
    this.afio = { EVCR: 0, MAPR: 0, EXTICR: [0, 0, 0, 0] };
    this.tim2 = { CR1: 0, CR2: 0, SMCR: 0, DIER: 0, SR: 0, CNT: 0, PSC: 0, ARR: 0xFFFF, pscS: 0, arrS: 0xFFFF, base: 0, next: Infinity, other: new Map() };
    this.adc = { SR: 0, CR1: 0, CR2: 0, SMPR1: 0, SMPR2: 0, SQR1: 0, SQR2: 0, SQR3: 0, DR: 0, other: new Map() };
    this.i2c = { CR1: 0, CR2: 0, OAR1: 0, OAR2: 0, CCR: 0, TRISE: 2, SR1: 0, SR2: 0, state: 'idle', dev: null, srRead: false };
    this.usart = { SR: 0xC0, BRR: 0, CR1: 0, CR2: 0, CR3: 0, GTPR: 0 };
    this.iwdg = { PR: 0, RLR: 0xFFF, on: false, unlock: false, next: Infinity };
    this.systick = { CTRL: 0, LOAD: 0, base: 0, next: Infinity, flag: 0 };
    this.scb = { AIRCR: 0xFA050000, SCR: 0, CCR: 0x200, SHPR: [0, 0, 0], SHCSR: 0, ICSR: 0 };
    this.oled.reset();
    this.cpu.reset();
    this.cycleBase = 0;
    this.lastGpio = [-1, -1, -1];
    for (let p = 0; p < 3; p++) this.gpioChanged(p);
    if (this.onReset) this.onReset(this.resetCause);
    this.resetCause = 0;
  }

  /* ── 클럭 ── */
  get sysclk() {
    const sws = (this.rcc.CFGR >> 2) & 3;
    if (sws === 1) return HSE;
    if (sws === 2) {
      const mul = Math.min(16, ((this.rcc.CFGR >> 18) & 15) + 2);
      const src = (this.rcc.CFGR >> 16) & 1 ? HSE / (((this.rcc.CFGR >> 17) & 1) ? 2 : 1) : HSI / 2;
      return src * mul;
    }
    return HSI;
  }
  get hclk() { const h = (this.rcc.CFGR >> 4) & 15; return this.sysclk / (h < 8 ? 1 : [2, 4, 8, 16, 64, 128, 256, 512][h - 8]); }
  apbDiv(p) { const v = (this.rcc.CFGR >> (p === 1 ? 8 : 11)) & 7; return v < 4 ? 1 : [2, 4, 8, 16][v - 4]; }
  timClk(apb) { const d = this.apbDiv(apb); return this.hclk / d * (d === 1 ? 1 : 2); }
  get adcClk() { return this.hclk / this.apbDiv(2) / [2, 4, 6, 8][(this.rcc.CFGR >> 14) & 3]; }

  stall(cycles) { this.cpu.cycles += Math.max(0, Math.round(cycles)); }
  reschedule() { this.cpu.until = Math.min(this.cpu.until, this.nextEvent()); }
  nextEvent() { return Math.min(this.systick.next, this.tim2.next, this.iwdg.next); }

  /** 사이클 목표까지 실행(이벤트 처리 포함) */
  run(cycles) {
    const cpu = this.cpu, end = cpu.cycles + cycles;
    while (cpu.cycles < end && !cpu.halted) {
      cpu.until = Math.min(end, this.nextEvent());
      cpu.runLoop();
      if (this.pendingReset) { this.pendingReset = false; this.reset(); continue; }
      this.service();
    }
  }
  service() {
    const now = this.cpu.cycles;
    const st = this.systick;
    if (now >= st.next) {
      const per = this.stPeriod();
      const n = Math.floor((now - st.next) / per) + 1;
      st.base = st.next + (n - 1) * per; st.next = st.base + per; st.flag = 1;
      if (st.CTRL & 2) this.cpu.setPending(15);
    }
    const t = this.tim2;
    if (now >= t.next) {
      const per = this.timPeriod();
      const n = Math.floor((now - t.next) / per) + 1;
      t.base = t.next + (n - 1) * per; t.next = t.base + per;
      t.pscS = t.PSC; t.arrS = t.ARR;
      t.SR |= 1;
      if (t.DIER & 1) this.cpu.setPending(16 + 28);
      t.next = t.base + this.timPeriod();
    }
    if (now >= this.iwdg.next) {
      this.log('⚠ IWDG 워치독 리셋');
      this.resetCause = 0x24000000;             // IWDGRSTF|PINRSTF
      this.reset();
    }
  }

  /* ── SysTick ── */
  stPeriod() { return ((this.systick.LOAD & 0xFFFFFF) + 1) * ((this.systick.CTRL & 4) ? 1 : 8); }
  stArm() {
    const st = this.systick;
    if ((st.CTRL & 1) && st.LOAD) { st.base = this.cpu.cycles; st.next = st.base + this.stPeriod(); } else st.next = Infinity;
    this.reschedule();
  }
  /* ── TIM2 ── */
  timPeriod() { const t = this.tim2; return Math.max(1, Math.round((t.pscS + 1) * (t.arrS + 1) * this.hclk / this.timClk(1))); }
  timArm() {
    const t = this.tim2;
    if (t.CR1 & 1) { t.base = this.cpu.cycles - Math.round(t.CNT * (t.pscS + 1) * this.hclk / this.timClk(1)); t.next = t.base + this.timPeriod(); }
    else t.next = Infinity;
    this.reschedule();
  }
  timCnt() {
    const t = this.tim2;
    if (!(t.CR1 & 1)) return t.CNT;
    return Math.floor((this.cpu.cycles - t.base) * this.timClk(1) / this.hclk / (t.pscS + 1)) % (t.arrS + 1);
  }
  /* ── IWDG ── */
  iwdgReload() {
    const w = this.iwdg; if (!w.on) return;
    const div = 4 << Math.min(6, w.PR & 7);
    w.next = this.cpu.cycles + Math.round(((w.RLR & 0xFFF) + 1) * div / LSI * this.hclk);
    this.reschedule();
  }

  /* ── GPIO ── */
  pinMode(p, pin) { const g = this.gpio[p]; const c = pin < 8 ? g.CRL >>> (pin * 4) : g.CRH >>> ((pin - 8) * 4); return c & 15; }
  idr(p) {
    const g = this.gpio[p], e = this.ext[p];
    let v = 0;
    for (let pin = 0; pin < 16; pin++) {
      const m = this.pinMode(p, pin), bit = 1 << pin;
      let lv;
      if (m & 3) lv = (g.ODR & bit) ? 1 : 0;                      // 출력
      else if (e.mask & bit) lv = (e.val & bit) ? 1 : 0;          // 외부 구동
      else if ((m >> 2) === 2) lv = (g.ODR & bit) ? 1 : 0;        // 풀업/풀다운
      else lv = (m >> 2) === 1 ? 1 : 0;                           // 플로팅(테스트 편의상 1) / 아날로그 0
      v |= lv << pin;
    }
    return v;
  }
  gpioChanged(p) {
    const v = this.gpio[p].ODR;
    if (v !== this.lastGpio[p]) { this.lastGpio[p] = v; if (this.onGpio) this.onGpio(p, v, this.cpu.cycles); }
  }
  /** 외부 입력(버튼): level=0 → GND 로 당김, null → 해제 */
  setInput(p, pin, level) {
    const e = this.ext[p], bit = 1 << pin;
    if (level === null) e.mask &= ~bit; else { e.mask |= bit; if (level) e.val |= bit; else e.val &= ~bit; }
  }

  /* ── FLASH 프로그램/소거 ── */
  flashWrite(a, size, v) {
    const f = this.fl, o = (a >>> 0) - 0x08000000;
    if (o < 0 || o >= FLASH_SIZE) return;
    if (f.CR & 0x80) { f.SR |= 0x10; return; }                     // LOCK → WRPRTERR
    if (!(f.CR & 1)) { f.SR |= 0x04; return; }                     // PG 아님 → PGERR
    if (size !== 2) { f.SR |= 0x04; return; }
    const cur = this.flash16[o >> 1];
    if (cur !== 0xFFFF && v !== 0) { f.SR |= 0x04; return; }        // 지우지 않은 곳에 쓰기
    this.flash16[o >> 1] = v; f.SR |= 0x20;                         // EOP
    this.stall(60e-6 * this.hclk);
    this.flashDirty(o & ~1023);
  }
  flashDirty(page) { if (this.onFlashWrite) this.onFlashWrite(0x08000000 + page); }
  flashCtrl(v) {
    const f = this.fl;
    if (f.CR & 0x80) { if (v & 0x80) f.CR |= 0x80; return; }      // 잠긴 동안은 LOCK 만
    f.CR = v & 0x3FF7;
    if (v & 0x40) {                                                  // STRT
      f.CR &= ~0x40;
      if (v & 2) { const o = ((f.AR >>> 0) - 0x08000000) & ~1023; if (o >= 0 && o < FLASH_SIZE) { this.flash.fill(0xFF, o, o + 1024); this.flashDirty(o); } f.SR |= 0x20; this.stall(20e-3 * this.hclk); }
      if (v & 4) { this.flash.fill(0xFF); f.SR |= 0x20; }
    }
  }

  /* ── I2C1 ── */
  i2cRead(off) {
    const s = this.i2c;
    switch (off) {
      case 0x00: return s.CR1; case 0x04: return s.CR2; case 0x08: return s.OAR1; case 0x0C: return s.OAR2;
      case 0x10: return 0;
      case 0x14: {
        let v = s.SR1 & ~0x84;
        if (s.state === 'tx' && !(s.SR1 & 2)) v |= 0x84;            // TXE|BTF
        s.srRead = true; return v; }
      case 0x18: {
        if (s.srRead && (s.SR1 & 2)) s.SR1 &= ~2;                    // SR1→SR2 읽기로 ADDR 클리어
        s.srRead = false;
        return s.state === 'idle' ? 0 : (1 | 2 | (s.state === 'tx' ? 4 : 0)); }
      case 0x1C: return s.CCR; case 0x20: return s.TRISE;
    }
    return 0;
  }
  i2cWrite(off, v) {
    const s = this.i2c, byteT = 9 / 200e3 * this.hclk;
    switch (off) {
      case 0x00:
        if (v & 0x8000) { s.CR1 = v; s.state = 'idle'; s.SR1 = 0; return; }   // SWRST
        s.CR1 = v & ~0x0300;
        if (v & 0x100) { s.SR1 = (s.SR1 & ~0x400) | 1; s.state = 'addr'; s.srRead = false; }   // START → SB
        if (v & 0x200) { if (s.dev) s.dev.stop(); s.dev = null; s.state = 'idle'; s.SR1 &= ~0x07; }   // STOP
        return;
      case 0x04: s.CR2 = v; return; case 0x08: s.OAR1 = v; return; case 0x0C: s.OAR2 = v; return;
      case 0x10:
        if (s.state === 'addr' && (s.SR1 & 1)) {
          s.SR1 &= ~1;
          this.stall(byteT);
          if ((v >> 1) === 0x3C && !(v & 1)) { s.dev = this.oled; s.dev.start(); s.SR1 |= 2; s.state = 'tx'; }
          else { s.SR1 |= 0x400; s.state = 'nack'; }                 // AF
        } else if (s.state === 'tx' && s.dev) { s.dev.byte(v & 0xFF); this.stall(byteT); }
        return;
      case 0x14: s.SR1 &= (v | ~0xDF00); return;                     // rc_w0 오류 플래그
      case 0x1C: s.CCR = v; return; case 0x20: s.TRISE = v; return;
    }
  }

  /* ── ADC1 ── */
  adcConvert() {
    const a = this.adc, ch = a.SQR3 & 0x1F;
    const vin = Math.max(0, Math.min(3.3, this.adcIn[ch] || 0));
    const noise = (Math.random() - 0.5) * 3;
    a.DR = Math.max(0, Math.min(4095, Math.round(vin / 3.3 * 4095 + noise)));
    if (a.CR2 & 0x800) a.DR = (a.DR << 4) & 0xFFFF;
    a.SR |= 0x12;                                                     // STRT|EOC
    const smp = [1.5, 7.5, 13.5, 28.5, 41.5, 55.5, 71.5, 239.5][ch < 10 ? (a.SMPR2 >> (ch * 3)) & 7 : (a.SMPR1 >> ((ch - 10) * 3)) & 7];
    this.stall((smp + 12.5) / this.adcClk * this.hclk);
  }
  adcWrite(off, v) {
    const a = this.adc;
    switch (off) {
      case 0x00: a.SR &= v; return;
      case 0x04: a.CR1 = v; return;
      case 0x08: {
        const was = a.CR2 & 1;
        a.CR2 = v & ~(0x400000 | 0x0C);                                // SWSTART/CAL/RSTCAL 은 즉시 완료
        if ((v & 0x400000) && (v & 1)) this.adcConvert();
        else if (was && (v & 1) && !(v & 0x400000) && (v & 0x100000) === 0) this.adcConvert();   // ADON 재설정 = 변환 시작
        if (v & 4) this.stall(83 / this.adcClk * this.hclk);
        return; }
      case 0x0C: a.SMPR1 = v; return; case 0x10: a.SMPR2 = v; return;
      case 0x2C: a.SQR1 = v; return; case 0x30: a.SQR2 = v; return; case 0x34: a.SQR3 = v; return;
    }
    a.other.set(off, v);
  }
  adcRead(off) {
    const a = this.adc;
    switch (off) {
      case 0x00: return a.SR; case 0x04: return a.CR1; case 0x08: return a.CR2;
      case 0x0C: return a.SMPR1; case 0x10: return a.SMPR2; case 0x2C: return a.SQR1; case 0x30: return a.SQR2; case 0x34: return a.SQR3;
      case 0x4C: a.SR &= ~0x02; return a.DR;
    }
    return a.other.get(off) || 0;
  }

  /* ───────────── 버스 ───────────── */
  read(a, size) {
    a >>>= 0;
    // 비트밴드 별칭
    if (a >= 0x22000000 && a < 0x22100000) { const o = (a - 0x22000000) >> 5, b = ((a - 0x22000000) >> 2) & 7; return (this.ram[o] >> b) & 1; }
    if (a >= 0x42000000 && a < 0x44000000) { const w = 0x40000000 + (((a - 0x42000000) >> 5) & ~3), b = ((a - 0x42000000) >> 2) & 31; return (this.read(w, 4) >>> b) & 1; }
    const w = this.read32(a & ~3);
    const sh = (a & 3) * 8;
    if (size === 4) return w;
    return size === 2 ? (w >>> sh) & 0xFFFF : (w >>> sh) & 0xFF;
  }
  write(a, size, v) {
    a >>>= 0;
    if (a >= 0x22000000 && a < 0x22100000) { const o = (a - 0x22000000) >> 5, b = ((a - 0x22000000) >> 2) & 7; if (v & 1) this.ram[o] |= 1 << b; else this.ram[o] &= ~(1 << b); return; }
    if (a >= 0x42000000 && a < 0x44000000) {
      const w = 0x40000000 + (((a - 0x42000000) >> 5) & ~3), b = ((a - 0x42000000) >> 2) & 31;
      const cur = this.read32(w); this.write32(w, (v & 1) ? (cur | (1 << b)) >>> 0 : (cur & ~(1 << b)) >>> 0); return;
    }
    if (a >= 0x08000000 && a < 0x08000000 + FLASH_SIZE) { this.flashWrite(a, size, v); return; }
    if (size === 4) { this.write32(a, v); return; }
    // 8/16비트 주변장치 쓰기: 대부분 16비트 레지스터 → 해당 바이트 레인만 반영
    const al = a & ~3, sh = (a & 3) * 8, mask = (size === 2 ? 0xFFFF : 0xFF) << sh;
    if ((a >= 0x40000000 && a < 0x40030000) && (al === 0x40005410 || al === 0x40013804)) { this.write32(al, v); return; }   // DR 은 값 그대로
    const cur = this.read32NoSide(al);
    this.write32(al, ((cur & ~mask) | ((v << sh) & mask)) >>> 0);
  }
  read32NoSide(a) {
    if (a === 0x40005414 || a === 0x40005418 || a === 0x4001244C || a === 0xE000E010) return 0;
    return this.read32(a);
  }

  read32(a) {
    if (a >= 0xE0000000) return this.ppbRead(a);
    if (a >= 0x40021000 && a < 0x40021400) { const k = ['CR', 'CFGR', 'CIR', 'APB2RSTR', 'APB1RSTR', 'AHBENR', 'APB2ENR', 'APB1ENR', 'BDCR', 'CSR'][(a - 0x40021000) >> 2]; return k ? this.rcc[k] >>> 0 : 0; }
    if (a >= 0x40010800 && a < 0x40011400) {
      const p = (a - 0x40010800) >> 10, off = a & 0x3FF, g = this.gpio[p];
      switch (off) { case 0: return g.CRL >>> 0; case 4: return g.CRH >>> 0; case 8: return this.idr(p); case 0xC: return g.ODR; case 0x18: return g.LCKR; }
      return 0;
    }
    if (a >= 0x40022000 && a < 0x40022400) {
      const f = this.fl;
      switch (a & 0xFF) { case 0: return f.ACR; case 0x0C: return f.SR; case 0x10: return f.CR; case 0x14: return f.AR; case 0x1C: return 0x03FFFFFC; case 0x20: return 0xFFFFFFFF; }
      return 0;
    }
    if (a >= 0x40000000 && a < 0x40000400) {
      const t = this.tim2;
      switch (a & 0xFF) {
        case 0x00: return t.CR1; case 0x04: return t.CR2; case 0x08: return t.SMCR; case 0x0C: return t.DIER; case 0x10: return t.SR;
        case 0x24: return this.timCnt(); case 0x28: return t.PSC; case 0x2C: return t.ARR;
      }
      return t.other.get(a & 0xFF) || 0;
    }
    if (a >= 0x40012400 && a < 0x40012800) return this.adcRead(a & 0xFF) >>> 0;
    if (a >= 0x40005400 && a < 0x40005800) return this.i2cRead(a & 0xFF);
    if (a >= 0x40013800 && a < 0x40013C00) {
      const u = this.usart;
      switch (a & 0xFF) {
        case 0x00: return 0xC0 | (this.uartRx.length ? 0x20 : 0);
        case 0x04: return this.uartRx.length ? this.uartRx.shift() : 0;
        case 0x08: return u.BRR; case 0x0C: return u.CR1; case 0x10: return u.CR2; case 0x14: return u.CR3; case 0x18: return u.GTPR;
      }
      return 0;
    }
    if (a >= 0x40003000 && a < 0x40003400) { const w = this.iwdg; switch (a & 0xFF) { case 4: return w.PR; case 8: return w.RLR; case 0xC: return 0; } return 0; }
    if (a >= 0x40010000 && a < 0x40010400) { const f = this.afio; if ((a & 0xFF) === 0) return f.EVCR; if ((a & 0xFF) === 4) return f.MAPR & ~0x07000000; if ((a & 0xFF) >= 8 && (a & 0xFF) < 0x18) return f.EXTICR[((a & 0xFF) - 8) >> 2]; return 0; }
    if (a === 0x1FFFF7E0) return 0xFFFF0040;                          // F_SIZE = 64KB
    if (a >= 0x1FFFF7E8 && a < 0x1FFFF7F4) return [0x0B5A1A32, 0x31303437, 0x4E330134][(a - 0x1FFFF7E8) >> 2];   // UID
    if (a === 0xE0042000) return 0x20036410;
    return this.regs.get(a) || 0;
  }
  write32(a, v) {
    v >>>= 0;
    if (a >= 0xE0000000) { this.ppbWrite(a, v); return; }
    if (a >= 0x40021000 && a < 0x40021400) {
      const r = this.rcc, off = (a - 0x40021000) >> 2;
      switch (off) {
        case 0: { const before = this.hclk; r.CR = (v & 0x010D00F9) | 0x0000FF00 & r.CR;   // HSI/HSE/PLL ON → RDY 즉시
          if (v & 1) r.CR |= 2; if (v & 0x10000) r.CR |= 0x20000; if (v & 0x1000000) r.CR |= 0x2000000; void before; return; }
        case 1: { const sw = v & 3; r.CFGR = (v & ~0xC) | (sw << 2); this.clockChanged(); return; }
        case 2: r.CIR = v & 0x1F00; return;
        case 3: r.APB2RSTR = v; return; case 4: r.APB1RSTR = v; return;
        case 5: r.AHBENR = v; return; case 6: r.APB2ENR = v; return; case 7: r.APB1ENR = v; return;
        case 8: r.BDCR = v; return;
        case 9: { let f = r.CSR & 0xFE000000; if (v & 0x01000000) f = 0; r.CSR = f | ((v & 1) ? 3 : 0); return; }
      }
      return;
    }
    if (a >= 0x40010800 && a < 0x40011400) {
      const p = (a - 0x40010800) >> 10, off = a & 0x3FF, g = this.gpio[p];
      switch (off) {
        case 0: g.CRL = v; break; case 4: g.CRH = v; break;
        case 0xC: g.ODR = v & 0xFFFF; break;
        case 0x10: g.ODR = (g.ODR | (v & 0xFFFF)) & ~(v >>> 16) & 0xFFFF; break;
        case 0x14: g.ODR &= ~v & 0xFFFF; break;
        case 0x18: g.LCKR = v; break;
      }
      this.gpioChanged(p); return;
    }
    if (a >= 0x40022000 && a < 0x40022400) {
      const f = this.fl;
      switch (a & 0xFF) {
        case 0x00: f.ACR = v & 0x1F; return;
        case 0x04: if (f.keyStage === 0 && v === 0x45670123) f.keyStage = 1; else if (f.keyStage === 1 && v === 0xCDEF89AB) { f.CR &= ~0x80; f.keyStage = 0; } else { f.keyStage = 0; f.CR |= 0x80; } return;
        case 0x08: return;
        case 0x0C: f.SR &= ~(v & 0x34); return;
        case 0x10: this.flashCtrl(v); return;
        case 0x14: f.AR = v; return;
      }
      return;
    }
    if (a >= 0x40000000 && a < 0x40000400) {
      const t = this.tim2;
      switch (a & 0xFF) {
        case 0x00: { const cnt = this.timCnt(); t.CR1 = v & 0x3FF; t.CNT = cnt; this.timArm(); return; }
        case 0x04: t.CR2 = v; return; case 0x08: t.SMCR = v; return;
        case 0x0C: t.DIER = v; if ((v & 1) && (t.SR & 1)) this.cpu.setPending(16 + 28); return;
        case 0x10: t.SR &= v; if (!(t.SR & 1)) this.cpu.clearPending(16 + 28); return;
        case 0x14: if (v & 1) { t.pscS = t.PSC; t.arrS = t.ARR; t.CNT = 0; if (!(t.CR1 & 4)) { t.SR |= 1; if (t.DIER & 1) this.cpu.setPending(16 + 28); } if (t.CR1 & 1) this.timArm(); } return;
        case 0x24: t.CNT = v & 0xFFFF; this.timArm(); return;
        case 0x28: t.PSC = v & 0xFFFF; return;
        case 0x2C: t.ARR = v & 0xFFFF; if (!(t.CR1 & 0x80)) { t.arrS = t.ARR; if (t.CR1 & 1) { t.CNT = this.timCnt(); this.timArm(); } } return;
      }
      t.other.set(a & 0xFF, v); return;
    }
    if (a >= 0x40012400 && a < 0x40012800) { this.adcWrite(a & 0xFF, v); return; }
    if (a >= 0x40005400 && a < 0x40005800) { this.i2cWrite(a & 0xFF, v); return; }
    if (a >= 0x40013800 && a < 0x40013C00) {
      const u = this.usart;
      switch (a & 0xFF) {
        case 0x04: {
          this.uartOut += String.fromCharCode(v & 0xFF);
          if (this.uartOut.length > 65536) this.uartOut = this.uartOut.slice(-32768);
          const baud = u.BRR ? this.hclk / this.apbDiv(2) / u.BRR : 115200;
          this.stall(10 / baud * this.hclk); return; }
        case 0x08: u.BRR = v; return; case 0x0C: u.CR1 = v; return; case 0x10: u.CR2 = v; return; case 0x14: u.CR3 = v; return; case 0x18: u.GTPR = v; return;
      }
      return;
    }
    if (a >= 0x40003000 && a < 0x40003400) {
      const w = this.iwdg;
      switch (a & 0xFF) {
        case 0: if (v === 0xCCCC) { w.on = true; this.iwdgReload(); } else if (v === 0xAAAA) this.iwdgReload(); else if (v === 0x5555) w.unlock = true; else w.unlock = false; return;
        case 4: if (w.unlock) w.PR = v & 7; return;
        case 8: if (w.unlock) w.RLR = v & 0xFFF; return;
      }
      return;
    }
    if (a >= 0x40010000 && a < 0x40010400) { const f = this.afio; if ((a & 0xFF) === 0) f.EVCR = v; else if ((a & 0xFF) === 4) f.MAPR = v; else if ((a & 0xFF) >= 8 && (a & 0xFF) < 0x18) f.EXTICR[((a & 0xFF) - 8) >> 2] = v; return; }
    this.regs.set(a, v);
  }
  clockChanged() {
    // 클럭이 바뀌면 타이머 주기 재계산
    if (this.tim2.CR1 & 1) { this.tim2.CNT = this.timCnt(); this.timArm(); }
  }

  /* ── PPB: SysTick / NVIC / SCB ── */
  ppbRead(a) {
    const cpu = this.cpu, st = this.systick;
    if (a >= 0xE000E010 && a < 0xE000E020) {
      switch (a & 0xF) {
        case 0: { const v = st.CTRL | (st.flag << 16); st.flag = 0; return v; }
        case 4: return st.LOAD;
        case 8: return st.next === Infinity ? 0 : Math.max(0, Math.floor((st.next - cpu.cycles) / ((st.CTRL & 4) ? 1 : 8)) - 1) & 0xFFFFFF;
        case 0xC: return 0x40002328;   // CALIB (9000 = 1ms @ 9MHz)
      }
    }
    if (a >= 0xE000E100 && a < 0xE000E180) { const b = ((a - 0xE000E100) >> 2) * 32; let v = 0; for (let i = 0; i < 32; i++) if (cpu.enabled[16 + b + i]) v |= 1 << i; return v >>> 0; }
    if (a >= 0xE000E180 && a < 0xE000E200) return this.ppbRead(a - 0x80);
    if (a >= 0xE000E200 && a < 0xE000E300) { const b = ((a - 0xE000E200) & 0x7F) / 4 * 32; let v = 0; for (let i = 0; i < 32; i++) if (cpu.pending[16 + b + i]) v |= 1 << i; return v >>> 0; }
    if (a >= 0xE000E300 && a < 0xE000E380) { const b = ((a - 0xE000E300) >> 2) * 32; let v = 0; for (let i = 0; i < 32; i++) if (cpu.active.includes(16 + b + i)) v |= 1 << i; return v >>> 0; }
    if (a >= 0xE000E400 && a < 0xE000E450) { const n = 16 + (a - 0xE000E400); return (cpu.prio[n] | cpu.prio[n + 1] << 8 | cpu.prio[n + 2] << 16 | cpu.prio[n + 3] << 24) >>> 0; }
    switch (a) {
      case 0xE000ED00: return 0x411FC231;
      case 0xE000ED04: return ((cpu.pending[15] ? 1 << 26 : 0) | (cpu.pending[14] ? 1 << 28 : 0) | cpu.ipsr) >>> 0;
      case 0xE000ED08: return cpu.vtor;
      case 0xE000ED0C: return (0xFA050000 | (cpu.prigroup << 8)) >>> 0;
      case 0xE000ED10: return this.scb.SCR; case 0xE000ED14: return this.scb.CCR;
      case 0xE000ED18: case 0xE000ED1C: case 0xE000ED20: { const n = 4 + (a - 0xE000ED18); return (cpu.prio[n] | cpu.prio[n + 1] << 8 | cpu.prio[n + 2] << 16 | cpu.prio[n + 3] << 24) >>> 0; }
      case 0xE000ED24: return this.scb.SHCSR;
    }
    return this.regs.get(a) || 0;
  }
  ppbWrite(a, v) {
    const cpu = this.cpu, st = this.systick;
    if (a >= 0xE000E010 && a < 0xE000E020) {
      switch (a & 0xF) {
        case 0: st.CTRL = v & 7; this.stArm(); return;
        case 4: st.LOAD = v & 0xFFFFFF; return;
        case 8: st.flag = 0; this.stArm(); return;
      }
      return;
    }
    if (a >= 0xE000E100 && a < 0xE000E180) { const b = ((a - 0xE000E100) >> 2) * 32; for (let i = 0; i < 32; i++) if (v & (1 << i)) cpu.enabled[16 + b + i] = 1; cpu.irqCheck = true; return; }
    if (a >= 0xE000E180 && a < 0xE000E200) { const b = ((a - 0xE000E180) >> 2) * 32; for (let i = 0; i < 32; i++) if (v & (1 << i)) cpu.enabled[16 + b + i] = 0; return; }
    if (a >= 0xE000E200 && a < 0xE000E280) { const b = ((a - 0xE000E200) >> 2) * 32; for (let i = 0; i < 32; i++) if (v & (1 << i)) cpu.setPending(16 + b + i); return; }
    if (a >= 0xE000E280 && a < 0xE000E300) { const b = ((a - 0xE000E280) >> 2) * 32; for (let i = 0; i < 32; i++) if (v & (1 << i)) cpu.clearPending(16 + b + i); return; }
    if (a >= 0xE000E400 && a < 0xE000E450) { const n = 16 + (a - 0xE000E400); for (let i = 0; i < 4; i++) cpu.prio[n + i] = (v >> (i * 8)) & 0xF0; cpu.irqCheck = true; return; }
    switch (a) {
      case 0xE000ED04:
        if (v & (1 << 26)) cpu.setPending(15); if (v & (1 << 25)) cpu.clearPending(15);
        if (v & (1 << 28)) cpu.setPending(14); if (v & (1 << 27)) cpu.clearPending(14);
        if (v & (1 << 31)) cpu.setPending(2);
        return;
      case 0xE000ED08: cpu.vtor = v & 0x3FFFFF80; return;
      case 0xE000ED0C:
        if ((v >>> 16) !== 0x05FA) return;
        cpu.prigroup = (v >> 8) & 7;
        if (v & 4) { this.log('SYSRESETREQ — 소프트웨어 리셋'); this.resetCause = 0x14000000; this.pendingReset = true; cpu.until = 0; }
        return;
      case 0xE000ED10: this.scb.SCR = v; return; case 0xE000ED14: this.scb.CCR = v; return;
      case 0xE000ED18: case 0xE000ED1C: case 0xE000ED20: { const n = 4 + (a - 0xE000ED18); for (let i = 0; i < 4; i++) cpu.prio[n + i] = (v >> (i * 8)) & 0xF0; cpu.irqCheck = true; return; }
      case 0xE000ED24: this.scb.SHCSR = v; return;
    }
    this.regs.set(a, v);
  }
}
