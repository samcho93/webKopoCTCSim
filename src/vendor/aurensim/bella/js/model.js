// model.js — BELLA ONE STEP 변환 메쉬(assets/bellaone.json/.bin) 로더
import * as THREE from 'three';

// 기본 경로는 이 모듈 기준(다른 페이지 — VALEM 카페·AuraSim 카페 모드 — 에서 불러도 같은 자산)
// webKopoCTCSim: mesh served from public/equipment/auren/bella
export async function loadBellaModel(base = `${import.meta.env.BASE_URL}equipment/auren/bella/bellaone`) {
  const [meta, buf] = await Promise.all([
    fetch(base + '.json').then(r => r.json()),
    fetch(base + '.bin').then(r => r.arrayBuffer()),
  ]);
  const meshes = meta.meshes.map((m) => {
    const q = new Int16Array(buf, m.pos, m.nv * 3);
    const pos = new Float32Array(m.nv * 3);
    const b = m.bbox;
    for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) pos[i + k] = b[k] + (q[i + k] + 32768) / 65535 * (b[k + 3] - b[k]);
    const nq = new Int8Array(buf, m.nrm, m.nv * 4);
    const nrm = new Float32Array(m.nv * 3);
    for (let i = 0; i < m.nv; i++) for (let k = 0; k < 3; k++) nrm[i * 3 + k] = nq[i * 4 + k] / 127;
    const idx = m.i32 ? new Uint32Array(buf, m.idx, m.ni) : new Uint16Array(buf, m.idx, m.ni);
    // STEP 메쉬에는 UV 가 없음 → 법선 주축 평면 투영 UV(헤어라인 텍스처용, 0.2m = 1 반복)
    const uv = new Float32Array(m.nv * 2);
    for (let i = 0; i < m.nv; i++) {
      const ax = Math.abs(nrm[i * 3]), ay = Math.abs(nrm[i * 3 + 1]), az = Math.abs(nrm[i * 3 + 2]);
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      if (ay >= ax && ay >= az) { uv[i * 2] = x * 5; uv[i * 2 + 1] = z * 5; }
      else if (ax >= az) { uv[i * 2] = z * 5; uv[i * 2 + 1] = y * 5; }
      else { uv[i * 2] = x * 5; uv[i * 2 + 1] = y * 5; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return { ...m, geometry: g };
  });
  return { meta, meshes };
}
