// webKopoCTCSim: getWorldPosition results are mapped into R.root (effects live under the machine root)
// effects.js — 애니메이션 효과: 커피 줄기(2 스파웃), 온수(샤워스크린), 공기 섞인 토출, 워터 드레인,
//              3WAY 잔압 배출, 잔 김, 드립트레이 수위, 물병 수위/호스 흐름, 히터·펌프·솔밸브 상태
import * as THREE from 'three';
import { DIM } from './machine.js';

function canvasTex(w, h, draw) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); return t; }
const softDot = canvasTex(64, 64, (g) => { const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 64, 64); });

const VS = `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC;
void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * (2600.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const FS = `uniform sampler2D map; varying float vA; varying vec3 vC;
void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`;

class Pool {
  constructor(scene, n, additive) {
    this.n = n; this.i = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 3);
    this.s = new Float32Array(n); this.a = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grow = new Float32Array(n); this.drag = new Float32Array(n); this.g = new Float32Array(n); this.floor = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); geo.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.s, 1)); geo.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1));
    this.pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: { map: { value: softDot } }, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.pts.frustumCulled = false; this.pts.renderOrder = 10; scene.add(this.pts);
    for (let k = 0; k < n; k++) this.p[k * 3 + 1] = -99;
  }
  emit(pos, vel, color, size, life, o = {}) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    this.p[k * 3] = pos.x; this.p[k * 3 + 1] = pos.y; this.p[k * 3 + 2] = pos.z;
    this.v[k * 3] = vel.x; this.v[k * 3 + 1] = vel.y; this.v[k * 3 + 2] = vel.z;
    this.c[k * 3] = color.r; this.c[k * 3 + 1] = color.g; this.c[k * 3 + 2] = color.b;
    this.s[k] = size; this.a[k] = o.alpha ?? 1; this.life[k] = life; this.max[k] = life;
    this.grow[k] = o.grow || 0; this.drag[k] = o.drag || 0; this.g[k] = o.g ?? -9.8; this.floor[k] = o.floor ?? -1;
  }
  update(dt) {
    for (let k = 0; k < this.n; k++) {
      if (this.life[k] <= 0) continue;
      this.life[k] -= dt;
      const j = k * 3;
      this.v[j + 1] += this.g[k] * dt;
      const d = Math.exp(-this.drag[k] * dt); this.v[j] *= d; this.v[j + 1] *= d; this.v[j + 2] *= d;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      this.s[k] += this.grow[k] * dt;
      const f = this.life[k] / this.max[k];
      this.a[k] = Math.min(this.a[k], f < 0.3 ? f / 0.3 : 1);
      if (this.p[j + 1] < this.floor[k] || this.life[k] <= 0) { this.life[k] = 0; this.p[j + 1] = -99; }
    }
    const at = this.pts.geometry.attributes;
    at.position.needsUpdate = at.size.needsUpdate = at.alpha.needsUpdate = at.color.needsUpdate = true;
  }
}

function streamTexture() {
  return (() => { const t = canvasTex(16, 128, (g) => { for (let y = 0; y < 128; y++) { const v = 150 + 105 * Math.max(0, Math.sin(y / 128 * Math.PI * 6 + Math.sin(y * 0.7))); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 16, 1); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; })();
}
class Stream {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(1, 0.8, 1, 14, 1, true); geo.translate(0, -0.5, 0);
    this.tex = streamTexture();
    this.mat = new THREE.MeshPhysicalMaterial({ color: 0x3a1a08, map: this.tex, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0.92, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.visible = false; this.mesh.renderOrder = 9; this.mesh.raycast = () => {};
    scene.add(this.mesh); this.k = 0; this.ph = Math.random() * 10;
  }
  update(top, bottomY, flow, color, dt, opacity = 0.92, rScale = 1) {
    this.k += ((flow > 0.02 ? 1 : 0) - this.k) * Math.min(1, dt * 10);
    if (this.k < 0.02 || top.y <= bottomY) { this.mesh.visible = false; return; }
    this.mesh.visible = true; this.ph += dt;
    const r = (0.0008 + 0.0011 * Math.sqrt(Math.max(0, flow))) * this.k * rScale;
    const len = top.y - bottomY;
    this.mesh.position.set(top.x + Math.sin(this.ph * 9) * 0.0002, top.y, top.z + Math.cos(this.ph * 7) * 0.0002);
    this.mesh.scale.set(r, len, r);
    this.mat.color.copy(color); this.mat.opacity = opacity;
    this.tex.repeat.set(1, len / 0.02); this.tex.offset.y += dt * (1.2 + flow * 0.4);
  }
}

/* 수면 파문(잔·드립트레이·물병): 링이 퍼지며 사라짐 */
class Ripples {
  constructor(scene, n = 16) {
    this.items = Array.from({ length: n }, () => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.visible = false; m.renderOrder = 11; m.raycast = () => {}; scene.add(m);
      return { m, t: 0, life: 0, r1: 0, a: 0 };
    });
    this.i = 0;
  }
  spawn(x, y, z, color, r1 = 0.012, life = 0.7, alpha = 0.5) {
    const it = this.items[this.i]; this.i = (this.i + 1) % this.items.length;
    it.m.position.set(x, y, z); it.m.material.color.copy(color); it.t = 0; it.life = life; it.r1 = r1; it.a = alpha; it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      it.t += dt; const k = it.t / it.life;
      if (k >= 1) { it.m.visible = false; continue; }
      const r = 0.0015 + it.r1 * Math.sqrt(k); it.m.scale.set(r, r, r);
      it.m.material.opacity = it.a * (1 - k);
    }
  }
}

/* 배관 흐름: 흐르는 줄무늬 텍스처 튜브(내부보기) — 온도에 따라 파랑→빨강 */
const flowTex = () => { const t = canvasTex(64, 8, (g, w, h) => { const grd = g.createLinearGradient(0, 0, w, 0); grd.addColorStop(0, 'rgba(255,255,255,0.25)'); grd.addColorStop(0.45, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0.25)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
const _c = new THREE.Color();
function tempColor(T) {          // 20℃ 파랑 → 60℃ 보라 → 95℃ 주황빨강
  const k = Math.max(0, Math.min(1, (T - 20) / 75));
  return _c.setHSL(0.6 - 0.6 * k, 0.85, 0.55);
}
class FlowPipe {
  constructor(scene, pts, r = 0.0032) {
    this.curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.2);
    this.len = this.curve.getLength();
    this.tex = flowTex(); this.tex.repeat.set(this.len / 0.018, 1);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: 0x5ab0ff, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false, toneMapped: false });   // 내부보기 흐름 오버레이(부품에 가려지지 않게)
    this.mesh = new THREE.Mesh(new THREE.TubeGeometry(this.curve, Math.max(16, Math.round(this.len * 400)), r, 10, false), this.mat);
    this.mesh.renderOrder = 20; this.mesh.raycast = () => {}; this.mesh.visible = false; scene.add(this.mesh);
  }
  update(dt, visible, flow, T) {
    this.mesh.visible = visible; if (!visible) return;
    this.tex.offset.x -= dt * flow * 0.9;                                   // mL/s → 줄무늬 이동
    this.mat.color.copy(tempColor(T));
    this.mat.opacity = flow > 0.05 ? 0.92 : 0.35;
  }
}

/* 크레마 무늬 텍스처(호랑이 무늬·반점) */
function cremaTexture() {
  const t = canvasTex(256, 256, (g) => {
    const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128); grd.addColorStop(0, '#c88a4a'); grd.addColorStop(0.7, '#a8672e'); grd.addColorStop(1, '#6b3a16');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 120; g.fillStyle = `rgba(${Math.random() < 0.6 ? '230,175,110' : '90,45,15'},${0.12 + Math.random() * 0.25})`; g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 1 + Math.random() * 5, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = 'rgba(245,205,150,.35)'; g.lineWidth = 3; for (let i = 0; i < 5; i++) { g.beginPath(); g.arc(128, 128, 20 + i * 18 + Math.random() * 8, Math.random() * 6, Math.random() * 6 + 2); g.stroke(); }
  });
  t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildEffects(scene, R) {
  const liquid = new Pool(scene, 4000, false);
  const vapor = new Pool(scene, 1500, false);
  const COFFEE = new THREE.Color(0x3a1c0a), CREMA = new THREE.Color(0xa0632c), BLOND = new THREE.Color(0xc9955a), WATER = new THREE.Color(0xc6e2f2), STEAM = new THREE.Color(0.86, 0.88, 0.9);
  const tmp = new THREE.Vector3(), vel = new THREE.Vector3(), sp = new THREE.Vector3();
  const spoutStreams = [new Stream(scene), new Stream(scene)];
  const showerStreams = Array.from({ length: 8 }, () => new Stream(scene));
  const drainStream = new Stream(scene);
  const rnd = (a) => (Math.random() - 0.5) * a;
  const acc = { coffee: 0, water: 0, vent: 0, wisp: 0, drain: 0, sput: 0 };
  // 드립트레이 물(커버 아래)
  const dripWater = new THREE.Mesh(new THREE.BoxGeometry(0.138, 1, 0.19), new THREE.MeshPhysicalMaterial({ color: 0x9a7a5a, roughness: 0.08, transparent: true, opacity: 0.55, depthWrite: false }));
  dripWater.position.set(0, 0.027, 0.03); dripWater.visible = false; scene.add(dripWater);

  function cupSurfaceY(s) {
    const c = R.cup;
    if (!s.cup.present) return DIM.trayY - 0.012;
    return c.group.position.y + c.base + Math.min(1, s.cup.ml / s.p.cupCap) * c.liqH;
  }
  function coffeeColor(s) {
    const e = s.pf.ext;
    if (e < 8) return COFFEE; if (e < 30) return COFFEE.clone().lerp(CREMA, (e - 8) / 22); return CREMA.clone().lerp(BLOND, Math.min(1, (e - 30) / 25));
  }

  /* 내부 배관 경로(m, STEP 부품 위치 기준) */
  const P = {
    cold:    new FlowPipe(scene, [[0.036, 0.02, -0.132], [0.036, 0.05, -0.122], [0.03, 0.075, -0.108], [0.027, 0.095, -0.1]]),
    pumpOut: new FlowPipe(scene, [[0.027, 0.222, -0.1], [0.024, 0.255, -0.08], [0.005, 0.276, -0.045], [-0.008, 0.282, -0.02]]),
    pre:     new FlowPipe(scene, [[-0.008, 0.282, -0.012], [-0.004, 0.29, 0.012], [0, 0.285, 0.035], [0, 0.272, 0.05]]),
    toValve: new FlowPipe(scene, [[0.035, 0.205, 0.03], [0.05, 0.205, 0.0], [0.057, 0.2, -0.03]]),
    toGroup: new FlowPipe(scene, [[0.057, 0.19, -0.036], [0.04, 0.186, -0.01], [0.015, 0.184, 0.02], [0, 0.183, 0.045]]),
    gauge:   new FlowPipe(scene, [[0.027, 0.2, -0.1], [0.045, 0.18, -0.07], [0.052, 0.155, -0.04], [0.052, 0.14, -0.02]], 0.0018),
    vent:    new FlowPipe(scene, [[0.06, 0.165, -0.04], [0.05, 0.12, -0.03], [0.03, 0.075, -0.015], [0.01, 0.05, 0.0]], 0.0022),
  };
  // 보일러 수위(내부보기) + 히터 기포
  const boilerWater = new THREE.Mesh(new THREE.CylinderGeometry(0.044, 0.044, 1, 40), new THREE.MeshBasicMaterial({ color: 0x5ab0ff, transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false }));
  boilerWater.renderOrder = 7; boilerWater.raycast = () => {}; boilerWater.visible = false; scene.add(boilerWater);
  const BOIL = { y0: 0.2, y1: 0.272, x: 0, z: 0.051 };
  // 물병 호스 흐름(항상 보임) — hoseWater 를 흐르는 줄무늬로
  const hoseTex = flowTex(); hoseTex.repeat.set(R.hoseCurve.getLength() / 0.02, 1);
  R.hoseWater.material = new THREE.MeshBasicMaterial({ map: hoseTex, color: 0x7fbfe8, transparent: true, opacity: 0, depthWrite: false });
  // 크레마 무늬
  R.cup.crema.material.map = cremaTexture(); R.cup.crema.material.color.set(0xffffff); R.cup.crema.material.needsUpdate = true;
  const ripples = new Ripples(scene);
  const st = { post: 0, postRate: 0, rip: 0, splash: 0, bub: 0, swirl: 0 };
  const WHITE = new THREE.Color(1, 1, 1);

  function splashAt(x, y, z, col, q, dt, wide = 0.002) {
    st.splash += q * dt * 14;
    while (st.splash >= 1) { st.splash -= 1; liquid.emit(tmp.set(x + rnd(wide), y + 0.001, z + rnd(wide)), vel.set(rnd(0.06), 0.05 + Math.random() * 0.12, rnd(0.06)), col, 0.0008 + Math.random() * 0.0006, 0.4, { floor: y - 0.0005 }); }
    st.rip += dt * (2 + q * 3);
    if (st.rip > 0.35) { st.rip = 0; ripples.spawn(x + rnd(0.004), y + 0.0004, z + rnd(0.004), col.clone().lerp(WHITE, 0.35), Math.min(0.022, R.cup.rIn * 0.9), 0.8, 0.45); }
  }

  return {
    update(s, dt, pfAttached, internal) {
      if (!s) { liquid.update(dt); vapor.update(dt); ripples.update(dt); return; }
      const g = s.group, kind = s.pf.kind, floorY = cupSurfaceY(s);
      const outQ = g.out, cupOn = s.cup.present, cp = R.cup.group.position;
      const landY = cupOn ? floorY : DIM.trayY;
      /* ── 커피(2 스파웃): 방울 → 실줄기 → 굵은 줄기(진갈색→크레마→블론드) → 추출 후 잔여 방울 ── */
      const coffeeQ = kind === 'coffee' && pfAttached ? outQ : 0;
      const col = coffeeColor(s);
      const streamQ = coffeeQ > 0.35 ? coffeeQ : 0;                    // 유량이 적으면 줄기 대신 방울
      R.pf.spouts.forEach((tip, k) => { tip.getWorldPosition(sp); R.root.worldToLocal(sp); spoutStreams[k].update(sp, landY, streamQ / 2, col, dt, 0.95); });
      if (coffeeQ > 0.02) {
        acc.coffee += coffeeQ * dt * (streamQ ? 16 : 26);
        while (acc.coffee >= 1) {
          acc.coffee -= 1;
          R.pf.spouts[Math.random() < 0.5 ? 0 : 1].getWorldPosition(tmp); R.root.worldToLocal(tmp);
          liquid.emit(tmp.add(vel.set(rnd(0.0006), -0.001, rnd(0.0006))), vel.set(rnd(0.003), -0.05 - Math.random() * 0.05, rnd(0.003)), col, streamQ ? 0.0011 : 0.0016, 1.2, { floor: landY });
        }
        splashAt(cp.x, landY, cp.z, col, coffeeQ, dt);
        st.post = 3.5; st.postRate = Math.max(st.postRate, Math.min(6, coffeeQ * 4));
        st.swirl += dt * (0.6 + coffeeQ);
      } else if (st.post > 0 && kind === 'coffee' && pfAttached) {    // 추출 종료 후 스파웃에서 똑똑
        st.post -= dt; const rate = st.postRate * (st.post / 3.5) ** 2;
        if (Math.random() < dt * rate) {
          R.pf.spouts[Math.random() < 0.5 ? 0 : 1].getWorldPosition(tmp); R.root.worldToLocal(tmp);
          liquid.emit(tmp, vel.set(0, -0.02, 0), col, 0.0017, 1.2, { floor: landY });
          if (cupOn) ripples.spawn(cp.x + rnd(0.008), landY + 0.0004, cp.z + rnd(0.008), col.clone().lerp(WHITE, 0.4), 0.01, 0.6, 0.4);
        }
      } else { st.post = 0; st.postRate = 0; }
      R.cup.crema.rotation.z = st.swirl * 0.4;                          // 잔 속 크레마가 천천히 돈다
      /* ── 온수(포터필터 없음): 샤워스크린 링에서 여러 줄기 + 튀김·파문 ── */
      const showerQ = (kind === 'none' || !pfAttached) ? outQ : 0;
      showerStreams.forEach((stm, k) => {
        const a = k / 8 * Math.PI * 2, rr = 0.016 + (k % 2) * 0.008;
        sp.set(DIM.groupC.x + Math.cos(a) * rr, DIM.groupC.y - 0.001, DIM.groupC.z + Math.sin(a) * rr);
        stm.update(sp, landY, showerQ / 8 * 2.2, WATER, dt, 0.6, 0.8);
      });
      if (showerQ > 0.05) {
        acc.water += showerQ * dt * 30;
        while (acc.water >= 1) { acc.water -= 1; const a = Math.random() * Math.PI * 2, rr = Math.random() * 0.025; liquid.emit(tmp.set(DIM.groupC.x + Math.cos(a) * rr, DIM.groupC.y - 0.002, DIM.groupC.z + Math.sin(a) * rr), vel.set(rnd(0.01), -0.25, rnd(0.01)), WATER, 0.0022, 0.8, { floor: landY, alpha: 0.6 }); }
        splashAt(cupOn ? cp.x : DIM.groupC.x, landY, cupOn ? cp.z : DIM.groupC.z, WATER, showerQ * 0.6, dt, 0.012);
        if (s.boiler.T > 70 && Math.random() < dt * 30) vapor.emit(tmp.set(DIM.groupC.x + rnd(0.03), landY + 0.01, DIM.groupC.z + rnd(0.03)), vel.set(rnd(0.02), 0.05, rnd(0.02)), STEAM, 0.007, 1.8, { g: 0.04, grow: 0.025, drag: 1.2, alpha: 0.22 });
        if (s.boiler.T > 80 && Math.random() < dt * 12) vapor.emit(tmp.set(DIM.groupC.x + rnd(0.04), DIM.groupC.y - 0.01, DIM.groupC.z + rnd(0.04)), vel.set(rnd(0.02), 0.03, rnd(0.02)), STEAM, 0.006, 1.4, { g: 0.03, grow: 0.02, drag: 1.5, alpha: 0.18 });
      }
      /* ── 공기 섞인 토출(빈 보일러 채움 중): 끊기는 물줄기·물보라 ── */
      if (g.sputter > 0) {
        acc.sput += dt * 60 * (0.3 + g.sputter);
        while (acc.sput >= 1) {
          acc.sput -= 1;
          if (Math.random() < 0.5 + 0.5 * g.sputter) {
            const from = kind === 'coffee' && pfAttached ? R.root.worldToLocal(R.pf.spouts[Math.random() < 0.5 ? 0 : 1].getWorldPosition(tmp)) : tmp.set(DIM.groupC.x + rnd(0.04), DIM.groupC.y - 0.002, DIM.groupC.z + rnd(0.04));
            liquid.emit(from, vel.set(rnd(0.2), -0.1 - Math.random() * 0.3, rnd(0.2)), WATER, 0.0025 + Math.random() * 0.002, 0.8, { floor: DIM.trayY - 0.004, alpha: 0.7 });
          }
          if (Math.random() < 0.15) vapor.emit(tmp.set(DIM.groupC.x + rnd(0.03), DIM.groupC.y - 0.01, DIM.groupC.z + rnd(0.03)), vel.set(rnd(0.08), -0.02, rnd(0.08)), STEAM, 0.006, 0.8, { g: 0.1, grow: 0.03, drag: 2, alpha: 0.25 });
        }
      }
      /* ── 워터 드레인: 그룹 중앙(볼트 제거 구멍)에서 굵은 줄기 → 드립트레이 파문 ── */
      sp.set(DIM.groupC.x, DIM.groupC.y - 0.004, DIM.groupC.z);
      drainStream.update(sp, DIM.trayY - 0.01, g.drain * 3, WATER, dt, 0.5, 1.4);
      if (g.drain > 0.05) {
        splashAt(DIM.groupC.x, DIM.trayY, DIM.groupC.z, WATER, g.drain, dt, 0.004);
        if (s.boiler.T > 60 && Math.random() < dt * 25) vapor.emit(tmp.set(rnd(0.03), DIM.trayY + 0.01, DIM.groupC.z + rnd(0.03)), vel.set(rnd(0.03), 0.06, rnd(0.03)), STEAM, 0.008, 2, { g: 0.05, grow: 0.03, drag: 1, alpha: 0.25 });
      }
      /* ── 3WAY 잔압 배출: 그룹 뒤 배수구 → 드립트레이(뒤쪽) ── */
      if (g.vent > 0.02) {
        acc.vent += g.vent * dt * 500;
        while (acc.vent >= 1) { acc.vent -= 1; liquid.emit(tmp.set(rnd(0.01), 0.06, 0.012), vel.set(rnd(0.08), -0.5 - Math.random() * 0.4, 0.06 + rnd(0.06)), COFFEE.clone().lerp(WATER, 0.55), 0.0022, 0.6, { floor: DIM.trayY - 0.006 }); }
        if (Math.random() < dt * 40) vapor.emit(tmp.set(rnd(0.02), DIM.trayY + 0.01, 0.03), vel.set(rnd(0.03), 0.09, rnd(0.03)), STEAM, 0.007, 1.3, { g: 0.06, grow: 0.025, drag: 1, alpha: 0.3 });
        if (Math.random() < dt * 8) ripples.spawn(rnd(0.02), DIM.trayY - 0.012, 0.03, COFFEE.clone().lerp(WATER, 0.6), 0.02, 0.9, 0.35);
      }
      /* ── 뜨거운 잔 김 ── */
      if (cupOn && s.cup.ml > 5 && s.cup.T > 50 && Math.random() < dt * (s.cup.T - 45) * 0.12) {
        vapor.emit(tmp.set(cp.x + rnd(0.03), floorY + 0.004, cp.z + rnd(0.03)), vel.set(rnd(0.008), 0.028, rnd(0.008)), STEAM, 0.008, 2.6, { g: 0.015, grow: 0.014, drag: 0.8, alpha: 0.16 });
      }
      /* ── 물병 → 호스 흐름 + 흡입 파문 ── */
      const pumpOn = s.mainSwitch && s.out.pump && s.tank.present && s.tank.hose && s.tank.ml > 20;
      const inQ = pumpOn ? Math.max(0.3, s.line.pumpQ - s.line.opvQ) : 0;
      hoseTex.offset.x -= dt * inQ * 1.1;
      R.hoseWater.material.opacity += ((pumpOn ? 0.8 : (s.tank.hose && s.tank.ml > 20 ? 0.22 : 0)) - R.hoseWater.material.opacity) * Math.min(1, dt * 6);
      if (pumpOn && Math.random() < dt * 5) {
        const b = R.bottle.group.position, wy = b.y + 0.005 + Math.min(1, s.tank.ml / s.p.tankCap) * (R.bottle.h - 0.012);
        ripples.spawn(b.x + 0.012, wy + 0.0005, b.z, WATER, 0.03, 1.2, 0.3);
      }
      /* ── 내부 배관 흐름 + 보일러 수위·히터 기포(내부보기) ── */
      const fillQ = pumpOn ? Math.max(0, s.line.pumpQ - s.line.opvQ) : 0;
      const gq = s.line.Q + g.drain;
      P.cold.update(dt, internal, fillQ, s.p.ambient);
      P.pumpOut.update(dt, internal, fillQ, s.p.ambient + 2);
      P.pre.update(dt, internal, fillQ, s.pre.T);
      P.toValve.update(dt, internal, gq, s.boiler.T);
      P.toGroup.update(dt, internal, s.out.v3 ? gq : 0, s.boiler.T);
      P.gauge.update(dt, internal, 0, s.boiler.T * 0.5);
      if (internal) P.gauge.mat.opacity = 0.25 + Math.min(0.65, s.line.P / 12);
      P.vent.update(dt, internal && g.vent > 0.02, g.vent * 6, s.boiler.T);
      boilerWater.visible = internal && s.boiler.ml > 1;
      if (boilerWater.visible) {
        const h = (BOIL.y1 - BOIL.y0) * Math.min(1, s.boiler.ml / s.p.boilerML);
        boilerWater.scale.y = Math.max(0.0005, h); boilerWater.position.set(BOIL.x, BOIL.y0 + h / 2, BOIL.z);
        boilerWater.material.color.copy(tempColor(s.boiler.T));
        if (s.mainSwitch && s.out.relay && s.out.ssr && !s.boiler.fuse) {
          st.bub += dt * (6 + Math.max(0, s.boiler.T - 60) * 0.6);
          while (st.bub >= 1) { st.bub -= 1; const a = Math.random() * Math.PI * 2, r = 0.012 + Math.random() * 0.02; vapor.emit(tmp.set(BOIL.x + Math.cos(a) * r, BOIL.y0 + 0.005, BOIL.z + Math.sin(a) * r), vel.set(rnd(0.004), 0.035 + Math.random() * 0.03, rnd(0.004)), WHITE, 0.0016, Math.max(0.1, (h - 0.006) / 0.05), { g: 0.02, alpha: 0.7 }); }
        }
      }
      /* ── 드립트레이 수위 ── */
      const df = Math.min(1, s.drip / s.p.dripCap);
      dripWater.visible = s.drip > 5;
      dripWater.scale.y = Math.max(0.0005, df * 0.016); dripWater.position.y = 0.0255 + dripWater.scale.y / 2;
      dripWater.material.color.set(df > 0.92 ? 0xb06040 : 0x9a7a5a);
      liquid.update(dt); vapor.update(dt); ripples.update(dt);
    },
  };
}
