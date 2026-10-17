// VALEM coffee machines from AurenSim (samcho93/aurensim, vendored in src/vendor/aurensim) as static
// showpieces on furniture (level.equipment: "auren-pro" = AUREN-PRO / AURA ONE, "auren-m" = AUREN M / BELLA ONE).
// Same idea as AurenSim's loadShowpieces(): build the machine, show idle screens, empty cups.
// "kerndu" is accepted in the data but not built: its CAD mesh is private (see vendor README).
import * as THREE from 'three';
import { toWorld } from './geo.js';

function idleLcd(lcd, title, temp, sub) {
  if (!lcd) return;
  const c = lcd.canvas, g = c.getContext('2d'), w = c.width, h = c.height;
  g.fillStyle = '#0b0f14'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#8fa3b5'; g.font = `600 ${Math.round(h * 0.055)}px "Segoe UI", sans-serif`; g.fillText(title, w * 0.05, h * 0.1);
  g.fillStyle = '#ffffff'; g.font = `300 ${Math.round(h * 0.3)}px "Segoe UI", sans-serif`; g.textAlign = 'center'; g.fillText(temp, w * 0.47, h * 0.6);
  g.font = `400 ${Math.round(h * 0.08)}px "Segoe UI", sans-serif`; g.fillStyle = '#9fb3c4'; g.fillText('℃', w * 0.47 + h * 0.48, h * 0.6);
  g.fillStyle = '#4fb3e8'; g.font = `500 ${Math.round(h * 0.06)}px "Segoe UI", sans-serif`; g.fillText(sub, w / 2, h * 0.88); g.textAlign = 'left';
  lcd.tex.needsUpdate = true;
}
function idleOled(o) {
  if (!o) return;
  const g = o.cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#fff'; g.font = 'bold 26px monospace'; g.textAlign = 'center'; g.fillText('93°C', 64, 34); g.font = '11px monospace'; g.fillText('READY  S1  S2', 64, 56);
  o.tex.needsUpdate = true;
}
function staticState(R) {
  for (const p of R.pitchers || []) { const h = 0.05; p.milk.scale.y = h; p.milk.position.y = 0.002 + h / 2; }
  for (const c of Object.values(R.cups || {})) { if (c.liq) c.liq.visible = false; if (c.crema) c.crema.visible = false; }
  if (R.bottle) { const bt = R.bottle, wh = 0.7 * (bt.h - 0.012); bt.water.scale.y = wh; bt.water.position.y = 0.005 + wh / 2; bt.surf.position.y = 0.005 + wh; bt.water.visible = bt.surf.visible = true; }
  if (R.cup) { if (R.cup.liq) R.cup.liq.visible = false; if (R.cup.crema) R.cup.crema.visible = false; }
}

/** Builds every AurenSim showpiece listed in building.json. Returns the number placed. */
export async function placeAurenShowpieces(building, { onToast = () => {} } = {}) {
  const items = building.levels.flatMap((lv) => (lv.equipment || []).filter((e) => /^(auren-pro|auren-m|kerndu)$/.test(e.model)).map((e) => ({ ...e, lv })));
  let n = 0;
  for (const it of items) {
    try {
      const holder = new THREE.Group();          // machines build into a scratch scene, then move here
      let R;
      if (it.model === 'auren-m') {
        const B = await import('./vendor/aurensim/bella/js/machine.js');
        R = await B.buildMachine(holder);
        idleOled(R.oled);
      } else if (it.model === 'auren-pro') {
        const A = await import('./vendor/aurensim/aura/js/machine.js');
        const snap = A.snapshotDim();
        A.restoreDim(A.DIM_AURA);
        R = A.buildMachine(holder, 'aura');
        idleLcd(R.lcd.p4, 'AUREN-PRO', '122.0', 'W1   W2   ⚙ 설정');
        idleLcd(R.lcd.s3g1, 'GROUP 1', '93.0', 'READY');
        idleLcd(R.lcd.s3g2, 'GROUP 2', '93.0', 'READY');
        A.restoreDim(snap);
      } else {
        console.info('KERNDU showpiece skipped: its CAD model is not public');
        continue;
      }
      staticState(R);
      // AurenSim frame: y up, front = +z. Plan yaw = direction the machine faces.
      R.root.position.copy(toWorld(it.x, it.y, it.lv.elevation + it.top));
      R.root.rotation.set(0, Math.PI / 2 + it.yaw, 0);
      R.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      building.groups[it.lv.id].add(R.root);
      n++;
    } catch (e) {
      console.warn(`showpiece ${it.model} failed`, e);
      onToast(`${it.model} 로딩 실패: ${e.message}`);
    }
  }
  return n;
}
