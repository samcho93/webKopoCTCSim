# webKopoCTCSim — 분당융합기술교육원 3D 디지털 트윈 & 로봇 시뮬레이션

한국폴리텍대학 분당융합기술교육원 건물(지하 1층 ~ 지상 8층)을 **실내 평면도 PDF에서 자동 추출한 형상**으로 3D 모델링하고,
웹 브라우저에서 외관·층별 단면·1인칭 워크스루로 구석구석 둘러볼 수 있게 만든 프로젝트입니다.
이동로봇(AMR)·4족 보행 로봇이 LiDAR/SLAM/경로계획/엘리베이터·계단 층간 이동을 수행하는 **로봇 시뮬레이션 공간**으로 쓰도록 설계했습니다.

**데모:** https://samcho93.github.io/webKopoCTCSim/

## 주요 기능

| 구분 | 내용 |
|---|---|
| 건물 모델 | B1–8F 9개 층: 구조벽·기둥·코어, 칸막이/유리벽, 고정가구(책상·실험대·수납장), 커튼월(SE 곡면 유리 포함), 창호, 슬래브, 천장(텍스 + LED 조명), 계단 2개소(실제 단 높이 디딤판 + 난간), 엘리베이터 2대(승강로·카·승강장 도어), 옥상정원, 외부 가로(보도·가로수·인접 건물), 사인물 |
| 보기 | 외관 / 층 단면(선택 층 이하 표시) / 단일 층 / 1인칭 워크(클릭한 곳으로 이동, 드래그·방향키 회전, 충돌, 계단, 엘리베이터 탑승) · 실명 라벨 · 공간 목록 이동 |
| 로봇 | **TIKI-mini** 이동로봇(차동구동, RPLIDAR, 카메라 · 엘리베이터 이용) · **Unitree Go2** 4족 보행 로봇(12 DoF, L1 LiDAR · 계단 보행) — 두 로봇 모두 각 저장소의 **URDF + 메시**를 그대로 로드 · 텔레옵(IJKL) · 클릭/실명 목적지 지정 · 로봇 시점 카메라 · 추적 카메라 |
| 내비게이션 | 층별 점유격자 + 장애물 팽창 + A* · **다층 경로**: AMR은 엘리베이터 호출→탑승→목적층 하차, 4족 로봇은 계단 이용 |
| SLAM | 오도메트리 노이즈 + 상관 스캔매칭 + log-odds 점유격자 (층별 맵), 추정 오차 표시, PGM/YAML 내보내기 |
| ROS 2 연동 | **TIKI-mini**: studyTIKI의 `tiki_ros` 드라이버(backend=websim)가 그대로 이 건물 속 TIKI를 구동 (`/cmd_vel`, `/odom`, `/scan`, `/imu/data`, `/image_raw`, `/joint_states`, TF) · **Go2/공통**: rosbridge v2 — `scan`, `odom`, `tf`, `joint_states`(URDF 관절명), `map`, `pose_truth` 발행 / `cmd_vel`, `goal_pose`, `/sim/elevator` 구독 |
| 내보내기 | 건물 GLB(Gazebo/Isaac Sim/Blender 등), `building.json`, 층별 정답 맵(ROS map_server PGM+YAML), SLAM 맵 |
| 시뮬레이션 | 고정 스텝(60 Hz) 물리, 배속(×0~×16), 백그라운드 탭에서도 계속 실행, `window.sim` 스크립팅 API |

## 실행

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ (정적 배포)
```

`main` 브랜치에 push하면 GitHub Actions가 빌드해 GitHub Pages로 배포합니다 (`.github/workflows/deploy.yml`).

## 도면 → 3D 파이프라인

`tools/extract_floorplans.py` 가 평면도 PDF(벡터)를 읽어 `public/data/` 를 생성합니다.

```bash
pip install pymupdf numpy scipy pillow
python tools/extract_floorplans.py "<평면도.pdf>" public/data
```

* PDF는 저작권/보안상 저장소에 포함하지 않습니다(`.gitignore`). 생성 결과물(`building.json`, `maps/`)만 포함됩니다.
* 도면 선 두께가 요소 종류를 나타내는 점을 이용합니다: 0.72pt = 구조벽/기둥, 0.60pt = 칸막이·유리, 0.48pt = 고정가구.
* 축척은 기둥 그리드 버블(①~⑤, Ⓐ~Ⓓ)로 보정(27.88 pt/m)하며, 원점은 **그리드 ①–Ⓐ 교점**입니다.
* 5 cm 격자로 래스터화 → 형태학적 정리 → 평행선 짝이 없는 단선(OA 바닥 경사로·마감 경계 등)은 벽에서 제외 → 그리디 사각형 병합으로 박스 생성.
* 도면 이후 리모델링은 `tools/extract_floorplans.py`의 `EDITS`(벽·가구 제거, 벽 추가, 실명 변경, 책상·장비 배치, 다른 방 가구 배치 복사 `copy`)로 반영합니다. 예: 3F 307 준비실을 308 실습실 #2에 통합 — 칸막이·307 가구 제거, 307 출입문은 앞문으로 유지, 308 출입문은 벽으로 막고 308 뒤쪽(동쪽 끝)에 새 뒷문.
* 층 높이(층고)는 도면 천장고(C.H)를 바탕으로 가정: B1 4.0 m, 1F 4.5 m, 2F~8F 3.6 m.

### 좌표계

* 평면: `x` = 그리드 ①→⑤ (동), `y` = Ⓐ→Ⓓ (북), `z` = 위. 단위 m.
* three.js: `X = x`, `Y = z`, `Z = -y`.
* ROS(REP-103) 메시지는 평면 좌표 그대로 사용하며, 층별 맵 프레임은 `map_<층ID>` (예: `map_3F`) 입니다.

## 전시 · 장비 (building.json `equipment`, 추출기 `EDITS`로 배치)

| 위치 | 내용 | 동작 |
|---|---|---|
| 1F 주차장 (첫 번째 주차칸) | **기아 카니발** 주차 — 실제 제원(5155 × 1995 × 1775 mm, 휠베이스 3090)으로 만든 절차적 모델, 진한 회색, 번호판 177하 4649 (`src/parkedCar.js`) | 전시용(내비게이션 지도에는 장애물로 반영) |
| 3F 306 실습실 #1 (모든 책상 16개) | **Seeed reBot Arm B601-DM** 책상마다 1대 — [studyReBotDevArm](https://github.com/samcho93/studyReBotDevArm) URDF/메시를 `tools/build_arm.py`로 경량화(43만→3.9만 삼각형, `public/equipment/rebot`, CERN-OHL-W-2.0) | 계속 자유 동작: 관절 공간 랜덤 목표, 경로 전체가 책상 위·자기 책상 반경 0.62 m 안인지 검사, 이웃 팔과 0.2 m 이내로 다가가면 되돌아감 (`src/deskArms.js`) |
| 3F 305 프로젝트실 #4 (복도쪽 벽) | **M400 로봇 카페** — [samcho93/cafesim](https://github.com/samcho93/cafesim) 시뮬레이터 그대로 (`src/vendor/cafesim`) | 커피머신·제빙기·컵 디스펜서·결제 단말 프로토콜 + UR5e(studyUR) 컵 이동: 컵 → 얼음 → 추출 → 픽업 테이블. 45초마다 자동 주문, 카페 클릭 = 주문 |
| 8F 805 의생물공정실습실 | 실험대 15개(3×5) + **Agilent 1260 HPLC** ([studyHPLC1260](https://github.com/samcho93/studyHPLC1260) URDF·재질) | 클릭(또는 1인칭으로 다가가면) 실물 모델로 전환 → 모듈 앞 덮개·MCT 문 열기(내부 보임), 퍼지/주입 밸브, 니들 주입 동작 |
| 3F 301 프로젝트실 #1 | 책상 제거 후 **Go2** 전시 10대 (2×5) | 클릭하면 제자리 걷기 5회 후 정지 (전시용, 시뮬 로봇 아님) |
| 3F 308 실습실 #2 | 기존 책상(0.75×2.05 m)을 가로 4 × 세로 3으로 배치(도면과 같은 방향, 열 간격 1.55 m) + 책상마다 **TIKI-mini** 2대 (24대), 그 사이 책상 가운데에 **SO-ARM101** 1대 (12대) — [studySO-ARM101](https://github.com/samcho93/studySO-ARM101) 메시 번들을 `tools/build_arm.py`로 변환(`public/equipment/so101`, 메시 TheRobotStudio/SO-ARM100 Apache-2.0) | TIKI-mini는 전시용. SO-ARM101은 계속 자유 동작 — 책상 폭 안(±0.34 m)·TIKI-mini 쪽으로 ±0.25 m 이내, 책상 위로만 움직임 (`src/deskArms.js`) |
| 3F 305 프로젝트실 #4 (넓은 테이블) | **AUREN-PRO**·**AUREN M** 실동작 커피머신 — [AurenSim](https://github.com/samcho93/aurensim) (`src/vendor/aurensim`, 펌웨어 `public/equipment/auren`) | 머신 클릭 = 펌웨어 부팅. AUREN-PRO: ESP32-P4/S3 WASM 펌웨어 + 물리 모델, 그룹 버튼·LCD 터치·스팀 노브·컵/포터필터 클릭. AUREN M: STM32F103 에뮬레이터(BellaOneMC.elf) — 전원 ON 후 설정 메뉴에서 Water Heating=Heater On을 자동 설정, 예열 후 추출 버튼(①/②)으로 추출. AUREN-PRO는 SharedArrayBuffer가 필요해 `coi-serviceworker`로 COOP/COEP를 켭니다 |
| 3F 302 · 303 | **교수연구실**로 변경, 304호와 같은 가구 배치(ㄱ자 책상 + PIN-UP 칸막이, 회의 테이블, 창측 수납) — 303은 출입문 쪽을 피해 좌우 대칭 | — |

장비·책상은 점유 격자(로봇 경로계획·ROS 맵)에도 반영됩니다.

## 로봇 모델 (URDF)

| 시뮬 로봇 | 출처 | 파일 |
|---|---|---|
| TIKI-mini (이동로봇) | [samcho93/studyTIKI](https://github.com/samcho93/studyTIKI) `ros2_ws/src/tiki_description` | `public/robots/tiki_mini/tiki_mini.urdf` + CAD STL |
| Go2 (4족) | [samcho93/studyGo2](https://github.com/samcho93/studyGo2) `assets/urdf/go2` (unitree_ros go2_description, BSD-3) | `public/robots/go2/go2_description.urdf` + GLB |

치수·속도·센서 위치는 위 패키지 값(바퀴 반지름 0.0325 m, 간격 0.1924 m, 175 rpm, `laser_joint` 등 / Go2 관절 길이 0.213 m)을 `src/robots.js` PRESETS에 옮겼습니다.
TIKI 바퀴 관절, Go2 12개 관절(`FL_hip_joint` …)은 시뮬레이션 중 URDF 관절값으로 구동되어 `joint_states`로 그대로 발행됩니다.

## ROS 2 연동

### TIKI-mini — studyTIKI 드라이버 그대로 사용

```bash
# studyTIKI의 ros2_ws를 빌드한 PC에서 (드라이버가 ws://127.0.0.1:8765 서버를 엽니다)
ros2 launch tiki_ros sim_bridge.launch.py
# 웹 화면: ROS 2 연동 → [TIKI 드라이버 연결]  (선택된 TIKI-mini가 연결됨)
ros2 topic pub /cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.15}, angular: {z: 0.3}}"
ros2 launch tiki_ros slam.launch.py      # slam_toolbox / Nav2도 동일하게 동작
```

`tiki-sim` 파이썬 패키지(`python -m tiki.run my_code.py`)도 같은 방법으로 이 건물 속 TIKI를 제어합니다
(프로토콜: studyTIKI `docs/PROTOCOL.md` — `call`·`lidar`·`capture`·`status`·`reset`). 정지 버튼은 `estop`을 보내 드라이버를 멈춥니다.

### Go2 · 공통 — rosbridge

```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
# 웹 화면: ws://localhost:9090 연결
ros2 run robot_state_publisher robot_state_publisher --ros-args   -p robot_description:="$(cat go2_description.urdf)" -p frame_prefix:=go2_2/ -r joint_states:=/go2_2/joint_states
ros2 topic pub /go2_2/cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.3}, angular: {z: 0.2}}"
ros2 topic pub --once /go2_2/goal_pose geometry_msgs/msg/PoseStamped "{header: {frame_id: map_3F}, pose: {position: {x: 24.3, y: 3.4}}}"
ros2 topic pub --once /sim/elevator std_msgs/msg/String "{data: 'EV1:5F'}"
```

로봇 ID(`tiki_1`, `go2_2` …)가 네임스페이스·TF 접두어입니다. TF: `map_<층>` → `<id>/odom` → `<id>/base`(Go2) 또는 `<id>/base_footprint`(TIKI).

## 스크립팅 API (`window.sim`)

```js
const r = sim.spawn('go2', '1F', 9.5, 8.0, 0);         // 'go2' | 'tiki' (종류, 층, x, y, yaw)
r.goTo('3F', 11.9, 13.5);                               // 다층 경로 주행 (계단 이용)
sim.callElevator('EV2', '5F');
sim.setMode('cutaway', '3F');                            // exterior | cutaway | single | walk
sim.timeScale = 8;                                       // 배속
r.lastScan; r.slam.exportPGM('3F');                       // 센서/맵 데이터
```

## 구조

```
tools/extract_floorplans.py   PDF → building.json + 층별 점유격자(PNG/PGM/YAML)
src/building.js               건물 메시 생성 (벽/유리/창호/가구/슬래브/천장/계단/승강로/외부)
src/elevator.js               엘리베이터 카·도어·호출 로직 (탑승체 동승)
src/physics.js                BVH 충돌 월드, 캐릭터/로봇 바디(경사·계단 처리)
src/sensors.js                2D/3D LiDAR (BVH 레이캐스트)
src/slam.js                   스캔매칭 + 점유격자 SLAM, PGM/OccupancyGrid 출력
src/nav.js                    점유격자 A*, 팽창, 다층 라우터(엘리베이터/계단)
src/robots.js                 TIKI-mini / Go2 사양·주행·태스크 실행기
src/urdfModels.js             URDF 로더 (STL/GLB), Go2 다리 IK
src/tikiLink.js               studyTIKI 시뮬레이터 프로토콜 (tiki_ros websim 드라이버 연결)
public/robots/                로봇 URDF 패키지 (tiki_mini, go2)
src/rosbridge.js              rosbridge v2 클라이언트
src/main.js                   씬·조명·UI·미니맵·로봇 카메라·내보내기
```

## 한계 및 향후 과제

* 도면은 인테리어 평면도라 입면/창호 상세가 없어 창 높이·외장 재료는 현장 사진을 참고한 근사입니다.
* 문짝은 개구부로만 표현(열린 상태). 일부 협소 공간(여자화장실 부스 등)은 로봇 경로계획에서 도달 불가로 남아 있습니다(110개 실 중 95개 도달).
* 계단은 2개소(계단실 #1: B1–7F, #2: 1F–8F)를 동일 형식(U자형)으로 생성했으며 1F/B1의 실제 진입 방향과는 차이가 있습니다. B1–1F 보조계단(#3)은 미구현.
* 의자 등 이동 가구, 실험 장비 상세, 조명의 실제 광원 계산(GI/AO)은 차기 단계.
* 향후: Gazebo/Isaac Sim용 SDF/USD 내보내기, URDF 로봇 로딩, 다중 로봇 교통 관리, 동적 장애물(보행자), 문 개폐 시뮬레이션.
