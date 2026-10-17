// Copied from samcho93/studyHPLC1260 sim/js/hplc-look.js (same author) — keep in sync there.
// hplc-look.js — HPLC 3D 모델을 실물처럼 보이게 하는 모듈 (sim/js/inst3d.js 의 3D 탭이 씀)
//
//   import { enhanceScene, upgradeMaterials, addDecals, createPilotScreen } from './hplc-look.js';
//
// URDF 는 색만 가진 기본 도형이므로, 여기서 색으로 재질을 알아보고(분체 도장 · 사출 플라스틱 · 스테인리스 ·
// PEEK · 유리 …) 물리 기반 재질 + 절차적 텍스처(캔버스)로 바꿉니다. 이미지 파일을 쓰지 않으므로 오프라인
// 캐시 · 저장소 크기에 부담이 없습니다. 앞판 글자 · 병 라벨 · Instant Pilot 화면도 캔버스 텍스처입니다.
// 좌표는 URDF 링크 기준(x 앞, y 오른쪽, z 위, m) — make_hplc_model.py 와 같은 값을 씁니다.

import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const IN_Y = 0.16;
export const MODULE_TEXT = {
  pump: { name: 'Quaternary Pump', model: 'G7111B' },
  sampler: { name: 'Vialsampler', model: 'G7129A' },
  mct: { name: 'Multicolumn Thermostat', model: 'G7116A' },
  vwd: { name: 'Variable Wavelength Detector', model: 'G7114A' },
};
export const PILOT_KEYS = {
  f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5',
  status: 'Status', control: 'Control', method: 'Method', logbook: 'Logbook',
  onoff: 'On/Off', start: 'Start', stop: 'Stop',
};

// ------------------------------------------------------------------ 절차적 텍스처
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
let seed = 1234567;
function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }

function noiseCanvas(size, base, amp, grain = 1) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(0, Math.min(255, base + (rnd() - 0.5) * 2 * amp));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  if (grain > 1) { ctx.filter = `blur(${grain - 1}px)`; ctx.drawImage(c, 0, 0); ctx.filter = 'none'; }
  return c;
}
function brushedCanvas(size) {
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = 'rgb(120,120,120)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 3; i++) {
    const y = rnd() * size, g = 90 + rnd() * 80;
    ctx.strokeStyle = `rgba(${g},${g},${g},0.35)`;
    ctx.lineWidth = 0.5 + rnd();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y + (rnd() - 0.5) * 2); ctx.stroke();
  }
  return c;
}
function benchCanvas(size) {
  // 실험대 상판: 짙은 회색 에폭시 레진 + 미세한 반점
  const c = canvas(size, size), ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2e31';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size / 18; i++) {
    const g = 40 + rnd() * 40;
    ctx.fillStyle = `rgba(${g},${g + 2},${g + 4},${0.25 + rnd() * 0.4})`;
    ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
  }
  return c;
}

const texCache = {};
function tex(THREE, key, make, repeat = 1, color = false) {
  if (texCache[key]) return texCache[key];
  const t = new THREE.CanvasTexture(make());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  texCache[key] = t;
  return t;
}

// ------------------------------------------------------------------ 장면 (조명 · 환경 반사)
export function enhanceScene(THREE, renderer, scene, opts = {}) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure || 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = opts.envIntensity || 0.55;
  pmrem.dispose();
  if (opts.shadows) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
  }
  return env;
}

/** 그림자를 드리우는 키 라이트 (장비 크기에 맞춘 그림자 카메라). */
export function shadowLight(THREE, light) {
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  const c = light.shadow.camera;
  c.left = -1; c.right = 1; c.top = 1; c.bottom = -1; c.near = 0.5; c.far = 8;
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.01;
  light.shadow.radius = 3;
}

// ------------------------------------------------------------------ 재질
// URDF 색(rgba) → 재질 종류. 색 값은 make_hplc_model.py 의 C_* 상수.
const KINDS = [
  ['body', [0.80, 0.81, 0.82, 1]],
  ['door', [0.90, 0.91, 0.91, 1]],
  ['trim', [0.24, 0.26, 0.29, 1]],
  ['inner', [0.32, 0.34, 0.37, 1]],
  ['alu', [0.58, 0.62, 0.66, 1]],
  ['steel', [0.72, 0.74, 0.77, 1]],
  ['peek', [0.82, 0.70, 0.45, 1]],
  ['ptfe', [0.92, 0.94, 0.96, 0.85]],
  ['glass', [0.78, 0.88, 0.95, 0.30]],
  ['liquid', [0.55, 0.75, 0.95, 0.55]],
  ['led', [0.20, 0.85, 0.35, 1]],
  ['blue', [0.15, 0.35, 0.75, 1]],
  ['bench', [0.62, 0.60, 0.56, 1]],
  ['window', [0.55, 0.65, 0.72, 0.45]],
  ['hdpe', [0.85, 0.80, 0.60, 0.40]],
  ['waste', [0.90, 0.75, 0.35, 0.55]],
  ['column', [0.30, 0.32, 0.35, 1]],
  ['copper', [0.75, 0.35, 0.20, 1]],
  ['lampwin', [0.65, 0.55, 0.95, 1]],
  ['label', [0.95, 0.95, 0.95, 1]],
  ['screen', [0.05, 0.07, 0.09, 1]],
  ['redcap', [0.85, 0.20, 0.20, 1]],
  ['keygreen', [0.20, 0.62, 0.32, 1]],
  ['keyred', [0.78, 0.20, 0.18, 1]],
];
function kindOf(c, a) {
  let best = null, dist = 0.02;
  for (const [k, v] of KINDS) {
    const d = Math.abs(c.r - v[0]) + Math.abs(c.g - v[1]) + Math.abs(c.b - v[2]) + Math.abs(a - v[3]) * 0.5;
    if (d < dist) { dist = d; best = k; }
  }
  return best;
}

function makeMaterial(THREE, kind, c, a) {
  const P = (o) => new THREE.MeshPhysicalMaterial(Object.assign({ color: c.clone() }, o));
  const noise = () => tex(THREE, 'noise', () => noiseCanvas(256, 128, 40, 2), 6);
  const fine = () => tex(THREE, 'fine', () => noiseCanvas(256, 140, 22, 1), 12);
  const brushed = () => tex(THREE, 'brushed', () => brushedCanvas(256), 3);
  switch (kind) {
    case 'body': return P({ roughness: 0.62, metalness: 0, bumpMap: noise(), bumpScale: 0.35, roughnessMap: fine() });
    case 'door': return P({ roughness: 0.38, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.3, bumpMap: fine(), bumpScale: 0.12 });
    case 'trim': return P({ roughness: 0.48, metalness: 0, clearcoat: 0.2, bumpMap: fine(), bumpScale: 0.15 });
    case 'inner': return P({ roughness: 0.82, metalness: 0, bumpMap: noise(), bumpScale: 0.25 });
    case 'alu': return P({ roughness: 0.42, metalness: 0.75, roughnessMap: brushed() });
    case 'steel': return P({ roughness: 0.26, metalness: 1, roughnessMap: brushed(), envMapIntensity: 1.2 });
    case 'column': return P({ roughness: 0.32, metalness: 1, roughnessMap: brushed() });
    case 'copper': return P({ roughness: 0.35, metalness: 0.9 });
    case 'peek': return P({ roughness: 0.36, metalness: 0, sheen: 0.4, sheenColor: new THREE.Color(0.9, 0.8, 0.6) });
    case 'ptfe': return P({ roughness: 0.32, metalness: 0, transparent: true, opacity: 0.78, depthWrite: false });
    case 'glass': return P({ color: new THREE.Color(0.86, 0.93, 0.97), roughness: 0.03, metalness: 0, transparent: true, opacity: 0.1,
      clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, ior: 1.5, envMapIntensity: 0.9, depthWrite: false });
    case 'window': return P({ roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, clearcoat: 1, depthWrite: false });
    case 'liquid': return P({ color: new THREE.Color(0.42, 0.62, 0.86), roughness: 0.06, metalness: 0, transparent: true, opacity: 0.3, ior: 1.33, depthWrite: false });
    case 'waste': return P({ roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });
    case 'hdpe': return P({ roughness: 0.6, metalness: 0, transparent: true, opacity: 0.35, depthWrite: false });
    case 'led': return P({ roughness: 0.3, emissive: c.clone(), emissiveIntensity: 0.6 });
    case 'lampwin': return P({ roughness: 0.1, metalness: 0, emissive: new THREE.Color(0, 0, 0) });
    case 'blue': case 'redcap': return P({ roughness: 0.45, metalness: 0, bumpMap: fine(), bumpScale: 0.1 });
    case 'label': return P({ roughness: 0.7, metalness: 0 });
    case 'screen': return P({ roughness: 0.15, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
    case 'keygreen': return P({ color: new THREE.Color(0.02, 0.22, 0.06), roughness: 0.4, metalness: 0, clearcoat: 0.4 });
    case 'keyred': return P({ color: new THREE.Color(0.42, 0.03, 0.02), roughness: 0.4, metalness: 0, clearcoat: 0.4 });
    case 'bench': {
      const m = P({ color: new THREE.Color(1, 1, 1), roughness: 0.55, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.4,
        map: tex(THREE, 'bench', () => benchCanvas(512), 3, true) });
      return m;
    }
    default: return new THREE.MeshStandardMaterial({ color: c.clone(), roughness: 0.5, metalness: 0, transparent: a < 1, opacity: a });
  }
}

/**
 * 로봇(URDF) 안의 메시 재질을 물리 기반 재질로 바꿉니다.
 * 반환: { kinds: Map(mesh → kind) } — 시뮬레이터가 LED · 램프 창 같은 특정 재질을 찾을 때 씁니다.
 */
export function upgradeMaterials(THREE, robot, opts = {}) {
  const kinds = new Map();
  const cache = new Map();
  robot.traverse((o) => {
    if (!o.isMesh || o.userData.hlUpgraded) return;
    const old = o.material;
    if (!old || !old.color) return;
    const a = old.transparent ? old.opacity : 1;
    const kind = kindOf(old.color, a);
    // 상태가 바뀌는 재질(LED · 램프 창)은 메시마다 따로, 나머지는 같은 종류 · 색끼리 공유
    const key = kind + ':' + old.color.getHexString() + ':' + a.toFixed(2);
    let m;
    if (kind === 'led' || kind === 'lampwin' || opts.unique) m = makeMaterial(THREE, kind, old.color, a);
    else { m = cache.get(key); if (!m) { m = makeMaterial(THREE, kind, old.color, a); cache.set(key, m); } }
    o.material = m;
    o.userData.hlUpgraded = true;
    o.userData.kind = kind;
    kinds.set(o, kind);
    const solid = !m.transparent;
    o.castShadow = solid && kind !== 'bench';
    o.receiveShadow = true;
  });
  return { kinds };
}

// ------------------------------------------------------------------ 캔버스 글자 판
function textPlane(THREE, w, h, draw, pxPerM = 4000) {
  const cw = Math.max(16, Math.round(w * pxPerM)), ch = Math.max(16, Math.round(h * pxPerM));
  const c = canvas(cw, ch), ctx = c.getContext('2d');
  draw(ctx, cw, ch);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.55, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  mesh.renderOrder = 2;
  mesh.userData.decal = true;
  mesh.userData.canvas = c;
  mesh.userData.redraw = (fn) => { fn(ctx, cw, ch); t.needsUpdate = true; };
  return mesh;
}
// 판이 링크의 +x 를 보도록 (가로 = +y, 세로 = +z)
function faceX(THREE, mesh, x, y, z) {
  mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
  mesh.position.set(x, y, z);
  return mesh;
}
const SANS = '"Pretendard Variable", "Segoe UI", Arial, sans-serif';

/**
 * 앞판 글자(제조사 · 모델명 · 제품 번호), 전원 스위치 링, 병 라벨, Instant Pilot 키 글자를 붙입니다.
 * plumb: plumbing.json (modules 의 z · h 를 씀). 반환: { power: {mod: ringMaterial}, bottle: {ch: decalMesh} }
 */
export function addDecals(THREE, robot, plumb) {
  const out = { power: {}, bottle: {}, keys: {} };
  const L = (n) => robot.links[n];
  for (const [mod, txt] of Object.entries(MODULE_TEXT)) {
    const door = L(mod + '_door'), m = plumb.modules[mod];
    if (!door || !m) continue;
    const h = m.h;
    // 이름 띠 (어두운 띠 위의 밝은 글자)
    const strip = textPlane(THREE, 2 * IN_Y - 0.034, 0.016, (ctx, w, hh) => {
      ctx.clearRect(0, 0, w, hh);
      ctx.fillStyle = '#e8ecef';
      ctx.font = `700 ${hh * 0.62}px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText('Agilent', hh * 1.6, hh * 0.55);
      ctx.font = `500 ${hh * 0.5}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.fillText(`1260 Infinity II  ·  ${txt.name}`, w - hh * 0.4, hh * 0.55);
    });
    door.add(faceX(THREE, strip, 0.0102, IN_Y, h - 0.03));
    // 제품 번호 (앞판 오른쪽 아래)
    const tag = textPlane(THREE, 0.05, 0.011, (ctx, w, hh) => {
      ctx.clearRect(0, 0, w, hh);
      ctx.fillStyle = '#5b6470';
      ctx.font = `600 ${hh * 0.7}px ${SANS}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(txt.model, w - 2, hh / 2);
    });
    door.add(faceX(THREE, tag, 0.0082, 2 * IN_Y - 0.035, 0.022));
    // 전원 스위치 둘레의 상태 링
    const pw = L(mod + '_power');
    if (pw) {
      const ringMat = new THREE.MeshStandardMaterial({ color: 0x1f2a22, emissive: 0x000000, roughness: 0.3 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0052, 0.0007, 8, 32), ringMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.set(0.0032, 0, 0);
      ring.userData.decal = true;
      pw.add(ring);
      out.power[mod] = ringMat;
    }
  }
  // 용매병 라벨 (병 앞쪽 = +x)
  for (const ch of 'ABCD') {
    const b = L('bottle_' + ch);
    if (!b) continue;
    // 병 곡면을 따라 감기는 라벨: 원기둥 일부(정면 ±0.6 rad)에 텍스처
    const lab = textPlane(THREE, 0.05, 0.06, (ctx, w, hh) => drawBottleLabel(ctx, w, hh, ch, ''));
    const r = 0.0428, arc = 0.05 / r;
    lab.geometry.dispose();
    lab.geometry = new THREE.CylinderGeometry(r, r, 0.06, 24, 1, true, Math.PI / 2 - arc / 2, arc).rotateX(Math.PI / 2);
    lab.position.set(0, 0, 0.075);
    b.add(lab);
    out.bottle[ch] = lab;
  }
  // Instant Pilot 키 글자
  for (const [k, label] of Object.entries(PILOT_KEYS)) {
    const key = L('ip_key_' + k);
    if (!key) continue;
    const big = /^(onoff|start|stop)$/.test(k);
    const w = big ? 0.03 : /^f\d$/.test(k) ? 0.019 : 0.026, hh = big ? 0.017 : /^f\d$/.test(k) ? 0.009 : 0.013;
    const p = textPlane(THREE, w, hh, (ctx, cw, ch) => {
      ctx.clearRect(0, 0, cw, ch);
      ctx.fillStyle = /^(start|stop)$/.test(k) ? '#ffffff' : '#1d232a';
      ctx.font = `700 ${ch * (big ? 0.42 : 0.5)}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, cw / 2, ch / 2 + 1);
    }, 6000);
    key.add(faceX(THREE, p, 0.0041, 0, 0));
    out.keys[k] = key;
  }
  // 제조사 글자 (Instant Pilot 아래 테두리)
  const ip = L('instant_pilot');
  if (ip) {
    const brand = textPlane(THREE, 0.08, 0.01, (ctx, w, hh) => {
      ctx.clearRect(0, 0, w, hh);
      ctx.fillStyle = '#cfd6dd';
      ctx.font = `600 ${hh * 0.6}px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Instant Pilot  G4208A', w / 2, hh / 2);
    });
    ip.add(faceX(THREE, brand, 0.0006, 0, -0.096));
  }
  return out;
}

export function drawBottleLabel(ctx, w, h, ch, solvent) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(248,248,244,0.96)';
  ctx.fillRect(0, h * 0.1, w, h * 0.8);
  ctx.fillStyle = '#1f6fb2';
  ctx.fillRect(0, h * 0.1, w, h * 0.16);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${h * 0.12}px ${SANS}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CHANNEL', w / 2, h * 0.18);
  ctx.fillStyle = '#1d232a';
  ctx.font = `800 ${h * 0.34}px ${SANS}`;
  ctx.fillText(ch, w / 2, h * 0.47);
  ctx.font = `600 ${h * 0.1}px ${SANS}`;
  const words = String(solvent || '').split(' ');
  let line = '', y = h * 0.7;
  for (const wd of words) {
    const t = line ? line + ' ' + wd : wd;
    if (ctx.measureText(t).width > w * 0.9 && line) { ctx.fillText(line, w / 2, y); line = wd; y += h * 0.11; } else line = t;
  }
  if (line) ctx.fillText(line, w / 2, y);
}

// ------------------------------------------------------------------ Instant Pilot 화면
/** ip_screen 링크 앞에 캔버스 화면을 붙이고, 그리기 함수 draw(fn) 를 돌려줍니다. fn(ctx, w, h). */
export function createPilotScreen(THREE, robot) {
  const link = robot.links.ip_screen;
  if (!link) return null;
  const W = 0.116, H = 0.082;
  const c = canvas(464, 328), ctx = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const mat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false });
  const mesh = faceX(THREE, new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat), 0.0012, 0, 0.043);
  mesh.userData.decal = true;
  link.add(mesh);
  return {
    mesh, canvas: c,
    draw(fn) { fn(ctx, c.width, c.height); t.needsUpdate = true; },
  };
}

/** Instant Pilot 화면 공통 틀: 제목 막대 + 본문 + 아래 소프트키 이름 5칸. */
export function drawPilotFrame(ctx, w, h, title, softkeys, body, opts = {}) {
  ctx.fillStyle = opts.off ? '#05070a' : '#0d1b2a';
  ctx.fillRect(0, 0, w, h);
  if (opts.off) return;
  ctx.fillStyle = '#1f4f82';
  ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 19px ${SANS}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(title, 12, 18);
  if (opts.right) { ctx.textAlign = 'right'; ctx.font = `600 15px ${SANS}`; ctx.fillText(opts.right, w - 10, 18); }
  ctx.textAlign = 'left';
  body(ctx, w, h);
  const kw = w / 5;
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = softkeys[i] ? '#27384a' : '#141f2b';
    ctx.fillRect(i * kw + 3, h - 34, kw - 6, 30);
    if (softkeys[i]) {
      ctx.fillStyle = '#e6edf3';
      ctx.font = `600 14px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText(softkeys[i], i * kw + kw / 2, h - 19);
    }
  }
  ctx.textAlign = 'left';
}
