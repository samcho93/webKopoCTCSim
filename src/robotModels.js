// 3D models of the simulated platforms. Local frame: X forward, Y up, Z = -robot y (left).
// Dimensions come from the spec table in robots.js (PRESETS) so they can be tuned to the real robots.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function label(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.font = 'bold 84px "Segoe UI", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const std = (color, roughness, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });

/** studyGO2 — educational differential-drive AMR. */
export function makeStudyGO2(P) {
  const g = new THREE.Group();
  const shell = std(P.accent, 0.35, 0.05), blue = std(P.color, 0.4, 0.1), dark = std(0x1d1f23, 0.55, 0.2);
  const rubber = std(0x15161a, 0.9), alu = std(0xb9bec4, 0.3, 0.85);
  const L = P.length, W = P.width, H = P.bodyHeight, r = P.wheelRadius, y0 = r * 0.55;
  const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  add(new RoundedBoxGeometry(L, H * 0.45, W, 3, 0.035), blue, 0, y0 + H * 0.225, 0);                  // chassis skirt
  add(new RoundedBoxGeometry(L * 0.97, H * 0.55, W * 0.97, 3, 0.05), shell, 0, y0 + H * 0.725, 0);     // upper shell
  const deckY = y0 + H;
  add(new THREE.BoxGeometry(L * 0.78, 0.012, W * 0.78), dark, -0.01, deckY + 0.006, 0);                 // top deck plate
  add(new RoundedBoxGeometry(0.03, H * 0.35, W * 0.9, 2, 0.012), rubber, L / 2 + 0.005, y0 + H * 0.2, 0); // bumper
  add(new THREE.BoxGeometry(0.02, 0.05, 0.17), dark, L / 2 - 0.004, deckY - 0.06, 0);                   // RGB-D camera bar
  const lens = std(0x22344f, 0.08, 0.6);
  for (const z of [-0.055, 0, 0.055]) add(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 16).rotateZ(Math.PI / 2), lens, L / 2 + 0.008, deckY - 0.06, z);
  add(new THREE.BoxGeometry(0.012, 0.012, W * 0.7), std(0x00d0ff, 0.4, 0, { emissive: 0x00d0ff, emissiveIntensity: 2 }), L / 2 - 0.012, deckY - 0.016, 0);
  // LiDAR mast + puck
  const mastH = P.lidarH - deckY - 0.03;
  add(new THREE.CylinderGeometry(0.012, 0.012, mastH, 12), alu, 0.03, deckY + mastH / 2, 0);
  add(new THREE.CylinderGeometry(0.045, 0.048, 0.03, 32), dark, 0.03, P.lidarH - 0.025, 0);
  g.userData.spin = add(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 32), std(0x2c2f35, 0.25, 0.5), 0.03, P.lidarH, 0);
  const tex = label(P.label, '#1f6fe0');
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.055), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(-0.02, y0 + H * 0.72, s * (W * 0.485 + 0.003)); m.rotation.y = s > 0 ? 0 : Math.PI; g.add(m);
  }
  const wheels = [];
  for (const s of [-1, 1]) {
    const hub = new THREE.Group(); hub.position.set(0.02, r, s * P.wheelTrack / 2); g.add(hub);
    add(new THREE.CylinderGeometry(r, r, 0.03, 32).rotateX(Math.PI / 2), rubber, 0, 0, 0, hub);
    add(new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.032, 6).rotateX(Math.PI / 2), alu, 0, 0, 0, hub);
    wheels.push(hub);
  }
  add(new THREE.SphereGeometry(0.022, 16, 12), alu, -L / 2 + 0.06, 0.022, 0); // rear caster
  g.userData.wheels = wheels;
  return g;
}

/** TIKI-mini — small 12-DoF quadruped. */
export function makeTikiMini(P) {
  const g = new THREE.Group();
  const shell = std(P.accent, 0.38, 0.05), orange = std(P.color, 0.42, 0.1), dark = std(0x24262b, 0.5, 0.35), rubber = std(0x111215, 0.9);
  const body = new THREE.Group(); body.position.y = P.hipHeight; g.add(body); g.userData.body = body;
  const add = (parent, geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o; };
  const L = P.length, W = P.width, H = P.bodyHeight;
  add(body, new RoundedBoxGeometry(L * 0.86, H, W, 3, 0.03), shell, 0, 0.01, 0);
  add(body, new RoundedBoxGeometry(L * 0.7, H * 0.35, W * 1.02, 2, 0.015), orange, 0, H * 0.45, 0);
  add(body, new RoundedBoxGeometry(L * 0.5, H * 0.4, W * 0.8, 2, 0.02), dark, -0.03, -H * 0.5, 0);
  const head = new THREE.Group(); head.position.set(L * 0.45, 0.02, 0); body.add(head);
  add(head, new RoundedBoxGeometry(0.07, 0.075, W * 0.75, 3, 0.02), shell, 0, 0, 0);
  add(head, new THREE.BoxGeometry(0.01, 0.04, W * 0.55), dark, 0.035, 0, 0);
  const eye = std(0x0b3d66, 0.1, 0.5, { emissive: 0x0a5aa0, emissiveIntensity: 0.6 });
  for (const z of [-0.035, 0.035]) add(head, new THREE.SphereGeometry(0.011, 16, 12), eye, 0.041, 0.005, z);
  add(body, new THREE.CylinderGeometry(0.035, 0.038, 0.045, 28), dark, L * 0.28, P.lidarH - P.hipHeight - 0.015, 0); // 3D LiDAR
  const tex = label(P.label, '#f47b20');
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.05), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(-0.02, 0, s * (W / 2 + 0.003)); m.rotation.y = s > 0 ? 0 : Math.PI; body.add(m);
  }
  const legs = [];
  for (const [fx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const hip = new THREE.Group(); hip.position.set(fx * L * 0.36, -0.01, sz * (W / 2 + 0.02)); body.add(hip);
    add(hip, new THREE.CylinderGeometry(0.028, 0.028, 0.04, 20).rotateX(Math.PI / 2), orange, 0, 0, 0);
    const thighJ = new THREE.Group(); hip.add(thighJ);
    add(thighJ, new RoundedBoxGeometry(0.035, P.thigh, 0.03, 2, 0.012), shell, 0, -P.thigh / 2, sz * 0.012);
    const knee = new THREE.Group(); knee.position.y = -P.thigh; thighJ.add(knee);
    add(knee, new THREE.CylinderGeometry(0.018, 0.018, 0.035, 16).rotateX(Math.PI / 2), dark, 0, 0, sz * 0.012);
    add(knee, new THREE.CylinderGeometry(0.011, 0.014, P.calf, 12), dark, 0, -P.calf / 2, sz * 0.012);
    add(knee, new THREE.SphereGeometry(0.018, 14, 10), rubber, 0, -P.calf, sz * 0.012);
    legs.push({ thighJ, knee, phase: (fx > 0) === (sz > 0) ? 0 : Math.PI });
  }
  g.userData.legs = legs;
  return g;
}

/** Trot gait: 2-link IK keeps feet on the floor, knees pointing backwards. */
export function animateLegs(g, t, moving, P) {
  g.userData.body.position.y = P.hipHeight + (moving ? Math.abs(Math.sin(t)) * 0.006 : 0);
  const a = P.thigh, b = P.calf;
  for (const L of g.userData.legs) {
    const ph = t + L.phase;
    const fx = moving ? Math.sin(ph) * 0.045 : 0;
    const fy = -(P.hipHeight - 0.028) + (moving ? Math.max(0, Math.cos(ph)) * 0.035 : 0);
    const d = Math.min(Math.hypot(fx, fy), a + b - 1e-3);
    const base = Math.atan2(fx, -fy);
    const off = Math.acos(THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
    const bend = Math.PI - Math.acos(THREE.MathUtils.clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
    L.thighJ.rotation.z = base - off;
    L.knee.rotation.z = bend;
  }
}
