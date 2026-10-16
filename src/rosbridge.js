// Minimal rosbridge v2 client (JSON over WebSocket) — no extra dependency.
// Run on the ROS side:  ros2 launch rosbridge_server rosbridge_websocket_launch.xml
// Topics (per robot namespace /<robot_id>):
//   pub  scan (sensor_msgs/LaserScan), odom (nav_msgs/Odometry), tf (tf2_msgs/TFMessage),
//        map (nav_msgs/OccupancyGrid, SLAM, every 5 s), pose_truth (geometry_msgs/PoseStamped)
//   sub  cmd_vel (geometry_msgs/Twist), goal_pose (geometry_msgs/PoseStamped),
//        /sim/elevator (std_msgs/String, e.g. "EV1:5F")

export class RosBridge {
  constructor(sim) {
    this.sim = sim; this.ws = null; this.connected = false; this.ros2 = true;
    this.advertised = new Set(); this.subs = new Set();
    this.mapT = 0; this.odomT = 0;
    this.onstatus = () => {};
  }

  connect(url) {
    this.disconnect();
    try { this.ws = new WebSocket(url); } catch (e) { this.onstatus(`오류: ${e.message}`); return; }
    this.ws.onopen = () => { this.connected = true; this.advertised.clear(); this.subs.clear(); this.onstatus('연결됨'); this.ensureTopics(); };
    this.ws.onclose = () => { this.connected = false; this.onstatus('연결 끊김'); };
    this.ws.onerror = () => this.onstatus('연결 오류 (rosbridge 실행 여부 확인)');
    this.ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
  }

  disconnect() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.ws = null; this.connected = false; }

  send(o) { if (this.connected && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  type(t) { return this.ros2 ? t.replace('/', '/msg/') : t; }

  advertise(topic, type) {
    if (this.advertised.has(topic)) return;
    this.advertised.add(topic);
    this.send({ op: 'advertise', topic, type: this.type(type) });
  }

  subscribe(topic, type) {
    if (this.subs.has(topic)) return;
    this.subs.add(topic);
    this.send({ op: 'subscribe', topic, type: this.type(type) });
  }

  publish(topic, type, msg) { this.advertise(topic, type); this.send({ op: 'publish', topic, msg }); }

  ensureTopics() {
    if (!this.connected) return;
    this.subscribe('/sim/elevator', 'std_msgs/String');
    for (const r of this.sim.robots) {
      this.subscribe(`/${r.id}/cmd_vel`, 'geometry_msgs/Twist');
      this.subscribe(`/${r.id}/goal_pose`, 'geometry_msgs/PoseStamped');
    }
  }

  onMessage(m) {
    if (m.op !== 'publish') return;
    if (m.topic === '/sim/elevator') {
      const [id, lv] = String(m.msg.data).split(':');
      this.sim.elevators.find((e) => e.id === id)?.call(lv);
      return;
    }
    const [, rid, name] = m.topic.split('/');
    const r = this.sim.robots.find((q) => q.id === rid);
    if (!r) return;
    if (name === 'cmd_vel') { r.cancel(); r.setCmd(m.msg.linear.x, m.msg.angular.z, 0.5); }
    if (name === 'goal_pose') {
      const p = m.msg.pose.position;
      const level = m.msg.header?.frame_id?.startsWith('map_') ? m.msg.header.frame_id.slice(4) : r.level.id;
      r.goTo(level, p.x, p.y);
    }
  }

  stamp() {
    const t = performance.now() / 1000 + this.sim.epoch;
    const sec = Math.floor(t), ns = Math.floor((t - sec) * 1e9);
    return this.ros2 ? { sec, nanosec: ns } : { secs: sec, nsecs: ns };
  }

  header(frame) { return this.ros2 ? { stamp: this.stamp(), frame_id: frame } : { seq: 0, stamp: this.stamp(), frame_id: frame }; }

  /** Called on every robot scan. */
  onScan(r) {
    if (!this.connected) return;
    const ns = `/${r.id}`, s = r.lastScan;
    this.publish(`${ns}/scan`, 'sensor_msgs/LaserScan', {
      header: this.header(`${r.id}/laser`), angle_min: s.angleMin, angle_max: s.angleMin + s.angleInc * (s.ranges.length - 1),
      angle_increment: s.angleInc, time_increment: 0, scan_time: 1 / r.scanRate, range_min: 0.1, range_max: s.rangeMax,
      ranges: Array.from(s.ranges, (v) => (Number.isFinite(v) ? +v.toFixed(4) : s.rangeMax + 1)), intensities: [],
    });
    const q = (yaw) => ({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });
    const o = r.odom;
    this.publish(`${ns}/odom`, 'nav_msgs/Odometry', {
      header: this.header(`${r.id}/odom`), child_frame_id: `${r.id}/base_link`,
      pose: { pose: { position: { x: o.x, y: o.y, z: 0 }, orientation: q(o.yaw) }, covariance: new Array(36).fill(0) },
      twist: { twist: { linear: { x: r.speed?.v || 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: r.speed?.w || 0 } }, covariance: new Array(36).fill(0) },
    });
    const est = r.slam.est || o;
    // map->odom so that map->base_link equals the SLAM estimate
    const dyaw = est.yaw - o.yaw, c = Math.cos(dyaw), sn = Math.sin(dyaw);
    const tx = est.x - (c * o.x - sn * o.y), ty = est.y - (sn * o.x + c * o.y);
    const tf = (parent, child, x, y, z, yaw) => ({ header: this.header(parent), child_frame_id: child, transform: { translation: { x, y, z }, rotation: q(yaw) } });
    this.publish('/tf', 'tf2_msgs/TFMessage', { transforms: [
      tf(`map_${r.level.id}`, `${r.id}/odom`, tx, ty, r.level.elevation, dyaw),
      tf(`${r.id}/odom`, `${r.id}/base_link`, o.x, o.y, 0, o.yaw),
      tf(`${r.id}/base_link`, `${r.id}/laser`, 0.08, 0, r.lidar.height, 0),
    ] });
    const p = r.body.pos;
    this.publish(`${ns}/pose_truth`, 'geometry_msgs/PoseStamped', { header: this.header('world'), pose: { position: { x: p.x, y: p.y, z: p.z }, orientation: q(r.yaw) } });
    const now = performance.now();
    if (now - this.mapT > 5000) {
      this.mapT = now;
      const sl = r.slam, lv = r.level.id;
      this.publish(`${ns}/map`, 'nav_msgs/OccupancyGrid', {
        header: this.header(`map_${lv}`),
        info: { map_load_time: this.stamp(), resolution: sl.res, width: sl.nx, height: sl.ny, origin: { position: { x: sl.x0, y: sl.y0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
        data: sl.occupancyData(lv),
      });
    }
  }
}
