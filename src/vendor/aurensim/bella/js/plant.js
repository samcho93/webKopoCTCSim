// plant.js — BELLA ONE 물리 모델 (MCU 출력 GPIO → 유체/열 → NTC 전압·버튼 입력)
//  구조(설명서): 외부 유리 물병(2L) → 호스 → 진동 펌프(19bar급, OPV) → 프리히팅 블록(100W) → 그룹 일체형 포화 보일러(1000W, SSR PID)
//                → 3WAY 솔레노이드 → 그룹헤드(샤워스크린) → 포터필터(퍽)/블라인드/없음 → 잔 / 드립트레이
//  3WAY 비통전 시 그룹 잔압은 드립트레이로 배출. Water Drain = 3WAY 개방(펌프 없이) → 보일러 물이 그룹(디퓨저·볼트 제거)으로 배출.
'use strict';

const CW = 4.186;            // J/g·K
export const NTC = { R0: 10000, T0: 25, B: 3950, Rs: 9970, Vref: 3.3 };
export function ntcVolt(T) {
  const R = NTC.R0 * Math.exp(NTC.B * (1 / (T + 273.15) - 1 / (NTC.T0 + 273.15)));
  return NTC.Vref * R / (R + NTC.Rs);
}

export const PARAMS = {
  ambient: 23,
  boilerML: 320,             // 그룹 일체형 보일러 용량
  boilerMetalC: 900,         // 그룹/보일러 금속 열용량 J/K (황동·스테인리스)
  heaterW: 1000, preheatW: 100,
  lossUA: 1.15,              // W/K 보일러 방열
  preUA: 0.35, preC: 260, preCutoff: 96,
  pumpQmax: 6.0,             // mL/s @0bar
  pumpPmax: 16.0,            // bar (shut-off)
  opv: 10.0,                 // 과압 밸브(바)
  circuitC: 1.2,             // 밀폐 회로 유효 컴플라이언스 mL/bar (호스·펌프 다이어프램·배관 탄성)
  backLeakTau: 600,          // 정지한 진동 펌프·체크밸브 역누설 시정수 s
  dose: 18, grind: 0.5,      // 원두 g, 분쇄도(0 굵게 ~ 1 곱게)
  tankCap: 2000,
  cupCap: 110, dripCap: 900,
};

/** 물 밀도 kg/m³ (Tanaka 2001, 0~100℃) — 100℃ 초과는 외삽 */
export function waterRho(T) {
  const t = Math.min(150, Math.max(0, T));
  return 999.974950 * (1 - (t - 3.983035) ** 2 * (t + 301.797) / (522528.9 * (t + 69.34881)));
}
/** 물 포화 증기압(bar, 절대) — Antoine(mmHg): 1~100℃ / 99~374℃ 두 구간 */
export function satPressBar(T) {
  const [A, B, Cc] = T < 100 ? [8.07131, 1730.63, 233.426] : [8.14019, 1810.94, 244.485];
  return Math.pow(10, A - B / (Cc + T)) * 0.00133322;
}

export class Plant {
  constructor() { this.p = { ...PARAMS }; this.reset(); }
  reset() {
    const p = this.p;
    this.t = 0;
    this.out = { pump: 0, v3: 0, ssr: 0, relay: 0, buzzer: 0, led: [0, 0, 0, 0], status: 0 };
    this.mainSwitch = true;
    this.tank = { ml: 1600, present: true, hose: true };
    this.boiler = { T: p.ambient, ml: p.boilerML, metalT: p.ambient, dry: false, fuse: false };
    this.pre = { T: p.ambient };
    this.ntc = { boiler: p.ambient, pre: p.ambient };
    this.line = { P: 0, Q: 0, pumpQ: 0, opvQ: 0, Pg: 0, Pc: 0, Ptrap: 0, Psat: 0 };   // Pg = 게이지 표시, Pc = 밀폐 회로(열팽창), Psat = 증기압(게이지)
    this.prevBoilerT = p.ambient;
    this.group = { P: 0, out: 0, T: p.ambient, air: 0, vent: 0, drain: 0, sputter: 0 };
    this.pf = { kind: 'coffee', fresh: true, wet: 0, ext: 0, R: 0, locked: true };   // kind: coffee | blind | none
    this.cup = { present: true, ml: 0, T: p.ambient, coffee: 0 };
    this.drip = 0;
    this.shot = null;          // {t0, ml, firstDrop, pmax}
    this.lastShot = null;
    this.events = [];
    this.heaterE = 0;          // 누적 소비전력 Wh
    this.firstFill = false;    // 출고 상태(보일러 빈) 재현
    this.drainOpen = false;    // 디퓨저·하단 고정 볼트 제거(워터 드레인 준비)
  }
  factoryEmpty() { this.boiler.ml = 0; this.firstFill = true; }

  /** GPIO 출력 반영 (port: 0=A,1=B,2=C) */
  setGpio(port, odr) {
    const o = this.out;
    if (port === 1) {
      o.pump = (odr >> 14) & 1; o.v3 = (odr >> 15) & 1; o.relay = (odr >> 12) & 1; o.ssr = (odr >> 13) & 1;
      o.led = [(odr >> 9) & 1, (odr >> 8) & 1, (odr >> 5) & 1, (odr >> 4) & 1];
    } else if (port === 0) o.buzzer = ((odr >> 8) & 1) ? 0 : 1;
    else if (port === 2) o.status = ((odr >> 13) & 1) ? 0 : 1;
  }

  step(dt) {
    const p = this.p, o = this.out, b = this.boiler, pf = this.pf, g = this.group, L = this.line;
    const on = this.mainSwitch;
    this.t += dt;
    const pump = on && o.pump, v3 = on && o.v3;
    const relay = on && o.relay, heat = relay && o.ssr && !b.fuse;

    /* ── 열: 보일러(물+금속), 프리히팅 블록 ── */
    const Cw = b.ml * CW, Cm = p.boilerMetalC;
    let Pin = heat ? p.heaterW : 0;
    if (heat) this.heaterE += p.heaterW * dt / 3600;
    // 빈 보일러: 히터 열이 금속으로만 → 급가열(안전 써모 160℃ 차단)
    const loss = p.lossUA * (b.T - p.ambient);
    b.T += (Pin - loss) * dt / (Cw + Cm);
    b.dry = b.ml < p.boilerML * 0.3 && heat;
    if (b.T > 165) { b.fuse = true; this.ev('⚠ 공가열 — 보일러 안전 써모스탯(165℃) 차단. 리셋: 상태 탭'); }
    // 프리히팅 블록(100W, 바이메탈 차단 ~96℃)
    const preOn = relay && this.pre.T < p.preCutoff;
    this.pre.T += ((preOn ? p.preheatW : 0) - p.preUA * (this.pre.T - p.ambient)) * dt / p.preC;
    // NTC 지연(센서 웰)
    this.ntc.boiler += (b.T - this.ntc.boiler) * Math.min(1, dt / 2.5);
    this.ntc.pre += (this.pre.T - this.ntc.pre) * Math.min(1, dt / 4);

    /* ── 유체 ── */
    const tankOK = this.tank.present && this.tank.hose && this.tank.ml > 20;
    let pumpQ = 0, P = 0;
    // 그룹 하류 저항(bar·s/mL): 포터필터 없음 = 거의 개방, 블라인드 = 막힘, 커피 = 퍽
    const boilerFull = b.ml >= p.boilerML - 0.5;
    let R;
    if (!v3) R = Infinity;                                   // 3WAY 닫힘 → 보일러 출구 막힘
    else if (pf.kind === 'none') R = 0.12;
    else if (pf.kind === 'blind') R = Infinity;
    else R = this.puckR();
    if (pump && tankOK) {
      // 퍽 적심(초기 흡수) 단계: 저항 낮음
      const Qmax = p.pumpQmax;
      if (!boilerFull) P = 0.4;                              // 빈 보일러 채우는 중: 공기만 밀려남
      else if (R === Infinity) P = p.opv;
      else P = Math.min(p.opv, Qmax / (Qmax / p.pumpPmax + 1 / R));
      pumpQ = Qmax * Math.max(0, 1 - P / p.pumpPmax);
    }
    // 3WAY 가 열리는 순간: 갇혀 있던 보일러 압력(열팽창)이 그룹 쪽으로 이어짐
    if (v3 && !this.prevV3) L.P = Math.max(L.P, L.Pg);
    // 압력 동특성(배관·퍽 유연성)
    const Ptgt = pump && tankOK ? P : (v3 && R !== Infinity && pf.kind === 'coffee' ? 0 : (v3 ? g.P * 0.5 : 0));
    L.P += (Ptgt - L.P) * Math.min(1, dt / (pump ? 0.6 : 0.25));
    if (!pump && !v3) L.P *= Math.exp(-dt / 0.2);
    // 실제 그룹 유량
    let groupQ = 0;
    if (v3 && R !== Infinity && boilerFull) groupQ = pump && tankOK ? Math.min(pumpQ, L.P / R) : (pf.kind === 'none' ? 0 : L.P / R * 0.3);
    if (pf.kind === 'coffee' && pf.wet < this.puckAbsorb()) {          // 퍽이 물을 먹는 중 — 아래로 안 나옴
      const take = Math.min(groupQ * dt, this.puckAbsorb() - pf.wet);
      pf.wet += take; groupQ = Math.max(0, groupQ - take / dt);
    }
    const opvQ = pump && tankOK ? Math.max(0, pumpQ - groupQ - (boilerFull ? 0 : pumpQ)) : 0;
    // 보일러 채움(빈 보일러)
    let fillQ = 0;
    if (pump && tankOK && !boilerFull) { fillQ = pumpQ; b.ml = Math.min(p.boilerML, b.ml + fillQ * dt); }
    g.sputter = pump && tankOK && !boilerFull && v3 ? Math.min(1, b.ml / p.boilerML) : 0;   // 공기 섞인 토출
    // 탱크
    if (pump && tankOK) this.tank.ml = Math.max(0, this.tank.ml - (pumpQ - opvQ) * dt);
    // 유입수(프리히팅 블록 통과) → 보일러 열 혼합
    const inQ = groupQ + 0;
    if (inQ > 0 && b.ml > 1) {
      const Tin = this.pre.T;
      const dE = inQ * dt * CW * (Tin - b.T);
      b.T += dE / (b.ml * CW + Cm);
      this.pre.T += -inQ * dt * CW * (this.pre.T - this.tankT()) / (p.preC + 60);
    }
    // Water Drain: 3WAY 열림 + 펌프 없음 → 보일러 물 자연 배출(디퓨저·볼트 제거 상태)
    g.drain = 0;
    if (v3 && !pump && b.ml > 0 && pf.kind === 'none' && this.drainOpen) { const q = Math.min(b.ml, 4.5 * Math.max(0.25, b.ml / p.boilerML)); g.drain = q; b.ml -= q * dt; }
    if (v3 && !pump && !this.drainOpen && this.drainHintT === undefined && pf.kind === 'none') this.drainHintT = this.t;
    if (!(v3 && !pump)) this.drainHintT = undefined;
    else if (this.drainHintT !== undefined && this.t - this.drainHintT > 6 && !this.drainOpen) { this.ev('워터 드레인은 디퓨저·하단 고정 볼트를 제거해야 배출됩니다(사용 탭)'); this.drainHintT = 1e9; }
    // 3WAY 닫힘 직후 잔압 배출(그룹 → 드립트레이)
    if (!v3 && this.prevV3 && pf.kind !== 'none') g.vent = Math.max(g.vent, pf.kind === 'blind' ? 1 : Math.min(1, L.P / 9 + 0.3));
    g.vent = Math.max(0, g.vent - dt * 1.4);
    if (g.vent > 0) this.drip += g.vent * 18 * dt;
    this.prevV3 = v3;

    /* ── 온도에 따른 밀폐 회로 압력(게이지는 펌프 출구~보일러 라인에 연결) ──
     *  3WAY 가 닫히면 펌프 체크밸브 ~ 보일러 ~ 3WAY 가 밀폐 → 가열 시 물의 열팽창(밀도 ρ(T))이 압력으로:
     *  dP = dV / C,  dV = m·(1/ρ(T₂) − 1/ρ(T₁)).  OPV(10bar)가 상한, 정지 펌프 역누설로 천천히 감압, 냉각 시 0 까지(게이지).
     *  100℃ 이상은 포화 증기압(Antoine)이 하한. 공기층(덜 찬 보일러)이 있으면 그만큼 완충. */
    {
      const T1 = this.prevBoilerT, T2 = b.T; this.prevBoilerT = T2;
      const massG = b.ml * waterRho(p.ambient) / 1000;                     // 채운 물의 질량(g) — ml 은 상온 기준 부피
      const dV = massG * 1000 * (1 / waterRho(T2) - 1 / waterRho(T1));     // mL
      const air = Math.max(0, p.boilerML - b.ml);                           // 공기층 mL(대략 등온: dV_air ≈ V·dP/P)
      const C = p.circuitC + air / Math.max(1, 1 + L.Pc);
      L.Psat = Math.max(0, satPressBar(b.T) - 1.01325);
      // 두 성분: ① 열팽창 압력 L.Pc(밀폐돼 있는 동안 dV/C 로 누적, 천천히 역누설) ② 추출 끝에 갇힌 펌프 압력 L.Ptrap(정지 펌프·OPV 시트로 ~2초 만에 빠짐)
      if ((pump && tankOK) || v3) { L.Pc = 0; L.Ptrap = Math.max(L.P, L.Psat); }       // 열려 있거나 펌프가 압력을 정함 → 열팽창 성분 리셋
      else {
        L.Pc += dV / C;                                                     // 열팽창(+) / 수축(−)
        L.Pc -= L.Pc * dt / p.backLeakTau;                                  // 역누설
        L.Pc = Math.max(0, L.Pc);
        if (L.Pc > p.opv) L.Pc = p.opv;                                     // OPV 로 물탱크 복귀
        L.Ptrap = (L.Ptrap || 0) * Math.exp(-dt / 2.0);
      }
      L.Pg = (pump && tankOK) || v3 ? Math.max(L.P, L.Psat) : Math.min(p.opv, Math.max(L.Pc, L.Ptrap || 0, L.Psat));
    }
    L.Q = groupQ; L.pumpQ = pumpQ; L.opvQ = opvQ;
    g.P = L.P; g.T = b.T - (groupQ > 0 ? 1.5 : 3);
    g.out = groupQ + (g.sputter ? pumpQ * 0.0 : 0);
    // 퍽 추출
    if (pf.kind === 'coffee' && groupQ > 0) { pf.ext += groupQ * dt; pf.fresh = false; }
    // 출수 행선지: 잔 / 드립트레이
    const outQ = groupQ + g.drain + (g.sputter ? pumpQ * 0.35 * g.sputter : 0);
    if (outQ > 0) {
      if (this.cup.present && g.drain === 0) {
        const c = this.cup, add = outQ * dt;
        const Tw = pf.kind === 'coffee' ? g.T - 4 : g.T - 2;
        c.T = (c.T * c.ml + Tw * add) / Math.max(1e-6, c.ml + add);
        c.ml += add;
        if (pf.kind === 'coffee') c.coffee += add;
        if (c.ml > p.cupCap) { this.drip += c.ml - p.cupCap; c.ml = p.cupCap; }
      } else this.drip += outQ * dt;
    }
    if (this.cup.present && this.cup.ml > 0) this.cup.T += (p.ambient - this.cup.T) * dt / 600;
    this.drip = Math.min(p.dripCap * 1.05, this.drip);

    /* ── 샷 기록 ── */
    const brewing = v3 && (pump || !!this.shot);       // 프리인퓨전 뜸(펌프 OFF, 3WAY 열림) 동안에도 같은 샷
    if (pump && v3 && !this.shot) this.shot = { t0: this.t, ml: 0, first: null, pmax: 0, kind: pf.kind };
    if (this.shot) {
      const s = this.shot;
      if (brewing) { s.ml += groupQ * dt; s.pmax = Math.max(s.pmax, L.P); if (s.first === null && groupQ > 0.05) s.first = this.t - s.t0; s.dur = this.t - s.t0; }
      else { this.lastShot = { ...s, dur: this.t - s.t0 }; this.shot = null; }
    }
  }
  tankT() { return this.p.ambient - 2; }
  puckAbsorb() { return this.p.dose * 0.95; }
  puckR() {
    // 분쇄도·도징 → 기본 저항, 추출 진행(침식)에 따라 감소. 적심 전엔 낮음
    const p = this.p, pf = this.pf;
    const base = (2.6 + 6 * p.grind) * Math.pow(p.dose / 18, 1.5);
    const wetF = Math.min(1, pf.wet / this.puckAbsorb());
    const erosion = 1 / (1 + pf.ext / 50);
    return Math.max(0.2, base * (0.04 + 0.96 * wetF * wetF) * (0.6 + 0.4 * erosion));
  }
  ev(m) { if (this.events[this.events.length - 1] !== m) this.events.push(m); }

  cmd(name, a) {
    switch (name) {
      case 'mainSwitch': this.mainSwitch = !!a; break;
      case 'pf': if (a !== 'none') this.drainOpen = false; this.pf.kind = a; this.pf.wet = 0; this.pf.ext = 0; this.pf.fresh = true; break;
      case 'freshPuck': this.drainOpen = false; this.pf.kind = 'coffee'; this.pf.wet = 0; this.pf.ext = 0; this.pf.fresh = true; break;
      case 'cup': this.cup.present = !!a; if (!a) { this.cup.ml = 0; this.cup.coffee = 0; } break;
      case 'emptyCup': this.cup.ml = 0; this.cup.coffee = 0; this.cup.T = this.p.ambient; break;
      case 'tankFill': this.tank.ml = this.p.tankCap; break;
      case 'tankSet': this.tank.ml = Math.max(0, Math.min(this.p.tankCap, +a)); break;
      case 'hose': this.tank.hose = !!a; break;
      case 'emptyDrip': this.drip = 0; break;
      case 'fuseReset': this.boiler.fuse = false; break;
      case 'boilerEmpty': this.factoryEmpty(); break;
      case 'drainOpen': this.drainOpen = !!a; if (a) { this.pf.kind = 'none'; } break;
      case 'param': if (a && a.k in this.p) this.p[a.k] = +a.v; break;
      case 'coolDown': this.boiler.T = this.p.ambient; this.pre.T = this.p.ambient; this.ntc.boiler = this.p.ambient; break;
    }
  }

  snapshot() {
    return {
      t: this.t, out: this.out, mainSwitch: this.mainSwitch,
      tank: this.tank, boiler: this.boiler, pre: this.pre, ntc: this.ntc, line: this.line, group: this.group,
      pf: { kind: this.pf.kind, fresh: this.pf.fresh, wet: this.pf.wet, ext: this.pf.ext, R: this.pf.kind === 'coffee' ? this.puckR() : 0 },
      cup: this.cup, drip: this.drip, drainOpen: this.drainOpen, shot: this.shot, lastShot: this.lastShot, heaterE: this.heaterE, p: this.p,
    };
  }
}
