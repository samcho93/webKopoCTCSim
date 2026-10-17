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
const PLATE_Y = { front: 0.56, rear: 0.8 };       // plate centre heights (m), from the KA4 front / rear views

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
/** Korean private-car plate (520 x 110 mm, white, black text). */
const plateMap = (text) => canvasTex(1040, 220, (g, w, h) => {
  g.fillStyle = '#f7f8f6'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 10; g.strokeRect(10, 10, w - 20, h - 20);
  g.fillStyle = '#111'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '700 168px "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  g.fillText(text, w / 2, h / 2 + 8, w - 70);
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

/** Ray-casts a plate onto the body at height y, on the front (dir +1) or rear (dir -1) centre line. */
function addPlate(car, mat, dir, y) {
  const solid = [];
  car.traverse((o) => { if (o.isMesh && !o.material.transparent) solid.push(o); });
  car.updateMatrixWorld(true);
  const rc = new THREE.Raycaster(new THREE.Vector3(dir * (L / 2 + 1), y, 0), new THREE.Vector3(-dir, 0, 0), 0, 2);
  const hit = rc.intersectObjects(solid, false)[0];
  const x = hit ? hit.point.x : dir * (L / 2 - 0.05);
  const n = hit?.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(dir, 0, 0);
  n.y = 0; n.normalize();
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.11), mat);
  p.position.set(x + n.x * 0.006, y, 0);
  p.lookAt(p.position.clone().add(n));
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
