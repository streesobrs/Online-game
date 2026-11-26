/**
 * 刷怪肉鸽（幸存者 like）· 测试版 Demo
 *
 * 定位：游戏大厅「单机试玩」入口，先验证「自动攻击 + 怪潮 + 升级三选一」的手感。
 * 技术：Canvas 2D + requestAnimationFrame，不依赖服务端、不依赖外部素材。
 *
 * 玩法：
 * - WASD / 方向键移动，鼠标或手指在画面上拖拽也可以移动
 * - 武器自动索敌射击；击杀怪物掉落经验，靠近自动拾取
 * - 经验攒满升级，暂停并三选一强化（伤害/攻速/多重射击/移速…）
 * - 每 90 秒出现一个 Boss；后期出现冲锋/远程/自爆/分裂怪；生命归零结算，最佳成绩保存在 localStorage
 */
import { viewRoot, el } from '../../utils/dom.js';
import { go } from '../../core/router.js';
import { eventBus } from '../../core/eventBus.js';
import { startGameActivity, stopGameActivity } from '../../core/activity.js';
import { setShortcutsSuppressed } from '../../utils/shortcut.js';
import { createFullscreen } from '../../utils/fullscreen.js';
import { PLAYER_BASE, BASE_SHOT, snapshotBaseStats, deriveStats } from './base.js';
import { skillDamage, damageTakenZone } from './combat.js';
import { loadBest, saveBest, formatTime, rand, highlightNumbers } from './helpers.js';
import { createRenderer } from './renderer.js';
import { loadCatalog, createCatalog } from './catalog.js';
import { saveRun, loadRun, clearRun } from './save.js';
import { applyTalents, getMeta, grantRunPoints } from './meta.js';
import { syncOnEnter, scheduleUpload, flushUpload, cancelScheduledUpload } from './server-save.js';
import { applyElementHit, applyElementAoe, applyShatter, ELEMENT_DURATION, ICE_SLOW_FACTOR } from './elements.js';
import { BOSS_INTERVAL } from './monsters/boss.js';
import { SHIELD_HIT_CD } from './buffs/shield.js';

let activeCleanup = null;

const W = 960;
const H = 600;
const WAVE_INTERVAL = 30; // 秒，每波持续 30 秒

function formatDps(v) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

const DEBUG_KEY = 'survivorsDebug';
const QUALITY_KEY = 'survivorsQuality';

function loadDebugPref() {
  try {
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch (e) {
    return false;
  }
}

// 画质模式：auto=自动（最低缩到 CSS 分辨率，不额外变糊）/ sharp=高清（设备像素）/ smooth=流畅（可低于 CSS 分辨率）
const QUALITY_META = {
  auto: { icon: '🖥', name: '自动', tip: '画质：自动（低帧时最多降到 CSS 分辨率）' },
  sharp: { icon: '🔍', name: '高清', tip: '画质：高清（设备像素，最清晰但可能掉帧）' },
  smooth: { icon: '⚡', name: '流畅', tip: '画质：流畅（允许低于 CSS 分辨率）' },
};

function loadQualityMode() {
  try {
    const v = localStorage.getItem(QUALITY_KEY);
    return v === 'sharp' || v === 'smooth' ? v : 'auto';
  } catch (e) {
    return 'auto';
  }
}

// 探测浏览器实际使用的图形后端：出现 SwiftShader / Basic Render 说明没走 GPU 加速
function detectGpuRenderer() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl');
    if (!gl) return 'no-webgl';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return String(name || 'unknown');
  } catch (e) {
    return 'unknown';
  }
}

// 画布加速粗测：对 1.6MP 离屏画布连画 8 次渐变 + 网格，再读回 1 像素强制同步。
// 硬件加速约几十毫秒，纯 CPU 光栅化通常要几百毫秒。
function benchmarkCanvas() {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1000;
  const g = c.getContext('2d');
  const t0 = performance.now();
  for (let i = 0; i < 8; i += 1) {
    const grad = g.createLinearGradient(0, 0, 1600, 1000);
    grad.addColorStop(0, '#1b2038');
    grad.addColorStop(1, '#0d101d');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1600, 1000);
    g.strokeStyle = 'rgba(120, 150, 220, 0.3)';
    g.beginPath();
    for (let x = 0; x <= 1600; x += 40) {
      g.moveTo(x, 0);
      g.lineTo(x, 1000);
    }
    for (let y = 0; y <= 1000; y += 40) {
      g.moveTo(0, y);
      g.lineTo(1600, y);
    }
    g.stroke();
  }
  g.getImageData(0, 0, 1, 1);
  return performance.now() - t0;
}

const SETTINGS_KEY = 'survivorsSettings';
const FPS_CAPS = [0, 144, 120, 90, 60, 30];
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const CANVAS_CAPS = [1280, 1600, 1920, 2560];
const DEFAULT_SETTINGS = {
  fpsCap: 0,
  particles: IS_MOBILE ? 'mid' : 'high',
  shake: true,
  background: 'grid',
  glow: true,
  gemGlow: true,
  icons: true,
  flash: true,
  // 移动端屏幕像素多、GPU 填充率有限，默认把画布宽度压到 1600
  canvasCap: IS_MOBILE ? 1600 : 2560,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const v = JSON.parse(raw) || {};
    return {
      fpsCap: FPS_CAPS.includes(v.fpsCap) ? v.fpsCap : 0,
      particles: ['high', 'mid', 'low', 'off'].includes(v.particles) ? v.particles : (IS_MOBILE ? 'mid' : 'high'),
      shake: v.shake !== false,
      background: ['grid', 'stars', 'plain'].includes(v.background)
        ? v.background
        : (v.grid === false ? 'plain' : 'grid'),
      glow: v.glow !== false,
      gemGlow: v.gemGlow !== false,
      icons: v.icons !== false,
      flash: v.flash !== false,
      canvasCap: CANVAS_CAPS.includes(v.canvasCap) ? v.canvasCap : (IS_MOBILE ? 1600 : 2560),
    };
  } catch (e) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    // 隐私模式忽略
  }
}

const PLAYER_START = { ...PLAYER_BASE, base: snapshotBaseStats(PLAYER_BASE) };

/**
 * 图鉴数据：每个强化 / 怪物一个文件，分别放在 buffs/ 与 monsters/ 目录。
 * 页面加载时通过服务端目录接口读取文件名，再动态 import，新增文件后刷新即可自动出现在图鉴里。
 */
let BUFFS = [];
let MONSTERS = [];
const MONSTER_MAP = new Map();

/**
 * 渲染刷怪肉鸽视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderSurvivors(container = viewRoot()) {
  // 路由不会调用视图返回的 cleanup，重复进入时先销毁上一实例
  if (typeof activeCleanup === 'function') activeCleanup();
  startGameActivity();
  // 本视图内屏蔽全局快捷键，否则暂停 / 升级选卡时按 WASD 会跳转到其它页面
  setShortcutsSuppressed(true);

  const state = {
    mode: 'idle', // idle | playing | dead
    paused: false,
    pausedByLevelUp: false,
    time: 0,
    kills: 0,
    level: 1,
    xp: 0,
    xpNeeded: 9,
    pendingLevels: 0,
    player: { ...PLAYER_START, base: { ...PLAYER_START.base } },
    enemies: [],
    projectiles: [],
    enemyShots: [],
    gems: [],
    healthPacks: [],
    particles: [],
    upgradeStacks: {},
    attackTimer: 0.35,
    comboTimer: 0,
    comboPending: 0,
    dpsBuckets: [],
    dmgAccum: 0,
    dpsTick: 0,
    dps: 0,
    saveTimer: 5,
    thornsCd: 0,
    lastReward: 0,
    debug: loadDebugPref(),
    qualityMode: loadQualityMode(),
    settings: loadSettings(),
    gpu: detectGpuRenderer(),
    fps: 0,
    fpsFrames: 0,
    fpsTime: 0,
    // 每 0.5 秒统计窗口的分帧耗时：逻辑（含 HUD）/ 渲染 / 单帧峰值
    perfUpd: 0,
    perfRen: 0,
    perfPeak: 0,
    perfUpdSum: 0,
    perfRenSum: 0,
    perfFrames: 0,
    perfPeakMax: 0,
    // 调试录制：每 0.5 秒采样一次，停止时下载 JSON 日志
    recording: false,
    recordStart: 0,
    records: [],
    recordErrors: [],
    spawnTimer: 1.2,
    bossTimer: BOSS_INTERVAL,
    bossCount: 0,
    wave: 1,
    waveBanner: 0,
    hurtCd: 0,
    novaTimer: 2.5,
    novas: [],
    explosions: [],
    lightningArcs: [],
    reactionCd: 0,
    nextEnemyId: 1,
    flash: 0,
    shake: 0,
    last: performance.now(),
    raf: 0,
    best: loadBest(),
    drag: { x: 0, y: 0 },
  };

  // ---- DOM ----
  const canvas = el('canvas', { class: 'sv-canvas', width: W, height: H });
  // alpha:false 让画布按不透明层合成，省掉每帧与页面背景的混合
  const ctx = canvas.getContext('2d', { alpha: false });
  const renderer = createRenderer({ canvas, ctx, state, W, H });

  const hpFill = el('div', { class: 'sv-bar-fill sv-hp-fill' });
  const hpText = el('span', { class: 'sv-bar-text' }, '100 / 100');
  const xpFill = el('div', { class: 'sv-bar-fill sv-xp-fill' });
  const baseStatsEl = el('div', { class: 'sv-hud-base' }, '');
  let hudBaseCache = '';
  const timeEl = el('span', { class: 'sv-hud-time' }, '00:00');
  const waveEl = el('span', { class: 'sv-hud-wave' }, '第 1 波 · 30s');
  const lvEl = el('span', { class: 'sv-hud-chip' }, 'Lv.1');
  const killEl = el('span', { class: 'sv-hud-chip' }, '💀 0');
  const dpsEl = el('span', { class: 'sv-hud-chip' }, '⚔ 0');
  const shieldEl = el('span', { class: 'sv-hud-chip', style: { display: 'none' } }, '🛡 0');
  const catalogBtn = el('button', { class: 'sv-hud-chip sv-hud-quit', type: 'button', onClick: () => openCatalogInRun() }, '📖');
  const debugBtn = el('button', {
    class: `sv-hud-chip sv-hud-quit${state.debug ? ' active' : ''}`,
    type: 'button',
    onClick: () => toggleDebug(),
  }, '🐞');
  const settleBtn = el('button', { class: 'sv-hud-chip sv-hud-quit', type: 'button', onClick: () => settleNow() }, '结束本局');
  const recordBtn = el('button', {
    class: 'sv-hud-chip sv-hud-quit',
    type: 'button',
    title: '录制调试日志（F4 开始/停止）',
    onClick: () => toggleRecording(),
  }, '⏺');
  const settingsBtn = el('button', {
    class: 'sv-hud-chip sv-hud-quit',
    type: 'button',
    title: '画质与性能设置',
    onClick: () => openSettings(),
  }, '⚙');
  const qualityBtn = el('button', {
    class: 'sv-hud-chip sv-hud-quit',
    type: 'button',
    title: `${QUALITY_META[state.qualityMode].tip} · 点击切换`,
    onClick: () => cycleQuality(),
  }, QUALITY_META[state.qualityMode].icon);

  const hud = el('div', { class: 'sv-hud' }, [
    el('div', { class: 'sv-hud-bars' }, [
      el('div', { class: 'sv-bar sv-bar-hp' }, [hpFill, hpText]),
      el('div', { class: 'sv-bar sv-bar-xp' }, [xpFill]),
      baseStatsEl,
    ]),
    el('div', { class: 'sv-hud-mid' }, [timeEl, waveEl]),
    el('div', { class: 'sv-hud-right' }, [lvEl, killEl, dpsEl, shieldEl, settingsBtn, qualityBtn, recordBtn, debugBtn, catalogBtn, settleBtn]),
  ]);

  const debugEl = el('pre', { class: `sv-debug${state.debug ? ' show' : ''}` }, '');

  const overlay = el('div', { class: 'sv-overlay' });
  // arena 由 renderer 按 16:10 计算尺寸；HUD 贴着游戏区，overlay 铺满整个舞台
  const arena = el('div', { class: 'sv-arena' }, [canvas, hud, debugEl]);
  const stage = el('div', { class: 'sv-stage' }, [arena, overlay]);

  const backBtn = el('button', { class: 'sv-back-btn', type: 'button' }, '← 返回大厅');
  backBtn.addEventListener('click', () => go('games'));

  const fsBtn = el('button', { class: 'sv-fs-btn', type: 'button' }, '⤢ 全屏');

  const wrap = el('section', { class: 'sv-view' }, [
    el('div', { class: 'sv-head' }, [
      backBtn,
      el('span', { class: 'sv-title' }, '⚔️ 刷怪肉鸽'),
      el('span', { class: 'sv-beta' }, '测试版 DEMO'),
      fsBtn,
    ]),
    stage,
    el('p', { class: 'sv-foot' }, 'WASD / 方向键移动，或按住画面拖拽移动 · 武器自动攻击 · Esc 暂停'),
  ]);

  // 全屏切换：布局尺寸变化后需要重新计算画布分辨率
  // 移动端全屏后尝试锁定横屏（Android Chrome 生效；iOS 不支持时保留竖屏提示）
  const fsCtrl = createFullscreen(wrap, (active) => {
    fsBtn.textContent = active ? '⤢ 退出全屏' : '⤢ 全屏';
    fsBtn.classList.toggle('is-active', active);
    renderer.resizeCanvas();
    requestAnimationFrame(() => renderer.resizeCanvas());
    // 原生全屏动画 / 屏幕旋转结束后再补一次，避免画布分辨率取到过渡中的尺寸
    setTimeout(() => renderer.resizeCanvas(), 260);
  }, { orientation: 'landscape' });
  fsBtn.addEventListener('click', () => fsCtrl.toggle());

  container.replaceChildren(wrap);
  renderer.resizeCanvas();
  window.addEventListener('resize', renderer.resizeCanvas);

  // ---- HUD ----
  function updateHud() {
    const p = state.player;
    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    hpFill.style.width = `${(hpPct * 100).toFixed(1)}%`;
    hpText.textContent = `${Math.max(0, Math.ceil(p.hp))} / ${Math.round(p.maxHp)}`;
    const xpPct = Math.max(0, Math.min(1, state.xp / state.xpNeeded));
    xpFill.style.width = `${(xpPct * 100).toFixed(1)}%`;
    timeEl.textContent = formatTime(state.time);
    // 局内默认展示加成后的当前属性；基础属性只在战局外的开始页展示
    const fmt = (v, d = 0) => Number(Number(v).toFixed(d));
    const curRow = (label, key, digits) => `${label} <span class="sv-num">${fmt(p[key], digits)}</span>`;
    const curText = `当前 ${curRow('攻', 'atk', 1)} · ${curRow('血', 'maxHp')} · ${curRow('防', 'def')} · ${curRow('速', 'speed')}`;
    // 属性只在选强化时变化，缓存后避免每帧重写 DOM
    if (curText !== hudBaseCache) {
      hudBaseCache = curText;
      baseStatsEl.innerHTML = curText;
    }
    const remain = Math.max(0, WAVE_INTERVAL - (state.time % WAVE_INTERVAL));
    const bossNext = Math.abs(state.time + remain - state.bossTimer) < 0.6;
    waveEl.textContent = bossNext
      ? `👑 第 ${state.wave} 波 · BOSS ${Math.ceil(remain)}s`
      : `🌊 第 ${state.wave} 波 · 下一波 ${Math.ceil(remain)}s`;
    waveEl.classList.toggle('is-boss', bossNext);
    lvEl.textContent = `Lv.${state.level}`;
    killEl.textContent = `💀 ${state.kills}`;
    dpsEl.textContent = `⚔ ${formatDps(state.dps)}`;
    if (p.shieldMax > 0) {
      shieldEl.style.display = '';
      shieldEl.textContent = `🛡 ${Math.ceil(Math.max(0, p.shield))}`;
    } else {
      shieldEl.style.display = 'none';
    }
  }

  // ---- 调试面板 ----
  const SHAPE_NAMES = {
    circle: '圆', triangle: '三', square: '方', charger: '冲',
    shooter: '射', splitter: '分', bomber: '炸', boss: '王',
  };

  // 汇总调试信息：面板展示与日志录制共用，保证两边数据一致
  function collectDebugInfo() {
    const p = state.player || {};
    const stacks = Object.entries(state.upgradeStacks).filter(([, v]) => v > 0);
    const shapeCounts = {};
    let frozen = 0;
    let vuln = 0;
    let tagged = 0;
    for (const e of state.enemies) {
      shapeCounts[e.shape] = (shapeCounts[e.shape] || 0) + 1;
      if (e.freezeTimer > 0) frozen += 1;
      if (e.vulnTimer > 0) vuln += 1;
      if (e.element) tagged += 1;
    }
    return {
      fps: Math.round(state.fps * 10) / 10,
      frameMs: state.fps > 0 ? Math.round((1000 / state.fps) * 10) / 10 : 0,
      updMs: Math.round(state.perfUpd * 100) / 100,
      renMs: Math.round(state.perfRen * 100) / 100,
      peakMs: Math.round(state.perfPeak * 100) / 100,
      mode: state.mode,
      paused: state.paused,
      runTime: Math.round(state.time * 10) / 10,
      wave: state.wave,
      boss: state.bossCount,
      dps: Math.round(state.dps),
      enemies: state.enemies.length,
      shapes: shapeCounts,
      frozen,
      vuln,
      tagged,
      projectiles: state.projectiles.length,
      enemyShots: state.enemyShots.length,
      gems: state.gems.length,
      particles: state.particles.length,
      novas: state.novas.length,
      explosions: state.explosions.length,
      arcs: state.lightningArcs.length,
      stacks: Object.fromEntries(stacks),
      stackSum: stacks.reduce((sum, [, v]) => sum + v, 0),
      elements: {
        fire: p.fireLevel || 0,
        thunder: p.thunderLevel || 0,
        ice: p.iceLevel || 0,
        water: p.waterLevel || 0,
      },
      em: Math.round(p.em || 0),
      px: Math.round(p.x || 0),
      py: Math.round(p.y || 0),
      renderQuality: renderer.getQuality(),
      qualityMode: state.qualityMode,
      gpu: state.gpu,
    };
  }

  function updateDebug() {
    if (!state.debug) return;
    const info = collectDebugInfo();
    const enemyLine = Object.entries(info.shapes)
      .map(([shape, n]) => `${SHAPE_NAMES[shape] || shape}${n}`)
      .join(' ');
    const mem = performance.memory
      ? `  堆 ${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB`
      : '';
    const rec = state.recording ? `  🔴REC ${state.records.length}` : '';
    debugEl.textContent = [
      `FPS ${info.fps.toFixed(0)}  ${info.frameMs.toFixed(1)}ms${rec}`,
      `耗时 逻辑 ${info.updMs.toFixed(1)}ms  渲染 ${info.renMs.toFixed(1)}ms  单帧峰值 ${info.peakMs.toFixed(1)}ms`,
      `怪 ${info.enemies}  ${enemyLine || '-'}`,
      `冻 ${info.frozen}  易伤 ${info.vuln}  挂元素 ${info.tagged}`,
      `弹 ${info.projectiles}  敌弹 ${info.enemyShots}  经验 ${info.gems}  粒子 ${info.particles}`,
      `新星 ${info.novas}  爆炸 ${info.explosions}  闪电 ${info.arcs}`,
      `强化 ${info.stackSum} 层  ${Object.entries(info.stacks).map(([k, v]) => `${k}${v}`).join(' ') || '-'}`,
      `火${info.elements.fire} 雷${info.elements.thunder} 冰${info.elements.ice} 水${info.elements.water}  精通 ${info.em}`,
      `DPS ${formatDps(info.dps)}  波 ${info.wave}  Boss ${info.boss}  坐标 ${info.px},${info.py}`,
      `画布 ${canvas.width}×${canvas.height}  倍率 ${info.renderQuality.toFixed(2)}  画质 ${(QUALITY_META[info.qualityMode] || QUALITY_META.auto).name}  DPR ${(window.devicePixelRatio || 1).toFixed(1)}${mem}`,
      `GPU ${info.gpu}`,
    ].join('\n');
  }

  // ---- 调试日志录制：每 0.5 秒采样，停止时下载 JSON ----
  function onRecordError(event) {
    state.recordErrors.push({
      atSec: Math.round((Date.now() - state.recordStart) / 100) / 10,
      message: String(event.message || event.reason || 'error'),
      stack: String((event.error && event.error.stack) || ''),
    });
  }

  function recordSample() {
    if (!state.recording) return;
    // 单次录制上限约 30 分钟，避免长时间挂机把内存吃满
    if (state.records.length >= 3600) {
      stopRecording();
      return;
    }
    state.records.push({
      atSec: Math.round((Date.now() - state.recordStart) / 100) / 10,
      ...collectDebugInfo(),
    });
  }

  function startRecording() {
    state.recording = true;
    state.recordStart = Date.now();
    state.records = [];
    state.recordErrors = [];
    recordBtn.textContent = '⏹';
    recordBtn.classList.add('active');
    recordBtn.title = '停止录制并下载日志（F4）';
    window.addEventListener('error', onRecordError);
    window.addEventListener('unhandledrejection', onRecordError);
    recordSample();
    updateDebug();
  }

  function saveRecordingLog() {
    const payload = {
      meta: {
        startedAt: new Date(state.recordStart).toISOString(),
        durationSec: Math.round((Date.now() - state.recordStart) / 1000),
        samples: state.records.length,
        url: location.href,
        userAgent: navigator.userAgent,
        dpr: window.devicePixelRatio || 1,
        canvas: `${canvas.width}x${canvas.height}`,
        gpu: state.gpu,
      },
      samples: state.records,
      errors: state.recordErrors,
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `survivor-log-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function stopRecording() {
    if (!state.recording) return;
    state.recording = false;
    recordBtn.textContent = '⏺';
    recordBtn.classList.remove('active');
    recordBtn.title = '录制调试日志（F4 开始/停止）';
    window.removeEventListener('error', onRecordError);
    window.removeEventListener('unhandledrejection', onRecordError);
    updateDebug();
    saveRecordingLog();
  }

  function toggleRecording() {
    if (state.recording) stopRecording();
    else startRecording();
  }

  function toggleDebug() {
    state.debug = !state.debug;
    debugEl.classList.toggle('show', state.debug);
    debugBtn.classList.toggle('active', state.debug);
    try {
      localStorage.setItem(DEBUG_KEY, state.debug ? '1' : '0');
    } catch (e) {
      // 隐私模式下忽略
    }
    updateDebug();
  }

  // ---- 覆盖层：开始 / 升级 / 结算 ----
  function showOverlay(node) {
    overlay.replaceChildren(node);
    overlay.classList.add('show');
  }

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.replaceChildren();
  }

  // ---- 图鉴：数据完全来自 buffs/ 与 monsters/ 下的单文件 ----
  let catalogOpen = false;
  const catalog = createCatalog({
    state,
    formatTime,
    showOverlay,
    getBuffs: () => BUFFS,
    getMonsters: () => MONSTERS,
    onClose: () => { catalogOpen = false; },
  });

  function openCatalog(tab = 'buffs', back = showStart) {
    catalogOpen = true;
    catalog.open(tab, back);
  }

  function closeCatalog() {
    catalog.close();
  }

  // 局内看图鉴：临时暂停，关闭后继续
  function openCatalogInRun() {
    if (state.mode !== 'playing' || state.paused) return;
    state.paused = true;
    saveRun(state);
    scheduleUpload();
    openCatalog('buffs', closeCatalogInRun);
  }

  function closeCatalogInRun() {
    hideOverlay();
    state.paused = false;
    state.last = performance.now();
  }

  // ---- 存档恢复 ----
  function resumeRun() {
    const run = loadRun();
    if (!run) {
      showStart();
      return;
    }
    hideOverlay();
    state.mode = 'playing';
    state.paused = false;
    state.pausedByLevelUp = false;
    state.time = run.time;
    state.kills = run.kills || 0;
    state.level = run.level || 1;
    state.xp = run.xp || 0;
    state.xpNeeded = run.xpNeeded || 9;
    state.pendingLevels = run.pendingLevels || 0;
    state.player = deriveStats({ ...PLAYER_BASE, ...run.player });
    state.enemies = run.enemies;
    state.projectiles = run.projectiles;
    state.enemyShots = run.enemyShots;
    state.gems = run.gems;
    state.healthPacks = run.healthPacks || [];
    state.particles = [];
    state.novas = [];
    state.explosions = [];
    state.lightningArcs = [];
    state.reactionCd = 0;
    state.upgradeStacks = run.upgradeStacks;
    state.attackTimer = run.attackTimer ?? 0.35;
    state.comboTimer = 0;
    state.comboPending = 0;
    state.spawnTimer = run.spawnTimer ?? 1.2;
    state.bossTimer = run.bossTimer ?? BOSS_INTERVAL;
    state.bossCount = run.bossCount || 0;
    state.wave = run.wave || 1;
    state.hurtCd = 0;
    state.novaTimer = run.novaTimer ?? 2.5;
    state.nextEnemyId = run.nextEnemyId || 1;
    state.waveBanner = 0;
    state.flash = 0;
    state.shake = 0;
    state.drag = { x: 0, y: 0 };
    state.dpsBuckets = [];
    state.dmgAccum = 0;
    state.dpsTick = 0;
    state.dps = 0;
    state.saveTimer = 5;
    state.thornsCd = 0;
    keys.clear();
    state.last = performance.now();
    updateHud();
    if (state.pendingLevels > 0) openLevelUp();
  }

  function showStart() {
    state.paused = true;
    const saved = loadRun();
    // 战局外展示基础属性：基础值 + 当前天赋等级
    const preview = { ...PLAYER_BASE };
    applyTalents(preview);
    deriveStats(preview);
    showOverlay(el('div', { class: 'sv-panel sv-panel-start' }, [
      el('div', { class: 'sv-panel-icon' }, '⚔️'),
      el('h2', { class: 'sv-panel-title' }, '刷怪肉鸽'),
      el('p', { class: 'sv-panel-sub' }, '幸存者 like · 测试版 Demo'),
      el('p', { class: 'sv-panel-desc' }, '武器自动索敌攻击。WASD / 方向键移动，手机或鼠标按住画面拖拽也能移动。'),
      el('p', { class: 'sv-panel-desc' }, `击杀怪物拾取经验，升级时三选一强化；每 ${BOSS_INTERVAL} 秒出现一个 Boss。后期会出现冲锋、远程、自爆和分裂怪。`),
      el('p', { class: 'sv-panel-desc' }, `基础属性 攻击 ${Number(preview.atk.toFixed(1))} · 生命 ${Math.round(preview.maxHp)} · 防御 ${Math.round(preview.def)} · 移速 ${Math.round(preview.speed)}`),
      el('div', { class: 'sv-best' }, [
        el('span', {}, `🏆 最佳存活 ${formatTime(state.best.time)}`),
        el('span', {}, `💀 最高击杀 ${state.best.kills}`),
        el('span', {}, `🌟 天赋点 ${getMeta().points}`),
      ]),
      saved
        ? el('button', { class: 'btn btn-primary sv-big-btn', type: 'button', onClick: resumeRun },
          `继续上局 · ${formatTime(saved.time)} · Lv.${saved.level} · 💀 ${saved.kills}`)
        : null,
      el('button', {
        class: saved ? 'btn btn-secondary' : 'btn btn-primary sv-big-btn',
        type: 'button',
        onClick: startGame,
      }, saved ? '重新开始' : '开始试玩'),
      el('div', { class: 'sv-panel-actions' }, [
        el('button', { class: 'btn btn-warning', type: 'button', onClick: () => openCatalog('talents') }, '🌟 局外天赋'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openCatalog('buffs') }, `📖 强化图鉴 (${BUFFS.filter((b) => !b.element).length})`),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openCatalog('elements') }, `⚛️ 元素图鉴 (${BUFFS.filter((b) => b.element || b.reaction).length})`),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openCatalog('monsters') }, `👾 怪物图鉴 (${MONSTERS.length})`),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openSettings() }, '⚙ 画质设置'),
      ]),
    ]));
  }

  // 图鉴数据通过接口 + 动态 import 读取，加载完成前不允许开局
  function showLoading() {
    state.paused = true;
    showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '⏳'),
      el('h2', { class: 'sv-panel-title' }, '正在加载图鉴数据'),
      el('p', { class: 'sv-panel-sub' }, '正在读取 buffs/ 与 monsters/ 目录…'),
    ]));
  }

  function showCatalogError(err) {
    showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '⚠️'),
      el('h2', { class: 'sv-panel-title' }, '图鉴数据加载失败'),
      el('p', { class: 'sv-panel-sub' }, String(err && err.message ? err.message : err)),
      el('p', { class: 'sv-panel-desc' }, '请确认服务端已启动，并通过 /beta 访问；新增 buff / 怪物文件后刷新页面即可生效。'),
      el('div', { class: 'sv-panel-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onClick: retryCatalog }, '重试'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => go('games') }, '返回大厅'),
      ]),
    ]));
  }

  async function refreshCatalog() {
    const { buffs, monsters } = await loadCatalog();
    BUFFS = buffs;
    MONSTERS = monsters;
    MONSTER_MAP.clear();
    MONSTERS.forEach((m) => MONSTER_MAP.set(m.id, m));
  }

  function retryCatalog() {
    showLoading();
    refreshCatalog().then(() => {
      updateHud();
      showStart();
    }).catch(showCatalogError);
  }

  function showGameOver() {
    const bestTime = Math.max(state.best.time, state.time);
    const bestKills = Math.max(state.best.kills, state.kills);
    const newRecord = state.time > state.best.time || state.kills > state.best.kills;
    state.best = { time: bestTime, kills: bestKills };
    saveBest(state.best);
    scheduleUpload();

    // 结算面板单独抽成函数：从局外天赋模态框返回时重画它，而不是回到开始面板
    const showResult = () => showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '💀'),
      el('h2', { class: 'sv-panel-title' }, `你撑了 ${formatTime(state.time)}`),
      el('p', { class: 'sv-panel-sub' }, newRecord ? '🎉 新纪录！' : '再接再厉'),
      el('p', { class: 'sv-panel-desc' }, `🌟 获得天赋点 +${state.lastReward || 0} · 当前共 ${getMeta().points} 点`),
      el('div', { class: 'sv-result' }, [
        el('div', {}, [el('strong', {}, String(state.kills)), el('span', {}, '击杀')]),
        el('div', {}, [el('strong', {}, `Lv.${state.level}`), el('span', {}, '等级')]),
        el('div', {}, [el('strong', {}, formatTime(state.best.time)), el('span', {}, '最佳存活')]),
      ]),
      el('div', { class: 'sv-panel-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onClick: startGame }, '再来一局'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openCatalog('talents', showResult) }, '🌟 局外天赋'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => go('games') }, '返回大厅'),
      ]),
    ]));
    showResult();
  }

  function pickUpgrades(count) {
    const picks = [];
    const available = BUFFS.filter((u) => (state.upgradeStacks[u.id] || 0) < (u.max || Infinity)
      && (!u.requires || u.requires(state.player, state)));
    if (!available.length) return picks;
    const hasAoe = BUFFS.some((u) => u.aoe && (state.upgradeStacks[u.id] || 0) > 0);
    // 还没拿到范围强化时，每次升级保证给一张，避免前期只能单体刮痧
    if (!hasAoe) {
      const aoePool = available.filter((u) => u.aoe);
      if (aoePool.length) picks.push(aoePool[Math.floor(Math.random() * aoePool.length)]);
    }
    const pool = available.filter((u) => !picks.includes(u));
    while (picks.length < count && pool.length) {
      picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return picks;
  }

  function openLevelUp() {
    const picks = pickUpgrades(3);
    // 所有强化都叠满时直接跳过本次升级
    if (!picks.length) {
      state.pendingLevels = Math.max(0, state.pendingLevels - 1);
      if (state.pendingLevels > 0) {
        openLevelUp();
        return;
      }
      hideOverlay();
      state.paused = false;
      state.pausedByLevelUp = false;
      state.last = performance.now();
      return;
    }
    state.paused = true;
    state.pausedByLevelUp = true;
    const cards = picks.map((u, i) => {
      const cur = state.upgradeStacks[u.id] || 0;
      // 已叠过的强化直接给出「当前 → 选后」数值，避免玩家不知道重复选择提升多少
      const hasEffect = typeof u.effect === 'function';
      const curText = hasEffect ? u.effect(cur) : u.desc;
      const nextText = hasEffect ? u.effect(cur + 1) : u.desc;
      return el('button', {
        class: 'sv-upgrade',
        type: 'button',
        onClick: () => chooseUpgrade(u),
      }, [
        el('span', { class: 'sv-upgrade-key' }, String(i + 1)),
        el('span', { class: 'sv-upgrade-icon' }, u.icon),
        el('span', { class: 'sv-upgrade-name' }, u.name),
        el('span', { class: 'sv-upgrade-stacks' }, cur > 0 ? `已有 ${cur} / ${u.max} 层` : '新强化'),
        el('span', { class: 'sv-upgrade-desc' }, ...highlightNumbers(u.desc)),
        el('span', { class: 'sv-upgrade-effect' }, ...highlightNumbers(cur > 0
          ? `${curText} → ${nextText}`
          : `选后：${nextText}`)),
      ]);
    });

    showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '⬆️'),
      el('h2', { class: 'sv-panel-title' }, `升级！Lv.${state.level}`),
      el('p', { class: 'sv-panel-sub' }, state.pendingLevels > 1
        ? `还有 ${state.pendingLevels - 1} 次升级`
        : '选择一项强化（按 1 / 2 / 3 也可选择）'),
      el('div', { class: 'sv-upgrades' }, cards),
    ]));
  }

  function chooseUpgrade(upgrade) {
    upgrade.apply(state.player, state);
    deriveStats(state.player);
    state.upgradeStacks[upgrade.id] = (state.upgradeStacks[upgrade.id] || 0) + 1;
    state.pendingLevels -= 1;
    updateHud();
    if (state.pendingLevels > 0) {
      openLevelUp();
      return;
    }
    hideOverlay();
    state.paused = false;
    state.pausedByLevelUp = false;
    state.last = performance.now();
  }

  // ---- 经验 / 升级 ----
  function gainXp(value) {
    state.xp += value * (state.player.xpGain || 1);
    while (state.xp >= state.xpNeeded) {
      state.xp -= state.xpNeeded;
      state.level += 1;
      state.pendingLevels += 1;
      state.xpNeeded = 6 + state.level * 3 + Math.floor(state.level * state.level * 0.3);
    }
    if (state.pendingLevels > 0 && !state.paused) openLevelUp();
  }

  // ---- 局内生成 ----
  function spawnPos() {
    const edge = Math.floor(Math.random() * 4);
    if (edge === 0) return { x: rand(-40, -12), y: rand(0, H) };
    if (edge === 1) return { x: rand(W + 12, W + 40), y: rand(0, H) };
    if (edge === 2) return { x: rand(0, W), y: rand(-40, -12) };
    return { x: rand(0, W), y: rand(H + 12, H + 40) };
  }

  function spawnEnemy(typeId, atX, atY) {
    const monster = MONSTER_MAP.get(typeId) || MONSTER_MAP.get('basic');
    if (!monster) return;
    const tpl = monster.stats || {};
    const pos = atX == null ? spawnPos() : { x: atX, y: atY };
    // 后期血量/速度/伤害同步放大，避免玩家叠满强化后完全无压力
    const hpScale = 1 + state.time / 90 + (state.time / 180) ** 2.2;
    const speedScale = 1 + Math.min(2.2, Math.max(0, state.time - 45) / 200);
    const dmgScale = 1 + Math.min(6, (Math.max(0, state.time - 40) / 260) ** 1.35);
    const hp = Math.round(tpl.hp * hpScale);
    state.enemies.push({
      id: state.nextEnemyId++,
      type: monster.id,
      shape: tpl.shape,
      color: tpl.color,
      x: pos.x,
      y: pos.y,
      r: tpl.r,
      hp,
      maxHp: hp,
      speed: tpl.speed * speedScale,
      dmg: Math.round(tpl.dmg * dmgScale),
      xp: tpl.xp,
      mode: 'chase',
      timer: 0,
      shootCd: rand(1.2, 2.4),
      fuse: 0,
      boss: false,
      hitCd: 0,
      flash: 0,
      dead: false,
    });
  }

  function spawnBoss() {
    const monster = MONSTER_MAP.get('boss');
    if (!monster) return;
    const tpl = monster.stats || {};
    const pos = spawnPos();
    const hp = Math.round((tpl.hp || 520) * (1 + state.bossCount * 1.2) * (1 + state.time / 150));
    state.bossCount += 1;
    state.enemies.push({
      id: state.nextEnemyId++,
      type: monster.id,
      shape: tpl.shape || 'boss',
      color: tpl.color || '#ff4d6d',
      x: pos.x,
      y: pos.y,
      r: tpl.r || 34,
      hp,
      maxHp: hp,
      speed: tpl.speed || 55,
      dmg: tpl.dmg || 24,
      xp: 0,
      mode: 'chase',
      timer: 0,
      shootCd: 2.2,
      fuse: 0,
      boss: true,
      hitCd: 0,
      flash: 0,
      dead: false,
    });
    state.shake = 0.3;
  }

  function randomEnemyType() {
    const pool = MONSTERS.filter((m) => m.spawnable && state.time >= (m.unlockAt || 0));
    if (!pool.length) return 'basic';
    let roll = Math.random() * pool.reduce((sum, m) => sum + (m.weight || 1), 0);
    for (const m of pool) {
      roll -= m.weight || 1;
      if (roll <= 0) return m.id;
    }
    return pool[pool.length - 1].id;
  }

  // 每波开始：额外涌入一批怪，配合 HUD 倒计时形成节奏
  function onWaveStart(wave) {
    state.waveBanner = 2.2;
    state.shake = Math.max(state.shake, 0.12);
    const cap = Math.min(420, 12 + Math.floor(state.time * 0.6));
    const burst = Math.min(16, 2 + wave, Math.max(0, cap - state.enemies.length));
    for (let i = 0; i < burst; i += 1) spawnEnemy(randomEnemyType());
  }

  function updateSpawn(dt) {
    if (state.time >= state.bossTimer) {
      state.bossTimer += BOSS_INTERVAL;
      spawnBoss();
    }
    // 前期限制同屏数量，后期逐步放开到 420，避免开局就被怪潮淹没
    const aliveCap = Math.min(420, 12 + Math.floor(state.time * 0.6));
    if (state.enemies.length >= aliveCap) return;
    state.spawnTimer -= dt;
    if (state.spawnTimer > 0) return;
    state.spawnTimer = Math.max(0.22, 1.6 - state.time * 0.006);
    const count = Math.min(8, 1 + Math.floor(Math.max(0, state.time - 40) / 55));
    for (let i = 0; i < count; i += 1) spawnEnemy(randomEnemyType());
  }

  // ---- 特效 ----
  function spawnParticles(x, y, color, count, speed) {
    if (state.particles.length > 260) return;
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(speed * 0.35, speed);
      state.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: rand(0.25, 0.55),
        maxLife: 0.55,
        r: rand(1.5, 3.4),
        color,
      });
    }
  }

  // ---- 战斗 ----
  // 愈灵等怪物阵亡后掉落的血包，玩家靠近自动拾取回血
  function spawnHealthPack(x, y) {
    if (state.healthPacks.length >= 12) return;
    state.healthPacks.push({ x, y, r: 9, bob: Math.random() * 6, dead: false });
  }

  function nearestEnemy() {
    const p = state.player;
    let best = null;
    let bestD2 = 800 * 800;
    for (const e of state.enemies) {
      if (e.dead) continue;
      const d2 = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  // 生成一枚玩家弹丸；element 默认物理，元素弹由 buff 指定
  function spawnProjectile(spec) {
    if (state.projectiles.length > 500) return;
    const { x, y, angle, speed, damage } = spec;
    state.projectiles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: spec.r ?? 4.5,
      damage,
      pierceLeft: spec.pierce ?? 0,
      hit: new Set(spec.ignoreIds || []),
      life: spec.life ?? 1.5,
      dead: false,
      element: spec.element || 'physical',
      elementRadius: spec.elementRadius || 0,
      elementDuration: spec.elementDuration || ELEMENT_DURATION,
      color: spec.color || '',
      fragment: spec.fragment || false,
    });
  }

  // 朝最近敌人打出一轮齐射；连击等 buff 也通过它追加射击
  function fireVolley(damageScale = 1) {
    const target = nearestEnemy();
    if (!target) return false;
    const p = state.player;
    const base = Math.atan2(target.y - p.y, target.x - p.x);
    const n = p.projectiles;
    const spread = n > 1 ? Math.min(BASE_SHOT.spreadMax, BASE_SHOT.spreadStep * (n - 1)) : 0;
    const volley = { base, damageScale, shots: [] };
    for (let i = 0; i < n; i += 1) {
      const angle = n === 1 ? base : base - spread + (spread * 2 * i) / (n - 1);
      volley.shots.push({
        x: p.x + Math.cos(angle) * (p.r + BASE_SHOT.muzzle),
        y: p.y + Math.sin(angle) * (p.r + BASE_SHOT.muzzle),
        angle,
        speed: p.projectileSpeed,
        damage: skillDamage(p, { atkPct: damageScale }),
        r: BASE_SHOT.r,
        pierce: p.pierce,
        life: BASE_SHOT.life,
        element: 'physical',
      });
    }
    // 元素弹等额外弹丸由各 buff 文件追加到 volley.shots
    for (const buff of BUFFS) {
      if (typeof buff.buildShots === 'function') buff.buildShots(volley, p, state);
    }
    for (const shot of volley.shots) spawnProjectile(shot);
    return true;
  }

  function autoAttack(dt) {
    state.attackTimer -= dt;
    if (state.attackTimer > 0) return;
    if (!nearestEnemy()) {
      state.attackTimer = 0;
      return;
    }
    const p = state.player;
    state.attackTimer = p.attackInterval;
    fireVolley(1);
    // 射击后触发的 buff（如连击）由各 buff 文件实现
    for (const buff of BUFFS) {
      if (typeof buff.afterAttack === 'function') buff.afterAttack(p, state, buffApi);
    }
  }

  function addExplosionVisual(x, y, radius) {
    if (state.explosions.length >= 40) return;
    state.explosions.push({ x, y, r: radius * 0.35, maxR: radius, life: 0.28, maxLife: 0.28 });
  }

  /** 范围伤害：对 radius 内的敌人造成 damage，excludeId 用于排除直接命中的目标 */
  function explodeAt(x, y, radius, damage, excludeId, depth = 0) {
    if (damage <= 0) return;
    addExplosionVisual(x, y, radius);
    spawnParticles(x, y, '#ffb703', 8, 210);
    for (const e of state.enemies) {
      if (e.dead || e.id === excludeId) continue;
      const rr = radius + e.r;
      if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr * rr) damageEnemy(e, damage, depth + 1);
    }
  }

  function hurtPlayer(amount) {
    if (state.hurtCd > 0) return false;
    state.hurtCd = 0.4;
    const p = state.player;
    // 单次伤害上限为最大生命的 30%，避免后期高倍率怪直接秒杀
    const capped = Math.min(amount, p.maxHp * 0.3);
    // 防御区减伤 → 护盾吸收 → 扣血
    let final = Math.max(1, capped * damageTakenZone(p.def));
    let absorbed = 0;
    if (p.shield > 0) {
      absorbed = Math.min(p.shield, final);
      p.shield -= absorbed;
      final -= absorbed;
      p.shieldCd = SHIELD_HIT_CD; // 受击后短时间内不再回复护盾
    }
    if (final > 0) p.hp -= final;
    state.flash = 1;
    state.shake = 0.3;
    spawnParticles(p.x, p.y, absorbed > 0 ? '#7dd3fc' : '#ff6b6b', 6, 190);

    // 受击类 buff（如反伤冲击波）
    const info = { amount, absorbed, hpDamage: Math.max(0, final) };
    for (const buff of BUFFS) {
      if (typeof buff.onHurt === 'function') buff.onHurt(p, state, info, buffApi);
    }

    if (p.hp > 0) return false;
    p.hp = 0;
    updateHud();
    gameOver();
    return true;
  }

  function spawnEnemyShot(x, y, angle, speed, damage, color) {
    if (state.enemyShots.length >= 240) return;
    state.enemyShots.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 5,
      damage,
      color: color || '#fb7185',
      life: 4,
      dead: false,
    });
  }

  function moveEnemy(e, dx, dy, dist, dt, speedMul = 1) {
    // 冻结期间完全禁止移动，兜底拦住所有怪物的移动入口
    if (e.freezeTimer > 0) return;
    e.x += (dx / dist) * e.speed * speedMul * dt;
    e.y += (dy / dist) * e.speed * speedMul * dt;
  }

  function updateEnemyShots(dt) {
    const p = state.player;
    for (const s of state.enemyShots) {
      if (s.dead) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0 || s.x < -30 || s.x > W + 30 || s.y < -30 || s.y > H + 30) {
        s.dead = true;
        continue;
      }
      const rr = s.r + p.r;
      if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 <= rr * rr) {
        s.dead = true;
        spawnParticles(s.x, s.y, s.color, 5, 150);
        if (hurtPlayer(s.damage)) return;
      }
    }
  }

  function damageEnemy(enemy, damage, depth = 0) {
    // 超导易伤：受击时按抗性降低比例放大伤害
    const final = enemy.vulnTimer > 0 ? damage * (1 + (enemy.vulnBonus || 0)) : damage;
    state.dmgAccum += Math.min(final, enemy.hp);
    enemy.hp -= final;
    enemy.flash = 0.12;
    spawnParticles(enemy.x, enemy.y, '#ffd93d', 3, 130);
    if (enemy.hp > 0 || enemy.dead) return;

    enemy.dead = true;
    state.kills += 1;
    if (state.player.lifesteal > 0) {
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + state.player.lifesteal);
    }
    spawnParticles(enemy.x, enemy.y, enemy.color, enemy.boss ? 26 : 10, enemy.boss ? 280 : 170);

    // 怪物自身的死亡效果（分裂、自爆等）由各自文件实现
    const monster = MONSTER_MAP.get(enemy.type);
    if (monster && typeof monster.onDeath === 'function') monster.onDeath(enemy, monsterApi);

    // buff 的击杀效果（如连锁爆裂）由各 buff 文件实现
    for (const buff of BUFFS) {
      if (typeof buff.onKill === 'function') buff.onKill(enemy, state.player, state, buffApi, depth);
    }

    if (enemy.boss) {
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        state.gems.push({
          x: enemy.x + Math.cos(a) * 26,
          y: enemy.y + Math.sin(a) * 26,
          value: 4,
          r: 5,
          bob: Math.random() * 6,
        });
      }
      state.shake = 0.45;
    } else {
      state.gems.push({
        x: enemy.x,
        y: enemy.y,
        value: enemy.xp,
        r: 5,
        bob: Math.random() * 6,
      });
    }
  }

  // ---- 主更新 ----
  // buff 的具体效果实现在各自文件里，这里只提供通用接口
  const buffApi = {
    addNova(x, y, innerR, maxR, color) {
      state.novas.push({ x, y, r: innerR, maxR, life: 0.5, maxLife: 0.5, color });
    },
    damageInRadius(x, y, radius, damage) {
      for (const e of state.enemies) {
        if (e.dead) continue;
        const rr = radius + e.r;
        if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr * rr) damageEnemy(e, damage);
      }
    },
    // 元素反应等需要指定目标结算伤害时使用
    damageEnemy(enemy, damage, depth = 0) {
      damageEnemy(enemy, damage, depth);
    },
    explodeAt,
    fireVolley(damageScale = 1) {
      return fireVolley(damageScale);
    },
    // 手动画一枚玩家弹丸（分裂碎片等）
    spawnPlayerShot(spec) {
      spawnProjectile(spec);
    },
    spawnParticles,
  };

  // 怪物的行为/死亡效果也写在各自文件里，这里只暴露通用能力
  const monsterApi = {
    state,
    rand,
    moveEnemy,
    spawnEnemy,
    spawnEnemyShot,
    spawnParticles,
    addExplosionVisual,
    hurtPlayer,
    spawnHealthPack,
    shake(v) {
      state.shake = Math.max(state.shake, v);
    },
    clampToArena(e, margin = 40) {
      e.x = Math.max(-margin, Math.min(W + margin, e.x));
      e.y = Math.max(-margin, Math.min(H + margin, e.y));
    },
  };

  function updateBuffs(dt) {
    for (const buff of BUFFS) {
      if (typeof buff.update === 'function') buff.update(dt, state.player, state, buffApi);
    }
  }

  function update(dt) {
    state.time += dt;
    const wave = Math.floor(state.time / WAVE_INTERVAL) + 1;
    if (wave !== state.wave) {
      state.wave = wave;
      onWaveStart(wave);
    }
    state.waveBanner = Math.max(0, state.waveBanner - dt);
    state.flash = Math.max(0, state.flash - dt * 2.2);
    state.shake = Math.max(0, state.shake - dt * 2.5);
    state.hurtCd = Math.max(0, state.hurtCd - dt);
    state.reactionCd = Math.max(0, (state.reactionCd || 0) - dt);

    // DPS：每 0.5 秒记录一次实际造成的伤害，取最近 4 秒平均
    state.dpsTick += dt;
    if (state.dpsTick >= 0.5) {
      state.dpsBuckets.push(state.dmgAccum);
      if (state.dpsBuckets.length > 8) state.dpsBuckets.shift();
      const total = state.dpsBuckets.reduce((sum, v) => sum + v, 0);
      state.dps = total / (state.dpsBuckets.length * 0.5);
      state.dmgAccum = 0;
      state.dpsTick = 0;
    }

    // 定期存档，刷新页面后可继续
    state.saveTimer -= dt;
    if (state.saveTimer <= 0) {
      state.saveTimer = 5;
      saveRun(state);
      scheduleUpload();
    }

    const p = state.player;

    // 移动（键盘 + 拖拽，任一方向输入合并后归一化）
    let mx = state.drag.x;
    let my = state.drag.y;
    if (keys.has('up')) my -= 1;
    if (keys.has('down')) my += 1;
    if (keys.has('left')) mx -= 1;
    if (keys.has('right')) mx += 1;
    const len = Math.hypot(mx, my);
    if (len > 0.01) {
      const nx = mx / Math.max(1, len);
      const ny = my / Math.max(1, len);
      p.x += nx * p.speed * dt;
      p.y += ny * p.speed * dt;
      p.face = Math.atan2(ny, nx);
      p.x = Math.max(p.r, Math.min(W - p.r, p.x));
      p.y = Math.max(p.r, Math.min(H - p.r, p.y));
    }

    if (p.regen > 0) p.hp = Math.min(p.maxHp, p.hp + p.regen * dt);

    autoAttack(dt);
    updateBuffs(dt);
    updateSpawn(dt);

    // 怪物行为 + 接触伤害
    for (const e of state.enemies) {
      if (e.dead) continue;
      e.hitCd = Math.max(0, e.hitCd - dt);
      e.flash = Math.max(0, e.flash - dt);
      if (e.elementTimer > 0) {
        e.elementTimer -= dt;
        if (e.elementTimer <= 0) e.element = '';
      }
      if (e.reactCd > 0) e.reactCd = Math.max(0, e.reactCd - dt);
      if (e.freezeTimer > 0) {
        e.freezeTimer = Math.max(0, e.freezeTimer - dt);
        if (e.freezeTimer <= 0) e.freezeAngle = 0;
      }
      if (e.vulnTimer > 0) e.vulnTimer = Math.max(0, e.vulnTimer - dt);
      // 冻结期间不移动、不攻击，也不造成接触伤害
      if (e.freezeTimer > 0) continue;
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      // 头顶带冰元素时减速 40%：临时缩放 e.speed，冲锋 / 绕行等所有移动实现都生效
      const iceSlow = e.element === 'ice' ? ICE_SLOW_FACTOR : 1;
      const rawSpeed = e.speed;
      if (iceSlow !== 1) e.speed = rawSpeed * iceSlow;
      const monster = MONSTER_MAP.get(e.type);
      if (monster && typeof monster.update === 'function') {
        monster.update(e, dx, dy, dist, dt, monsterApi);
      } else {
        moveEnemy(e, dx, dy, dist, dt, 1);
      }
      if (iceSlow !== 1) e.speed = rawSpeed;

      if (e.dead) continue;
      const touchDist = Math.hypot(p.x - e.x, p.y - e.y) || 1;
      if (touchDist < e.r + p.r && e.hitCd <= 0) {
        e.hitCd = e.boss ? 0.55 : 0.8;
        // hurtPlayer 内部有全局无敌帧，被围攻时不会同帧叠加秒杀
        if (hurtPlayer(e.dmg)) return;
      }
    }

    updateEnemyShots(dt);

    // 弹丸
    for (const pr of state.projectiles) {
      if (pr.dead) continue;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.life <= 0 || pr.x < -20 || pr.x > W + 20 || pr.y < -20 || pr.y > H + 20) {
        pr.dead = true;
        continue;
      }
      for (const e of state.enemies) {
        if (e.dead || pr.hit.has(e.id)) continue;
        const rr = pr.r + e.r;
        if ((pr.x - e.x) ** 2 + (pr.y - e.y) ** 2 <= rr * rr) {
          pr.hit.add(e.id);
          damageEnemy(e, pr.damage);
          // 碎冰：冻结中的怪物被物理子弹命中时解除冻结并追加伤害
          if (pr.element === 'physical') applyShatter(e, state, p, buffApi);
          // 元素弹：直接命中先结算元素反应/附着，再以命中点为中心给周围怪挂元素
          if (pr.element && pr.element !== 'physical') {
            applyElementHit(e, pr.element, state, p, buffApi, pr.elementDuration, pr.damage);
            if (pr.elementRadius > 0) {
              applyElementAoe(state, p, buffApi, pr.x, pr.y, pr.elementRadius, pr.element, pr.elementDuration, e.id);
            }
          }
          // buff 的命中效果（如爆裂弹溅射）由各 buff 文件实现
          for (const buff of BUFFS) {
            if (typeof buff.onHit === 'function') buff.onHit(e, pr, p, buffApi);
          }
          if (pr.pierceLeft <= 0) {
            pr.dead = true;
            break;
          }
          pr.pierceLeft -= 1;
        }
      }
    }

    // 经验宝石：进入拾取范围后飞向玩家（先用平方距离筛掉范围外的宝石，避免大量开方）
    const pickup2 = p.pickup * p.pickup;
    for (const g of state.gems) {
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= pickup2) continue;
      const dist = Math.sqrt(d2) || 1;
      const step = 420 * dt;
      if (dist <= step) {
        g.dead = true;
        gainXp(g.value);
      } else {
        g.x += (dx / dist) * step;
        g.y += (dy / dist) * step;
      }
    }

    // 血包：进入拾取范围后飞向玩家，拾取时回复 15% 最大生命
    for (const h of state.healthPacks) {
      if (h.dead) continue;
      const dx = p.x - h.x;
      const dy = p.y - h.y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= pickup2) continue;
      const dist = Math.sqrt(d2) || 1;
      const step = 420 * dt;
      if (dist <= step + h.r * 0.5) {
        h.dead = true;
        p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.15);
        spawnParticles(p.x, p.y, '#4ade80', 12, 180);
      } else {
        h.x += (dx / dist) * step;
        h.y += (dy / dist) * step;
      }
    }

    // 粒子
    for (const pt of state.particles) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.94;
      pt.vy *= 0.94;
      pt.life -= dt;
    }

    // 冲击波 / 爆炸 / 感电闪电特效
    for (const n of state.novas) n.life -= dt;
    for (const ex of state.explosions) ex.life -= dt;
    for (const arc of state.lightningArcs) arc.life -= dt;

    state.enemies = state.enemies.filter((e) => !e.dead);
    state.projectiles = state.projectiles.filter((pr) => !pr.dead);
    state.enemyShots = state.enemyShots.filter((s) => !s.dead);
    state.gems = state.gems.filter((g) => !g.dead);
    state.healthPacks = state.healthPacks.filter((h) => !h.dead);
    state.particles = state.particles.filter((pt) => pt.life > 0);
    state.novas = state.novas.filter((n) => n.life > 0);
    state.explosions = state.explosions.filter((ex) => ex.life > 0);
    state.lightningArcs = state.lightningArcs.filter((arc) => arc.life > 0);
  }

  // ---- 开局 / 结算 ----
  function startGame() {
    if (!BUFFS.length || !MONSTERS.length) return; // 图鉴数据未就绪时不开局
    clearRun();
    scheduleUpload();
    hideOverlay();
    state.mode = 'playing';
    state.paused = false;
    state.pausedByLevelUp = false;
    state.time = 0;
    state.kills = 0;
    state.level = 1;
    state.xp = 0;
    state.xpNeeded = 9;
    state.pendingLevels = 0;
    state.player = { ...PLAYER_BASE };
    applyTalents(state.player);
    // 局外天赋先作用到基础属性，之后 buff 只按层数在 base 上做修正
    deriveStats(state.player);
    state.player.base = snapshotBaseStats(state.player);
    state.player.hp = state.player.maxHp;
    state.player.shield = state.player.shieldMax;
    state.enemies = [];
    state.projectiles = [];
    state.enemyShots = [];
    state.gems = [];
    state.healthPacks = [];
    state.particles = [];
    state.upgradeStacks = {};
    state.attackTimer = 0.35;
    state.comboTimer = 0;
    state.comboPending = 0;
    state.dpsBuckets = [];
    state.dmgAccum = 0;
    state.dpsTick = 0;
    state.dps = 0;
    state.saveTimer = 5;
    state.thornsCd = 0;
    state.lastReward = 0;
    state.nextEnemyId = 1;
    state.spawnTimer = 1.2;
    state.bossTimer = BOSS_INTERVAL;
    state.bossCount = 0;
    state.wave = 1;
    state.waveBanner = 0;
    state.hurtCd = 0;
    state.novaTimer = 2.5;
    state.novas = [];
    state.explosions = [];
    state.lightningArcs = [];
    state.reactionCd = 0;
    state.flash = 0;
    state.shake = 0;
    state.drag = { x: 0, y: 0 };
    keys.clear();
    state.last = performance.now();
    updateHud();
  }

  function gameOver() {
    state.mode = 'dead';
    state.paused = true;
    clearRun();
    // 局外天赋点：按本局存活时间、击杀与 Boss 数发放
    const reward = grantRunPoints({
      time: state.time,
      kills: state.kills,
      bossCount: state.bossCount,
    });
    state.lastReward = reward.gained;
    scheduleUpload();
    showGameOver();
  }

  // 手动结算：后期成型后很难被打死，由玩家主动结束本局并结算成绩
  function settleNow() {
    if (state.mode !== 'playing') return;
    state.drag = { x: 0, y: 0 };
    keys.clear();
    gameOver();
  }

  // ---- 输入 ----
  const keys = new Set();
  const KEY_MAP = {
    arrowup: 'up', w: 'up',
    arrowdown: 'down', s: 'down',
    arrowleft: 'left', a: 'left',
    arrowright: 'right', d: 'right',
  };

  function onKeydown(e) {
    const key = e.key.toLowerCase();
    // F3 随时切换调试面板
    if (key === 'f3') {
      e.preventDefault();
      toggleDebug();
      return;
    }
    // F4 录制 / 停止并下载调试日志
    if (key === 'f4') {
      e.preventDefault();
      toggleRecording();
      return;
    }
    // 基准测试期间吞掉所有按键，Esc 退出
    if (bench) {
      if (key === 'escape') {
        e.preventDefault();
        abortBenchmark();
      } else if (key === 'f3') {
        e.preventDefault();
        bench.showInfo = !bench.showInfo;
        bench.infoEl.classList.toggle('show', bench.showInfo);
      }
      return;
    }
    if (benchView && key === 'escape') {
      e.preventDefault();
      closeBenchmarkPanel();
      return;
    }
    // 图鉴打开时吞掉所有按键，避免 Esc 恢复游戏或 Enter 在后台开局
    if (catalogOpen) {
      e.preventDefault();
      e.stopPropagation();
      if (key === 'escape') closeCatalog();
      return;
    }
    // 对局中（含暂停 / 选卡）吞掉移动键，避免冒泡到页面滚动或其它监听
    if (state.mode === 'playing' && KEY_MAP[key]) {
      e.preventDefault();
      e.stopPropagation();
      if (!state.paused) keys.add(KEY_MAP[key]);
      return;
    }
    if (state.mode === 'playing' && state.paused && /^[1-3]$/.test(key)) {
      const btn = overlay.querySelectorAll('.sv-upgrade')[Number(key) - 1];
      if (btn) {
        e.preventDefault();
        btn.click();
      }
      return;
    }
    if (key === 'escape' && settingsOpen) {
      e.preventDefault();
      closeSettings();
      return;
    }
    if (key === 'escape' && state.mode === 'playing') {
      e.preventDefault();
      if (state.pausedByLevelUp) return; // 升级选择必须选一项
      if (state.paused) choosePauseResume();
      else pauseGame();
      return;
    }
    if (key === 'enter' && state.mode !== 'playing') {
      e.preventDefault();
      startGame();
    }
  }

  function onKeyup(e) {
    const dir = KEY_MAP[e.key.toLowerCase()];
    if (dir) {
      keys.delete(dir);
      e.stopPropagation();
    }
  }

  // Esc 暂停：复用升级层外壳，但不发强化，只提供继续/重开
  function pauseGame() {
    if (state.pausedByLevelUp) return; // 升级选择中不允许用暂停跳过
    state.paused = true;
    saveRun(state);
    scheduleUpload();
    showOverlay(el('div', { class: 'sv-panel' }, [
      el('div', { class: 'sv-panel-icon' }, '⏸'),
      el('h2', { class: 'sv-panel-title' }, '已暂停'),
      el('p', { class: 'sv-panel-sub' }, `存活 ${formatTime(state.time)} · 击杀 ${state.kills}`),
      el('div', { class: 'sv-panel-actions' }, [
        el('button', { class: 'btn btn-primary', type: 'button', onClick: choosePauseResume }, '继续游戏'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openCatalog('buffs', pauseGame) }, '📖 图鉴'),
        el('button', { class: 'btn btn-danger', type: 'button', onClick: settleNow }, '结束本局'),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => go('games') }, '返回大厅'),
      ]),
    ]));
  }

  function choosePauseResume() {
    hideOverlay();
    state.paused = false;
    state.last = performance.now();
  }

  // 拖拽移动（鼠标 / 触摸通用）
  let dragStart = null;

  // 竖屏全屏时容器被 CSS 旋转 90°，需要把屏幕拖拽方向换算成游戏内方向
  function isForcedLandscape() {
    return wrap.classList.contains('fs-active')
      && window.matchMedia('(orientation: portrait) and (max-width: 820px)').matches;
  }

  function onPointerDown(e) {
    if (state.mode !== 'playing' || state.paused) return;
    dragStart = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) {
      state.drag = { x: 0, y: 0 };
      return;
    }
    // 旋转 90°：屏幕向右 = 游戏向下，屏幕向下 = 游戏向左
    const forced = isForcedLandscape();
    const vx = forced ? dy : dx;
    const vy = forced ? -dx : dy;
    state.drag = { x: vx / dist, y: vy / dist };
  }
  function onPointerUp() {
    dragStart = null;
    state.drag = { x: 0, y: 0 };
  }

  // ---- 渲染分辨率自适应 ----
  // 这台机器上 JS 只占 0.5ms、帧却要 40ms+，瓶颈是画布像素光栅化，
  // 因此低帧时降低渲染倍率（画布像素量），高帧时再缓慢恢复。
  let qualityDownCooldown = 0;
  let qualityUpCooldown = 0;
  let qualityUpStreak = 0;
  // 记录曾经掉帧的倍率上界，避免「升一点 → 掉帧 → 再降」反复震荡
  let qualityCeiling = 1;

  function qualityFloor() {
    if (state.qualityMode === 'smooth') return 0.55;
    if (state.qualityMode === 'sharp') return 1;
    // 自动：最低只到 CSS 像素 1:1，再低就会被明显放大变糊
    return renderer.getMinQuality();
  }

  function refreshQualityBtn() {
    const meta = QUALITY_META[state.qualityMode] || QUALITY_META.auto;
    qualityBtn.textContent = meta.icon;
    qualityBtn.title = `${meta.tip} · 点击切换`;
  }

  function setQualityMode(mode) {
    state.qualityMode = mode;
    try {
      localStorage.setItem(QUALITY_KEY, mode);
    } catch (e) {
      // 隐私模式下忽略
    }
    qualityUpStreak = 0;
    qualityUpCooldown = performance.now();
    if (mode === 'sharp') {
      // 手动选了高清就清掉学习到的上界，以后想回自动可以再试
      qualityCeiling = 1;
      renderer.setQuality(1);
    } else if (mode === 'smooth') {
      renderer.setQuality(Math.min(renderer.getQuality(), 0.7));
    } else {
      renderer.setQuality(Math.max(renderer.getQuality(), qualityFloor()));
    }
    refreshQualityBtn();
    if (state.paused) renderer.render();
  }

  function cycleQuality() {
    const order = ['auto', 'sharp', 'smooth'];
    setQualityMode(order[(order.indexOf(state.qualityMode) + 1) % order.length]);
  }

  // ---- 画质与性能设置面板 ----
  let settingsOpen = false;

  function closeSettings() {
    settingsOpen = false;
    hideOverlay();
    if (state.mode === 'playing') {
      state.paused = false;
      state.last = performance.now();
      if (state.pendingLevels > 0) openLevelUp();
    } else {
      // 从开始界面打开的设置，关闭后回到开始界面
      showStart();
    }
  }

  function openSettings() {
    settingsOpen = true;
    state.paused = true;
    const s = state.settings;
    const panel = el('div', { class: 'sv-panel sv-settings' });
    panel.appendChild(el('h2', { class: 'sv-panel-title' }, '画质与性能'));
    panel.appendChild(el('p', { class: 'sv-panel-sub' }, '设置保存在本机，刷新后保留'));

    const rows = el('div', { class: 'sv-settings-rows' });
    const addRow = (label, options, getValue, apply, rebuild) => {
      const row = el('div', { class: 'sv-row' }, [el('span', { class: 'sv-row-label' }, label)]);
      const box = el('div', { class: 'sv-opts' });
      options.forEach(([value, text]) => {
        const btn = el('button', {
          class: `sv-opt${getValue() === value ? ' active' : ''}`,
          type: 'button',
        }, text);
        btn.addEventListener('click', () => {
          apply(value);
          saveSettings(state.settings);
          if (rebuild) {
            openSettings();
            return;
          }
          box.querySelectorAll('.sv-opt').forEach((n) => n.classList.remove('active'));
          btn.classList.add('active');
          if (state.paused) renderer.render();
        });
        box.appendChild(btn);
      });
      row.appendChild(box);
      rows.appendChild(row);
    };

    // 画质预设：一键套用一组成熟的组合，任意分项被改动后自动显示「自定义」
    const isPreset = (q, particles, glow, gemGlow, flash, shake, bg) => state.qualityMode === q
      && s.particles === particles && s.glow === glow && s.gemGlow === gemGlow
      && s.flash === flash && s.shake === shake && s.background === bg;
    const currentPreset = isPreset('smooth', 'low', false, false, false, false, 'plain')
      ? 'low'
      : isPreset('auto', 'mid', true, true, true, true, 'grid')
        ? 'mid'
        : isPreset('sharp', 'high', true, true, true, true, 'stars') ? 'high' : 'custom';

    addRow('画质预设', [
      ['low', '低'],
      ['mid', '中'],
      ['high', '高'],
      ['custom', '自定义'],
    ], () => currentPreset, (v) => {
      if (v === 'low') {
        setQualityMode('smooth');
        Object.assign(s, {
          particles: 'low', glow: false, gemGlow: false, icons: true, flash: false, shake: false, background: 'plain',
        });
      } else if (v === 'mid') {
        setQualityMode('auto');
        Object.assign(s, {
          particles: 'mid', glow: true, gemGlow: true, icons: true, flash: true, shake: true, background: 'grid',
        });
      } else if (v === 'high') {
        setQualityMode('sharp');
        Object.assign(s, {
          particles: 'high', glow: true, gemGlow: true, icons: true, flash: true, shake: true, background: 'stars',
        });
      }
      renderer.refreshBackground();
    }, true);

    addRow('画质', [
      ['auto', '🖥 自动'],
      ['sharp', '🔍 高清'],
      ['smooth', '⚡ 流畅'],
    ], () => state.qualityMode, (v) => setQualityMode(v));

    addRow('分辨率上限', [
      [1280, '1280'],
      [1600, '1600'],
      [1920, '1920'],
      [2560, '2560'],
    ], () => s.canvasCap, (v) => {
      s.canvasCap = v;
      renderer.resizeCanvas();
    });

    addRow('帧率上限', [
      [0, '不限制'],
      [144, '144'],
      [120, '120'],
      [90, '90'],
      [60, '60'],
      [30, '30'],
    ], () => s.fpsCap, (v) => {
      s.fpsCap = v;
      state.last = performance.now();
    });

    addRow('粒子特效', [
      ['high', '高'],
      ['mid', '中'],
      ['low', '低'],
      ['off', '关'],
    ], () => s.particles, (v) => {
      s.particles = v;
    });

    addRow('屏幕震动', [
      [true, '开'],
      [false, '关'],
    ], () => s.shake, (v) => {
      s.shake = v;
    });

    addRow('背景样式', [
      ['grid', '网格'],
      ['stars', '星空'],
      ['plain', '纯色'],
    ], () => s.background, (v) => {
      s.background = v;
      renderer.refreshBackground();
    });

    addRow('敌人辉光', [
      [true, '开'],
      [false, '关'],
    ], () => s.glow, (v) => {
      s.glow = v;
    });

    addRow('经验球光效', [
      [true, '开'],
      [false, '关'],
    ], () => s.gemGlow, (v) => {
      s.gemGlow = v;
    });

    addRow('元素图标', [
      [true, '显示'],
      [false, '隐藏'],
    ], () => s.icons, (v) => {
      s.icons = v;
    });

    addRow('受击闪屏', [
      [true, '开'],
      [false, '关'],
    ], () => s.flash, (v) => {
      s.flash = v;
    });

    panel.appendChild(rows);

    const info = el('div', { class: 'sv-settings-info' });
    info.appendChild(el('div', {}, `GPU：${state.gpu}`));
    info.appendChild(el('div', {}, `画布 ${canvas.width}×${canvas.height} · 倍率 ${renderer.getQuality().toFixed(2)} · DPR ${(window.devicePixelRatio || 1).toFixed(1)}`));
    const benchLine = el('div', {}, '画布加速检测：未运行');
    info.appendChild(benchLine);
    panel.appendChild(info);

    const actions = el('div', { class: 'sv-settings-actions' });
    const benchBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, '检测画布加速');
    benchBtn.addEventListener('click', () => {
      benchLine.textContent = '画布加速检测：运行中…';
      setTimeout(() => {
        const ms = benchmarkCanvas();
        benchLine.textContent = `画布加速检测：${ms.toFixed(0)}ms · ${ms > 80 ? '疑似软件渲染，建议开启浏览器硬件加速' : '硬件加速正常'}`;
      }, 30);
    });
    actions.appendChild(benchBtn);

    const edge = /Edg\//.test(navigator.userAgent);
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
    const gpuUrl = isMobile ? '' : (edge ? 'edge://gpu' : (/Chrome\//.test(navigator.userAgent) ? 'chrome://gpu' : ''));
    if (gpuUrl) {
      const copyBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, `复制加速设置地址（${gpuUrl}）`);
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(gpuUrl);
          copyBtn.textContent = `已复制：${gpuUrl}`;
        } catch (e) {
          copyBtn.textContent = `请手动输入：${gpuUrl}`;
        }
      });
      actions.appendChild(copyBtn);
    }
    const benchEntry = el('button', { class: 'btn btn-secondary', type: 'button' }, '性能基准测试');
    benchEntry.addEventListener('click', () => startBenchmark());
    actions.appendChild(benchEntry);
    panel.appendChild(actions);
    panel.appendChild(el('p', { class: 'sv-panel-sub sv-settings-tip' }, isMobile
      ? '移动端浏览器默认开启画布硬件加速，没有开关；若掉帧请选「流畅」或把粒子调低。'
      : `若检测显示“疑似软件渲染”：地址栏打开 ${gpuUrl || 'about://gpu'} 确认 Canvas 是否为 Hardware accelerated；若为 Software only，到 about://flags 把 disable-accelerated-2d-canvas 设为 Disabled 后重启浏览器。`));

    const backRow = el('div', { class: 'sv-panel-actions' });
    const closeBtn = el('button', { class: 'btn btn-primary', type: 'button' }, '返回游戏');
    closeBtn.addEventListener('click', () => closeSettings());
    backRow.appendChild(closeBtn);
    panel.appendChild(backRow);

    showOverlay(panel);
    renderer.render();
  }

  // ---- 性能基准：固定场景 + 固定对象数量，排除玩法随机性 ----
  let bench = null;
  let benchView = false;

  const BENCH_PHASES = [
    { name: '空场景', enemies: 0, projectiles: 0, shots: 0, gems: 0, particles: 0, effects: 0 },
    { name: '100 怪', enemies: 100, projectiles: 0, shots: 0, gems: 0, particles: 0, effects: 0 },
    { name: '200 怪 + 120 弹', enemies: 200, projectiles: 120, shots: 0, gems: 0, particles: 0, effects: 0 },
    { name: '300 怪 + 弹幕 + 球 + 粒子', enemies: 300, projectiles: 200, shots: 40, gems: 300, particles: 250, effects: 6 },
    { name: '500 怪 + 极限弹幕', enemies: 500, projectiles: 320, shots: 80, gems: 400, particles: 400, effects: 12 },
  ];
  const BENCH_SHAPES = ['circle', 'triangle', 'square', 'charger', 'shooter', 'splitter', 'bomber'];
  const BENCH_COLORS = ['#f87171', '#fb923c', '#facc15', '#a78bfa', '#38bdf8', '#34d399'];
  const BENCH_ELEMENTS = [null, 'fire', 'ice', 'thunder', 'water'];
  const BENCH_PROJECTILE_COLORS = ['#ffe066', '#93c5fd', '#fca5a5', '#86efac'];

  function makeBenchRng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function createBenchState() {
    return {
      time: 0,
      player: { x: W / 2, y: H / 2, r: 12, face: 0 },
      enemies: [],
      projectiles: [],
      enemyShots: [],
      gems: [],
      healthPacks: [],
      particles: [],
      novas: [],
      explosions: [],
      lightningArcs: [],
      waveBanner: 0,
      flash: 0,
      shake: 0,
      settings: state.settings,
    };
  }

  // 每幕固定种子生成同样布局，便于不同画质/设置之间横向对比
  function buildBenchPhase(bs, spec, seed) {
    const rng = makeBenchRng(seed);
    bs.enemies.length = 0;
    bs.projectiles.length = 0;
    bs.enemyShots.length = 0;
    bs.gems.length = 0;
    bs.particles.length = 0;
    bs.novas.length = 0;
    bs.explosions.length = 0;
    bs.lightningArcs.length = 0;

    const n = spec.enemies;
    if (n > 0) {
      const cols = Math.ceil(Math.sqrt(n * (W / H)));
      const rows = Math.ceil(n / cols);
      for (let i = 0; i < n; i += 1) {
        const boss = n >= 60 && i % 61 === 0;
        const bx = ((i % cols) + 0.5) / cols * (W - 60) + 30;
        const by = (Math.floor(i / cols) + 0.5) / rows * (H - 60) + 30;
        bs.enemies.push({
          x: bx,
          y: by,
          bx,
          by,
          // 固定相位的慢速漂浮，模拟真实战斗中的走位；冻结目标保持静止
          phase: rng() * Math.PI * 2,
          wobble: (boss ? 0.35 : 0.8) + rng() * 0.9,
          r: boss ? 26 : 8 + (i % 5) * 1.8,
          color: BENCH_COLORS[i % BENCH_COLORS.length],
          shape: boss ? 'circle' : BENCH_SHAPES[i % BENCH_SHAPES.length],
          boss,
          type: boss ? 'boss' : 'normal',
          hp: 100,
          maxHp: 100,
          flash: 0,
          freezeTimer: i % 17 === 0 ? 999 : 0,
          vulnTimer: i % 13 === 0 ? 999 : 0,
          element: i % 4 === 0 ? BENCH_ELEMENTS[((i / 4) | 0) % BENCH_ELEMENTS.length] : null,
          mode: '',
          fuse: 0,
        });
      }
    }
    for (let i = 0; i < spec.projectiles; i += 1) {
      const angle = rng() * Math.PI * 2;
      bs.projectiles.push({
        x: 20 + rng() * (W - 40),
        y: 20 + rng() * (H - 40),
        vx: Math.cos(angle) * 60,
        vy: Math.sin(angle) * 60,
        r: 3.2,
        color: BENCH_PROJECTILE_COLORS[i % BENCH_PROJECTILE_COLORS.length],
      });
    }
    for (let i = 0; i < spec.shots; i += 1) {
      const angle = rng() * Math.PI * 2;
      bs.enemyShots.push({
        x: 20 + rng() * (W - 40),
        y: 20 + rng() * (H - 40),
        vx: Math.cos(angle) * 45,
        vy: Math.sin(angle) * 45,
        r: 5,
        color: '#f87171',
      });
    }
    for (let i = 0; i < spec.gems; i += 1) {
      const by = 16 + rng() * (H - 32);
      bs.gems.push({
        x: 16 + rng() * (W - 32), y: by, by, r: 2.6, bob: rng() * 6,
      });
    }
    for (let i = 0; i < spec.particles; i += 1) {
      const angle = rng() * Math.PI * 2;
      const speed = 20 + rng() * 60;
      bs.particles.push({
        x: rng() * W,
        y: rng() * H,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r: 2,
        color: '#fbbf24',
        life: 0.2 + rng() * 0.4,
        maxLife: 0.6,
      });
    }
    for (let i = 0; i < spec.effects; i += 1) {
      const x = 60 + rng() * (W - 120);
      const y = 60 + rng() * (H - 120);
      bs.novas.push({ x, y, r: 10, maxR: 120, life: 0.5, maxLife: 0.6, color: '#67e8f9' });
      if (i % 2 === 0) {
        bs.explosions.push({ x: x + 40, y: y + 20, r: 8, maxR: 90, life: 0.4, maxLife: 0.5 });
      }
    }
    if (spec.effects > 0) {
      for (let i = 0; i < 4; i += 1) {
        const points = [];
        for (let k = 0; k < 5; k += 1) {
          points.push({ x: 100 + i * 160 + k * 40, y: 120 + (k % 2) * 40 });
        }
        bs.lightningArcs.push({ points, life: 1 });
      }
    }
  }

  function startBenchmark() {
    if (bench) return;
    benchView = true;
    hideOverlay();
    state.paused = true;
    const wrapEl = el('div', { class: 'sv-bench' });
    const bCanvas = el('canvas');
    const label = el('div', { class: 'sv-bench-label' }, '准备中…');
    // 基准专用的实时信息面板，样式复用调试面板
    const infoEl = el('pre', { class: 'sv-debug show sv-bench-info' }, '基准准备中…');
    wrapEl.appendChild(bCanvas);
    wrapEl.appendChild(label);
    wrapEl.appendChild(infoEl);
    arena.appendChild(wrapEl);
    const bctx = bCanvas.getContext('2d', { alpha: false });
    const benchState = createBenchState();
    const bRenderer = createRenderer({ canvas: bCanvas, ctx: bctx, state: benchState, W, H });
    bRenderer.resizeCanvas();
    bRenderer.setQuality(renderer.getQuality());
    bench = {
      active: true,
      wrapEl,
      bCanvas,
      bRenderer,
      benchState,
      label,
      infoEl,
      showInfo: true,
      infoAt: 0,
      recent: [],
      raf: 0,
      index: -1,
      phaseStart: 0,
      last: 0,
      samples: [],
      results: [],
    };
    nextBenchPhase();
    bench.raf = requestAnimationFrame((t) => benchLoop(t));
  }

  function nextBenchPhase() {
    bench.index += 1;
    if (bench.index >= BENCH_PHASES.length) {
      finishBenchmark();
      return;
    }
    const spec = BENCH_PHASES[bench.index];
    buildBenchPhase(bench.benchState, spec, 1000 + bench.index * 131);
    bench.samples = [];
    bench.recent = [];
    bench.phaseStart = performance.now();
    bench.last = bench.phaseStart;
    bench.label.textContent = `基准 ${bench.index + 1}/${BENCH_PHASES.length} · ${spec.name}`;
    bench.infoAt = 0;
  }

  function updateBenchInfo(b) {
    const arr = b.recent;
    const avg = (f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0);
    const avgInterval = avg((x) => x.interval);
    const avgDraw = avg((x) => x.drawMs);
    const maxDraw = arr.reduce((m, x) => Math.max(m, x.drawMs), 0);
    const bs = b.benchState;
    const spec = BENCH_PHASES[b.index] || { name: '-' };
    b.infoEl.textContent = [
      `基准 ${b.index + 1}/${BENCH_PHASES.length} · ${spec.name}`,
      `FPS ${avgInterval > 0 ? (1000 / avgInterval).toFixed(1) : '--'} · 帧 ${avgInterval.toFixed(1)}ms`,
      `绘制 平均 ${avgDraw.toFixed(2)}ms · 峰值 ${maxDraw.toFixed(1)}ms`,
      `对象 怪 ${bs.enemies.length} · 弹 ${bs.projectiles.length} · 敌弹 ${bs.enemyShots.length} · 球 ${bs.gems.length} · 粒子 ${bs.particles.length}`,
      `画布 ${b.bCanvas.width}×${b.bCanvas.height} · 倍率 ${b.bRenderer.getQuality().toFixed(2)} · DPR ${(window.devicePixelRatio || 1).toFixed(1)}`,
      `GPU ${state.gpu}`,
    ].join('\n');
  }

  // 恒定对象数下的轻量动画：只改坐标与生命，不生成/销毁实体，保证负载可控
  function updateBenchScene(bs, dt) {
    const t = bs.time;
    for (const e of bs.enemies) {
      if (e.freezeTimer > 0) continue;
      const nx = e.bx + Math.sin(t * e.wobble + e.phase) * 14;
      const ny = e.by + Math.cos(t * e.wobble * 0.85 + e.phase) * 11;
      e.x = nx < 20 ? 20 : nx > W - 20 ? W - 20 : nx;
      e.y = ny < 20 ? 20 : ny > H - 20 ? H - 20 : ny;
    }
    const wrap = (v, max) => (v < 0 ? v + max : v > max ? v - max : v);
    for (const pr of bs.projectiles) {
      pr.x = wrap(pr.x + pr.vx * dt, W);
      pr.y = wrap(pr.y + pr.vy * dt, H);
    }
    for (const shot of bs.enemyShots) {
      shot.x = wrap(shot.x + shot.vx * dt, W);
      shot.y = wrap(shot.y + shot.vy * dt, H);
    }
    for (const g of bs.gems) {
      g.y = g.by + Math.sin(t * 2.4 + g.bob) * 2.2;
    }
    for (const p of bs.particles) {
      p.life -= dt;
      if (p.life <= 0) {
        p.life = p.maxLife;
        p.x = (p.x + 97) % W;
        p.y = (p.y + 53) % H;
      }
      p.x = wrap(p.x + p.vx * dt, W);
      p.y = wrap(p.y + p.vy * dt, H);
    }
    bs.player.face = Math.sin(t * 1.6) * 0.6;
  }

  function benchLoop(now) {
    if (!bench || !bench.active) return;
    bench.raf = requestAnimationFrame((t) => benchLoop(t));
    const interval = now - bench.last;
    bench.last = now;
    const dt = Math.min(0.04, Math.max(0, interval) / 1000);
    bench.benchState.time += dt;
    updateBenchScene(bench.benchState, dt);
    const t0 = performance.now();
    bench.bRenderer.render();
    const drawMs = performance.now() - t0;
    const elapsed = now - bench.phaseStart;
    bench.recent.push({ interval, drawMs });
    if (bench.recent.length > 60) bench.recent.shift();
    if (now - bench.infoAt > 250) {
      bench.infoAt = now;
      updateBenchInfo(bench);
    }
    // 丢弃前 0.8 秒预热，只统计稳定段
    if (elapsed > 800) bench.samples.push({ drawMs, interval });
    if (elapsed >= 3500) finishBenchPhase();
  }

  function finishBenchPhase() {
    const spec = BENCH_PHASES[bench.index];
    const samples = bench.samples;
    const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    const sorted = (arr) => [...arr].sort((a, b) => a - b);
    const pick = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0);
    const draws = sorted(samples.map((s) => s.drawMs));
    const intervals = sorted(samples.map((s) => s.interval).filter((v) => v > 0));
    bench.results.push({
      name: spec.name,
      counts: `怪 ${spec.enemies} · 弹 ${spec.projectiles} · 敌弹 ${spec.shots} · 球 ${spec.gems} · 粒子 ${spec.particles} · 特效 ${spec.effects}`,
      frames: samples.length,
      fps: intervals.length ? 1000 / avg(intervals) : 0,
      avgFrameMs: avg(intervals),
      p95FrameMs: pick(intervals, 0.95),
      drawMs: avg(draws),
      p95DrawMs: pick(draws, 0.95),
      maxDrawMs: draws.length ? draws[draws.length - 1] : 0,
    });
    nextBenchPhase();
  }

  function finishBenchmark() {
    if (!bench) return;
    const results = bench.results;
    const meta = {
      at: new Date().toISOString(),
      gpu: state.gpu,
      qualityMode: state.qualityMode,
      renderQuality: renderer.getQuality(),
      canvas: `${bench.bCanvas.width}x${bench.bCanvas.height}`,
      dpr: window.devicePixelRatio || 1,
      screen: `${window.screen.width}x${window.screen.height}`,
      settings: { ...state.settings },
    };
    const benchCanvas = bench.bCanvas;
    if (bench.wrapEl && bench.wrapEl.parentElement) bench.wrapEl.remove();
    bench = null;
    showBenchResults(results, meta, benchCanvas.width, benchCanvas.height);
  }

  function showBenchResults(results, meta, bw, bh) {
    const panel = el('div', { class: 'sv-panel sv-bench-panel' });
    panel.appendChild(el('h2', { class: 'sv-panel-title' }, '性能基准结果'));
    panel.appendChild(el('p', { class: 'sv-panel-sub' }, `${bw}×${bh} · 倍率 ${meta.renderQuality.toFixed(2)} · 画质 ${meta.qualityMode}`));
    const table = el('div', { class: 'sv-bench-table' });
    table.appendChild(el('div', { class: 'sv-bench-th' }, '场景'));
    table.appendChild(el('div', { class: 'sv-bench-th' }, 'FPS'));
    table.appendChild(el('div', { class: 'sv-bench-th' }, '平均帧'));
    table.appendChild(el('div', { class: 'sv-bench-th' }, 'P95 帧'));
    table.appendChild(el('div', { class: 'sv-bench-th' }, '绘制'));
    results.forEach((r) => {
      table.appendChild(el('div', { class: 'sv-bench-td sv-bench-name' }, [el('strong', {}, r.name), el('span', {}, r.counts)]));
      table.appendChild(el('div', { class: 'sv-bench-td' }, r.fps.toFixed(1)));
      table.appendChild(el('div', { class: 'sv-bench-td' }, `${r.avgFrameMs.toFixed(1)}ms`));
      table.appendChild(el('div', { class: 'sv-bench-td' }, `${r.p95FrameMs.toFixed(1)}ms`));
      table.appendChild(el('div', { class: 'sv-bench-td' }, `${r.drawMs.toFixed(1)}ms`));
    });
    panel.appendChild(table);
    panel.appendChild(el('p', { class: 'sv-settings-tip' }, `GPU：${meta.gpu}。各场景固定种子、固定对象数，重复测试或切换画质后重新测试即可横向对比。`));

    const actions = el('div', { class: 'sv-panel-actions' });
    // 移动端剪贴板接口经常不可用，失败时展开可选中的文本框供长按复制
    const copyArea = el('textarea', { class: 'sv-bench-copy' });
    copyArea.readOnly = true;
    copyArea.style.display = 'none';
    const copyResultBtn = el('button', { class: 'btn btn-secondary', type: 'button' }, '复制结果');
    copyResultBtn.addEventListener('click', async () => {
      const lines = [
        `性能基准 ${meta.at}`,
        `GPU ${meta.gpu}`,
        `画布 ${bw}×${bh} · 倍率 ${meta.renderQuality.toFixed(2)} · 画质 ${meta.qualityMode} · DPR ${meta.dpr}`,
        `设置 ${JSON.stringify(meta.settings)}`,
        '场景\tFPS\t平均帧\tP95帧\t绘制',
        ...results.map((r) => `${r.name}\t${r.fps.toFixed(1)}\t${r.avgFrameMs.toFixed(1)}ms\t${r.p95FrameMs.toFixed(1)}ms\t${r.drawMs.toFixed(2)}ms`),
      ];
      const text = lines.join('\n');
      copyArea.value = text;
      const isMobileCopy = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      let ok = false;
      if (!isMobileCopy) {
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            ok = true;
          } else {
            copyArea.style.display = '';
            copyArea.select();
            ok = document.execCommand('copy');
          }
        } catch (err) {
          ok = false;
        }
      }
      if (!ok) {
        copyArea.style.display = '';
        copyArea.focus();
        copyArea.select();
        try {
          copyArea.setSelectionRange(0, text.length);
        } catch (e) {
          // 部分移动浏览器不支持 setSelectionRange，忽略
        }
        copyResultBtn.textContent = '已展开文本，长按复制';
        return;
      }
      copyResultBtn.textContent = '已复制';
      setTimeout(() => {
        copyResultBtn.textContent = '复制结果';
      }, 1500);
    });
    actions.appendChild(copyResultBtn);
    actions.appendChild(el('button', {
      class: 'btn btn-secondary',
      type: 'button',
      onClick: () => {
        const blob = new Blob([JSON.stringify({ meta, results }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `survivor-bench-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      },
    }, '下载结果 JSON'));
    actions.appendChild(el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => startBenchmark() }, '重新测试'));
    actions.appendChild(el('button', { class: 'btn btn-primary', type: 'button', onClick: () => closeBenchmarkPanel() }, '关闭'));
    panel.appendChild(actions);
    panel.appendChild(copyArea);
    showOverlay(panel);
  }

  function closeBenchmarkPanel() {
    benchView = false;
    hideOverlay();
    if (state.mode === 'playing') {
      state.paused = false;
      state.last = performance.now();
    } else {
      showStart();
    }
  }

  function abortBenchmark() {
    if (!bench) return;
    cancelAnimationFrame(bench.raf);
    if (bench.wrapEl && bench.wrapEl.parentElement) bench.wrapEl.remove();
    bench = null;
    benchView = false;
    hideOverlay();
    if (state.mode === 'playing') {
      state.paused = false;
      state.last = performance.now();
    } else {
      showStart();
    }
  }

  function adaptQuality(now) {
    if (state.mode !== 'playing' || state.paused) return;
    if (state.qualityMode === 'sharp') return;
    const q = renderer.getQuality();
    const minQ = qualityFloor();
    const lowFps = state.qualityMode === 'smooth' ? 50 : 45;
    const targetFps = state.qualityMode === 'smooth' ? 60 : 55;
    if (state.fps > 0 && state.fps < lowFps && q > minQ + 0.01 && now >= qualityDownCooldown) {
      // 填充开销与像素量成正比（∝ 倍率²），按当前帧率一次性估到目标附近
      const target = Math.sqrt(state.fps / targetFps);
      renderer.setQuality(Math.max(minQ, Math.min(q - 0.03, q * target)));
      qualityCeiling = Math.max(minQ, Math.min(qualityCeiling, q - 0.03));
      // 降档后短时间内不再升档，避免「升一点又掉帧」来回抖
      qualityDownCooldown = now + 800;
      qualityUpCooldown = now + 8000;
      qualityUpStreak = 0;
      return;
    }
    if (state.qualityMode === 'auto' && state.fps >= 57 && q < 0.995) {
      qualityUpStreak += 1;
      if (qualityUpStreak >= 4 && now >= qualityUpCooldown && q + 0.05 <= qualityCeiling + 0.001) {
        renderer.setQuality(q + 0.05);
        qualityUpStreak = 0;
        // 升档后若掉帧，下一次统计窗口就能立刻降回来（不被冷却挡住）
        qualityUpCooldown = now + 8000;
        qualityDownCooldown = now + 1000;
      }
    } else {
      qualityUpStreak = 0;
    }
  }

  // ---- 主循环 ----
  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (document.hidden) {
      state.last = now;
      return;
    }
    // 基准测试期间由独立循环驱动，主循环完全停摆，避免两套渲染互相干扰
    if (bench) {
      state.last = now;
      return;
    }
    const rawDt = Math.max(0, (now - state.last) / 1000);
    const cap = state.settings.fpsCap;
    // 帧率上限：不足一帧间隔就先跳过，时间累积到下一帧（不更新 last）
    if (cap > 0 && rawDt * 1000 < 1000 / cap - 2) return;
    const dt = Math.min(0.04, rawDt);
    state.last = now;

    // FPS / 耗时统计（调试面板每 0.5 秒刷新一次）
    state.fpsFrames += 1;
    state.fpsTime += rawDt;
    if (state.fpsTime >= 0.5) {
      state.fps = state.fpsFrames / state.fpsTime;
      const frames = Math.max(1, state.perfFrames);
      state.perfUpd = state.perfUpdSum / frames;
      state.perfRen = state.perfRenSum / frames;
      state.perfPeak = state.perfPeakMax;
      state.fpsFrames = 0;
      state.fpsTime = 0;
      state.perfUpdSum = 0;
      state.perfRenSum = 0;
      state.perfFrames = 0;
      state.perfPeakMax = 0;
      adaptQuality(now);
      recordSample();
      updateDebug();
    }
    let updMs = 0;
    if (state.mode === 'playing' && !state.paused) {
      const t0 = performance.now();
      update(dt);
      updateHud();
      updMs = performance.now() - t0;
    }
    const t1 = performance.now();
    // 暂停（升级选卡 / 暂停菜单）时画面完全静止，跳过绘制，省掉整块画布的每帧光栅化
    if (!state.paused) renderer.render();
    const renMs = performance.now() - t1;
    state.perfUpdSum += updMs;
    state.perfRenSum += renMs;
    state.perfFrames += 1;
    const frameMs = updMs + renMs;
    if (frameMs > state.perfPeakMax) state.perfPeakMax = frameMs;
  }

  // ---- 事件绑定 ----
  function saveIfPlaying() {
    if (state.mode === 'playing') {
      saveRun(state);
      scheduleUpload();
    }
  }
  function onVisibilityChange() {
    if (document.hidden) saveIfPlaying();
  }
  window.addEventListener('pagehide', saveIfPlaying);
  document.addEventListener('visibilitychange', onVisibilityChange);
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('keyup', onKeyup);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  updateHud();
  showLoading();
  state.raf = requestAnimationFrame(loop);
  refreshCatalog().then(() => {
    updateHud();
    showStart();
  }).catch(showCatalogError);

  // 登录账号：拉取服务端存档（游客直接跳过）；服务端较新时覆盖本地并刷新面板
  syncOnEnter().then((applied) => {
    if (!applied) return;
    state.best = loadBest();
    updateHud();
    if (state.mode === 'idle' && !catalogOpen) showStart();
  });

  let disposed = false;
  function cleanupSurvivors() {
    if (disposed) return;
    disposed = true;
    // 离开视图时保留战局，回来可继续
    if (state.mode === 'playing') {
      saveRun(state);
      scheduleUpload();
    }
    cancelScheduledUpload();
    flushUpload();
    offRoute();
    fsCtrl.destroy();
    cancelAnimationFrame(state.raf);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('keyup', onKeyup);
    window.removeEventListener('resize', renderer.resizeCanvas);
    window.removeEventListener('pagehide', saveIfPlaying);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (state.recording) stopRecording();
    if (bench) {
      cancelAnimationFrame(bench.raf);
      if (bench.wrapEl && bench.wrapEl.parentElement) bench.wrapEl.remove();
      bench = null;
    }
    benchView = false;
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    stopGameActivity();
    setShortcutsSuppressed(false);
    // 仅当容器仍由本视图占用时清空，避免抹掉路由刚渲染的新页面
    if (wrap.isConnected && container.contains(wrap)) container.replaceChildren();
    if (activeCleanup === cleanupSurvivors) activeCleanup = null;
  }

  // 路由离开时兜底销毁（router 不会调用视图返回的 cleanup）
  const offRoute = eventBus.on('route:change', (id) => {
    if (id !== 'survivors') cleanupSurvivors();
  });
  activeCleanup = cleanupSurvivors;
  return cleanupSurvivors;
}
