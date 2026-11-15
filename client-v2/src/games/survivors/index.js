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
import { loadBest, saveBest, formatTime, rand } from './helpers.js';
import { createRenderer } from './renderer.js';
import { loadCatalog, createCatalog } from './catalog.js';
import { saveRun, loadRun, clearRun } from './save.js';
import { applyTalents, getMeta, grantRunPoints } from './meta.js';

let activeCleanup = null;

const W = 960;
const H = 600;
const BOSS_INTERVAL = 90; // 秒
const WAVE_INTERVAL = 30; // 秒，每波持续 30 秒

function formatDps(v) {
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

const DEBUG_KEY = 'survivorsDebug';

function loadDebugPref() {
  try {
    return localStorage.getItem(DEBUG_KEY) === '1';
  } catch (e) {
    return false;
  }
}

const PLAYER_BASE = {
  x: W / 2,
  y: H / 2,
  r: 15,
  hp: 100,
  maxHp: 100,
  speed: 235,
  damage: 16,
  attackInterval: 0.5,
  projectiles: 1,
  projectileSpeed: 560,
  pierce: 0,
  pickup: 90,
  regen: 0,
  lifesteal: 0,
  splashRadius: 0,
  splashRatio: 0,
  novaLevel: 0,
  explodeLevel: 0,
  xpGain: 1,
  damageReduction: 0,
  shield: 0,
  shieldMax: 0,
  shieldRegen: 0,
  shieldCd: 0,
  thornsLevel: 0,
  fragmentLevel: 0,
  comboLevel: 0,
  fireLevel: 0,
  thunderLevel: 0,
  iceLevel: 0,
  waterLevel: 0,
  face: -Math.PI / 2,
};

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
    player: { ...PLAYER_BASE },
    enemies: [],
    projectiles: [],
    enemyShots: [],
    gems: [],
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
    fps: 0,
    fpsFrames: 0,
    fpsTime: 0,
    spawnTimer: 1.2,
    bossTimer: BOSS_INTERVAL,
    bossCount: 0,
    wave: 1,
    waveBanner: 0,
    hurtCd: 0,
    novaTimer: 2.5,
    novas: [],
    explosions: [],
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
  const ctx = canvas.getContext('2d');
  const renderer = createRenderer({ canvas, ctx, state, W, H });

  const hpFill = el('div', { class: 'sv-bar-fill sv-hp-fill' });
  const hpText = el('span', { class: 'sv-bar-text' }, '100 / 100');
  const xpFill = el('div', { class: 'sv-bar-fill sv-xp-fill' });
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

  const hud = el('div', { class: 'sv-hud' }, [
    el('div', { class: 'sv-hud-bars' }, [
      el('div', { class: 'sv-bar sv-bar-hp' }, [hpFill, hpText]),
      el('div', { class: 'sv-bar sv-bar-xp' }, [xpFill]),
    ]),
    el('div', { class: 'sv-hud-mid' }, [timeEl, waveEl]),
    el('div', { class: 'sv-hud-right' }, [lvEl, killEl, dpsEl, shieldEl, debugBtn, catalogBtn, settleBtn]),
  ]);

  const debugEl = el('pre', { class: `sv-debug${state.debug ? ' show' : ''}` }, '');

  const overlay = el('div', { class: 'sv-overlay' });
  const stage = el('div', { class: 'sv-stage' }, [canvas, hud, debugEl, overlay]);

  const backBtn = el('button', { class: 'sv-back-btn', type: 'button' }, '← 返回大厅');
  backBtn.addEventListener('click', () => go('games'));

  const wrap = el('section', { class: 'sv-view' }, [
    el('div', { class: 'sv-head' }, [
      backBtn,
      el('span', { class: 'sv-title' }, '⚔️ 刷怪肉鸽'),
      el('span', { class: 'sv-beta' }, '测试版 DEMO'),
    ]),
    stage,
    el('p', { class: 'sv-foot' }, 'WASD / 方向键移动，或按住画面拖拽移动 · 武器自动攻击 · Esc 暂停'),
  ]);

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
  function updateDebug() {
    if (!state.debug) return;
    const p = state.player;
    const stacks = Object.values(state.upgradeStacks).reduce((sum, v) => sum + v, 0);
    debugEl.textContent = [
      `FPS ${state.fps.toFixed(0)}  ${state.fps > 0 ? (1000 / state.fps).toFixed(1) : '0.0'}ms`,
      `怪 ${state.enemies.length}  弹 ${state.projectiles.length}  敌弹 ${state.enemyShots.length}`,
      `经验 ${state.gems.length}  粒子 ${state.particles.length}  特效 ${state.novas.length + state.explosions.length}`,
      `DPS ${formatDps(state.dps)}  波 ${state.wave}  Boss ${state.bossCount}`,
      `强化 ${stacks} 层  坐标 ${Math.round(p.x)},${Math.round(p.y)}`,
    ].join('\n');
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
    state.player = { ...PLAYER_BASE, ...run.player };
    state.enemies = run.enemies;
    state.projectiles = run.projectiles;
    state.enemyShots = run.enemyShots;
    state.gems = run.gems;
    state.particles = [];
    state.novas = [];
    state.explosions = [];
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
    showOverlay(el('div', { class: 'sv-panel sv-panel-start' }, [
      el('div', { class: 'sv-panel-icon' }, '⚔️'),
      el('h2', { class: 'sv-panel-title' }, '刷怪肉鸽'),
      el('p', { class: 'sv-panel-sub' }, '幸存者 like · 测试版 Demo'),
      el('p', { class: 'sv-panel-desc' }, '武器自动索敌攻击。WASD / 方向键移动，手机或鼠标按住画面拖拽也能移动。'),
      el('p', { class: 'sv-panel-desc' }, '击杀怪物拾取经验，升级时三选一强化；每 90 秒出现一个 Boss。后期会出现冲锋、远程、自爆和分裂怪。'),
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
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openCatalog('elements') }, `⚛️ 元素图鉴 (${BUFFS.filter((b) => b.element).length})`),
        el('button', { class: 'btn btn-secondary', type: 'button', onClick: () => openCatalog('monsters') }, `👾 怪物图鉴 (${MONSTERS.length})`),
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
        el('span', { class: 'sv-upgrade-desc' }, u.desc),
        el('span', { class: 'sv-upgrade-effect' }, cur > 0
          ? `${curText} → ${nextText}`
          : `选后：${nextText}`),
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
    const spread = n > 1 ? Math.min(0.5, 0.2 * (n - 1)) : 0;
    const volley = { base, damageScale, shots: [] };
    for (let i = 0; i < n; i += 1) {
      const angle = n === 1 ? base : base - spread + (spread * 2 * i) / (n - 1);
      volley.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed,
        damage: p.damage * damageScale,
        r: 4.5,
        pierce: p.pierce,
        life: 1.5,
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
    // 减伤 → 护盾吸收 → 扣血
    let final = Math.max(1, capped * (1 - (p.damageReduction || 0)));
    let absorbed = 0;
    if (p.shield > 0) {
      absorbed = Math.min(p.shield, final);
      p.shield -= absorbed;
      final -= absorbed;
      p.shieldCd = 2; // 受击后 2 秒不再回复护盾
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
    state.dmgAccum += Math.min(damage, enemy.hp);
    enemy.hp -= damage;
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
    addNova(x, y, innerR, maxR) {
      state.novas.push({ x, y, r: innerR, maxR, life: 0.5, maxLife: 0.5 });
    },
    damageInRadius(x, y, radius, damage) {
      for (const e of state.enemies) {
        if (e.dead) continue;
        const rr = radius + e.r;
        if ((e.x - x) ** 2 + (e.y - y) ** 2 <= rr * rr) damageEnemy(e, damage);
      }
    },
    explodeAt,
    fireVolley(damageScale = 1) {
      return fireVolley(damageScale);
    },
    // 手动画一枚玩家弹丸（分裂碎片等）
    spawnPlayerShot(spec) {
      spawnProjectile(spec);
    },
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
      const dx = p.x - e.x;
      const dy = p.y - e.y;
      const dist = Math.hypot(dx, dy) || 1;
      const monster = MONSTER_MAP.get(e.type);
      if (monster && typeof monster.update === 'function') {
        monster.update(e, dx, dy, dist, dt, monsterApi);
      } else {
        moveEnemy(e, dx, dy, dist, dt, 1);
      }

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
          // 元素弹会给怪物挂上对应元素，供后续元素反应使用
          if (pr.element && pr.element !== 'physical') {
            e.element = pr.element;
            e.elementTimer = 3;
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

    // 经验宝石：进入拾取范围后飞向玩家
    for (const g of state.gems) {
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < p.pickup) {
        const step = 420 * dt;
        if (dist <= step) {
          g.dead = true;
          gainXp(g.value);
        } else {
          g.x += (dx / dist) * step;
          g.y += (dy / dist) * step;
        }
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

    // 冲击波 / 爆炸特效
    for (const n of state.novas) n.life -= dt;
    for (const ex of state.explosions) ex.life -= dt;

    state.enemies = state.enemies.filter((e) => !e.dead);
    state.projectiles = state.projectiles.filter((pr) => !pr.dead);
    state.enemyShots = state.enemyShots.filter((s) => !s.dead);
    state.gems = state.gems.filter((g) => !g.dead);
    state.particles = state.particles.filter((pt) => pt.life > 0);
    state.novas = state.novas.filter((n) => n.life > 0);
    state.explosions = state.explosions.filter((ex) => ex.life > 0);
  }

  // ---- 开局 / 结算 ----
  function startGame() {
    if (!BUFFS.length || !MONSTERS.length) return; // 图鉴数据未就绪时不开局
    clearRun();
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
    state.enemies = [];
    state.projectiles = [];
    state.enemyShots = [];
    state.gems = [];
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
    state.drag = { x: dx / dist, y: dy / dist };
  }
  function onPointerUp() {
    dragStart = null;
    state.drag = { x: 0, y: 0 };
  }

  // ---- 主循环 ----
  function loop(now) {
    state.raf = requestAnimationFrame(loop);
    if (document.hidden) {
      state.last = now;
      return;
    }
    const rawDt = Math.max(0, (now - state.last) / 1000);
    const dt = Math.min(0.04, rawDt);
    state.last = now;

    // FPS 统计（调试面板每 0.5 秒刷新一次）
    state.fpsFrames += 1;
    state.fpsTime += rawDt;
    if (state.fpsTime >= 0.5) {
      state.fps = state.fpsFrames / state.fpsTime;
      state.fpsFrames = 0;
      state.fpsTime = 0;
      updateDebug();
    }
    if (state.mode === 'playing' && !state.paused) {
      update(dt);
      updateHud();
    }
    renderer.render();
  }

  // ---- 事件绑定 ----
  function saveIfPlaying() {
    if (state.mode === 'playing') saveRun(state);
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

  let disposed = false;
  function cleanupSurvivors() {
    if (disposed) return;
    disposed = true;
    // 离开视图时保留战局，回来可继续
    if (state.mode === 'playing') saveRun(state);
    offRoute();
    cancelAnimationFrame(state.raf);
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('keyup', onKeyup);
    window.removeEventListener('resize', renderer.resizeCanvas);
    window.removeEventListener('pagehide', saveIfPlaying);
    document.removeEventListener('visibilitychange', onVisibilityChange);
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
