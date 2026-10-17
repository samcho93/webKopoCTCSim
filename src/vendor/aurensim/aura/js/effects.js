// webKopoCTCSim: getWorldPosition results are mapped into R.root (effects live under the machine root)
// effects.js — 입자 효과: 커피 줄기, 온수, 스팀 분사, 3WAY 잔압 배출, 릴리프 배기, 잔 김
import * as THREE from 'three';
import { softDot } from './materials.js';
import { DIM } from './machine.js';

const VS = `
attribute float size; attribute float alpha; attribute vec3 color;
varying float vA; varying vec3 vC;
void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = size * (2600.0 / -mv.z); gl_Position = projectionMatrix * mv; }`;
const FS = `
uniform sampler2D map; varying float vA; varying vec3 vC;
void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); if (gl_FragColor.a < 0.01) discard; }`;

class Pool {
  constructor(scene, n, additive) {
    this.n = n; this.i = 0;
    this.p = new Float32Array(n * 3); this.v = new Float32Array(n * 3); this.c = new Float32Array(n * 3);
    this.s = new Float32Array(n); this.a = new Float32Array(n); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.grow = new Float32Array(n); this.drag = new Float32Array(n); this.g = new Float32Array(n); this.floor = new Float32Array(n);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.c, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.s, 1));
    geo.setAttribute('alpha', new THREE.BufferAttribute(this.a, 1));
    this.pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: { map: { value: softDot } }, vertexShader: VS, fragmentShader: FS,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
    this.pts.frustumCulled = false; this.pts.renderOrder = 10;
    scene.add(this.pts);
    for (let k = 0; k < n; k++) this.p[k * 3 + 1] = -99;
  }
  emit(pos, vel, color, size, life, o = {}) {
    const k = this.i; this.i = (this.i + 1) % this.n;
    this.p.set([pos.x, pos.y, pos.z], k * 3); this.v.set([vel.x, vel.y, vel.z], k * 3); this.c.set([color.r, color.g, color.b], k * 3);
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

/* 연속 액체 줄기(스파우트 → 잔): 위→아래로 흐르는 무늬가 스크롤되는 원기둥 */
function streamTexture() {
  const c = document.createElement('canvas'); c.width = 16; c.height = 128;
  const g = c.getContext('2d');
  for (let y = 0; y < 128; y++) { const v = 150 + 105 * Math.max(0, Math.sin(y / 128 * Math.PI * 6 + Math.sin(y * 0.7))) ; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(0, y, 16, 1); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
class Stream {
  constructor(scene) {
    const geo = new THREE.CylinderGeometry(1, 0.8, 1, 14, 1, true); geo.translate(0, -0.5, 0);   // 윗면이 원점
    this.tex = streamTexture();
    this.mat = new THREE.MeshPhysicalMaterial({ color: 0x3a1a08, map: this.tex, roughness: 0.12, clearcoat: 1, transparent: true, opacity: 0.92, depthWrite: false });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.visible = false; this.mesh.renderOrder = 9;
    this.mesh.raycast = () => {};
    scene.add(this.mesh); this.k = 0; this.ph = Math.random() * 10;
  }
  update(top, bottomY, flow, color, dt, opacity = 0.92) {
    this.k += ((flow > 0.02 ? 1 : 0) - this.k) * Math.min(1, dt * 10);      // 시작/정지 시 부드럽게
    if (this.k < 0.02 || top.y <= bottomY) { this.mesh.visible = false; return; }
    this.mesh.visible = true; this.ph += dt;
    const r = (0.0007 + 0.0011 * Math.sqrt(Math.max(0, flow))) * this.k;
    const len = top.y - bottomY;
    this.mesh.position.set(top.x + Math.sin(this.ph * 9) * 0.0003, top.y, top.z + Math.cos(this.ph * 7) * 0.0003);
    this.mesh.scale.set(r, len, r);
    this.mat.color.copy(color); this.mat.opacity = opacity;
    this.tex.repeat.set(1, len / 0.02); this.tex.offset.y += dt * (1.2 + flow * 0.4);
  }
}

export function buildEffects(scene, R) {
  const liquid = new Pool(scene, 5000, false);
  const vapor = new Pool(scene, 2500, true);
  const acc = { coffee: [0, 0], hw: 0, steam: [0, 0], purge: [0, 0], relief: 0, wisp: { 0: 0, 1: 0, hw: 0 } };
  const COFFEE = new THREE.Color(0x4a2410), CREMA = new THREE.Color(0x9a5a2a), WATER = new THREE.Color(0xbfdcf0), STEAMC = new THREE.Color(0.55, 0.55, 0.58);
  const tmp = new THREE.Vector3(), vel = new THREE.Vector3();
  const streams = [[new Stream(scene), new Stream(scene)], [new Stream(scene), new Stream(scene)]];
  const hwStream = new Stream(scene);
  const sp = new THREE.Vector3();
  const rnd = (a) => (Math.random() - 0.5) * a;

  function cupSurfaceY(c, key) {
    const cup = R.cups[key];
    if (!c || !c.present) return DIM.trayY - 0.01;
    return cup.group.position.y + 0.008 + (c.ml / c.cap) * cup.h * 0.95;
  }

  return {
    update(s, dt) {
      if (!s) { liquid.update(dt); vapor.update(dt); return; }
      /* 커피 줄기: 스파우트 2개 → 잔 */
      s.groups.forEach((g, i) => {
        const coffee = g.puck.present && g.puck.kind === 'coffee';
        const floorY = cupSurfaceY(g.cup, i);
        const ext = g.puck.ext || 0;
        const col = coffee ? (ext < 6 ? COFFEE : ext < 22 ? CREMA.clone().lerp(COFFEE, 0.4) : CREMA.clone().lerp(WATER, Math.min(0.6, (ext - 22) / 30))) : WATER;
        // 연속 줄기: 스파우트 2개 각각(유량 절반씩). 포터필터가 없으면 샤워스크린에서 바로 떨어짐
        R.spouts[i].forEach((spm, k) => {
          spm.getWorldPosition(sp); R.root.worldToLocal(sp); sp.y -= 0.008;
          if (!g.puck.present || g.puck.kind === 'none') { R.groupHeads[i].getWorldPosition(sp); R.root.worldToLocal(sp); sp.y = DIM.ghY - 0.03; sp.x += (k ? 0.012 : -0.012); }
          streams[i][k].update(sp, floorY, g.out / 2, col, dt, coffee ? 0.95 : 0.55);
        });
        if (g.out > 0.02) {
          acc.coffee[i] += g.out * dt * 18;
          while (acc.coffee[i] >= 1) {
            acc.coffee[i] -= 1;
            const sp = R.spouts[i][Math.random() < 0.5 ? 0 : 1];
            sp.getWorldPosition(tmp); R.root.worldToLocal(tmp); tmp.y -= 0.009;
            const thin = Math.min(1, g.out / 2.5);
            liquid.emit(tmp.clone().add(new THREE.Vector3(rnd(0.0008), 0, rnd(0.0008))), vel.set(rnd(0.006), -0.12 - Math.random() * 0.05, rnd(0.006)), col,
                        0.0012 + 0.001 * thin, 1.2, { floor: floorY, g: -9.8 });
          }
        }
        // 3WAY 잔압 배출(그룹헤드 뒤 배수관 → 드립트레이)
        if (g.purge > 0.05) {
          acc.purge[i] += g.purge * dt * 400;
          while (acc.purge[i] >= 1) {
            acc.purge[i] -= 1;
            const x = (i ? 1 : -1) * (DIM.purgeX ?? 0.075);
            liquid.emit(tmp.set(x, DIM.trayY + 0.06, 0.035), vel.set(rnd(0.05), -0.6 - Math.random() * 0.4, 0.05 + rnd(0.05)), COFFEE.clone().lerp(WATER, 0.5), 0.0025, 0.6, { floor: DIM.trayY - 0.008 });
          }
          if (Math.random() < dt * 30) vapor.emit(tmp.set((i ? 1 : -1) * (DIM.purgeX ?? 0.075), DIM.trayY + 0.01, 0.05), vel.set(rnd(0.03), 0.08, rnd(0.03)), STEAMC, 0.006, 1.2, { g: 0.05, grow: 0.02, drag: 1, alpha: 0.35 });
        }
      });
      /* 온수 팁 */
      const hwOut = s.hw.Q + s.hw.Qmix;
      hwStream.update(tmp.set(DIM.hwTip.x, DIM.hwTip.y - 0.004, DIM.hwTip.z), cupSurfaceY(s.hw.cup, 'hw'), hwOut / 2.5, WATER, dt, 0.5);
      if (hwOut > 0.05) {
        acc.hw += hwOut * dt * 10;
        const floorY = cupSurfaceY(s.hw.cup, 'hw');
        while (acc.hw >= 1) {
          acc.hw -= 1;
          liquid.emit(tmp.set(DIM.hwTip.x + rnd(0.002), DIM.hwTip.y - 0.004, DIM.hwTip.z + rnd(0.002)), vel.set(rnd(0.01), -0.25, rnd(0.01)), WATER, 0.0034, 1.0, { floor: floorY });
        }
        if (s.hw.Tout > 70 && Math.random() < dt * 25) vapor.emit(tmp.set(DIM.hwTip.x, DIM.hwTip.y - 0.03, DIM.hwTip.z), vel.set(rnd(0.02), 0.06, rnd(0.02)), STEAMC, 0.006, 1.6, { g: 0.06, grow: 0.03, drag: 1.2, alpha: 0.3 });
      }
      /* 스팀 완드 */
      for (let w = 0; w < 2; w++) {
        const f = s.wandFlow[w];
        if (f <= 0.01) continue;
        const tip = DIM.wandTip[w];
        const pt = s.pitcher[w];
        if (pt.present) {
          // 우유 속 분사: 표면 위로 김 + 표면 요동
          const ptg = R.pitchers[w].group;
          const top = ptg.position.y + 0.002 + Math.min(1, pt.ml / 600) * 0.1 * (1 + pt.foam * 0.25);
          acc.steam[w] += f * dt * 30;
          while (acc.steam[w] >= 1) { acc.steam[w] -= 1; vapor.emit(tmp.set(tip.x + rnd(0.04), top + 0.004, tip.z + rnd(0.04)), vel.set(rnd(0.04), 0.05 + Math.random() * 0.06, rnd(0.04)), STEAMC, 0.008, 1.8, { g: 0.04, grow: 0.025, drag: 1.2, alpha: 0.28 }); }
        } else {
          acc.steam[w] += f * dt * 160;
          while (acc.steam[w] >= 1) {
            acc.steam[w] -= 1;
            const sp = 0.6 + f * 0.6;
            vapor.emit(tmp.set(tip.x, tip.y - 0.008, tip.z), vel.set(rnd(0.5) * sp, -(1.2 + Math.random() * 0.9) * sp, rnd(0.5) * sp), STEAMC, 0.004, 0.9, { g: 0.6, grow: 0.06, drag: 2.6, alpha: 0.42 });
          }
        }
      }
      /* 릴리프 밸브 배기(상판 뒤) */
      if (s.steam.relief) {
        acc.relief += dt * 80;
        while (acc.relief >= 1) { acc.relief -= 1; vapor.emit(tmp.set(-0.13 + rnd(0.02), DIM.headY1 + 0.01, -0.12), vel.set(rnd(0.15), 0.6 + Math.random() * 0.4, rnd(0.15)), STEAMC, 0.008, 1.4, { g: 0.2, grow: 0.06, drag: 1.5, alpha: 0.4 }); }
      }
      /* 뜨거운 잔 김 */
      const wisp = (c, key) => {
        if (!c.present || c.ml < 5 || c.T < 55) return;
        if (Math.random() < dt * (c.T - 50) * 0.08) {
          const g = R.cups[key].group.position;
          vapor.emit(tmp.set(g.x + rnd(0.03), cupSurfaceY(c, key) + 0.004, g.z + rnd(0.03)), vel.set(rnd(0.01), 0.03, rnd(0.01)), STEAMC, 0.007, 2.2, { g: 0.02, grow: 0.015, drag: 0.8, alpha: 0.18 });
        }
      };
      wisp(s.groups[0].cup, 0); wisp(s.groups[1].cup, 1); wisp(s.hw.cup, 'hw');
      liquid.update(dt); vapor.update(dt);
    },
  };
}
