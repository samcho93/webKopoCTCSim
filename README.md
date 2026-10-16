# webKopoCTCSim — 분당융합기술교육원 3D 디지털 트윈 & 로봇 시뮬레이션

한국폴리텍대학 분당융합기술교육원 건물(지하 1층 ~ 지상 8층)을 **실내 평면도 PDF에서 자동 추출한 형상**으로 3D 모델링하고,
웹 브라우저에서 외관·층별 단면·1인칭 워크스루로 구석구석 둘러볼 수 있게 만든 프로젝트입니다.
이동로봇(AMR)·4족 보행 로봇이 LiDAR/SLAM/경로계획/엘리베이터·계단 층간 이동을 수행하는 **로봇 시뮬레이션 공간**으로 쓰도록 설계했습니다.

**데모:** https://samcho93.github.io/webKopoCTCSim/

## 주요 기능

| 구분 | 내용 |
|---|---|
| 건물 모델 | B1–8F 9개 층: 구조벽·기둥·코어, 칸막이/유리벽, 고정가구(책상·실험대·수납장), 커튼월(SE 곡면 유리 포함), 창호, 슬래브, 천장(텍스 + LED 조명), 계단 2개소(실제 단 높이 디딤판 + 난간), 엘리베이터 2대(승강로·카·승강장 도어), 옥상정원, 외부 가로(보도·가로수·인접 건물), 사인물 |
| 보기 | 외관 / 층 단면(선택 층 이하 표시) / 단일 층 / 1인칭 워크(WASD, 충돌, 계단 오르내리기, 엘리베이터 탑승) · 실명 라벨 · 공간 목록 이동 |
| 로봇 | 차동구동 AMR(2D LiDAR 360빔) · 4족 보행 로봇(16채널 3D LiDAR, 계단 보행) · 텔레옵(IJKL) · 클릭/실명 목적지 지정 · 로봇 시점 카메라 · 추적 카메라 |
| 내비게이션 | 층별 점유격자 + 장애물 팽창 + A* · **다층 경로**: AMR은 엘리베이터 호출→탑승→목적층 하차, 4족 로봇은 계단 이용 |
| SLAM | 오도메트리 노이즈 + 상관 스캔매칭 + log-odds 점유격자 (층별 맵), 추정 오차 표시, PGM/YAML 내보내기 |
| ROS 연동 | rosbridge(v2 JSON) 클라이언트 내장: `scan`, `odom`, `tf`, `map`, `pose_truth` 발행 / `cmd_vel`, `goal_pose`, `/sim/elevator` 구독 (ROS 2/ROS 1 형식 선택) |
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
* 층 높이(층고)는 도면 천장고(C.H)를 바탕으로 가정: B1 4.0 m, 1F 4.5 m, 2F~8F 3.6 m.

### 좌표계

* 평면: `x` = 그리드 ①→⑤ (동), `y` = Ⓐ→Ⓓ (북), `z` = 위. 단위 m.
* three.js: `X = x`, `Y = z`, `Z = -y`.
* ROS(REP-103) 메시지는 평면 좌표 그대로 사용하며, 층별 맵 프레임은 `map_<층ID>` (예: `map_3F`) 입니다.

## ROS 연동 예

```bash
# ROS 2 쪽
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
# 웹 화면: ROS 연동 → ws://localhost:9090 연결
ros2 topic echo /amr_1/scan
ros2 topic pub /amr_1/cmd_vel geometry_msgs/msg/Twist "{linear: {x: 0.3}, angular: {z: 0.2}}"
ros2 topic pub --once /amr_1/goal_pose geometry_msgs/msg/PoseStamped "{header: {frame_id: map_3F}, pose: {position: {x: 24.3, y: 3.4}}}"
ros2 topic pub --once /sim/elevator std_msgs/msg/String "{data: 'EV1:5F'}"
```

## 스크립팅 API (`window.sim`)

```js
const r = sim.spawn('quadruped', '1F', 9.5, 8.0, 0);   // 로봇 생성 (종류, 층, x, y, yaw)
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
src/robots.js                 AMR / 4족 로봇 모델·주행·태스크 실행기
src/rosbridge.js              rosbridge v2 클라이언트
src/main.js                   씬·조명·UI·미니맵·로봇 카메라·내보내기
```

## 한계 및 향후 과제

* 도면은 인테리어 평면도라 입면/창호 상세가 없어 창 높이·외장 재료는 현장 사진을 참고한 근사입니다.
* 문짝은 개구부로만 표현(열린 상태). 일부 협소 공간(여자화장실 부스 등)은 로봇 경로계획에서 도달 불가로 남아 있습니다(110개 실 중 95개 도달).
* 계단은 2개소(계단실 #1: B1–7F, #2: 1F–8F)를 동일 형식(U자형)으로 생성했으며 1F/B1의 실제 진입 방향과는 차이가 있습니다. B1–1F 보조계단(#3)은 미구현.
* 의자 등 이동 가구, 실험 장비 상세, 조명의 실제 광원 계산(GI/AO)은 차기 단계.
* 향후: Gazebo/Isaac Sim용 SDF/USD 내보내기, URDF 로봇 로딩, 다중 로봇 교통 관리, 동적 장애물(보행자), 문 개폐 시뮬레이션.
