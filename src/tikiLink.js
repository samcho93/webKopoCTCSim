// TIKI-mini driver link — makes a TIKI-mini in this building answer the studyTIKI
// simulator protocol (studyTIKI docs/PROTOCOL.md), so the unchanged ROS 2 package runs against it:
//
//   ros2 launch tiki_ros sim_bridge.launch.py      # tiki_driver backend=websim, opens ws://127.0.0.1:8765
//   (or any PC Python program using `tiki-sim`)    # then press [TIKI 드라이버 연결] here
//
// The driver is the WebSocket *server*; this page is the client. Requests:
//   {"type":"req","id":7,"op":"call","name":"set_motor_power","args":[0,20]} -> {"type":"res","id":7,"ok":true,"result":null}
//   ops: call · capture{w,h} · detect{labels} · lidar · status · movers · scene · reset

const MODE_NAME = ['NONE', 'PWM', 'PID'];
const wrap360 = (d) => ((d % 360) + 360) % 360;

export class TikiLink {
  constructor(sim) {
    this.sim = sim; this.ws = null; this.robot = null; this.calls = 0;
    this.onstatus = () => {};
  }

  get connected() { return !!this.ws && this.ws.readyState === 1; }

  connect(url, robot) {
    this.disconnect();
    this.robot = robot;
    this.onstatus(`연결 중… ${url}`);
    try { this.ws = new WebSocket(url); } catch (e) { this.onstatus(`주소 오류: ${e.message}`); this.ws = null; return; }
    this.ws.onopen = () => {
      const r = this.robot;
      r.link = this;
      r.cancel();
      r.wheel.mode = 0; r.wheel.cmd = [0, 0];
      this.th0 = r.yaw; this.start = { ...r.body.pos, yaw: r.yaw };
      this.leds = Array.from({ length: 8 }, () => [0, 0, 0]); this.oled = []; this.buzzer = 0;
      this.ws.send(JSON.stringify({ type: 'hello', sim: 'webKopoCTCSim (KOPO CTC building)', version: '1.0.0', scene: `kopo_ctc_${r.level.id}`, robot: 'tiki_mini' }));
      this.onstatus(`연결됨 — ${r.name}`);
    };
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === 'busy') { this.onstatus(m.text || '다른 시뮬레이터가 이미 연결됨'); return; }
      if (m.type !== 'req') return;
      let res;
      try { res = { type: 'res', id: m.id, ok: true, result: this.handle(m) ?? null }; } catch (e) { res = { type: 'res', id: m.id, ok: false, error: String(e.message || e) }; }
      this.ws.send(JSON.stringify(res));
      this.calls++;
    };
    this.ws.onclose = () => { this.release(); this.onstatus('연결 안 됨'); };
    this.ws.onerror = () => this.onstatus(`연결 실패 — PC에서 tiki_ros(websim)/tiki-sim을 먼저 실행하세요 (${url})`);
  }

  release() {
    if (this.robot) { this.robot.wheel.cmd = [0, 0]; this.robot.link = null; }
    this.ws = null;
  }

  disconnect() { if (this.ws) { this.ws.onclose = null; this.ws.close(); } this.release(); }

  /** STOP button → driver raises KeyboardInterrupt on the next call. */
  estop() { if (this.connected) this.ws.send(JSON.stringify({ type: 'estop' })); if (this.robot) this.robot.wheel.cmd = [0, 0]; }

  imu() {
    const r = this.robot;
    const heading = wrap360((-(r.yaw - this.th0) * 180) / Math.PI);   // BNO055: clockwise +, 0..360
    return [Math.round(heading * 16) / 16, 0, 0];
  }

  handle(m) {
    const r = this.robot, W = r.wheel;
    switch (m.op) {
      case 'call': return this.call(m.name, m.args || []);
      case 'lidar': return this.lidar();
      case 'capture': return this.sim.captureRobot(r, m.w || 320, m.h || 240);
      case 'detect': return { w: 320, h: 240, dets: [] };
      case 'movers': return [];
      case 'scene': return { scene: `kopo_ctc_${r.level.id}`, robot: 'tiki_mini' };
      case 'reset': r.body.place(this.start.x, this.start.y, this.start.z + 0.2); r.yaw = this.start.yaw; W.cmd = [0, 0]; return true;
      case 'status': {
        const p = r.body.pos;
        return {
          t: this.sim.time, pose: { x: p.x, y: p.y, th: r.yaw }, level: r.level.id, mode: MODE_NAME[W.mode],
          v: r.speed?.v || 0, w: r.speed?.w || 0, rpm: [(W.wl * 60) / (2 * Math.PI), (W.wr * 60) / (2 * Math.PI)], cmd: W.cmd.slice(),
          voltage: 11.8, current: 420, imu: this.imu(), leds: this.leds, oled: this.oled, buzzer: this.buzzer, al: W.al, ar: W.ar, motorPower: true,
        };
      }
      default: throw new Error(`unknown op: ${m.op}`);
    }
  }

  call(name, a) {
    const W = this.robot.wheel;
    switch (name) {
      case 'set_motor_mode': W.mode = Number(a[0]) | 0; if (W.mode === 0) W.cmd = [0, 0]; return null;
      case 'set_motor_power': { const k = Number(a[0]) | 0; if (k !== 0 && k !== 1) throw new Error('motor must be MOTOR_LEFT or MOTOR_RIGHT'); W.cmd[k] = Number(a[1]) || 0; return null; }
      case 'forward': W.cmd = [+a[0], +a[0]]; return null;
      case 'backward': W.cmd = [-a[0], -a[0]]; return null;
      case 'clockwise': W.cmd = [+a[0], -a[0]]; return null;
      case 'counter_clockwise': W.cmd = [-a[0], +a[0]]; return null;
      case 'stop': W.cmd = [0, 0]; return null;
      case 'get_imu': return this.imu();
      case 'get_battery_voltage': return [11.8];
      case 'get_current': return [420];
      case 'set_led_color': this.leds[Number(a[0]) | 0] = [a[1] | 0, a[2] | 0, a[3] | 0]; return null;
      case 'play_buzzer': this.buzzer = Number(a[0]) || 0; return null;
      case 'stop_buzzer': this.buzzer = 0; return null;
      case 'log': this.oled.push(String(a[0]).slice(0, 21)); this.oled = this.oled.slice(-6); return null;
      case 'log_clear': this.oled = []; return null;
      default: throw new Error(`TikiMini.${name} is not supported by this simulator`);
    }
  }

  /** One revolution: 360 ranges (m) indexed by clockwise degree, 0 = front, 0 = no return. */
  lidar() {
    const r = this.robot;
    const pose = r.pose(), lx = r.P.laserX || 0;       // scan from laser_link (behind the axle)
    const s = r.lidar.scan({ ...pose, x: pose.x + Math.cos(pose.yaw) * lx, y: pose.y + Math.sin(pose.yaw) * lx }); // ccw from -pi, 1 deg
    const out = new Array(360);
    for (let k = 0; k < 360; k++) {
      const i = (((180 - k) % 360) + 360) % 360;
      const d = s[i];
      out[k] = Number.isFinite(d) ? +d.toFixed(4) : 0;
    }
    return out;
  }
}
