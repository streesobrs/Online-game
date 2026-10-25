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
import { TrainAudio } from './audio.js';

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
  <button id="audio-mode" type="button" title="静音/开启音效（M）">🔈 开启音效</button>
  <button id="quality-mode" type="button" title="设置">⚙ 设置</button>
  <div id="quality-panel" hidden>
    <div class="quality-head"><b>设置</b><span>画面 / 世界</span></div>
    <p id="quality-summary" class="quality-summary"></p>
    <button id="quality-auto" class="quality-reset quality-auto" type="button">恢复自动设置</button>

    <div class="quality-sep">世界种子</div>
    <div class="seed-row">
      <input id="world-seed" type="text" maxlength="40" spellcheck="false" autocomplete="off" aria-label="世界种子">
      <button id="world-seed-apply" class="seed-btn" type="button">生成</button>
      <button id="world-seed-random" class="seed-btn" type="button">随机</button>
    </div>
    <p class="seed-hint">同一 seed 生成同一套世界与轨道；生成后会重建世界并回到起点。</p>

    <div class="quality-sep">世界生成（点生成后生效）</div>
    <label class="quality-row">
      <span>车站数量</span>
      <select data-setting="stationCount">
        <option value="0">自动</option>
        <option value="6">6</option>
        <option value="8">8</option>
        <option value="10">10</option>
        <option value="12">12</option>
        <option value="14">14</option>
        <option value="16">16</option>
      </select>
    </label>
    <label class="quality-row">
      <span>地形起伏</span>
      <input type="range" data-setting="terrainRelief" min="0.3" max="1.6" step="0.1">
      <output data-value="terrainRelief">1.00x</output>
    </label>
    <label class="quality-row">
      <span>湖泊大小</span>
      <input type="range" data-setting="lakeScale" min="0.4" max="1.4" step="0.1">
      <output data-value="lakeScale">1.00x</output>
    </label>
    <label class="quality-row">
      <span>河流长度</span>
      <input type="range" data-setting="riverScale" min="0.3" max="1" step="0.1">
      <output data-value="riverScale">1.00x</output>
    </label>
    <label class="quality-row">
      <span>雪山数量</span>
      <select data-setting="mountainCount">
        <option value="0">自动</option>
        <option value="-1">关闭</option>
        <option value="8">8</option>
        <option value="12">12</option>
        <option value="16">16</option>
        <option value="20">20</option>
        <option value="24">24</option>
        <option value="30">30</option>
      </select>
    </label>
    <label class="quality-row">
      <span>雪山高度</span>
      <input type="range" data-setting="mountainHeight" min="0.6" max="1.4" step="0.1">
      <output data-value="mountainHeight">1.00x</output>
    </label>
    <label class="quality-row">
      <span>每站建筑</span>
      <input type="range" data-setting="buildingsPerTown" min="6" max="36" step="1">
      <output data-value="buildingsPerTown">22</output>
    </label>
    <button id="world-seed-apply-bottom" class="quality-reset" type="button" data-action="generate">按当前种子和设置生成</button>

    <div class="quality-sep">画面</div>
    <label class="quality-row">
      <span>分辨率</span>
      <input type="range" data-setting="resolution" min="0.6" max="2.0" step="0.05">
      <output data-value="resolution">1.00x</output>
    </label>
    <label class="quality-row">
      <span>阴影</span>
      <select data-setting="shadows">
        <option value="0">关闭</option>
        <option value="1024">低 1024</option>
        <option value="1536">中 1536</option>
        <option value="2048">高 2048</option>
      </select>
    </label>
    <label class="quality-row">
      <span>软阴影</span>
      <select data-setting="softShadows">
        <option value="1">开</option>
        <option value="0">关</option>
      </select>
    </label>
    <label class="quality-row">
      <span>植被投影</span>
      <select data-setting="foliageShadows">
        <option value="1">开</option>
        <option value="0">关</option>
      </select>
    </label>
    <label class="quality-row">
      <span>水面</span>
      <select data-setting="water">
        <option value="1">显示</option>
        <option value="0">隐藏</option>
      </select>
    </label>
    <label class="quality-row">
      <span>帧率上限</span>
      <select data-setting="fpsLimit">
        <option value="0">无限制</option>
        <option value="30">30</option>
        <option value="45">45</option>
        <option value="60">60</option>
        <option value="90">90</option>
        <option value="120">120</option>
      </select>
    </label>

    <div class="quality-sep">世界细节</div>
    <label class="quality-row">
      <span>树木密度</span>
      <input type="range" data-setting="vegetation" min="0" max="1" step="0.05">
      <output data-value="vegetation">100%</output>
    </label>
    <label class="quality-row">
      <span>灌木密度</span>
      <input type="range" data-setting="bushes" min="0" max="1" step="0.05">
      <output data-value="bushes">100%</output>
    </label>
    <label class="quality-row">
      <span>岩石密度</span>
      <input type="range" data-setting="rocks" min="0" max="1" step="0.05">
      <output data-value="rocks">100%</output>
    </label>
    <label class="quality-row">
      <span>城镇密度</span>
      <input type="range" data-setting="towns" min="0" max="1" step="0.05">
      <output data-value="towns">100%</output>
    </label>
    <label class="quality-row">
      <span>可视距离</span>
      <input type="range" data-setting="drawDistance" min="0.5" max="1.5" step="0.05">
      <output data-value="drawDistance">1.00x</output>
    </label>

    <div class="quality-sep">下次进入生效</div>
    <label class="quality-row">
      <span>抗锯齿</span>
      <select data-setting="antialias">
        <option value="1">开</option>
        <option value="0">关</option>
      </select>
    </label>
    <label class="quality-row">
      <span>地形精度</span>
      <select data-setting="terrain">
        <option value="360">低 360</option>
        <option value="480">中 480</option>
        <option value="600">高 600</option>
        <option value="900">超高 900</option>
      </select>
    </label>
    <label class="quality-row">
      <span>模型细节</span>
      <select data-setting="modelDetail">
        <option value="low">低</option>
        <option value="high">高</option>
      </select>
    </label>

    <p>世界生成项点“生成”后生效；其余画面项即时生效；“下次进入”的三项在重新进入游戏时应用。</p>
    <button class="quality-reset" type="button" data-action="auto">恢复自动设置</button>
  </div>

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
    • <kbd>N</kbd> 切换黑夜/白天 · <kbd>M</kbd> 静音/开启音效<br>
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
const GAME_KEYS = new Set(['KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'Space', 'KeyN', 'KeyC', 'KeyG', 'KeyM']);

/**
 * 渲染 3D 火车驾驶视图
 * @param {HTMLElement} container - 视图容器（#view-root）
 * @returns {Function} cleanup
 */
export function renderTrain3d(container, options = {}) {
  if (typeof activeCleanup === 'function') activeCleanup();
  container.innerHTML = SHELL_HTML;
  const root = container.querySelector('.train3d-page');
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);
  const stage = $('#stage');

  /**
   * 触屏适配：粗指针（手机/平板）或窄窗口都按触屏布局处理。
   * 画质设置优先读取上次选择；没有记录时按设备自动给默认档。
   */
  const touchUi = window.matchMedia('(pointer: coarse)').matches
    || window.matchMedia('(hover: none)').matches
    || window.innerWidth <= 760;

  const SETTINGS_KEY = 'train3d.settings';
  const SETTINGS_VERSION = 3;
  const SETTINGS_SHADOWS = [0, 1024, 1536, 2048];
  const SETTINGS_TERRAIN = [360, 480, 600, 900];
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const finiteOr = (value, fallback) => (value != null && Number.isFinite(Number(value)) ? Number(value) : fallback);

  function autoSettings() {
    const weak = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
      || (navigator.deviceMemory && navigator.deviceMemory <= 4);
    const smallScreen = window.innerWidth <= 900;
    const world = {
      stationCount: 0,
      terrainRelief: 1,
      lakeScale: 1,
      riverScale: 1,
      mountainCount: 0,
      mountainHeight: 1,
      buildingsPerTown: 22
    };
    if (smallScreen) {
      return {
        ...world,
        version: SETTINGS_VERSION,
        resolution: 1.15, shadows: 0,
        vegetation: 0.4, bushes: 0.4, rocks: 0.45, towns: 0.4,
        drawDistance: 1.0, fpsLimit: 0,
        softShadows: false, foliageShadows: false, water: true,
        antialias: false, terrain: 480, modelDetail: 'low'
      };
    }
    if (weak) {
      return {
        ...world,
        version: SETTINGS_VERSION,
        resolution: 1.5, shadows: 1536,
        vegetation: 0.72, bushes: 0.7, rocks: 0.7, towns: 0.65,
        drawDistance: 1.05, fpsLimit: 0,
        softShadows: true, foliageShadows: true, water: true,
        antialias: true, terrain: 600, modelDetail: 'high'
      };
    }
    return {
      ...world,
      version: SETTINGS_VERSION,
      resolution: 2.0, shadows: 2048,
      vegetation: 1, bushes: 1, rocks: 1, towns: 1,
      drawDistance: 1.1, fpsLimit: 0,
      softShadows: true, foliageShadows: true, water: true,
      antialias: true, terrain: 900, modelDetail: 'high'
    };
  }

  function normalizeSettings(raw, base) {
    const s = { ...base, ...(raw || {}) };
    s.resolution = Math.max(0.6, Math.min(2.0, finiteOr(s.resolution, base.resolution)));
    s.shadows = SETTINGS_SHADOWS.includes(Number(s.shadows)) ? Number(s.shadows) : base.shadows;
    s.vegetation = clamp01(finiteOr(s.vegetation, base.vegetation));
    s.bushes = clamp01(finiteOr(s.bushes, base.bushes));
    s.rocks = clamp01(finiteOr(s.rocks, base.rocks));
    s.towns = clamp01(finiteOr(s.towns, base.towns));
    s.drawDistance = Math.max(0.5, Math.min(1.5, finiteOr(s.drawDistance, base.drawDistance)));
    s.fpsLimit = [0, 30, 45, 60, 90, 120].includes(Number(s.fpsLimit)) ? Number(s.fpsLimit) : base.fpsLimit;
    s.softShadows = Boolean(s.softShadows);
    s.foliageShadows = Boolean(s.foliageShadows);
    s.water = Boolean(s.water);
    s.antialias = Boolean(s.antialias);
    s.terrain = SETTINGS_TERRAIN.includes(Number(s.terrain)) ? Number(s.terrain) : base.terrain;
    s.modelDetail = s.modelDetail === 'low' ? 'low' : 'high';
    s.stationCount = [0, 6, 8, 10, 12, 14, 16].includes(Number(s.stationCount)) ? Number(s.stationCount) : base.stationCount;
    s.terrainRelief = Math.max(0.3, Math.min(1.6, finiteOr(s.terrainRelief, base.terrainRelief)));
    s.lakeScale = Math.max(0.4, Math.min(1.4, finiteOr(s.lakeScale, base.lakeScale)));
    s.riverScale = Math.max(0.3, Math.min(1.0, finiteOr(s.riverScale, base.riverScale)));
    s.mountainCount = [-1, 0, 8, 12, 16, 20, 24, 30].includes(Number(s.mountainCount)) ? Number(s.mountainCount) : base.mountainCount;
    s.mountainHeight = Math.max(0.6, Math.min(1.4, finiteOr(s.mountainHeight, base.mountainHeight)));
    s.buildingsPerTown = Math.round(Math.max(6, Math.min(36, finiteOr(s.buildingsPerTown, base.buildingsPerTown))));
    s.version = SETTINGS_VERSION;
    return s;
  }

  function readSettings() {
    const base = autoSettings();
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const migrated = normalizeSettings(parsed, base);
        if (!parsed || parsed.version !== SETTINGS_VERSION) {
          // 旧存档可能压低过渲染分辨率/地形精度：一次性抬到可见清晰度下限
          migrated.resolution = Math.max(migrated.resolution, Math.min(devicePixelRatio || 1, 1.5));
          migrated.drawDistance = Math.max(migrated.drawDistance, 1.0);
          migrated.terrain = Math.max(migrated.terrain, 480);
          migrated.antialias = true;
          try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(migrated));
          } catch (error) {
            // 忽略持久化失败
          }
        }
        return migrated;
      }
    } catch (error) {
      // 损坏的存档/隐私模式回退到自动设置
    }
    return base;
  }

  let settings = readSettings();
  const lowDetail = settings.modelDetail === 'low';

  /* ============================================================
     世界种子：同一字符串生成同一套轨道/地形/植被/城镇
     ============================================================ */
  const SEED_KEY = 'train3d.seed';

  function randomSeed() {
    return Math.random().toString(36).slice(2, 10);
  }

  function normalizeSeed(value) {
    const text = String(value == null ? '' : value).trim().slice(0, 40);
    return text || randomSeed();
  }

  function readWorldSeed() {
    try {
      const saved = localStorage.getItem(SEED_KEY);
      if (saved) return normalizeSeed(saved);
    } catch (error) {
      // 隐私模式下使用临时随机种子
    }
    const seed = randomSeed();
    try {
      localStorage.setItem(SEED_KEY, seed);
    } catch (error) {
      // 忽略持久化失败
    }
    return seed;
  }

  function hashSeed(value) {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function random() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const WORLD_SEED = options.seed ? normalizeSeed(options.seed) : readWorldSeed();
  const rand = mulberry32(hashSeed(WORLD_SEED));

  /** 统一登记监听，卸载时逐条注销 */
  const teardown = [];
  const on = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    teardown.push(() => target.removeEventListener(type, fn, opts));
  };

  on($('.train3d-back'), 'click', () => go('games'));

  /* ---- 音效解锁：浏览器要求首次用户手势后才能出声 ---- */
  let audioStartedAt = 0;
  const unlockAudio = () => {
    const hadContext = Boolean(audio.ctx);
    audio.ensureStarted();
    if (!hadContext) {
      if (audio.ctx) audioStartedAt = performance.now();
      updateAudioUi();
    } else if (audio.ctx && audio.ctx.state === 'suspended') {
      updateAudioUi();
    }
  };
  on(window, 'pointerdown', unlockAudio, { capture: true });
  on(window, 'keydown', unlockAudio, { capture: true });
  on($('#audio-mode'), 'click', () => {
    if (!audio.ctx) {
      audio.ensureStarted();
      if (audio.ctx) audioStartedAt = performance.now();
      updateAudioUi();
      return;
    }
    // pointerdown 解锁与 click 同一次点击时，不要立刻把刚打开的音效又静音
    if (performance.now() - audioStartedAt < 400) return;
    toggleAudioMute();
  });



  /* ============================================================
     0. 常量
     ============================================================ */
  const WATER_LEVEL = 0;
  const STOP_OFFSET = 22.5;          // 停车目标 = 站台中心 + 该偏移（6 节车厢居中）
  const STOP_WINDOW = 10;            // 手动停靠允许偏差
  const FRAME_COUNT = 3000;
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const CAR_SPACING = 9;
  const CAR_COUNT = 6;

  /* 过弯倾摆：按 v²κ/g 计算理论倾角，再乘视觉增益并限幅 */
  const TRAIN_TILT_GAIN = 0.55;
  const TRAIN_MAX_TILT = 0.10;       // rad ≈ 5.7°
  const TRAIN_TILT_SMOOTH = 4.0;
  const GRAVITY = 9.81;

  /* 挡位连发 */
  const HOLD_DELAY_MS = 350;
  const REPEAT_INTERVAL_MS = 120;

  /* 自动控制 */
  const AUTO_CRUISE = 185 / 3.6;         // 区间目标速度 185 km/h（曲线区自动降速）
  const AUTO_DWELL_TIME = 5.0;           // 站停时间
  const AUTO_PERFECT_DEVIATION = 0.35;   // 完美停靠偏差阈值（米）
  const AUTO_GOOD_DEVIATION = 1.0;       // 良好停靠偏差阈值（米）

  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _sunOffset = new THREE.Vector3(130, 220, 90);


  /* ============================================================
     1. 渲染器 / 场景 / 相机
     ============================================================ */
  const renderer = new THREE.WebGLRenderer({
    antialias: settings.antialias,
    powerPreference: 'high-performance'
  });
  renderer.setSize(Math.max(1, stage.clientWidth), Math.max(1, stage.clientHeight));
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.resolution));
  renderer.shadowMap.enabled = settings.shadows > 0;
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
  sun.castShadow = settings.shadows > 0;
  const initialShadowSize = Math.max(1024, settings.shadows || 1024);
  sun.shadow.mapSize.set(initialShadowSize, initialShadowSize);
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

  scene.fog = new THREE.FogExp2(0x9bc4e2, 0.00018 / settings.drawDistance);

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
      scene.fog = new THREE.FogExp2(0x1a2538, 0.0006 / settings.drawDistance);
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
      scene.fog = new THREE.FogExp2(0x9bc4e2, 0.00018 / settings.drawDistance);
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
  /* 内圈河谷：从中央湖向外延伸，在地形上切出一条低于水面的河床 */
  const terrainBase = 105 + rand() * 35;
  const terrainWave = [
    { freq: 0.0014 + rand() * 0.0012, amp: (18 + rand() * 24) * settings.terrainRelief, phase: rand() * Math.PI * 2 },
    { freq: 0.0021 + rand() * 0.0014, amp: (22 + rand() * 28) * settings.terrainRelief, phase: rand() * Math.PI * 2 },
    { freq: 0.0042 + rand() * 0.0022, amp: (10 + rand() * 16) * settings.terrainRelief, phase: rand() * Math.PI * 2 }
  ];
  const lakeAngle = rand() * Math.PI * 2;
  const lakeCenterR = rand() * 180;
  const lakeX = Math.cos(lakeAngle) * lakeCenterR;
  const lakeZ = Math.sin(lakeAngle) * lakeCenterR;
  const lakeRadius = (800 + rand() * 380) * settings.lakeScale;
  const lakeDepth = 130 + rand() * 55;

  const riverAngle = rand() * Math.PI * 2;
  const riverSteps = 8 + Math.floor(rand() * 4);
  const riverWiggle = 0.12 + rand() * 0.14;
  const riverWiggleFreq = 0.6 + rand() * 0.8;
  const riverPhase = rand() * Math.PI * 2;
  const riverEnd = Math.max(lakeRadius * 0.55, (1250 + rand() * 400) * settings.riverScale);
  const riverStart = lakeRadius * 0.35;
  const riverBank = 70 + rand() * 35;
  const riverPath = [];
  for (let i = 0; i < riverSteps; i++) {
    const u = i / (riverSteps - 1);
    const dist = riverStart + u * (riverEnd - riverStart);
    const a = riverAngle + Math.sin(u * Math.PI * 2 * riverWiggleFreq + riverPhase) * riverWiggle;
    riverPath.push({ x: lakeX + Math.cos(a) * dist, z: lakeZ + Math.sin(a) * dist });
  }
  function riverDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i < riverPath.length - 1; i++) {
      const a = riverPath[i];
      const b = riverPath[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const apx = x - a.x;
      const apz = z - a.z;
      const len2 = abx * abx + abz * abz;
      const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apz * abz) / len2)) : 0;
      const dx = x - (a.x + abx * t);
      const dz = z - (a.z + abz * t);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  function getTerrainHeight(x, z) {
    let y = terrainBase;
    y += Math.sin(x * terrainWave[0].freq + terrainWave[0].phase) * terrainWave[0].amp;
    y += Math.cos(z * terrainWave[1].freq + terrainWave[1].phase) * terrainWave[1].amp;
    y += Math.sin((x + z) * terrainWave[2].freq + terrainWave[2].phase) * terrainWave[2].amp;
    const lakeDist = Math.sqrt((x - lakeX) ** 2 + (z - lakeZ) ** 2);
    if (lakeDist < lakeRadius) {
      const t = lakeDist / lakeRadius;
      y -= (1 - t * t) * lakeDepth;
    }
    const riverDist = riverDistance(x, z);
    if (riverDist < riverBank) {
      const carve = 1 - THREE.MathUtils.smoothstep(riverDist, riverBank * 0.28, riverBank);
      y = y * (1 - carve) + (WATER_LEVEL - 7) * carve;
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
  const trackPointCount = 16 + Math.floor(rand() * 9);
  const trackBaseRadius = 3000 + rand() * 300;
  const trackHarmonic = 2 + Math.floor(rand() * 3);
  const trackPhase = rand() * Math.PI * 2;
  const trackRadialAmp = 300 + rand() * 300;
  const trackSecondFreq = 5 + Math.floor(rand() * 3);
  const trackSecondAmp = 80 + rand() * 100;
  const trackAngleJitter = 0.03 + rand() * 0.05;
  const trackControlPoints = [];
  for (let i = 0; i < trackPointCount; i++) {
    const baseAngle = (i / trackPointCount) * Math.PI * 2;
    const angle = baseAngle + (rand() - 0.5) * trackAngleJitter;
    const r = trackBaseRadius
      + Math.sin(baseAngle * trackHarmonic + trackPhase) * trackRadialAmp
      + Math.sin(baseAngle * trackSecondFreq + trackPhase * 1.7) * trackSecondAmp;
    trackControlPoints.push(new THREE.Vector2(Math.cos(angle) * r, Math.sin(angle) * r));
  }

  const trackCurveXZ = new THREE.CatmullRomCurve3(
    trackControlPoints.map(p => new THREE.Vector3(p.x, 0, p.y)),
    true, 'centripetal'
  );

  const rawY = [];
  const N_SAMPLE = 480;
  for (let i = 0; i < N_SAMPLE; i++) {
    const t = i / N_SAMPLE;
    const p = trackCurveXZ.getPointAt(t);
    let y = getTerrainHeight(p.x, p.z);
    if (p.length() < 1100) y = 50;
    rawY.push(y + 2.0);
  }

  // 轨道纵断面：轻度平滑短尺度折点，并限制桥梁/路堑高度，
  // 避免大范围削山或把整条线路抬成高架。
  let smoothY = rawY;
  const smoothRadius = 8;
  for (let pass = 0; pass < 2; pass++) {
    const next = [];
    for (let i = 0; i < N_SAMPLE; i++) {
      let sum = 0;
      for (let j = -smoothRadius; j <= smoothRadius; j++) {
        sum += smoothY[(i + j + N_SAMPLE) % N_SAMPLE];
      }
      next.push(sum / (smoothRadius * 2 + 1));
    }
    smoothY = next;
  }
  for (let i = 0; i < N_SAMPLE; i++) {
    const d = smoothY[i] - rawY[i];
    if (d > 16) smoothY[i] = rawY[i] + 16 + (d - 16) * 0.12;
    else if (d < -9) smoothY[i] = rawY[i] - 9 + (d + 9) * 0.12;
  }
  {
    const next = [];
    for (let i = 0; i < N_SAMPLE; i++) {
      let sum = 0;
      for (let j = -2; j <= 2; j++) {
        sum += smoothY[(i + j + N_SAMPLE) % N_SAMPLE];
      }
      next.push(sum / 5);
    }
    smoothY = next;
  }

  const finalTrackPoints = [];
  const SAMPLE_N = 1600;
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
  trackCurve.arcLengthDivisions = 5000;
  trackCurve.updateArcLengths();
  const trackLength = trackCurve.getLength();

  /* 隧道段：轨道低于自然地面的区段，保留山体，不再挖成路堑 */
  const TUNNEL_DEPTH = 7.0;
  const TUNNEL_MIN_LENGTH = 18;
  const TUNNEL_PORTAL_DEPTH = 4.2;
  const tunnelRanges = [];
  {
    const samples = Math.max(500, Math.ceil(trackLength / 6));
    let startT = -1;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const p = trackCurve.getPointAt(t % 1);
      const depth = getTerrainHeight(p.x, p.z) - p.y;
      const active = depth > TUNNEL_DEPTH;
      if (active && startT < 0) startT = t;
      if ((!active || i === samples) && startT >= 0) {
        const endT = i === samples ? 1 : t;
        if ((endT - startT) * trackLength >= TUNNEL_MIN_LENGTH) {
          tunnelRanges.push({ startT, endT });
        }
        startT = -1;
      }
    }
  }
  function isTunnelT(t) {
    for (const range of tunnelRanges) {
      if (t >= range.startT && t <= range.endT) return true;
    }
    return false;
  }

  // 洞门从“埋深 7m 的山腹”外扩到“刚好覆盖隧道顶 4.2m 的山脚”，
  // 否则 4.2m 高的洞口会被 7m 厚的山体整个埋住。
  {
    const portalStep = 4 / Math.max(1, trackLength);
    for (const range of tunnelRanges) {
      let s = range.startT;
      let moved = 0;
      while (s > 0.005 && moved < 120) {
        const prevT = (s - portalStep + 1) % 1;
        const p = trackCurve.getPointAt(prevT);
        if (getTerrainHeight(p.x, p.z) - p.y < TUNNEL_PORTAL_DEPTH) break;
        s = prevT;
        moved += 4;
      }
      range.startT = s;

      let e = range.endT;
      moved = 0;
      while (e < 0.995 && moved < 120) {
        const nextT = (e + portalStep) % 1;
        const p = trackCurve.getPointAt(nextT);
        if (getTerrainHeight(p.x, p.z) - p.y < TUNNEL_PORTAL_DEPTH) break;
        e = nextT;
        moved += 4;
      }
      range.endT = e;
    }
  }

  // 洞门外侧的削坡切口：把草坡在洞口附近压下去，露出洞门和岩土面
  const tunnelPortalCuts = [];
  for (const range of tunnelRanges) {
    for (const [t, outwardSign] of [[range.startT, -1], [range.endT, 1]]) {
      const p = trackCurve.getPointAt(t);
      const tan = trackCurve.getTangentAt(t).normalize();
      tunnelPortalCuts.push({
        x: p.x, z: p.z, y: p.y,
        ox: tan.x * outwardSign,
        oz: tan.z * outwardSign
      });
    }
  }

  const lookupPoints = [];
  for (let i = 0; i < 2200; i++) {
    const t = i / 2200;
    const p = trackCurve.getPointAt(t);
    p.tunnel = isTunnelT(t);
    lookupPoints.push(p);
  }
  const trackLookup = makeLookup(lookupPoints, 100);

  function getGroundY(x, z, naturalY = getTerrainHeight(x, z)) {
    const hit = queryLookup(trackLookup, x, z, 80);
    if (!hit) return naturalY;
    for (const portal of tunnelPortalCuts) {
      const dx = x - portal.x;
      const dz = z - portal.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 24) {
        const along = dx * portal.ox + dz * portal.oz;
        if (along > -2) {
          const blend = THREE.MathUtils.smoothstep(dist, 10, 24);
          return (portal.y - 1.6) * (1 - blend) + naturalY * blend;
        }
      }
    }
    if (hit.point.tunnel) return naturalY;
    const flatY = hit.point.y - 1.5;
    const diff = flatY - naturalY;
    // 高架段不要再把地面抬到轨道底下，否则桥墩和桥下净空会被土方填掉
    const bridge = THREE.MathUtils.smoothstep(diff, 6, 16);
    if (bridge >= 0.999) return naturalY;

    const support = 1 - THREE.MathUtils.smoothstep(diff, 25, 65);
    const flatTarget = naturalY + (flatY - naturalY) * support;
    let ground;
    if (hit.dist < 12) {
      ground = flatTarget;
    } else {
      const t = THREE.MathUtils.smoothstep(hit.dist, 12, 40);
      ground = flatTarget * (1 - t) + naturalY * t;
    }
    return ground * (1 - bridge) + naturalY * bridge;
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
  const CURVE_LAT_LIMIT = 2.8;       // 允许的横向加速度 m/s²（提高后过弯减速更温和）
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
  const GROUND_SEG = settings.terrain;
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
    // 程序化地表纹理：给大片平滑地形增加细碎草/土/田块层次，远景不再是一整块色斑
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const texCtx = canvas.getContext('2d');
    texCtx.fillStyle = '#e8e8df';
    texCtx.fillRect(0, 0, 512, 512);
    let texState = hashSeed('ground:' + WORLD_SEED);
    const texRand = () => {
      texState = (Math.imul(texState, 1664525) + 1013904223) >>> 0;
      return texState / 4294967296;
    };
    for (let i = 0; i < 220; i++) {
      const x = texRand() * 512;
      const y = texRand() * 512;
      const r = 8 + texRand() * 70;
      const light = texRand() > 0.5;
      texCtx.fillStyle = light
        ? `rgba(255,255,245,${0.035 + texRand() * 0.05})`
        : `rgba(55,65,40,${0.025 + texRand() * 0.045})`;
      texCtx.beginPath();
      texCtx.arc(x, y, r, 0, Math.PI * 2);
      texCtx.fill();
    }
    for (let i = 0; i < 7000; i++) {
      const x = texRand() * 512;
      const y = texRand() * 512;
      const dark = texRand() > 0.45;
      texCtx.fillStyle = dark
        ? `rgba(45,55,35,${0.05 + texRand() * 0.12})`
        : `rgba(255,255,245,${0.05 + texRand() * 0.12})`;
      texCtx.fillRect(x, y, 1 + texRand() * 2, 1 + texRand() * 2);
    }
    for (let i = 0; i < 70; i++) {
      const x = texRand() * 512;
      const y = texRand() * 512;
      texCtx.strokeStyle = `rgba(75,80,55,${0.04 + texRand() * 0.08})`;
      texCtx.lineWidth = 1 + texRand() * 2;
      texCtx.beginPath();
      texCtx.moveTo(x, y);
      texCtx.lineTo(x + (texRand() - 0.5) * 180, y + (texRand() - 0.5) * 180);
      texCtx.stroke();
    }
    const groundTex = new THREE.CanvasTexture(canvas);
    groundTex.wrapS = groundTex.wrapT = THREE.RepeatWrapping;
    groundTex.repeat.set(64, 64);
    groundTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundMat.map = groundTex;
    groundMat.needsUpdate = true;
  }
  {
    const pos = groundGeo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = pos.getY(i);
      if (y < WATER_LEVEL) c.setHex(0xc2b280);
      else if (y < WATER_LEVEL + 15) c.setHex(0xd2b48c);
      else if (y < 70) c.setHex(0x6d9b58);
      else if (y < 110) c.setHex(0x557a43);
      else if (y < 160) c.setHex(0x4a6b3c);
      else if (y < 190) c.setHex(0x77776c);
      else c.setHex(0xe8eef2);
      // 轻微色相/明度变化，避免大片单色
      const n = Math.sin(x * 0.013 + z * 0.009) * 0.5 + 0.5;
      c.offsetHSL((n - 0.5) * 0.012, 0, (n - 0.5) * 0.055);
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
  const STATION_NAMES = [
    '森林站', '溪谷站', '湖畔站', '高架站', '雪山站', '矿场站',
    '花田站', '平原站', '古镇站', '海岸站', '云岭站',
    '晨雾站', '松林站', '石桥站', '风车镇', '月台站', '远山站'
  ];
  {
    for (let i = STATION_NAMES.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [STATION_NAMES[i], STATION_NAMES[j]] = [STATION_NAMES[j], STATION_NAMES[i]];
    }
  }
  const randomStationCount = 8 + Math.floor(rand() * 5);
  const stationCount = settings.stationCount || randomStationCount;

  const STATION_PLATFORM_CHECK = 6.25;
  const STATION_TUNNEL_MARGIN = 90 / trackLength;
  function terrainSpreadAt(cx, cz, tan, side, radius) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [along, across] of [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]]) {
      const x = cx + tan.x * along + side.x * across;
      const z = cz + tan.z * along + side.z * across;
      const y = getTerrainHeight(x, z);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return maxY - minY;
  }

  function stationSiteScore(t) {
    const p = trackCurve.getPointAt(t);
    const tan = trackCurve.getTangentAt(t).normalize();
    const side = new THREE.Vector3().crossVectors(WORLD_UP, tan).normalize();
    // 站台和雨棚不能压在隧道口/隧道段上
    for (const range of tunnelRanges) {
      if (t + STATION_TUNNEL_MARGIN > range.startT && t - STATION_TUNNEL_MARGIN < range.endT) {
        return -1e9;
      }
    }
    const naturalTrack = getTerrainHeight(p.x, p.z);
    const clearance = p.y - naturalTrack;
    if (naturalTrack < WATER_LEVEL + 1.5) return -1e9;
    if (clearance > 5) return -1e9; // 不把站台放在高架桥上
    if (clearance < -2) return -1e9; // 也不放在路堑/隧道里

    const platformX = p.x + side.x * STATION_PLATFORM_CHECK;
    const platformZ = p.z + side.z * STATION_PLATFORM_CHECK;
    const platformNatural = getTerrainHeight(platformX, platformZ);
    if (platformNatural < WATER_LEVEL + 1.5) return -1e9;
    const platformSpread = terrainSpreadAt(platformX, platformZ, tan, side, 8);

    let townSpread = 0;
    for (const townDist of [100, 160]) {
      const tx = p.x - side.x * townDist;
      const tz = p.z - side.z * townDist;
      const townNatural = getTerrainHeight(tx, tz);
      if (townNatural < WATER_LEVEL + 1.5) return -1e9;
      townSpread = Math.max(townSpread, terrainSpreadAt(tx, tz, tan, side, 14));
    }

    const pAhead = trackCurve.getPointAt((t + 0.002) % 1);
    const pBehind = trackCurve.getPointAt((t - 0.002 + 1) % 1);
    const grade = Math.abs(pAhead.y - pBehind.y);
    const tanA = trackCurve.getTangentAt((t + 0.004) % 1);
    const tanB = trackCurve.getTangentAt((t - 0.004 + 1) % 1);
    const curve = 1 - Math.max(-1, Math.min(1, tanA.dot(tanB)));
    const cut = Math.max(0, -clearance);
    const platformDrop = Math.max(0, p.y - platformNatural);

    return -clearance * clearance * 40
      - platformDrop * 3
      - platformSpread * 4
      - townSpread * 1.5
      - grade * 25
      - curve * 1200
      - cut * 50;
  }

  const stations = [];
  const minStationGap = 0.55 / stationCount;
  let prevStationT = -1;
  for (let i = 0; i < stationCount; i++) {
    const desired = (i + 0.5 + (rand() - 0.5) * 0.16) / stationCount;
    const window = 0.7 / stationCount;
    const minSearchT = i === 0 ? 0.35 / stationCount : 0.008;
    const maxSearchT = i === stationCount - 1 ? 1 - 0.35 / stationCount : 0.992;
    let bestT = null;
    let bestScore = -Infinity;
    const steps = 72;
    for (let s = 0; s <= steps; s++) {
      const t = desired - window + (s / steps) * window * 2;
      if (t < minSearchT || t > maxSearchT) continue;
      if (i > 0 && t - prevStationT < minStationGap) continue;
      const score = stationSiteScore(t);
      if (score < -1e8) continue;
      if (score > bestScore) {
        bestScore = score;
        bestT = t;
      }
    }
    if (bestT === null) {
      // 窗口内全是桥/水/陡坡时，退到整圈搜索可用站点（降采样，避免生成卡顿）
      for (let t = minSearchT; t <= maxSearchT; t += 0.004) {
        if (i > 0 && t - prevStationT < minStationGap) continue;
        const score = stationSiteScore(t);
        if (score < -1e8) continue;
        if (score > bestScore) {
          bestScore = score;
          bestT = t;
        }
      }
    }
    if (bestT === null) {
      bestT = Math.min(0.985, Math.max(desired, prevStationT + minStationGap));
    }
    stations.push({
      name: i === stationCount - 1 ? '终点站' : STATION_NAMES[i],
      t: bestT
    });
    prevStationT = bestT;
  }

  function getBasis(tan) {
    const side = new THREE.Vector3().crossVectors(WORLD_UP, tan).normalize();
    const up = new THREE.Vector3().crossVectors(tan, side).normalize();
    return { side, up };
  }

  /* 每个车站旁预留一片城镇用地（比站台更靠线路外侧，避免和站房重叠） */
  const townCenters = stations.map((station) => {
    const p = trackCurve.getPointAt(station.t);
    const tan = trackCurve.getTangentAt(station.t).normalize();
    const { side } = getBasis(tan);
    const dist = 100 + rand() * 60;
    const x = p.x - side.x * dist;
    const z = p.z - side.z * dist;
    return { x, z, y: getGroundY(x, z), dist };
  });

  /* ============================================================
     8. 森林
     ============================================================ */
  const detailGroups = [];
  (function generateForest() {
    const TREE_COUNT = 7600;
    const trunkGeo = new THREE.CylinderGeometry(1, 1.5, 8, 5);
    trunkGeo.translate(0, 4, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3d28 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, TREE_COUNT);
    trunks.receiveShadow = true;

    const crownGeo = new THREE.ConeGeometry(5, 18, 7);
    crownGeo.translate(0, 15, 0);
    const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true });
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, TREE_COUNT);
    crowns.castShadow = true;
    crowns.receiveShadow = true;

    const palette = [0x2f6b3a, 0x3d7a45, 0x4b8a4e, 0x2a5f38, 0x6b8f3e, 0x356b33];
    const color = new THREE.Color();
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < TREE_COUNT * 6 && placed < TREE_COUNT; i++) {
      const x = (rand() - 0.5) * 10500;
      const z = (rand() - 0.5) * 10500;
      const natural = getTerrainHeight(x, z);
      const y = getGroundY(x, z, natural);
      if (y < WATER_LEVEL + 2 || y > 185) continue;
      if (queryLookup(trackLookup, x, z, 50)) continue;
      if (riverDistance(x, z) < 110) continue;
      if (townCenters.some(tc => (x - tc.x) ** 2 + (z - tc.z) ** 2 < 85 * 85)) continue;

      const scale = 0.55 + rand() * 1.55;
      dummy.position.set(x, y, z);
      dummy.rotation.y = rand() * Math.PI * 2;
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      crowns.setMatrixAt(placed, dummy.matrix);
      crowns.setColorAt(placed, color.setHex(palette[placed % palette.length]));
      placed++;
    }
    trunks.count = placed; crowns.count = placed;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    detailGroups.push({ key: 'vegetation', max: placed, meshes: [trunks, crowns] });
    scene.add(trunks, crowns);
  })();

  /* 灌木 / 岩石：让线路两侧不至于只有草皮 */
  (function generateUndergrowth() {
    const BUSH_COUNT = 1800;
    const bushGeo = new THREE.DodecahedronGeometry(1, 0);
    bushGeo.translate(0, 0.5, 0);
    const bushMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1 });
    const bushes = new THREE.InstancedMesh(bushGeo, bushMat, BUSH_COUNT);
    bushes.receiveShadow = true;
    const bushPalette = [0x4f7a3e, 0x5e8a45, 0x3f6b3a, 0x6f8f4c];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let bushPlaced = 0;
    for (let i = 0; i < BUSH_COUNT * 5 && bushPlaced < BUSH_COUNT; i++) {
      const x = (rand() - 0.5) * 10500;
      const z = (rand() - 0.5) * 10500;
      const y = getGroundY(x, z);
      if (y < WATER_LEVEL + 2 || y > 170) continue;
      if (queryLookup(trackLookup, x, z, 30)) continue;
      if (riverDistance(x, z) < 55) continue;
      if (townCenters.some(tc => (x - tc.x) ** 2 + (z - tc.z) ** 2 < 55 * 55)) continue;
      const scale = 0.6 + rand() * 1.6;
      dummy.position.set(x, y, z);
      dummy.rotation.y = rand() * Math.PI * 2;
      dummy.scale.set(scale * 1.4, scale * 0.75, scale * 1.4);
      dummy.updateMatrix();
      bushes.setMatrixAt(bushPlaced, dummy.matrix);
      bushes.setColorAt(bushPlaced, color.setHex(bushPalette[bushPlaced % bushPalette.length]));
      bushPlaced++;
    }
    bushes.count = bushPlaced;
    if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
    detailGroups.push({ key: 'bushes', max: bushPlaced, meshes: [bushes] });
    scene.add(bushes);

    const ROCK_COUNT = 620;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockGeo.translate(0, 0.5, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8a80, flatShading: true, roughness: 1 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_COUNT);
    rocks.castShadow = true;
    rocks.receiveShadow = true;
    let rockPlaced = 0;
    for (let i = 0; i < ROCK_COUNT * 5 && rockPlaced < ROCK_COUNT; i++) {
      const x = (rand() - 0.5) * 10500;
      const z = (rand() - 0.5) * 10500;
      const y = getGroundY(x, z);
      if (y < WATER_LEVEL + 2 || y > 190) continue;
      if (queryLookup(trackLookup, x, z, 40)) continue;
      if (townCenters.some(tc => (x - tc.x) ** 2 + (z - tc.z) ** 2 < 45 * 45)) continue;
      const scale = 0.7 + rand() * 2.8;
      dummy.position.set(x, y, z);
      dummy.rotation.y = rand() * Math.PI * 2;
      dummy.scale.set(scale * 1.3, scale * 0.8, scale);
      dummy.updateMatrix();
      rocks.setMatrixAt(rockPlaced, dummy.matrix);
      rockPlaced++;
    }
    rocks.count = rockPlaced;
    detailGroups.push({ key: 'rocks', max: rockPlaced, meshes: [rocks] });
    scene.add(rocks);
  })();

  /* 远景雪山：更宽、更矮、带不规则山脊和绿色山脚，避免一排黑色尖锥 */
  (function createMountains() {
    const randomMountainCount = 10 + Math.floor(rand() * 7);
    const MOUNTAIN_COUNT = settings.mountainCount === -1
      ? 0
      : (settings.mountainCount || randomMountainCount);
    if (MOUNTAIN_COUNT === 0) return;
    const mountainGeo = new THREE.ConeGeometry(1, 1, 11, 6);
    mountainGeo.translate(0, 0.5, 0);
    {
      const pos = mountainGeo.attributes.position;
      let ridgeState = hashSeed('ridge:' + WORLD_SEED);
      const ridgeRand = () => {
        ridgeState = (Math.imul(ridgeState, 1664525) + 1013904223) >>> 0;
        return ridgeState / 4294967296;
      };
      const phaseA = ridgeRand() * Math.PI * 2;
      const phaseB = ridgeRand() * Math.PI * 2;
      const color = new THREE.Color();
      const rockLow = new THREE.Color(0x59614f);
      const rockMid = new THREE.Color(0x6d685d);
      const rockHigh = new THREE.Color(0x5c5a54);
      const green = new THREE.Color(0x4c6a45);
      const snow = new THREE.Color(0xe8eef2);
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        let x = pos.getX(i);
        let z = pos.getZ(i);
        const y = pos.getY(i);
        const angle = Math.atan2(z, x);
        if (y < 0.995) {
          const spread = 1 - y;
          const ridge = 1
            + (Math.sin(angle * 3 + phaseA) * 0.16 + Math.sin(angle * 7 + phaseB) * 0.08) * spread
            + Math.sin(angle * 11 + phaseA * 1.7) * 0.04 * spread;
          x *= ridge;
          z *= ridge;
          pos.setX(i, x);
          pos.setZ(i, z);
        }
        const snowT = THREE.MathUtils.smoothstep(y, 0.58, 0.74);
        color.copy(rockLow).lerp(rockMid, THREE.MathUtils.smoothstep(y, 0.05, 0.5));
        color.lerp(rockHigh, THREE.MathUtils.smoothstep(y, 0.4, 0.82) * 0.35);
        color.lerp(green, (1 - THREE.MathUtils.smoothstep(y, 0.02, 0.2)) * 0.55);
        color.lerp(snow, snowT);
        color.offsetHSL(0, 0, Math.sin(angle * 5 + phaseB) * 0.025);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      mountainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }
    mountainGeo.computeVertexNormals();
    const mountainMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 1, metalness: 0,
      emissive: 0x11110d, emissiveIntensity: 0.25
    });
    const mountains = new THREE.InstancedMesh(mountainGeo, mountainMat, MOUNTAIN_COUNT);
    mountains.receiveShadow = true;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < MOUNTAIN_COUNT; i++) {
      const angle = (i / MOUNTAIN_COUNT) * Math.PI * 2 + (rand() - 0.5) * 0.35;
      const radius = 4800 + rand() * 900;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const baseY = getGroundY(x, z) - 12;
      const R = 360 + rand() * 420;
      const H = (220 + rand() * 300) * settings.mountainHeight;
      dummy.position.set(x, baseY, z);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(R, H, R);
      dummy.updateMatrix();
      mountains.setMatrixAt(i, dummy.matrix);
    }
    scene.add(mountains);
  })();


  /* ============================================================
     9. 轨道 / 轨枕 / 桥墩
     ============================================================ */
  const trackGroup = new THREE.Group();
  scene.add(trackGroup);

  (function buildTrack() {
    const N = 1600;
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
     9.5 隧道 / 明洞
     ============================================================ */
  const TUNNEL_HEIGHT = 4.2;
  const TUNNEL_HALF = 2.8;
  (function buildTunnels() {
    if (!tunnelRanges.length) return;
    const tunnelMat = new THREE.MeshStandardMaterial({
      color: 0x6e6a60, emissive: 0x2a2820, emissiveIntensity: 0.8,
      roughness: 1, metalness: 0, side: THREE.DoubleSide
    });
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x3a3b37, roughness: 1, metalness: 0, side: THREE.DoubleSide
    });
    const bandMat = new THREE.MeshStandardMaterial({
      color: 0xc5c1b0, roughness: 0.9, metalness: 0, side: THREE.DoubleSide
    });
    const portalMat = new THREE.MeshStandardMaterial({
      color: 0x99998f, roughness: 0.9, metalness: 0.05
    });
    const lightMat = new THREE.MeshBasicMaterial({
      color: 0xffd58a, toneMapped: false, side: THREE.DoubleSide
    });

    const frameAt = (t) => {
      const p = trackCurve.getPointAt(t);
      const tan = trackCurve.getTangentAt(t).normalize();
      const side = new THREE.Vector3().crossVectors(WORLD_UP, tan).normalize();
      const up = new THREE.Vector3().crossVectors(tan, side).normalize();
      return { p, tan, side, up };
    };

    for (const range of tunnelRanges) {
      const runLength = (range.endT - range.startT) * trackLength;
      const segments = Math.max(2, Math.ceil(runLength / 4));
      const positions = [];
      const indices = [];
      const floorPositions = [];
      const floorIndices = [];
      const bandPositions = [];
      const bandIndices = [];

      for (let s = 0; s <= segments; s++) {
        const t = range.startT + (range.endT - range.startT) * (s / segments);
        const { p, side, up } = frameAt(t);
        for (const [x, y] of [
          [-TUNNEL_HALF, -0.25], [-TUNNEL_HALF, TUNNEL_HEIGHT],
          [TUNNEL_HALF, TUNNEL_HEIGHT], [TUNNEL_HALF, -0.25]
        ]) {
          positions.push(
            p.x + side.x * x + up.x * y,
            p.y + side.y * x + up.y * y,
            p.z + side.z * x + up.z * y
          );
        }
        for (const x of [-TUNNEL_HALF, TUNNEL_HALF]) {
          floorPositions.push(
            p.x + side.x * x - up.x * 0.18,
            p.y + side.y * x - up.y * 0.18,
            p.z + side.z * x - up.z * 0.18
          );
        }
        // 两侧墙脚浅色导向带（向洞内偏移一点，避免与墙面 z-fighting）
        for (const x of [-TUNNEL_HALF, TUNNEL_HALF]) {
          const bx = x > 0 ? x - 0.04 : x + 0.04;
          for (const y of [0.55, 1.35]) {
            bandPositions.push(
              p.x + side.x * bx + up.x * y,
              p.y + side.y * bx + up.y * y,
              p.z + side.z * bx + up.z * y
            );
          }
        }
      }

      for (let s = 0; s < segments; s++) {
        const a = s * 4;
        const b = a + 4;
        // 左壁 / 顶板 / 右壁
        indices.push(a, a + 1, b, a + 1, b + 1, b);
        indices.push(a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
        indices.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);

        const fa = s * 2;
        const fb = fa + 2;
        floorIndices.push(fa, fb, fa + 1, fb, fb + 1, fa + 1);

        const ba = s * 4;
        const bb = ba + 4;
        bandIndices.push(ba, ba + 1, bb, ba + 1, bb + 1, bb);
        bandIndices.push(ba + 2, ba + 3, bb + 2, ba + 3, bb + 3, bb + 2);
      }

      const tunnelGeo = new THREE.BufferGeometry();
      tunnelGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      tunnelGeo.setIndex(indices);
      tunnelGeo.computeVertexNormals();
      scene.add(new THREE.Mesh(tunnelGeo, tunnelMat));

      const floorGeo = new THREE.BufferGeometry();
      floorGeo.setAttribute('position', new THREE.Float32BufferAttribute(floorPositions, 3));
      floorGeo.setIndex(floorIndices);
      floorGeo.computeVertexNormals();
      scene.add(new THREE.Mesh(floorGeo, floorMat));

      const bandGeo = new THREE.BufferGeometry();
      bandGeo.setAttribute('position', new THREE.Float32BufferAttribute(bandPositions, 3));
      bandGeo.setIndex(bandIndices);
      bandGeo.computeVertexNormals();
      scene.add(new THREE.Mesh(bandGeo, bandMat));

      // 顶灯做成一段段小灯，而不是一条连续灯带；连续灯带在驾驶室视角会变成巨大三角形
      const lightPositions = [];
      const lightIndices = [];
      const lightCount = Math.max(1, Math.floor(runLength / 14));
      for (let k = 0; k < lightCount; k++) {
        const d0 = 3 + (k + 0.5) * Math.max(1, runLength - 6) / lightCount;
        const d1 = d0 + 1.4;
        const t0 = range.startT + (d0 / runLength) * (range.endT - range.startT);
        const t1 = range.startT + (d1 / runLength) * (range.endT - range.startT);
        const f0 = frameAt(t0);
        const f1 = frameAt(t1);
        const base = lightPositions.length / 3;
        const lightY = TUNNEL_HEIGHT - 0.07;
        for (const f of [f0, f1]) {
          for (const x of [-0.28, 0.28]) {
            lightPositions.push(
              f.p.x + f.side.x * x + f.up.x * lightY,
              f.p.y + f.side.y * x + f.up.y * lightY,
              f.p.z + f.side.z * x + f.up.z * lightY
            );
          }
        }
        lightIndices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
      if (lightPositions.length) {
        const lightGeo = new THREE.BufferGeometry();
        lightGeo.setAttribute('position', new THREE.Float32BufferAttribute(lightPositions, 3));
        lightGeo.setIndex(lightIndices);
        lightGeo.computeVertexNormals();
        scene.add(new THREE.Mesh(lightGeo, lightMat));
      }

      const addPortal = (t) => {
        const { p, tan, side, up } = frameAt(t);
        const group = new THREE.Group();
        group.position.copy(p);
        group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, tan));

        const sideW = 1.4;
        const sideD = 2.6;
        const headH = 2.8;
        const foundation = 1.8;
        const pillarGeo = new THREE.BoxGeometry(sideW, TUNNEL_HEIGHT + foundation, sideD);
        for (const sx of [-1, 1]) {
          const pillar = new THREE.Mesh(pillarGeo, portalMat);
          pillar.position.set(
            sx * (TUNNEL_HALF + sideW / 2),
            (TUNNEL_HEIGHT - foundation) / 2,
            0
          );
          pillar.castShadow = true;
          group.add(pillar);

          const wing = new THREE.Mesh(
            new THREE.BoxGeometry(3.6, 3.6, 1.1),
            portalMat
          );
          wing.position.set(sx * (TUNNEL_HALF + sideW + 1.7), 0.2, 0.9);
          wing.rotation.y = sx * 0.35;
          wing.castShadow = true;
          group.add(wing);
        }
        const lintel = new THREE.Mesh(
          new THREE.BoxGeometry(TUNNEL_HALF * 2 + sideW * 2, headH, sideD),
          portalMat
        );
        lintel.position.set(0, TUNNEL_HEIGHT + headH / 2, 0);
        lintel.castShadow = true;
        group.add(lintel);
        scene.add(group);
      };

      addPortal(range.startT);
      addPortal(range.endT);
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
      10.5 车站旁的城镇（实例化，低 draw call）
     ============================================================ */
  (function buildTowns() {
    const PER_TOWN = settings.buildingsPerTown;
    const total = townCenters.length * PER_TOWN;
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    bodyGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(1, 1, 4);
    roofGeo.translate(0, 0.5, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true });
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, total);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, total);
    bodies.castShadow = true;
    bodies.receiveShadow = true;
    roofs.castShadow = true;
    roofs.receiveShadow = true;

    const bodyPalette = [0xe5dccb, 0xd8c6a5, 0xc7a47d, 0xc2c9c9, 0xb9c4ad, 0xd9b8a0, 0xe8e1d5];
    const roofPalette = [0x8b3a2e, 0x6d4c41, 0x455a64, 0x7a4b3a, 0x5d4037];
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0;

    for (let n = 0; n < PER_TOWN; n++) {
      for (let ti = 0; ti < townCenters.length; ti++) {
        const center = townCenters[ti];
        const angle = rand() * Math.PI * 2;
        const radius = 12 + rand() * 68;
        const x = center.x + Math.cos(angle) * radius;
        const z = center.z + Math.sin(angle) * radius;
        const y = getGroundY(x, z);
        if (y < WATER_LEVEL + 2) continue;
        if (queryLookup(trackLookup, x, z, 32)) continue;
        if (riverDistance(x, z) < 50) continue;

        const tall = rand() < 0.12;
        const w = 7 + rand() * 7;
        const d = 7 + rand() * 7;
        const h = tall ? 22 + rand() * 12 : 6 + rand() * 11;
        const rot = rand() * Math.PI * 2;

        dummy.position.set(x, y, z);
        dummy.rotation.set(0, rot, 0);
        dummy.scale.set(w, h, d);
        dummy.updateMatrix();
        bodies.setMatrixAt(placed, dummy.matrix);
        bodies.setColorAt(placed, color.setHex(bodyPalette[(placed + ti) % bodyPalette.length]));

        const roofH = tall ? 2.5 + rand() * 2 : 2.5 + rand() * 3.5;
        dummy.position.set(x, y + h, z);
        dummy.rotation.set(0, rot + Math.PI / 4, 0);
        dummy.scale.set(w * 0.76, roofH, d * 0.76);
        dummy.updateMatrix();
        roofs.setMatrixAt(placed, dummy.matrix);
        roofs.setColorAt(placed, color.setHex(roofPalette[(placed + ti) % roofPalette.length]));
        placed++;
      }
    }
    bodies.count = placed;
    roofs.count = placed;
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
    detailGroups.push({ key: 'towns', max: placed, meshes: [bodies, roofs] });
    scene.add(bodies, roofs);
  })();

  /* 城镇地标：每镇一座高塔，远处也能看出城镇位置 */
  (function buildTownLandmarks() {
    const count = townCenters.length;
    const bodyGeo = new THREE.CylinderGeometry(1, 1.15, 1, 8);
    bodyGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(1.3, 1, 8);
    roofGeo.translate(0, 0.5, 0);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe4dccb, roughness: 0.8 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x7a4b3a, roughness: 0.9, flatShading: true });
    const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
    const roofs = new THREE.InstancedMesh(roofGeo, roofMat, count);
    bodies.castShadow = true;
    bodies.receiveShadow = true;
    roofs.castShadow = true;
    roofs.receiveShadow = true;
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const center = townCenters[i];
      const y = getGroundY(center.x, center.z);
      if (y < WATER_LEVEL + 2) continue;
      const h = 34 + rand() * 14;
      const w = 3.4 + rand() * 1.4;
      const ox = (rand() - 0.5) * 14;
      const oz = (rand() - 0.5) * 14;
      dummy.position.set(center.x + ox, y, center.z + oz);
      dummy.rotation.set(0, rand() * Math.PI * 2, 0);
      dummy.scale.set(w, h, w);
      dummy.updateMatrix();
      bodies.setMatrixAt(placed, dummy.matrix);

      dummy.position.set(center.x + ox, y + h, center.z + oz);
      dummy.scale.set(w * 1.25, 5 + rand() * 2, w * 1.25);
      dummy.updateMatrix();
      roofs.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    bodies.count = placed;
    roofs.count = placed;
    scene.add(bodies, roofs);
  })();

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
        if (!lowDetail) {
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
    if (!lowDetail) addBox(bodyGroup, 0.18, 0.06, length - 1.2, 0, 3.0, centerZ, MAT.dark);
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
      if (!lowDetail) {
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
  let departureShake = 0;
  let departureShakeTime = 0;

  const audio = new TrainAudio();

  /** 起步震动：车体轻弹 + 镜头轻微抖动，约 1 秒衰减 */
  function triggerDepartureShake(strength = 1) {
    departureShake = Math.max(departureShake, strength);
    departureShakeTime = 0;
    audio.launch();
  }

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
  const audioModeEl = $('#audio-mode');
  const qualityModeEl = $('#quality-mode');
  const qualityPanelEl = $('#quality-panel');
  const qualitySummaryEl = $('#quality-summary');
  const qualityAutoEl = $('#quality-auto');
  const worldSeedEl = $('#world-seed');
  const worldSeedApplyEl = $('#world-seed-apply');
  const worldSeedRandomEl = $('#world-seed-random');
  const worldSeedApplyBottomEl = $('#world-seed-apply-bottom');
  if (worldSeedEl) worldSeedEl.value = WORLD_SEED;

  /** 停站后“如何发车”提示：触屏与键盘文案不同 */
  const START_HINT = touchUi
    ? '按住 <kbd>＋</kbd> 发车 · <kbd>0</kbd> 回中'
    : '按 <kbd>空格</kbd> 回中，再按 <kbd>W</kbd> 发车';

  if (touchUi) statusEl.textContent = '准备发车：按住 ＋ 推牵引挡';

  updateAudioUi();

  let lastStatusText = '';
  function setStatus(text) {
    if (text !== lastStatusText) { lastStatusText = text; statusEl.textContent = text; }
  }

  function updateAudioUi() {
    if (!audioModeEl) return;
    if (!audio.available) {
      audioModeEl.textContent = '🔇 无音效';
      audioModeEl.classList.add('muted');
      audioModeEl.disabled = true;
      return;
    }
    if (!audio.ctx) {
      audioModeEl.textContent = '🔈 开启音效';
      audioModeEl.classList.remove('muted');
      return;
    }
    audioModeEl.textContent = audio.muted ? '🔇 静音' : '🔊 音效开';
    audioModeEl.classList.toggle('muted', audio.muted);
  }

  function toggleAudioMute() {
    if (!audio.available) return;
    if (!audio.ctx) {
      audio.ensureStarted();
      updateAudioUi();
      return;
    }
    // 首次解锁音频的同一手势不立刻静音，避免“点开启音效反而没声”
    if (performance.now() - audioStartedAt < 400) {
      updateAudioUi();
      return;
    }
    audio.setMuted(!audio.muted);
    updateAudioUi();
  }

  /* ============================================================
     12.5 画质设置（逐项可调）
     ============================================================ */
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
      // 隐私模式下忽略持久化失败
    }
  }

  function syncSettingsUi() {
    if (qualityModeEl) qualityModeEl.textContent = '⚙ 设置';
    if (qualitySummaryEl) {
      const shadowText = settings.shadows ? `阴影 ${settings.shadows}` : '阴影关';
      const fpsText = settings.fpsLimit ? `${settings.fpsLimit}fps` : '不限帧';
      const actualScale = Math.min(devicePixelRatio || 1, settings.resolution);
      qualitySummaryEl.textContent =
        `实际 ${actualScale.toFixed(2)}x（上限 ${settings.resolution.toFixed(2)}x）· ${shadowText} · ` +
        `雾 ${settings.drawDistance.toFixed(2)}x · 地形 ${settings.terrain}（下次） · ${fpsText} · ` +
        `抗锯齿${settings.antialias ? '开' : '关'}（下次）`;
    }
    if (!qualityPanelEl) return;
    const boolKeys = new Set(['antialias', 'softShadows', 'foliageShadows', 'water']);
    qualityPanelEl.querySelectorAll('[data-setting]').forEach((el) => {
      const key = el.dataset.setting;
      if (boolKeys.has(key)) el.value = settings[key] ? '1' : '0';
      else if (key === 'modelDetail') el.value = settings.modelDetail;
      else el.value = String(settings[key]);
    });
    const factorKeys = new Set(['resolution', 'drawDistance', 'terrainRelief', 'lakeScale', 'riverScale', 'mountainHeight']);
    qualityPanelEl.querySelectorAll('[data-value]').forEach((out) => {
      const key = out.dataset.value;
      if (factorKeys.has(key)) out.textContent = `${settings[key].toFixed(2)}x`;
      else if (key === 'buildingsPerTown') out.textContent = String(settings.buildingsPerTown);
      else out.textContent = `${Math.round(settings[key] * 100)}%`;
    });
  }

  function applySettings() {
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, settings.resolution));

    const shadows = settings.shadows > 0;
    const shadowChanged = renderer.shadowMap.enabled !== shadows;
    renderer.shadowMap.enabled = shadows;
    sun.castShadow = shadows;

    const shadowType = settings.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    const typeChanged = renderer.shadowMap.type !== shadowType;
    renderer.shadowMap.type = shadowType;
    if (typeChanged && sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }

    if (shadows && sun.shadow.mapSize.x !== settings.shadows) {
      sun.shadow.mapSize.set(settings.shadows, settings.shadows);
      if (sun.shadow.map) {
        sun.shadow.map.dispose();
        sun.shadow.map = null;
      }
    }
    if (shadowChanged || typeChanged) {
      const seen = new Set();
      scene.traverse((object) => {
        const material = object.material;
        if (!material) return;
        const list = Array.isArray(material) ? material : [material];
        for (const mat of list) {
          if (!seen.has(mat)) {
            seen.add(mat);
            mat.needsUpdate = true;
          }
        }
      });
    }
    renderer.shadowMap.needsUpdate = true;

    for (const group of detailGroups) {
      const factor = settings[group.key] ?? 1;
      const count = Math.max(0, Math.floor(group.max * factor));
      for (const mesh of group.meshes) {
        mesh.count = count;
        mesh.castShadow = settings.foliageShadows;
      }
    }

    if (waterMesh) waterMesh.visible = settings.water;
    if (scene.fog) {
      scene.fog.density = (isNight ? 0.0006 : 0.00018) / settings.drawDistance;
    }
  }

  function handleSettingChange(event) {
    const input = event.target.closest('[data-setting]');
    if (!input) return;
    const key = input.dataset.setting;
    if (key === 'antialias' || key === 'softShadows' || key === 'foliageShadows' || key === 'water') {
      settings[key] = input.value === '1';
    } else if (key === 'modelDetail') {
      settings.modelDetail = input.value;
    } else {
      settings[key] = Number(input.value);
    }

    settings = normalizeSettings(settings, autoSettings());
    saveSettings();
    applySettings();
    syncSettingsUi();
  }

  function resetSettings() {
    settings = autoSettings();
    saveSettings();
    applySettings();
    syncSettingsUi();
  }

  on(qualityAutoEl, 'click', resetSettings);

  function applyWorldSeed(value) {
    const next = normalizeSeed(value);
    try {
      localStorage.setItem(SEED_KEY, next);
    } catch (error) {
      // 隐私模式下仍用传入的 seed 重建当前世界
    }
    renderTrain3d(container, { seed: next });
  }

  on(worldSeedApplyEl, 'click', () => applyWorldSeed(worldSeedEl.value));
  on(worldSeedApplyBottomEl, 'click', () => applyWorldSeed(worldSeedEl.value));
  on(worldSeedRandomEl, 'click', () => {
    const next = randomSeed();
    worldSeedEl.value = next;
    applyWorldSeed(next);
  });
  on(worldSeedEl, 'keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    applyWorldSeed(worldSeedEl.value);
  });

  on(qualityModeEl, 'click', () => {
    qualityPanelEl.hidden = !qualityPanelEl.hidden;
  });
  on(qualityPanelEl, 'input', handleSettingChange);
  on(qualityPanelEl, 'change', handleSettingChange);
  on(qualityPanelEl, 'click', (event) => {
    if (event.target.closest('[data-action="auto"]')) resetSettings();
  });
  on(document, 'pointerdown', (event) => {
    if (qualityPanelEl.hidden) return;
    if (qualityPanelEl.contains(event.target) || qualityModeEl.contains(event.target)) return;
    qualityPanelEl.hidden = true;
  });

  applySettings();
  syncSettingsUi();

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
    const wasStopped = isStopped;
    const wasAtRest = speed < 0.5 && notch <= 0;

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
      audio.depart();
    }

    // 从静止推牵引挡（站内或线路起点）时给一次起步震动
    if (notch > 0 && wasAtRest) {
      triggerDepartureShake(wasStopped ? 1 : 0.85);
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

      if (!isStopped && speed < 0.5) triggerDepartureShake(0.9);

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
      audio.arrive();
      drawScreen();
    }

    if (autoInfo.departed) {
      isStopped = false;
      stopPromptEl.style.display = 'none';
      signalLights.forEach((light) => light.material.color.setHex(0xff0000));
      const station = stations[autoInfo.stopIndex];
      setStatus(`🤖 自动发车 · 下一站 ${station.name}`);
      currentTargetName = station.name;
      audio.depart();
      triggerDepartureShake(1);
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
        audio.arrive();
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
      if (carBody) {
        carBody.rotation.z = car.roll;
        // 起步时车体轻微下沉/回弹，和镜头震动同步
        const bounceAmp = departureShake > 0
          ? departureShake * Math.exp(-departureShakeTime * 3.5)
          : 0;
        const bounce = Math.sin(departureShakeTime * 14 + i * 0.35) * 0.004 * bounceAmp;
        carBody.position.y = bounce;
        carBody.rotation.x = Math.sin(departureShakeTime * 14 + 0.5) * 0.0015 * bounceAmp;
      }
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
  const _shakeQuat = new THREE.Quaternion();
  const _shakeRight = new THREE.Vector3();
  const _shakeUp = new THREE.Vector3();

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
    const headT = ((travel % trackLength) + trackLength) % trackLength / trackLength;
    const inTunnel = tunnelRanges.some(
      (range) => headT >= range.startT - 0.0005 && headT <= range.endT + 0.0005
    );
    if (headlightSpot) {
      if (inTunnel) headlightSpot.intensity = Math.max(headlightSpot.intensity, 140);
      else if (!isNight) headlightSpot.intensity = 0;
    }

    if (cameraMode === 'third' && !inTunnel) {
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

    // 起步震动：低频、轻微的车体下沉/回弹，不是高频抖动
    if (departureShake > 0 && dt > 0) {
      departureShakeTime += dt;
      const amp = departureShake * Math.exp(-departureShakeTime * 3.5);
      if (amp < 0.01 || departureShakeTime > 2.0) {
        departureShake = 0;
        departureShakeTime = 0;
      } else {
        const t = departureShakeTime;
        const sx = Math.sin(t * 13 + 0.4) * 0.004 * amp;
        const sy = Math.sin(t * 17) * 0.008 * amp;
        _shakeRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        _shakeUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        camera.position.addScaledVector(_shakeRight, sx).addScaledVector(_shakeUp, sy);
        _shakeQuat.setFromAxisAngle(_zAxis, Math.sin(t * 12) * 0.0015 * amp);
        camera.quaternion.multiply(_shakeQuat);
      }
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
    // 焦点在输入框/下拉框时不要触发行车按键（种子输入、画质滑杆）
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
      if (GAME_KEYS.has(e.code)) e.stopPropagation();
      return;
    }

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

    if (e.code === 'KeyM') {
      if (!e.repeat) toggleAudioMute();
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

  on(document, 'visibilitychange', () => {
    if (document.hidden) audio.suspend();
    else audio.resume();
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
  let lastFrameAt = 0;

  function tick(now) {
    if (settings.fpsLimit > 0) {
      const nowMs = typeof now === 'number' ? now : performance.now();
      const minInterval = 1000 / settings.fpsLimit;
      if (nowMs - lastFrameAt < minInterval - 1) return;
      lastFrameAt = nowMs;
    }
    const dt = Math.min(clock.getDelta(), 0.05);

    updateAutoDrive(dt);
    updatePhysics(dt);
    updateTrainPosition(dt);
    audio.update(dt, {
      speed,
      throttle: autoMode ? autoThrottle : notch,
      notch,
      autoMode,
      isStopped,
      travel
    });
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
    audio.dispose();

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
