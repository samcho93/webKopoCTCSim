// machine.js — BELLA ONE 3D: CATIA STEP 메쉬 + 재질 + 조작부(OLED·버튼·게이지) + 소품(포터필터·잔·유리 물병·호스·메인 스위치)
//  좌표(m): x=폭(오른쪽+), y=위, z=정면(+). 바닥 중앙 원점. 그룹 중심 (0, 0.179, 0.051)
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { loadBellaModel } from './model.js';

export const DIM = {
  groupC: new THREE.Vector3(0, 0.179, 0.051),   // 그룹 하단 중심(샤워스크린)
  trayY: 0.0435,                                // 드립트레이 커버 윗면
  oled: { c: new THREE.Vector3(0, 0.2815, 0.1316), w: 0.0545, h: 0.0272 },
  gauge: { c: new THREE.Vector3(0.052, 0.1365, -0.0034), r: 0.0192 },
  btnX: [-0.033, -0.011, 0.011, 0.033], btnY: 0.233, btnZ: 0.134,
  inlet: new THREE.Vector3(0.036, 0.018, -0.1425),
  bottle: new THREE.Vector3(0.2, 0, -0.07),
};

/* ───────── 재질 ───────── */
function brushedTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#808080'; g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 1400; i++) { const y = Math.random() * 64, a = Math.random() * 0.18; g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${a})`; g.fillRect(0, y, 512, Math.random() * 1.2 + 0.2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 4);
  return t;
}
function woodTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 256, 0); grd.addColorStop(0, '#5a3218'); grd.addColorStop(0.5, '#7a4522'); grd.addColorStop(1, '#4e2a14');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 70; i++) {
    g.strokeStyle = `rgba(${30 + Math.random() * 30},${14 + Math.random() * 10},5,${0.25 + Math.random() * 0.35})`; g.lineWidth = 0.6 + Math.random() * 2.2;
    g.beginPath(); let x = Math.random() * 256; g.moveTo(x, 0);
    for (let y = 0; y <= 512; y += 16) { x += (Math.random() - 0.5) * 5; g.lineTo(x, y); } g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
export function makeMaterials() {
  const brushed = brushedTexture();
  const M = {
    white: new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, roughness: 0.32, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.25 }),
    steel: new THREE.MeshPhysicalMaterial({ color: 0xc8ccd1, metalness: 1, roughness: 0.3, roughnessMap: brushed }),
    steelV: new THREE.MeshPhysicalMaterial({ color: 0xc4c8cd, metalness: 1, roughness: 0.32, roughnessMap: brushed }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x6d7076, metalness: 1, roughness: 0.38 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xeaecef, metalness: 1, roughness: 0.07 }),
    blackGlass: new THREE.MeshPhysicalMaterial({ color: 0x020203, roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 }),
    black: new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.55 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.92 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xc19a5b, metalness: 1, roughness: 0.32 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc27347, metalness: 1, roughness: 0.3 }),
    pcb: new THREE.MeshStandardMaterial({ color: 0x1f5a34, roughness: 0.55 }),
    bluepill: new THREE.MeshStandardMaterial({ color: 0x1a3c8c, roughness: 0.5 }),
    alu: new THREE.MeshStandardMaterial({ color: 0xb4b8bc, metalness: 0.85, roughness: 0.42 }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x2b2d30, roughness: 0.6 }),
    whitePlastic: new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.5 }),
    heater: new THREE.MeshStandardMaterial({ color: 0x5a5550, metalness: 0.7, roughness: 0.45, emissive: 0xff3a10, emissiveIntensity: 0 }),
    coil: new THREE.MeshStandardMaterial({ color: 0xa04a2a, metalness: 0.6, roughness: 0.4, emissive: 0xffaa33, emissiveIntensity: 0 }),
    silicone: new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.3, transparent: true, opacity: 0.8 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xeef7fb, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.09, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 0.9 }),
    wood: new THREE.MeshPhysicalMaterial({ map: woodTexture(), roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    water: new THREE.MeshPhysicalMaterial({ color: 0x9cc9e4, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false }),
    coffee: new THREE.MeshPhysicalMaterial({ color: 0x2a1406, roughness: 0.15, clearcoat: 1 }),
    crema: new THREE.MeshStandardMaterial({ color: 0xa8692f, roughness: 0.6 }),
    dial: null,
  };
  return M;
}

/* 메쉬 인덱스 분류(STEP 부품 조사 결과 — inspect.html) */
const IDX = {
  white: [141, 776, 795],
  steel: [803, 804, 793, 798, 814, 786, 787, 781, 782, 783, 784, 785, 788, 789, 790, 791, 792],
  steelV: [47],
  chromeTrim: [98, 130, 148, 149],     // 헤드 하단 띠·그룹 주변 커버 → 경면 크롬(참조 렌더)
  steelDark: [794],
  btnCap: [185, 188, 187, 186],        // 추출1, 추출2, 설정, 전원 (왼→오)
  oledGlass: [199], oledBezel: [207, 200, 768],
  gauge: [52],
  heater: [64],
  pump: [219, 220, 221, 222, 223, 218, 224],
  valve3: [113, 114],
  pcb: [232],
  preheat: [772, 127],
};
/* 모서리를 각지게 만들 외장 부품(헤드 커버·뒤/옆 패널·상판 프레임·드립트레이·크롬 띠·중간 패널) */
const SQUARE = [141, 776, 795, 793, 794, 47];
const LOGO_BOX = [-0.006, 0.016, 0.125, 0.062, 0.038, 0.15];   // 드립트레이 전면 각인 로고(bella one) — 글자 곡면은 벤드 처리 제외
const SQUARE_PLAN = [98];   // 헤드 아래 크롬 띠·하판: 위에서 본 모서리만(경사면은 건드리지 않음)
const SQUARE2 = [];   // 크롬 띠(98·130·148·149)는 복합 모서리라 정사각 사상하면 V 자로 뾰족하게 튀어나옴 → 원형 유지
export const SHELL = [141, 776, 803, 804, 47, 795, 793, 794, 98, 130, 148, 149, 786, 787, 781, 782, 783, 784, 785, 788, 789, 790, 791, 792, 798, 814, 207, 199, 200, 768, 185, 186, 187, 188, 150, 208];

function internalMat(M, name) {
  if (/SCREW|NUT|FRNUT|STUD|STANDOFF|SHCS|RIVET|E-GSBCB/i.test(name)) return M.chrome;
  if (/^GH_|AN15|AN10/.test(name)) return M.chrome;
  if (/RUBBER/i.test(name)) return M.rubber;
  if (/HEATING/i.test(name)) return M.heater;
  if (/brass|NIPPLE|FLARE|OSTERRATH|Y41Z|Part48/i.test(name)) return M.brass;
  if (/PinHeader|SMH|SMW|SMAW|Faston/i.test(name)) return M.plastic;
  if (/PCB|SMT32|SWITCH PCB/i.test(name)) return M.pcb;
  if (/YAAJ|BluePill/i.test(name)) return M.bluepill;
  if (/MAIN FRAME|MMBP|MHCPG|BRACKET|PANEL/i.test(name)) return M.alu;
  if (/IT_DW|C22000|HS001|THC|DSHN|DSFN|EYH/i.test(name)) return M.brass;
  return M.alu;
}

export async function buildMachine(scene, onProgress) {
  const M = makeMaterials();
  const { meta, meshes } = await loadBellaModel();
  const root = new THREE.Group(); root.name = 'AUREN M'; scene.add(root);
  const byIdx = [];
  const setOf = {}; for (const k in IDX) for (const i of IDX[k]) setOf[i] = k;
  const internals = [];
  for (const m of meshes) {
    if (SQUARE.includes(m.i)) squareCorners(m.geometry);   // 외관: 둥근 모서리 → 각진 모서리
    if (SQUARE_PLAN.includes(m.i)) { squareChamfers(m.geometry); squareCorners(m.geometry, 0.0004, [[0, 2]]); }   // 크롬 띠: 평면도(x–z) 모서리만 각지게 → 흰 헤드 모서리와 일치
    if (SQUARE.includes(m.i) || SQUARE2.includes(m.i)) squareBends(m.geometry, m.i === 795 ? LOGO_BOX : null);   // 모든 절곡면(원통 필렛) → 각지게
    const cls = setOf[m.i];
    let mat;
    switch (cls) {
      case 'white': mat = M.white; break;
      case 'steel': mat = M.steel; break;
      case 'steelV': mat = M.steelV; break;
      case 'steelDark': mat = M.steelDark; break;
      case 'btnCap': mat = M.chrome; break;
      case 'chromeTrim': mat = M.chrome; break;
      case 'oledGlass': mat = M.blackGlass; break;
      case 'oledBezel': mat = M.black; break;
      case 'gauge': mat = M.chrome; break;
      case 'heater': mat = M.heater; break;
      case 'pump': mat = m.i === 219 || m.i === 220 ? M.coil : M.brass; break;
      case 'valve3': mat = M.coil.clone(); break;
      case 'pcb': mat = M.pcb; break;
      default: mat = internalMat(M, m.name);
    }
    if (m.i === 0) mat = M.alu;
    if (m.i === 19 || m.i === 20) mat = M.rubber;
    const o = new THREE.Mesh(m.geometry, mat);
    o.name = m.name || `part${m.i}`; o.userData.idx = m.i;
    o.castShadow = true; o.receiveShadow = true;
    root.add(o); byIdx[m.i] = o;
    if (!SHELL.includes(m.i) && !cls) internals.push(o);
  }
  /* 외관 정리(참조 렌더): 헤드 전면·상판으로 비쳐 보이는 체결 부품(스터드·너트·나사 머리)은 외관 모드에서 숨김 */
  const exteriorHidden = [];
  for (const o of internals) {
    const b = o.geometry.boundingBox;
    if ((b.max.z > 0.118 && b.min.y > 0.19) || b.max.y > 0.3195) { o.visible = false; exteriorHidden.push(o); }
  }
  /* 상판: 원본 얇은 판(804) 대신 가로 홈이 뚫린 헤어라인 판 + 어두운 내부 + 모서리 나사 */
  if (byIdx[804]) byIdx[804].visible = false;
  if (byIdx[803]) byIdx[803].visible = false;          // 원본 상판 프레임(모서리 노치·옆면 돌출) → buildTopGrille 의 프레임
  const top = buildTopGrille(M); root.add(top);
  const icons = buildIconPlates(M); root.add(icons);   // 버튼 위 검정 인쇄 도안
  // 후면 각인: 원본 KOREM 글자(781–785, 788–792) 제거 → 스테인리스 돌출 글자 AUREN M
  for (const i of [781, 782, 783, 784, 785, 786, 787, 788, 789, 790, 791, 792]) if (byIdx[i]) byIdx[i].visible = false;   // KOREM 글자 + 지붕 심볼
  const rearBadge = await buildRearBadge(M); if (rearBadge) root.add(rearBadge);
  // 드립트레이 앞면: 'bella one' 각인(x −2.6~58.8, y 18.8~35.7mm, 깊이 0.1mm)을 흰 판으로 덮고 AUREN M
  for (const i of [796, 797]) if (byIdx[i]) byIdx[i].visible = false;   // 원본 로고 부품: 796 'one'(돌출), 797 'bella'(인셋)
  const coverMat = M.white.clone(); coverMat.polygonOffset = true; coverMat.polygonOffsetFactor = -2; coverMat.polygonOffsetUnits = -2;
  const trayCover = new THREE.Mesh(new THREE.PlaneGeometry(0.0675, 0.0205), coverMat);
  trayCover.position.set(0.0281, 0.0272, 0.14135); trayCover.receiveShadow = true; root.add(trayCover);
  const trayBadge = await textBadge(M, 'AUREN M', 0.0085, 0.0005); if (trayBadge) { trayBadge.position.set(0.0281, 0.0272, 0.14138); root.add(trayBadge); }
  // 헤드 전면 판 바로 뒤의 흰 배면판: 체결 구멍·버튼 틈으로 내부(PCB·스터드)가 비치지 않게(외관 모드 전용)
  const backer = new THREE.Mesh(new THREE.PlaneGeometry(0.166, 0.122), new THREE.MeshStandardMaterial({ color: 0xf1f1ef, roughness: 0.6 }));
  backer.position.set(0, 0.265, 0.1288); root.add(backer);
  const exteriorOnly = [backer];
  /* 헤드 아래 크롬 띠: 원본(130 전면·148/149 측면)은 45° 모따기+플랜지 복합 형상이라 각지게 사상 불가 →
   * 숨기고, 헤드 외곽(x ±84.8, 앞 z 131.1mm)에 맞춘 각진 크롬 띠(높이 196.5~202.5mm, 두께 1.2mm)로 교체 */
  for (const i of [130, 148, 149]) if (byIdx[i]) byIdx[i].visible = false;
  const band = buildChromeBand(M); root.add(band);
  // 앞쪽 고무발(드립트레이 하단)이 모델에 없으면 바닥 접지감용으로 작은 발 추가
  for (const [x, z] of [[-0.066, 0.12], [0.066, 0.12]]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0065, 0.01, 20), M.rubber); f.position.set(x, 0.005, z); root.add(f);
  }

  /* ── OLED(SSD1306 128x64) ── */
  const oledCv = document.createElement('canvas'); oledCv.width = 128; oledCv.height = 64;
  const oledTex = new THREE.CanvasTexture(oledCv); oledTex.magFilter = THREE.NearestFilter; oledTex.minFilter = THREE.LinearFilter; oledTex.colorSpace = THREE.SRGBColorSpace;
  const oledMat = new THREE.MeshBasicMaterial({ map: oledTex, transparent: true, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const oled = new THREE.Mesh(new THREE.PlaneGeometry(DIM.oled.w, DIM.oled.h), oledMat);
  oled.position.copy(DIM.oled.c); oled.renderOrder = 5; root.add(oled);
  oled.userData = { kind: 'oled' };

  /* ── 버튼(키캡 누름 + LED 점) ── */
  const buttons = IDX.btnCap.map((ix, i) => {
    const cap = byIdx[ix];
    cap.userData = { kind: 'btn', i, z0: cap.position.z };
    const ledMat = new THREE.MeshStandardMaterial({ color: 0x223040, emissive: 0x7fd0ff, emissiveIntensity: 0, roughness: 0.3 });
    const led = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 20), ledMat);
    led.position.set(DIM.btnX[i], DIM.btnY + 0.0035, DIM.btnZ + 0.00025);
    cap.attach(led);
    // 크롬 베젤 안쪽의 어두운 버튼 면
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.0128, 0.0112, 0.0006, 2, 0.0012), new THREE.MeshPhysicalMaterial({ color: 0x3a3d42, roughness: 0.35, metalness: 0.6, clearcoat: 0.6 }));
    face.position.set(DIM.btnX[i], DIM.btnY, DIM.btnZ + 0.0001); cap.attach(face); face.userData = { kind: 'btn', i };
    led.position.z += 0.0004;
    led.userData = { kind: 'btn', i };
    return { cap, led, ledMat };
  });

  /* ── 압력 게이지(다이얼 + 바늘) ── */
  const dial = new THREE.Mesh(new THREE.CircleGeometry(DIM.gauge.r, 64), new THREE.MeshStandardMaterial({ map: gaugeDial(), roughness: 0.4 }));
  dial.position.copy(DIM.gauge.c); root.add(dial);
  const needlePivot = new THREE.Group(); needlePivot.position.copy(DIM.gauge.c).add(new THREE.Vector3(0, 0, 0.0012)); root.add(needlePivot);
  const nShape = new THREE.Shape(); nShape.moveTo(-0.0007, -0.004); nShape.lineTo(0.0007, -0.004); nShape.lineTo(0.00022, 0.0158); nShape.lineTo(-0.00022, 0.0158);
  const needle = new THREE.Mesh(new THREE.ShapeGeometry(nShape), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 })); needlePivot.add(needle);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(0.0016, 20), M.chrome); hub.position.z = 0.0002; needlePivot.add(hub);
  const gaugeGlass = new THREE.Mesh(new THREE.CircleGeometry(DIM.gauge.r, 48), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.08, depthWrite: false }));
  gaugeGlass.position.copy(DIM.gauge.c).add(new THREE.Vector3(0, 0, 0.0025)); root.add(gaugeGlass);

  /* ── 포터필터(58mm, 2 스파웃, 월넛 손잡이) ── */
  const pf = buildPortafilter(M);
  pf.group.position.copy(DIM.groupC); root.add(pf.group);

  /* ── 잔(이중 유리 에스프레소 잔) ── */
  const cup = buildCup(M);
  cup.group.position.set(0, DIM.trayY, DIM.groupC.z); root.add(cup.group);

  /* ── 외부 유리 물병(2L) + 호스 ── */
  const bottle = buildBottle(M);
  bottle.group.position.copy(DIM.bottle); root.add(bottle.group);
  const hoseTop = new THREE.Vector3().copy(DIM.bottle).add(new THREE.Vector3(0, bottle.h + 0.03, 0));
  const hoseCurve = new THREE.CatmullRomCurve3([
    hoseTop, hoseTop.clone().add(new THREE.Vector3(0, 0.03, -0.01)), new THREE.Vector3(0.16, 0.25, -0.13),
    new THREE.Vector3(0.09, 0.1, -0.175), new THREE.Vector3(0.05, 0.03, -0.17), DIM.inlet.clone().add(new THREE.Vector3(0, 0, -0.012)), DIM.inlet,
  ]);
  const hose = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 120, 0.0042, 14, false), M.silicone); hose.castShadow = true; root.add(hose);
  const hoseWater = new THREE.Mesh(new THREE.TubeGeometry(hoseCurve, 120, 0.0028, 10, false), new THREE.MeshBasicMaterial({ color: 0x8fc4e0, transparent: true, opacity: 0.0, depthWrite: false })); root.add(hoseWater);
  // 내부 흡입관(병 바닥까지)
  const dip = new THREE.Mesh(new THREE.CylinderGeometry(0.0028, 0.0028, bottle.h - 0.01, 10), M.silicone);
  dip.position.copy(DIM.bottle).add(new THREE.Vector3(0.012, bottle.h / 2 + 0.006, 0)); root.add(dip);

  /* ── 후면 메인 전원 스위치(로커) ── */
  const sw = new THREE.Group(); sw.position.set(-0.05, 0.045, -0.1395); root.add(sw);
  const swBase = new THREE.Mesh(new RoundedBoxGeometry(0.024, 0.016, 0.004, 3, 0.0015), M.black); sw.add(swBase);
  const rocker = new THREE.Mesh(new RoundedBoxGeometry(0.019, 0.011, 0.005, 3, 0.0012), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.4, emissive: 0xff2a10, emissiveIntensity: 0 }));
  rocker.position.z = -0.003; sw.add(rocker);
  rocker.userData = { kind: 'mainSwitch' }; swBase.userData = { kind: 'mainSwitch' };

  /* ── 라벨 앵커(내부보기) ── */
  const anchors = {
    boiler: new THREE.Vector3(0, 0.245, 0.11), heater: new THREE.Vector3(0, 0.29, 0.05), pump: new THREE.Vector3(0.03, 0.15, -0.1),
    valve3: new THREE.Vector3(0.06, 0.2, -0.05), preheat: new THREE.Vector3(-0.01, 0.3, -0.01), pcb: new THREE.Vector3(-0.017, 0.12, -0.07),
    gauge: new THREE.Vector3(0.052, 0.165, 0.0), inlet: DIM.inlet.clone().add(new THREE.Vector3(0, 0.02, 0)), oled: new THREE.Vector3(0, 0.305, 0.13),
  };

  const shell = SHELL.map(i => byIdx[i]).filter(Boolean).concat(top.children.filter(o => o.isMesh), [band]);
  const interactive = [...buttons.map(b => b.cap), ...buttons.map(b => b.led), oled, pf.hit, cup.hit, bottle.hit, rocker, swBase];
  return {
    root, M, byIdx, shell, internals, exteriorHidden, exteriorOnly, oled: { mesh: oled, cv: oledCv, tex: oledTex, mat: oledMat }, buttons,
    needle: needlePivot, pf, cup, bottle, hose, hoseWater, hoseCurve, sw: { group: sw, rocker }, anchors, interactive,
    heaterMesh: byIdx[64], pumpMeshes: IDX.pump.map(i => byIdx[i]).filter(Boolean), valveMeshes: IDX.valve3.map(i => byIdx[i]).filter(Boolean), pcb: byIdx[232],
  };
}

function gaugeDial() {
  const S = 512, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), R = S / 2;
  g.fillStyle = '#f7f7f4'; g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.fill();
  const a0 = Math.PI * 0.75, span = Math.PI * 1.5;     // 0 bar = 좌하, 16 bar = 우하
  // 추출 권장 구간(8~11bar)
  g.strokeStyle = 'rgba(70,160,90,.55)'; g.lineWidth = 16; g.beginPath(); g.arc(R, R, R * 0.8, a0 + span * 8 / 16, a0 + span * 11 / 16); g.stroke();
  g.strokeStyle = '#1a1a1a'; g.fillStyle = '#1a1a1a';
  for (let v = 0; v <= 16; v += 0.5) {
    const a = a0 + span * v / 16, major = v % 4 === 0, mid = v % 1 === 0;
    const r1 = R * 0.9, r0 = R * (major ? 0.74 : mid ? 0.8 : 0.84);
    g.lineWidth = major ? 7 : mid ? 4 : 2.5;
    g.beginPath(); g.moveTo(R + Math.cos(a) * r0, R + Math.sin(a) * r0); g.lineTo(R + Math.cos(a) * r1, R + Math.sin(a) * r1); g.stroke();
    if (major) { g.font = '600 62px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(v), R + Math.cos(a) * R * 0.56, R + Math.sin(a) * R * 0.56); }
  }
  g.font = '500 44px "Segoe UI", sans-serif'; g.fillStyle = '#555'; g.fillText('bar', R, R + R * 0.5);
  g.font = '700 30px "Segoe UI", sans-serif'; g.fillStyle = '#8a8a8a'; g.fillText('VALEM', R, R - R * 0.42);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function buildPortafilter(M) {
  const group = new THREE.Group();          // 원점 = 그룹 하단 중심, 장착 위치
  const body = new THREE.Group(); group.add(body);
  // 바스켓 링/몸체
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0365, 0.0355, 0.006, 48), M.chrome); ring.position.y = -0.003; body.add(ring);
  const bowlPts = []; for (let i = 0; i <= 12; i++) { const t = i / 12; bowlPts.push(new THREE.Vector2(0.0355 - 0.006 * t * t, -0.006 - 0.022 * t)); } bowlPts.push(new THREE.Vector2(0, -0.0285));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(bowlPts, 48), M.chrome); body.add(bowl);
  for (const s of [-1, 1]) {                // 잠금 러그
    const lug = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.004, 0.009), M.chrome); lug.position.set(s * 0.039, -0.003, 0); body.add(lug);
  }
  // 스파웃 블록 + 2 스파웃
  const spBlock = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.007, 0.012, 24), M.chrome); spBlock.position.y = -0.034; body.add(spBlock);
  const spouts = [];
  for (const s of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, -0.037, 0), new THREE.Vector3(s * 0.008, -0.041, 0), new THREE.Vector3(s * 0.013, -0.047, 0), new THREE.Vector3(s * 0.0135, -0.053, 0)]);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.0032, 14, false), M.chrome); body.add(tube);
    const tip = new THREE.Object3D(); tip.position.set(s * 0.0135, -0.054, 0); body.add(tip); spouts.push(tip);
  }
  // 목 + 칼라 + 월넛 손잡이 + 끝캡: 모두 하나의 축(바스켓 옆면 → 정면, 약간 아래로) 위에 정렬
  const tilt = 0.14;
  const axis = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt));            // 손잡이 방향
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);   // 원기둥 +y → 축
  const S = new THREE.Vector3(0, -0.011, 0.031);                                  // 바스켓 옆면의 목 시작점
  const along = (part, d) => { part.quaternion.copy(q); part.position.copy(S).addScaledVector(axis, d); body.add(part); return part; };
  const NECK = 0.04, COL = 0.005, HND = 0.115;
  const neck = along(new THREE.Mesh(new THREE.CylinderGeometry(0.0064, 0.0078, NECK, 24), M.chrome), NECK / 2);
  const collar = along(new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0112, COL, 32), M.chrome), NECK + COL / 2);
  const handle = along(new THREE.Mesh(new THREE.CylinderGeometry(0.0135, 0.0108, HND, 32), M.wood), NECK + COL + HND / 2);
  const cap = along(new THREE.Mesh(new THREE.SphereGeometry(0.0135, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.wood), NECK + COL + HND);
  // 바스켓 내용물(커피 퍽 / 블라인드) — 상단에서 보이는 면
  const puck = new THREE.Mesh(new THREE.CircleGeometry(0.0318, 40), new THREE.MeshStandardMaterial({ color: 0x2b1a10, roughness: 0.95 }));
  puck.rotation.x = -Math.PI / 2; puck.position.y = -0.0075; body.add(puck);
  body.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const hit = handle; hit.userData = { kind: 'pf' };
  [ring, bowl, neck, cap, collar, spBlock].forEach(o => o.userData = { kind: 'pf' });
  return { group, body, spouts, puck, hit, parts: [ring, bowl, neck, cap, collar, spBlock, handle], k: 1 };
}

function buildCup(M) {
  const group = new THREE.Group();
  const h = 0.064, r = 0.0275;
  const outer = []; outer.push(new THREE.Vector2(0.0001, 0)); for (let i = 0; i <= 10; i++) { const t = i / 10; outer.push(new THREE.Vector2(r - 0.004 * (1 - t) * (1 - t), t * h)); }
  const glassOut = new THREE.Mesh(new THREE.LatheGeometry(outer, 48), M.glass);
  const inner = []; for (let i = 10; i >= 0; i--) { const t = i / 10; inner.push(new THREE.Vector2(r - 0.004 - 0.005 * (1 - t), 0.012 + t * (h - 0.013))); } inner.push(new THREE.Vector2(0.0001, 0.012));
  const glassIn = new THREE.Mesh(new THREE.LatheGeometry(inner, 48), M.glass);
  group.add(glassOut, glassIn); glassOut.renderOrder = glassIn.renderOrder = 12;
  const liqH = h - 0.016;
  const liq = new THREE.Mesh(new THREE.CylinderGeometry(1, 0.86, 1, 40), M.coffee.clone()); liq.visible = false; group.add(liq);
  const crema = new THREE.Mesh(new THREE.CircleGeometry(1, 40), M.crema.clone()); crema.rotation.x = -Math.PI / 2; crema.visible = false; group.add(crema);
  glassOut.userData = { kind: 'cup' };
  glassOut.castShadow = true;
  return { group, liq, crema, hit: glassOut, h, r, liqH, base: 0.012, rIn: r - 0.004 };
}

function buildBottle(M) {
  const group = new THREE.Group();
  const h = 0.215, r = 0.062;
  const pts = [new THREE.Vector2(0.0001, 0.003)];
  for (let i = 0; i <= 8; i++) { const a = i / 8 * Math.PI / 2; pts.push(new THREE.Vector2(r - 0.008 + Math.sin(a) * 0.008, 0.008 - Math.cos(a) * 0.005 + 0.003)); }
  pts.push(new THREE.Vector2(r, h - 0.01), new THREE.Vector2(r - 0.002, h));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), M.glass); glass.renderOrder = 12; group.add(glass);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.003, r + 0.003, 0.016, 64), M.steel); lid.position.y = h + 0.006; group.add(lid);
  const lidTop = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.004, r + 0.003, 0.004, 64), M.black); lidTop.position.y = h + 0.016; group.add(lidTop);
  const port = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0055, 0.014, 20), M.brass); port.position.set(0.012, h + 0.024, 0); group.add(port);
  const water = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.003, r - 0.003, 1, 64), M.water); water.position.y = 0.005; group.add(water);
  const surf = new THREE.Mesh(new THREE.CircleGeometry(r - 0.003, 64), new THREE.MeshPhysicalMaterial({ color: 0xb7dcf0, roughness: 0.02, clearcoat: 1, transparent: true, opacity: 0.45, depthWrite: false }));
  surf.rotation.x = -Math.PI / 2; group.add(surf);
  { const wh = 0.7 * (h - 0.012); water.scale.y = wh; water.position.y = 0.005 + wh / 2; surf.position.y = 0.005 + wh; }   // 초기 70%(높이 1m 원통 — 상태가 오기 전·전시용에서 솟지 않게)
  glass.userData = { kind: 'bottle' }; lid.userData = { kind: 'bottle' };
  glass.castShadow = true;
  return { group, water, surf, hit: glass, h, r, lid };
}

/* 상판 그릴: 프레임(803) 안쪽에 얹히는 헤어라인 스테인리스 판(가로 홈 13줄) + 홈 아래 어두운 면 + 모서리 나사 4개 */
function buildTopGrille(M) {
  const g = new THREE.Group(); g.name = 'top-grille';
  const W = 0.158, D = 0.258, R = 0.0008, y0 = 0.3285, T = 0.0016, zc = -0.0035;
  const shape = new THREE.Shape();
  shape.moveTo(-W / 2 + R, -D / 2); shape.lineTo(W / 2 - R, -D / 2); shape.quadraticCurveTo(W / 2, -D / 2, W / 2, -D / 2 + R);
  shape.lineTo(W / 2, D / 2 - R); shape.quadraticCurveTo(W / 2, D / 2, W / 2 - R, D / 2); shape.lineTo(-W / 2 + R, D / 2);
  shape.quadraticCurveTo(-W / 2, D / 2, -W / 2, D / 2 - R); shape.lineTo(-W / 2, -D / 2 + R); shape.quadraticCurveTo(-W / 2, -D / 2, -W / 2 + R, -D / 2);
  const N = 13, slotL = 0.098, slotW = 0.0042, pitch = 0.0105;
  for (let k = 0; k < N; k++) {
    const z = (k - (N - 1) / 2) * pitch, h = new THREE.Path(), r = slotW / 2;
    h.moveTo(-slotL / 2 + r, z - r); h.lineTo(slotL / 2 - r, z - r); h.absarc(slotL / 2 - r, z, r, -Math.PI / 2, Math.PI / 2, false);
    h.lineTo(-slotL / 2 + r, z + r); h.absarc(-slotL / 2 + r, z, r, Math.PI / 2, Math.PI * 1.5, false);
    shape.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: T, bevelEnabled: true, bevelThickness: 0.0003, bevelSize: 0.0003, bevelSegments: 2, curveSegments: 10 });
  geo.rotateX(Math.PI / 2);                         // 셰이프 평면(xy) → 수평(xz), 두께는 아래(-y)로
  const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);     // 좌우 헤어라인 UV
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) * 5; uv[i * 2 + 1] = pos.getZ(i) * 5; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const plate = new THREE.Mesh(geo, M.steel); plate.position.set(0, y0 + T, zc); plate.castShadow = plate.receiveShadow = true;
  const dark = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.01, D - 0.01), new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9 }));
  dark.rotation.x = -Math.PI / 2; dark.position.set(0, 0.3274, zc);
  g.add(plate, dark);
  // 캡 프레임: 몸체 외곽(x ±85.2, z −139.2~132.2mm)과 같은 면, 각진 모서리, 몸체 윗면(y 327)~333mm, 안쪽은 판이 3mm 들어간 개구
  const X0 = -0.0852, X1 = 0.0852, Z0 = -0.1392, Z1 = 0.1322, FY0 = 0.327, FY1 = 0.333, gap = 0.0006;
  const outer = new THREE.Shape([new THREE.Vector2(X0, -Z1), new THREE.Vector2(X1, -Z1), new THREE.Vector2(X1, -Z0), new THREE.Vector2(X0, -Z0)]);
  const hw = W / 2 + gap, hd = D / 2 + gap;
  outer.holes.push(new THREE.Path([new THREE.Vector2(-hw, -zc - hd), new THREE.Vector2(-hw, -zc + hd), new THREE.Vector2(hw, -zc + hd), new THREE.Vector2(hw, -zc - hd)]));
  const fgeo = new THREE.ExtrudeGeometry(outer, { depth: FY1 - FY0, bevelEnabled: false });
  fgeo.rotateX(-Math.PI / 2);                       // 셰이프 (x, -z) → 수평, 두께 +y
  const fp = fgeo.attributes.position, fuv = new Float32Array(fp.count * 2);
  for (let i = 0; i < fp.count; i++) { fuv[i * 2] = fp.getX(i) * 5; fuv[i * 2 + 1] = (fp.getZ(i) + fp.getY(i)) * 5; }
  fgeo.setAttribute('uv', new THREE.BufferAttribute(fuv, 2)); fgeo.computeVertexNormals();
  const frame = new THREE.Mesh(fgeo, M.steel); frame.position.y = FY0; frame.castShadow = frame.receiveShadow = true;
  g.add(frame);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.0034, 0.0036, 0.0008, 24), M.chrome);
    sc.position.set(sx * (W / 2 - 0.009), y0 + T + 0.0004, zc + sz * (D / 2 - 0.011)); g.add(sc);
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.0042, 0.0003, 0.0007), M.black); slot.position.copy(sc.position).add(new THREE.Vector3(0, 0.00045, 0)); slot.rotation.y = 0.6; g.add(slot);
  }
  return g;
}

/* 둥근 모서리 → 각진 모서리: 메쉬 bbox 의 바깥 모서리마다 필렛 반경 R 을 "평면이 끝나는 곳"으로 추정하고,
 * 필렛 원호 위 점들을 원→정사각형 사상(p' = c + d·|d|/max(|dx|,|dy|))으로 옮긴다. 판재 바깥/안쪽 면(반경 R, R−t)이
 * 같은 사상으로 각각 바깥/안쪽 정사각 모서리가 되어 두께가 유지된다. 옮긴 점의 법선은 가까운 면 방향으로. */
function squareCorners(geo, tol = 0.0004, pairs = [[0, 2], [0, 1], [1, 2]]) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, n = P.length / 3;
  geo.computeBoundingBox();
  const mn = geo.boundingBox.min.toArray(), mx = geo.boundingBox.max.toArray();
  for (const [a, b] of pairs) for (const sa of [-1, 1]) for (const sb of [-1, 1]) {
    const ea = sa > 0 ? mx[a] : mn[a], eb = sb > 0 ? mx[b] : mn[b];
    let fa = -Infinity, fb = -Infinity;
    for (let i = 0; i < n; i++) {
      const pa = P[i * 3 + a], pb = P[i * 3 + b];
      if (Math.abs(pa - ea) < tol) fa = Math.max(fa, sb * pb);     // 면 a 가 b 방향으로 어디까지 평평한가
      if (Math.abs(pb - eb) < tol) fb = Math.max(fb, sa * pa);
    }
    const Ra = sb * eb - fa, Rb = sa * ea - fb;
    if (!(Ra > 0.0012 && Rb > 0.0012 && Ra < 0.03 && Rb < 0.03 && Math.abs(Ra - Rb) < 0.35 * Math.max(Ra, Rb))) continue;
    const R = (Ra + Rb) / 2, ca = ea - sa * R, cb = eb - sb * R;
    for (let i = 0; i < n; i++) {
      const da = sa * (P[i * 3 + a] - ca), db = sb * (P[i * 3 + b] - cb);
      if (da <= 1e-7 || db <= 1e-7) continue;
      const d = Math.hypot(da, db);
      if (d > R + tol) continue;
      const k = d / Math.max(da, db);
      P[i * 3 + a] = ca + sa * da * k; P[i * 3 + b] = cb + sb * db * k;
      if (Math.abs(N[i * 3 + a]) + Math.abs(N[i * 3 + b]) < 0.5) continue;   // 원호가 아닌 면(윗면 등)의 점: 법선 유지
      const onA = da >= db, ax = onA ? a : b, sign = Math.sign(N[i * 3 + ax]) || (onA ? sa : sb);
      N[i * 3] = N[i * 3 + 1] = N[i * 3 + 2] = 0; N[i * 3 + ax] = sign;
    }
  }
  geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}

/* 버튼 위 도안: 설명서 그림(추출1 컵·추출2 컵·설정 톱니·전원)을 검정으로 인쇄한 흰 판 — 음각 포켓을 덮는다 */
function buildIconPlates(M) {
  const g = new THREE.Group(); g.name = 'button-icons';
  const draw = [
    (c) => { c.beginPath(); c.moveTo(18, 22); c.lineTo(46, 22); c.lineTo(46, 34); c.quadraticCurveTo(46, 48, 32, 48); c.quadraticCurveTo(18, 48, 18, 34); c.closePath(); c.moveTo(46, 26); c.quadraticCurveTo(56, 26, 56, 32); c.quadraticCurveTo(56, 38, 46, 38); c.stroke(); c.beginPath(); c.moveTo(14, 55); c.lineTo(50, 55); c.stroke(); },
    (c) => { c.beginPath(); c.moveTo(14, 12); c.lineTo(50, 12); c.stroke(); c.beginPath(); c.moveTo(18, 22); c.lineTo(46, 22); c.lineTo(46, 34); c.quadraticCurveTo(46, 48, 32, 48); c.quadraticCurveTo(18, 48, 18, 34); c.closePath(); c.moveTo(46, 26); c.quadraticCurveTo(56, 26, 56, 32); c.quadraticCurveTo(56, 38, 46, 38); c.stroke(); },
    (c) => { c.beginPath(); for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2, r = k % 2 ? 15 : 20; c.lineTo(32 + Math.cos(a) * r, 34 + Math.sin(a) * r); } c.closePath(); c.stroke(); c.beginPath(); c.arc(32, 34, 6, 0, Math.PI * 2); c.stroke(); },
    (c) => { c.beginPath(); c.arc(32, 36, 16, -Math.PI / 2 + 0.75, Math.PI * 1.5 - 0.75); c.stroke(); c.beginPath(); c.moveTo(32, 14); c.lineTo(32, 34); c.stroke(); },
  ];
  draw.forEach((fn, i) => {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, 64, 64);
    c.strokeStyle = '#0a0a0a'; c.lineWidth = 4.2; c.lineCap = 'round'; c.lineJoin = 'round'; fn(c);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const mat = M.white.clone(); mat.map = t;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(0.0172, 0.0132), mat);
    p.position.set(DIM.btnX[i], 0.2474, 0.13215); p.receiveShadow = true; g.add(p);
  });
  return g;
}

/* 모든 절곡면(판금 벤드·필렛) → 각진 모서리.
 * STEP 테셀레이션은 B-rep 면마다 정점이 따로라, 원통 면 하나 = 법선이 한 축(x/y/z)에 수직이고 대각 방향인 정점들의 연결 덩어리.
 * 덩어리마다 법선 직선의 최소제곱 교점으로 벤드 중심 c 를 구하고, 원→정사각 사상 p' = c + d·|d|/max(|da|,|db|) 로 옮긴다
 * (바깥/안쪽 판면이 같은 중심이라 각각 바깥/안쪽 각진 모서리가 되어 두께 유지).
 * 둥근 구멍(나사·게이지 구멍)은 같은 중심의 원호가 여러 사분면에 걸쳐 있으므로 건너뛴다. */
function squareBends(geo, exclude = null) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, I = geo.index.array, n = P.length / 3;
  const axisOf = new Int8Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2], c = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
    for (let k = 0; k < 3; k++) {
      const a = (k + 1) % 3, b = (k + 2) % 3;
      if (c[k] < 0.12 && c[a] > 0.17 && c[b] > 0.17) { axisOf[i] = k; break; }
    }
  }
  // 연결 덩어리(같은 축 정점끼리 삼각형으로 이어진 것)
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]];
    for (let e = 0; e < 3; e++) { const p0 = v[e], p1 = v[(e + 1) % 3]; if (axisOf[p0] >= 0 && axisOf[p0] === axisOf[p1]) { const r0 = find(p0), r1 = find(p1); if (r0 !== r1) par[r0] = r1; } }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) if (axisOf[i] >= 0) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const patches = [];
  for (const vs of groups.values()) {
    if (vs.length < 3) continue;
    const k = axisOf[vs[0]], a = (k + 1) % 3, b = (k + 2) % 3;
    let A00 = 0, A01 = 0, A11 = 0, B0 = 0, B1 = 0, kmin = 1e9, kmax = -1e9;
    for (const i of vs) {
      let na = N[i * 3 + a], nb = N[i * 3 + b]; const L = Math.hypot(na, nb); na /= L; nb /= L;
      const pa = P[i * 3 + a], pb = P[i * 3 + b];
      const m00 = 1 - na * na, m01 = -na * nb, m11 = 1 - nb * nb;
      A00 += m00; A01 += m01; A11 += m11; B0 += m00 * pa + m01 * pb; B1 += m01 * pa + m11 * pb;
      kmin = Math.min(kmin, P[i * 3 + k]); kmax = Math.max(kmax, P[i * 3 + k]);
    }
    const det = A00 * A11 - A01 * A01; if (Math.abs(det) < 1e-10) continue;
    const ca = (A11 * B0 - A01 * B1) / det, cb = (A00 * B1 - A01 * B0) / det;
    // 사분면(중심→점 방향)이 하나로 일정해야 벤드
    let sa = 0, sb = 0, ok = true, rmax = 0;
    for (const i of vs) {
      const da = P[i * 3 + a] - ca, db = P[i * 3 + b] - cb, r = Math.hypot(da, db);
      rmax = Math.max(rmax, r);
      if (r < 0.0002) continue;
      const qa = Math.sign(da), qb = Math.sign(db);
      if (Math.abs(da) > 0.15 * r) { if (!sa) sa = qa; else if (qa !== sa) ok = false; }
      if (Math.abs(db) > 0.15 * r) { if (!sb) sb = qb; else if (qb !== sb) ok = false; }
    }
    if (!ok || !sa || !sb || rmax > 0.03) continue;
    // 직각(≈90°) 벤드만: 원호 정점 법선의 회전 범위가 55° 미만이면 둔각/부분 필렛 → 정사각 사상하면 뾰족하게 튀어나오므로 유지
    let amin = 9, amax = -9;
    for (const i of vs) { const ang = Math.atan2(Math.abs(N[i * 3 + b]), Math.abs(N[i * 3 + a])); amin = Math.min(amin, ang); amax = Math.max(amax, ang); }
    if (amax - amin < 55 * Math.PI / 180) continue;
    if (exclude) {                                     // 제외 상자 안의 원호(로고 글자 등)
      const c = vs[0], x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
      if (x > exclude[0] && x < exclude[3] && y > exclude[1] && y < exclude[4] && z > exclude[2] && z < exclude[5]) continue;
    }
    if (kmax - kmin < 0.0025 && rmax < 0.008) continue;   // 짧고 작은 원호 = 각인 글자·얕은 음각 벽 → 제외 (판 모서리처럼 짧아도 반경 큰 것은 처리)
    patches.push({ vs, k, a, b, ca, cb, sa, sb, kmin, kmax });
  }
  // 둥근 구멍/원형 형상 제외: 같은 축·같은 중심(±0.4mm)·축 방향 겹침인 다른 사분면 원호가 있으면 원
  for (const p of patches) {
    p.round = patches.some(q => q !== p && q.k === p.k && Math.hypot(q.ca - p.ca, q.cb - p.cb) < 0.0015
      && q.kmax >= p.kmin - 1e-4 && q.kmin <= p.kmax + 1e-4 && (q.sa !== p.sa || q.sb !== p.sb));
  }
  for (const p of patches) {
    if (p.round) continue;
    const { a, b, k, ca, cb, sa, sb } = p;
    // 이 벤드의 반경 범위(바깥·안쪽 판면) — 같은 부채꼴·반경대·축 범위 안의 정점(벤드 끝의 단면 캡 면 외곽선 포함)도 함께 사상
    let rmin = 1, rmax = 0;
    for (const i of p.vs) { const r = Math.hypot(P[i * 3 + a] - ca, P[i * 3 + b] - cb); rmin = Math.min(rmin, r); rmax = Math.max(rmax, r); }
    const tol = 0.0003, members = [];
    for (let i = 0; i < n; i++) {
      const kk = P[i * 3 + k]; if (kk < p.kmin - tol || kk > p.kmax + tol) continue;
      const da = sa * (P[i * 3 + a] - ca), db = sb * (P[i * 3 + b] - cb);
      if (da <= 1e-7 || db <= 1e-7) continue;
      const r = Math.hypot(da, db); if (r < rmin - tol || r > rmax + tol) continue;
      members.push(i);
    }
    for (const i of members) {
      const da = sa * (P[i * 3 + a] - ca), db = sb * (P[i * 3 + b] - cb);
      if (da <= 1e-7 || db <= 1e-7) continue;
      const d = Math.hypot(da, db), kk = d / Math.max(da, db);
      P[i * 3 + a] = ca + sa * da * kk; P[i * 3 + b] = cb + sb * db * kk;
      if (Math.abs(N[i * 3 + a]) + Math.abs(N[i * 3 + b]) < 0.5) continue;   // 캡 면(법선이 벤드 축 방향) 정점: 위치만, 법선 유지
      const onA = da >= db, ax = onA ? a : b, sign = Math.sign(N[i * 3 + ax]) || (onA ? sa : sb);
      N[i * 3] = N[i * 3 + 1] = N[i * 3 + 2] = 0; N[i * 3 + ax] = sign;
    }
  }
  geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true;
  geo.computeBoundingBox(); geo.computeBoundingSphere();
}

/* 후면 제품명 AUREN M — 원본 KOREM 글자 자리(높이 231~248mm, 뒷면 z=−138.9mm)에 1.2mm 돌출 헤어라인 스테인리스 글자 */
let _font = null;
async function textBadge(M, text, size, depth) {
  try {
    _font = _font || await new FontLoader().loadAsync(new URL('../assets/fonts/helvetiker_bold.typeface.json', import.meta.url).href);
    const geo = new TextGeometry(text, { font: _font, size, depth, curveSegments: 6, bevelEnabled: false });
    geo.computeBoundingBox();
    const bb = geo.boundingBox, w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
    geo.translate(-bb.min.x - w / 2, -bb.min.y - h / 2, 0);
    const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) * 5; uv[i * 2 + 1] = pos.getY(i) * 5; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, M.steel); m.castShadow = true; m.name = 'badge ' + text;
    return m;
  } catch (e) { console.warn('로고 폰트 로드 실패', e); return null; }
}
async function buildRearBadge(M) {
  try {
    _font = _font || await new FontLoader().loadAsync(new URL('../assets/fonts/helvetiker_bold.typeface.json', import.meta.url).href);
    const geo = new TextGeometry('AUREN M', { font: _font, size: 0.0135, depth: 0.0012, curveSegments: 6, bevelEnabled: false });
    geo.computeBoundingBox();
    const bb = geo.boundingBox, w = bb.max.x - bb.min.x, h = bb.max.y - bb.min.y;
    geo.translate(-bb.min.x - w / 2, -bb.min.y - h / 2, 0);
    const pos = geo.attributes.position, uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) * 5; uv[i * 2 + 1] = pos.getY(i) * 5; }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, M.steel);
    m.rotation.y = Math.PI;                         // 뒤에서 바로 읽히게
    m.position.set(0, 0.255, -0.1389);              // 원래 심볼+글자 영역(231~281mm) 가운데, 패널 면에서 −z 로 돌출
    m.castShadow = true; m.name = 'rear-badge AUREN M';
    return m;
  } catch (e) { console.warn('후면 로고 폰트 로드 실패', e); return null; }
}

/* 45° 모따기 모서리 → 각진 모서리(평면도 x–z): 법선이 x–z 대각인 모따기 면의 두 끝점 A·B(x,z)를
 * 인접 두 면이 만나는 점 C(=바깥쪽 x, 바깥쪽 z)로 옮긴다. 같은 (x,z) 의 윗/아랫면·옆면 정점도 함께 이동(판 바깥/안쪽 각각) */
function squareChamfers(geo) {
  const P = geo.attributes.position.array, N = geo.attributes.normal.array, I = geo.index.array, n = P.length / 3;
  const diag = new Uint8Array(n);
  for (let i = 0; i < n; i++) { const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2]; if (Math.abs(ny) < 0.3 && Math.abs(nx) > 0.45 && Math.abs(nz) > 0.45) diag[i] = 1; }
  const par = new Int32Array(n); for (let i = 0; i < n; i++) par[i] = i;
  const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = I[t + e], b = I[t + (e + 1) % 3]; if (diag[a] && diag[b]) { const ra = find(a), rb = find(b); if (ra !== rb) par[ra] = rb; } }
  const groups = new Map();
  for (let i = 0; i < n; i++) if (diag[i]) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  const moves = [];
  for (const vs of groups.values()) {
    const pts = [];
    for (const i of vs) { const x = P[i * 3], z = P[i * 3 + 2]; if (!pts.some(q => Math.abs(q[0] - x) < 5e-5 && Math.abs(q[1] - z) < 5e-5)) pts.push([x, z]); }
    if (pts.length !== 2) continue;                    // 평면 모따기(끝점 두 개)만
    const [A, B] = pts, L = Math.hypot(A[0] - B[0], A[1] - B[1]);
    if (L < 0.0008 || L > 0.02) continue;
    const sx = Math.sign(N[vs[0] * 3]), sz = Math.sign(N[vs[0] * 3 + 2]);
    const C = [sx > 0 ? Math.max(A[0], B[0]) : Math.min(A[0], B[0]), sz > 0 ? Math.max(A[1], B[1]) : Math.min(A[1], B[1])];
    moves.push([A, C], [B, C]);
  }
  for (const [S, C] of moves) for (let i = 0; i < n; i++) {
    if (Math.abs(P[i * 3] - S[0]) < 5e-5 && Math.abs(P[i * 3 + 2] - S[1]) < 5e-5) { P[i * 3] = C[0]; P[i * 3 + 2] = C[1]; }
  }
  geo.attributes.position.needsUpdate = true; geo.computeBoundingBox(); geo.computeBoundingSphere();
}

function buildChromeBand(M) {
  const X = 0.0848, Z0 = -0.0089, Z1 = 0.1311, T = 0.003, Y0 = 0.196, Y1 = 0.2025;   // 두께 3mm — 하판(98) 안쪽 플랜지 모서리가 틈으로 비치지 않게
  // 셰이프 평면 (x, −z) — rotateX(−π/2) 후 수평, 두께 +y
  const outer = new THREE.Shape([new THREE.Vector2(-X, -Z1), new THREE.Vector2(X, -Z1), new THREE.Vector2(X, -Z0), new THREE.Vector2(-X, -Z0)]);
  outer.holes.push(new THREE.Path([new THREE.Vector2(-X + T, -Z1 + T), new THREE.Vector2(-X + T, -Z0 - T), new THREE.Vector2(X - T, -Z0 - T), new THREE.Vector2(X - T, -Z1 + T)]));
  const geo = new THREE.ExtrudeGeometry(outer, { depth: Y1 - Y0, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, M.chrome); m.position.y = Y0; m.castShadow = m.receiveShadow = true; m.name = 'chrome-band';
  return m;
}
