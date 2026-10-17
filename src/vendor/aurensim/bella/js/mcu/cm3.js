// cm3.js — ARMv7-M (Cortex-M3) Thumb/Thumb-2 명령어 에뮬레이터
//  실제 STM32F103 펌웨어(GCC -Os, soft-float)를 수정 없이 실행하기 위한 인터프리터.
//  - 레지스터/플래그/IT 블록/예외 진입·복귀(스태킹, EXC_RETURN, 선점 우선순위)/NVIC·SysTick 연동
//  - 메모리: 플래시·SRAM 은 빠른 경로, 나머지는 SoC(stm32f103.js)의 버스 함수로
//  - 사이클: 근사(대부분 1, 로드/스토어 2, 분기 3, LDM/STM 1+n, 나눗셈 6)
'use strict';

const FLASH_BASE = 0x08000000;

export class CortexM3 {
  constructor(soc) {
    this.soc = soc;
    this.r = new Uint32Array(16);
    this.flash = soc.flash; this.flash16 = soc.flash16; this.flash32 = soc.flash32; this.flashMask = soc.flash.length - 1;
    this.ram = soc.ram; this.ram16 = soc.ram16; this.ram32 = soc.ram32; this.ramSize = soc.ram.length;
    // 히든 클래스 고정(성능): 모든 필드를 한 번에 선언
    this.pc = 0; this.npc = 0; this.until = 0; this.sc = 0; this.shT = 0; this.shN = 0;
    this.N = 0; this.Z = 0; this.C = 0; this.V = 0; this.Q = 0; this.itstate = 0;
    this.primask = 0; this.basepri = 0; this.faultmask = 0; this.control = 0; this.ipsr = 0; this.otherSP = 0;
    this.active = []; this.pending = null; this.pendCount = 0; this.prio = null; this.enabled = null; this.prigroup = 0; this.vtor = 0;
    this.cycles = 0; this.cpi = 1; this.halted = null; this.irqCheck = true; this.sleeping = false; this.exclusive = false;
    this.reset();
  }

  reset() {
    this.r.fill(0);
    this.N = 0; this.Z = 0; this.C = 0; this.V = 0; this.Q = 0;
    this.itstate = 0;
    this.primask = 0; this.basepri = 0; this.faultmask = 0; this.control = 0;
    this.ipsr = 0;
    this.otherSP = 0;           // PSP (스레드 모드 프로세스 스택 — 이 펌웨어는 사용하지 않음)
    this.active = [];           // 활성 예외 번호 스택
    this.pending = new Uint8Array(16 + 68);
    this.pendCount = 0;
    this.prio = new Uint8Array(16 + 68);   // 예외 우선순위(바이트)
    this.prio[1] = 0; // reset -3, NMI -2, HardFault -1 은 특수 처리
    this.enabled = new Uint8Array(16 + 68); for (let i = 0; i < 16; i++) this.enabled[i] = 1;
    this.prigroup = 0;
    this.vtor = 0;
    
    this.halted = null;
    this.irqCheck = true;
    this.sleeping = false;
    this.exclusive = false;
    const sp = this.rd32(this.vtor), pc = this.rd32(this.vtor + 4);
    this.r[13] = sp & ~3;
    this.pc = pc & ~1;
    this.r[14] = 0xFFFFFFFF;
  }

  /* ───────────── 메모리 ───────────── */
  rd32(a) {
    a >>>= 0;
    if (a >= 0x20000000 && a < 0x20000000 + this.ramSize) { const o = a - 0x20000000; return (o & 3) === 0 ? this.ram32[o >> 2] : (this.ram[o] | this.ram[o + 1] << 8 | this.ram[o + 2] << 16 | this.ram[o + 3] << 24) >>> 0; }
    if ((a >= FLASH_BASE && a < FLASH_BASE + this.flash.length) || a < this.flash.length) { const o = a & this.flashMask; return (o & 3) === 0 ? this.flash32[o >> 2] : (this.flash[o] | this.flash[o + 1] << 8 | this.flash[o + 2] << 16 | this.flash[o + 3] << 24) >>> 0; }
    return this.soc.read(a, 4) >>> 0;
  }
  rd16(a) {
    a >>>= 0;
    if (a >= 0x20000000 && a < 0x20000000 + this.ramSize) { const o = a - 0x20000000; return (o & 1) === 0 ? this.ram16[o >> 1] : (this.ram[o] | this.ram[o + 1] << 8); }
    if ((a >= FLASH_BASE && a < FLASH_BASE + this.flash.length) || a < this.flash.length) { const o = a & this.flashMask; return (o & 1) === 0 ? this.flash16[o >> 1] : (this.flash[o] | this.flash[o + 1] << 8); }
    return this.soc.read(a, 2) & 0xFFFF;
  }
  rd8(a) {
    a >>>= 0;
    if (a >= 0x20000000 && a < 0x20000000 + this.ramSize) return this.ram[a - 0x20000000];
    if ((a >= FLASH_BASE && a < FLASH_BASE + this.flash.length) || a < this.flash.length) return this.flash[a & this.flashMask];
    return this.soc.read(a, 1) & 0xFF;
  }
  wr32(a, v) {
    a >>>= 0;
    if (a >= 0x20000000 && a < 0x20000000 + this.ramSize) { const o = a - 0x20000000; if ((o & 3) === 0) this.ram32[o >> 2] = v; else { this.ram[o] = v; this.ram[o + 1] = v >> 8; this.ram[o + 2] = v >> 16; this.ram[o + 3] = v >> 24; } return; }
    this.soc.write(a, 4, v >>> 0);
  }
  wr16(a, v) {
    a >>>= 0;
    if (a >= 0x20000000 && a < 0x20000000 + this.ramSize) { const o = a - 0x20000000; if ((o & 1) === 0) this.ram16[o >> 1] = v; else { this.ram[o] = v; this.ram[o + 1] = v >> 8; } return; }
    this.soc.write(a, 2, v & 0xFFFF);
  }
  wr8(a, v) {
    a >>>= 0;
    if (a >= 0x20000000 && a < 0x20000000 + this.ramSize) { this.ram[a - 0x20000000] = v; return; }
    this.soc.write(a, 1, v & 0xFF);
  }
  fetch16(a) {
    if (a >= FLASH_BASE && a < FLASH_BASE + this.flash.length) return this.flash16[(a - FLASH_BASE) >> 1];
    return this.rd16(a);
  }

  /* ───────────── 플래그 / 시프트 ───────────── */
  get xpsr() {
    const it = this.itstate;
    return ((this.N << 31) | (this.Z << 30) | (this.C << 29) | (this.V << 28) | (this.Q << 27) | ((it & 3) << 25) | (1 << 24) | ((it >> 2) << 10) | this.ipsr) >>> 0;
  }
  setApsr(v) { this.N = v >>> 31; this.Z = (v >>> 30) & 1; this.C = (v >>> 29) & 1; this.V = (v >>> 28) & 1; this.Q = (v >>> 27) & 1; }
  nz(r) { this.N = r >>> 31; this.Z = r === 0 ? 1 : 0; }
  add(x, y, c) {       // AddWithCarry + 플래그
    const s = x + y + c, r = s >>> 0;
    this.C = s > 0xFFFFFFFF ? 1 : 0;
    this.V = ((~(x ^ y) & (x ^ r)) >>> 31);
    this.N = r >>> 31; this.Z = r === 0 ? 1 : 0;
    return r;
  }
  shiftC(v, type, n, cin) {   // 결과 반환, 캐리는 this.sc
    this.sc = cin;
    switch (type) {
      case 0: if (n === 0) return v; if (n < 32) { this.sc = (v >>> (32 - n)) & 1; return (v << n) >>> 0; } this.sc = n === 32 ? v & 1 : 0; return 0;
      case 1: if (n === 0) return v; if (n < 32) { this.sc = (v >>> (n - 1)) & 1; return v >>> n; } this.sc = n === 32 ? v >>> 31 : 0; return 0;
      case 2: if (n === 0) return v; if (n < 32) { this.sc = ((v | 0) >> (n - 1)) & 1; return ((v | 0) >> n) >>> 0; } this.sc = v >>> 31; return this.sc ? 0xFFFFFFFF : 0;
      case 3: { if (n === 0) return v; const m = n & 31; const r = m === 0 ? v : ((v >>> m) | (v << (32 - m))) >>> 0; this.sc = r >>> 31; return r; }
      case 4: this.sc = v & 1; return ((cin << 31) | (v >>> 1)) >>> 0;
    }
    return v;
  }
  immShift(type, imm) {    // DecodeImmShift → this.shT, this.shN
    if (type === 0) { this.shT = 0; this.shN = imm; }
    else if (type === 3) { if (imm === 0) { this.shT = 4; this.shN = 1; } else { this.shT = 3; this.shN = imm; } }
    else { this.shT = type; this.shN = imm === 0 ? 32 : imm; }
  }
  expandImm(imm12) {        // ThumbExpandImm_C (캐리 → this.sc)
    this.sc = this.C;
    if ((imm12 >> 10) === 0) {
      const b = imm12 & 0xFF;
      switch ((imm12 >> 8) & 3) {
        case 0: return b;
        case 1: return (b << 16 | b) >>> 0;
        case 2: return (b << 24 | b << 8) >>> 0;
        default: return (b << 24 | b << 16 | b << 8 | b) >>> 0;
      }
    }
    const un = 0x80 | (imm12 & 0x7F), rot = imm12 >> 7;
    const r = ((un >>> rot) | (un << (32 - rot))) >>> 0;
    this.sc = r >>> 31;
    return r;
  }
  cond(c) {
    switch (c) {
      case 0: return this.Z === 1; case 1: return this.Z === 0;
      case 2: return this.C === 1; case 3: return this.C === 0;
      case 4: return this.N === 1; case 5: return this.N === 0;
      case 6: return this.V === 1; case 7: return this.V === 0;
      case 8: return this.C === 1 && this.Z === 0; case 9: return this.C === 0 || this.Z === 1;
      case 10: return this.N === this.V; case 11: return this.N !== this.V;
      case 12: return this.Z === 0 && this.N === this.V; case 13: return this.Z === 1 || this.N !== this.V;
      default: return true;
    }
  }

  /* ───────────── 분기 / 예외 ───────────── */
  bxWrite(v) {     // BXWritePC / LoadWritePC
    if (this.ipsr !== 0 && (v >>> 28) === 0xF) { this.excReturn(v >>> 0); return; }
    if ((v & 1) === 0) { this.fault(`Thumb 비트 없는 분기 → 0x${(v >>> 0).toString(16)} (UsageFault INVSTATE)`); return; }
    this.npc = (v & ~1) >>> 0;
    this.cycles += 2;
  }
  branch(t) { this.npc = t >>> 0; this.cycles += 2; }

  setPending(n) { if (!this.pending[n]) { this.pending[n] = 1; this.pendCount++; } this.irqCheck = true; this.sleeping = false; }
  clearPending(n) { if (this.pending[n]) { this.pending[n] = 0; this.pendCount--; } }
  groupPrio(p) { const sub = this.prigroup + 1; return (p >> sub) << sub; }
  excPrio(n) { if (n === 2) return -2; if (n === 3) return -1; return this.groupPrio(this.prio[n]); }
  execPrio() {
    let p = 256;
    for (const n of this.active) p = Math.min(p, this.excPrio(n));
    if (this.basepri) p = Math.min(p, this.groupPrio(this.basepri));
    if (this.primask) p = Math.min(p, 0);
    if (this.faultmask) p = Math.min(p, -1);
    return p;
  }
  checkIrq() {
    this.irqCheck = false;
    if (!this.pendCount) return false;
    let best = -1, bp = 999;
    for (let n = 2; n < this.pending.length; n++) {
      if (!this.pending[n] || (n >= 16 && !this.enabled[n])) continue;
      const p = n >= 16 || n >= 4 ? this.excPrio(n) : this.excPrio(n);
      if (p < bp) { bp = p; best = n; }
    }
    if (best < 0) return false;
    if (bp >= this.execPrio()) return false;
    this.excEnter(best);
    return true;
  }
  excEnter(n) {
    this.clearPending(n);
    const ret = this.pc;                         // 다음에 실행할 명령
    let sp = this.r[13];
    const align = (sp & 4) ? 1 : 0;
    sp = (sp - 32 - (align ? 4 : 0)) >>> 0;
    const xpsr = (this.xpsr & ~(1 << 9)) | (align << 9);
    this.wr32(sp, this.r[0]); this.wr32(sp + 4, this.r[1]); this.wr32(sp + 8, this.r[2]); this.wr32(sp + 12, this.r[3]);
    this.wr32(sp + 16, this.r[12]); this.wr32(sp + 20, this.r[14]); this.wr32(sp + 24, ret); this.wr32(sp + 28, xpsr);
    this.r[13] = sp;
    this.r[14] = this.ipsr === 0 ? 0xFFFFFFF9 : 0xFFFFFFF1;
    this.ipsr = n; this.itstate = 0;
    this.active.push(n);
    const h = this.rd32(this.vtor + n * 4);
    this.pc = (h & ~1) >>> 0;
    this.cycles += 12;
    this.irqCheck = true;
    this.exclusive = false;
  }
  excReturn(v) {
    const n = this.active.pop();
    if (n === undefined) { this.fault('EXC_RETURN 인데 활성 예외 없음'); return; }
    let sp = this.r[13];
    this.r[0] = this.rd32(sp); this.r[1] = this.rd32(sp + 4); this.r[2] = this.rd32(sp + 8); this.r[3] = this.rd32(sp + 12);
    this.r[12] = this.rd32(sp + 16); this.r[14] = this.rd32(sp + 20);
    const pc = this.rd32(sp + 24), xpsr = this.rd32(sp + 28);
    sp = (sp + 32 + ((xpsr >> 9) & 1 ? 4 : 0)) >>> 0;
    this.r[13] = sp;
    this.setApsr(xpsr);
    this.itstate = (((xpsr >> 25) & 3) | (((xpsr >> 10) & 0x3F) << 2)) & 0xFF;
    this.ipsr = (v & 0xF) === 1 ? (xpsr & 0x1FF) : 0;
    this.npc = (pc & ~1) >>> 0;
    this.cycles += 10;
    this.irqCheck = true;
  }
  fault(msg) {
    this.halted = `${msg} @PC=0x${this.pc.toString(16)}`;
    this.npc = this.pc;
  }

  /* ───────────── 실행 ───────────── */
  runLoop() {
    const r = this.r, f16 = this.flash16, fend = FLASH_BASE + this.flash.length;
    while (this.cycles < this.until) {
      if (this.irqCheck) { this.checkIrq(); if (this.halted) return; if (this.sleeping) { this.cycles = this.until; return; } }
      const pc = this.pc;
      const inFlash = pc >= FLASH_BASE && pc < fend;
      const hw = inFlash ? f16[(pc - FLASH_BASE) >> 1] : this.rd16(pc);
      r[15] = pc + 4;
      const it = this.itstate;
      if (hw >= 0xE800) {
        const hw2 = inFlash ? f16[(pc + 2 - FLASH_BASE) >> 1] : this.rd16(pc + 2);
        this.npc = pc + 4;
        if (it === 0 || this.cond(it >> 4)) this.exec32(hw, hw2);
      } else {
        this.npc = pc + 2;
        if (it === 0) this.exec16(hw, false);
        else if (this.cond(it >> 4)) this.exec16(hw, true);
      }
      if (it !== 0) this.itstate = (it & 7) === 0 ? 0 : ((it & 0xE0) | ((it << 1) & 0x1F));
      this.cycles += this.cpi;
      this.pc = this.npc;
      if (this.halted) return;
    }
  }

  ld(addr, size, signed) {
    this.cycles++;
    if (size === 4) return this.rd32(addr);
    if (size === 2) { const v = this.rd16(addr); return signed ? (v << 16 >> 16) >>> 0 : v; }
    const v = this.rd8(addr); return signed ? (v << 24 >> 24) >>> 0 : v;
  }
  st(addr, size, v) {
    this.cycles++;
    if (size === 4) this.wr32(addr, v); else if (size === 2) this.wr16(addr, v); else this.wr8(addr, v);
  }

  exec16(hw, inIT) {
    const r = this.r, S = !inIT;
    switch (hw >>> 11) {
      case 0: { const rd = hw & 7, m = r[(hw >> 3) & 7], n = (hw >> 6) & 31;      // LSL imm (n=0 → MOV)
        const v = this.shiftC(m, 0, n, this.C); r[rd] = v; if (S) { this.nz(v); this.C = this.sc; } return; }
      case 1: { const rd = hw & 7, m = r[(hw >> 3) & 7], n = (hw >> 6) & 31;
        const v = this.shiftC(m, 1, n || 32, this.C); r[rd] = v; if (S) { this.nz(v); this.C = this.sc; } return; }
      case 2: { const rd = hw & 7, m = r[(hw >> 3) & 7], n = (hw >> 6) & 31;
        const v = this.shiftC(m, 2, n || 32, this.C); r[rd] = v; if (S) { this.nz(v); this.C = this.sc; } return; }
      case 3: { const rd = hw & 7, rn = r[(hw >> 3) & 7], x = (hw >> 6) & 7;
        const imm = (hw & 0x400) ? x : r[x];
        if (hw & 0x200) { if (S) r[rd] = this.add(rn, ~imm >>> 0, 1); else r[rd] = rn - imm; }
        else { if (S) r[rd] = this.add(rn, imm, 0); else r[rd] = rn + imm; }
        return; }
      case 4: { const v = hw & 0xFF; r[(hw >> 8) & 7] = v; if (S) this.nz(v); return; }
      case 5: this.add(r[(hw >> 8) & 7], ~(hw & 0xFF) >>> 0, 1); return;
      case 6: { const d = (hw >> 8) & 7; if (S) r[d] = this.add(r[d], hw & 0xFF, 0); else r[d] = r[d] + (hw & 0xFF); return; }
      case 7: { const d = (hw >> 8) & 7; if (S) r[d] = this.add(r[d], ~(hw & 0xFF) >>> 0, 1); else r[d] = r[d] - (hw & 0xFF); return; }
      case 8: {
        if ((hw & 0x400) === 0) return this.dp16(hw, S);
        const op = (hw >> 8) & 3;
        if (op === 3) {                                     // BX / BLX
          const m = (hw >> 3) & 15, t = m === 15 ? r[15] : r[m];
          if (hw & 0x80) r[14] = (this.pc + 2) | 1;
          this.bxWrite(t); return;
        }
        const d = (hw & 7) | ((hw >> 4) & 8), m = (hw >> 3) & 15;
        const vm = r[m];
        if (op === 0) { const v = (r[d] + vm) >>> 0; if (d === 15) this.branch(v & ~1); else r[d] = v; }
        else if (op === 1) this.add(r[d], ~vm >>> 0, 1);
        else { if (d === 15) this.branch(vm & ~1); else r[d] = vm; }
        return;
      }
      case 9: { const a = ((r[15] & ~3) + (hw & 0xFF) * 4) >>> 0; r[(hw >> 8) & 7] = this.ld(a, 4); return; }
      case 10: case 11: {
        const t = hw & 7, a = (r[(hw >> 3) & 7] + r[(hw >> 6) & 7]) >>> 0;
        switch ((hw >> 9) & 7) {
          case 0: this.st(a, 4, r[t]); return; case 1: this.st(a, 2, r[t]); return; case 2: this.st(a, 1, r[t]); return;
          case 3: r[t] = this.ld(a, 1, true); return; case 4: r[t] = this.ld(a, 4); return; case 5: r[t] = this.ld(a, 2); return;
          case 6: r[t] = this.ld(a, 1); return; default: r[t] = this.ld(a, 2, true); return;
        }
      }
      case 12: this.st((r[(hw >> 3) & 7] + ((hw >> 6) & 31) * 4) >>> 0, 4, r[hw & 7]); return;
      case 13: r[hw & 7] = this.ld((r[(hw >> 3) & 7] + ((hw >> 6) & 31) * 4) >>> 0, 4); return;
      case 14: this.st((r[(hw >> 3) & 7] + ((hw >> 6) & 31)) >>> 0, 1, r[hw & 7]); return;
      case 15: r[hw & 7] = this.ld((r[(hw >> 3) & 7] + ((hw >> 6) & 31)) >>> 0, 1); return;
      case 16: this.st((r[(hw >> 3) & 7] + ((hw >> 6) & 31) * 2) >>> 0, 2, r[hw & 7]); return;
      case 17: r[hw & 7] = this.ld((r[(hw >> 3) & 7] + ((hw >> 6) & 31) * 2) >>> 0, 2); return;
      case 18: this.st((r[13] + (hw & 0xFF) * 4) >>> 0, 4, r[(hw >> 8) & 7]); return;
      case 19: r[(hw >> 8) & 7] = this.ld((r[13] + (hw & 0xFF) * 4) >>> 0, 4); return;
      case 20: r[(hw >> 8) & 7] = ((r[15] & ~3) + (hw & 0xFF) * 4) >>> 0; return;
      case 21: r[(hw >> 8) & 7] = (r[13] + (hw & 0xFF) * 4) >>> 0; return;
      case 22: case 23: return this.misc16(hw);
      case 24: {                                            // STMIA rn!
        const n = (hw >> 8) & 7; let a = r[n];
        for (let i = 0; i < 8; i++) if (hw & (1 << i)) { this.st(a, 4, r[i]); a += 4; }
        r[n] = a; return; }
      case 25: {                                            // LDMIA rn(!)
        const n = (hw >> 8) & 7; let a = r[n];
        for (let i = 0; i < 8; i++) if (hw & (1 << i)) { r[i] = this.ld(a, 4); a += 4; }
        if (!(hw & (1 << n))) r[n] = a; return; }
      case 26: case 27: {
        const c = (hw >> 8) & 15;
        if (c === 15) { this.svc(); return; }
        if (c === 14) { this.fault('UDF'); return; }
        if (this.cond(c)) this.branch(r[15] + ((hw & 0xFF) << 24 >> 23));
        return; }
      case 28: this.branch(r[15] + ((hw & 0x7FF) << 21 >> 20)); return;
    }
    this.fault(`미구현 16bit 0x${hw.toString(16)}`);
  }

  dp16(hw, S) {
    const r = this.r, d = hw & 7, m = (hw >> 3) & 7, a = r[d], b = r[m];
    let v;
    switch ((hw >> 6) & 15) {
      case 0: v = (a & b) >>> 0; r[d] = v; if (S) this.nz(v); return;
      case 1: v = (a ^ b) >>> 0; r[d] = v; if (S) this.nz(v); return;
      case 2: v = this.shiftC(a, 0, b & 0xFF, this.C); r[d] = v; if (S) { this.nz(v); this.C = this.sc; } return;
      case 3: v = this.shiftC(a, 1, b & 0xFF, this.C); r[d] = v; if (S) { this.nz(v); this.C = this.sc; } return;
      case 4: v = this.shiftC(a, 2, b & 0xFF, this.C); r[d] = v; if (S) { this.nz(v); this.C = this.sc; } return;
      case 5: if (S) r[d] = this.add(a, b, this.C); else r[d] = a + b + this.C; return;
      case 6: if (S) r[d] = this.add(a, ~b >>> 0, this.C); else r[d] = a + (~b >>> 0) + this.C; return;
      case 7: v = this.shiftC(a, 3, b & 0xFF, this.C); r[d] = v; if (S) { this.nz(v); this.C = this.sc; } return;
      case 8: this.nz((a & b) >>> 0); return;
      case 9: if (S) r[d] = this.add(~b >>> 0, 0, 1); else r[d] = -b; return;
      case 10: this.add(a, ~b >>> 0, 1); return;
      case 11: this.add(a, b, 0); return;
      case 12: v = (a | b) >>> 0; r[d] = v; if (S) this.nz(v); return;
      case 13: v = Math.imul(a, b) >>> 0; r[d] = v; if (S) this.nz(v); return;
      case 14: v = (a & ~b) >>> 0; r[d] = v; if (S) this.nz(v); return;
      case 15: v = ~b >>> 0; r[d] = v; if (S) this.nz(v); return;
    }
  }

  misc16(hw) {
    const r = this.r;
    switch ((hw >> 8) & 15) {
      case 0: { const imm = (hw & 0x7F) * 4; r[13] = (hw & 0x80) ? r[13] - imm : r[13] + imm; return; }
      case 1: case 3: case 9: case 11: {                    // CBZ / CBNZ
        const v = r[hw & 7], nz = (hw >> 11) & 1;
        if ((v !== 0) === !!nz) this.branch(r[15] + ((((hw >> 9) & 1) << 6) | (((hw >> 3) & 31) << 1)));
        return; }
      case 2: { const m = r[(hw >> 3) & 7], d = hw & 7;
        switch ((hw >> 6) & 3) { case 0: r[d] = (m << 16 >> 16); return; case 1: r[d] = (m << 24 >> 24); return; case 2: r[d] = m & 0xFFFF; return; default: r[d] = m & 0xFF; return; } }
      case 4: case 5: {                                     // PUSH
        let n = 0; for (let i = 0; i < 9; i++) if (hw & (1 << i)) n++;
        let a = (r[13] - 4 * n) >>> 0; r[13] = a;
        for (let i = 0; i < 8; i++) if (hw & (1 << i)) { this.st(a, 4, r[i]); a += 4; }
        if (hw & 0x100) this.st(a, 4, r[14]);
        return; }
      case 6: {                                             // CPS
        if ((hw & 0xFFE8) === 0xB660) { const dis = (hw >> 4) & 1; if (hw & 2) this.primask = dis; if (hw & 1) this.faultmask = dis; this.irqCheck = true; return; }
        break; }
      case 10: { const m = r[(hw >> 3) & 7], d = hw & 7;
        switch ((hw >> 6) & 3) {
          case 0: r[d] = ((m >>> 24) | ((m >>> 8) & 0xFF00) | ((m << 8) & 0xFF0000) | (m << 24)) >>> 0; return;
          case 1: r[d] = (((m >>> 8) & 0x00FF00FF) | ((m << 8) & 0xFF00FF00)) >>> 0; return;
          case 3: r[d] = ((((m & 0xFF) << 24) >> 16) | ((m >>> 8) & 0xFF)) >>> 0; return;
        } break; }
      case 12: case 13: {                                   // POP
        let a = r[13];
        for (let i = 0; i < 8; i++) if (hw & (1 << i)) { r[i] = this.ld(a, 4); a += 4; }
        if (hw & 0x100) { const v = this.ld(a, 4); a += 4; r[13] = a; this.bxWrite(v); return; }
        r[13] = a; return; }
      case 14: this.fault('BKPT'); return;
      case 15:
        if (hw & 0xF) { this.itstate = hw & 0xFF; return; }
        if (((hw >> 4) & 15) === 3) { this.sleeping = !this.pendCount; }   // WFI
        return;
    }
    this.fault(`미구현 16bit misc 0x${hw.toString(16)}`);
  }

  svc() { this.setPending(11); }

  exec32(h1, h2) {
    const r = this.r;
    const op1 = (h1 >> 11) & 3;
    if (op1 === 1) {
      if ((h1 & 0x0640) === 0x0000 || (h1 & 0x0640) === 0x0400 && false) {}
      const op2 = (h1 >> 4) & 0x7F;
      if ((op2 & 0x64) === 0x00) return this.ldmStm(h1, h2);
      if ((op2 & 0x64) === 0x04) return this.ldrdEtc(h1, h2);
      if ((op2 & 0x60) === 0x20) return this.dpShift(h1, h2);
      return this.fault(`코프로세서 명령 0x${h1.toString(16)}${h2.toString(16)}`);
    }
    if (op1 === 2) {
      if ((h2 & 0x8000) === 0) return (h1 & 0x200) === 0 ? this.dpModImm(h1, h2) : this.dpPlainImm(h1, h2);
      return this.branchMisc(h1, h2);
    }
    // op1 === 3
    const op2 = (h1 >> 4) & 0x7F;
    if ((op2 & 0x71) === 0x00) return this.ldst(h1, h2, false);
    if ((op2 & 0x67) === 0x01 || (op2 & 0x67) === 0x03 || (op2 & 0x67) === 0x05) return this.ldst(h1, h2, true);
    if ((op2 & 0x70) === 0x20) return this.dpReg(h1, h2);
    if ((op2 & 0x78) === 0x30) return this.mul(h1, h2);
    if ((op2 & 0x78) === 0x38) return this.mulLong(h1, h2);
    this.fault(`미구현 32bit 0x${h1.toString(16)} ${h2.toString(16)}`);
  }

  ldmStm(h1, h2) {
    const r = this.r, n = h1 & 15, L = (h1 >> 4) & 1, W = (h1 >> 5) & 1, op = (h1 >> 7) & 3;
    let cnt = 0; for (let i = 0; i < 16; i++) if (h2 & (1 << i)) cnt++;
    let a = op === 1 ? r[n] : (r[n] - 4 * cnt) >>> 0;
    const wb = op === 1 ? (r[n] + 4 * cnt) >>> 0 : a;
    if (L) {
      let pcv = null;
      for (let i = 0; i < 16; i++) if (h2 & (1 << i)) { const v = this.ld(a, 4); a += 4; if (i === 15) pcv = v; else r[i] = v; }
      if (W && !(h2 & (1 << n))) r[n] = wb;
      if (pcv !== null) this.bxWrite(pcv);
    } else {
      for (let i = 0; i < 16; i++) if (h2 & (1 << i)) { this.st(a, 4, r[i]); a += 4; }
      if (W) r[n] = wb;
    }
  }

  ldrdEtc(h1, h2) {
    const r = this.r, n = h1 & 15, t = (h2 >> 12) & 15, op1 = (h1 >> 7) & 3, op2 = (h1 >> 4) & 3, op3 = (h2 >> 4) & 15;
    const base = n === 15 ? (r[15] & ~3) >>> 0 : r[n];
    if (op1 === 0 && op2 === 0) { const a = (base + (h2 & 0xFF) * 4) >>> 0; this.st(a, 4, r[t]); r[(h2 >> 8) & 15] = this.exclusive ? 0 : 1; this.exclusive = false; return; }   // STREX
    if (op1 === 0 && op2 === 1) { r[t] = this.ld((base + (h2 & 0xFF) * 4) >>> 0, 4); this.exclusive = true; return; }   // LDREX
    if (op1 === 1 && op2 === 0) {                         // STREXB/H
      const sz = op3 === 4 ? 1 : 2; this.st(base, sz, r[t]); r[h2 & 15] = this.exclusive ? 0 : 1; this.exclusive = false; return; }
    if (op1 === 1 && op2 === 1) {
      if (op3 === 0 || op3 === 1) {                       // TBB / TBH
        const m = r[h2 & 15];
        const off = op3 === 0 ? this.ld((base + m) >>> 0, 1) : this.ld((base + m * 2) >>> 0, 2);
        this.branch(r[15] + off * 2); return;
      }
      if (op3 === 4) { r[t] = this.ld(base, 1); this.exclusive = true; return; }
      if (op3 === 5) { r[t] = this.ld(base, 2); this.exclusive = true; return; }
    }
    // LDRD / STRD (imm)
    const P = (h1 >> 8) & 1, U = (h1 >> 7) & 1, W = (h1 >> 5) & 1, L = (h1 >> 4) & 1, t2 = (h2 >> 8) & 15;
    const imm = (h2 & 0xFF) * 4;
    const off = U ? (base + imm) >>> 0 : (base - imm) >>> 0;
    const a = P ? off : base;
    if (L) { r[t] = this.ld(a, 4); r[t2] = this.ld(a + 4, 4); }
    else { this.st(a, 4, r[t]); this.st(a + 4, 4, r[t2]); }
    if (W) r[n] = off;
  }

  dpShift(h1, h2) {
    const r = this.r, op = (h1 >> 5) & 15, S = (h1 >> 4) & 1, n = h1 & 15, d = (h2 >> 8) & 15, m = h2 & 15;
    this.immShift((h2 >> 4) & 3, ((h2 >> 12) & 7) << 2 | ((h2 >> 6) & 3));
    const b = this.shiftC(r[m], this.shT, this.shN, this.C);
    this.dpOp(op, S, n, d, b, this.sc);
  }
  dpModImm(h1, h2) {
    const op = (h1 >> 5) & 15, S = (h1 >> 4) & 1, n = h1 & 15, d = (h2 >> 8) & 15;
    const b = this.expandImm(((h1 >> 10) & 1) << 11 | ((h2 >> 12) & 7) << 8 | (h2 & 0xFF));
    this.dpOp(op, S, n, d, b, this.sc);
  }
  dpOp(op, S, n, d, b, carry) {
    const r = this.r, a = n === 15 ? 0 : r[n];
    let v;
    switch (op) {
      case 0: v = (a & b) >>> 0; if (d === 15) { if (S) { this.nz(v); this.C = carry; } return; } break;    // AND / TST
      case 1: v = (a & ~b) >>> 0; break;                                                                   // BIC
      case 2: v = n === 15 ? b : (a | b) >>> 0; break;                                                     // ORR / MOV
      case 3: v = n === 15 ? (~b >>> 0) : (a | ~b) >>> 0; break;                                           // ORN / MVN
      case 4: v = (a ^ b) >>> 0; if (d === 15) { if (S) { this.nz(v); this.C = carry; } return; } break;    // EOR / TEQ
      case 8: if (d === 15 && S) { this.add(a, b, 0); return; } v = S ? this.add(a, b, 0) : (a + b) >>> 0; r[d] = v; return;
      case 10: v = S ? this.add(a, b, this.C) : (a + b + this.C) >>> 0; r[d] = v; return;
      case 11: v = S ? this.add(a, ~b >>> 0, this.C) : (a + (~b >>> 0) + this.C) >>> 0; r[d] = v; return;
      case 13: if (d === 15 && S) { this.add(a, ~b >>> 0, 1); return; } v = S ? this.add(a, ~b >>> 0, 1) : (a - b) >>> 0; r[d] = v; return;
      case 14: v = S ? this.add(~a >>> 0, b, 1) : (b - a) >>> 0; r[d] = v; return;
      default: this.fault(`미구현 DP op ${op}`); return;
    }
    r[d] = v;
    if (S) { this.nz(v); this.C = carry; }
  }
  dpPlainImm(h1, h2) {
    const r = this.r, op = (h1 >> 4) & 0x1F, n = h1 & 15, d = (h2 >> 8) & 15;
    const imm12 = ((h1 >> 10) & 1) << 11 | ((h2 >> 12) & 7) << 8 | (h2 & 0xFF);
    const lsb = ((h2 >> 12) & 7) << 2 | ((h2 >> 6) & 3);
    switch (op) {
      case 0x00: r[d] = n === 15 ? ((r[15] & ~3) + imm12) >>> 0 : (r[n] + imm12) >>> 0; return;
      case 0x0A: r[d] = n === 15 ? ((r[15] & ~3) - imm12) >>> 0 : (r[n] - imm12) >>> 0; return;
      case 0x04: r[d] = (h1 & 15) << 12 | imm12; return;
      case 0x0C: r[d] = (((h1 & 15) << 12 | imm12) << 16 | (r[d] & 0xFFFF)) >>> 0; return;
      case 0x14: { const w = (h2 & 31) + 1; r[d] = ((r[n] << (32 - lsb - w)) >> (32 - w)) >>> 0; return; }        // SBFX
      case 0x1C: { const w = (h2 & 31) + 1; r[d] = w === 32 ? r[n] >>> lsb : (r[n] >>> lsb) & ((1 << w) - 1) >>> 0; return; }   // UBFX
      case 0x16: { const msb = h2 & 31; if (msb < lsb) return; const w = msb - lsb + 1;                             // BFI / BFC
        const mask = (w === 32 ? 0xFFFFFFFF : ((1 << w) - 1) << lsb) >>> 0;
        const src = n === 15 ? 0 : (r[n] << lsb) >>> 0;
        r[d] = ((r[d] & ~mask) | (src & mask)) >>> 0; return; }
      case 0x10: case 0x12: { const sat = (h2 & 31) + 1, sh = (op & 2) ? 2 : 0;                                     // SSAT
        const v = sh ? (r[n] | 0) >> (lsb || 32) : (r[n] << lsb) | 0; const mx = 2 ** (sat - 1) - 1, mn = -(2 ** (sat - 1));
        if (v > mx) { r[d] = mx; this.Q = 1; } else if (v < mn) { r[d] = mn; this.Q = 1; } else r[d] = v; return; }
      case 0x18: case 0x1A: { const sat = h2 & 31, sh = (op & 2) ? 2 : 0;                                          // USAT
        const v = sh ? (r[n] | 0) >> (lsb || 32) : (r[n] << lsb) | 0; const mx = 2 ** sat - 1;
        if (v > mx) { r[d] = mx; this.Q = 1; } else if (v < 0) { r[d] = 0; this.Q = 1; } else r[d] = v; return; }
    }
    this.fault(`미구현 plain imm op 0x${op.toString(16)}`);
  }

  branchMisc(h1, h2) {
    const r = this.r, op1 = (h2 >> 12) & 7, S = (h1 >> 10) & 1;
    const J1 = (h2 >> 13) & 1, J2 = (h2 >> 11) & 1;
    if ((op1 & 5) === 0) {
      const op = (h1 >> 4) & 0x7F;
      if ((op & 0x38) !== 0x38) {                            // B<c>.W
        const c = (h1 >> 6) & 15;
        const imm = (S ? -1 << 20 : 0) | J2 << 19 | J1 << 18 | (h1 & 63) << 12 | (h2 & 0x7FF) << 1;
        if (this.cond(c)) this.branch(r[15] + imm);
        return;
      }
      if (op === 0x38 || op === 0x39) { this.msr(r[h1 & 15], h2 & 0xFF, (h2 >> 10) & 3); return; }
      if (op === 0x3A) return;                               // NOP/hints (WFI.W 등)
      if (op === 0x3B) { if (((h2 >> 4) & 15) === 2) this.exclusive = false; return; }   // DSB/DMB/ISB/CLREX
      if (op === 0x3E || op === 0x3F) { r[(h2 >> 8) & 15] = this.mrs(h2 & 0xFF); return; }
      this.fault(`미구현 misc control 0x${h1.toString(16)} ${h2.toString(16)}`); return;
    }
    const I1 = (~(J1 ^ S)) & 1, I2 = (~(J2 ^ S)) & 1;
    const imm = (S ? -1 << 24 : 0) | I1 << 23 | I2 << 22 | (h1 & 0x3FF) << 12 | (h2 & 0x7FF) << 1;
    if ((op1 & 5) === 1) { this.branch(r[15] + imm); return; }   // B.W
    if ((op1 & 5) === 5) { r[14] = this.npc | 1; this.branch(r[15] + imm); return; }   // BL
    this.fault('BLX imm(ARM 상태 불가)');
  }
  mrs(sysm) {
    switch (sysm) {
      case 0: case 1: case 2: case 3: case 5: case 6: case 7: {
        let v = 0;
        if ((sysm & 4) === 0) v |= this.xpsr & 0xF8000000;
        if (sysm & 1) v |= this.ipsr;
        return v >>> 0; }
      case 8: return this.control & 2 ? this.otherSP : this.r[13];
      case 9: return this.control & 2 ? this.r[13] : this.otherSP;
      case 16: return this.primask; case 17: case 18: return this.basepri;
      case 19: return this.faultmask; case 20: return this.control;
    }
    return 0;
  }
  msr(v, sysm, mask) {
    switch (sysm) {
      case 0: case 1: case 2: case 3: if (mask & 2) this.setApsr(v); return;
      case 8: if (this.control & 2) this.otherSP = v & ~3; else this.r[13] = v & ~3; return;
      case 9: if (this.control & 2) this.r[13] = v & ~3; else this.otherSP = v & ~3; return;
      case 16: this.primask = v & 1; this.irqCheck = true; return;
      case 17: this.basepri = v & 0xFF; this.irqCheck = true; return;
      case 18: if ((v & 0xFF) && (!this.basepri || (v & 0xFF) < this.basepri)) this.basepri = v & 0xFF; this.irqCheck = true; return;
      case 19: this.faultmask = v & 1; this.irqCheck = true; return;
      case 20: if (this.ipsr === 0) { const spsel = (v >> 1) & 1; if (spsel !== ((this.control >> 1) & 1)) { const t = this.r[13]; this.r[13] = this.otherSP; this.otherSP = t; } this.control = v & 3; } return;
    }
  }

  ldst(h1, h2, load) {
    const r = this.r, n = h1 & 15, t = (h2 >> 12) & 15, size = [1, 2, 4, 0][(h1 >> 5) & 3], signed = (h1 >> 8) & 1;
    let addr, wb = -1, wbv = 0;
    if (n === 15) {                                          // 리터럴
      if (!load) { this.fault('PC 기준 저장'); return; }
      const imm = h2 & 0xFFF, base = (r[15] & ~3) >>> 0;
      addr = (h1 & 0x80) ? (base + imm) >>> 0 : (base - imm) >>> 0;
    } else if (h1 & 0x80) {
      addr = (r[n] + (h2 & 0xFFF)) >>> 0;
    } else if (h2 & 0x800) {
      const P = (h2 >> 10) & 1, U = (h2 >> 9) & 1, W = (h2 >> 8) & 1, imm = h2 & 0xFF;
      const off = U ? (r[n] + imm) >>> 0 : (r[n] - imm) >>> 0;
      addr = P ? off : r[n];
      if (W) { wb = n; wbv = off; }
    } else {
      addr = (r[n] + (r[h2 & 15] << ((h2 >> 4) & 3))) >>> 0;
    }
    if (load) {
      if (t === 15 && size !== 4) { if (wb >= 0) r[wb] = wbv; return; }    // PLD/PLI 힌트
      const v = this.ld(addr, size, signed);
      if (wb >= 0) r[wb] = wbv;
      if (t === 15) this.bxWrite(v); else r[t] = v;
    } else {
      this.st(addr, size, r[t]);
      if (wb >= 0) r[wb] = wbv;
    }
  }

  dpReg(h1, h2) {
    const r = this.r, op1 = (h1 >> 4) & 15, op2 = (h2 >> 4) & 15, n = h1 & 15, d = (h2 >> 8) & 15, m = h2 & 15;
    if ((op1 & 8) === 0 && op2 === 0) {                      // LSL/LSR/ASR/ROR (reg)
      const v = this.shiftC(r[n], (op1 >> 1) & 3, r[m] & 0xFF, this.C);
      r[d] = v; if (op1 & 1) { this.nz(v); this.C = this.sc; } return;
    }
    if ((op1 & 8) === 0 && (op2 & 8)) {                      // 확장(+누산)
      const rot = ((h2 >> 4) & 3) * 8, v = rot ? ((r[m] >>> rot) | (r[m] << (32 - rot))) >>> 0 : r[m];
      let x;
      switch (op1) { case 0: x = v << 16 >> 16; break; case 1: x = v & 0xFFFF; break; case 4: x = v << 24 >> 24; break; case 5: x = v & 0xFF; break;
        default: this.fault(`미구현 extend op ${op1}`); return; }
      r[d] = n === 15 ? x : r[n] + x; return;
    }
    if ((op1 & 0xC) === 8 && (op2 & 0xC) === 8) {
      const v = r[m], k = ((op1 & 3) << 2) | (op2 & 3);
      switch (k) {
        case 4: r[d] = ((v >>> 24) | ((v >>> 8) & 0xFF00) | ((v << 8) & 0xFF0000) | (v << 24)) >>> 0; return;   // REV
        case 5: r[d] = (((v >>> 8) & 0x00FF00FF) | ((v << 8) & 0xFF00FF00)) >>> 0; return;                       // REV16
        case 6: { let x = 0; for (let i = 0; i < 32; i++) if (v & (1 << i)) x |= 1 << (31 - i); r[d] = x >>> 0; return; }   // RBIT
        case 7: r[d] = ((((v & 0xFF) << 24) >> 16) | ((v >>> 8) & 0xFF)) >>> 0; return;                           // REVSH
        case 12: r[d] = Math.clz32(v); return;                                                                  // CLZ
      }
    }
    this.fault(`미구현 DP reg ${op1}/${op2}`);
  }

  mul(h1, h2) {
    const r = this.r, n = h1 & 15, d = (h2 >> 8) & 15, m = h2 & 15, a = (h2 >> 12) & 15, op2 = (h2 >> 4) & 3;
    const p = Math.imul(r[n], r[m]);
    if (op2 === 0) r[d] = a === 15 ? p : (p + r[a]) >>> 0;
    else if (op2 === 1) r[d] = (r[a] - p) >>> 0;
    else this.fault('미구현 MUL 변형');
  }
  mulLong(h1, h2) {
    const r = this.r, op1 = (h1 >> 4) & 7, op2 = (h2 >> 4) & 15, n = h1 & 15, m = h2 & 15, lo = (h2 >> 12) & 15, hi = (h2 >> 8) & 15;
    if (op1 === 1 && op2 === 15) { const b = r[m] | 0; r[hi] = b === 0 ? 0 : ((r[n] | 0) / b) | 0; this.cycles += 6; return; }   // SDIV (lo 필드 = 1111)
    if (op1 === 3 && op2 === 15) { const b = r[m]; r[hi] = b === 0 ? 0 : Math.floor(r[n] / b); this.cycles += 6; return; }       // UDIV
    const a = r[n], b = r[m];
    const a0 = a & 0xFFFF, a1 = a >>> 16, b0 = b & 0xFFFF, b1 = b >>> 16;
    const p00 = a0 * b0, p01 = a0 * b1, p10 = a1 * b0, p11 = a1 * b1;
    const mid = (p00 >>> 16) + (p01 & 0xFFFF) + (p10 & 0xFFFF);
    let L = ((mid << 16) | (p00 & 0xFFFF)) >>> 0;
    let H = (p11 + Math.floor(p01 / 65536) + Math.floor(p10 / 65536) + Math.floor(mid / 65536)) >>> 0;
    if (op1 === 0 || op1 === 4) { if (a >>> 31) H = (H - b) >>> 0; if (b >>> 31) H = (H - a) >>> 0; }   // 부호 보정
    if (op1 === 4 || op1 === 6) {                            // SMLAL / UMLAL 누산
      const s = L + r[lo]; L = s >>> 0; H = (H + r[hi] + (s > 0xFFFFFFFF ? 1 : 0)) >>> 0;
    } else if (!(op1 === 0 || op1 === 2) || op2 !== 0) { this.fault(`미구현 long mul ${op1}/${op2}`); return; }
    r[lo] = L; r[hi] = H; this.cycles += 2;
  }
}
