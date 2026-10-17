// Parked cars (level.equipment "car-carnival"): Kia Carnival (KA4).
// Model: "Kia Carnival" by Nieve5677 — https://sketchfab.com/3d-models/kia-carnival-85cc817cc9984fafb879760df5af3ae8
// (CC-BY-4.0), baked by tools/build_car.py to public/equipment/car/carnival.glb: merged per material,
// real size (5155 mm long), origin at the centre of the footprint, +x forward, +y up.
// Here the flat Sketchfab materials are replaced with physical ones (clear-coated paint in the colour from
// building.json, glass, chrome, lamps, tyres) and the Korean licence plate from building.json is ray-cast
// onto the bumper / tailgate. Static prop, not a vehicle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { toWorld } from './geo.js';

const URL = `${import.meta.env.BASE_URL}equipment/car/carnival.glb`;
const L = 5.155, W = 1.995;
const PLATE_Y = { front: 0.56, rear: 0.98 };      // plate centre heights (m); rear = halfway between the KIA logo (1.16) and 0.80

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
/**
 * Korean licence plate, 520 x 110 mm, current style: white field, black characters, black rim, and a
 * blue band at the left with the round emblem and "KOR".
 */
const plateMap = (text) => canvasTex(1040, 220, (g, w, h) => {
  const round = (x, y, ww, hh, r) => { g.beginPath(); g.roundRect(x, y, ww, hh, r); };
  g.fillStyle = '#0d0d0f'; round(0, 0, w, h, 26); g.fill();                     // black rim
  g.fillStyle = '#f6f7f6'; round(14, 14, w - 28, h - 28, 16); g.fill();         // white field
  // blue band
  const bw = 118;
  g.save(); round(14, 14, w - 28, h - 28, 16); g.clip();
  const bg = g.createLinearGradient(14, 0, 14 + bw, 0);
  bg.addColorStop(0, '#0a3d9c'); bg.addColorStop(1, '#1d63d1');
  g.fillStyle = bg; g.fillRect(14, 14, bw, h - 28);
  g.restore();
  // round emblem (two interlocking halves) with a white rim
  const cx = 14 + bw / 2, cy = 72, r = 38;
  g.fillStyle = '#e9eef6'; g.beginPath(); g.arc(cx, cy, r + 4, 0, Math.PI * 2); g.fill();
  g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#1e5fc4'; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  g.fillStyle = '#5aa0ee'; g.beginPath(); g.arc(cx, cy, r, Math.PI, 0); g.arc(cx + r / 2, cy, r / 2, 0, Math.PI, false); g.arc(cx - r / 2, cy, r / 2, 0, Math.PI, true); g.fill();
  const sh = g.createRadialGradient(cx - 14, cy - 16, 2, cx, cy, r); sh.addColorStop(0, 'rgba(255,255,255,0.55)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sh; g.fillRect(cx - r, cy - r, 2 * r, 2 * r);
  g.restore();
  g.fillStyle = '#cfe2ff'; g.font = 'italic 800 40px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('KOR', cx, 160);
  // characters: tall condensed bold; the Hangul syllable a little smaller than the digits, centred on them
  const m = /^(\d+)\s*(\S)\s*(\d+)$/.exec(text.trim()) || [null, text, '', ''];
  const x0 = 14 + bw + 26, x1 = w - 40, fs = 200;
  g.fillStyle = '#0b0b0b'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  const parts = [[m[1], 1.0, 1.0], [m[2], 0.85, 0.85], [m[3], 1.0, 1.0]];   // [text, width scale, size scale]
  g.font = `700 ${fs}px "Arial Narrow", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;
  const gap = 34, widths = parts.map(([t, k]) => g.measureText(t).width * k);
  const sx = (x1 - x0) / (widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1));
  let x = x0;
  parts.forEach(([t, k], i) => {
    const ks = parts[i][2];
    g.save(); g.translate(x, 184 - (1 - ks) * fs * 0.36); g.scale(sx * k, ks); g.fillText(t, 0, 0); g.restore();
    x += (widths[i] + gap) * sx;
  });
});
const contactShadow = () => canvasTex(256, 128, (g, w, h) => {
  const r = g.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
  r.addColorStop(0, 'rgba(0,0,0,0.75)'); r.addColorStop(0.6, 'rgba(0,0,0,0.45)'); r.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.scale(1, h / w); g.fillStyle = r; g.fillRect(0, 0, w, w); g.restore();
});

/** Physical replacements for the Sketchfab materials, by material name. */
function restyle(color) {
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const glass = (o) => P({ transparent: true, depthWrite: false, roughness: 0.03, metalness: 0, ...o });
  const paint = P({ color, metalness: 0.6, roughness: 0.34, clearcoat: 1, clearcoatRoughness: 0.03 });
  const chrome = P({ color: 0xd9dce0, metalness: 1, roughness: 0.12 });
  const gloss = P({ color: 0x050506, metalness: 0.1, roughness: 0.22, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const satin = P({ color: 0x0b0b0c, roughness: 0.6 });
  return {
    Panthera_Metal: paint,
    Windows: glass({ color: 0x020304, opacity: 0.86, specularIntensity: 0.7, envMapIntensity: 0.8 }),
    HeadLightsGlass1: glass({ color: 0xffffff, opacity: 0.12, clearcoat: 1 }),
    BrakeLightsGlass: glass({ color: 0x5a0006, opacity: 0.45, clearcoat: 1 }),
    ReflectorGlass: glass({ color: 0x8a0008, opacity: 0.5 }),
    ChromeTrims: chrome, Badges: chrome,
    Mirrors: P({ color: 0xe8eaec, metalness: 1, roughness: 0.04 }),
    Black1: gloss, BlackTrims1: satin, WindowsTrims: gloss, Grille1: P({ color: 0x08090a, metalness: 0.45, roughness: 0.25, clearcoat: 1 }),
    HeadLightsBase: P({ color: 0x15171a, metalness: 0.6, roughness: 0.3 }),
    DRLsandProjectors: P({ color: 0xe9eef5, emissive: 0xdfe9ff, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.15 }),
    BrakeLightsMain: P({ color: 0x7a0008, emissive: 0xb0101a, emissiveIntensity: 0.3, roughness: 0.25 }),
    Reflector: P({ color: 0x6e0006, roughness: 0.3 }),
    DarkRed: P({ color: 0x2a0204, roughness: 0.3 }),
    Orange_Catastrophic: P({ color: 0xc46a10, emissive: 0x6a3000, emissiveIntensity: 0.2, roughness: 0.3 }),
    Tires: P({ color: 0x181818, roughness: 0.9 }),
    Rims1: P({ color: 0x24262a, metalness: 0.7, roughness: 0.35 }),
    Rims2: P({ color: 0xbfc3c8, metalness: 1, roughness: 0.2 }),
    BrakeRotors1: P({ color: 0x7c7f83, metalness: 0.9, roughness: 0.45 }),
    BrakeRotors2: P({ color: 0x2a2b2d, metalness: 0.5, roughness: 0.5 }),
    Calipers: P({ color: 0x26282b, metalness: 0.4, roughness: 0.5 }),
    Interior: P({ color: 0x141414, roughness: 0.85 }),
    UnderCarrier: satin,
  };
}

let template = null;
async function loadTemplate() {
  if (!template) {
    template = new GLTFLoader().loadAsync(URL).then((g) => {
      // the bake carries no normals: smooth panels, keep hard creases (shut lines, trims, tyre shoulders)
      g.scene.traverse((o) => { if (o.isMesh && !o.geometry.attributes.normal) o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(40)); });
      return g.scene;
    });
  }
  return template;
}

/**
 * Mounts a plate on the front (dir +1) or rear (dir -1) centre line at height y: rays over the whole plate
 * area find the body surface, and the plate is set flat and upright (facing straight out) just in front of
 * the point that sticks out most — so none of it sinks into the curved bumper / tailgate.
 */
function addPlate(car, mat, dir, y) {
  const solid = [];
  car.traverse((o) => { if (o.isMesh && !o.material.transparent) solid.push(o); });
  car.updateMatrixWorld(true);
  const rc = new THREE.Raycaster();
  let out = null;
  for (const dz of [-0.26, -0.13, 0, 0.13, 0.26]) for (const dy of [-0.055, 0, 0.055]) {
    rc.set(new THREE.Vector3(dir * (L / 2 + 1), y + dy, dz), new THREE.Vector3(-dir, 0, 0));
    rc.far = 1.6;
    const hit = rc.intersectObjects(solid, false)[0];
    if (hit && (out === null || hit.point.x * dir > out * dir)) out = hit.point.x;
  }
  if (out === null) out = dir * (L / 2 - 0.05);
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), mat);
  p.position.set(out + dir * 0.008, y, 0);
  p.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
  car.add(p);
}

export async function buildCarnival({ color = '#3b3e43', plate = '' } = {}) {
  const src = await loadTemplate();
  const car = src.clone(true);
  car.name = 'car-carnival';
  const mats = restyle(color);
  car.traverse((o) => {
    if (!o.isMesh) return;
    const key = (o.material.name || o.name).replace(/^2022_Kia_Carnival_/, '');
    if (mats[key]) o.material = mats[key];
    o.material.side = THREE.DoubleSide;           // the export is single-skinned in places
    o.castShadow = !o.material.transparent; o.receiveShadow = true;
  });
  if (plate) {
    const pm = new THREE.MeshStandardMaterial({ map: plateMap(plate), roughness: 0.45, metalness: 0.1 });
    addPlate(car, pm, 1, PLATE_Y.front);
    addPlate(car, pm, -1, PLATE_Y.rear);
  }
  // soft contact shadow under the car (the ambient occlusion the shadow map can't give)
  const cs = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.5, W + 0.45), new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, opacity: 0.9 }));
  cs.rotation.x = -Math.PI / 2; cs.position.y = 0.004; cs.renderOrder = 1;
  car.add(cs);
  return car;
}

/** Places every car listed in building.json. Resolves to the number placed. */
export async function placeCars(building) {
  let n = 0;
  for (const lv of building.levels) for (const e of lv.equipment || []) {
    if (e.model !== 'car-carnival') continue;
    const car = await buildCarnival(e);
    car.position.copy(toWorld(e.x, e.y, lv.elevation + e.top + 0.005));
    car.rotation.y = e.yaw;
    building.groups[lv.id].add(car);
    n++;
  }
  return n;
}
