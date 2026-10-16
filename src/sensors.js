// Ray-cast range sensors against the BVH of the visual building geometry.
import * as THREE from 'three';

const _o = new THREE.Vector3(), _d = new THREE.Vector3();

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** 2D planar LiDAR (e.g. RPLIDAR / SICK TiM style). */
export class Lidar2D {
  constructor(world, { beams = 360, fov = 2 * Math.PI, rangeMin = 0.12, rangeMax = 16, height = 0.3, noise = 0.01, rate = 10 } = {}) {
    Object.assign(this, { world, beams, fov, rangeMin, rangeMax, height, noise, rate });
    this.ranges = new Float32Array(beams);
    this.angleMin = -fov / 2;
    this.angleInc = fov / beams;
    this.t = 0;
  }
  scan(pose) {
    _o.set(pose.x, pose.z + this.height, -pose.y);
    for (let i = 0; i < this.beams; i++) {
      const a = pose.yaw + this.angleMin + i * this.angleInc;
      _d.set(Math.cos(a), 0, -Math.sin(a));
      let r = this.world.raycast(_o, _d, this.rangeMax);
      if (Number.isFinite(r)) r = Math.max(this.rangeMin, r + gauss() * this.noise);
      this.ranges[i] = r;
    }
    return this.ranges;
  }
}

/** Multi-channel 3D LiDAR (e.g. VLP-16 style). Returns xyz points in the sensor frame. */
export class Lidar3D {
  constructor(world, { channels = 16, vfov = [-15, 15], azimuth = 360, rangeMax = 30, height = 0.45, noise = 0.01 } = {}) {
    Object.assign(this, { world, channels, vfov, azimuth, rangeMax, height, noise });
    this.points = new Float32Array(channels * azimuth * 3);
    this.count = 0;
    this.ring2D = new Float32Array(azimuth);
  }
  scan(pose) {
    _o.set(pose.x, pose.z + this.height, -pose.y);
    let n = 0;
    const mid = Math.floor(this.channels / 2);
    for (let c = 0; c < this.channels; c++) {
      const el = THREE.MathUtils.degToRad(this.vfov[0] + ((this.vfov[1] - this.vfov[0]) * c) / (this.channels - 1));
      const ce = Math.cos(el), se = Math.sin(el);
      for (let k = 0; k < this.azimuth; k++) {
        const az = -Math.PI + (2 * Math.PI * k) / this.azimuth;
        const a = pose.yaw + az;
        _d.set(ce * Math.cos(a), se, -ce * Math.sin(a));
        let r = this.world.raycast(_o, _d, this.rangeMax);
        if (c === mid) this.ring2D[k] = r;
        if (!Number.isFinite(r)) continue;
        r += gauss() * this.noise;
        // sensor frame: x forward, y left, z up (REP-103)
        this.points[n++] = r * ce * Math.cos(az);
        this.points[n++] = r * ce * Math.sin(az);
        this.points[n++] = r * se;
      }
    }
    this.count = n / 3;
    return this.points;
  }
}

export { gauss };
