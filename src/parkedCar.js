// Parked cars (level.equipment "car-carnival"): a procedural Kia Carnival (KA4 facelift) minivan built
// to its published dimensions — 5155 L x 1995 W x 1775 H mm, wheelbase 3090, track 1741 — with the
// colour and Korean licence plate given in building.json ({ color, plate }). Static prop, not a vehicle.
import * as THREE from 'three';
import { toWorld } from './geo.js';

const L = 5.155, W = 1.995, H = 1.775, WB = 3.09, TRACK = 1.741;
const XF = L / 2, XR = -L / 2;                    // model frame: +x = front, +y = up, z = width
const AXLE_F = 1.53, AXLE_R = AXLE_F - WB, R_WHEEL = 0.355, TIRE_W = 0.235;
const BEV = 0.07;                                  // body edge rounding

// side profile (x, y), body only (wheels below 0.2 m)
const PROFILE = [
  [XR + 0.06, 0.22], [XR + 0.01, 0.45], [XR, 0.95], [XR + 0.05, 1.22], [XR + 0.16, 1.66], [XR + 0.34, H - BEV],
  [0.95, H - BEV], [1.25, 1.62], [1.98, 1.12], [2.38, 1.03], [XF - 0.03, 0.92], [XF, 0.62], [XF - 0.05, 0.22],
];
// daylight opening (side glass + windscreen + tailgate glass), slightly proud of the body
const GLASS = [
  [XR + 0.08, 1.17], [XR + 0.2, 1.63], [XR + 0.37, H - BEV - 0.04], [0.92, H - BEV - 0.04], [1.22, 1.6], [1.97, 1.1], [1.6, 1.1], [-0.3, 1.13],
];

const ARCH_R = R_WHEEL + 0.05, ARCH_Y = R_WHEEL + 0.01;
function shapeOf(pts, arches = false) {
  const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  if (arches) {
    // bottom edge runs front -> rear, cut out round wheel arches on the way
    for (const ax of [AXLE_F, AXLE_R]) {
      const a0 = Math.asin((0.22 - ARCH_Y) / ARCH_R);
      s.lineTo(ax + ARCH_R * Math.cos(a0), 0.22);
      s.absarc(ax, ARCH_Y, ARCH_R, a0, Math.PI - a0, false);
    }
  }
  s.closePath(); return s;
}

function extrude(pts, width, bevel, mat, arches = false) {
  const depth = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(shapeOf(pts, arches), { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.6, bevelOffset: -bevel * 0.6, bevelSegments: 4, curveSegments: 8 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

function box(w, h, d, mat, x, y, z) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; }

/** Korean private-car plate (520 x 110 mm, white, black text). */
function plateTexture(text) {
  const c = document.createElement('canvas'); c.width = 1040; c.height = 220;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f8f6'; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 10; g.strokeRect(10, 10, c.width - 20, c.height - 20);
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 168px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  g.fillText(text, c.width / 2, c.height / 2 + 8, c.width - 70);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function wheel(mats) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(R_WHEEL, R_WHEEL, TIRE_W, 40), mats.tire);
  const side = new THREE.Mesh(new THREE.TorusGeometry(R_WHEEL - 0.03, 0.03, 10, 40), mats.tire);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, TIRE_W + 0.006, 36), mats.rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, TIRE_W + 0.02, 16), mats.chrome);
  tire.rotation.x = rim.rotation.x = hub.rotation.x = Math.PI / 2;
  side.position.z = TIRE_W / 2 - 0.02;
  g.add(tire, side, rim, hub);
  // twin-spoke alloy pattern on the outer face
  for (let k = 0; k < 10; k++) {
    const s = box(0.2, 0.034, 0.012, k % 2 ? mats.rimDark : mats.rim, 0, 0, TIRE_W / 2 + 0.004);
    s.geometry.translate(0.12, 0, 0); s.rotation.z = (k * Math.PI) / 5; g.add(s);
  }
  return g;
}

export function buildCarnival({ color = '#3b3e43', plate = '' } = {}) {
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ color, metalness: 0.65, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1014, metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.55, metalness: 0.2 }),
    clad: new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.8 }),
    liner: new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.95, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xd8dade, metalness: 1, roughness: 0.12 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.92 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x8c9095, metalness: 0.85, roughness: 0.28 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x2a2c2f, metalness: 0.7, roughness: 0.35 }),
    led: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfe9ff, emissiveIntensity: 0.6, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x5a0508, emissive: 0xb0101a, emissiveIntensity: 0.35, roughness: 0.25 }),
    grille: new THREE.MeshStandardMaterial({ color: 0x0d0e10, metalness: 0.5, roughness: 0.35 }),
  };
  const car = new THREE.Group(); car.name = 'car-carnival';

  // body shell + glasshouse + wheel-arch cut shadows
  car.add(extrude(PROFILE, W - 0.03, BEV, mats.paint, true));
  car.add(extrude(GLASS, W - 0.03 + 0.012, 0.03, mats.glass));
  // windscreen / tailgate glass sit on the sloped faces
  const ws = box(0.92, 0.012, W - 0.2, mats.glass, 0, 0, 0);
  ws.position.set((1.25 + 1.98) / 2 + 0.012, (1.62 + 1.12) / 2 + 0.015, 0); ws.rotation.z = Math.atan2(1.62 - 1.12, 1.25 - 1.98); car.add(ws);
  const tg = box(0.5, 0.012, W - 0.3, mats.glass, 0, 0, 0);
  tg.position.set(XR + 0.1 - 0.008, 1.43, 0); tg.rotation.z = Math.atan2(1.66 - 1.22, XR + 0.16 - (XR + 0.05)); car.add(tg);
  // black B / C pillars, chrome window line, lower cladding, sills
  for (const sz of [-1, 1]) {
    const zs = sz * (W / 2 - 0.004);
    car.add(box(0.09, 0.5, 0.012, mats.trim, 0.32, 1.42, zs));
    car.add(box(0.07, 0.5, 0.012, mats.trim, -0.95, 1.42, zs));
    car.add(box(3.6, 0.018, 0.012, mats.chrome, -0.55, 1.14, zs));
    car.add(box(AXLE_F - AXLE_R - 2 * ARCH_R - 0.06, 0.09, 0.016, mats.clad, (AXLE_F + AXLE_R) / 2, 0.27, sz * (W / 2 - 0.006)));
    car.add(box(2.1, 0.012, 0.014, mats.chrome, -0.15, 0.33, zs));               // sill accent
    // door handles + side mirror
    for (const x of [0.75, -0.25]) car.add(box(0.16, 0.025, 0.02, mats.chrome, x, 1.02, sz * (W / 2 + 0.004)));
    const mirror = box(0.2, 0.12, 0.17, mats.paint, 1.62, 1.18, sz * (W / 2 + 0.06)); car.add(mirror);
    car.add(box(0.06, 0.05, 0.1, mats.trim, 1.68, 1.12, sz * (W / 2 + 0.01)));
    // roof rails
    const rail = box(2.9, 0.035, 0.035, mats.trim, -0.6, H - 0.01, sz * 0.7); car.add(rail);
    // wheel-well liners: black half shells inside the arches, and black arch cladding
    for (const ax of [AXLE_F, AXLE_R]) {
      const liner = new THREE.Mesh(new THREE.CylinderGeometry(ARCH_R - 0.01, ARCH_R - 0.01, 0.42, 32, 1, true, Math.PI / 2, Math.PI), mats.clad);
      liner.material = mats.liner; liner.rotation.x = Math.PI / 2; liner.position.set(ax, ARCH_Y, sz * (W / 2 - 0.22));
      const lip = new THREE.Mesh(new THREE.TorusGeometry(ARCH_R + 0.012, 0.022, 8, 32, Math.PI * 1.1), mats.clad);
      lip.rotation.z = -Math.PI * 0.05; lip.position.set(ax, ARCH_Y, sz * (W / 2 - 0.02));
      car.add(liner, lip);
    }
  }
  // front: wide dark grille, vertical LED headlamp clusters, star-map DRL bar
  car.add(box(0.03, 0.26, 1.45, mats.grille, XF + 0.005, 0.72, 0));
  for (let k = -6; k <= 6; k++) car.add(box(0.034, 0.012, 0.012, mats.chrome, XF + 0.012, 0.72 + (k % 2) * 0.05, k * 0.11));
  car.add(box(0.02, 0.012, 1.78, mats.led, XF - 0.045, 0.94, 0));
  for (const sz of [-1, 1]) {
    car.add(box(0.03, 0.26, 0.06, mats.led, XF, 0.74, sz * 0.86));
    car.add(box(0.03, 0.2, 0.12, mats.trim, XF - 0.005, 0.73, sz * 0.78));
  }
  car.add(box(0.03, 0.08, 1.6, mats.clad, XF - 0.02, 0.38, 0));                  // lower bumper
  car.add(box(0.018, 0.035, 1.4, mats.chrome, XF - 0.025, 0.31, 0));
  // rear: full-width light bar, tailgate garnish, bumper
  car.add(box(0.03, 0.06, W - 0.16, mats.tail, XR + 0.025, 1.17, 0));
  for (const sz of [-1, 1]) car.add(box(0.03, 0.3, 0.07, mats.tail, XR - 0.005, 0.98, sz * (W / 2 - 0.1)));
  car.add(box(0.03, 0.2, 1.7, mats.clad, XR + 0.005, 0.4, 0));
  car.add(box(0.016, 0.02, 1.0, mats.chrome, XR - 0.002, 0.52, 0));

  // licence plates (front on the bumper, rear on the tailgate)
  if (plate) {
    const pm = new THREE.MeshStandardMaterial({ map: plateTexture(plate), roughness: 0.45, metalness: 0.1 });
    const pg = new THREE.PlaneGeometry(0.52, 0.11);
    const front = new THREE.Mesh(pg, pm); front.position.set(XF - 0.004, 0.5, 0); front.rotation.y = Math.PI / 2;
    const rear = new THREE.Mesh(pg, pm); rear.position.set(XR - 0.006, 0.82, 0); rear.rotation.y = -Math.PI / 2;
    car.add(front, rear);
  }

  // wheels
  for (const ax of [AXLE_F, AXLE_R]) for (const sz of [-1, 1]) {
    const w = wheel(mats); w.position.set(ax, R_WHEEL, sz * (W / 2 - 0.035 - TIRE_W / 2));   // tyre face just inside the arch
    if (sz < 0) w.rotation.y = Math.PI;
    car.add(w);
  }
  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return car;
}

/** Places every car listed in building.json. Returns the number placed. */
export function placeCars(building) {
  let n = 0;
  for (const lv of building.levels) for (const e of lv.equipment || []) {
    if (e.model !== 'car-carnival') continue;
    const car = buildCarnival(e);
    car.position.copy(toWorld(e.x, e.y, lv.elevation + e.top + 0.01));
    car.rotation.y = e.yaw;
    building.groups[lv.id].add(car);
    n++;
  }
  return n;
}
