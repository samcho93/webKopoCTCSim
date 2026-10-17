// materials.js — PBR 재질 + 캔버스 생성 텍스처(타공 그릴, 아이콘, 게이지 문자판)
import * as THREE from 'three';

function canvasTex(w, h, draw, opt = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = opt.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (opt.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...opt.repeat); }
  return t;
}

/* 헤어라인(브러시드) 거칠기 맵 */
const brushedRough = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 4000; i++) {
    const y = Math.random() * h, l = 40 + Math.random() * 300, x = Math.random() * w;
    const v = 100 + Math.random() * 70 | 0;
    g.strokeStyle = `rgba(${v},${v},${v},0.35)`; g.lineWidth = Math.random() * 1.2;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y); g.stroke();
  }
}, { srgb: false, repeat: [2, 2] });

/* 미세 분체도장 노이즈(바디) */
const powderBump = canvasTex(256, 256, (g, w, h) => {
  const im = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) { const v = 118 + Math.random() * 20; im.data.set([v, v, v, 255], i * 4); }
  g.putImageData(im, 0, 0);
}, { srgb: false, repeat: [6, 6] });

/* 드립트레이 타공 그릴: 육각 배열 원형 구멍(알파) */
export function grateTextures(repX, repY) {
  const draw = (alpha) => (g, w, h) => {
    g.fillStyle = alpha ? '#fff' : '#d8dadc'; g.fillRect(0, 0, w, h);
    const s = w / 4, r = s * 0.30;
    g.fillStyle = alpha ? '#000' : '#202224';
    for (let row = -1; row < 5; row++) for (let col = -1; col < 5; col++) {
      const x = col * s + (row % 2 ? s / 2 : 0) + s / 2, y = row * s * 0.866 + s / 2;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  };
  const map = canvasTex(128, 111, draw(false), { repeat: [repX, repY] });
  const alpha = canvasTex(128, 111, draw(true), { srgb: false, repeat: [repX, repY] });
  return { map, alpha };
}

export const M = {
  body: new THREE.MeshPhysicalMaterial({ color: 0x08080a, roughness: 0.55, metalness: 0.1, clearcoat: 0.22, clearcoatRoughness: 0.35, envMapIntensity: 0.3,
                                         bumpMap: powderBump, bumpScale: 0.25 }),
  bodyMatte: new THREE.MeshPhysicalMaterial({ color: 0x0c0d0f, roughness: 0.62, metalness: 0.12, clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 0.4 }),
  glassBlack: new THREE.MeshPhysicalMaterial({ color: 0x050506, roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, reflectivity: 0.8 }),
  chrome: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, metalness: 1, roughness: 0.08 }),
  steel: new THREE.MeshStandardMaterial({ color: 0xc9cbcd, metalness: 1, roughness: 0.32, roughnessMap: brushedRough }),
  steelDark: new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 1, roughness: 0.4 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x0c0c0c, metalness: 0, roughness: 0.82 }),
  plasticBlack: new THREE.MeshStandardMaterial({ color: 0x0a0a0b, metalness: 0.1, roughness: 0.35 }),
  ceramic: new THREE.MeshPhysicalMaterial({ color: 0xf5f3ef, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 }),
  teal: new THREE.MeshPhysicalMaterial({ color: 0x1d6b6b, metalness: 0.3, roughness: 0.25, clearcoat: 1 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.38, metalness: 0.4 }),
  gasket: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xc87f4a, metalness: 1, roughness: 0.32 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 1, roughness: 0.3 }),
};
export const SHELL_MATS = [M.body, M.bodyMatte, M.glassBlack];

/* 버튼 위 아이콘(컵·점) */
export function iconTexture(kind) {
  return canvasTex(128, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#e9edf0'; g.fillStyle = '#e9edf0'; g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
    // 양산 렌더 사진의 아이콘: 둥근 바닥 컵 + 손잡이, 컵 위 가로선 0/1/2개(잔 크기·샷 수)
    const cup = (cx, cy, lines) => {
      const w = 22, top = cy - 12, bot = cy + 18;
      g.beginPath(); g.moveTo(cx - w, top); g.lineTo(cx + w, top);                                   // 입구
      g.moveTo(cx - w, top); g.lineTo(cx - w + 2, bot - 10); g.quadraticCurveTo(cx - w + 4, bot, cx - w + 14, bot);
      g.lineTo(cx + w - 14, bot); g.quadraticCurveTo(cx + w - 4, bot, cx + w - 2, bot - 10); g.lineTo(cx + w, top); g.stroke();
      g.beginPath(); g.arc(cx + w + 5, cy + 1, 8, -Math.PI / 2, Math.PI / 2); g.stroke();             // 손잡이
      for (let k = 0; k < lines; k++) { g.beginPath(); g.moveTo(cx - w + 3, top - 9 - k * 9); g.lineTo(cx + w - 3, top - 9 - k * 9); g.stroke(); }
    };
    if (kind === 'cup1') cup(58, 72, 0);
    else if (kind === 'cup2') cup(58, 76, 1);
    else if (kind === 'cup3') cup(58, 80, 2);
    else if (kind === 'dots3') { for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(34 + i * 30, 64, 9, 0, Math.PI * 2); g.fill(); } }
    else if (kind === 'dot1') { g.beginPath(); g.arc(64, 64, 11, 0, Math.PI * 2); g.fill(); }
    else if (kind === 'dot2') { for (let i = 0; i < 2; i++) { g.beginPath(); g.arc(46 + i * 36, 64, 11, 0, Math.PI * 2); g.fill(); } }
  });
}

/* 압력 게이지 문자판 */
export function gaugeTexture(maxBar, title, redFrom) {
  return canvasTex(256, 256, (g, w, h) => {
    const cx = 128, cy = 128;
    const grd = g.createRadialGradient(cx, cy - 30, 10, cx, cy, 128);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#dcdfe2');
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, 126, 0, Math.PI * 2); g.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    // 적색 구간
    g.strokeStyle = '#d23a2a'; g.lineWidth = 10;
    g.beginPath(); g.arc(cx, cy, 100, a0 + (a1 - a0) * redFrom / maxBar, a1); g.stroke();
    g.strokeStyle = '#2a7a3a';
    g.beginPath(); g.arc(cx, cy, 100, a0 + (a1 - a0) * (maxBar * 0.35) / maxBar, a0 + (a1 - a0) * (maxBar * 0.62) / maxBar); g.stroke();
    g.fillStyle = '#111'; g.strokeStyle = '#111';
    const steps = maxBar <= 3 ? maxBar * 10 : maxBar * 2;
    for (let i = 0; i <= steps; i++) {
      const v = i / steps, a = a0 + (a1 - a0) * v, major = maxBar <= 3 ? i % 5 === 0 : i % 2 === 0;
      g.lineWidth = major ? 4 : 2;
      const r1 = major ? 84 : 90;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * 106, cy + Math.sin(a) * 106); g.stroke();
      if (major) {
        g.font = 'bold 20px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
        const val = maxBar <= 3 ? (i / 10).toFixed(1).replace('.0', '') : String(i / 2);
        g.fillText(val, cx + Math.cos(a) * 66, cy + Math.sin(a) * 66);
      }
    }
    g.font = 'bold 18px Arial'; g.textAlign = 'center'; g.fillText('bar', cx, cy + 46);
    g.font = '13px Arial'; g.fillStyle = '#444'; g.fillText(title, cx, cy + 68);
  });
}

/* 부드러운 원형 스프라이트(증기·물방울) */
export const softDot = canvasTex(64, 64, (g, w, h) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});

/* 배관 흐름 표시용 스트라이프(알파) */
export function flowStripe() {
  return canvasTex(64, 8, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.45, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.2)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}
