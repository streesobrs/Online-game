/**
 * 无尽模式（开发方案 5.1 ~ 5.4）与无尽三色模式（5.5）
 *
 * 两种玩法共用同一套渲染流程，差异集中在 VARIANTS 表里：
 * - 标准无尽：难度按累计分数提升元素种类（ENDLESS_TIERS），得分按颜色数缩放
 * - 三色爽局：固定 3 色、不升档、不缩放得分，成绩独立存档
 *
 * 共同点：棋盘固定 8×8 标准矩形（所有玩家面对同一棋盘，分数才可比）、
 * 无步数 / 时间限制、玩家自由结算、局内状态落 localStorage 刷新后可续玩。
 *
 * 服务端只做存档 / 经验 / 榜单，最高分按「服务端为准 + 本地 max 合并」同步。
 */
import { ENDLESS, ENDLESS3, ENDLESS_TIERS, STORAGE_KEYS, colorScoreMultiplier } from './config.js';
import { createMatch3Board } from './board.js';
import { showScoreDetails } from './scoreDetails.js';
import { onProgress, reportEnd, reportStart, requestProgress } from './sync.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

/**
 * 两种无尽玩法的差异点，渲染流程完全共用
 * @type {Record<string, object>}
 */
const VARIANTS = {
  [ENDLESS.type]: {
    config: ENDLESS,
    title: '♾ 无尽模式',
    sub: '标准 8×8 棋盘，无步数限制；分数越高元素种类越多',
    bestKey: STORAGE_KEYS.best,
    sessionKey: STORAGE_KEYS.session,
    tiered: true,        // 按分数升档颜色数
    colorScaling: true,  // 按当前颜色数缩放得分
  },
  [ENDLESS3.type]: {
    config: ENDLESS3,
    title: '🧨 无尽三色',
    sub: '固定 3 色，连锁根本停不下来；成绩单独记录',
    bestKey: STORAGE_KEYS.bestEndless3,
    sessionKey: STORAGE_KEYS.sessionEndless3,
    tiered: false,
    colorScaling: false, // 固定 3 色不做缩放，保留最原始的分数爽感
  },
};

/** 取玩法配置，未知 key 回退到标准无尽 */
function variantOf(key) {
  return VARIANTS[key] || VARIANTS[ENDLESS.type];
}

/** 按累计分数取当前难度档的元素种类（数据表驱动，不是 if-else 链） */
export function tierColors(score) {
  let colors = ENDLESS_TIERS[0].colors;
  for (const tier of ENDLESS_TIERS) {
    if (score >= tier.minScore) colors = tier.colors;
  }
  return colors;
}

/** 毫秒 → mm:ss */
export function formatDuration(ms) {
  const total = Math.floor(ms / 1000);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // 存档损坏或不可用：当作没有存档
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 容量满：续存失败不影响本局
  }
}

/**
 * 某玩法下的最高记录 { highScore, bestCombo }
 * @param {string} [variant] 玩法 key（ENDLESS.type / ENDLESS3.type）
 */
export function loadBest(variant = ENDLESS.type) {
  const best = readStore(variantOf(variant).bestKey);
  return { highScore: best?.highScore || 0, bestCombo: best?.bestCombo || 0 };
}

/**
 * 某玩法下未结算的局内会话（刷新后续玩）
 * @param {string} [variant] 玩法 key
 */
export function loadSession(variant = ENDLESS.type) {
  const spec = variantOf(variant);
  const session = readStore(spec.sessionKey);
  return session && session.mode === spec.config.type ? session : null;
}

/** 清掉某玩法的局内会话 */
export function clearSession(variant = ENDLESS.type) {
  writeStore(variantOf(variant).sessionKey, null);
}

/**
 * 渲染无尽玩法对局
 * @param {HTMLElement} container - 内容容器
 * @param {{onExit:Function, variant?:string}} options - onExit 返回模式选择；variant 选玩法
 * @returns {Function} cleanup 函数
 */
export function renderEndless(container, { onExit, variant = ENDLESS.type }) {
  const spec = variantOf(variant);
  let board = null;
  let timerId = null;
  let finished = false;

  function teardown() {
    if (board) {
      board.destroy();
      board = null;
    }
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function mountRun() {
    teardown();
    finished = false;
    reportStart({ mode: spec.config.type });

    const session = loadSession(spec.config.type);
    const saved = session?.board || {};
    const seed = Number.isFinite(saved.seed) ? saved.seed : Date.now() % 2147483647;
    const elapsedBefore = session?.elapsedMs || 0;
    const startedAt = Date.now();
    const elapsed = () => elapsedBefore + (Date.now() - startedAt);

    /** 某个分数下应该用多少种颜色 */
    const colorsAt = (score) => (spec.tiered ? tierColors(score) : spec.config.colors);

    const scoreEl = el('span', { class: 'm3-hud-value' }, String(session?.score || 0));
    const comboEl = el('span', { class: 'm3-hud-value' }, String(session?.maxCombo || 0));
    const clearedEl = el('span', { class: 'm3-hud-value' }, String(session?.cleared || 0));
    const timeEl = el('span', { class: 'm3-hud-value' }, formatDuration(elapsedBefore));
    const host = el('div', { class: 'm3-board-host' });

    // 难度档位只有标准无尽有；三色爽局固定 3 色，不显示该项
    const startColors = colorsAt(session?.score || 0);
    const colorEl = spec.tiered
      ? el(
        'span',
        { class: 'm3-hud-value' },
        `${startColors} 色 ×${colorScoreMultiplier(startColors)}`,
      )
      : null;

    const hud = el(
      'div',
      { class: 'm3-hud' },
      el('span', { class: 'm3-hud-item' }, '分数', scoreEl),
      el('span', { class: 'm3-hud-item' }, '最高连锁', comboEl),
      el('span', { class: 'm3-hud-item' }, '消除', clearedEl),
      colorEl ? el('span', { class: 'm3-hud-item' }, '难度', colorEl) : null,
      el('span', { class: 'm3-hud-item' }, '用时', timeEl),
    );

    const actions = el(
      'div',
      { class: 'm3-actions' },
      el('button', { class: 'm3-btn', onClick: () => finish() }, '结束并结算'),
      el(
        'button',
        { class: 'm3-btn m3-btn--ghost', onClick: () => showScoreDetails(board.getState()) },
        '积分详情',
      ),
      el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
    );

    container.replaceChildren(
      el(
        'div',
        { class: 'm3-head' },
        el('h2', { class: 'm3-title' }, spec.title),
        el('p', { class: 'm3-sub' }, spec.sub),
      ),
      hud,
      host,
      actions,
    );

    /** 局内续存：每次状态变化覆盖写，刷新后从同一局面继续 */
    function persist() {
      const snap = board.getSnapshot();
      writeStore(spec.sessionKey, {
        mode: spec.config.type,
        board: snap,
        score: snap.score,
        moves: snap.moves,
        cleared: snap.cleared,
        maxCombo: snap.maxCascade,
        colors: snap.colors,
        elapsedMs: elapsed(),
        level: null,
        ts: Date.now(),
      });
    }

    function finish() {
      if (finished || !board) return;
      finished = true;
      const info = board.getState();
      const durationMs = elapsed();
      board.lock(); // 棋盘留在原位，只锁输入，结算浮层盖在其上
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
      clearSession(spec.config.type);

      reportEnd({
        mode: spec.config.type,
        score: info.score,
        maxCombo: info.maxCascade,
        moves: info.moves,
        durationMs,
        cleared: info.cleared,
        stars: 0,
      });

      const before = loadBest(spec.config.type);
      writeStore(spec.bestKey, {
        highScore: Math.max(before.highScore, info.score),
        bestCombo: Math.max(before.bestCombo, info.maxCascade),
      });
      if (info.score > before.highScore) toast.success('新的最高分！');

      host.appendChild(
        el(
          'div',
          { class: 'm3-result' },
          el('div', { class: 'm3-result-title' }, '本局结算'),
          el('div', { class: 'm3-result-line' }, `分数 ${info.score} · 最高连锁 ${info.maxCascade}`),
          el(
            'div',
            { class: 'm3-result-line' },
            `消除 ${info.cleared} 个 · 用时 ${formatDuration(durationMs)}`,
          ),
          el('div', { class: 'm3-result-line' }, `历史最高 ${Math.max(before.highScore, info.score)}`),
          el(
            'div',
            { class: 'm3-actions' },
            el('button', { class: 'm3-btn', onClick: () => mountRun() }, '再来一局'),
            el(
              'button',
              { class: 'm3-btn m3-btn--ghost', onClick: () => showScoreDetails(info) },
              '积分详情',
            ),
            el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit() }, '返回选择'),
          ),
        ),
      );
    }

    board = createMatch3Board(host, {
      payload: {
        rows: spec.config.rows,
        cols: spec.config.cols,
        mask: null,
        colors: colorsAt(session?.score || 0),
        colorScaling: spec.colorScaling,
      },
      seed,
      snapshot: session?.board || null,
      onUpdate(info) {
        scoreEl.textContent = String(info.score);
        comboEl.textContent = String(info.maxCascade);
        clearedEl.textContent = String(info.cleared);
        if (spec.tiered) {
          // 难度升档：只影响后续补充的方块，已有棋盘不动
          const next = tierColors(info.score);
          if (next !== info.colors) {
            board.setColors(next);
            toast.info(`难度提升：${next} 色`);
          }
          colorEl.textContent = `${next} 色 ×${colorScoreMultiplier(next)}`;
        }
        persist();
      },
    });

    timerId = setInterval(() => {
      timeEl.textContent = formatDuration(elapsed());
    }, 1000);
  }

  mountRun();

  // 拉取服务端最高分并合并进本地（结算时读到的历史最高才是准的）
  const offProgress = onProgress();
  requestProgress();

  return () => {
    offProgress();
    teardown();
  };
}

/** 无尽三色模式（固定 3 色爽局） */
export function renderEndless3(container, options) {
  return renderEndless(container, { ...options, variant: ENDLESS3.type });
}
