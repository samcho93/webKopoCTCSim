// Parked cars (level.equipment "car-carnival"): a procedural Kia Carnival (KA4 facelift) minivan built to
// its published dimensions — 5155 L x 1995 W x 1775 H mm, wheelbase 3090, track 1741 — with the colour and
// Korean licence plate from building.json ({ color, plate }). Static prop, not a vehicle.
//
// The body is one smooth lofted surface: cross-sections along the car (rocker tuck, side bulge, belt line,
// glasshouse tumblehome, roof crown) over a rounded-rectangle plan, with a sloped nose and tailgate.
// Each quad of the loft is assigned paint / glass / gloss-black trim / matte cladding, so windows, pillars
// and wheel wells come out of the same surface. Lamps, grille and plates are textured patches that follow
// the fascia; door seams are drawn into the paint map.
import * as THREE from 'three';
import { toWorld } from './geo.js';

const L = 5.155, W = 1.995, H = 1.775, WB = 3.09, TRACK = 1.741;
const XF = L / 2, XR = -L / 2;                    // model frame: +x = front, +y = up, z = width
const HW = W / 2;
const AXLE_F = 1.5, AXLE_R = AXLE_F - WB, R_WHEEL = 0.36, TIRE_W = 0.235;
const ARCH_R = R_WHEEL + 0.06, ARCH_Y = R_WHEEL + 0.02;
const RC_F = 0.42, RC_R = 0.28;                  // plan corner radii (front / rear)
const WS_TOP = 0.92, WS_BASE = 1.95;              // windscreen top / base stations

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------- body definition
function top(x) {
  if (x <= WS_TOP) return H - 0.012 - 0.03 * ((WS_TOP - x) / (WS_TOP - XR)) ** 2;
  if (x <= WS_BASE) { const t = (x - WS_TOP) / (WS_BASE - WS_TOP); return lerp(H - 0.012, 1.13, t) + 0.045 * Math.sin(Math.PI * t); }
  const t = (x - WS_BASE) / (XF - WS_BASE); return 1.13 - 0.16 * t ** 1.6;
}
function belt(x) { return Math.min(top(x), 1.08 + 0.085 * clamp((1.6 - x) / 3.6, 0, 1)); }
function bot(x) {
  let y = 0.2;
  if (x > XF - 0.75) y += 0.16 * ((x - (XF - 0.75)) / 0.75) ** 2;
  if (x < XR + 0.7) y += 0.13 * (((XR + 0.7) - x) / 0.7) ** 2;
  for (const ax of [AXLE_F, AXLE_R]) { const d = x - ax; if (Math.abs(d) < ARCH_R) y = Math.max(y, ARCH_Y + Math.sqrt(ARCH_R * ARCH_R - d * d)); }
  return y;
}
function hwPlan(x) {
  if (x > XF - RC_F) { const d = x - (XF - RC_F); return HW - RC_F + Math.sqrt(Math.max(0, RC_F * RC_F - d * d)); }
  if (x < XR + RC_R) { const d = (XR + RC_R) - x; return HW - RC_R + Math.sqrt(Math.max(0, RC_R * RC_R - d * d)); }
  return HW;
}
const bulge = (y) => 1 - 0.028 * ((y - 0.72) / 0.45) ** 2;
const leanF = (y0) => { const y = Math.min(y0, 1.0); return y > 0.6 ? 0.07 * ((y - 0.6) / 0.4) ** 2 : 0.05 * ((0.6 - y) / 0.35) ** 2; };
const leanR = (y) => (y > 1.15 ? 0.3 * ((y - 1.15) / 0.6) ** 1.25 : 0.02 * ((1.15 - y) / 0.9) ** 2);
const sF = (x) => smooth(XF - 1.0, XF - RC_F, x), sR = (x) => 1 - smooth(XR + RC_R, XR + 1.0, x);
const leanX = (x, y) => x - leanF(y) * sF(x) + leanR(y) * sR(x);

const N_SIDE = 7, N_GH = 5;
// right half of one cross-section, bottom centre -> crown: [z, y, tag]
function section(x) {
  const hw = hwPlan(x), b = bot(x), bl = belt(x), t = top(x);
  const P = [[0, b, 'u'], [hw * 0.8, b, 'u'], [hw * 0.95, b + 0.035, 'u']];
  for (let k = 0; k < N_SIDE; k++) { const y = lerp(b + 0.1, bl, k / (N_SIDE - 1)); P.push([hw * bulge(y), y, k === 0 ? 'r' : 's']); }
  const hb = hw * bulge(bl), span = Math.max(0, t - 0.03 - bl);
  for (let k = 1; k <= N_GH; k++) { const f = k / N_GH; P.push([hb - 0.16 * f ** 1.2 * Math.min(1, span / 0.25 + 0.3), bl + span * f, 'g']); }
  const hTop = P[P.length - 1][0];
  P.push([Math.max(0, hTop - 0.07), t - 0.012, 'o'], [Math.max(0, hTop - 0.2), t - 0.002, 'o'], [0, t, 'c']);
  return P;
}
/** Side surface half-width at (x, y), for parts mounted on the flanks. */
function hwAt(x, y) {
  const hw = hwPlan(x), bl = belt(x), t = top(x);
  if (y <= bl) return hw * bulge(y);
  const span = Math.max(0.001, t - 0.03 - bl);
  return hw * bulge(bl) - 0.16 * clamp((y - bl) / span, 0, 1) ** 1.2 * Math.min(1, span / 0.25 + 0.3);
}
const surfFront = (z, y) => { const d = Math.min(RC_F, Math.max(0, Math.abs(z) - (HW - RC_F))); return XF - RC_F + Math.sqrt(RC_F * RC_F - d * d) - leanF(y); };
const surfRear = (z, y) => { const d = Math.min(RC_R, Math.max(0, Math.abs(z) - (HW - RC_R))); return XR + RC_R - Math.sqrt(RC_R * RC_R - d * d) + leanR(y); };

// material of one loft quad, from the tag of its lower row, the station and whether it is the top glass band
function classify(tag, xm, gTop, hood) {
  if (tag === 'u') return 'clad';
  if (tag === 'r') return [AXLE_F, AXLE_R].some((ax) => Math.abs(xm - ax) < ARCH_R + 0.1) ? 'clad' : 'paint';
  if (tag === 's') return 'paint';
  if (hood) return 'paint';
  if (tag === 'g') {
    if (xm > WS_TOP) return gTop ? 'trim' : xm < 1.72 ? 'glass' : 'trim';     // front door glass, A pillar
    if (xm < XR + 0.3) return 'glass';                                          // wrap-around tailgate glass
    if (gTop) return 'trim';                                                    // black window frame
    if ((xm > 0.26 && xm < 0.4) || (xm > -1.06 && xm < -0.93) || (xm > XR + 0.3 && xm < -2.02)) return 'trim'; // B, C, D pillars
    return 'glass';
  }
  if (xm > WS_TOP + 0.02) return 'glass';                                       // windscreen
  if (xm < XR + 0.3 && tag === 'o') return 'glass';
  return 'paint';
}

function buildBody(mats) {
  const NS = 120, xs = [];
  for (let i = 0; i <= NS; i++) xs.push(XR + (L * (1 - Math.cos((Math.PI * i) / NS))) / 2);
  const half = section(0).length;                                   // rows per half incl. bottom centre + crown
  const ring = 2 * (half - 1);
  const rowOf = (k) => (k < half ? k : ring - k);
  const pos = [], uv = [], tagsAt = [];
  for (let i = 0; i <= NS; i++) {
    const x = xs[i], P = section(x);
    const shrink = i === 0 || i === NS ? 0 : 1;                      // end stations close the nose / tail
    tagsAt.push(P.map((p) => p[2]));
    for (let k = 0; k < ring; k++) {
      const [z, y] = P[rowOf(k)];
      const X = leanX(x, y);
      pos.push(X, y, (k < half ? 1 : -1) * z * shrink);
      uv.push((X - XR) / L, y / H);
    }
  }
  const byClass = { paint: [], glass: [], trim: [], clad: [] };
  for (let i = 0; i < NS; i++) {
    const xm = (xs[i] + xs[i + 1]) / 2, hood = top(xm) - belt(xm) < 0.07, tags = tagsAt[i];
    for (let k = 0; k < ring; k++) {
      const k2 = (k + 1) % ring, r = Math.min(rowOf(k), rowOf(k2));
      const cls = classify(tags[r], xm, tags[r] === 'g' && tags[r + 1] !== 'g', hood);
      const a = i * ring + k, b = (i + 1) * ring + k, c = (i + 1) * ring + k2, d = i * ring + k2;
      byClass[cls].push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const order = ['paint', 'glass', 'trim', 'clad'], idx = [];
  order.forEach((c, m) => { g.addGroup(idx.length, byClass[c].length, m); idx.push(...byClass[c]); });
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, order.map((c) => mats[c]));
}

// ---------------------------------------------------------------- textures
function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
/** Paint detail map (multiplied with the paint colour): door shut lines, fuel flap, character line, grime low down. */
function paintMap() {
  return canvas(2048, 720, (g, w, h) => {
    const X = (x) => ((x - XR) / L) * w, Y = (y) => (1 - y / H) * h;
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const grime = g.createLinearGradient(0, Y(0.55), 0, Y(0.18));
    grime.addColorStop(0, 'rgba(0,0,0,0)'); grime.addColorStop(1, 'rgba(40,40,40,0.35)');
    g.fillStyle = grime; g.fillRect(0, Y(0.55), w, Y(0.18) - Y(0.55));
    const cl = g.createLinearGradient(0, Y(0.67), 0, Y(0.6));
    cl.addColorStop(0, 'rgba(255,255,255,0)'); cl.addColorStop(0.5, 'rgba(255,255,255,0)'); cl.addColorStop(0.55, 'rgba(0,0,0,0.22)'); cl.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = cl; g.fillRect(X(-2.3), Y(0.67), X(2.2) - X(-2.3), Y(0.6) - Y(0.67));
    g.strokeStyle = '#1a1a1a'; g.lineWidth = 2.2; g.lineCap = 'round';
    const line = (pts) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y)))); g.stroke(); };
    line([[1.66, 0.42], [1.7, 0.8], [1.78, 1.08]]);                       // front door, leading edge
    line([[0.32, 0.36], [0.33, 1.08]]);                                   // front door / sliding door
    line([[-1.0, 0.36], [-1.0, 1.12]]);                                   // sliding door, trailing edge
    line([[-1.0, 0.36], [0.32, 0.36]]);
    line([[1.66, 0.42], [0.33, 0.38]]);
    line([[1.93, 1.11], [2.15, 0.92], [2.4, 0.86]]);                      // bonnet shut line onto the fender
    g.lineWidth = 1.6; line([[-1.0, 1.15], [-2.1, 1.17]]);               // sliding-door rail cover
    g.strokeRect(X(-1.66), Y(0.98), X(-1.47) - X(-1.66), Y(0.85) - Y(0.98)); // fuel flap
  });
}
function grilleMap() {
  return canvas(1024, 360, (g, w, h) => {
    g.fillStyle = '#060708'; g.fillRect(0, 0, w, h);
    const cw = 34, ch = 22;                                               // faceted "tiger face" mesh cells
    for (let r = 0; r * ch < h + ch; r++) for (let c = -1; c * cw < w + cw; c++) {
      const x = c * cw + (r % 2) * cw / 2, y = r * ch;
      const gr = g.createLinearGradient(x, y, x + cw, y + ch);
      gr.addColorStop(0, '#3b3f45'); gr.addColorStop(0.45, '#121416'); gr.addColorStop(1, '#050506');
      g.fillStyle = gr; g.beginPath();
      g.moveTo(x + cw / 2, y + 2); g.lineTo(x + cw - 3, y + ch / 2); g.lineTo(x + cw / 2, y + ch - 2); g.lineTo(x + 3, y + ch / 2); g.closePath(); g.fill();
    }
    const v = g.createLinearGradient(0, 0, 0, h); v.addColorStop(0, 'rgba(0,0,0,0.5)'); v.addColorStop(0.2, 'rgba(0,0,0,0)'); v.addColorStop(0.85, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = v; g.fillRect(0, 0, w, h);
  });
}
function headlampMap(outerRight) {
  return canvas(256, 512, (g, w, h) => {
    const hg = g.createLinearGradient(0, 0, w, 0); hg.addColorStop(0, '#15181c'); hg.addColorStop(1, '#2a3036');
    g.fillStyle = hg; g.fillRect(0, 0, w, h);
    for (let k = 0; k < 3; k++) {                                         // three projector cubes
      const y = 120 + k * 120, x = outerRight ? 50 : 80;
      const rg = g.createRadialGradient(x + 55, y + 45, 4, x + 55, y + 45, 60);
      rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.35, '#b9c6d6'); rg.addColorStop(1, '#2b333c');
      g.fillStyle = rg; g.fillRect(x, y, 110, 90);
      g.strokeStyle = '#8b96a3'; g.lineWidth = 4; g.strokeRect(x, y, 110, 90);
    }
    g.fillStyle = '#ffffff'; g.shadowColor = '#cfe3ff'; g.shadowBlur = 18;     // "star map" LED signature
    g.fillRect(outerRight ? w - 34 : 14, 30, 20, h - 60);
    g.fillRect(0, 30, w, 16);
    g.shadowBlur = 0;
  });
}
function tailMap(kind) {
  return canvas(kind === 'bar' ? 1024 : 128, kind === 'bar' ? 48 : 512, (g, w, h) => {
    g.fillStyle = '#2a0306'; g.fillRect(0, 0, w, h);
    g.shadowColor = '#ff2030'; g.shadowBlur = 14; g.fillStyle = '#ff2b38';
    if (kind === 'bar') g.fillRect(6, h / 2 - 5, w - 12, 10);
    else { g.fillRect(w / 2 - 12, 10, 24, h - 20); for (let k = 0; k < 6; k++) g.fillRect(14, 40 + k * 76, w - 28, 8); }
  });
}
/** Korean private-car plate (520 x 110 mm, white, black text). */
function plateMap(text) {
  return canvas(1040, 220, (g, w, h) => {
    g.fillStyle = '#f7f8f6'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#1b1b1b'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20);
    g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '700 168px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
    g.fillText(text, w / 2, h / 2 + 8, w - 70);
  });
}
function contactShadow() {
  return canvas(256, 128, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, w / 2, 4, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(0,0,0,0.75)'); r.addColorStop(0.6, 'rgba(0,0,0,0.45)'); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.save(); g.scale(1, h / w); g.fillStyle = r; g.fillRect(0, 0, w, w); g.restore();
  });
}

/** A textured patch that hugs the front (side +1) or rear (side -1) fascia. */
function fasciaPatch(side, zc, yc, w, h, mat, out = 0.006, seg = 14) {
  const g = new THREE.PlaneGeometry(w, h, seg, Math.max(2, Math.round((seg * h) / w)));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const lx = p.getX(i), y = yc + p.getY(i);
    const z = side > 0 ? zc - lx : zc + lx;
    p.setXYZ(i, side > 0 ? surfFront(z, y) + out : surfRear(z, y) - out, y, z);
  }
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}
const tube = (points, r, mat) => new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), Math.max(8, points.length * 3), r, 8, false), mat);

// ---------------------------------------------------------------- wheels (235/55 R19)
function wheel(mats) {
  const g = new THREE.Group();
  const R = R_WHEEL, w2 = TIRE_W / 2, rb = 0.243;
  const prof = [[rb, -w2 + 0.01], [rb + 0.03, -w2], [R - 0.05, -w2 - 0.008], [R - 0.016, -w2 + 0.012], [R, -w2 + 0.04], [R, w2 - 0.04], [R - 0.016, w2 - 0.012], [R - 0.05, w2 + 0.008], [rb + 0.03, w2], [rb, w2 - 0.01]]
    .map(([r, a]) => new THREE.Vector2(r, a));
  const tyre = new THREE.Mesh(new THREE.LatheGeometry(prof, 56), mats.tyre);
  tyre.rotation.x = Math.PI / 2; g.add(tyre);
  for (const a of [-0.055, 0, 0.055]) { const t = new THREE.Mesh(new THREE.TorusGeometry(R - 0.002, 0.004, 4, 64), mats.tyreDark); t.position.z = a; g.add(t); }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.236, 0.236, TIRE_W - 0.02, 40, 1, true), mats.rimDark);
  barrel.rotation.x = Math.PI / 2; g.add(barrel);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.236, 0.011, 8, 56), mats.rim); lip.position.z = w2 - 0.012; g.add(lip);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.026, 40), mats.disc); disc.rotation.x = Math.PI / 2; disc.position.z = -0.02; g.add(disc);
  const cal = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.06), mats.caliper); cal.position.set(-0.13, 0.08, 0); cal.rotation.z = 0.6; g.add(cal);
  const spoke = new THREE.Shape();
  spoke.moveTo(0.055, -0.018); spoke.lineTo(0.232, -0.034); spoke.lineTo(0.232, 0.034); spoke.lineTo(0.055, 0.018); spoke.closePath();
  const spokeG = new THREE.ExtrudeGeometry(spoke, { depth: 0.022, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 2 });
  for (let k = 0; k < 10; k++) {                                          // two-tone twin spokes
    const s = new THREE.Mesh(spokeG, k % 2 ? mats.rim : mats.rimMachined);
    s.rotation.z = (k * Math.PI) / 5 + (k % 2) * 0.12; s.position.z = w2 - 0.045 - (k % 2) * 0.006;
    g.add(s);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.066, 0.03, 32), mats.rimDark); hub.rotation.x = Math.PI / 2; hub.position.z = w2 - 0.03; g.add(hub);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.01, 32), mats.chrome); cap.rotation.x = Math.PI / 2; cap.position.z = w2 - 0.012; g.add(cap);
  return g;
}

// ---------------------------------------------------------------- the car
export function buildCarnival({ color = '#3b3e43', plate = '' } = {}) {
  const mats = {
    paint: new THREE.MeshPhysicalMaterial({ color, map: paintMap(), metalness: 0.55, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.035 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x030405, metalness: 0.0, roughness: 0.04, specularIntensity: 0.55, envMapIntensity: 0.7 }),   // privacy glass
    trim: new THREE.MeshPhysicalMaterial({ color: 0x040405, metalness: 0.0, roughness: 0.18, specularIntensity: 0.6, envMapIntensity: 0.6 }),
    clad: new THREE.MeshStandardMaterial({ color: 0x18191b, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: 0.1 }),
    satin: new THREE.MeshStandardMaterial({ color: 0xa9adb2, metalness: 0.9, roughness: 0.32 }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x1a1a1b, roughness: 0.88 }),
    tyreDark: new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 1 }),
    rim: new THREE.MeshStandardMaterial({ color: 0x4a4e54, metalness: 0.8, roughness: 0.3 }),
    rimMachined: new THREE.MeshStandardMaterial({ color: 0xc9ccd0, metalness: 1, roughness: 0.18 }),
    rimDark: new THREE.MeshStandardMaterial({ color: 0x1e2023, metalness: 0.6, roughness: 0.45 }),
    disc: new THREE.MeshStandardMaterial({ color: 0x77797c, metalness: 0.9, roughness: 0.45 }),
    caliper: new THREE.MeshStandardMaterial({ color: 0x2b2d30, metalness: 0.4, roughness: 0.5 }),
  };
  const lamp = (map, glow) => new THREE.MeshPhysicalMaterial({ map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: glow, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.02 });
  const car = new THREE.Group(); car.name = 'car-carnival';

  car.add(buildBody(mats));

  // front fascia: grille, headlamp units with the "star map" signature, DRL line, lower intake + skid garnish
  car.add(fasciaPatch(1, 0, 0.66, 1.18, 0.36, new THREE.MeshPhysicalMaterial({ map: grilleMap(), roughness: 0.2, metalness: 0.4, clearcoat: 1 })));
  for (const s of [-1, 1]) car.add(fasciaPatch(1, s * 0.74, 0.7, 0.3, 0.44, lamp(headlampMap(s < 0), 0.75), 0.008, 10));
  car.add(fasciaPatch(1, 0, 0.885, 1.46, 0.018, lamp(canvas(64, 8, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }), 1.2), 0.01, 24));
  car.add(fasciaPatch(1, 0, 0.33, 1.5, 0.14, mats.clad, 0.004, 20));
  car.add(fasciaPatch(1, 0, 0.255, 1.1, 0.03, mats.satin, 0.008, 20));
  // rear: vertical tail lamps, full-width light bar, bumper, skid garnish
  car.add(fasciaPatch(-1, 0, 1.165, 1.56, 0.05, lamp(tailMap('bar'), 0.8), 0.008, 30));
  for (const s of [-1, 1]) car.add(fasciaPatch(-1, s * 0.86, 1.06, 0.13, 0.5, lamp(tailMap('v'), 0.8), 0.008, 6));
  car.add(fasciaPatch(-1, 0, 0.36, 1.7, 0.24, mats.clad, 0.004, 24));
  car.add(fasciaPatch(-1, 0, 0.3, 1.0, 0.025, mats.satin, 0.008, 16));
  if (plate) {
    const pm = new THREE.MeshStandardMaterial({ map: plateMap(plate), roughness: 0.45, metalness: 0.1 });
    car.add(fasciaPatch(1, 0, 0.47, 0.52, 0.11, pm, 0.012, 8));
    car.add(fasciaPatch(-1, 0, 0.84, 0.52, 0.11, pm, 0.012, 8));
  }

  // flanks: belt-line chrome, door handles, mirrors, roof rails, antenna
  for (const sz of [-1, 1]) {
    const beltPts = [];
    for (let x = -2.06; x <= 1.66; x += 0.12) beltPts.push(new THREE.Vector3(x, belt(x) + 0.004, sz * (hwAt(x, belt(x)) + 0.004)));
    car.add(tube(beltPts, 0.0065, mats.chrome));
    for (const x of [1.02, 0.14]) {
      const h = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.13, 4, 8), mats.chrome);
      h.rotation.z = Math.PI / 2; h.position.set(x, 1.0, sz * (hwAt(x, 1.0) + 0.006)); car.add(h);
    }
    const mx = 1.6, my = 1.17, mz = sz * (hwAt(mx, my) + 0.09);
    const housing = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mats.paint);
    housing.scale.set(0.085, 0.075, 0.12); housing.position.set(mx, my + 0.02, mz); car.add(housing);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.1), mats.trim);
    arm.position.set(mx + 0.02, my - 0.03, sz * (hwAt(mx, my) + 0.03)); car.add(arm);
    const rail = []; for (let x = -1.95; x <= 0.7; x += 0.15) rail.push(new THREE.Vector3(x, top(x) + 0.03, sz * (hwAt(x, top(x) - 0.03) - 0.2)));
    car.add(tube(rail, 0.014, mats.trim));
  }
  const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), mats.trim); fin.scale.set(0.09, 0.035, 0.025); fin.position.set(-1.85, top(-1.85) + 0.02, 0); car.add(fin);

  // wheels
  for (const ax of [AXLE_F, AXLE_R]) for (const sz of [-1, 1]) {
    const w = wheel(mats); w.position.set(ax, R_WHEEL, sz * (TRACK / 2 + 0.005));
    if (sz < 0) w.rotation.y = Math.PI;
    car.add(w);
  }
  car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // soft contact shadow under the car (the ambient occlusion the shadow map can't give)
  const cs = new THREE.Mesh(new THREE.PlaneGeometry(L + 0.5, W + 0.45), new THREE.MeshBasicMaterial({ map: contactShadow(), transparent: true, depthWrite: false, opacity: 0.9 }));
  cs.rotation.x = -Math.PI / 2; cs.position.y = 0.004; cs.renderOrder = 1;
  car.add(cs);
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
