/**
 * 3D 火车驾驶（移植自 docs/deepseek_html_20261023_b1187b.html）
 *
 * 与原单页的差异：
 * - 世界挂载到视图容器内的 #stage，而不是 document.body，随路由卸载并释放 GPU 资源
 * - 键盘/指针监听改为可注销；keydown 在捕获阶段拦截本游戏按键，避免触发全局导航快捷键
 * - HUD 样式全部收敛在 .train3d-page 下（见 styles.css）
 * - 自动驾驶重写为独立控制器（autopilot.js）：速度规划 + 曲线限速前瞻 +
 *   平滑无级牵引/制动 + 精确停车；纵向物理抽到 physics.js，便于无头仿真测试
 */
import * as THREE from 'three';
import { go } from '../../core/router.js';
import { eventBus } from '../../core/eventBus.js';
import { MAX_SPEED, stepTrain } from './physics.js';
import { TrainAutopilot } from './autopilot.js';

/** 当前挂载实例的清理函数（路由不会调用视图 cleanup，这里自己兜底） */
let activeCleanup = null;

const SHELL_HTML = `
<div class="train3d-page">
  <div id="stage"></div>
  <div id="loading"><div>正在生成世界…</div><div class="bar"><i></i></div></div>

  <div id="hud">
    <h1>🚇 自动驾驶稳定版</h1>
    <div id="speedo">0<span>km/h</span></div>
    <div id="notch-container">
      <div id="notch-text">0</div>
      <div id="notch-track">
        <div class="notch-zone">
          <div class="notch-seg brake-seg" data-notch="-1"></div><div class="notch-seg brake-seg" data-notch="-2"></div>
          <div class="notch-seg brake-seg" data-notch="-3"></div><div class="notch-seg brake-seg" data-notch="-4"></div>
        </div>
        <div class="notch-zone">
          <div class="notch-seg brake-seg" data-notch="-5"></div><div class="notch-seg brake-seg" data-notch="-6"></div>
          <div class="notch-seg brake-seg" data-notch="-7"></div><div class="notch-seg brake-seg" data-notch="-8"></div>
        </div>
        <div class="notch-zone">
          <div class="notch-seg power-seg" data-notch="1"></div><div class="notch-seg power-seg" data-notch="2"></div>
          <div class="notch-seg power-seg" data-notch="3"></div><div class="notch-seg power-seg" data-notch="4"></div>
        </div>
        <div class="notch-zone">
          <div class="notch-seg power-seg" data-notch="5"></div><div class="notch-seg power-seg" data-notch="6"></div>
          <div class="notch-seg power-seg" data-notch="7"></div><div class="notch-seg power-seg" data-notch="8"></div>
        </div>
        <div id="notch-center-line"></div>
        <div id="notch-handle"></div>
      </div>
    </div>
  </div>

  <div id="station-status">准备发车：按 W 推牵引挡</div>
  <div id="cam-mode">📷 第三人称跟随</div>
  <div id="auto-mode">🎮 手动驾驶</div>

  <div id="auto-panel" hidden>
    <div class="auto-head">
      <b>🤖 自动驾驶</b>
      <span id="auto-phase">待命</span>
    </div>
    <div class="auto-grid">
      <div><b id="auto-target-speed">--</b><span>目标 km/h</span></div>
      <div><b id="auto-dist">--</b><span>距停车 m</span></div>
      <div><b id="auto-limit">--</b><span>限速 km/h</span></div>
    </div>
    <div class="auto-next" id="auto-next">下一站 · --</div>
  </div>

  <div id="stop-prompt">
    <h2 id="stop-title">✅ 完美停靠</h2>
    <p id="stop-detail">按 <kbd>空格</kbd> 回中，再按 <kbd>W</kbd> 发车</p>
  </div>

  <div id="help">
    <b>🎛️ 驾驶操作</b><br>
    • <kbd>W</kbd> / <kbd>S</kbd> 点按切一挡 · 长按连发<br>
    • <kbd>空格</kbd> 挡位回中（惰行）<br>
    • <kbd>G</kbd> 切换自动/手动驾驶（自动过弯限速、精准停站）<br>
    • <kbd>C</kbd> 切换第一/第三人称视角<br>
    • <kbd>N</kbd> 切换黑夜/白天<br>
    • <kbd>鼠标拖拽</kbd> 环顾四周 · <kbd>滚轮</kbd> 缩放
  </div>

  <!-- 触屏操作：仅粗指针设备 / 窄屏显示（见 styles.css） -->
  <div id="touch-controls">
    <div class="touch-hint">长按 ＋/－ 调挡 · 拖动画面环顾 · 双指缩放</div>
    <div class="touch-cluster touch-left">
      <button class="touch-btn touch-brake" type="button" data-touch-hold="-1" aria-label="制动减挡">−</button>
      <button class="touch-btn touch-neutral" type="button" data-touch-tap="neutral" aria-label="挡位回中">0</button>
      <button class="touch-btn touch-power" type="button" data-touch-hold="1" aria-label="牵引加挡">＋</button>
    </div>
    <div class="touch-actions">
      <button class="touch-btn touch-mini" id="touch-auto" type="button" data-touch-tap="auto">自动</button>
      <button class="touch-btn touch-mini" id="touch-cam" type="button" data-touch-tap="cam">视角</button>
      <button class="touch-btn touch-mini" id="touch-night" type="button" data-touch-tap="night">昼夜</button>
    </div>
    <button class="touch-btn touch-mini touch-back" type="button" data-touch-tap="back">← 返回</button>
  </div>

  <button class="btn btn-secondary train3d-back" type="button">← 返回游戏大厅</button>
</div>`;

/** 本游戏占用、需要在捕获阶段拦截的按键（否则会触发全局导航快捷键） */
const GAME_KEYS = new Set(['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'Space', 'KeyN', 'KeyC', 'KeyG']);

/**
 * 渲染 3D 火车驾驶视图
 * @param {HTMLElement} container - 视图容器（#view-root）
 * @returns {Function} cleanup
 */
export function renderTrain3d(container) {
  if (typeof activeCleanup === 'function') activeCleanup();
  container.innerHTML = SHELL_HTML;
  const root = container.querySelector('.train3d-page');
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);
  const stage = $('#stage');

  /**
   * 触屏适配：粗指针（手机/平板）或窄窗口都按触屏布局处理。
   * lowPower 同时用于降低渲染开销，避免移动端 GPU 掉帧。
   */
  const touchUi = window.matchMedia('(pointer: coarse)').matches
    || window.matchMedia('(hover: none)').matches
    || window.innerWidth <= 760;
  const lowPower = touchUi || window.innerWidth <= 900;

  /** 统一登记监听，卸载时逐条注销 */
  const teardown = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    teardown.push(() => target.removeEventListener(type, fn, opts));
  };

  on($('.train3d-back'), 'click', () => go('games'));



  /* ============================================================
     0. 常量
     ============================================================ */
  const WATER_LEVEL = 0;
  const STOP_OFFSET = 22.5;          // 停车目标 = 站台中心 + 该偏移（6 节车厢居中）
  const STOP_WINDOW = 10;            // 手动停靠允许偏差
  const FRAME_COUNT = 2400;
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const CAR_SPACING = 9;
  const CAR_COUNT = 6;

  /* 过弯倾摆：按 v²κ/g 计算理论倾角，再乘视觉增益并限幅 */
  const TRAIN_TILT_GAIN = 0.8;
  const TRAIN_MAX_TILT = 0.14;       // rad ≈ 8°
  const TRAIN_TILT_SMOOTH = 4.0;
  const GRAVITY = 9.81;

  /* 挡位连发 */
  const HOLD_DELAY_MS = 350;
  const REPEAT_INTERVAL_MS = 120;

  /* 自动控制 */
  const AUTO_CRUISE = 150 / 3.6;         // 区间目标速度 150 km/h（曲线区自动降速）
  const AUTO_DWELL_TIME = 5.0;           // 站停时间
  const AUTO_PERFECT_DEVIATION = 0.35;   // 完美停靠偏差阈值（米）
  const AUTO_GOOD_DEVIATION = 1.0;       // 良好停靠偏差阈值（米）

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _sunOffset = new THREE.Vector3(130, 220, 90);


  /* ============================================================
     1. 渲染器 / 场景 / 相机
     ============================================================ */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight));
  renderer.setPixelRatio(Math.min(devicePixelRatio, lowPower ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, Math.max(1, stage.clientWidth) / Math.max(1, stage.clientHeight), 0.1, 12000);
  camera.position.set(0, 200, 300);

  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0x9bc4e2) },
      offset: { value: 33 },
      exponent: { value: 0.6 }
    },
    vertexShader: `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
    fragmentShader: `
    uniform vec3 topColor; uniform vec3 bottomColor;
    uniform float offset; uniform float exponent;
    varying vec3 vWorldPosition;
    void main() {
      float h = normalize(vWorldPosition + offset).y;
      gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
    }`,
    side: THREE.BackSide,
    depthWrite: false
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(5000, 32, 15), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  const hemiLight = new THREE.HemisphereLight(0xcfe8ff, 0x3f4f3a, 1.1);
  scene.add(hemiLight);

  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 900;
  const SHADOW_EXTENT = 220;
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  scene.fog = new THREE.FogExp2(0x9bc4e2, 0.00025);

  /* ============================================================
     2. 昼夜
     ============================================================ */
  let isNight = false;
  const stationLights = [];
  const signalLights = [];
  let waterMesh = null;
  let trainGroup = null;
  let headlightSpot = null;
  let cabLight = null;

  function toggleDayNight() {
    isNight = !isNight;
    if (isNight) {
      scene.fog = new THREE.FogExp2(0x1a2538, 0.0008);
      hemiLight.intensity = 0.55; hemiLight.color.setHex(0x8899cc);
      sun.intensity = 0.9; sun.color.setHex(0xccddff);
      skyMat.uniforms.topColor.value.setHex(0x0a1128);
      skyMat.uniforms.bottomColor.value.setHex(0x1a2538);
      if (headlightSpot) headlightSpot.intensity = 320;
      if (cabLight) cabLight.intensity = 18;
      MAT.window.emissiveIntensity = 1.3;
      MAT.headlight.emissiveIntensity = 3.2;
      MAT.taillight.emissiveIntensity = 2.4;
      stationLights.forEach(l => { l.intensity = 35; });
      if (waterMesh) waterMesh.material.color.setHex(0x112233);
    } else {
      scene.fog = new THREE.FogExp2(0x9bc4e2, 0.00025);
      hemiLight.intensity = 1.1; hemiLight.color.setHex(0xcfe8ff);
      sun.intensity = 2.2; sun.color.setHex(0xfff1d6);
      skyMat.uniforms.topColor.value.setHex(0x0077ff);
      skyMat.uniforms.bottomColor.value.setHex(0x9bc4e2);
      if (headlightSpot) headlightSpot.intensity = 0;
      if (cabLight) cabLight.intensity = 0;
      MAT.window.emissiveIntensity = 0.06;
      MAT.headlight.emissiveIntensity = 0.4;
      MAT.taillight.emissiveIntensity = 0.35;
      stationLights.forEach(l => { l.intensity = 0; });
      if (waterMesh) waterMesh.material.color.setHex(0x2980b9);
    }
  }

  /* ============================================================
     3. 地形 / 空间索引
     ============================================================ */
  function getTerrainHeight(x, z) {
    let y = Math.sin(x * 0.002) * 30 + Math.cos(z * 0.003) * 35 + Math.sin((x + z) * 0.005) * 15;
    y += 120;
    const lakeDist = Math.sqrt(x * x + z * z);
    if (lakeDist < 1000) {
      const t = lakeDist / 1000;
      y -= (1 - t * t) * 160;
    }
    return y;
  }

  function makeLookup(points, cellSize) {
    const grid = new Map();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const key = Math.floor(p.x / cellSize) * 4096 + Math.floor(p.z / cellSize);
      let arr = grid.get(key);
      if (!arr) { arr = []; grid.set(key, arr); }
      arr.push(p);
    }
    return { grid, cellSize };
  }

  function queryLookup(lookup, x, z, maxDist) {
    const { grid, cellSize } = lookup;
    const ix = Math.floor(x / cellSize);
    const iz = Math.floor(z / cellSize);
    let bestSq = maxDist * maxDist;
    let best = null;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = grid.get((ix + dx) * 4096 + (iz + dz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const p = arr[i];
          const d = (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z);
          if (d < bestSq) { bestSq = d; best = p; }
        }
      }
    }
    return best ? { dist: Math.sqrt(bestSq), point: best } : null;
  }

  /* ============================================================
     4. 轨道曲线
     ============================================================ */
  const trackControlPoints = [];
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const r = 2200 + Math.sin(angle * 3) * 600;
    trackControlPoints.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
  }

  const trackCurveXZ = new THREE.CatmullRomCurve3(
    trackControlPoints.map(p => new THREE.Vector3(p.x, 0, p.y)),
    true, 'centripetal'
  );

  const rawY = [];
  const N_SAMPLE = 400;
  for (let i = 0; i < N_SAMPLE; i++) {
    const t = i / N_SAMPLE;
    const p = trackCurveXZ.getPointAt(t);
    let y = getTerrainHeight(p.x, p.z);
    if (p.length() < 1100) y = 50;
    rawY.push(y + 2.0);
  }

  const smoothY = [];
  for (let i = 0; i < N_SAMPLE; i++) {
    let sum = 0;
    for (let j = -5; j <= 5; j++) sum += rawY[(i + j + N_SAMPLE) % N_SAMPLE];
    smoothY.push(sum / 11);
  }

  const finalTrackPoints = [];
  const SAMPLE_N = 1200;
  for (let i = 0; i < SAMPLE_N; i++) {
    const t = i / SAMPLE_N;
    const xz = trackCurveXZ.getPointAt(t);
    const yIdx = t * N_SAMPLE;
    const y0 = Math.floor(yIdx) % N_SAMPLE;
    const y1 = (y0 + 1) % N_SAMPLE;
    const fy = yIdx - Math.floor(yIdx);
    const y = smoothY[y0] * (1 - fy) + smoothY[y1] * fy;
    finalTrackPoints.push(new THREE.Vector3(xz.x, y, xz.z));
  }

  const trackCurve = new THREE.CatmullRomCurve3(finalTrackPoints, true, 'centripetal');
  trackCurve.arcLengthDivisions = 4000;
  trackCurve.updateArcLengths();
  const trackLength = trackCurve.getLength();

  const trackLookup = makeLookup(trackCurve.getPoints(1500), 100);

  function getGroundY(x, z, naturalY = getTerrainHeight(x, z)) {
    const hit = queryLookup(trackLookup, x, z, 80);
    if (!hit) return naturalY;
    const flatY = hit.point.y - 1.5;
    const diff = flatY - naturalY;
    const support = 1 - THREE.MathUtils.smoothstep(diff, 25, 65);
    const flatTarget = naturalY + (flatY - naturalY) * support;
    if (hit.dist < 20) return flatTarget;
    const t = THREE.MathUtils.smoothstep(hit.dist, 20, 80);
    return flatTarget * (1 - t) + naturalY * t;
  }

  /* ============================================================
     5. 轨道帧缓存
     ============================================================ */
  const frames = [];
  for (let i = 0; i < FRAME_COUNT; i++) {
    const t = i / FRAME_COUNT;
    frames.push({
      pos: trackCurve.getPointAt(t),
      tan: trackCurve.getTangentAt(t).normalize(),
      curvature: 0
    });
  }
  {
    // 用较长的切线基线求有符号曲率（1/m），避免单帧噪声让车身抖动。
    // 正值表示轨道向 side（车辆左侧）弯曲，车体应使车顶倒向弯心。
    const ds = trackLength / FRAME_COUNT;
    const BASELINE = 5;
    for (let i = 0; i < FRAME_COUNT; i++) {
      const i0 = (i - BASELINE + FRAME_COUNT) % FRAME_COUNT;
      const i1 = (i + BASELINE) % FRAME_COUNT;
      _v1.crossVectors(WORLD_UP, frames[i].tan).normalize();
      _v2.copy(frames[i1].tan).sub(frames[i0].tan);
      frames[i].curvature = _v2.dot(_v1) / (2 * BASELINE * ds);
    }
  }

  /* ---- 曲线限速表：供自动驾驶前瞻减速 ---- */
  const CURVE_LAT_LIMIT = 1.7;       // 允许的横向加速度 m/s²
  const CURVE_LIMIT_STEP = 10;       // 限速表分辨率（米）
  const CURVE_LIMIT_COUNT = Math.ceil(trackLength / CURVE_LIMIT_STEP);
  const curveSpeedLimits = new Float32Array(CURVE_LIMIT_COUNT);
  {
    const raw = new Float32Array(CURVE_LIMIT_COUNT);
    const ds = trackLength / FRAME_COUNT;
    // 用较长的切线基线计算曲率：单帧切线差分会把数值噪声放大成"假急弯"，
    // 导致限速表突降、自动驾驶被迫提前重刹。约 105m 基线兼顾灵敏度和平滑度。
    const CURVE_BASELINE = 8;
    for (let i = 0; i < CURVE_LIMIT_COUNT; i++) {
      const frameIdx = Math.floor(((i * CURVE_LIMIT_STEP) / trackLength) * FRAME_COUNT) % FRAME_COUNT;
      const i0 = (frameIdx - CURVE_BASELINE + FRAME_COUNT) % FRAME_COUNT;
      const i1 = (frameIdx + CURVE_BASELINE) % FRAME_COUNT;
      const dot = Math.min(1, Math.max(-1, frames[i0].tan.dot(frames[i1].tan)));
      const kappa = Math.acos(dot) / (2 * CURVE_BASELINE * ds);
      raw[i] = Math.min(MAX_SPEED, Math.sqrt(CURVE_LAT_LIMIT / Math.max(kappa, 1e-5)));
    }
    // 取邻域最小值，避免单点曲率噪声造成限速跳变
    const SMOOTH = 3;
    for (let i = 0; i < CURVE_LIMIT_COUNT; i++) {
      let min = Infinity;
      for (let offset = -SMOOTH; offset <= SMOOTH; offset++) {
        min = Math.min(min, raw[(i + offset + CURVE_LIMIT_COUNT) % CURVE_LIMIT_COUNT]);
      }
      curveSpeedLimits[i] = Math.max(12, min);
    }
  }

  function curveLimitAt(distance) {
    const wrapped = ((distance % trackLength) + trackLength) % trackLength;
    return curveSpeedLimits[Math.floor(wrapped / CURVE_LIMIT_STEP) % CURVE_LIMIT_COUNT];
  }

  const _carPos = new THREE.Vector3();
  const _carTan = new THREE.Vector3();
  const _carSide = new THREE.Vector3();
  const _carUp = new THREE.Vector3();
  const _carBasis = new THREE.Matrix4();
  const _carQuat = new THREE.Quaternion();
  const _bankQuat = new THREE.Quaternion();
  const _zAxis = new THREE.Vector3(0, 0, 1);

  function getFrameAt(t, outPos, outTan) {
    const f = (((t % 1) + 1) % 1) * FRAME_COUNT;
    const i0 = Math.floor(f) % FRAME_COUNT;
    const i1 = (i0 + 1) % FRAME_COUNT;
    const a = f - Math.floor(f);
    const A = frames[i0], B = frames[i1];
    outPos.copy(A.pos).lerp(B.pos, a);
    outTan.copy(A.tan).lerp(B.tan, a).normalize();
  }

  function getCurvatureAt(t) {
    const f = (((t % 1) + 1) % 1) * FRAME_COUNT;
    const i0 = Math.floor(f) % FRAME_COUNT;
    const i1 = (i0 + 1) % FRAME_COUNT;
    const a = f - Math.floor(f);
    return frames[i0].curvature + (frames[i1].curvature - frames[i0].curvature) * a;
  }

  /* ============================================================
     6. 地面 / 水面
     ============================================================ */
  // 地形顶点在挂载时同步生成，移动端降低细分以免首屏卡顿
  const GROUND_SEG = lowPower ? 320 : 512;
  const groundGeo = new THREE.PlaneGeometry(12000, 12000, GROUND_SEG, GROUND_SEG);
  groundGeo.rotateX(-Math.PI / 2);
  {
    const pos = groundGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const natural = getTerrainHeight(x, z);
      pos.setY(i, getGroundY(x, z, natural));
    }
    groundGeo.computeVertexNormals();
    pos.needsUpdate = true;
  }

  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  {
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < WATER_LEVEL) c.setHex(0xc2b280);
      else if (y < WATER_LEVEL + 15) c.setHex(0xd2b48c);
      else if (y < 70) c.setHex(0x6d9b58);
      else if (y < 100) c.setHex(0x5a7a47);
      else c.setHex(0x8a8a80);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    groundMat.vertexColors = true;
  }
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  scene.add(ground);

  (function createWater() {
    const waterGeo = new THREE.PlaneGeometry(15000, 15000, 1, 1);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2980b9, transparent: true, opacity: 0.85,
      roughness: 0.1, metalness: 0.4,
      depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = WATER_LEVEL;
    waterMesh.renderOrder = 1;
    scene.add(waterMesh);
  })();

  /* ============================================================
     7. 车站
     ============================================================ */
  const stations = [
    { name: '森林站', t: 0.05 },
    { name: '溪谷站', t: 0.17 },
    { name: '高架站', t: 0.29 },
    { name: '雪山站', t: 0.42 },
    { name: '矿场站', t: 0.55 },
    { name: '平原站', t: 0.68 },
    { name: '海岸站', t: 0.81 },
    { name: '终点站', t: 0.93 }
  ];

  function getBasis(tan) {
    const side = new THREE.Vector3().crossVectors(WORLD_UP, tan).normalize();
    const up = new THREE.Vector3().crossVectors(tan, side).normalize();
    return { side, up };
  }

  /* ============================================================
     8. 森林
     ============================================================ */
  (function generateForest() {
    const TREE_COUNT = lowPower ? 1600 : 4000;
    const trunkGeo = new THREE.CylinderGeometry(1, 1.5, 8, 5);
    trunkGeo.translate(0, 4, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
    trunks.receiveShadow = true;

    const crownGeo = new THREE.ConeGeometry(5, 18, 7);
    crownGeo.translate(0, 15, 0);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, flatShading: true });
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, TREE_COUNT);
    crowns.castShadow = true;
    crowns.receiveShadow = true;

    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < TREE_COUNT * 4 && placed < TREE_COUNT; i++) {
      const x = (Math.random() - 0.5) * 9000;
      const z = (Math.random() - 0.5) * 9000;
      const natural = getTerrainHeight(x, z);
      const y = getGroundY(x, z, natural);
      if (y < WATER_LEVEL + 2 || y > 180) continue;
      if (queryLookup(trackLookup, x, z, 50)) continue;

      const scale = 0.6 + Math.random() * 1.5;
      dummy.position.set(x, y, z);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      crowns.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    trunks.count = placed; crowns.count = placed;
    scene.add(trunks, crowns);
  })();

  /* ============================================================
     9. 轨道 / 轨枕 / 桥墩
     ============================================================ */
  const trackGroup = new THREE.Group();
  scene.add(trackGroup);

  (function buildTrack() {
    const N = 1200;
    const offsetDist = 0.75;
    const railW = 0.15;
    const railH = 0.25;

    const bPos = [], bIdx = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const p = trackCurve.getPointAt(t);
      const tan = trackCurve.getTangentAt(t).normalize();
      const { side } = getBasis(tan);
      const topL = p.clone().addScaledVector(side, 1.6); topL.y -= 0.2;
      const topR = p.clone().addScaledVector(side, -1.6); topR.y -= 0.2;
      const botL = p.clone().addScaledVector(side, 2.4); botL.y -= 4.0;
      const botR = p.clone().addScaledVector(side, -2.4); botR.y -= 4.0;
      bPos.push(topL.x, topL.y, topL.z, topR.x, topR.y, topR.z, botL.x, botL.y, botL.z, botR.x, botR.y, botR.z);
    }
    for (let i = 0; i < N; i++) {
      const a = i * 4, b = a + 1, c = a + 2, d = a + 3;
      const na = a + 4, nb = b + 4, nc = c + 4, nd = d + 4;
      bIdx.push(a, b, na, b, nb, na, a, na, c, na, nc, c, b, d, nb, d, nd, nb);
    }
    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
    bGeo.setIndex(bIdx);
    bGeo.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(bGeo, new THREE.MeshStandardMaterial({ color: 0x7c7c72 })));

    const rPos = [], rIdx = [];
    [-offsetDist, offsetDist].forEach((off) => {
      const startIdx = rPos.length / 3;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const p = trackCurve.getPointAt(t);
        const tan = trackCurve.getTangentAt(t).normalize();
        const { side, up } = getBasis(tan);
        const center = p.clone().addScaledVector(side, off);
        const tl = center.clone().addScaledVector(side, railW / 2).addScaledVector(up, railH);
        const tr = center.clone().addScaledVector(side, -railW / 2).addScaledVector(up, railH);
        const bl = center.clone().addScaledVector(side, railW / 2);
        const br = center.clone().addScaledVector(side, -railW / 2);
        rPos.push(tl.x, tl.y, tl.z, tr.x, tr.y, tr.z, bl.x, bl.y, bl.z, br.x, br.y, br.z);
      }
      for (let i = 0; i < N; i++) {
        const base = startIdx + i * 4, next = base + 4;
        rIdx.push(
          base, base + 1, next, base + 1, next + 1, next,
          base, next, base + 2, next, next + 2, base + 2,
          base + 1, base + 3, next + 1, base + 3, next + 3, next + 1
        );
      }
    });
    const rGeo = new THREE.BufferGeometry();
    rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rPos, 3));
    rGeo.setIndex(rIdx);
    rGeo.computeVertexNormals();
    trackGroup.add(new THREE.Mesh(rGeo, new THREE.MeshStandardMaterial({
      color: 0xd0d5db, metalness: 0.9, roughness: 0.2, side: THREE.DoubleSide
    })));

    const count = Math.floor(trackLength / 2.5);
    const sleeperGeo = new THREE.BoxGeometry(3.0, 0.2, 0.6);
    const sleeperMat = new THREE.MeshStandardMaterial({ color: 0x6d4b33 });
    const sleepers = new THREE.InstancedMesh(sleeperGeo, sleeperMat, count);
    sleepers.castShadow = sleepers.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const basis = new THREE.Matrix4();
    const pillarData = [];

    for (let i = 0; i < count; i++) {
      const t = i / count;
      const p = trackCurve.getPointAt(t);
      const tan = trackCurve.getTangentAt(t).normalize();
      const { side, up } = getBasis(tan);
      dummy.position.copy(p).addScaledVector(up, -0.1);
      dummy.quaternion.setFromRotationMatrix(basis.makeBasis(side, up, tan));
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      sleepers.setMatrixAt(i, dummy.matrix);

      if (i % 28 === 0) {
        const naturalY = getTerrainHeight(p.x, p.z);
        const base = Math.max(naturalY, WATER_LEVEL - 12);
        const h = p.y - base - 1.2;
        if (h > 6) pillarData.push({ x: p.x, y: base + h * 0.5, z: p.z, h });
      }
    }
    trackGroup.add(sleepers);

    if (pillarData.length) {
      const pillarGeo = new THREE.BoxGeometry(4.5, 1, 4.5);
      const pillarMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.8 });
      const pillars = new THREE.InstancedMesh(pillarGeo, pillarMat, pillarData.length);
      pillars.castShadow = true;
      pillars.receiveShadow = true;
      for (let i = 0; i < pillarData.length; i++) {
        const d = pillarData[i];
        dummy.position.set(d.x, d.y, d.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, d.h, 1);
        dummy.updateMatrix();
        pillars.setMatrixAt(i, dummy.matrix);
      }
      trackGroup.add(pillars);
    }
  })();

  /* ============================================================
     10. 车站（贴合轨道 + 停车居中）
     ============================================================ */
  const stationPlatformMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 0.9 });
  const stationRoofMat = new THREE.MeshStandardMaterial({ color: 0x2c3e50 });
  const stationPillarMat = new THREE.MeshStandardMaterial({ color: 0x555555 });
  const stationBaseMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8a });
  const stationLineMat = new THREE.MeshBasicMaterial({ color: 0xffcc00 });

  const PLATFORM_INNER = 1.75;
  const PLATFORM_W = 9;
  const PLATFORM_L = 90;
  const PLATFORM_CX = PLATFORM_INNER + PLATFORM_W / 2;
  const PLATFORM_TOP = 0.35;
  const PLATFORM_H = 1.8;

  function buildStation(station) {
    const t = station.t;
    const p = trackCurve.getPointAt(t);
    const tan = trackCurve.getTangentAt(t).normalize();
    const { side, up } = getBasis(tan);
    const group = new THREE.Group();
    group.position.copy(p);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, tan));

    const px = p.x + side.x * PLATFORM_CX;
    const pz = p.z + side.z * PLATFORM_CX;
    const groundY = Math.max(getGroundY(px, pz), WATER_LEVEL);
    const stationH = p.y - groundY;

    if (stationH > 3) {
      const baseTop = PLATFORM_TOP - PLATFORM_H;
      const baseBottom = -stationH;
      const baseH = baseTop - baseBottom;
      if (baseH > 2) {
        const base = new THREE.Mesh(
          new THREE.BoxGeometry(PLATFORM_W * 0.7, baseH, PLATFORM_L * 0.92),
          stationBaseMat
        );
        base.position.set(PLATFORM_CX, (baseTop + baseBottom) / 2, 0);
        base.castShadow = true;
        group.add(base);
      }
    }

    const platform = new THREE.Mesh(
      new THREE.BoxGeometry(PLATFORM_W, PLATFORM_H, PLATFORM_L),
      stationPlatformMat
    );
    platform.position.set(PLATFORM_CX, PLATFORM_TOP - PLATFORM_H / 2, 0);
    platform.castShadow = true;
    platform.receiveShadow = true;
    group.add(platform);

    const line = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.02, PLATFORM_L - 2),
      stationLineMat
    );
    line.position.set(PLATFORM_INNER + 0.5, PLATFORM_TOP + 0.011, 0);
    group.add(line);

    const pillarGeo = new THREE.CylinderGeometry(0.22, 0.22, 7.5, 8);
    for (let z = -PLATFORM_L / 2 + 10; z <= PLATFORM_L / 2 - 10; z += 22) {
      const pillar = new THREE.Mesh(pillarGeo, stationPillarMat);
      pillar.position.set(PLATFORM_CX, PLATFORM_TOP + 3.75, z);
      pillar.castShadow = true;
      group.add(pillar);
    }

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(PLATFORM_W + 1, 0.25, PLATFORM_L + 2),
      stationRoofMat
    );
    roof.position.set(PLATFORM_CX, PLATFORM_TOP + 7.5, 0);
    roof.castShadow = true;
    group.add(roof);

    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1a252f'; ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 50px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(station.name, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 3),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    sign.position.set(PLATFORM_CX, PLATFORM_TOP + 4.2, 0);
    sign.rotation.y = -Math.PI / 2;
    group.add(sign);

    const pointLight = new THREE.PointLight(0xffcc66, 0, 60);
    pointLight.position.set(PLATFORM_CX, PLATFORM_TOP + 6, 0);
    group.add(pointLight);
    stationLights.push(pointLight);

    const signal = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff0000 })
    );
    signal.position.set(-PLATFORM_INNER - 0.8, 4, -PLATFORM_L / 2 - 3);
    group.add(signal);
    signalLights.push(signal);

    scene.add(group);
  }
  stations.forEach(buildStation);

  /* ============================================================
     11. 列车
     ============================================================ */
  const MAT = {
    body: new THREE.MeshStandardMaterial({ color: 0xe9eef2, roughness: 0.38, metalness: 0.2 }),
    bodyShade: new THREE.MeshStandardMaterial({ color: 0xc4cdd4, roughness: 0.52, metalness: 0.15 }),
    stripe: new THREE.MeshStandardMaterial({ color: 0x1d5fa8, roughness: 0.45, metalness: 0.2 }),
    stripeLight: new THREE.MeshStandardMaterial({ color: 0x57b6e8, roughness: 0.35, metalness: 0.25 }),
    window: new THREE.MeshStandardMaterial({
      color: 0x0b1a24, roughness: 0.12, metalness: 0.45,
      emissive: 0xffcc66, emissiveIntensity: 0.06
    }),
    windowFrame: new THREE.MeshStandardMaterial({ color: 0x1b252d, roughness: 0.55, metalness: 0.4 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.16,
      roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide
    }),
    roof: new THREE.MeshStandardMaterial({ color: 0xb5bfc5, roughness: 0.7, metalness: 0.15 }),
    under: new THREE.MeshStandardMaterial({ color: 0x1f252a, roughness: 0.85 }),
    bogie: new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.8, metalness: 0.3 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 }),
    headlight: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 0.5, roughness: 0.2 }),
    taillight: new THREE.MeshStandardMaterial({ color: 0x661111, emissive: 0xff2222, emissiveIntensity: 0.4, roughness: 0.3 }),
    interior: new THREE.MeshStandardMaterial({ color: 0xd6dce1, roughness: 0.85 }),
    consoleMain: new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }),
    consoleOrange: new THREE.MeshStandardMaterial({ color: 0xd35400, roughness: 0.6 }),
    consoleDark: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.75 })
  };

  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.26, 16);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelsArray = [];

  let throttleLever = null;
  let brakeLever = null;
  let needleMesh = null;
  let screenTexture = null;
  let screenCtx = null;

  function makeWheel() {
    const m = new THREE.Mesh(wheelGeo, MAT.wheel);
    m.castShadow = false;
    m.receiveShadow = false;
    wheelsArray.push(m);
    return m;
  }

  /* ---- 车辆模型辅助 ---- */
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const unitPlane = new THREE.PlaneGeometry(1, 1);

  function addBox(parent, w, h, d, x, y, z, material, options = {}) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    if (options.rx) mesh.rotation.x = options.rx;
    if (options.ry) mesh.rotation.y = options.ry;
    if (options.rz) mesh.rotation.z = options.rz;
    mesh.castShadow = options.cast === true;
    mesh.receiveShadow = options.receive === true;
    parent.add(mesh);
    return mesh;
  }

  /** 圆角断面车身（断面在 XY 平面，沿 Z 挤出并居中） */
  function makeRoundedBodyGeometry(width, height, depth, radius) {
    const halfW = width / 2;
    const halfH = height / 2;
    const r = Math.min(radius, halfW, halfH);
    const shape = new THREE.Shape();
    shape.moveTo(-halfW + r, -halfH);
    shape.lineTo(halfW - r, -halfH);
    shape.quadraticCurveTo(halfW, -halfH, halfW, -halfH + r);
    shape.lineTo(halfW, halfH - r);
    shape.quadraticCurveTo(halfW, halfH, halfW - r, halfH);
    shape.lineTo(-halfW + r, halfH);
    shape.quadraticCurveTo(-halfW, halfH, -halfW, halfH - r);
    shape.lineTo(-halfW, -halfH + r);
    shape.quadraticCurveTo(-halfW, -halfH, -halfW + r, -halfH);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSize: 0.035,
      bevelThickness: 0.035,
      bevelSegments: 2,
      curveSegments: 8
    });
    geometry.translate(0, 0, -depth / 2);
    return geometry;
  }

  const bodyGeoLead = makeRoundedBodyGeometry(2.4, 2.55, 6.5, 0.28);
  const bodyGeoTrailer = makeRoundedBodyGeometry(2.4, 2.55, 8.0, 0.28);

  let destinationSignMaterial = null;
  function getDestinationSignMaterial() {
    if (destinationSignMaterial) return destinationSignMaterial;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#04080b';
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 40px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('城市轨道  AUTO', 256, 50);
    const texture = new THREE.CanvasTexture(canvas);
    destinationSignMaterial = new THREE.MeshBasicMaterial({ map: texture });
    return destinationSignMaterial;
  }

  /** 侧窗：外侧深色窗 + （驾驶室）内侧透明窗，利用单面朝向避免互相遮挡 */
  function addWindowPlane(parent, side, z, width, height, y, material, inner = false) {
    const pane = new THREE.Mesh(unitPlane, material);
    pane.scale.set(width, height, 1);
    pane.position.set(side * (inner ? 1.211 : 1.239), y, z);
    pane.rotation.y = (inner ? -side : side) * (Math.PI / 2);
    parent.add(pane);
    return pane;
  }

  function addSideWindow(parent, side, z, width, height, options = {}) {
    const y = options.y ?? 2.14;
    const seeThrough = options.seeThrough === true;
    const frameX = side * 1.226;
    if (seeThrough) {
      addBox(parent, 0.02, 0.05, width + 0.1, frameX, y + height / 2 + 0.03, z, MAT.windowFrame);
      addBox(parent, 0.02, 0.05, width + 0.1, frameX, y - height / 2 - 0.03, z, MAT.windowFrame);
      addBox(parent, 0.02, height + 0.1, 0.05, frameX, y, z - width / 2 - 0.03, MAT.windowFrame);
      addBox(parent, 0.02, height + 0.1, 0.05, frameX, y, z + width / 2 + 0.03, MAT.windowFrame);
    } else {
      addBox(parent, 0.02, height + 0.08, width + 0.08, frameX, y, z, MAT.windowFrame);
    }
    addWindowPlane(parent, side, z, width, height, y, MAT.window);
    if (seeThrough) addWindowPlane(parent, side, z, width, height, y, MAT.glass, true);
  }

  function addPantograph(parent) {
    addBox(parent, 0.9, 0.08, 1.5, 0, 3.02, 0, MAT.dark, { cast: true });
    for (const s of [-1, 1]) {
      addBox(parent, 0.06, 0.95, 0.06, s * 0.32, 3.52, -0.3, MAT.dark, { rx: 0.5, cast: true });
      addBox(parent, 0.06, 0.95, 0.06, s * 0.32, 3.52, 0.3, MAT.dark, { rx: -0.5, cast: true });
    }
    addBox(parent, 1.6, 0.06, 0.16, 0, 3.98, 0, MAT.dark);
    addBox(parent, 1.55, 0.03, 0.06, 0, 4.02, 0, MAT.stripeLight);
  }

  function makeSubwayCar(isLead, carIndex) {
    const g = new THREE.Group();
    const bodyGroup = new THREE.Group();
    const runningGroup = new THREE.Group();
    g.add(bodyGroup, runningGroup);
    g.userData.bodyGroup = bodyGroup;

    const length = isLead ? 6.5 : 8.0;
    const centerZ = isLead ? -0.75 : 0;
    const frontZ = centerZ + length / 2;
    const backZ = centerZ - length / 2;

    /* ---- 圆角车身 / 底架 / 腰线 ---- */
    const body = new THREE.Mesh(isLead ? bodyGeoLead : bodyGeoTrailer, MAT.body);
    body.position.set(0, 1.7, centerZ);
    body.castShadow = true;
    body.receiveShadow = true;
    bodyGroup.add(body);

    addBox(bodyGroup, 2.05, 0.26, length - 0.5, 0, 0.33, centerZ, MAT.under, { cast: true });
    for (const s of [-1, 1]) {
      addBox(bodyGroup, 0.02, 0.26, length - 0.8, s * 1.217, 1.1, centerZ, MAT.stripe);
      addBox(bodyGroup, 0.015, 0.055, length - 0.8, s * 1.224, 1.27, centerZ, MAT.stripeLight);
    }

    /* ---- 侧窗：前部驾驶室为大面积侧窗，其余为乘客窗 ---- */
    const windowZ = isLead ? [-1.2] : [-1.15, 0, 1.15];
    for (const s of [-1, 1]) {
      for (const z of windowZ) addSideWindow(bodyGroup, s, z, 0.78, 0.72);
      if (isLead) addSideWindow(bodyGroup, s, 1.55, 1.05, 0.82, { seeThrough: true });
    }

    /* ---- 车门（带门玻璃和门槛灯） ---- */
    const doorZ = isLead ? [-2.45] : [-2.35, 2.35];
    for (const z of doorZ) {
      for (const s of [-1, 1]) {
        addBox(bodyGroup, 0.05, 2.0, 0.95, s * 1.218, 1.52, z, MAT.bodyShade);
        addBox(bodyGroup, 0.015, 0.26, 0.95, s * 1.258, 1.1, z, MAT.stripe);
        addBox(bodyGroup, 0.025, 0.6, 0.6, s * 1.249, 2.1, z, MAT.window);
        if (!lowPower) {
          addBox(bodyGroup, 0.02, 1.96, 0.045, s * 1.246, 1.52, z, MAT.windowFrame);
          addBox(bodyGroup, 0.03, 0.05, 0.62, s * 1.249, 0.58, z, MAT.stripeLight);
        }
      }
    }

    /* ---- 车头：前脸、挡风、LED 灯箱、前灯、车钩 ---- */
    if (isLead) {
      addBox(bodyGroup, 2.28, 1.05, 0.12, 0, 1.15, frontZ + 0.04, MAT.stripe, { cast: true });
      // 前挡风：外侧深色窗（朝外）+ 内侧透明玻璃（朝内），内外视角都正确
      addBox(bodyGroup, 2.16, 0.1, 0.1, 0, 2.73, frontZ + 0.09, MAT.windowFrame);
      addBox(bodyGroup, 2.16, 0.1, 0.1, 0, 1.67, frontZ + 0.09, MAT.windowFrame);
      addBox(bodyGroup, 0.14, 1.12, 0.1, -1.08, 2.2, frontZ + 0.09, MAT.windowFrame);
      addBox(bodyGroup, 0.14, 1.12, 0.1, 1.08, 2.2, frontZ + 0.09, MAT.windowFrame);
      const outerGlass = new THREE.Mesh(unitPlane, MAT.window);
      outerGlass.scale.set(1.98, 0.96, 1);
      outerGlass.position.set(0, 2.2, frontZ + 0.105);
      bodyGroup.add(outerGlass);
      const innerGlass = new THREE.Mesh(unitPlane, MAT.glass);
      innerGlass.scale.set(1.98, 0.96, 1);
      innerGlass.position.set(0, 2.2, frontZ + 0.06);
      innerGlass.rotation.y = Math.PI;
      bodyGroup.add(innerGlass);

      for (const s of [-1, 1]) {
        addBox(bodyGroup, 0.46, 0.2, 0.04, s * 0.78, 1.02, frontZ + 0.11, MAT.windowFrame);
        addBox(bodyGroup, 0.4, 0.14, 0.03, s * 0.78, 1.02, frontZ + 0.14, MAT.headlight);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.28), getDestinationSignMaterial());
      sign.position.set(0, 2.88, frontZ + 0.16);
      bodyGroup.add(sign);
      addBox(bodyGroup, 2.28, 0.22, 0.2, 0, 0.56, frontZ + 0.06, MAT.under, { cast: true });
      addBox(bodyGroup, 0.5, 0.22, 0.38, 0, 0.46, frontZ + 0.24, MAT.dark);
    }

    /* ---- 车顶设备 / 受电弓 ---- */
    addBox(bodyGroup, 1.15, 0.22, 1.5, 0, 3.03, centerZ - 1.4, MAT.roof, { cast: true });
    addBox(bodyGroup, 1.15, 0.22, 1.5, 0, 3.03, centerZ + 1.4, MAT.roof, { cast: true });
    if (!lowPower) addBox(bodyGroup, 0.18, 0.06, length - 1.2, 0, 3.0, centerZ, MAT.dark);
    if (!isLead && (carIndex === 2 || carIndex === 4)) addPantograph(bodyGroup);

    /* ---- 贯通道（只在车厢之间） ---- */
    if (carIndex < CAR_COUNT - 1) {
      addBox(bodyGroup, 1.65, 1.85, 0.9, 0, 1.5, backZ - 0.45, MAT.under, { cast: true });
      for (const dz of [-0.28, 0, 0.28]) {
        addBox(bodyGroup, 1.56, 1.72, 0.03, 0, 1.5, backZ - 0.45 + dz, MAT.bogie);
      }
    } else {
      for (const s of [-1, 1]) {
        addBox(bodyGroup, 0.32, 0.14, 0.04, s * 1.0, 1.25, backZ - 0.07, MAT.taillight);
      }
    }

    /* ---- 转向架 / 车轮：留在 runningGroup，不跟着车体倾斜 ---- */
    const bogieZ = isLead ? [-2.5, 0.5] : [-2.5, 2.5];
    for (const z of bogieZ) {
      addBox(runningGroup, 1.7, 0.3, 2.05, 0, 0.55, z, MAT.bogie, { cast: true });
      for (const dz of [-0.6, 0.6]) {
        for (const s of [-1, 1]) {
          const wheel = makeWheel();
          wheel.position.set(s * 1.0, 0.4, z + dz);
          runningGroup.add(wheel);
        }
      }
      addBox(runningGroup, 0.16, 0.18, 1.9, -0.98, 0.45, z, MAT.dark);
      addBox(runningGroup, 0.16, 0.18, 1.9, 0.98, 0.45, z, MAT.dark);
    }

    /* ---- 驾驶室内部（仅车头） ---- */
    if (isLead) {
      addBox(bodyGroup, 2.2, 0.08, 6.2, 0, 0.46, -0.75, MAT.interior, { receive: true });
      for (const s of [-1, 1]) {
        addBox(bodyGroup, 0.08, 1.26, 2.75, s * 1.13, 1.1, 1.08, MAT.interior);
        addBox(bodyGroup, 0.06, 0.42, 2.75, s * 1.13, 2.72, 1.08, MAT.interior);
        // 侧窗洞前后的墙板，避免从驾驶室看出去时侧面漏光
        addBox(bodyGroup, 0.06, 0.82, 1.32, s * 1.13, 2.14, 0.365, MAT.interior);
        addBox(bodyGroup, 0.06, 0.82, 0.42, s * 1.13, 2.14, 2.29, MAT.interior);
      }
      addBox(bodyGroup, 2.2, 2.35, 0.08, 0, 1.65, -0.4, MAT.interior);
      addBox(bodyGroup, 0.75, 0.62, 0.03, 0, 2.02, -0.35, MAT.window);
      addBox(bodyGroup, 2.18, 0.06, 3.0, 0, 2.92, 1.05, MAT.interior, { receive: true });
      addBox(bodyGroup, 0.55, 0.04, 1.25, 0, 2.88, 1.0, MAT.headlight);
      addBox(bodyGroup, 2.15, 0.32, 0.12, 0, 2.82, 2.42, MAT.consoleDark);
      // 中间高台缩短并后移，避免挡住仪表屏下半部分
      addBox(bodyGroup, 2.15, 0.2, 0.22, 0, 1.62, 2.44, MAT.consoleDark, { receive: true });
      addBox(bodyGroup, 2.15, 0.28, 0.12, 0, 1.42, 2.4, MAT.consoleMain);
      addBox(bodyGroup, 2.18, 0.3, 0.12, 0, 0.62, 2.42, MAT.consoleMain);
      // 仪表屏短支架
      addBox(bodyGroup, 0.26, 0.34, 0.12, 0, 1.45, 2.17, MAT.consoleMain);
      addBox(bodyGroup, 0.62, 0.14, 0.6, 0, 1.0, 0.55, MAT.dark);
      addBox(bodyGroup, 0.55, 0.72, 0.14, 0, 1.4, 0.22, MAT.dark);

      const consoleBase = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.6, 1.0), MAT.consoleOrange);
      consoleBase.position.set(0, 1.0, 2.0);
      bodyGroup.add(consoleBase);

      const consoleInner = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.55, 0.95), MAT.consoleMain);
      consoleInner.position.set(0, 1.02, 2.0);
      bodyGroup.add(consoleInner);

      const topPanel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.05, 0.85), MAT.consoleDark);
      topPanel.position.set(0, 1.3, 1.95);
      topPanel.rotation.x = -0.3;
      bodyGroup.add(topPanel);

      const screenCanvas = document.createElement('canvas');
      screenCanvas.width = 1024;
      screenCanvas.height = 580;
      screenCtx = screenCanvas.getContext('2d');
      // 逻辑坐标仍按 512×300 绘制，实际纹理 2 倍分辨率，文字更清晰
      screenCtx.setTransform(2, 0, 0, 2, 0, 0);
      screenTexture = new THREE.CanvasTexture(screenCanvas);
      screenTexture.colorSpace = THREE.SRGBColorSpace;
      screenTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
      screenTexture.minFilter = THREE.LinearFilter;
      screenTexture.magFilter = THREE.LinearFilter;
      screenTexture.generateMipmaps = false;
      const screenMat = new THREE.MeshBasicMaterial({ map: screenTexture, toneMapped: false });

      // 仪表屏：放在挡杆正上方的中央区域，宽屏；俯仰角对准驾驶位视线
      const screenGroup = new THREE.Group();
      screenGroup.position.set(0, 1.74, 2.12);
      screenGroup.rotation.set(-0.36, Math.PI, 0, 'YXZ');
      bodyGroup.add(screenGroup);

      addBox(screenGroup, 0.63, 0.36, 0.05, 0, 0, -0.04, MAT.consoleMain);

      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.53, 0.3), screenMat);
      screen.position.set(0, 0, 0.01);
      screenGroup.add(screen);

      const dial1 = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 32), MAT.consoleDark);
      dial1.position.set(0.6, 1.42, 1.83);
      dial1.rotation.x = Math.PI / 2 - 0.3;
      bodyGroup.add(dial1);

      needleMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.12, 0.02),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      needleMesh.geometry.translate(0, 0.06, 0);
      needleMesh.position.set(0.6, 1.44, 1.80);
      needleMesh.rotation.x = Math.PI / 2 - 0.3;
      bodyGroup.add(needleMesh);

      throttleLever = new THREE.Group();
      const thrBase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.2), MAT.consoleMain);
      throttleLever.add(thrBase);
      const thrStick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), MAT.dark);
      thrStick.position.y = 0.125;
      throttleLever.add(thrStick);
      const thrKnob = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x00ff00 })
      );
      thrKnob.position.y = 0.25;
      throttleLever.add(thrKnob);
      throttleLever.position.set(-0.2, 1.32, 2.0);
      throttleLever.rotation.x = -0.3;
      bodyGroup.add(throttleLever);

      brakeLever = new THREE.Group();
      const brkBase = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.2), MAT.consoleMain);
      brakeLever.add(brkBase);
      const brkStick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), MAT.dark);
      brkStick.position.y = 0.125;
      brakeLever.add(brkStick);
      const brkKnob = new THREE.Mesh(
        new THREE.SphereGeometry(0.04, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xff0000 })
      );
      brkKnob.position.y = 0.25;
      brakeLever.add(brkKnob);
      brakeLever.position.set(0.1, 1.32, 2.0);
      brakeLever.rotation.x = -0.3;
      bodyGroup.add(brakeLever);

      cabLight = new THREE.PointLight(0xffffee, 0, 10);
      cabLight.position.set(0, 2.8, 1.5);
      bodyGroup.add(cabLight);

      headlightSpot = new THREE.SpotLight(0xfff1d6, 0, 400, Math.PI / 4, 0.6, 1);
      headlightSpot.position.set(0, 1.0, 2.45);
      headlightSpot.target.position.set(0, 0, 60);
      bodyGroup.add(headlightSpot);
      bodyGroup.add(headlightSpot.target);

      // 前挡风雨刷
      if (!lowPower) {
        addBox(bodyGroup, 0.025, 0.72, 0.025, 0.42, 1.86, frontZ + 0.13, MAT.dark, { rz: -0.55 });
      }
    }

    return g;
  }

  trainGroup = new THREE.Group();
  scene.add(trainGroup);

  const cars = [];
  for (let i = 0; i < CAR_COUNT; i++) {
    const c = { obj: makeSubwayCar(i === 0, i), offset: i * CAR_SPACING, roll: 0 };
    cars.push(c);
    trainGroup.add(c.obj);
  }

  /* ============================================================
     12. 状态
     ============================================================ */
  let speed = 0;
  let notch = 0;
  let travel = 0;
  let isStopped = false;
  let currentTargetName = stations[0].name;

  let autoMode = false;
  let autoThrottle = 0;             // 自动模式下的无级挡位（-8..8），物理层直接使用
  let autoInfo = null;              // 控制器最近一帧的输出（HUD/驾驶屏使用）
  let autoStoppedDeviation = 0;
  let lastAutoDwellSecond = -1;

  const autopilot = new TrainAutopilot({
    stops: stations.map((station) => station.t * trackLength + STOP_OFFSET),
    trackLength,
    limitAt: curveLimitAt,
    cruiseSpeed: AUTO_CRUISE,
    dwellTime: AUTO_DWELL_TIME
  });

  const statusEl = $('#station-status');
  const stopPromptEl = $('#stop-prompt');
  const stopTitleEl = $('#stop-title');
  const stopDetailEl = $('#stop-detail');
  const notchTextEl = $('#notch-text');
  const notchHandleEl = $('#notch-handle');
  const notchSegs = $$('.notch-seg');
  const camModeEl = $('#cam-mode');
  const autoModeEl = $('#auto-mode');
  const speedEl = $('#speedo');
  const autoPanelEl = $('#auto-panel');
  const autoPhaseEl = $('#auto-phase');
  const autoTargetSpeedEl = $('#auto-target-speed');
  const autoDistEl = $('#auto-dist');
  const autoLimitEl = $('#auto-limit');
  const autoNextEl = $('#auto-next');
  const touchAutoBtn = $('#touch-auto');

  /** 停站后“如何发车”提示：触屏与键盘文案不同 */
  const START_HINT = touchUi
    ? '按住 <kbd>＋</kbd> 发车 · <kbd>0</kbd> 回中'
    : '按 <kbd>空格</kbd> 回中，再按 <kbd>W</kbd> 发车';

  if (touchUi) statusEl.textContent = '准备发车：按住 ＋ 推牵引挡';

  let lastStatusText = '';
  function setStatus(text) {
    if (text !== lastStatusText) { lastStatusText = text; statusEl.textContent = text; }
  }

  /* ============================================================
     13. 挡位 UI / 连发
     ============================================================ */
  let lastNotchShown = null;
  function updateNotchUI(force = false) {
    // 自动模式用无级挡位，手动模式保持整数挡
    const shown = autoMode ? Math.round(autoThrottle * 20) / 20 : notch;
    if (!force && shown === lastNotchShown) return;
    lastNotchShown = shown;

    if (autoMode) {
      notchTextEl.textContent = Math.abs(shown) < 0.05
        ? '0'
        : `${shown > 0 ? '+' : ''}${shown.toFixed(1)}`;
    } else {
      notchTextEl.textContent = notch > 0 ? `+${notch}` : `${notch}`;
    }

    const pct = 50 + (shown / 8) * 48;
    notchHandleEl.style.left = `${pct}%`;
    notchSegs.forEach(seg => {
      const val = parseInt(seg.getAttribute('data-notch'), 10);
      let on = false;
      if (shown > 0 && val > 0 && val <= shown + 1e-6) on = true;
      else if (shown < 0 && val < 0 && val >= shown - 1e-6) on = true;
      seg.classList.toggle('active', on);
    });
  }

  const holdState = {
    up: { active: false, nextTime: 0 },
    down: { active: false, nextTime: 0 }
  };

  function stepNotch(dir) {
    if (dir > 0) {
      if (notch >= 8) return;
      if (notch < 0) notch = 0;
      else notch++;
    } else {
      if (notch <= -8) return;
      if (notch > 0) notch = 0;
      else notch--;
    }

    if (isStopped && notch > 0) {
      isStopped = false;
      stopPromptEl.style.display = 'none';
      signalLights.forEach(s => s.material.color.setHex(0xff0000));
    }
    updateNotchUI();
  }

  function updateHold() {
    if (autoMode) return;
    const now = performance.now();
    if (holdState.up.active && now >= holdState.up.nextTime) {
      stepNotch(1);
      holdState.up.nextTime = now + REPEAT_INTERVAL_MS;
    }
    if (holdState.down.active && now >= holdState.down.nextTime) {
      stepNotch(-1);
      holdState.down.nextTime = now + REPEAT_INTERVAL_MS;
    }
  }

  /* ============================================================
     14. 驾驶屏
     ============================================================ */
  function drawScreen() {
    if (!screenCtx) return;
    const W = 512;
    const H = 290;
    screenCtx.fillStyle = '#071012';
    screenCtx.fillRect(0, 0, W, H);

    /* 顶栏 */
    screenCtx.fillStyle = autoMode ? 'rgba(18, 74, 52, 0.92)' : 'rgba(40, 40, 40, 0.92)';
    screenCtx.fillRect(0, 0, W, 54);
    screenCtx.fillStyle = autoMode ? '#39f7a8' : '#ffd166';
    screenCtx.font = 'bold 30px monospace';
    screenCtx.textAlign = 'left';
    screenCtx.fillText(autoMode ? `AUTO · ${autoInfo ? autoInfo.label : '待命'}` : 'MANUAL', 16, 36);
    screenCtx.fillStyle = autoMode ? '#39f7a8' : '#ff5555';
    screenCtx.beginPath();
    screenCtx.arc(490, 27, 8, 0, Math.PI * 2);
    screenCtx.fill();

    /* 大速度 */
    screenCtx.fillStyle = '#8df8d4';
    screenCtx.font = 'bold 120px monospace';
    screenCtx.textAlign = 'center';
    screenCtx.fillText(`${Math.round(speed * 3.6)}`, 138, 190);
    screenCtx.font = 'bold 26px monospace';
    screenCtx.fillStyle = '#7ef9d0';
    screenCtx.fillText('km/h', 138, 220);

    screenCtx.strokeStyle = '#12443a';
    screenCtx.lineWidth = 2;
    screenCtx.beginPath();
    screenCtx.moveTo(268, 76);
    screenCtx.lineTo(268, 220);
    screenCtx.stroke();

    const label = (text, y) => {
      screenCtx.font = 'bold 26px monospace';
      screenCtx.fillStyle = '#7fb7c9';
      screenCtx.textAlign = 'left';
      screenCtx.fillText(text, 286, y);
    };
    const value = (text, y, color, font) => {
      screenCtx.font = font;
      screenCtx.fillStyle = color;
      screenCtx.textAlign = 'right';
      screenCtx.fillText(text, 494, y);
    };

    /* 右侧信息区 */
    if (autoMode) {
      const info = autoInfo;
      label('目标', 108);
      value(`${info ? Math.round(info.targetSpeed * 3.6) : '--'}`, 108, '#ffd166', 'bold 44px monospace');
      label('限速', 152);
      value(`${info ? Math.round(info.limitSpeed * 3.6) : '--'}`, 152, '#9fe8ff', 'bold 38px monospace');
      label('停车点', 196);
      const stopText = info
        ? (info.phase === 'dwell' ? `停靠 ${Math.ceil(info.dwellRemain)}s` : `${Math.round(info.distToStop)} m`)
        : '--';
      value(stopText, 196, '#ffd166', 'bold 36px monospace');
    } else {
      label('挡位', 108);
      value(`${notch > 0 ? '+' + notch : notch}`, 108,
        notch > 0 ? '#2ecc71' : (notch < 0 ? '#e74c3c' : '#ffd166'), 'bold 44px monospace');
      label('状态', 152);
      value('手动', 152, '#ffffff', 'bold 38px monospace');
      label('速度', 196);
      value(`${Math.round(speed * 3.6)}`, 196, '#9fe8ff', 'bold 36px monospace');
    }

    /* 底栏：下一站 + 进度 */
    screenCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    screenCtx.fillRect(0, 230, W, 2);
    screenCtx.fillStyle = '#ffffff';
    screenCtx.font = 'bold 28px sans-serif';
    screenCtx.textAlign = 'center';
    const nextLabel = autoMode && autoInfo && autoInfo.phase === 'dwell' ? '停靠' : '下一站';
    screenCtx.fillText(`${nextLabel}  ${currentTargetName}`, 256, 262);

    if (autoMode) {
      const progress = autoInfo && autoInfo.phase !== 'dwell'
        ? 1 - Math.min(1, autoInfo.distToStop / 600)
        : 1;
      screenCtx.fillStyle = 'rgba(46, 204, 113, 0.22)';
      screenCtx.fillRect(24, 278, 464, 6);
      screenCtx.fillStyle = '#2ecc71';
      screenCtx.fillRect(24, 278, 464 * Math.max(0, Math.min(1, progress)), 6);
    }

    screenTexture.needsUpdate = true;
  }

  /* ============================================================
     15. 物理
     ============================================================ */
  function updatePhysics(dt) {
    // 自动模式用无级挡位（自动控制器给出），手动模式用整数挡
    const appliedThrottle = autoMode ? autoThrottle : notch;

    if (isStopped) {
      speed = 0;
    } else {
      speed = stepTrain(speed, dt, appliedThrottle);
      travel += speed * dt;
      if (travel >= trackLength) travel -= trackLength;
    }

    const wheelDelta = (speed * dt) / 0.4;
    for (let i = 0; i < wheelsArray.length; i++) wheelsArray[i].rotation.x += wheelDelta;

    if (throttleLever && brakeLever) {
      const targetThr = appliedThrottle > 0 ? -(appliedThrottle / 8) * 0.6 : 0;
      const targetBrk = appliedThrottle < 0 ? (appliedThrottle / 8) * 0.6 : 0;
      throttleLever.rotation.x = THREE.MathUtils.damp(throttleLever.rotation.x, -0.3 + targetThr, 10, dt);
      brakeLever.rotation.x = THREE.MathUtils.damp(brakeLever.rotation.x, -0.3 + targetBrk, 10, dt);
    }

    if (needleMesh) {
      const targetNeedle = -(speed / MAX_SPEED) * Math.PI;
      needleMesh.rotation.z = THREE.MathUtils.damp(needleMesh.rotation.z, targetNeedle, 8, dt);
    }
  }

  /* ============================================================
     16. 停车目标 / 距离
     ============================================================ */
  function stationArc(i) { return stations[i].t * trackLength + STOP_OFFSET; }

  function signedDistToTarget(i) {
    const d = (stationArc(i) - travel + trackLength) % trackLength;
    return d > trackLength / 2 ? d - trackLength : d;
  }

  /* ============================================================
     17. 自动控制（规划/执行核心见 autopilot.js）
     ============================================================ */
  const autoPanelText = {
    phase: '',
    targetSpeed: '',
    dist: '',
    limit: '',
    next: ''
  };

  function deviationText(error) {
    if (Math.abs(error) < 0.02) return '精确对准';
    return `${error > 0 ? '越过' : '提前'} ${Math.abs(error).toFixed(2)} m`;
  }

  function showAutoStopPrompt(error) {
    const deviation = Math.abs(error);
    stopTitleEl.textContent = deviation < AUTO_PERFECT_DEVIATION
      ? '✅ 完美停靠'
      : (deviation < AUTO_GOOD_DEVIATION ? '👍 良好停靠' : '🚉 已停靠');
    lastAutoDwellSecond = -1;
    updateAutoDwellText();
    stopPromptEl.style.display = 'block';
  }

  function updateAutoDwellText() {
    if (!autoInfo) return;
    const remain = Math.max(0, Math.ceil(autoInfo.dwellRemain));
    if (remain === lastAutoDwellSecond) return;
    lastAutoDwellSecond = remain;
    stopDetailEl.textContent =
      `停靠偏差 ${deviationText(autoStoppedDeviation)} · ${remain}s 后自动发车`;
  }

  function updateAutoPanel() {
    if (!autoMode || !autoInfo) {
      autoPanelEl.hidden = true;
      return;
    }
    autoPanelEl.hidden = false;
    const info = autoInfo;
    const station = stations[info.stopIndex];
    const phaseText = info.label;
    const targetText = `${Math.round(info.targetSpeed * 3.6)}`;
    const distText = info.phase === 'dwell' ? '0' : `${Math.round(info.distToStop)}`;
    const limitText = `${Math.round(info.limitSpeed * 3.6)}`;
    const nextText = info.phase === 'dwell'
      ? `停靠 · ${station.name}`
      : `下一站 · ${station.name}`;

    if (autoPanelText.phase !== phaseText) {
      autoPanelText.phase = phaseText;
      autoPhaseEl.textContent = phaseText;
    }
    if (autoPanelText.targetSpeed !== targetText) {
      autoPanelText.targetSpeed = targetText;
      autoTargetSpeedEl.textContent = targetText;
    }
    if (autoPanelText.dist !== distText) {
      autoPanelText.dist = distText;
      autoDistEl.textContent = distText;
    }
    if (autoPanelText.limit !== limitText) {
      autoPanelText.limit = limitText;
      autoLimitEl.textContent = limitText;
    }
    if (autoPanelText.next !== nextText) {
      autoPanelText.next = nextText;
      autoNextEl.textContent = nextText;
    }
  }

  function toggleAuto() {
    autoMode = !autoMode;
    holdState.up.active = false;
    holdState.down.active = false;

    if (autoMode) {
      autopilot.reset({ travel, speed, stopped: isStopped });
      autoThrottle = 0;
      autoInfo = null;
      lastAutoDwellSecond = -1;
      autoModeEl.textContent = '🤖 自动驾驶';
      autoModeEl.classList.add('on');
      autoPanelEl.hidden = false;
      updateNotchUI(true);

      if (isStopped && stations[autopilot.targetIdx]) {
        // 手动停站后直接切自动：用实际停车位置算偏差，倒计时结束后自动发车
        const stopArc = stations[autopilot.targetIdx].t * trackLength + STOP_OFFSET;
        let deviation = travel - stopArc;
        if (deviation > trackLength / 2) deviation -= trackLength;
        if (deviation < -trackLength / 2) deviation += trackLength;
        autoStoppedDeviation = deviation;
        showAutoStopPrompt(deviation);
      }

      setStatus(isStopped
        ? `🤖 自动驾驶已接管 · ${AUTO_DWELL_TIME.toFixed(0)}s 后自动发车`
        : '🤖 自动驾驶已接管');
    } else {
      autoModeEl.textContent = '🎮 手动驾驶';
      autoModeEl.classList.remove('on');
      autoPanelEl.hidden = true;
      autoThrottle = 0;
      autoInfo = null;
      notch = 0;
      if (isStopped) {
        stopDetailEl.innerHTML =
          `停靠偏差 ${Math.abs(autoStoppedDeviation).toFixed(2)} m · ${START_HINT}`;
      }
      updateNotchUI(true);
    }
    if (touchAutoBtn) touchAutoBtn.classList.toggle('on', autoMode);
    drawScreen();
  }

  function updateAutoDrive(dt) {
    if (!autoMode) return;

    autoInfo = autopilot.update(dt, { travel, speed, isStopped });

    if (autoInfo.arrived) {
      speed = 0;
      isStopped = true;
      notch = 0;
      autoStoppedDeviation = autoInfo.stopError;
      const station = stations[autoInfo.stopIndex];
      showAutoStopPrompt(autoStoppedDeviation);
      signalLights.forEach((light) => light.material.color.setHex(0xff0000));
      if (signalLights[autoInfo.stopIndex]) {
        signalLights[autoInfo.stopIndex].material.color.setHex(0x00ff00);
      }
      setStatus(`🚉 已抵达：${station.name}`);
      currentTargetName = station.name;
      drawScreen();
    }

    if (autoInfo.departed) {
      isStopped = false;
      stopPromptEl.style.display = 'none';
      signalLights.forEach((light) => light.material.color.setHex(0xff0000));
      const station = stations[autoInfo.stopIndex];
      setStatus(`🤖 自动发车 · 下一站 ${station.name}`);
      currentTargetName = station.name;
      drawScreen();
    }

    autoThrottle = autoInfo.throttle;
    // 仅停靠时压住制动；发车瞬间允许 +8 满功率起步
    if (isStopped) autoThrottle = Math.min(autoThrottle, -2);
    notch = Math.round(autoThrottle);
    updateNotchUI();

    if (isStopped) {
      updateAutoDwellText();
      updateAutoPanel();
    }
  }

  /* ============================================================
     18. 列车位置 / 手动停靠
     ============================================================ */
  function updateTrainPosition(dt) {
    let nearIdx = -1, nearSymDist = Infinity;
    for (let i = 0; i < stations.length; i++) {
      const d = signedDistToTarget(i);
      const sym = Math.abs(d);
      if (sym < nearSymDist) { nearSymDist = sym; nearIdx = i; }
    }

    if (!isStopped && !autoMode) {
      if (nearIdx !== -1 && nearSymDist < STOP_WINDOW && speed < 0.5 && notch <= 0) {
        speed = 0;
        notch = 0;
        updateNotchUI();
        isStopped = true;

        const grade = nearSymDist < 3 ? '✅ 完美停靠' : (nearSymDist < 7 ? '👍 良好停靠' : '🚉 已停靠');
        stopTitleEl.textContent = grade;
        stopDetailEl.innerHTML = `停靠偏差 ${nearSymDist.toFixed(1)} m · ${START_HINT}`;
        stopPromptEl.style.display = 'block';

        setStatus(`🚉 已抵达：${stations[nearIdx].name}`);
        if (signalLights[nearIdx]) signalLights[nearIdx].material.color.setHex(0x00ff00);
        drawScreen();
      }
    }

    if (!isStopped) {
      if (autoMode) {
        if (autoInfo) {
          const station = stations[autoInfo.stopIndex];
          currentTargetName = station.name;
          setStatus(`🤖 ${autoInfo.label} · 下一站 ${station.name}`);
        }
      } else {
        let minDist = Infinity, nextIdx = 0;
        for (let i = 0; i < stations.length; i++) {
          const d = signedDistToTarget(i);
          if (d < 0) continue;
          if (d < minDist) { minDist = d; nextIdx = i; }
        }
        if (minDist === Infinity) { minDist = 0; nextIdx = 0; }
        currentTargetName = stations[nextIdx].name;
        setStatus(`正在前往：${currentTargetName} · 距停车点 ${Math.round(minDist)} m`);
      }
    }

    for (let i = 0; i < cars.length; i++) {
      const car = cars[i];
      let carTravel = travel - car.offset;
      if (carTravel < 0) carTravel += trackLength;
      const carT = carTravel / trackLength;

      getFrameAt(carT, _carPos, _carTan);
      _carSide.crossVectors(WORLD_UP, _carTan).normalize();
      _carUp.crossVectors(_carTan, _carSide).normalize();
      _carBasis.makeBasis(_carSide, _carUp, _carTan);
      _carQuat.setFromRotationMatrix(_carBasis);

      car.obj.position.copy(_carPos);
      car.obj.quaternion.copy(_carQuat);

      // 车体倾摆：v²κ 是横向加速度，atan(a/g) 为理论倾角；
      // 乘视觉增益并限幅，负号表示车顶倒向弯心（只转车体，转向架保持贴轨）。
      const curvature = getCurvatureAt(carT);
      const targetRoll = THREE.MathUtils.clamp(
        -Math.atan((speed * speed * curvature) / GRAVITY) * TRAIN_TILT_GAIN,
        -TRAIN_MAX_TILT,
        TRAIN_MAX_TILT
      );
      if (dt > 0) car.roll = THREE.MathUtils.damp(car.roll, targetRoll, TRAIN_TILT_SMOOTH, dt);
      else car.roll = targetRoll;
      const carBody = car.obj.userData.bodyGroup;
      if (carBody) carBody.rotation.z = car.roll;
    }
  }

  /* ============================================================
     19. 相机
     ============================================================ */
  let cameraMode = 'third';
  let theta = 0, phi = Math.PI / 2 - 0.25, radius = 70;
  let targetTheta = 0, targetPhi = Math.PI / 2 - 0.25, targetRadius = 70;
  let isDragging = false, lastInteractionTime = 0, previousMouseX = 0, previousMouseY = 0;
  let lookYaw = 0, lookPitch = -0.2, targetLookYaw = 0, targetLookPitch = -0.2;

  const _camTarget = new THREE.Vector3();
  const _tanV = new THREE.Vector3();
  const _driverPos = new THREE.Vector3(0, 2.1, 1.2);
  const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const _quatFwd = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const _quatLook = new THREE.Quaternion();

  /* 触摸手势：单指拖动环顾 / 双指捏合缩放（鼠标行为保持不变） */
  const activePointers = new Map();
  let dragPointerId = null;
  let pinchStartDist = 0;
  let pinchStartRadius = 0;

  function pointerDistance() {
    const pts = Array.from(activePointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  on(renderer.domElement, 'pointerdown', (e) => {
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteractionTime = performance.now();

    if (activePointers.size === 2) {
      // 第二根手指落下：退出单指环顾，进入双指缩放
      isDragging = false;
      dragPointerId = null;
      pinchStartDist = pointerDistance();
      pinchStartRadius = radius;
      renderer.domElement.setPointerCapture?.(e.pointerId);
      return;
    }

    if (e.button !== 0) return;
    isDragging = true;
    dragPointerId = e.pointerId;
    previousMouseX = e.clientX;
    previousMouseY = e.clientY;
    renderer.domElement.setPointerCapture?.(e.pointerId);
  });

  on(window, 'pointermove', (e) => {
    if (!activePointers.has(e.pointerId)) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.size >= 2) {
      const dist = pointerDistance();
      if (pinchStartDist > 0 && dist > 0 && cameraMode === 'third') {
        // 双指张开 = 拉近（半径变小），双指收拢 = 拉远
        targetRadius = THREE.MathUtils.clamp(pinchStartRadius * (pinchStartDist / dist), 20, 250);
        radius = targetRadius;
      }
      lastInteractionTime = performance.now();
      return;
    }

    if (!isDragging || e.pointerId !== dragPointerId) return;
    const dx = e.clientX - previousMouseX;
    const dy = e.clientY - previousMouseY;
    previousMouseX = e.clientX;
    previousMouseY = e.clientY;
    lastInteractionTime = performance.now();

    if (cameraMode === 'third') {
      theta -= dx * 0.005;
      phi -= dy * 0.005;
      phi = THREE.MathUtils.clamp(phi, 0.1, Math.PI / 2 - 0.02);
    } else {
      targetLookYaw -= dx * 0.004;
      targetLookYaw = THREE.MathUtils.clamp(targetLookYaw, -Math.PI * 0.8, Math.PI * 0.8);
      targetLookPitch -= dy * 0.004;
      targetLookPitch = THREE.MathUtils.clamp(targetLookPitch, -Math.PI / 3, Math.PI / 4);
    }
  });

  function endPointer(e) {
    if (!activePointers.delete(e.pointerId)) return;
    lastInteractionTime = performance.now();

    if (activePointers.size === 1) {
      // 捏合结束后，剩下那根手指直接接着环顾，避免视角"粘住"
      const [id] = activePointers.keys();
      const p = activePointers.get(id);
      dragPointerId = id;
      isDragging = true;
      previousMouseX = p.x;
      previousMouseY = p.y;
      pinchStartDist = 0;
      return;
    }

    if (e.pointerId === dragPointerId) {
      isDragging = false;
      dragPointerId = null;
    }
    pinchStartDist = 0;
  }

  on(window, 'pointerup', endPointer);
  on(window, 'pointercancel', endPointer);

  on(renderer.domElement, 'wheel', (e) => {
    if (cameraMode === 'third') {
      targetRadius = THREE.MathUtils.clamp(targetRadius + e.deltaY * 0.03, 20, 250);
      if (!isDragging) radius = targetRadius;
    }
    lastInteractionTime = performance.now();
  }, { passive: true });

  function lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  function updateCamera(dt, snap = false) {
    const head = cars[0].obj;

    if (cameraMode === 'third') {
      _camTarget.copy(head.position);
      _camTarget.y += 2.5;

      _tanV.set(0, 0, 1).applyQuaternion(head.quaternion);
      _tanV.y = 0;
      if (_tanV.lengthSq() < 1e-8) _tanV.set(0, 0, 1);
      _tanV.normalize();
      targetTheta = Math.atan2(-_tanV.x, -_tanV.z);

      const now = performance.now();
      if (snap) {
        theta = targetTheta; phi = targetPhi; radius = targetRadius;
      } else if (!isDragging && now - lastInteractionTime > 2500) {
        theta = lerpAngle(theta, targetTheta, 1 - Math.exp(-dt * 3));
        phi = THREE.MathUtils.damp(phi, targetPhi, 3, dt);
        radius = THREE.MathUtils.damp(radius, targetRadius, 3, dt);
      } else if (isDragging) {
        radius = targetRadius;
      }

      camera.position.set(
        _camTarget.x + radius * Math.sin(phi) * Math.sin(theta),
        _camTarget.y + radius * Math.cos(phi),
        _camTarget.z + radius * Math.sin(phi) * Math.cos(theta)
      );
      camera.lookAt(_camTarget);
    } else {
      const now = performance.now();
      if (!isDragging && now - lastInteractionTime > 1500) {
        targetLookYaw = THREE.MathUtils.damp(targetLookYaw, 0, 5, dt);
        targetLookPitch = THREE.MathUtils.damp(targetLookPitch, -0.2, 5, dt);
      }
      lookYaw = THREE.MathUtils.damp(lookYaw, targetLookYaw, 15, dt);
      lookPitch = THREE.MathUtils.damp(lookPitch, targetLookPitch, 15, dt);

      _bankQuat.setFromAxisAngle(_zAxis, cars[0].roll || 0);
      _driverPos.set(0, 2.1, 1.2).applyQuaternion(_bankQuat).applyQuaternion(head.quaternion).add(head.position);
      camera.position.copy(_driverPos);

      _euler.set(lookPitch, lookYaw, 0);
      _quatLook.setFromEuler(_euler);
      camera.quaternion.copy(head.quaternion).multiply(_bankQuat).multiply(_quatFwd).multiply(_quatLook);
    }

    sun.position.copy(head.position).add(_sunOffset);
    sun.target.position.copy(head.position);
  }

  function toggleCamera() {
    const camBtn = $('#touch-cam');
    if (cameraMode === 'third') {
      cameraMode = 'first';
      camModeEl.textContent = '📷 第一人称驾驶室';
      targetLookYaw = 0; targetLookPitch = -0.2;
      lookYaw = 0; lookPitch = -0.2;
    } else {
      cameraMode = 'third';
      camModeEl.textContent = '📷 第三人称跟随';
      updateCamera(0, true);
    }
    if (camBtn) camBtn.textContent = cameraMode === 'third' ? '视角·跟随' : '视角·驾驶室';
  }

  /* ============================================================
     20. 输入
     ============================================================ */
  on(window, 'keydown', (e) => {
    // 捕获阶段处理：拦下本游戏按键，避免触发全局导航快捷键（G/C 等）
    if (GAME_KEYS.has(e.code)) e.stopPropagation();
    if (e.code === 'KeyW' || e.code === 'ArrowUp' ||
      e.code === 'KeyS' || e.code === 'ArrowDown' ||
      e.code === 'Space') {
      e.preventDefault();
    }

    if (e.code === 'KeyN') {
      if (!e.repeat) toggleDayNight();
      return;
    }

    if (e.code === 'KeyC') {
      if (!e.repeat) toggleCamera();
      return;
    }

    if (e.code === 'KeyG') {
      if (!e.repeat) toggleAuto();
      return;
    }

    if (e.repeat) return;

    if (e.code === 'KeyW' || e.code === 'ArrowUp') {
      if (autoMode) toggleAuto();
      holdState.down.active = false;
      holdState.up.active = true;
      holdState.up.nextTime = performance.now() + HOLD_DELAY_MS;
      stepNotch(1);
      return;
    }

    if (e.code === 'KeyS' || e.code === 'ArrowDown') {
      if (autoMode) toggleAuto();
      holdState.up.active = false;
      holdState.down.active = true;
      holdState.down.nextTime = performance.now() + HOLD_DELAY_MS;
      stepNotch(-1);
      return;
    }

    if (e.code === 'Space') {
      if (autoMode) toggleAuto();
      notch = 0;
      updateNotchUI();
    }
  }, true);

  on(window, 'keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') holdState.up.active = false;
    if (e.code === 'KeyS' || e.code === 'ArrowDown') holdState.down.active = false;
  });

  on(window, 'blur', () => {
    holdState.up.active = false;
    holdState.down.active = false;
  });

  /* ============================================================
     20b. 触屏虚拟按键
     （按键常驻 DOM，仅粗指针/窄屏可见；事件与键盘共用同一套状态机）
     ============================================================ */
  function applyTouchTap(action) {
    if (action === 'neutral') {
      if (autoMode) toggleAuto();
      notch = 0;
      updateNotchUI();
    } else if (action === 'auto') {
      toggleAuto();
    } else if (action === 'cam') {
      toggleCamera();
    } else if (action === 'night') {
      toggleDayNight();
    } else if (action === 'back') {
      go('games');
    }
  }

  $$('[data-touch-tap]').forEach((btn) => {
    on(btn, 'click', () => applyTouchTap(btn.getAttribute('data-touch-tap')));
  });

  $$('[data-touch-hold]').forEach((btn) => {
    const dir = Number(btn.getAttribute('data-touch-hold')) > 0 ? 1 : -1;
    const release = () => {
      btn.classList.remove('active');
      if (dir > 0) holdState.up.active = false;
      else holdState.down.active = false;
    };

    on(btn, 'pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('active');
      btn.setPointerCapture?.(e.pointerId);
      if (autoMode) toggleAuto();
      if (dir > 0) {
        holdState.down.active = false;
        holdState.up.active = true;
        holdState.up.nextTime = performance.now() + HOLD_DELAY_MS;
      } else {
        holdState.up.active = false;
        holdState.down.active = true;
        holdState.down.nextTime = performance.now() + HOLD_DELAY_MS;
      }
      stepNotch(dir);
    });
    on(btn, 'pointerup', release);
    on(btn, 'pointercancel', release);
    on(btn, 'lostpointercapture', release);
  });

  const applyStageSize = () => {
    const w = Math.max(1, stage.clientWidth);
    const h = Math.max(1, stage.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  on(window, 'resize', applyStageSize);
  const resizeObserver = new ResizeObserver(applyStageSize);
  resizeObserver.observe(stage);

  /* ============================================================
     21. 初始化 & 主循环
     ============================================================ */
  updateNotchUI();
  updateTrainPosition(0);
  updateCamera(0, true);
  drawScreen();

  const clock = new THREE.Clock();
  let screenTimer = 0;
  let lastKmh = -1;

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);

    updateAutoDrive(dt);
    updatePhysics(dt);
    updateTrainPosition(dt);
    updateCamera(dt);
    updateHold();

    sky.position.copy(camera.position);

    const kmh = Math.round(speed * 3.6);
    if (kmh !== lastKmh) {
      lastKmh = kmh;
      speedEl.firstChild.nodeValue = kmh;
    }

    screenTimer += dt;
    if (screenTimer >= 0.1) {
      screenTimer = 0;
      drawScreen();
      updateAutoPanel();
    }

    renderer.render(scene, camera);
  }


  /* ============================================================
     22. 启动 / 清理
     ============================================================ */
  const loadingEl = $('#loading');
  if (loadingEl) {
    loadingEl.classList.add('hide');
    setTimeout(() => { if (loadingEl.isConnected) loadingEl.remove(); }, 500);
  }
  renderer.setAnimationLoop(tick);

  let disposed = false;
  function cleanupTrain3d() {
    if (disposed) return;
    disposed = true;
    if (activeCleanup === cleanupTrain3d) activeCleanup = null;
    offRoute();
    renderer.setAnimationLoop(null);
    resizeObserver.disconnect();
    teardown.forEach((off) => off());

    // 释放几何体 / 材质 / 纹理，避免反复进出页面时显存持续增长
    const released = new Set();
    const disposeMaterial = (m) => {
      if (!m || released.has(m)) return;
      released.add(m);
      Object.keys(m).forEach((key) => {
        const value = m[key];
        if (value && value.isTexture && !released.has(value)) {
          released.add(value);
          value.dispose();
        }
      });
      m.dispose();
    };
    scene.traverse((obj) => {
      if (obj.geometry && !released.has(obj.geometry)) {
        released.add(obj.geometry);
        obj.geometry.dispose();
      }
      if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
      else if (obj.material) disposeMaterial(obj.material);
    });
    skyMat.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    // 仅在自己仍占用容器时清空：路由离开后新视图可能已渲染到同一容器，
    // 此时清空会把刚渲染的大厅页面抹成空白
    if (root.isConnected && container.contains(root)) container.innerHTML = '';
  }

  // 路由离开时兜底销毁（router 不会调用视图返回的 cleanup）
  const offRoute = eventBus.on('route:change', (id) => {
    if (id !== 'train3d') cleanupTrain3d();
  });
  activeCleanup = cleanupTrain3d;
  return cleanupTrain3d;
}
