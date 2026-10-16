// Robot visuals loaded from the robots' own URDF packages:
//   public/robots/tiki_mini  <- samcho93/studyTIKI   ros2_ws/src/tiki_description (URDF + CAD STL)
//   public/robots/go2        <- samcho93/studyGo2    assets/urdf/go2 (unitree_ros go2_description, BSD-3, GLB)
// The URDF (ROS, z-up) is wrapped so that the group follows the sim convention:
// local X forward, Y up, Z = -robot y.
import * as THREE from 'three';
import URDFLoader from 'urdf-loader';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';

const BASE = import.meta.env.BASE_URL;
const templates = {};

function loadURDF(url, packages) {
  const manager = new THREE.LoadingManager();
  const loader = new URDFLoader(manager);
  loader.packages = packages;
  const gltf = new GLTFLoader(manager), stl = new STLLoader(manager);
  loader.loadMeshCb = (path, mgr, material, done) => {   // urdf-loader >= 0.13 signature
    if (/\.glb$|\.gltf$/i.test(path)) {
      gltf.load(path, (g) => done(g.scene), undefined, (e) => done(null, e));
    } else if (/\.stl$/i.test(path)) {
      stl.load(path, (geo) => {
        geo.computeVertexNormals();
        const m = new THREE.Mesh(geo, material ? material.clone() : new THREE.MeshStandardMaterial({ color: 0x888888 }));
        done(m);
      }, undefined, (e) => done(null, e));
    } else done(null, new Error('unsupported mesh ' + path));
  };
  return new Promise((resolve, reject) => {
    let robot = null;
    manager.onLoad = () => robot && resolve(robot);
    loader.load(url, (r) => { robot = r; }, undefined, reject);
  });
}

function prettify(root, { metalness = 0.2, roughness = 0.5 } = {}) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (m && m.isMeshPhongMaterial) {
        return new THREE.MeshStandardMaterial({ color: m.color, roughness, metalness, transparent: m.transparent, opacity: m.opacity });
      }
      return m;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

/** Loads both URDF models once. Resolves even if one fails (falls back to procedural models). */
export async function loadRobotModels() {
  const jobs = [
    loadURDF(`${BASE}robots/tiki_mini/tiki_mini.urdf`, { tiki_description: `${BASE}robots/tiki_mini` })
      .then((r) => { prettify(r, { metalness: 0.15, roughness: 0.55 }); templates.tiki = r; })
      .catch((e) => console.warn('TIKI-mini URDF failed', e)),
    loadURDF(`${BASE}robots/go2/go2_description.urdf`, {})
      .then((r) => { prettify(r, { metalness: 0.25, roughness: 0.45 }); templates.go2 = r; })
      .catch((e) => console.warn('Go2 URDF failed', e)),
  ];
  await Promise.all(jobs);
  return templates;
}

/** New instance of a robot model: { group, urdf }. */
export function instantiate(name) {
  const t = templates[name];
  if (!t) return null;
  const urdf = t.clone(true);
  const group = new THREE.Group();
  urdf.rotation.x = -Math.PI / 2;          // ROS z-up -> three y-up
  group.add(urdf);
  return { group, urdf };
}

/** Go2 leg IK (sagittal plane): foot target (x fwd, z up) relative to the thigh joint. */
export function go2LegIK(x, z, l1 = 0.213, l2 = 0.213) {
  const d2 = x * x + z * z;
  const c = THREE.MathUtils.clamp((d2 - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1);
  const calf = -Math.acos(c);
  const thigh = Math.atan2(-x, -z) - Math.atan2(l2 * Math.sin(calf), l1 + l2 * Math.cos(calf));
  return [thigh, calf];
}

export const GO2_LEGS = ['FL', 'FR', 'RL', 'RR'];
export const GO2_JOINTS = GO2_LEGS.flatMap((l) => [`${l}_hip_joint`, `${l}_thigh_joint`, `${l}_calf_joint`]);
