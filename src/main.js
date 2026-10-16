import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { N8AOPass } from 'n8ao';
import { Sky } from 'three/addons/objects/Sky.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { Building } from './building.js';
import { World, Body } from './physics.js';
import { Elevator } from './elevator.js';
import { LevelGrid, Router } from './nav.js';
import { Robot } from './robots.js';
import { RosBridge } from './rosbridge.js';
import { toWorld } from './geo.js';

const BASE = import.meta.env.BASE_URL;
const $ = (id) => document.getElementById(id);

class Emitter {
  constructor() { this.h = {}; }
  on(e, f) { (this.h[e] ||= []).push(f); }
  emit(e, ...a) { (this.h[e] || []).forEach((f) => f(...a)); }
}

async function loadImage(src) {
  const img = new Image(); img.src = src; await img.decode(); return img;
}

async function main() {
  const data = await (await fetch(`${BASE}data/building.json`)).json();

  // ------------------------------------------------------------ renderer / scene
  const canvas = $('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcbd8e4, 140, 700); // light urban haze

  const sky = new Sky(); sky.scale.setScalar(4000); scene.add(sky);
  const su = sky.material.uniforms;
  su.turbidity.value = 3.2; su.rayleigh.value = 1.6; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.82;
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(36), THREE.MathUtils.degToRad(205));
  su.sunPosition.value.copy(sunDir);

  // Reflection environment: the same sky + a city skyline + ground, so the
  // reflective glazing mirrors blue sky and neighbouring towers like on the photos.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky(); envSky.scale.setScalar(900);
  Object.entries(su).forEach(([k, u]) => { envSky.material.uniforms[k].value = u.value; });
  envScene.add(envSky);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(800, 32), new THREE.MeshBasicMaterial({ color: 0x9a9c9c }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -2; envScene.add(ground);
  const towerMat = [0x8e99a3, 0xb7bdc2, 0x6f7f8e, 0xd4d1ca].map((c) => new THREE.MeshBasicMaterial({ color: c }));
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + Math.sin(i * 7.3) * 0.05, r = 140 + (i % 5) * 35, h = 20 + ((i * 37) % 70);
    const m = new THREE.Mesh(new THREE.BoxGeometry(25 + (i % 3) * 10, h, 25), towerMat[i % 4]);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r); m.lookAt(0, h / 2, 0); envScene.add(m);
  }
  const env = pmrem.fromScene(envScene, 0.0).texture;
  scene.environment = env;

  const hemi = new THREE.HemisphereLight(0xe8eef5, 0x9a8b74, 0.8); scene.add(hemi);
  const amb = new THREE.AmbientLight(0xffffff, 0.18); scene.add(amb);
  const sun = new THREE.DirectionalLight(0xffeccf, 2.8);
  sun.position.copy(sunDir).multiplyScalar(80).add(new THREE.Vector3(13, 0, -8));
  sun.target.position.set(13, 10, -8); scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 220 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun);
  const headLamp = new THREE.PointLight(0xfff4e0, 0, 14, 1.4); scene.add(headLamp);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 3000);
  camera.position.set(-22, 22, 34);
  const labelRenderer = new CSS2DRenderer({ element: $('labels') });

  // post: screen-space ambient occlusion (contact shadows in corners, under ledges, around furniture)
  const composer = new EffectComposer(renderer);
  const aoPass = new N8AOPass(scene, camera, window.innerWidth, window.innerHeight);
  Object.assign(aoPass.configuration, { aoRadius: 1.6, distanceFalloff: 0.6, intensity: 2.6, halfRes: true, depthAwareUpsampling: true, gammaCorrection: false, color: new THREE.Color(0x10141a) });
  aoPass.setQualityMode('Medium');
  composer.addPass(aoPass);
  composer.addPass(new OutputPass());
  let useAO = true;

  const orbit = new OrbitControls(camera, canvas);
  orbit.target.set(13, 9, -8.6);
  orbit.enableDamping = true; orbit.dampingFactor = 0.08;
  orbit.maxPolarAngle = Math.PI * 0.495;
  orbit.minDistance = 2; orbit.maxDistance = 220;

  // ------------------------------------------------------------ building + world
  const building = new Building(data, scene, env);
  const world = new World(building);
  const elevators = data.elevators.map((d) => new Elevator(d, building, scene));
  world.elevators = elevators;

  const grids = {};
  await Promise.all(building.levels.map(async (lv) => {
    grids[lv.id] = new LevelGrid(data.meta, await loadImage(`${BASE}data/${lv.map}`), building, lv);
  }));
  const router = new Router(building, grids);

  const events = new Emitter();
  const sim = { scene, building, world, elevators, grids, router, robots: [], events, time: 0, timeScale: 1, epoch: Date.now() / 1000 - performance.now() / 1000 };
  const ros = new RosBridge(sim);
  sim.ros = ros;
  events.on('scan', (r) => ros.onScan(r));

  // room labels
  const labelGroups = {};
  for (const lv of building.levels) {
    const g = new THREE.Group(); g.visible = false; scene.add(g); labelGroups[lv.id] = g;
    for (const r of lv.rooms) {
      const el = document.createElement('div'); el.className = 'room-label'; el.textContent = r.name;
      const o = new CSS2DObject(el); o.position.copy(toWorld(r.x, r.y, lv.elevation + 1.2)); g.add(o);
    }
  }

  // ------------------------------------------------------------ state
  const state = { mode: 'exterior', level: '1F', selected: null, goalMode: false, follow: false, robotCam: true, mmLayer: 'truth' };

  function toast(msg, ms = 2200) {
    const t = $('toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
  }

  function setMode(mode, level = state.level) {
    const prev = state.mode;
    state.mode = mode; state.level = level;
    if (mode !== 'walk' && prev === 'walk') exitWalk();
    building.setView(mode, mode === 'exterior' ? null : level);
    for (const [id, g] of Object.entries(labelGroups)) g.visible = (mode === 'cutaway' || mode === 'single') && id === level;
    document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    document.querySelectorAll('#levels button').forEach((b) => b.classList.toggle('on', b.dataset.level === level && mode !== 'exterior'));
    $('walkHelp').classList.toggle('hidden', mode !== 'walk');
    if (mode === 'walk') enterWalk(level);
    else if (mode === 'cutaway' || mode === 'single') {
      const lv = building.byId[level];
      const tgt = new THREE.Vector3(13.5, lv.elevation, -8.6);
      const off = camera.position.clone().sub(orbit.target);
      if (prev === 'exterior' || prev === 'walk' || off.length() > 80) off.set(-14, 26, 22);
      orbit.target.copy(tgt); camera.position.copy(tgt).add(off);
    } else if (mode === 'exterior' && prev === 'walk') {
      orbit.target.set(13, 9, -8.6); camera.position.set(-22, 22, 34);
    }
    renderRooms();
    drawMinimapBase();
  }

  // ------------------------------------------------------------ walk mode
  const walker = { body: new Body(world, { radius: 0.28, height: 1.75, step: 0.38 }), yaw: Math.PI / 2, pitch: 0, keys: {}, active: false };
  function enterWalk(levelId) {
    const lv = building.byId[levelId];
    const spot = lv.id === '1F' ? [6.2, 4.6] : lv.id === 'B1' ? [16, 6.8] : [4.4, 10.5];
    walker.body.place(spot[0], spot[1], lv.elevation + 0.5);
    walker.yaw = Math.PI / 2; walker.pitch = 0; walker.active = true;
    orbit.enabled = false;
    headLamp.intensity = 6;
  }
  function exitWalk() { walker.active = false; orbit.enabled = true; headLamp.intensity = 0; if (document.pointerLockElement) document.exitPointerLock(); }
  function teleport(levelId, x, y) {
    if (state.mode !== 'walk') setMode('walk', levelId);
    const g = grids[levelId].nearestFree(x, y, 0.3, 4) || [x, y];
    walker.body.place(g[0], g[1], building.byId[levelId].elevation + 0.5);
  }
  canvas.addEventListener('click', (ev) => {
    if (state.mode === 'walk' && !document.pointerLockElement) canvas.requestPointerLock();
    else if (state.mode !== 'walk') pickFloor(ev);
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== canvas) return;
    walker.yaw -= e.movementX * 0.0022;
    walker.pitch = THREE.MathUtils.clamp(walker.pitch - e.movementY * 0.0022, -1.4, 1.4);
  });
  const LEVEL_KEYS = { b: 'B1', 1: '1F', 2: '2F', 3: '3F', 4: '4F', 5: '5F', 6: '6F', 7: '7F', 8: '8F' };
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    walker.keys[k] = true;
    if (state.mode === 'walk') {
      const p = walker.body.pos;
      if (k === 'e') {
        const inCar = elevators.find((q) => q.contains(p.x, p.y) && Math.abs(q.z - p.z) < 0.3);
        if (inCar) toast(`${inCar.def.name}: 층 선택 B/1–8`);
        else {
          const near = elevators.find((q) => Math.abs(p.y - (q.def.door[0] + q.def.door[1]) / 2) < 1.4 && p.x > q.def.doorX && p.x < q.def.doorX + 2.5);
          if (near) { near.call(building.levelAt(p.z).id); toast(`${near.def.name} 호출`); }
          else toast('엘리베이터 앞(홀)에서 E를 누르세요');
        }
      }
      if (LEVEL_KEYS[k]) {
        const car = elevators.find((q) => q.contains(p.x, p.y) && Math.abs(q.z - p.z) < 0.3);
        if (car && car.def.levels.includes(LEVEL_KEYS[k])) { car.queue.length = 0; car.call(LEVEL_KEYS[k]); car.dwell = 0.3; toast(`${LEVEL_KEYS[k]}(으)로 이동`); }
      }
    }
  });
  document.addEventListener('keyup', (e) => { walker.keys[e.key.toLowerCase()] = false; });

  function updateWalker(dt) {
    const K = walker.keys, b = walker.body;
    const sp = (K.shift ? 3.2 : 1.5) * dt;
    let f = (K.w || K.arrowup ? 1 : 0) - (K.s || K.arrowdown ? 1 : 0);
    let s = (K.d || K.arrowright ? 1 : 0) - (K.a || K.arrowleft ? 1 : 0);
    const L = Math.hypot(f, s) || 1; f /= L; s /= L;
    const c = Math.cos(walker.yaw), sn = Math.sin(walker.yaw);
    // plan frame: forward = (cos yaw, sin yaw); right = (sin yaw, -cos yaw)
    b.move((c * f + sn * s) * sp, (sn * f - c * s) * sp, dt);
    const p = b.pos;
    camera.position.copy(toWorld(p.x, p.y, p.z + 1.6));
    const dir = new THREE.Vector3(Math.cos(walker.pitch) * c, Math.sin(walker.pitch), -Math.cos(walker.pitch) * sn);
    camera.lookAt(camera.position.clone().add(dir));
    headLamp.position.copy(camera.position);
    const lv = building.levelAt(p.z);
    if (lv.id !== state.level) { state.level = lv.id; document.querySelectorAll('#levels button').forEach((bb) => bb.classList.toggle('on', bb.dataset.level === lv.id)); renderRooms(); drawMinimapBase(); }
  }

  // ------------------------------------------------------------ picking
  const raycaster = new THREE.Raycaster();
  function pickFloor(ev) {
    if (!state.goalMode && !state.placing) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const lv = building.byId[state.level];
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -lv.elevation);
    const hit = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return;
    handlePlanClick(lv.id, hit.x, -hit.z);
  }
  function handlePlanClick(levelId, x, y) {
    if (state.placing) {
      const kind = state.placing; state.placing = null;
      $('addAmr').classList.remove('armed'); $('addQuad').classList.remove('armed');
      const g = grids[levelId].nearestFree(x, y, 0.35, 3);
      if (!g) return toast('배치할 수 없는 위치');
      selectRobot(spawn(kind, levelId, g[0], g[1], 0));
      return;
    }
    const r = state.selected;
    if (!r) return toast('먼저 로봇을 추가/선택하세요');
    if (r.goTo(levelId, x, y)) toast(`${r.name} → ${levelId} (${x.toFixed(1)}, ${y.toFixed(1)})`);
    else toast('경로를 찾을 수 없습니다');
  }

  // ------------------------------------------------------------ robots
  function spawn(kind, levelId, x, y, yaw = 0) {
    const lv = building.byId[levelId];
    const r = new Robot(sim, kind, x, y, lv.elevation + 0.3, yaw);
    sim.robots.push(r);
    r.odomNoise = +$('noise').value;
    r.scanViz.visible = $('showScan').checked;
    ros.ensureTopics();
    renderRobotSel();
    return r;
  }
  function selectRobot(r) { state.selected = r; renderRobotSel(); }
  function renderRobotSel() {
    const s = $('robotSel'); s.innerHTML = '';
    for (const r of sim.robots) { const o = document.createElement('option'); o.value = r.id; o.textContent = `${r.name} (${r.id})`; s.appendChild(o); }
    if (state.selected) s.value = state.selected.id;
  }

  // ------------------------------------------------------------ UI wiring
  const lvWrap = $('levels');
  for (const lv of building.levels) {
    const b = document.createElement('button'); b.textContent = lv.id; b.dataset.level = lv.id;
    b.onclick = () => setMode(state.mode === 'exterior' ? 'cutaway' : state.mode, lv.id);
    lvWrap.appendChild(b);
  }
  document.querySelectorAll('#modes button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  function renderRooms() {
    const lv = building.byId[state.level];
    $('roomsLevel').textContent = `${lv.id} · ${lv.name} · 천장고 ${lv.ceiling.toFixed(1)}m`;
    const ul = $('rooms'); ul.innerHTML = '';
    for (const r of lv.rooms) {
      const li = document.createElement('li'); li.textContent = r.name;
      li.onclick = () => {
        if (state.mode === 'walk') teleport(lv.id, r.x, r.y);
        else { if (state.mode === 'exterior') setMode('cutaway', lv.id); const t = toWorld(r.x, r.y, lv.elevation); const off = camera.position.clone().sub(orbit.target).setLength(16); orbit.target.copy(t); camera.position.copy(t).add(off); }
      };
      ul.appendChild(li);
    }
  }
  // elevators
  const evWrap = $('elevators');
  const evUI = elevators.map((e) => {
    const row = document.createElement('div'); row.className = 'ev';
    row.innerHTML = `<b>${e.id}</b><span class="lvl"></span><select>${e.def.levels.map((l) => `<option>${l}</option>`).join('')}</select><button>호출</button>`;
    row.querySelector('button').onclick = () => { e.call(row.querySelector('select').value); };
    evWrap.appendChild(row);
    return row.querySelector('.lvl');
  });
  $('addAmr').onclick = () => armPlace('amr');
  $('addQuad').onclick = () => armPlace('quadruped');
  function armPlace(kind) {
    if (state.mode === 'exterior' || state.mode === 'walk') setMode('cutaway', state.level);
    state.placing = kind; state.goalMode = false; $('goalMode').classList.remove('armed');
    $('addAmr').classList.toggle('armed', kind === 'amr'); $('addQuad').classList.toggle('armed', kind === 'quadruped');
    toast('바닥(또는 미니맵)을 클릭해 로봇을 배치하세요');
  }
  $('robotSel').onchange = (e) => selectRobot(sim.robots.find((r) => r.id === e.target.value));
  $('delRobot').onclick = () => {
    const r = state.selected; if (!r) return;
    r.dispose(); sim.robots.splice(sim.robots.indexOf(r), 1); state.selected = sim.robots[0] || null; renderRobotSel();
  };
  $('goalMode').onclick = () => {
    state.goalMode = !state.goalMode; state.placing = null;
    $('goalMode').classList.toggle('armed', state.goalMode);
    if (state.goalMode) { if (state.mode === 'exterior' || state.mode === 'walk') setMode('cutaway', state.selected ? state.selected.level.id : state.level); toast('바닥(또는 미니맵)을 클릭해 목적지를 지정하세요'); }
  };
  $('stopRobot').onclick = () => state.selected?.cancel();
  $('aoOn').onchange = (e) => { useAO = e.target.checked; };
  $('followCam').onchange = (e) => (state.follow = e.target.checked);
  $('robotCam').onchange = (e) => (state.robotCam = e.target.checked);
  $('showScan').onchange = (e) => sim.robots.forEach((r) => (r.scanViz.visible = e.target.checked));
  $('slamOn').onchange = (e) => sim.robots.forEach((r) => (r.slamOn = e.target.checked));
  const TS = [0, 1, 2, 4, 8, 16];
  $('timeScale').oninput = (e) => { sim.timeScale = TS[+e.target.value]; $('tsVal').textContent = sim.timeScale ? `×${sim.timeScale}` : '일시정지'; };
  $('noise').oninput = (e) => sim.robots.forEach((r) => (r.odomNoise = +e.target.value));
  const gl = $('goalLevel');
  for (const lv of building.levels) gl.insertAdjacentHTML('beforeend', `<option value="${lv.id}">${lv.id}</option>`);
  const fillGoalRooms = () => { $('goalRoom').innerHTML = building.byId[gl.value].rooms.map((r, i) => `<option value="${i}">${r.name}</option>`).join(''); };
  gl.onchange = fillGoalRooms; gl.value = '3F'; fillGoalRooms();
  $('goRoom').onclick = () => {
    const r = state.selected; if (!r) return toast('먼저 로봇을 추가/선택하세요');
    const room = building.byId[gl.value].rooms[+$('goalRoom').value];
    if (r.goTo(gl.value, room.x, room.y)) toast(`${r.name} → ${gl.value} ${room.name}`); else toast('경로를 찾을 수 없습니다');
  };
  $('rosConnect').onclick = () => { ros.ros2 = $('ros2').checked; if (ros.connected) ros.disconnect(); else ros.connect($('rosUrl').value); };
  ros.onstatus = (s) => { $('rosStatus').textContent = s; $('rosConnect').textContent = ros.connected ? '해제' : '연결'; };
  $('panelToggle').onclick = () => $('panel').classList.toggle('closed');
  document.querySelectorAll('#mmLayer button').forEach((b) => (b.onclick = () => {
    state.mmLayer = b.dataset.l; document.querySelectorAll('#mmLayer button').forEach((q) => q.classList.toggle('on', q === b)); drawMinimapBase();
  }));

  // export
  const download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  $('expJson').onclick = () => download('building.json', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  $('expMap').onclick = async () => {
    const id = state.level;
    download(`${id}.pgm`, await (await fetch(`${BASE}data/maps/${id}.pgm`)).blob());
    download(`${id}.yaml`, await (await fetch(`${BASE}data/maps/${id}.yaml`)).blob());
  };
  $('expSlam').onclick = () => {
    const r = state.selected; if (!r) return toast('로봇을 선택하세요');
    const lv = r.level.id, { pgm, yaml } = r.slam.exportPGM(lv);
    download(`slam_${lv}.pgm`, new Blob([pgm])); download(`slam_${lv}.yaml`, new Blob([yaml]));
  };
  $('expGlb').onclick = () => {
    toast('GLB 생성 중…', 4000);
    const exp = new GLTFExporter();
    const vis = {}; for (const [id, g] of Object.entries(building.groups)) { vis[id] = g.visible; g.visible = true; }
    exp.parse(building.root, (glb) => {
      for (const [id, g] of Object.entries(building.groups)) g.visible = vis[id];
      download('kopo_ctc_building.glb', new Blob([glb], { type: 'model/gltf-binary' }));
    }, (err) => toast(`GLB 오류: ${err.message}`), { binary: true, onlyVisible: false });
  };

  // ------------------------------------------------------------ minimap
  const mm = $('minimap'), mg = mm.getContext('2d');
  const mmBase = document.createElement('canvas'); mmBase.width = 620; mmBase.height = 420;
  const meta = data.meta;
  const toMM = (x, y) => [(x - meta.origin[0]) / meta.resolution, meta.size[1] - (y - meta.origin[1]) / meta.resolution];
  function mmLevel() { return state.selected && state.mode !== 'walk' ? state.selected.level.id : state.level; }
  async function drawMinimapBase() {
    const id = mmLevel();
    const bg = mmBase.getContext('2d');
    $('mmTitle').textContent = `${id} ${state.mmLayer === 'slam' ? 'SLAM 맵' : '점유 격자 (도면)'}`;
    if (state.mmLayer === 'truth') {
      bg.drawImage(grids[id] && (drawMinimapBase.cache[id] ||= await loadImage(`${BASE}data/maps/${id}.png`)), 0, 0);
    }
    drawMinimapBase.level = id;
  }
  drawMinimapBase.cache = {};
  let slamT = 0;
  function drawSlam(id) {
    const r = state.selected; const bg = mmBase.getContext('2d');
    const img = bg.createImageData(620, 420);
    const m = r ? r.slam.map(id) : null;
    for (let j = 0; j < 420; j++) for (let i = 0; i < 620; i++) {
      const v = m ? m[j * 620 + i] : 0, k = ((419 - j) * 620 + i) * 4;
      const c = v > 0.6 ? 20 : v < -0.6 ? 245 : 190;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = c; img.data[k + 3] = 255;
    }
    bg.putImageData(img, 0, 0);
  }
  function drawMinimap(dt) {
    const id = mmLevel();
    if (drawMinimapBase.level !== id) drawMinimapBase();
    if (state.mmLayer === 'slam') { slamT -= dt; if (slamT <= 0) { slamT = 0.4; drawSlam(id); } }
    mg.drawImage(mmBase, 0, 0);
    for (const r of sim.robots) {
      if (r.level.id !== id) continue;
      const sel = r === state.selected;
      // path
      const pts = [];
      for (const t of r.tasks) if (t.type === 'path' && t.level === id) pts.push(...(t === r.tasks[0] ? r.path : t.pts));
      if (pts.length) {
        mg.strokeStyle = '#2f6fd6'; mg.lineWidth = 2; mg.beginPath();
        mg.moveTo(...toMM(r.body.pos.x, r.body.pos.y)); for (const p of pts) mg.lineTo(...toMM(...p)); mg.stroke();
      }
      // scan
      if (sel && r.lastScan && state.mmLayer === 'truth') {
        const { ranges, angleMin, angleInc } = r.lastScan; mg.fillStyle = '#ff2d55';
        for (let i = 0; i < ranges.length; i += 2) {
          const rr = ranges[i]; if (!Number.isFinite(rr)) continue;
          const a = r.yaw + angleMin + i * angleInc; const [u, v] = toMM(r.body.pos.x + rr * Math.cos(a), r.body.pos.y + rr * Math.sin(a));
          mg.fillRect(u - 1, v - 1, 2, 2);
        }
      }
      // SLAM estimate
      if (r.slam.est && state.mmLayer === 'slam') drawPose(r.slam.est.x, r.slam.est.y, r.slam.est.yaw, '#18a058', 7);
      drawPose(r.body.pos.x, r.body.pos.y, r.yaw, sel ? '#f2b632' : '#4f8cff', sel ? 9 : 7);
    }
    if (state.mode === 'walk') drawPose(walker.body.pos.x, walker.body.pos.y, walker.yaw, '#e5484d', 8);
    for (const e of elevators) if (e.levels.some((l) => l.id === id)) {
      const [x0, y0, x1, y1] = e.car; const [a, b] = toMM(x0, y1), [c, d] = toMM(x1, y0);
      mg.strokeStyle = e.level.id === id ? '#18a058' : '#999'; mg.lineWidth = 2; mg.strokeRect(a, b, c - a, d - b);
    }
  }
  function drawPose(x, y, yaw, col, s) {
    const [u, v] = toMM(x, y);
    mg.save(); mg.translate(u, v); mg.rotate(-yaw);
    mg.fillStyle = col; mg.strokeStyle = '#111'; mg.lineWidth = 1.2;
    mg.beginPath(); mg.moveTo(s, 0); mg.lineTo(-s * 0.7, s * 0.6); mg.lineTo(-s * 0.4, 0); mg.lineTo(-s * 0.7, -s * 0.6); mg.closePath(); mg.fill(); mg.stroke();
    mg.restore();
  }
  mm.addEventListener('click', (ev) => {
    const r = mm.getBoundingClientRect();
    const u = ((ev.clientX - r.left) / r.width) * 620, v = ((ev.clientY - r.top) / r.height) * 420;
    const x = meta.origin[0] + u * meta.resolution, y = meta.origin[1] + (420 - v) * meta.resolution;
    const id = mmLevel();
    if (state.mode === 'walk') return teleport(id, x, y);
    if (!state.goalMode && !state.placing) { state.goalMode = true; }
    handlePlanClick(state.placing ? state.level : id, x, y);
    if (!state.placing) { state.goalMode = $('goalMode').classList.contains('armed'); }
  });

  // ------------------------------------------------------------ robot camera (PiP)
  const robotCam = new THREE.PerspectiveCamera(75, 4 / 3, 0.05, 200);

  // ------------------------------------------------------------ resize + loop
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); labelRenderer.setSize(w, h);
    composer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio());
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  const clock = new THREE.Clock();
  let hudT = 0;
  // fixed-step simulation (decoupled from rendering, keeps running in hidden tabs)
  const STEP = 1 / 60;
  let acc = 0, last = performance.now();
  function stepSim(dt) {
    for (const e of elevators) e.update(dt);
    const K = walker.keys, r = state.selected;
    // teleop (IJKL) for the selected robot outside walk mode
    if (r && state.mode !== 'walk' && (K.i || K.k || K.j || K.l)) {
      r.tasks = []; r.setCmd(((K.i ? 1 : 0) - (K.k ? 1 : 0)) * r.P.vmax * 0.8, ((K.j ? 1 : 0) - (K.l ? 1 : 0)) * r.P.wmax * 0.7, 0.15);
    }
    for (const rb of sim.robots) rb.update(dt);
    sim.time += dt;
  }
  function advance() {
    const now = performance.now();
    acc += Math.min((now - last) / 1000, 0.25) * sim.timeScale; last = now;
    let n = 0;
    while (acc >= STEP && n++ < 40) { stepSim(STEP); acc -= STEP; }
    if (n >= 40) acc = 0;
  }
  setInterval(() => { if (document.hidden) advance(); }, 50);
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    advance();
    const r = state.selected;
    if (walker.active) updateWalker(dt);
    else {
      if (state.follow && r) {
        const t = toWorld(r.body.pos.x, r.body.pos.y, r.body.pos.z + 0.5);
        const d = t.clone().sub(orbit.target); orbit.target.add(d); camera.position.add(d);
        if (state.mode !== 'exterior' && r.level.id !== state.level) setMode(state.mode, r.level.id);
      }
      orbit.update();
    }
    renderer.clippingPlanes = building.clipPlanes || [];
    renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
    renderer.setScissorTest(false);
    if (useAO) composer.render(); else renderer.render(scene, camera);
    labelRenderer.render(scene, camera);

    // PiP robot camera
    const show = state.robotCam && r && state.mode !== 'walk';
    $('pipLabel').classList.toggle('hidden', !show);
    if (show) {
      const W = Math.min(320, window.innerWidth * 0.3), H = W * 0.75;
      const x = window.innerWidth - W - 12 - 372, y = 12;
      const p = r.body.pos;
      robotCam.position.copy(toWorld(p.x + Math.cos(r.yaw) * 0.25, p.y + Math.sin(r.yaw) * 0.25, p.z + r.P.height + 0.05));
      robotCam.lookAt(toWorld(p.x + Math.cos(r.yaw) * 3, p.y + Math.sin(r.yaw) * 3, p.z + r.P.height - 0.25));
      robotCam.aspect = W / H; robotCam.updateProjectionMatrix();
      renderer.clippingPlanes = [];
      const vis = {}; for (const [id, g] of Object.entries(building.groups)) { vis[id] = g.visible; g.visible = true; }
      const cv = {}; for (const [id, g] of Object.entries(building.ceilings)) { cv[id] = g.visible; g.visible = true; }
      const rv = building.roof.visible; building.roof.visible = true;
      const sv = sim.robots.map((q) => q.scanViz.visible); sim.robots.forEach((q) => (q.scanViz.visible = false));
      renderer.setScissorTest(true);
      renderer.setViewport(x, y, W, H); renderer.setScissor(x, y, W, H);
      renderer.render(scene, robotCam);
      renderer.setScissorTest(false);
      for (const [id, g] of Object.entries(building.groups)) g.visible = vis[id];
      for (const [id, g] of Object.entries(building.ceilings)) g.visible = cv[id];
      building.roof.visible = rv;
      sim.robots.forEach((q, i) => (q.scanViz.visible = sv[i]));
      const pl = $('pipLabel'); pl.style.right = `${12 + 372}px`; pl.style.bottom = `${y + H - 22}px`;
      pl.textContent = `로봇 카메라 · ${r.name}`;
    }

    drawMinimap(dt);
    hudT -= dt;
    if (hudT <= 0) {
      hudT = 0.2;
      evUI.forEach((el, i) => { const e = elevators[i]; el.textContent = `${e.level.id}${e.v ? (e.v > 0 ? ' ▲' : ' ▼') : e.doorOpen ? ' ◀▶' : ''}`; });
      if (walker.active) {
        const p = walker.body.pos;
        $('hudLevel').textContent = `${building.levelAt(p.z).id} · 1인칭`;
        $('hudPos').textContent = `x ${p.x.toFixed(2)}  y ${p.y.toFixed(2)}  z ${p.z.toFixed(2)} m`;
      } else {
        $('hudLevel').textContent = state.mode === 'exterior' ? '외관' : `${state.level} · ${building.byId[state.level].name}`;
        $('hudPos').textContent = r ? `${r.id}: ${r.level.id} (${r.body.pos.x.toFixed(2)}, ${r.body.pos.y.toFixed(2)}) ${(r.yaw * 57.3).toFixed(0)}°` : '로봇 없음';
      }
      $('robotStatus').textContent = r ? `${r.name}: ${r.status}${r.slam.est ? ` · SLAM 오차 ${Math.hypot(r.slam.est.x - r.body.pos.x, r.slam.est.y - r.body.pos.y).toFixed(2)} m` : ''}` : '—';
    }
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ public API (scripting / automated tests)
  Object.assign(sim, {
    setMode, spawn, selectRobot, teleport, toast,
    goTo: (id, level, x, y) => sim.robots.find((q) => q.id === id)?.goTo(level, x, y),
    callElevator: (id, level) => elevators.find((e) => e.id === id)?.call(level),
    get state() { return state; },
    walker,
    camera, renderer, orbit, aoPass,
  });
  window.sim = sim;

  // initial content: one AMR waiting in the 1F lobby
  selectRobot(spawn('amr', '1F', 8.5, 7.0, Math.PI / 2));
  setMode('exterior');
  $('loading').remove();
  frame();
}

main().catch((e) => {
  console.error(e);
  const l = $('loading'); if (l) l.innerHTML = `<p style="color:#e5484d">로딩 실패: ${e.message}</p>`;
});
