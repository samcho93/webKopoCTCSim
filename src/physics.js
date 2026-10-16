// Static collision world (BVH) + simple character/robot bodies.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { merge } from './geo.js';

const _ray = new THREE.Ray();
const _v = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _hit = {};

export class World {
  constructor(building) {
    this.building = building;
    const pg = merge(building.physics.map((g) => stripToPosition(g)));
    this.bvh = new MeshBVH(pg, { maxLeafTris: 8 });
    const sg = merge(building.sensors.map((g) => stripToPosition(g)));
    this.sensorBVH = new MeshBVH(sg, { maxLeafTris: 8 });
    this.sensorGeometry = sg;
    this.elevators = [];
    this.dynamic = [];     // extra blockers: () => [[x0,y0,x1,y1,z0,z1], ...] (plan coords)
  }

  /** Highest walkable surface below (x, y) starting at height z (plan coords). */
  groundAt(x, y, z, maxDrop = 50) {
    _ray.origin.set(x, z, -y);
    _ray.direction.copy(_down);
    const h = this.bvh.raycastFirst(_ray, THREE.DoubleSide);
    let g = h && h.distance <= maxDrop ? z - h.distance : -Infinity;
    for (const e of this.elevators) {
      if (e.floorContains(x, y) && e.z <= z + 0.01 && e.z > g) g = e.z;
    }
    return g;
  }

  /** Push a vertical capsule (sampled with spheres) out of static + dynamic geometry. */
  resolve(pos, radius, zLow, zHigh) {
    // pos: plan {x,y,z(feet)}
    const n = Math.max(2, Math.ceil((zHigh - zLow) / radius));
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (let k = 0; k < n; k++) {
        const zc = pos.z + zLow + ((zHigh - zLow) * k) / (n - 1);
        _v.set(pos.x, zc, -pos.y);
        const r = this.bvh.closestPointToPoint(_v, _hit, 0, radius);
        if (r && r.distance < radius) {
          const d = Math.max(r.distance, 1e-5);
          const nx = (_v.x - r.point.x) / d, nz = (_v.z - r.point.z) / d;
          const hl = Math.hypot(nx, nz); // horizontal share of the contact normal
          if (hl > 0.35) {             // ignore floors / ceilings / stair treads
            const s = Math.min(radius, (radius - r.distance + 1e-4) / hl);
            pos.x += (nx / hl) * s; pos.y -= (nz / hl) * s;
            moved = true;
          }
        }
      }
      // dynamic AABBs
      for (const b of this.dynamicBoxes()) {
        const [x0, y0, x1, y1, z0, z1] = b;
        if (pos.z + zHigh < z0 || pos.z + zLow > z1) continue;
        const cx = Math.max(x0, Math.min(pos.x, x1)), cy = Math.max(y0, Math.min(pos.y, y1));
        const dx = pos.x - cx, dy = pos.y - cy, d = Math.hypot(dx, dy);
        if (d < radius) {
          if (d > 1e-5) { pos.x += (dx / d) * (radius - d); pos.y += (dy / d) * (radius - d); }
          else { // centre inside the box: push out along the smallest axis
            const opts = [[x0 - radius - pos.x, 0], [x1 + radius - pos.x, 0], [0, y0 - radius - pos.y], [0, y1 + radius - pos.y]];
            opts.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
            pos.x += opts[0][0]; pos.y += opts[0][1];
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  dynamicBoxes() {
    const out = [];
    for (const e of this.elevators) out.push(...e.blockers());
    for (const f of this.dynamic) out.push(...f());
    return out;
  }

  /** Sensor raycast in world (three) coordinates. Returns distance or Infinity. */
  raycast(origin, dir, maxRange) {
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const h = this.sensorBVH.raycastFirst(_ray, THREE.DoubleSide);
    let d = h && h.distance <= maxRange ? h.distance : Infinity;
    // elevator cars are dynamic: test their AABBs
    for (const b of this.dynamicBoxes()) {
      const t = rayBox(origin, dir, b);
      if (t < d) d = t;
    }
    return d;
  }
}

function rayBox(o, d, [x0, y0, x1, y1, z0, z1]) {
  // convert plan box to three AABB: X=x, Y=z, Z=-y
  const min = [x0, z0, -y1], max = [x1, z1, -y0];
  const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  let tmin = 0, tmax = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-9) { if (oo[i] < min[i] || oo[i] > max[i]) return Infinity; continue; }
    let t1 = (min[i] - oo[i]) / dd[i], t2 = (max[i] - oo[i]) / dd[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin > 0 ? tmin : Infinity;
}

function stripToPosition(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.getAttribute('position'));
  return out;
}

/**
 * Kinematic body on the collision world (used by the walker and robots).
 * pos: plan coords {x, y, z=feet}. Velocity is commanded in plan coords.
 */
export class Body {
  constructor(world, { radius = 0.3, height = 1.7, step = 0.35, zLow = null } = {}) {
    this.world = world;
    this.radius = radius; this.height = height; this.step = step;
    this.zLow = zLow ?? step + radius + 0.02; // lowest sphere clears the step height
    this.pos = { x: 0, y: 0, z: 0 };
    this.vz = 0;
    this.onGround = false;
    this.ride = null; // elevator currently standing in
  }

  place(x, y, z) {
    this.pos.x = x; this.pos.y = y;
    const g = this.world.groundAt(x, y, z + 1.0, 3);
    this.pos.z = Number.isFinite(g) ? g : z;
    this.vz = 0;
  }

  move(dx, dy, dt, { gravity = true } = {}) {
    const p = this.pos;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / (this.radius * 0.5)));
    for (let i = 0; i < steps; i++) {
      p.x += dx / steps; p.y += dy / steps;
      this.world.resolve(p, this.radius, this.zLow, Math.max(this.zLow, this.height - this.radius));
      this.settle(dt / steps, gravity);
    }
    if (!steps) this.settle(dt, gravity);
    // ride along with elevator cars
    this.ride = null;
    for (const e of this.world.elevators) if (e.contains(p.x, p.y, -0.02) && Math.abs(p.z - e.z) < 0.15) { this.ride = e; p.z = e.z; }
  }

  settle(dt, gravity) {
    const p = this.pos;
    const g = this.world.groundAt(p.x, p.y, p.z + this.step + 0.02, 60);
    if (!Number.isFinite(g)) { this.onGround = false; return; }
    if (p.z - g <= 0.06 || (this.onGround && p.z - g <= this.step)) {
      p.z = g; this.vz = 0; this.onGround = true;
    } else if (gravity) {
      this.vz -= 9.81 * dt;
      p.z = Math.max(g, p.z + this.vz * dt);
      this.onGround = p.z === g;
      if (this.onGround) this.vz = 0;
    }
  }
}
