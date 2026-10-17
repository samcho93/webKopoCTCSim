// machine.js — AURA ONE 외관 3D 모델 (참조 이미지 기반 절차적 모델링)
//  좌표: x 오른쪽, y 위, z 정면(관찰자 방향), 단위 m
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { M, grateTextures, iconTexture, gaugeTexture } from './materials.js';
import { loadKernduCad } from './kerndu-cad.js';

export const DIM = {
  headY0: 0.362, headY1: 0.525, headFrontZ: 0.07, headBackZ: -0.26,   // 헤드 본체 앞면(경사 파사드가 그 앞을 덮음)
  trayY: 0.112, groupX: 0.115,   // 그룹헤드·버튼 포드 = 양쪽 LCD 바로 아래(양산 렌더: LCD 사이 12mm 간격)
  groupY: 0.326, groupZ: 0.11, ghY: 0.362,   // 그룹헤드 = 버튼 블럭(LCD 바로 아래) 밑
  lcdY: 0.455, s3X: 0.115, purgeX: 0.055,   // 양쪽 S3 LCD 중심 = 포드 중심(가운데 4.3" 유리와 12mm), purgeX: 3WAY 배수 위치
  // 스팀 완드: 그룹헤드 추출구 바깥 옆(헤드 하단에서 내려옴), 온수 팁: 두 그룹 사이 중앙
  wandBase: [new THREE.Vector3(-0.300, 0.362, 0.10), new THREE.Vector3(0.300, 0.362, 0.10)],
  wandTip: [new THREE.Vector3(-0.330, 0.175, 0.145), new THREE.Vector3(0.330, 0.175, 0.145)],
  hwTip: new THREE.Vector3(0, 0.345, 0.095),
};
/* DIM 스냅샷/복원 — 한 페이지에 기종이 다른 머신을 여러 대 지을 때(VALEM 카페) 실동작 머신의 치수를 지킨다 */
const cloneV = (v) => (v && v.clone ? v.clone() : Array.isArray(v) ? v.map(cloneV) : v);
export function snapshotDim() { return Object.fromEntries(Object.entries(DIM).map(([k, v]) => [k, cloneV(v)])); }
export function restoreDim(snap) { for (const k of Object.keys(DIM)) if (!(k in snap)) delete DIM[k]; for (const [k, v] of Object.entries(snap)) DIM[k] = cloneV(v); }
export const DIM_AURA = snapshotDim();                     // AURA ONE 기본 치수(모듈 로드 시점)
/* KERNDU(WCM-001) 치수 — 기구도면(WCM-001.stp → web/assets/kerndu.glb) 좌표(m).
 *  CAD(mm): Z=위, +X=정면, Y=폭 → 웹: x=Y-2031, y=Z+233(발 밑면=0), z=X-1213 (tools/cad/kerndu.json)
 *  외장·그룹헤드·스팀밸브/완드·온수밸브는 CAD 메쉬, 조작부(LCD 화면·버튼·노브·포터필터·전원·게이지)만 절차 모델 */
const KDIM = {
  headY0: 0.380, headY1: 0.501, headFrontZ: 0.256, headBackZ: -0.256,
  trayY: 0.143, groupX: 0.130, purgeX: 0.10, groupY: 0.337, groupZ: 0.1808, ghY: 0.343, lcdY: 0.4295, s3X: 0,   // groupY: 포터필터 림이 CAD 그룹헤드 밑면(y 0.343)에 맞물리게
  wandBase: [new THREE.Vector3(-0.320, 0.405, 0.27), new THREE.Vector3(0.320, 0.405, 0.27)],
  // 스팀 완드(CAD SP-516)는 도면에서 앞으로 돌려져(팁 z 0.353, 트레이 앞 밖) 있어, 볼조인트(위 끝)에서 뒤로 22° 세워
  // 드립트레이 위에 내려오게 한다(kerndu-cad.js WAND_TILT) — 아래 팁 좌표는 그 회전 결과, 스팀 피처는 이 아래 트레이 위
  wandPivot: [new THREE.Vector3(-0.3201, 0.4169, 0.2185), new THREE.Vector3(0.3199, 0.4169, 0.2185)],
  wandTip: [new THREE.Vector3(-0.320, 0.163, 0.261), new THREE.Vector3(0.320, 0.163, 0.261)],
  hwTip: new THREE.Vector3(-0.260, 0.367, 0.196),                                                // CAD WATER VALVE PT 토출구
  btnY: 0.4215, btnX: [[-0.1635, -0.1415, -0.1195, -0.0975], [0.0965, 0.1185, 0.1405, 0.1625]], hwBtnX: [-0.2655, -0.2435],
  knobPos: [new THREE.Vector3(-0.320, 0.4385, 0.300), new THREE.Vector3(0.320, 0.4385, 0.300)], // CAD V-003-08A 앞
};

function mesh(geo, mat, parent, pos, rot) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true;
  if (pos) m.position.set(...pos);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}
const rbox = (w, h, d, r = 0.006, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, r);

/* 사다리꼴 헤드(위가 넓은 형태) — 정면 윤곽을 Z 로 압출 */
function headGeometry() {
  const s = new THREE.Shape();
  const y0 = DIM.headY0, y1 = DIM.headY1, wb = 0.377, wt = 0.377;   // 측면 수직(전면 패널 폭 0.76 과 일치, 삼각 플레어 없음)
  s.moveTo(-wb, y0); s.lineTo(wb, y0); s.lineTo(wt, y1 - 0.012);
  s.quadraticCurveTo(wt, y1, wt - 0.012, y1); s.lineTo(-wt + 0.012, y1);
  s.quadraticCurveTo(-wt, y1, -wt, y1 - 0.012); s.closePath();
  const depth = DIM.headFrontZ - DIM.headBackZ;
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, DIM.headBackZ);
  return g;
}

/* 노브 몸체: 널링(세로 홈) 실린더 */
function knurledCylinder(r, h, ridges = 30) {
  const g = new THREE.CylinderGeometry(r, r * 0.96, h, ridges * 2, 1, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const a = Math.atan2(z, x), rr = Math.hypot(x, z);
    if (rr < 1e-5) continue;
    const k = 1 + 0.06 * Math.cos(a * ridges);
    p.setX(i, x * k); p.setZ(i, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/* 외장 마감: 'black'(양산 렌더 이미지) / 'steel'(헤어라인 스테인리스 시제품) */
const FINISH0 = { body: M.body.clone(), bodyMatte: M.bodyMatte.clone() };
export function setFinish(kind) {
  for (const k of ['body', 'bodyMatte']) {
    const m = M[k];
    if (kind === 'steel') {
      m.color.set(0xb9bdc1); m.metalness = 0.92; m.roughness = 0.36; m.roughnessMap = M.steel.roughnessMap;
      m.clearcoat = 0.05; m.bumpScale = 0.05; m.envMapIntensity = 1.0;
    } else {
      const o = FINISH0[k];
      m.color.copy(o.color); m.metalness = o.metalness; m.roughness = o.roughness; m.roughnessMap = null;
      m.clearcoat = o.clearcoat; m.bumpScale = o.bumpScale; m.envMapIntensity = o.envMapIntensity;
    }
    m.needsUpdate = true;
  }
}

/* model: 'aura' = AURA ONE(AUREN-PRO) | 'kerndu' = KERNDU(WCM-001) */
export function buildMachine(scene, model = 'aura') {
  const K = model === 'kerndu';
  if (K) Object.assign(DIM, KDIM);                         // 내부보기·효과도 DIM 을 공유
  const root = new THREE.Group(); root.name = 'machine';
  scene.add(root);
  const R = { root, model, shell: [], buttons: [], lcd: {}, knobs: [], needles: {}, cups: {}, pitchers: [], portafilters: [],
              ledbar: null, rearGlow: [], groupHeads: [], spouts: [[], []], interactive: [] };
  const shell = (m) => { R.shell.push(m); return m; };

  /* LCD 화면(캔버스 텍스처) — 펌웨어 프레임버퍼가 그려지고 터치 좌표를 받는다 */
  const screen = (parent, id, x, y, z, w, h, cw, ch) => {
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1.0, roughness: 0.25, metalness: 0 });
    const scr = mesh(new THREE.PlaneGeometry(w, h), mat, parent, [x, y, z]);
    scr.castShadow = false;
    scr.userData = { kind: 'lcd', board: id, pw: cw, ph: ch };
    const glass = mesh(new THREE.PlaneGeometry(w + 0.004, h + 0.004), new THREE.MeshPhysicalMaterial({ color: 0x000000, transparent: true, opacity: 0.12, roughness: 0.02, clearcoat: 1, metalness: 0 }), parent, [x, y, z + 0.0006]);
    glass.raycast = () => {};
    R.lcd[id] = { mesh: scr, canvas, ctx: canvas.getContext('2d'), tex, mat, w, h };
    R.interactive.push(scr);
  };
  const icons = ['cup1', 'cup2', 'cup3', 'dots3'].map(iconTexture);
  const hwIcons = ['dot1', 'dot2'].map(iconTexture);
  /* 물리 버튼(LED 내장) + 위쪽 아이콘. bit = 펌웨어 BTN 비트(그룹 0~7, 온수 8~9) */
  const mkBtn = (parent, x, y, z0, bit, name, icon, iconDy, iconSize = 0.012) => {
    const ic = mesh(new THREE.PlaneGeometry(iconSize, iconSize), new THREE.MeshBasicMaterial({ map: icon, transparent: true, toneMapped: false, color: 0xbfc6cc }), parent, [x, y + iconDy, 0.0006]);
    ic.castShadow = false; ic.raycast = () => {};
    // 검정 버튼 가운데 작은 백색 LED 점(KERNDU 실물·AUREN-PRO 양산 렌더 사진 공통)
    const btn = mesh(rbox(0.0135, 0.0135, 0.006, 0.0015), new THREE.MeshStandardMaterial({ color: 0x1a1c20, roughness: 0.35, metalness: 0.15 }), parent, [x, y, z0]);
    let led = null;
    {
      led = new THREE.MeshStandardMaterial({ color: 0x3a4048, emissive: 0xe8f2ff, emissiveIntensity: 0, roughness: 0.3 });
      const d = mesh(new THREE.CircleGeometry(0.0013, 20), led, btn, [0, 0, 0.0031]); d.castShadow = false; d.raycast = () => {};
    }
    btn.userData = { kind: 'btn', bit, name, z0, icon: ic, led };
    R.buttons.push(btn); R.interactive.push(btn);
  };
  let topf = null;                                         // AURA: 헤드 상부면(스팀 밸브·온수 버튼)

  /* ── 다리 ── KERNDU 원형 크롬 / AURA 크롬 블럭 */
  if (!K) for (const x of [-0.29, 0.29]) for (const z of [0.17, -0.20]) mesh(rbox(0.075, 0.058, 0.11, 0.008), M.chrome, root, [x, 0.029, z]);
  if (K) R.dripWater = new THREE.Object3D();                // KERNDU: 다리·베이스·드립트레이는 CAD(kerndu-cad.js)
  else {

  /* ── 베이스(드립트레이 하우징) ── */
  shell(mesh(rbox(0.83, 0.056, 0.50, 0.01), M.bodyMatte, root, [0, 0.086, 0.0]));
  // 전면 하단 립(무광 블랙 + 크롬 라인)
  mesh(new THREE.BoxGeometry(0.80, 0.004, 0.004), M.chrome, root, [0, 0.112, 0.251]);
  // 타공 그릴
  const gw = 0.76, gd = 0.235;
  const { map, alpha } = grateTextures(gw / 0.011, gd / 0.0095);
  const grateMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map, alphaMap: alpha, alphaTest: 0.5, metalness: 1, roughness: 0.28, side: THREE.DoubleSide });
  const grate = mesh(new THREE.PlaneGeometry(gw, gd), grateMat, root, [0, DIM.trayY + 0.003, 0.125], [-Math.PI / 2, 0, 0]);
  grate.castShadow = false;
  mesh(new THREE.BoxGeometry(gw - 0.01, 0.002, gd - 0.01), new THREE.MeshStandardMaterial({ color: 0x070707, roughness: 0.6 }), root, [0, DIM.trayY - 0.012, 0.125]);
  // 그릴 테두리
  for (const z of [0.125 - gd / 2, 0.125 + gd / 2]) mesh(new THREE.BoxGeometry(gw + 0.01, 0.006, 0.006), M.steel, root, [0, DIM.trayY + 0.002, z]);
  for (const x of [-gw / 2, gw / 2]) mesh(new THREE.BoxGeometry(0.006, 0.006, gd), M.steel, root, [x, DIM.trayY + 0.002, 0.125]);
  // 드립트레이 수위(배수통) — 상태 표시용
  R.dripWater = mesh(new THREE.BoxGeometry(gw - 0.02, 0.001, gd - 0.02), new THREE.MeshPhysicalMaterial({ color: 0x3a2a1c, roughness: 0.1, transparent: true, opacity: 0.85 }), root, [0, DIM.trayY - 0.011, 0.125]);
  }

  /* ── 메인 전원 스위치 ──
   *  KERNDU: 백패널 좌측 상단, 검정 사각 홈 안의 크롬 로커(실물 사진)
   *  AUREN-PRO: 뒷벽 좌측(압력계 줄 왼쪽 끝)의 빨간 회전 스위치 — 손잡이 세로=OFF, 90° 돌리면 ON */
  const powerHit = (g) => g.traverse(o => { if (o.isMesh) { o.userData = { kind: 'power' }; R.interactive.push(o); } });
  if (K) {
    const sw = new THREE.Group(); sw.position.set(-0.321, 0.236, 0.104); root.add(sw);   // CAD ROCKER SWITCH(백패널 WPL_003 구멍 안)
    mesh(new THREE.BoxGeometry(0.030, 0.038, 0.004), new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.7 }), sw, [0, 0, 0.0005]);   // 사각 홈(검정)
    mesh(new THREE.BoxGeometry(0.026, 0.034, 0.002), M.plasticBlack, sw, [0, 0, 0.0028]);
    const rocker = new THREE.Group(); rocker.position.z = 0.006; sw.add(rocker);
    mesh(rbox(0.019, 0.029, 0.008, 0.003), M.chrome, rocker, [0, 0, 0]);                              // 크롬 로커(위아래로 눌림)
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x20262c, emissive: 0xdfefff, emissiveIntensity: 0, roughness: 0.4 });
    mesh(new THREE.BoxGeometry(0.010, 0.0016, 0.0005), lampMat, rocker, [0, 0.009, 0.0042]);           // 표시등 띠
    powerHit(sw);
    R.powerSwitch = { rocker, lamp: lampMat, axis: 'x' };
  }

  if (!K) {
  /* ── 하부 몸체(작업공간 뒷벽) ── */
  shell(mesh(rbox(0.74, 0.27, 0.27, 0.01), M.body, root, [0, 0.239, -0.115]));   // 뒷벽 앞면 z≈0.02
  // 뒷벽 전면 패널(약간 광택) + 리벳
  shell(mesh(new THREE.BoxGeometry(0.70, 0.25, 0.004), M.glassBlack, root, [0, 0.241, 0.021]));
  for (const [x, y] of [[-0.33, 0.13], [0.33, 0.13], [-0.33, 0.32], [0.33, 0.32]])
    mesh(new THREE.SphereGeometry(0.0045, 16, 8), M.chrome, root, [x, y, 0.024]);

  // 메인 전원 — 빨간 회전 스위치(뒷벽 좌측, 압력계와 같은 줄의 왼쪽 끝)
  {
    const dv = new THREE.Group(); dv.position.set(-0.27, 0.205, 0.023); root.add(dv);
    const red = new THREE.MeshPhysicalMaterial({ color: 0xc8231b, roughness: 0.35, clearcoat: 0.6 });
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 16), M.chrome, dv, [0, 0, 0.004], [Math.PI / 2, 0, 0]);
    const spin = new THREE.Group(); spin.position.z = 0.014; dv.add(spin);
    mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.012, 40), red, spin, [0, 0, 0], [Math.PI / 2, 0, 0]);
    mesh(new THREE.BoxGeometry(0.009, 0.04, 0.012), red, spin, [0, -0.004, 0.011]);
    mesh(new THREE.BoxGeometry(0.0025, 0.026, 0.0005), new THREE.MeshBasicMaterial({ color: 0xffffff }), spin, [0, -0.004, 0.0173]);   // 손잡이 방향 표시선
    // 위치 표시(O = 세로, I = 가로)
    const mark = new THREE.MeshBasicMaterial({ color: 0xd8dde2 });
    mesh(new THREE.TorusGeometry(0.0028, 0.0006, 6, 16), mark, dv, [0, -0.033, 0.0015]);
    mesh(new THREE.BoxGeometry(0.0012, 0.006, 0.0005), mark, dv, [0.033, 0, 0.0015]);
    powerHit(dv);
    R.powerSwitch = { rotary: spin };
  }

  /* ── 헤드(사다리꼴) ── */
  shell(mesh(headGeometry(), M.body, root));
  // 상단 컵워머(브러시드 스틸 + 테두리)
  shell(mesh(new THREE.BoxGeometry(0.62, 0.004, 0.30), M.steel, root, [0, DIM.headY1 + 0.007, -0.07]));
  // 상단 엣지 하이라이트(앰버 실루엣이 잘 맺히도록 크롬 라인)
  mesh(new THREE.BoxGeometry(0.756, 0.002, 0.002), M.chrome, root, [0, DIM.headY1 + 0.005, DIM.headFrontZ + 0.006]);

  /* ── 헤드 전면 (시제품 사진 기준) — 측면에서 보면 ">" 모양으로 꺾인 면 ──
   *  상부면: 꺾임선(가장 앞)에서 위로 갈수록 뒤로 눕는 면 → LCD 가 위(바리스타 쪽)를 향함. 온수 버튼·스팀 밸브도 이 면.
   *  하부면/버튼 블럭: 꺾임선에서 아래로 갈수록 안쪽으로 들어가는 면 → 버튼 블럭 앞면, 블럭 밑에 그룹헤드.
   *  정면 약간 아래에서 보면 두 면이 한 수직면처럼 보인다(사진). */
  const FO = { y: 0.432, z: 0.172 };   // 꺾임선 = LCD 케이스 하단                      // 꺾임선(LCD 하단 = 버튼 블럭 상단, 가장 앞)
  const TP = { y: DIM.headY1, z: FO.z };                   // LCD 케이스(상부면)는 경사 없이 수직
  const BT = { y: DIM.headY0, z: 0.130 };                 // 하부면 아래끝(헤드 바닥 앞 모서리)
  const thU = Math.atan2(FO.z - TP.z, TP.y - FO.y);       // 상부면 기울기(현재 0 = 수직)
  const thL = Math.atan2(FO.z - BT.z, FO.y - BT.y);       // 하부면: 아래가 안쪽 ≈40°
  // YZ 단면(Shape: x=z, y=y)을 X 방향으로 압출하는 헬퍼
  const profileX = (pts, width, bevel = 0.003) => {
    const sh = new THREE.Shape(); pts.forEach(([z, y], i) => i ? sh.lineTo(z, y) : sh.moveTo(z, y)); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: width, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3 });
    g.rotateY(-Math.PI / 2); g.translate(width / 2, 0, 0);
    return g;
  };
  shell(mesh(profileX([[DIM.headFrontZ - 0.01, BT.y], [BT.z, BT.y], [FO.z, FO.y], [TP.z, TP.y - 0.004], [DIM.headFrontZ - 0.01, TP.y - 0.004]], 0.76), M.body, root));
  mesh(new THREE.BoxGeometry(0.762, 0.003, 0.003), M.chrome, root, [0, FO.y, FO.z + 0.002]);   // 꺾임선 크롬 라인
  // 상부면 로컬 프레임: 원점=꺾임선, y=면 따라 위(뒤로), z=법선(위·앞)
  const fac = new THREE.Group(); fac.position.set(0, FO.y, FO.z); fac.rotation.x = -thU; root.add(fac);
  topf = fac;                                              // 스팀 밸브·온수 버튼도 같은 상부면
  /* ── LCD 3개(양산 렌더 사진): 가로 한 줄의 검정 유리창 + 얇은 금속 테두리 ──
   *  양쪽 = 3.5" — 버튼 포드 폭만 한 큰 검정 유리(104×66mm) 안에 73×49mm 표시부(테두리가 넓게 검정)
   *  가운데 = 4.3" — 102×60mm 유리, 표시부(95×57mm)가 거의 가득. 유리 아랫변은 버튼 포드 윗변(꺾임선) 바로 위 */
  const mkLcd = (id, x, gy, gw, gh, w, h, cw, ch) => {
    mesh(rbox(gw + 0.0024, gh + 0.0024, 0.003, 0.0016), M.chrome, fac, [x, gy, 0.0015]);                  // 얇은 금속 테두리
    shell(mesh(rbox(gw, gh, 0.004, 0.0012), M.glassBlack, fac, [x, gy, 0.003]));                          // 검정 커버 유리
    screen(fac, id, x, gy, 0.0052, w, h, cw, ch);
  };
  mkLcd('s3g1', -DIM.s3X, 0.042, 0.104, 0.066, 0.0734, 0.0489, 480, 320);   // 3.5" 가로 73.4×48.9mm
  mkLcd('p4', 0, 0.040, 0.102, 0.060, 0.0950, 0.0570, 800, 480);            // 4.3" 95.0×57.0mm
  mkLcd('s3g2', DIM.s3X, 0.042, 0.104, 0.066, 0.0734, 0.0489, 480, 320);

  /* ── 버튼 블럭: 꺾임선 바로 아래 별도 블럭 — 앞면은 아래가 안쪽, 밑면은 뒤로 갈수록 올라감(측면 삼각형), 밑에 그룹헤드 ── */
  // 블럭 높이 ≈0.07m. 윗변은 LCD 아래 꺾임선에서 단차 없이 시작
  const thB = 0.20;                                       // 블럭 앞면(아래가 안쪽 ≈11°) — 윗변은 하부면과 단차 없이 연결
  const BK = { yt: FO.y - 0.002, yb: DIM.ghY, zt: FO.z + 0.0005 };   // LCD 바로 아래 꺾임선에서 시작(높이 ≈0.07m)
  BK.zb = BK.zt - (BK.yt - BK.yb) * Math.tan(thB);
  DIM.groupZ = BK.zb - 0.0475;                             // 그룹헤드 = 블럭 밑면 중앙(잔·내부배관도 이 값을 씀)
  const podProfile = [[BK.zt, BK.yt], [BK.zb, BK.yb], [BK.zb - 0.095, BK.yb], [0.035, BT.y + 0.006], [0.035, BK.yt]];
  for (let gi = 0; gi < 2; gi++) {
    const x = (gi ? 1 : -1) * DIM.groupX;
    const blk = shell(mesh(profileX(podProfile, 0.104), M.bodyMatte, root, [x, 0, 0]));
    blk.userData.podBlock = gi;
    for (const sx of [-1, 1]) mesh(profileX([[BK.zt + 0.002, BK.yt + 0.002], [BK.zb + 0.002, BK.yb - 0.002], [BK.zb - 0.097, BK.yb - 0.002], [0.04, BT.y + 0.004], [0.04, BK.yt + 0.002]], 0.004, 0.0008), M.steel, root, [x + sx * 0.056, 0, 0]);
    const face = new THREE.Group(); face.position.set(x, BK.yb, BK.zb + 0.003); face.rotation.x = thB; root.add(face);
    const L = (BK.yt - BK.yb) / Math.cos(thB);
    for (let b = 0; b < 4; b++)
      mkBtn(face, -0.033 + b * 0.022, L * 0.46, 0.0015, gi * 4 + b, `그룹${gi + 1} 버튼${b < 3 ? b + 1 : ' PRE'}`, icons[b], L * 0.26);
  }
  /* ── 온수 버튼 2개(상단 경사판, 스팀 밸브 오른쪽) ── */
  for (let i = 0; i < 2; i++) mkBtn(topf, -0.300 + i * 0.024, 0.054, 0.0015, 8 + i, `온수 버튼 W${i + 1}`, hwIcons[i], 0.016, 0.011);
  } else {
  /* ══ KERNDU (WCM-001) — 실물 사진: 평평한 블랙 직육면체 헤드, 전면 수직 패널에
   *    [스팀노브] [온수 •/••] [그룹1 4버튼] [4.3" LCD(실버 베젤)] [그룹2 4버튼] [스팀노브],
   *    상판 타공 컵워머, 작업공간 뒷면은 헤어라인 스테인리스 백패널 ══ */
  // 본체·헤드·컵워머·LCD 베젤·백패널은 CAD 메쉬(kerndu-cad.js) — 여기서는 펌웨어와 연결되는 화면·버튼만
  const pf = new THREE.Group(); pf.position.z = DIM.headFrontZ; root.add(pf);   // 전면 패널 WPL_001 앞면
  screen(pf, 'p4', 0, DIM.lcdY, 0.0012, 0.0950, 0.0570, 800, 480);              // 4.3" 표시 영역(CAD LCD FRAME 중앙)
  for (let gi = 0; gi < 2; gi++) for (let b = 0; b < 4; b++)                     // CAD 4PIN SWITCH 위치
    mkBtn(pf, DIM.btnX[gi][b], DIM.btnY, -0.0025, gi * 4 + b, `그룹${gi + 1} 버튼${b < 3 ? b + 1 : ' PRE'}`, icons[b], 0.020);
  for (let i = 0; i < 2; i++) mkBtn(pf, DIM.hwBtnX[i], DIM.btnY, -0.0025, 8 + i, `온수 버튼 W${i + 1}`, hwIcons[i], 0.019, 0.011);   // CAD 2PIN SWITCH
  }

  /* ── 그룹헤드 + 포터필터 ── */
  for (let gi = 0; gi < 2; gi++) {
    const x = (gi ? 1 : -1) * DIM.groupX;
    const gh = new THREE.Group(); gh.position.set(x, 0, DIM.groupZ); root.add(gh);   // 버튼 블럭 바로 아래
    if (!K) {                                                // KERNDU: 그룹헤드 본체는 CAD(G-003B)
      mesh(new THREE.CylinderGeometry(0.05, 0.052, 0.018, 48), M.chrome, gh, [0, DIM.ghY - 0.006, 0]);
      mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.012, 48), M.chrome, gh, [0, DIM.ghY - 0.020, 0]);
      mesh(new THREE.TorusGeometry(0.039, 0.004, 12, 48), M.gasket, gh, [0, DIM.ghY - 0.026, 0], [Math.PI / 2, 0, 0]);
    }
    R.groupHeads.push(gh);
    // 포터필터(참조 사진): 유광 크롬 본체 + 안쪽 바스켓 + 바요넷 이어 2개 + 짧은 크롬 목·칼라 + 우드 손잡이 + 초승달형 2구 스파우트
    const pf = new THREE.Group(); pf.position.set(0, DIM.groupY - 0.012, 0); gh.add(pf);
    const V2 = (r, y) => new THREE.Vector2(r, y);
    const bodyPts = [V2(0.0005, -0.016), V2(0.026, -0.016), V2(0.032, -0.0145), V2(0.0355, -0.010), V2(0.0368, 0.000), V2(0.0372, 0.011),
                     V2(0.0392, 0.0125), V2(0.0392, 0.0160), V2(0.0340, 0.0162), V2(0.0332, 0.0140)];
    mesh(new THREE.LatheGeometry(bodyPts, 64), M.chrome, pf);
    const basketPts = [V2(0.0332, 0.0140), V2(0.0318, 0.010), V2(0.0300, -0.006), V2(0.0270, -0.009), V2(0.0005, -0.0092)];
    mesh(new THREE.LatheGeometry(basketPts, 64), new THREE.MeshStandardMaterial({ color: 0xb8bcc0, metalness: 1, roughness: 0.22, side: THREE.DoubleSide }), pf);
    const puck = mesh(new THREE.CylinderGeometry(0.0298, 0.0298, 0.002, 48), new THREE.MeshStandardMaterial({ color: 0x3a2516, roughness: 0.9 }), pf, [0, 0.004, 0]);
    R.pucks = R.pucks || []; R.pucks[gi] = puck;
    const yaw = new THREE.Group(); yaw.rotation.y = gi ? 0.55 : -0.55; pf.add(yaw);   // 손잡이는 바깥쪽(좌 그룹=왼쪽, 우 그룹=오른쪽)
    // 바요넷 이어(손잡이와 직각 방향 양쪽)
    for (const sx of [-1, 1]) mesh(rbox(0.010, 0.006, 0.018, 0.0015), M.chrome, yaw, [sx * 0.0405, 0.0105, 0]);
    // 손잡이 축(+z, 살짝 아래로)
    const arm = new THREE.Group(); arm.position.set(0, 0.002, 0); arm.rotation.x = 0.12; yaw.add(arm);
    const alongZ = (g) => { g.rotateX(Math.PI / 2); return g; };
    mesh(alongZ(new THREE.CylinderGeometry(0.0085, 0.0105, 0.016, 28)), M.chrome, arm, [0, 0, 0.0425]);    // 본체에서 나온 목 0.035~0.051
    mesh(alongZ(new THREE.CylinderGeometry(0.0072, 0.0080, 0.012, 24)), M.chrome, arm, [0, 0, 0.056]);     // 목
    mesh(alongZ(new THREE.CylinderGeometry(0.0118, 0.0118, 0.005, 28)), M.chrome, arm, [0, 0, 0.0635]);    // 칼라 링
    // 우드 그립: 칼라에서 끝으로 굵어지고 끝은 둥글게(회전체)
    const wood = (() => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 256; const g = c.getContext('2d');
      g.fillStyle = '#1b1411'; g.fillRect(0, 0, 64, 256);
      for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${60 + Math.random() * 30},${40 + Math.random() * 20},${30},0.35)`; g.lineWidth = Math.random() * 1.5;
        const x = Math.random() * 64; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, 80, x - 6, 170, x + 3, 256); g.stroke(); }
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const gripPts = [];
    const GL = 0.112;
    for (let i = 0; i <= 20; i++) { const t = i / 20; gripPts.push(V2(0.0105 + 0.0062 * Math.pow(t, 0.8), t * GL)); }
    for (let i = 1; i <= 8; i++) { const a = i / 8 * Math.PI / 2; gripPts.push(V2(0.0167 * Math.cos(a), GL + 0.006 * Math.sin(a))); }
    gripPts.unshift(V2(0.0005, 0));
    const grip = new THREE.LatheGeometry(gripPts, 40); grip.rotateX(Math.PI / 2);
    const gripMat = K ? new THREE.MeshPhysicalMaterial({ color: 0x0d0d0e, roughness: 0.38, clearcoat: 0.4, clearcoatRoughness: 0.4 })   // KERNDU: 검정 손잡이
                      : new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.35 });
    mesh(grip, gripMat, arm, [0, 0, 0.066]);
    // 초승달형 2구 스파우트: 본체 밑 스템 → ∩ 날개 → 양 끝 토출구(아래로)
    mesh(new THREE.CylinderGeometry(0.006, 0.0075, 0.008, 20), M.chrome, yaw, [0, -0.020, 0]);
    const wing = mesh(new THREE.TorusGeometry(0.0145, 0.0042, 14, 40, Math.PI), M.chrome, yaw, [0, -0.0375, 0]);
    wing.scale.z = 1.7;
    for (const sx of [-1, 1]) {
      const sp = mesh(new THREE.CylinderGeometry(0.0034, 0.0030, 0.006, 14), M.chrome, yaw, [sx * 0.0145, -0.039, 0]);
      R.spouts[gi].push(sp);
    }
    pf.userData = { kind: 'portafilter', g: gi };
    pf.traverse(o => { if (o.isMesh) { o.userData = { kind: 'portafilter', g: gi }; R.interactive.push(o); } });
    R.portafilters.push(pf);
  }

  /* ── 잔(도자기) ── */
  const cupPts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; cupPts.push(new THREE.Vector2(0.027 + 0.008 * Math.pow(t, 0.7), t * 0.062)); }
  const cupGeo = new THREE.LatheGeometry(cupPts, 48);
  const mkCup = (key, x, z) => {
    const g = new THREE.Group(); g.position.set(x, DIM.trayY + 0.004, z); root.add(g);
    mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.006, 48), M.ceramic, g, [0, 0.003, 0]);         // 받침
    const body = mesh(cupGeo, new THREE.MeshPhysicalMaterial({ color: 0xf5f3ef, roughness: 0.18, clearcoat: 1, side: THREE.DoubleSide }), g, [0, 0.006, 0]);
    mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.004, 40), M.ceramic, g, [0, 0.008, 0]);
    const handle = mesh(new THREE.TorusGeometry(0.014, 0.0035, 10, 24, Math.PI * 1.2), M.ceramic, g, [0.038, 0.04, 0], [0, 0, -Math.PI * 0.6]);
    const liq = mesh(new THREE.CylinderGeometry(0.029, 0.026, 1, 40), new THREE.MeshPhysicalMaterial({ color: 0x2a1408, roughness: 0.15, clearcoat: 1 }), g, [0, 0.01, 0]);
    liq.scale.y = 0.0001; liq.visible = false;
    const crema = mesh(new THREE.CircleGeometry(0.0285, 40), new THREE.MeshStandardMaterial({ color: 0xb87a42, roughness: 0.7 }), g, [0, 0.01, 0], [-Math.PI / 2, 0, 0]);
    crema.visible = false;
    g.traverse(o => { if (o.isMesh) { o.userData = { kind: 'cup', which: key }; R.interactive.push(o); } });
    R.cups[key] = { group: g, liq, crema, body, h: 0.058 };
  };
  mkCup(0, -DIM.groupX, DIM.groupZ);
  mkCup(1, DIM.groupX, DIM.groupZ);
  mkCup('hw', DIM.hwTip.x, DIM.hwTip.z);

  /* ── 온수 팁 ── AURA: 헤드 밑 짧은 팁 / KERNDU: CAD 온수밸브(WATER VALVE PT) */
  if (!K) {
    mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.03, 20), M.chrome, root, [DIM.hwTip.x, DIM.headY0 - 0.012, DIM.hwTip.z]);
    mesh(new THREE.CylinderGeometry(0.0055, 0.0042, 0.016, 16), M.chrome, root, [DIM.hwTip.x, DIM.hwTip.y + 0.006, DIM.hwTip.z]);
  }

  /* ── 스팀 노브(상단 양 모서리, 수동 스팀 밸브) ── */
  for (let i = 0; i < 2; i++) {
    const sx = i ? 1 : -1;
    const k = new THREE.Group();
    if (K) { k.position.copy(DIM.knobPos[i]); root.add(k); }                          // KERNDU: CAD 스팀밸브(V-003-08A) 앞
    else { k.position.set(sx * 0.348, 0.064, 0.002); topf.add(k); }                    // 상단 경사판 좌·우(시제품: 경사판 위 밸브)
    const spin = new THREE.Group(); k.add(spin);
    mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.012, 24), M.chrome, k, [0, 0, 0.004], [Math.PI / 2, 0, 0]);
    mesh(knurledCylinder(0.0225, 0.04, 28), M.plasticBlack, spin, [0, 0, 0.03], [Math.PI / 2, 0, 0]);
    mesh(new THREE.CylinderGeometry(0.0205, 0.0215, 0.004, 40), M.chrome, spin, [0, 0, 0.052], [Math.PI / 2, 0, 0]);
    mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.003, 32), M.plasticBlack, spin, [0, 0, 0.0545], [Math.PI / 2, 0, 0]);
    const mark = mesh(new THREE.BoxGeometry(0.003, 0.012, 0.002), new THREE.MeshBasicMaterial({ color: 0xff9a3a, toneMapped: false }), spin, [0, 0.013, 0.0545]);
    mark.raycast = () => {};
    k.traverse(o => { if (o.isMesh) { o.userData = { kind: 'knob', i }; R.interactive.push(o); } });
    R.knobs.push({ group: k, spin });
  }

  /* ── 스팀 파이프(그룹헤드 옆, 헤드 하단 볼조인트 → 아래로) ── */
  for (let i = 0; i < 2 && !K; i++) {                      // KERNDU: 스팀 파이프는 CAD(SP-516)
    const sx = i ? 1 : -1;
    const base = DIM.wandBase[i];
    mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.012, 24), M.chrome, root, [base.x, base.y - 0.004, base.z]);
    mesh(new THREE.SphereGeometry(0.012, 24, 16), M.chrome, root, [base.x, base.y - 0.014, base.z]);
    const pts = [new THREE.Vector3(base.x, base.y - 0.014, base.z), new THREE.Vector3(base.x + sx * 0.008, base.y - 0.035, base.z + 0.012),
                 new THREE.Vector3(base.x + sx * 0.018, base.y - 0.07, base.z + 0.03), new THREE.Vector3(base.x + sx * 0.026, 0.23, base.z + 0.042), DIM.wandTip[i].clone()];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    mesh(new THREE.TubeGeometry(curve, 64, 0.0062, 16), M.chrome, root);
    // 고무 그립(곡선부)
    const gp = new THREE.CatmullRomCurve3(pts.slice(1, 4), false, 'centripetal');
    mesh(new THREE.TubeGeometry(gp, 32, 0.0105, 20), M.rubber, root);
    mesh(new THREE.CylinderGeometry(0.0062, 0.0048, 0.012, 16), M.chrome, root, [DIM.wandTip[i].x, DIM.wandTip[i].y - 0.004, DIM.wandTip[i].z]);
  }

  /* ── 스팀 피처(우유) ── */
  const ptPts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; ptPts.push(new THREE.Vector2(0.036 - 0.006 * Math.sin(t * Math.PI) + 0.004 * t, t * 0.105)); }
  const ptGeo = new THREE.LatheGeometry(ptPts, 48);
  for (let i = 0; i < 2; i++) {
    const tip = DIM.wandTip[i];
    const g = new THREE.Group(); g.position.set(tip.x, DIM.trayY + 0.003, tip.z); root.add(g);   // 드립트레이 위, 팁이 우유에 잠김
    mesh(ptGeo, new THREE.MeshStandardMaterial({ color: 0xdfe2e5, metalness: 1, roughness: 0.18, side: THREE.DoubleSide }), g);
    mesh(new THREE.CircleGeometry(0.036, 40), M.steel, g, [0, 0.001, 0], [-Math.PI / 2, 0, 0]);
    mesh(new THREE.TorusGeometry(0.022, 0.0035, 10, 24, Math.PI), M.steel, g, [0.044, 0.06, 0], [0, 0, -Math.PI / 2]);
    const milk = mesh(new THREE.CylinderGeometry(0.0295, 0.0315, 1, 40), new THREE.MeshPhysicalMaterial({ color: 0xf4efe6, roughness: 0.35, clearcoat: 0.6 }), g, [0, 0.002, 0]);
    milk.scale.y = 0.05; milk.position.y = 0.002 + 0.025;   // 초기 300mL(높이 1m 원통 — 물리 상태가 오기 전·전시용에서 솟지 않게)
    g.traverse(o => { if (o.isMesh) { o.userData = { kind: 'pitcher', i }; R.interactive.push(o); } });
    R.pitchers.push({ group: g, milk });
  }

  /* ── 압력 게이지 2개(우측 뒷벽): 펌프(0~16bar) / 스팀보일러(0~3bar) ── */
  // KERNDU: CAD 백패널(WPL_014) 게이지 구멍 중심(Ø41) / AURA: 뒷벽 우측 세로 2단
  const GP = K ? { pump: [0.2449, 0.2413, 0.110], boiler: [0.2997, 0.2414, 0.110] } : { pump: [0.305, 0.258, 0.026], boiler: [0.305, 0.200, 0.026] };
  const mkGauge = (key, y, max, title, red) => {
    const g = new THREE.Group(); g.position.set(...GP[key]); root.add(g);
    mesh(new THREE.TorusGeometry(0.023, 0.0035, 16, 48), M.chrome, g, [0, 0, 0.003]);
    mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.006, 48), M.chrome, g, [0, 0, -0.001], [Math.PI / 2, 0, 0]);
    const face = mesh(new THREE.CircleGeometry(0.0215, 48), new THREE.MeshStandardMaterial({ map: gaugeTexture(max, title, red), roughness: 0.4 }), g, [0, 0, 0.0025]);
    face.castShadow = false;
    const pivot = new THREE.Group(); pivot.position.z = 0.0035; g.add(pivot);
    mesh(new THREE.BoxGeometry(0.0012, 0.017, 0.0008), new THREE.MeshStandardMaterial({ color: 0xc8261a, roughness: 0.4 }), pivot, [0, 0.0075, 0]);
    mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.002, 16), M.chrome, pivot, [0, 0, 0], [Math.PI / 2, 0, 0]);
    mesh(new THREE.CircleGeometry(0.0215, 48), new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.1, roughness: 0, clearcoat: 1 }), g, [0, 0, 0.006]);
    R.needles[key] = { pivot, max };
  };
  mkGauge('pump', 0.258, 16, 'PUMP', 12);
  mkGauge('boiler', 0.200, 3, 'BOILER', 2);

  /* ── 전면 조명: 그룹헤드 뒤쪽(뒷벽 상단, 헤드 바로 아래) 백색 LED 라인 — 펌웨어 LEDBAR(PWM 0~255) ──
   *  LED 라인 자체(발광 띠 + 확산 커버) + 면광원(RectAreaLight)이 작업공간·잔·트레이를 비춘다. */
  //  KERNDU: 헤드 앞쪽 밑면에 아래를 비추는 LED 바(사진: 그룹헤드 위 가로 발광 띠)
  const lbY = K ? 0.338 : DIM.headY0 - 0.006, lbZ = K ? 0.094 : 0.028, lbW = K ? 0.60 : 0.64;   // KERNDU: CAD CONTROL PANEL LED BAR
  if (!K) mesh(new THREE.BoxGeometry(lbW + 0.02, 0.012, 0.010), new THREE.MeshStandardMaterial({ color: 0x15161a, metalness: 0.6, roughness: 0.4 }), root, [0, lbY + 0.002, lbZ - 0.004]);   // 알루미늄 채널
  const lb = mesh(new THREE.BoxGeometry(lbW, 0.005, 0.004), new THREE.MeshStandardMaterial({ color: 0xdfe4ea, emissive: 0xf4f8ff, emissiveIntensity: 0, roughness: 0.6 }), root, [0, lbY - 0.002, lbZ + 0.002]);   // 확산 커버
  lb.castShadow = false;
  const area = new THREE.RectAreaLight(0xf4f8ff, 0, lbW, 0.008);
  area.position.set(0, lbY - 0.004, lbZ + 0.004); area.lookAt(0, DIM.trayY, 0.20);
  root.add(area);
  R.ledbar = { mesh: lb, light: area };
  /* ── 후면 조명: 뒷면 상단에서 아래 방향 — 펌웨어 LEDBAR2(U17 GP6, AUX 6) / RGB ── */
  const rgY = K ? 0.297 : DIM.headY1 - 0.01;               // KERNDU: CAD REER PANEL LED BAR 높이
  const rg = mesh(new THREE.BoxGeometry(K ? 0.60 : 0.70, 0.004, 0.010), new THREE.MeshStandardMaterial({ color: 0x202020, emissive: 0x000000 }), root, [0, rgY, DIM.headBackZ - 0.008]);
  rg.castShadow = false;
  const rl = new THREE.SpotLight(0xffffff, 0, 1.4, Math.PI / 2.4, 0.8, 1.4);
  rl.position.set(0, rgY - 0.002, DIM.headBackZ - 0.02); rl.target.position.set(0, 0, DIM.headBackZ - 0.35);
  root.add(rl); root.add(rl.target);
  R.rearGlow = { mesh: rg, light: rl };

  if (K) { R.wandPivot = DIM.wandPivot.map(v => v.clone()); R.cadReady = loadKernduCad(R, root); }              // 기구도면 외장(비동기) — 완료 전엔 조작부만 보임
  return R;
}
