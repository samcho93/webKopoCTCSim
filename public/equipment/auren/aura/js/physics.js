/* =====================================================================
 *  physics.js — AURA ONE 하드웨어 물리 모델 (디지털 트윈 플랜트)
 * ---------------------------------------------------------------------
 *  아우라원.pdf 내부 구성도를 그대로 모델링한다.
 *
 *   급수(수돗물 2.5bar) ─ 로터리 펌프 ─┬─ 유량계-1 ─┬─ 체크밸브 ─ 2WAY-1 ─▶ 스팀보일러
 *                      (OPV 9bar)     │            └─ 그룹보일러1(1kW) ─ 3WAY-1 ─ 그룹헤드1 ─ 퍽 ─ 잔
 *                                     └─ 유량계-2 ─── 그룹보일러2(1kW) ─ 3WAY-2 ─ 그룹헤드2 ─ 퍽 ─ 잔
 *   스팀보일러(3kW, 전극봉 LOW/HIGH, NTC, 바이메탈×2, 릴리프·버큠밸브)
 *     ├─ 2WAY-3 ─ (믹싱: 2WAY-2 + 니들밸브 냉수) ─ 온수팁
 *     ├─ 스팀노브(수동 밸브) ─┬─ 스팀파이프-1 ── 우유 피처(오토스팀 NTC)
 *     │  2WAY-4(오토스팀1) ───┘
 *     └─ 스팀노브(수동 밸브) ─┬─ 스팀파이프-2
 *        2WAY-5(오토스팀2) ───┘
 *
 *  펌웨어 출력(HEAT/SOL/PUMP)을 입력으로 받아 센서값(TEMP/AS/FLOW/LVL/PRES)을 만든다.
 *  단위: ℃, bar(게이지), mL, g, s, W
 * ===================================================================== */
'use strict';

const C_W = 4.186;          // 물 비열 J/(g·K)
const H_FG = 2257;          // 증발잠열 J/g
const PI = Math.PI;

/* 포화증기압(게이지 bar) — Antoine 식 */
function psatGauge(T) {
  if (T < 1) return -1.0;
  const [A, B, Cc] = T < 100 ? [8.07131, 1730.63, 233.426] : [8.14019, 1810.94, 244.485];
  const mmHg = Math.pow(10, A - B / (Cc + T));
  return mmHg * 0.00133322 - 1.01325;
}
/* 물의 체적팽창계수 β(T) 1/K — 20℃ 2.07e-4 · 50℃ 4.6e-4 · 80℃ 6.4e-4 · 100℃ 7.5e-4 (근사 선형) */
const betaW = (T) => 2.07e-4 + 6.5e-6 * (Math.max(4, T) - 20);
/* 밀폐 회로를 T0→T1 로 가열할 때 압력 상승(bar) = ∫β dT / 회로 컴플라이언스(1/bar) */
function thermalRise(T0, T1, compl) {
  const a = Math.max(4, T0) - 20, b = Math.max(4, T1) - 20;
  return (2.07e-4 * (b - a) + 3.25e-6 * (b * b - a * a)) / compl;
}
/* 수평 원통 보일러: 수위 h(m) ↔ 체적(L) */
function cylVol(h, r, L) {
  h = Math.max(0, Math.min(2 * r, h));
  const a = r * r * Math.acos((r - h) / r) - (r - h) * Math.sqrt(Math.max(0, 2 * r * h - h * h));
  return a * L * 1000;
}
function cylLevel(vol, r, L) {
  let lo = 0, hi = 2 * r;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (cylVol(m, r, L) < vol) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * PI * v); }
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/* 1차 지연 센서(서미스터) */
class LagSensor {
  constructor(tau, v) { this.tau = tau; this.v = v; }
  step(x, dt) { this.v += (x - this.v) * (1 - Math.exp(-dt / Math.max(1e-3, this.tau))); return this.v; }
}

/* ── 조정 가능한 시뮬레이터 파라미터(우측 메뉴) ── */
function defaultParams() {
  return {
    ambient: 22,              // 주위 온도 ℃
    inletTemp: 18,            // 수돗물 온도 ℃
    mainsBar: 2.5,            // 수돗물 압력 bar
    waterSupply: true,        // 급수 공급(밸브 열림)
    steamHeaterW: 3000,       // 스팀보일러 히터 W (사양 3~3.6kW)
    groupHeaterW: 1000,       // 그룹보일러 히터 W
    heaterBoost: 1,           // 가열 배속(예열 시간 단축용, 1=실제)
    steamBoilerL: 7.0,        // 스팀보일러 용량 L
    lowProbeMm: 92,           // LOW 전극 끝 높이(mm, 보일러 바닥 기준)
    highProbeMm: 104,         // HIGH 전극 끝 높이
    groupBoilerML: 600,       // 그룹보일러 용량 mL
    pumpMaxBar: 13,           // 로터리 펌프 차단압(부스트) bar
    pumpMaxFlow: 30,          // 로터리 펌프 개방 유량 mL/s
    opvBar: 9.0,              // OPV 설정압 bar
    expBar: 12.0,             // 팽창밸브(그룹 회로 열팽창 릴리프) 개방압 bar
    circuitCompl: 4e-3,       // 밀폐 급수회로 유효 컴플라이언스 1/bar(배관·호스 탄성·잔류 공기) — 작을수록 온도에 민감
    hxVolML: 300,             // KERNDU 열교환관 내 물 mL
    hxTau: 45,                // KERNDU 열교환관 물이 보일러 온도로 데워지는 시정수 s
    fillFlowR: 0.6,           // 보충 경로 저항 bar/(mL/s)
    reliefBar: 2.0,           // 릴리프 밸브 개방압
    flowPulsePerML: 2.0,      // 유량계 펄스/mL (펌웨어 FLOW_PULSES_PER_ML 과 일치)
    flowCal: [1.0, 1.0],      // 유량계 개체 오차 배율
    doseG: 18,                // 원두 투입량 g
    grind: 5,                 // 분쇄도 1(굵게)~10(곱게) → 퍽 저항
    puckFillML: 10,           // 퍽 포화까지 필요한 물 mL(헤드스페이스+흡수) — 첫 방울 ≈3초
    autoPuck: true,           // 추출 시작(3WAY 열림)마다 새 원두로 교체(바리스타가 매 샷 탬핑) — 끄면 사용한 퍽 그대로
    preinfMains: true,        // 펌프 정지 시 수돗물압으로 흐름(로터리펌프 통과)
    milkML: 300,              // 피처 우유 mL
    milkStartC: 5,            // 우유 초기 온도
    needle: 0.5,              // 온수 믹싱 니들밸브 개도 0~1
    ntcTau: 2.5,              // 서미스터 응답 시정수 s
    ntcNoise: 0.05,           // 서미스터 노이즈 σ ℃
    tempWander: 0.22,         // 센서 주변 물의 대류·성층 요동 σ ℃(느린 흔들림 — 설정온도 주변에서 오르내림)
    tempWanderTau: 7,         // 그 요동의 상관시간 s
    grpPreheatUA: 0.75,       // AUREN-PRO 그룹보일러 급수 예열(스팀보일러 속 예열관) NTU 계수 mL/s — 클수록 추출 시 온도 강하가 작다
    levelRipple: true,        // 끓음/스팀 시 수면 요동(전극 채터링)
    // 고장 주입
    faultSteamNtc: 'ok',      // ok | open | short
    faultGroupNtc: ['ok', 'ok'],
    faultFlow: [false, false],// 유량계 고착(펄스 없음)
    faultPump: false,         // 펌프 고장(회전 안 함)
    faultLowProbe: 'ok',      // ok | stuckOn | stuckOff
    faultHighProbe: 'ok',
    faultHeater: false,       // 스팀 히터 단선
    // KERNDU(WCM-001) 열교환 그룹 — 그룹보일러 대신 스팀보일러 속 열교환관(HX) + 써모사이펀
    hxSiphon: 2.45,           // 써모사이펀 열전달 W/K (스팀 122℃ → 그룹 대기 ≈93℃)
    hxUA: 1.9,                // 열교환관 NTU 계수(mL/s) — 출구수온 = Ts − (Ts−Tin)·exp(−hxUA/Q)
  };
}

class AuraPlant {
  constructor() {
    this.model = 'aura';      // 'aura' = AURA ONE(그룹보일러 PID) | 'kerndu' = WCM-001(열교환)
    this.P = defaultParams();
    this.reset(false);
  }

  /* 초기 상태. warm=true 면 예열 완료 상태로 시작 */
  reset(warm) {
    const P = this.P;
    this.t = 0;
    // 액추에이터(펌웨어 출력 미러)
    this.act = { heat: [0, 0, 0], sol: [0, 0, 0, 0, 0, 0, 0], pump: 0, led: new Array(12).fill(0),
                 ledbar: 0, rgb: [0, 0, 0], aux: new Array(8).fill(0), stled: [0, 0, 0, 0] };
    // 스팀보일러
    const T0 = warm ? 122 : P.ambient;
    this.sb = { T: T0, Telem: T0, vol: 4.9, r: 0.08, L: P.steamBoilerL / (PI * 0.08 * 0.08 * 1000),
                bimetal1: true, bimetal2: true, relief: false, vacuumOpen: T0 < 100, steamOut: 0, hwOut: 0, fillIn: 0 };
    this.sb.vol = cylVol(0.098, this.sb.r, this.sb.L);
    // 그룹(보일러 + 헤드 + 퍽)
    this.g = [0, 1].map(() => ({
      T: warm ? 93 : P.ambient, Telem: warm ? 93 : P.ambient, bimetal: true,
      Q: 0, pres: 0, presSensor: 0, flowML: 0, pulses: 0,
      puck: { present: true, kind: 'coffee', sat: 0, ext: 0, used: false }, // kind: coffee|blind|none
      cup: { present: true, ml: 0, T: P.ambient, cap: 300 }, out: 0, purge: 0,
      shot: { on: false, t: 0, steps: [], idle: 99 },   // 추출 단계 기록(펌웨어 3WAY/펌프 출력으로 판별)
    }));
    this.pulseAcc = [0, 0];
    this.pulses = [0, 0];
    // 펌프/라인
    this.line = { pOut: P.mainsBar, qTotal: 0, qFill: 0, opvBypass: 0, pumpOn: false };
    // 펌프 압력계(그룹 급수회로): 밀폐 시 물의 열팽창으로 승압 → 팽창밸브(expBar)에서 배출
    this.line.Tw = this.model === 'kerndu' ? T0 : (warm ? 93 : P.ambient);    // 회로 물 온도(KERNDU = 열교환관 속 물)
    this.line.pGauge = Math.min(P.expBar, P.mainsBar + thermalRise(P.inletTemp, Math.max(P.inletTemp, this.line.Tw), P.circuitCompl));
    this.line.expVent = 0;
    // 스팀 노브(수동 밸브 개도 0~1) / 피처
    this.knob = [0, 0];
    this.pitcher = [0, 1].map(() => ({ present: true, ml: P.milkML, T: P.milkStartC, foam: 0 }));
    this.wandFlow = [0, 0];
    // 온수
    this.hw = { Q: 0, Qmix: 0, Tout: 0, cup: { present: true, ml: 0, T: P.ambient, cap: 400 } };
    this.dripML = 0;
    // 센서(지연+노이즈)
    this.sens = { steam: new LagSensor(P.ntcTau, T0), grp: [new LagSensor(P.ntcTau, this.g[0].T), new LagSensor(P.ntcTau, this.g[1].T)],
                  as: [new LagSensor(1.2, P.ambient), new LagSensor(1.2, P.ambient)] };
    this.lvl = { low: true, high: false, hEff: 0 };
    this.energy = { steamWh: 0, groupWh: [0, 0] };
    this.events = [];
  }

  /* ── 펌웨어 출력 라인 반영 (P4-Sim 프로토콜) ── */
  applyLine(line) {
    const a = line.trim().split(/\s+/);
    const A = this.act;
    switch (a[0]) {
      case 'HEAT': { const i = +a[1]; if (i >= 0 && i < 3) A.heat[i] = clamp(+a[2], 0, 100); break; }
      case 'SOL': { const i = +a[1]; if (i >= 0 && i < 7) A.sol[i] = +a[2] ? 1 : 0; break; }
      case 'PUMP': A.pump = +a[1] ? 1 : 0; break;
      case 'LED': { const i = +a[1]; if (i >= 0 && i < 12) A.led[i] = +a[2] ? 1 : 0; break; }
      case 'LEDBAR': A.ledbar = clamp(+a[1], 0, 255); break;
      case 'RGB': A.rgb = [+a[1], +a[2], +a[3]]; break;
      case 'AUX': { const i = +a[1]; if (i >= 0 && i < 8) A.aux[i] = +a[2] ? 1 : 0; break; }
      case 'STLED': { const i = +a[1]; if (i >= 0 && i < 4) A.stled[i] = +a[2] ? 1 : 0; break; }
      case 'ALLOFF': A.heat = [0, 0, 0]; A.sol.fill(0); A.pump = 0; break;
      case 'RDY': return 'RDY';
      default: return null;
    }
    return a[0];
  }

  /* ── 수압 회로 풀이: 펌프 토출압 pOut 을 찾아 각 분기 유량 결정 ── */
  _hydraulics(dt) {
    const P = this.P, A = this.act, sb = this.sb;
    const pumpOn = A.pump && !P.faultPump && P.waterSupply;
    const pIn = P.waterSupply ? P.mainsBar : 0;
    const pBoiler = Math.max(0, psatGauge(sb.T));
    const branches = [];
    // 보일러 보충: 2WAY-1 + 체크밸브(보일러압 이상일 때만 유입)
    if (A.sol[0]) branches.push({ id: 'fill', p0: pBoiler + 0.1, R: P.fillFlowR });
    // 그룹 추출 분기
    for (let i = 0; i < 2; i++) {
      if (!A.sol[3 + i]) continue;
      const g = this.g[i];
      // 펌프 OFF + 3WAY 열림(프리인퓨전 뜸들이기): 수돗물압은 퍽을 적시기만 하고, 포화되면 흐름이 멈춘다(토출 없음)
      if (!pumpOn && !(g.puck.present && g.puck.kind === 'coffee' && g.puck.sat < 1)) { g.soak = true; continue; }
      branches.push({ id: 'g' + i, p0: 0, R: 0.9 + this._puckR(g) });   // 0.9 = 지클레(0.6mm)+유량계+배관
    }
    const flowAt = (p) => branches.map(b => Math.max(0, (p - b.p0) / b.R));
    const sum = (arr) => arr.reduce((s, x) => s + x, 0);
    let pOut, qs;
    if (pumpOn) {
      // 펌프 특성: p = pIn + Pmax(1 - Q/Qmax), OPV 가 opvBar 에서 바이패스
      const pumpQ = (p) => Math.max(0, P.pumpMaxFlow * (1 - (p - pIn) / P.pumpMaxBar));
      let lo = pIn, hi = pIn + P.pumpMaxBar;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (sum(flowAt(m)) < pumpQ(m)) lo = m; else hi = m;
      }
      pOut = (lo + hi) / 2;
      if (pOut > P.opvBar) { this.line.opvBypass = pumpQ(P.opvBar) - sum(flowAt(P.opvBar)); pOut = P.opvBar; } else this.line.opvBypass = 0;
      qs = flowAt(pOut);
    } else {
      // 펌프 정지: 로터리 펌프는 수돗물압을 그대로 통과(밸브 열린 분기로 저압 흐름)
      pOut = P.preinfMains ? pIn : 0;
      qs = flowAt(pOut);
      this.line.opvBypass = 0;
    }
    this.line.pOut = pOut; this.line.pumpOn = !!pumpOn;
    this.line.qTotal = sum(qs);
    this.line.qFill = 0;
    for (let i = 0; i < 2; i++) this.g[i].Q = 0;
    for (let i = 0; i < 2; i++) if (this.g[i].soak) { this.g[i].soak = false; this.g[i].pres += (pIn * 0.95 - this.g[i].pres) * Math.min(1, dt * 4); }   // 퍽이 수돗물압으로 가압된 채 유지
    branches.forEach((b, k) => {
      if (b.id === 'fill') this.line.qFill = qs[k];
      else { const i = +b.id[1]; this.g[i].Q = qs[k]; this.g[i].pres = qs[k] * this._puckR(this.g[i]) + 0.05; }
    });
    for (let i = 0; i < 2; i++) if (!A.sol[3 + i]) this.g[i].pres = Math.max(0, this.g[i].pres - this.g[i].pres * dt * 6); // 3WAY 배압 해제
  }

  /* ── 펌프 압력계: 그룹 급수회로 압력 ──
   *  펌프·3WAY 가 닫혀 회로가 밀폐되면(급수 체크밸브 ~ 그룹 솔밸브) 물이 데워질수록 부피가 늘어 압력이 오른다.
   *    Δp = β(T)·ΔT / 컴플라이언스  → 팽창밸브(expBar)에서 드립트레이로 배출, 식으면 수돗물압까지 내려옴(체크밸브 보충).
   *  AUREN-PRO: 회로 물 = 그룹보일러 물(PID 로 유지) / KERNDU: 열교환관 속 물 — 추출로 찬물이 들어오면 내려갔다가
   *  보일러 열로 다시 데워지며(hxTau) 압력계가 수돗물압 → 팽창밸브압으로 서서히 오른다(HX 머신 특유의 대기 중 바늘 상승). */
  _gaugeCircuit(dt) {
    const P = this.P, A = this.act, L = this.line;
    const pIn = P.waterSupply ? P.mainsBar : 0;
    const T0 = L.Tw;
    if (this.model === 'kerndu') {
      const q = this.g[0].Q + this.g[1].Q;            // 열교환관을 지나 그룹으로 나간 만큼 찬물 유입
      L.Tw += (q / P.hxVolML) * (P.inletTemp - L.Tw) * dt + (this.sb.T - L.Tw) * (1 - Math.exp(-dt / P.hxTau));
    } else L.Tw = (this.g[0].T + this.g[1].T) / 2;
    const grpOpen = A.sol[3] || A.sol[4];
    if (L.wasPump && !L.pumpOn) L.bleed = 1.5;           // 펌프 정지: 로터리 펌프로 역류 → 잠깐 사이 수돗물압까지 떨어짐
    L.wasPump = L.pumpOn;
    if (L.bleed > 0) { L.bleed -= dt; if (!L.pumpOn) L.pGauge += (pIn - L.pGauge) * (1 - Math.exp(-dt / 0.4)); }
    if (grpOpen) L.pGauge = L.pOut;                    // 그룹으로 열림 = 펌프 토출압(또는 수돗물압)
    else {
      L.pGauge += thermalRise(T0, L.Tw, P.circuitCompl);
      if (L.pumpOn) L.pGauge = Math.max(L.pGauge, L.pOut);   // 펌프가 체크밸브 너머로 밀어 넣음
      L.pGauge = Math.max(pIn, L.pGauge);              // 식으면 체크밸브로 수돗물이 보충 → 수돗물압 아래로 안 내려감
    }
    L.expVent = 0;
    if (L.pGauge > P.expBar) {                         // 팽창밸브 배출(소량) → 드립트레이
      const ml = (L.pGauge - P.expBar) * P.circuitCompl * (this.model === 'kerndu' ? P.hxVolML : 2 * P.groupBoilerML);
      this.dripML += ml; L.expVent = ml / Math.max(1e-3, dt); L.pGauge = P.expBar;
    }
  }

  /* 퍽 저항 bar/(mL/s): 포화 진행에 따라 상승, 추출 진행에 따라 침식으로 감소 */
  _puckR(g) {
    const pk = g.puck;
    if (!pk.present || pk.kind === 'none') return 0.08;           // 포터필터 없음(플러시)
    if (pk.kind === 'blind') return 400;                         // 블라인드 바스켓(백플러시)
    const P = this.P;
    const R0 = (2.0 + 0.9 * P.grind) * (P.doseG / 18);          // 분쇄도 5 → 6.5 → 9bar 에서 ≈1.2mL/s, 퍽 ≈7.9bar
    const sat = clamp(pk.sat, 0, 1);
    const erosion = Math.max(0.55, 1 - 0.0075 * pk.ext);         // 추출이 진행되며 퍽 침식(유량 증가)
    return 0.6 + (R0 * erosion - 0.6) * Math.pow(sat, 4);        // 건조 퍽: 헤드스페이스 충전 동안 저항 낮다가 포화 직전 급상승
  }

  /* 추출 단계 판별 — 펌웨어 출력(3WAY·펌프)만으로 프리인퓨전 2단계를 구분한다.
   *  fill   : 3WAY + 펌프 ON (프리인퓨전 급수 또는 일반 추출 시작)
   *  wait   : 3WAY 열림 + 펌프 OFF = 프리인퓨전 뜸들이기(수돗물압만)
   *  extract: 뜸들이기 후 펌프 재가동 = 본추출
   *  steps = [{ph, t}] 이번 샷의 단계별 경과(초) — UI 타임라인 */
  _shotPhase(g, i, dt) {
    const sh = g.shot, open = !!this.act.sol[3 + i];
    if (!open) { if (sh.on) { sh.on = false; sh.idle = 0; } sh.idle += dt; return; }
    if (!sh.on) {
      sh.on = true; sh.t = 0; sh.steps = []; sh.idle = 0;
      // 새 샷: 사용한 퍽은 버리고 새 원두(건조 퍽) — 첫 방울까지 퍽 적시는 시간(≈3초)이 매번 재현된다.
      // 프리인퓨전이면 ①급수가 이 적시기를 대신하고 ②뜸들이기 동안 토출 없이 머금은 뒤 ③본추출에서 바로 토출.
      if (this.P.autoPuck && g.puck.kind === 'coffee' && g.puck.used) this.freshPuck(i);
    }
    const pump = this.line.pumpOn;
    const waited = sh.steps.some(s => s.ph === 'wait');
    const ph = !pump ? 'wait' : waited ? 'extract' : 'fill';
    const last = sh.steps[sh.steps.length - 1];
    if (!last || last.ph !== ph) sh.steps.push({ ph, t: 0 });
    sh.steps[sh.steps.length - 1].t += dt;
    sh.t += dt;
  }

  step(dt) {
    const P = this.P, A = this.act, sb = this.sb;
    this.t += dt;
    this._hydraulics(dt);

    /* ── 그룹: 퍽/잔/그룹보일러 ── */
    let hxDraw = 0;                                   // KERNDU: 열교환관이 보일러에서 가져가는 열(W)
    for (let i = 0; i < 2; i++) {
      const g = this.g[i], pk = g.puck;
      this._shotPhase(g, i, dt);
      const q = g.Q * dt;                             // 이번 스텝 유입 mL
      // 유량계 펄스(유량계-1 은 보충 유량도 계측)
      const fm = q + (i === 0 ? this.line.qFill * dt : 0);
      if (!P.faultFlow[i]) {
        this.pulseAcc[i] += fm * P.flowPulsePerML * P.flowCal[i];
        const n = Math.floor(this.pulseAcc[i]);
        if (n > 0) { this.pulses[i] += n; this.pulseAcc[i] -= n; }
      }
      g.flowML += q;
      // 퍽 포화/추출
      let outV = 0;                                  // 이번 스텝 퍽 통과 유출량(mL)
      if (q > 0) {
        if (pk.present && pk.kind === 'coffee') {
          if (pk.sat < 1) {
            const need = (1 - pk.sat) * P.puckFillML;
            const used = Math.min(q, need);
            pk.sat += used / P.puckFillML;
            const rest = q - used;
            if (rest > 0) { outV = rest; pk.ext += dt; }
          } else { outV = q; pk.ext += dt; }
          pk.used = true;
        } else if (!pk.present || pk.kind === 'none') outV = q;    // 그대로 낙수
        // blind: 유출 없음(압력만)
      }
      if (!this.line.pumpOn) outV = 0;                // 펌프 정지(프리인퓨전 뜸들이기): 퍽에 머금을 뿐 잔으로 토출 없음
      // 3WAY 닫힘 시 잔압 배출 → 드립트레이
      if (!A.sol[3 + i] && g.pres > 0.3) { this.dripML += g.pres * 0.4 * dt; g.purge = 1; } else g.purge = Math.max(0, g.purge - dt * 2);
      // 잔
      if (outV > 0) {
        if (g.cup.present) {
          const Tin = g.T - 4;                         // 샤워스크린/퍽 열손실
          g.cup.T = (g.cup.T * g.cup.ml + Tin * outV) / (g.cup.ml + outV);
          g.cup.ml += outV;
          if (g.cup.ml > g.cup.cap) { this.dripML += g.cup.ml - g.cup.cap; g.cup.ml = g.cup.cap; }
        } else this.dripML += outV;
      }
      g.out = outV / dt;                           // 표시·효과용 유출 유량(mL/s)
      if (g.cup.present && g.cup.ml > 0) g.cup.T += (P.ambient - g.cup.T) * dt / 600;
      if (this.model === 'kerndu') {
        // 열교환(HX) 그룹: 펌프 물이 스팀보일러 속 열교환관을 지나 데워진 뒤 그룹으로(그룹 히터 없음).
        // 대기 중에는 써모사이펀 순환이 그룹헤드를 보일러 온도 쪽으로 유지, 플러시(대유량)는 그룹을 식힌다.
        const C = 2200;                                  // 황동 그룹헤드 + 써모사이펀 루프 물 J/K
        const hxOut = sb.T - (sb.T - P.inletTemp) * Math.exp(-P.hxUA / Math.max(0.05, g.Q));
        const siphon = P.hxSiphon * (sb.T - g.T);
        g.T += (siphon - 1.0 * (g.T - P.ambient) + g.Q * C_W * (hxOut - g.T)) * dt / C;
        g.Telem = 0;
        hxDraw += siphon + g.Q * C_W * Math.max(0, hxOut - P.inletTemp);   // 보일러에서 빠져나가는 열
        g.presSensor += (g.pres - g.presSensor) * (1 - Math.exp(-dt / 0.15));
        continue;
      }
      // 그룹 보일러 열수지
      const C = P.groupBoilerML * C_W + 900;          // 물 + 황동/스테인리스
      const on = A.heat[1 + i] > 0 && g.bimetal;
      g.Telem += ((on ? P.groupHeaterW * P.heaterBoost : 0) - g.Telem) * (1 - Math.exp(-dt / 10)); // 엘리먼트 열지연(W) — 피복·물 경계층
      // 추출 급수: 스팀보일러 속 예열관을 지나 데워진 물이 그룹보일러로(출구 = Ts − (Ts−Tin)·exp(−UA/Q)) → 샷 동안 1~2℃ 강하
      const tFeed = g.Q > 0.01 ? sb.T - (sb.T - P.inletTemp) * Math.exp(-P.grpPreheatUA / g.Q) : P.inletTemp;
      if (g.Q > 0.01) hxDraw += g.Q * C_W * Math.max(0, tFeed - P.inletTemp);     // 예열 열은 스팀보일러에서
      let Qw = g.Telem - 1.1 * (g.T - P.ambient) - g.Q * C_W * (g.T - tFeed);
      g.T += Qw * dt / C;
      if (on) this.energy.groupWh[i] += P.groupHeaterW * dt / 3600;
      if (g.T > 120) g.bimetal = false;               // 그룹 바이메탈 차단
      if (!g.bimetal && g.T < 100) g.bimetal = true;
      g.presSensor += (g.pres - g.presSensor) * (1 - Math.exp(-dt / 0.15));
    }

    this._gaugeCircuit(dt);

    /* ── 스팀 보일러 ── */
    const pg = psatGauge(sb.T);
    // 버큠밸브: 100℃ 미만이면 열림(공기 유입). 100℃ 도달 후 공기·증기를 일정시간 배출(퍼지)하면
    // 증기압에 밀려 닫힌다 → 이후 보일러는 밀폐 포화상태로 승압.
    if (sb.T < 98) sb.airPurge = 0;
    sb.vacuumOpen = sb.T < 100 || (sb.airPurge || 0) < 25;
    const level = cylLevel(sb.vol, sb.r, sb.L);
    // 스팀 배출: 수동 노브 + 오토스팀 솔밸브(2WAY-4/5) → 각 스팀파이프
    let steamG = 0;
    for (let w = 0; w < 2; w++) {
      const open = clamp(this.knob[w] + (A.sol[5 + w] ? 0.8 : 0), 0, 1.2);
      const f = (pg > 0 && level > 0.02) ? 1.15 * open * Math.sqrt(pg) : 0;   // g/s
      this.wandFlow[w] = f;
      steamG += f;
      // 피처(우유) 가열 — 오토스팀 NTC 가 이 온도를 측정
      const pt = this.pitcher[w];
      if (f > 0 && pt.present) {
        const m = f * dt;
        const heat = m * (H_FG + C_W * (100 - pt.T));
        pt.T += heat / ((pt.ml + 0.5) * 3.9);
        pt.ml += m;
        if (pt.T < 65) pt.foam = Math.min(1, pt.foam + dt * 0.04 * open);
      } else if (pt.present) pt.T += (P.ambient - pt.T) * dt / 900;
    }
    // 릴리프 밸브
    sb.relief = pg > P.reliefBar;
    if (sb.relief) steamG += 4 * (pg - P.reliefBar + 0.1);
    sb.steamOut = steamG;
    // 온수: 2WAY-3 개방 → 보일러수 배출(증기압 구동), 2WAY-2 + 니들 → 냉수 믹싱
    this.hw.Q = (A.sol[2] && pg > 0.02 && level > 0.03) ? 9.5 * Math.sqrt(pg) : 0;   // mL/s
    this.hw.Qmix = (A.sol[1] && A.sol[2] && P.waterSupply) ? 8 * P.needle * Math.sqrt(P.mainsBar / 2.5) : 0;
    const hwOut = this.hw.Q + this.hw.Qmix;
    if (hwOut > 0) {
      const Th = Math.min(sb.T, 98);                  // 대기압으로 나오며 플래시 → ~98℃
      this.hw.Tout = (this.hw.Q * Th + this.hw.Qmix * P.inletTemp) / hwOut;
      const c = this.hw.cup;
      const v = hwOut * dt;
      if (c.present) { c.T = (c.T * c.ml + this.hw.Tout * v) / (c.ml + v); c.ml += v; if (c.ml > c.cap) { this.dripML += c.ml - c.cap; c.ml = c.cap; } }
      else this.dripML += v;
    } else this.hw.Tout = 0;
    if (this.hw.cup.present && this.hw.cup.ml > 0) this.hw.cup.T += (P.ambient - this.hw.cup.T) * dt / 600;
    sb.hwOut = this.hw.Q;
    sb.fillIn = this.line.qFill;
    // 질량수지(mL)
    const flashFrac = sb.T > 100 ? C_W * (sb.T - 100) / H_FG : 0;  // 온수 배출 시 일부 플래시(증기)
    sb.vol = Math.max(0.05, sb.vol + (this.line.qFill - this.hw.Q - steamG) * dt / 1000);
    sb.vol = Math.min(sb.vol, cylVol(2 * sb.r - 0.004, sb.r, sb.L));
    // 열수지
    const mW = sb.vol * 1000;                          // g
    const C = mW * C_W + 4200;                        // 물 + 스테인리스 동체
    const elemWet = level > 0.035;                    // 엘리먼트 침수 여부
    const on = A.heat[0] > 0 && sb.bimetal1 && sb.bimetal2 && !P.faultHeater;
    sb.Telem += ((on ? P.steamHeaterW * P.heaterBoost : 0) - sb.Telem) * (1 - Math.exp(-dt / 8));
    let Q = sb.Telem * (elemWet ? 1 : 0.15)
          - 1.4 * (sb.T - P.ambient)
          - this.line.qFill * C_W * (sb.T - P.inletTemp)
          - steamG * H_FG
          - hxDraw
          - this.hw.Q * flashFrac * H_FG * 0.0;           // 플래시는 출구에서 발생(보일러 열 무관)
    // 대기압 개방(버큠밸브 열림) 상태에서 100℃ 이상은 비등으로 소모
    if (sb.vacuumOpen && sb.T >= 100 && Q > 0) {
      const boil = 0.8 * Q / H_FG; sb.vol -= boil * dt / 1000; Q *= 0.2;   // 퍼지 중: 대부분 비등 배출
      sb.airPurge = (sb.airPurge || 0) + dt;
    }
    sb.T += Q * dt / C;
    if (on) this.energy.steamWh += P.steamHeaterW * dt / 3600;
    // 바이메탈(온도스위치) 2개: ①자동복귀 150/135℃ ②수동복귀 170℃
    if (sb.T > 150) sb.bimetal1 = false; else if (sb.T < 135) sb.bimetal1 = true;
    if (sb.T > 170 || (!elemWet && sb.Telem > 2500)) sb.bimetal2 = false;

    /* ── 수위 전극(전도식) — 끓음/스팀 시 수면 요동 ── */
    let ripple = 0;
    if (P.levelRipple) {
      const boil = on ? 0.0012 : 0;
      const draw = Math.min(0.004, (steamG + this.hw.Q * 0.05) * 0.0018);
      ripple = (boil + draw) * (Math.sin(this.t * 13.7) * 0.6 + gauss() * 0.4);
    }
    const hEff = level + ripple;
    this.lvl.hEff = hEff;
    let low = hEff * 1000 >= P.lowProbeMm, high = hEff * 1000 >= P.highProbeMm;
    if (P.faultLowProbe === 'stuckOn') low = true; else if (P.faultLowProbe === 'stuckOff') low = false;
    if (P.faultHighProbe === 'stuckOn') high = true; else if (P.faultHighProbe === 'stuckOff') high = false;
    this.lvl.low = low; this.lvl.high = high; this.lvl.level = level;

    /* ── 서미스터(지연+노이즈) ── */
    // 센서 주변 물의 대류·성층 요동(오른슈타인-울렌벡): 히터가 켜지고 꺼질 때마다 센서 쪽 물이 조금씩 다르게 데워져
    // 표시 온도가 설정온도 주변에서 천천히 오르내린다(PID 도 이 값을 보고 반응 → 실제 머신처럼 ±0.3~0.5℃ 흔들림)
    if (!this.wander) this.wander = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const heatK = k === 0 ? sb.Telem / Math.max(1, P.steamHeaterW) : (this.g[k - 1].Telem || 0) / Math.max(1, P.groupHeaterW);
      const sig = P.tempWander * (k === 0 ? 1.3 : 1) * (0.6 + 0.8 * heatK);   // 가열 중일수록(대류) 크게, 스팀보일러는 끓음으로 더 크게
      const tau = Math.max(0.5, P.tempWanderTau);
      this.wander[k] += -this.wander[k] * dt / tau + sig * Math.sqrt(2 * dt / tau) * gauss();
    }
    this.sens.steam.tau = P.ntcTau;
    this.sens.steam.step(sb.T, dt);
    for (let i = 0; i < 2; i++) { this.sens.grp[i].tau = P.ntcTau; this.sens.grp[i].step(this.g[i].T, dt); }
    for (let w = 0; w < 2; w++) {
      const pt = this.pitcher[w];
      // 피처가 있으면 우유 온도, 없으면 스팀이 센서를 직접 가열
      const target = pt.present ? pt.T : (this.wandFlow[w] > 0 ? 100 : P.ambient + 6);
      this.sens.as[w].step(target, dt);
    }
  }

  /* 펌웨어로 보낼 센서 값 */
  sensorTemp(id) {
    const P = this.P;
    const fault = id === 0 ? P.faultSteamNtc : P.faultGroupNtc[id - 1];
    if (fault === 'open') return NaN;
    if (fault === 'short') return 250;
    const v = id === 0 ? this.sens.steam.v : this.sens.grp[id - 1].v;
    return v + (this.wander ? this.wander[id] : 0) + gauss() * P.ntcNoise;
  }
  sensorAS(i) { return this.sens.as[i].v + gauss() * this.P.ntcNoise; }

  /* 사용자 조작 */
  emptyCup(which) {
    if (which === 'hw') { this.hw.cup.ml = 0; this.hw.cup.T = this.P.ambient; return; }
    const g = this.g[which]; g.cup.ml = 0; g.cup.T = this.P.ambient;
  }
  freshPuck(i) { Object.assign(this.g[i].puck, { sat: 0, ext: 0, used: false }); }
  newMilk(w) { Object.assign(this.pitcher[w], { ml: this.P.milkML, T: this.P.milkStartC, foam: 0 }); }

  /* 브라우저 표시용 스냅샷 */
  snapshot() {
    const sb = this.sb, A = this.act;
    return {
      t: this.t, model: this.model,
      act: A,
      steam: { T: sb.T, sensor: this.sens.steam.v + (this.wander ? this.wander[0] : 0), pres: Math.max(0, psatGauge(sb.T)), volL: sb.vol,
               levelMm: this.lvl.level * 1000, hEffMm: this.lvl.hEff * 1000, low: this.lvl.low, high: this.lvl.high,
               bimetal1: sb.bimetal1, bimetal2: sb.bimetal2, relief: sb.relief, vacuumOpen: sb.vacuumOpen,
               heaterW: sb.Telem, steamOut: sb.steamOut, hwOut: sb.hwOut, fillIn: sb.fillIn,
               levelMaxMm: sb.r * 2000, lowMm: this.P.lowProbeMm, highMm: this.P.highProbeMm },
      line: this.line,
      groups: this.g.map((g, i) => ({ T: g.T, sensor: this.sens.grp[i].v + (this.wander ? this.wander[i + 1] : 0), Q: g.Q, pres: g.presSensor, flowML: g.flowML,
               pulses: this.pulses[i], heaterW: g.Telem, bimetal: g.bimetal, out: g.out, purge: g.purge,
               puck: g.puck, cup: g.cup, shot: g.shot })),
      knob: this.knob, wandFlow: this.wandFlow, pitcher: this.pitcher,
      as: this.sens.as.map(s => s.v),
      hw: { Q: this.hw.Q, Qmix: this.hw.Qmix, Tout: this.hw.Tout, cup: this.hw.cup },
      dripML: this.dripML, energy: this.energy,
    };
  }
}

const __exp = { AuraPlant, defaultParams, psatGauge, cylVol, cylLevel };
if (typeof module !== 'undefined' && module.exports) module.exports = __exp;   // Node(서버)
else globalThis.AuraPhysics = __exp;                                            // 브라우저(웹 배포 런타임)
