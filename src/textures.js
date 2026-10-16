// Procedural (canvas) textures so the repo ships no binary assets.
import * as THREE from 'three';

const cache = new Map();

function canvasTex(key, size, draw, { repeat = [1, 1], srgb = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function noise(g, size, alpha, seed = 1, scale = 1) {
  const r = rand(seed);
  const n = Math.floor(size * size * 0.06 * scale);
  for (let i = 0; i < n; i++) {
    const v = Math.floor(r() * 255);
    g.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
}

// Tiles: `tiles` per texture side; the texture covers `meters` metres.
function tiles(g, size, n, base, joint, vary, seed, jointW = 2) {
  const r = rand(seed);
  const s = size / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const d = (r() - 0.5) * vary;
    g.fillStyle = shade(base, d);
    g.fillRect(i * s, j * s, s, s);
  }
  noise(g, size, 0.08, seed + 7);
  g.fillStyle = joint;
  for (let i = 0; i <= n; i++) {
    g.fillRect(i * s - jointW / 2, 0, jointW, size);
    g.fillRect(0, i * s - jointW / 2, size, jointW);
  }
}

function shade(hex, d) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, d);
  return '#' + c.getHexString();
}

export const T = {
  vinyl: () => canvasTex('vinyl', 512, (g, s) => tiles(g, s, 4, '#c9c4ba', '#a39d92', 0.05, 3)),        // 600mm tiles -> 2.4m
  stone: () => canvasTex('stone', 512, (g, s) => {                                                     // lobby stone 800mm
    tiles(g, s, 3, '#cfc7b8', '#a89f90', 0.05, 11, 2);
    const r = rand(5);
    for (let k = 0; k < 120; k++) {
      g.strokeStyle = `rgba(120,110,95,${0.05 + r() * 0.08})`;
      g.beginPath(); const x = r() * s, y = r() * s; g.moveTo(x, y);
      g.bezierCurveTo(x + r() * 60, y + r() * 20, x + r() * 90, y - r() * 20, x + r() * 140, y + r() * 10); g.stroke();
    }
  }),
  epoxy: () => canvasTex('epoxy', 512, (g, s) => { g.fillStyle = '#8f9a92'; g.fillRect(0, 0, s, s); noise(g, s, 0.15, 9, 3); }),
  asphalt: () => canvasTex('asphalt', 512, (g, s) => { g.fillStyle = '#4a4b4d'; g.fillRect(0, 0, s, s); noise(g, s, 0.35, 21, 6); }),
  paving: () => canvasTex('paving', 512, (g, s) => {                                                 // sidewalk blocks
    const r = rand(17), n = 8, w = s / n, h = s / (n * 2);
    for (let j = 0; j < n * 2; j++) for (let i = 0; i < n + 1; i++) {
      const off = (j % 2) * w / 2;
      g.fillStyle = shade('#b9b3aa', (r() - 0.5) * 0.08);
      g.fillRect(i * w - off + 1, j * h + 1, w - 2, h - 2);
    }
    noise(g, s, 0.1, 4);
  }),
  carpet: () => canvasTex('carpet', 256, (g, s) => { g.fillStyle = '#5d6470'; g.fillRect(0, 0, s, s); noise(g, s, 0.25, 31, 8); }),
  rubber: () => canvasTex('rubber', 256, (g, s) => { g.fillStyle = '#6e6a66'; g.fillRect(0, 0, s, s); noise(g, s, 0.15, 41, 4); }),
  paint: () => canvasTex('paint', 256, (g, s) => { g.fillStyle = '#f1eee8'; g.fillRect(0, 0, s, s); noise(g, s, 0.05, 2, 2); }),
  concrete: () => canvasTex('concrete', 512, (g, s) => { g.fillStyle = '#a7a7a3'; g.fillRect(0, 0, s, s); noise(g, s, 0.2, 6, 5); }),
  // Facade limestone panels 1200 x 600 (texture = 2.4m x 2.4m)
  facadeStone: () => canvasTex('fstone', 512, (g, s) => {
    const r = rand(8), cols = 2, rows = 4, w = s / cols, h = s / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      g.fillStyle = shade('#ddd6c8', (r() - 0.5) * 0.035);
      g.fillRect(i * w, j * h, w, h);
    }
    noise(g, s, 0.07, 12, 2);
    g.fillStyle = '#b6ad9e';
    for (let i = 0; i <= cols; i++) g.fillRect(i * w - 1, 0, 2, s);
    for (let j = 0; j <= rows; j++) g.fillRect(0, j * h - 1, s, 2);
  }),
  granite: () => canvasTex('granite', 512, (g, s) => {
    const r = rand(9), cols = 2, rows = 4, w = s / cols, h = s / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      g.fillStyle = shade('#55585c', (r() - 0.5) * 0.04);
      g.fillRect(i * w, j * h, w, h);
    }
    noise(g, s, 0.25, 13, 5);
    g.fillStyle = '#3c3e41';
    for (let i = 0; i <= cols; i++) g.fillRect(i * w - 1, 0, 2, s);
    for (let j = 0; j <= rows; j++) g.fillRect(0, j * h - 1, s, 2);
  }),
  // 600mm acoustic ceiling tiles with a 600x1200 LED panel every few tiles (2.4m)
  ceiling: () => canvasTex('ceiling', 512, (g, s) => tiles(g, s, 4, '#f2f1ee', '#c9c7c2', 0.01, 5, 3)),
  ceilingEmit: () => canvasTex('ceilingE', 512, (g, s) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#fff'; const t = s / 4; g.fillRect(t + 6, t + 6, t - 12, 2 * t - 12);
    g.fillRect(3 * t + 6, 3 * t + 6, t - 12, t - 12);
  }),
  wood: () => canvasTex('wood', 256, (g, s) => {
    g.fillStyle = '#c9a77c'; g.fillRect(0, 0, s, s);
    const r = rand(3);
    for (let i = 0; i < 80; i++) { g.fillStyle = `rgba(110,75,40,${r() * 0.12})`; g.fillRect(0, r() * s, s, 1 + r() * 3); }
  }),
  tileWall: () => canvasTex('tilewall', 256, (g, s) => tiles(g, s, 8, '#e9ecec', '#c3c7c7', 0.015, 4)),
};

export function sign(text, { w = 1024, h = 256, bg = null, fg = '#1c2a52', font = 'bold 150px "Malgun Gothic", "Noto Sans KR", sans-serif', vertical = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } else g.clearRect(0, 0, w, h);
  g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (vertical) {
    const chars = [...text]; const step = h / chars.length;
    chars.forEach((ch, i) => g.fillText(ch, w / 2, step * (i + 0.5)));
  } else {
    const lines = text.split('\n');
    lines.forEach((ln, i) => g.fillText(ln, w / 2, h * (i + 0.5) / lines.length));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
