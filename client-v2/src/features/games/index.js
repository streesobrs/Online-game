/**
 * 统一游戏大厅（整合五子棋/围棋/象棋/贪吃蛇/AI对战/联机匹配）
 * 原分散的 6 个导航入口合并为单一入口。
 *
 * 布局：
 * ┌─────────────────────────────────────────────────────┐
 * │ 游戏大厅                                            │
 * ├─────────────────────────────────────────────────────┤
 * │ 🔴五子棋  ⚪围棋  🟥象棋  🐍贪吃蛇  🍬消消乐  🚆3D  │
 * ├─────────────────────────────────────────────────────┤
 * │ 选中游戏详情（图标/简介/标签）                      │
 * │ [🌐联机匹配] [🤖AI对战] [🕹单机游戏]  ← 玩法平铺    │
 * └─────────────────────────────────────────────────────┘
 *
 * 全部游戏与玩法均平铺展示，不做模式切换。快捷键 1-6 选择游戏，
 * T 联机 / A AI，Enter 开始（键位可在设置页自定义，
 * 见 core/shortcuts.js；本视图通过 registerScopeHandler 注册作用域处理函数）
 */
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { emit } from '../../core/socket.js';
import { api } from '../../core/api.js';
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import { GAMES } from '../../data/navItems.js';
import { go } from '../../core/router.js';
import { startGameActivity, stopGameActivity } from '../../core/activity.js';
import { setShortcutsSuppressed } from '../../utils/shortcut.js';
import { startGameTour, startSnakeTour } from '../../components/onboarding.js';
import { registerScopeHandler, getBinding, formatCombo } from '../../core/shortcuts.js';

const GAME_MAP = Object.fromEntries(GAMES.map((g) => [g.id, g]));

// 单机游戏：独立页面入口（不做联机/AI 匹配）
const SOLO_GAMES = [
  { id: 'match3', name: '消消乐', icon: '🍬' },
  { id: 'train3d', name: '3D驾驶', icon: '🚆' },
];

/** 模式展示文案 */
const MODE_LABEL = { online: '联机', ai: 'AI', solo: '单机' };

/** 每种游戏支持的玩法模式 */
const MODES_BY_GAME = {
  gobang: ['online', 'ai'],
  go: ['online', 'ai'],
  'chinese-chess': ['online', 'ai'],
  snake: ['online', 'solo'],
  match3: ['solo'],
  train3d: ['solo'],
};

/** 全部游戏平铺展示（棋类在前，单机在后） */
const ALL_GAMES = [...GAMES, ...SOLO_GAMES].map((g) => ({
  ...g,
  modes: MODES_BY_GAME[g.id] || ['online'],
}));


/** 游戏展示元数据：简介 / 主题色 / 标签，供卡片与详情面板使用 */
const GAME_UI = {
  gobang: {
    desc: '15×15 经典五子棋，横竖斜先连成五子者获胜',
    accent: '#e05a4f',
    tags: ['15×15 棋盘', '实时对局'],
  },
  go: {
    desc: '19×19 围棋，围地多者胜，考验全局布局',
    accent: '#5a6b8c',
    tags: ['19×19 棋盘', '实时对局'],
  },
  'chinese-chess': {
    desc: '中国象棋，将死对方主帅即可获胜',
    accent: '#c0392b',
    tags: ['10×9 棋盘', '实时对局'],
  },
  snake: {
    desc: '经典贪吃蛇，支持单机练习与多人同场对战，活得越久得分越高',
    accent: '#2f9e6e',
    tags: ['单机练习', '多人同场', '实时对战'],
  },
  match3: {
    desc: '三消闯关，连锁消除触发爽快连击',
    accent: '#d05a9a',
    tags: ['三消闯关', '肉鸽模式', '图鉴养成'],
  },
  train3d: {
    desc: '3D 火车模拟驾驶，手动/自动挡与昼夜切换',
    accent: '#2f7fd0',
    tags: ['3D 模拟', '手动/自动挡', '昼夜切换'],
  },
};


const DIFFICULTIES = [
  { id: 'easy', label: '🟢 简单', desc: 'AI 随机走子', color: '#48bb78' },
  { id: 'medium', label: '🟡 中等', desc: 'AI 基础策略', color: '#ed8936' },
  { id: 'hard', label: '🔴 困难', desc: 'AI 深度搜索', color: '#f56565' },
];

/** 每个游戏的专属玩法卡片：只列该游戏真正支持的入口，文案各自定制 */
const GAME_MODE_CARDS = {
  gobang: [
    {
      id: 'online', icon: '🌐', color: '#e05a4f', title: '联机匹配',
      desc: '与真人实时对弈 · 15×15 棋盘 · 横竖斜先连成五子获胜',
      button: '🎯 开始匹配',
    },
    {
      id: 'ai', icon: '🤖', color: '#805ad5', title: 'AI 对战',
      desc: '人机练习，可选三档棋力，适合熟悉开局与连珠套路',
      button: '🤖 开始 AI 对战',
    },
  ],
  go: [
    {
      id: 'online', icon: '🌐', color: '#5a6b8c', title: '联机匹配',
      desc: '与真人实时对弈 · 19×19 棋盘 · 围地多者获胜',
      button: '🎯 开始匹配',
    },
    {
      id: 'ai', icon: '🤖', color: '#805ad5', title: 'AI 对战',
      desc: '人机练习，三档棋力，从布局落子练到收官',
      button: '🤖 开始 AI 对战',
    },
  ],
  'chinese-chess': [
    {
      id: 'online', icon: '🌐', color: '#c0392b', title: '联机匹配',
      desc: '与真人实时对弈 · 10×9 棋盘 · 将死对方主帅获胜',
      button: '🎯 开始匹配',
    },
    {
      id: 'ai', icon: '🤖', color: '#805ad5', title: 'AI 对战',
      desc: '人机练习，三档棋力，熟悉布局与残局杀法',
      button: '🤖 开始 AI 对战',
    },
  ],
  snake: [
    {
      id: 'online', icon: '🌐', color: '#2f9e6e', title: '多人对战',
      desc: '多人同场竞技，比谁存活更久、得分更高',
      button: '🎯 开始匹配',
    },
    {
      id: 'solo', icon: '🕹', color: '#38a169', title: '单机练习',
      desc: '吃食物变长加速，撞墙或撞到自己结束，可用复活等道具',
      button: '🚀 进入游戏',
    },
  ],
  match3: [
    {
      id: 'solo', icon: '🍭', color: '#d05a9a', title: '开始一局',
      desc: '先选玩法，进入后直接从对应模式开局',
      button: '🚀 进入游戏',
    },
  ],
  train3d: [
    {
      id: 'solo', icon: '🚆', color: '#2f7fd0', title: '进入驾驶',
      desc: '选好驾驶方式，进入 3D 驾驶舱',
      button: '🚀 进入游戏',
    },
  ],
};

/** 纯单机游戏在面板里预选的子玩法（id 通过 games.initMode 传给对应页面） */
const SOLO_SUBMODES = {
  match3: [
    { id: 'level', label: '🍭 闯关', desc: '按关完成目标，收集三星', color: '#5aa9e6' },
    { id: 'endless', label: '♾ 无尽', desc: '不限目标，冲击最高分', color: '#7c5cff' },
    { id: 'endless3', label: '🧨 无尽三色', desc: '三色棋盘的高速爽局', color: '#f0883e' },
    { id: 'rogue', label: '🎲 肉鸽试炼', desc: '限步冲层，三选一祝福', color: '#d05a9a' },
  ],
  train3d: [
    { id: 'manual', label: '🎮 手动驾驶', desc: '自己控制牵引与制动', color: '#2f7fd0' },
    { id: 'auto', label: '🤖 自动驾驶', desc: '交给电脑规划停站', color: '#38a169' },
  ],
};

/** 各游戏在对局里可用到的道具（商城道具 id），大厅侧栏展示已拥有数量 */
const GAME_ITEM_IDS = {
  gobang: ['item_hint', 'item_undo'],
  go: ['item_hint', 'item_undo'],
  'chinese-chess': ['item_hint', 'item_undo'],
  snake: ['item_snake_revive', 'item_snake_speed', 'item_snake_double', 'item_snake_shrink'],
};

/** 当前登录账号 id（与商城 / 成就页一致） */
function currentAccountId() {
  return localStorage.getItem('currentAccountId') || '';
}

// ---- 成就数据缓存：大厅侧栏只需要「本游戏解锁几个」，全量拉一次复用 ----
let achievementCache = null;
let achievementAccountId = '';
let achievementLoading = false;
let achievementError = false;
let achievementBound = false;
const achievementSubs = new Set();

function notifyAchievementSubs() {
  achievementSubs.forEach((fn) => {
    try { fn(); } catch (err) { console.error(err); }
  });
}

function bindAchievementFeed() {
  if (achievementBound) return;
  achievementBound = true;
  eventBus.on('achievement:list', (data) => {
    if (!data || !data.categories) return;
    achievementCache = data;
    achievementLoading = false;
    achievementError = false;
    notifyAchievementSubs();
  });
  // 断线重连后旧数据可能过期：清掉缓存，侧栏下次绘制时重新拉
  eventBus.on('socket:connect', () => {
    achievementCache = null;
    achievementLoading = false;
    achievementError = false;
    notifyAchievementSubs();
  });
  // 自动登录完成：socket 会话可能刚绑定，补一次拉取（否则首次请求会被服务端静默丢弃）
  ['user:loginResult', 'user:accountInfo'].forEach((evt) => {
    eventBus.on(evt, () => {
      if (!achievementCache) {
        achievementLoading = false;
        achievementError = false;
        notifyAchievementSubs();
      }
    });
  });
}

/**
 * 拉取成就列表
 * 首次进入大厅时 socket 可能刚连上、client_connect 的会话绑定还没完成，
 * 服务端会直接丢弃 get_achievements，所以这里做几次短间隔重试。
 */
function requestAchievements(attempt = 0) {
  if (!achievementLoading) return;
  emit('get_achievements');
  if (attempt < 3) {
    setTimeout(() => requestAchievements(attempt + 1), 700 + attempt * 600);
    return;
  }
  setTimeout(() => {
    if (!achievementLoading) return;
    achievementLoading = false;
    achievementError = true;
    notifyAchievementSubs();
  }, 1200);
}

function ensureAchievements() {
  bindAchievementFeed();
  const accountId = currentAccountId();
  if (!accountId) return;
  if (achievementCache && achievementAccountId === accountId) return;
  if (achievementLoading || achievementError) return;
  achievementAccountId = accountId;
  achievementLoading = true;
  requestAchievements();
}

function onAchievementFeed(fn) {
  bindAchievementFeed();
  achievementSubs.add(fn);
  return () => achievementSubs.delete(fn);
}

/** 取某个游戏的成就列表，并标上解锁状态 */
function gameAchievements(data, gameId) {
  const unlockedIds = new Set(data.userAchievements || []);
  const list = [];
  Object.values(data.categories || {}).forEach((category) => {
    (category.achievements || []).forEach((ach) => {
      if (ach && ach.condition && ach.condition.gameType === gameId) {
        list.push({ ...ach, unlocked: unlockedIds.has(ach.id) });
      }
    });
  });
  return list;
}

// ---- 道具 / 背包缓存：商城配置 + 背包数量一起拉 ----
let itemCache = null; // { accountId, items, counts, undoCount, hintCount }
let itemLoading = false;
let itemError = false;
const itemSubs = new Set();

function notifyItemSubs() {
  itemSubs.forEach((fn) => {
    try { fn(); } catch (err) { console.error(err); }
  });
}

async function ensureItems() {
  const accountId = currentAccountId();
  if (!accountId) return;
  if (itemCache && itemCache.accountId === accountId) return;
  if (itemLoading || itemError) return;
  itemLoading = true;
  try {
    const [shopData, invRes] = await Promise.all([
      api.shop.getData(accountId),
      api.shop.getInventory(accountId),
    ]);
    const inventory = invRes?.inventory || {};
    itemCache = {
      accountId,
      items: shopData?.data?.items || {},
      counts: inventory.items || {},
      undoCount: inventory.undoCount || 0,
      hintCount: inventory.hintCount || 0,
    };
    itemError = false;
  } catch (err) {
    console.error('加载道具失败', err);
    itemCache = null;
    itemError = true;
  } finally {
    itemLoading = false;
    notifyItemSubs();
  }
}

function onItemFeed(fn) {
  itemSubs.add(fn);
  return () => itemSubs.delete(fn);
}

/** 肉鸽图鉴是否已向服务端请求过进度（同一大厅会话只拉一次） */
let codexSynced = false;

/** 缓存的 cleanup 函数（切换游戏/页面时清理旧对局） */
let currentCleanup = null;

/** 面板级订阅（成就 / 道具 / 图鉴），切换游戏或离开大厅时统一退订 */
let panelCleanups = [];

function registerPanelCleanup(fn) {
  if (typeof fn === 'function') panelCleanups.push(fn);
}

function runCleanup() {
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { console.error(e); }
  }
  currentCleanup = null;
  panelCleanups.forEach((fn) => {
    try { fn(); } catch (e) { console.error(e); }
  });
  panelCleanups = [];
  stopGameActivity(); // 退出对局：停止活跃续期心跳
}

/**
 * 渲染统一游戏大厅
 * @param {HTMLElement} container - #view-root
 * @returns {Function} cleanup
 */
export function renderGames(container) {
  runCleanup();

  // 每次进入大厅都重新拉成就 / 背包：上一局可能刚解锁成就，商城也可能刚买过道具
  achievementCache = null;
  achievementAccountId = '';
  achievementError = false;
  itemCache = null;
  itemError = false;
  codexSynced = false;

  // 状态
  const state = {
    selectedGame: GAMES[0].id,
    difficulty: 'easy',
    // 纯单机游戏在面板里预选的子玩法（消消乐 / 3D 驾驶）
    soloModes: { match3: 'level', train3d: 'manual' },
    isMatching: false,
    reconnectGame: store.get('reconnectGame') || null, // 战局内刷新后的对局快照
  };

  // socket 断开时点击「放弃对局」：标记待放弃，重连成功后自动重发
  let pendingDiscard = false;

  // 从 store 读取初始游戏（路由跳转带过来的）
  const initialGame = store.get('games.initGame');
  if (initialGame) { state.selectedGame = initialGame; store.set('games.initGame', null); }

  // ---- 子容器 ----
  const pickGrid = el('div', { class: 'games-grid' });
  const pickHint = el('div', { class: 'games-pick-hint' });
  const mainEl = el('section', { class: 'games-main' });

  const pageEl = el('div', { class: 'games-page' }, [
    el('header', { class: 'games-hero' }, [
      el('div', { class: 'games-hero-text' }, [
        el('h1', {}, '游戏大厅'),
        el('p', {}, '全部游戏一屏浏览，选择游戏后直接开局'),
      ]),
    ]),
    el('section', { class: 'games-pick' }, [
      el('div', { class: 'games-pick-head' }, [
        el('h2', {}, '选择游戏'),
        pickHint,
      ]),
      pickGrid,
    ]),
    mainEl,
  ]);

  container.innerHTML = '';
  container.append(pageEl);

  // ---- 渲染游戏卡片墙：全部游戏平铺 ----
  function renderPicker() {
    pickGrid.innerHTML = '';
    ALL_GAMES.forEach((g) => {
      const ui = GAME_UI[g.id] || { accent: '#4299e1', desc: '' };
      const badge = g.modes.map((m) => MODE_LABEL[m]).join(' · ');
      pickGrid.append(el('button', {
        type: 'button',
        class: 'games-card' + (state.selectedGame === g.id ? ' active' : ''),
        style: `--accent:${ui.accent || '#4299e1'}`,
        onClick: () => {
          if (state.isMatching) return;
          state.selectedGame = g.id;
          renderPicker();
          renderMain();
        },
      }, [
        el('span', { class: 'games-card-icon' }, g.icon),
        el('span', { class: 'games-card-text' }, [
          el('strong', {}, g.name),
          el('small', {}, ui.desc || ''),
        ]),
        el('span', { class: 'games-card-badge' }, badge),
      ]));
    });

    const pickKeys = ['games.pick1', 'games.pick2', 'games.pick3', 'games.pick4', 'games.pick5', 'games.pick6']
      .slice(0, ALL_GAMES.length)
      .map((id) => formatCombo(getBinding(id)))
      .join(' / ');
    pickHint.textContent = `${pickKeys} 选择 · ${formatCombo(getBinding('games.start'))} 开始 · ${formatCombo(getBinding('games.cancel'))} 取消`;
  }

  // ---- 渲染主区域 ----
  function renderMain() {
    runCleanup();
    mainEl.innerHTML = '';
    pageEl.classList.remove('is-playing');

    // 战局内刷新后的对局快照：优先展示恢复/放弃入口
    if (state.reconnectGame) {
      mainEl.append(renderReconnectPanel(state.reconnectGame));
      return;
    }

    if (state.isMatching) {
      mainEl.append(renderMatchingUI());
      return;
    }

    mainEl.append(renderGamePanel());
  }

  /** 详情面板左侧：选中游戏的主视觉 */
  function renderGameHero(g, ui, modeLabel) {
    const info = [
      el('div', { class: 'games-detail-mode' }, modeLabel),
      el('h2', { class: 'games-detail-name' }, g.name),
      el('p', { class: 'games-detail-desc' }, ui.desc || ''),
    ];
    if (ui.tags && ui.tags.length) {
      info.push(el('div', { class: 'games-tags' }, ui.tags.map((t) => el('span', {}, t))));
    }
    return el('div', { class: 'games-detail-hero', style: `--accent:${ui.accent || '#4299e1'}` }, [
      el('div', { class: 'games-detail-icon' }, g.icon),
      el('div', { class: 'games-detail-info' }, info),
    ]);
  }

  // ---- 详情面板：按游戏展示专属玩法卡片 ----
  function renderGamePanel() {
    const g = ALL_GAMES.find((x) => x.id === state.selectedGame) || ALL_GAMES[0];
    const ui = GAME_UI[g.id] || {};
    const fullLabel = { online: '联机匹配', ai: 'AI 对战', solo: '单机游戏' };
    const modeLabel = g.modes.map((m) => fullLabel[m]).join(' · ');
    const cards = GAME_MODE_CARDS[g.id] || g.modes.map((id) => ({
      id,
      icon: id === 'online' ? '🌐' : id === 'ai' ? '🤖' : '🕹',
      title: fullLabel[id],
      desc: '',
      button: '开始',
    }));

    const side = renderSidePanel(g);

    return el('div', {
      class: 'games-detail games-detail--flat' + (side ? '' : ' games-detail--noside'),
    }, [
      el('div', { class: 'games-detail-main' }, [
        renderGameHero(g, ui, modeLabel),
        el('div', { class: 'games-mode-section' }, [
          el('div', { class: 'games-aside-title' }, '选择玩法'),
          el('div', {
            class: cards.length === 1 ? 'games-mode-grid games-mode-grid--single' : 'games-mode-grid',
          }, cards.map((card) => renderModeCard(g, ui, card))),
        ]),
      ]),
      side,
    ]);
  }

  /**
   * 右侧信息栏：上「成就」，下「肉鸽图鉴 / 道具」
   * 3D 驾驶目前没有成就与道具，返回 null，主区域自动铺满
   */
  function renderSidePanel(g) {
    if (g.id === 'train3d') return null;
    const cards = [renderAchievementCard(g)];
    cards.push(g.id === 'match3' ? renderCodexCard() : renderItemCard(g));
    return el('aside', { class: 'games-side' }, cards);
  }

  /** 侧栏卡片外壳（标题 + 右上角入口链接） */
  function renderSideCard(g, title, linkText, onLink) {
    const accent = (GAME_UI[g.id] || {}).accent || '#4299e1';
    const body = el('div', { class: 'games-side-body' });
    const card = el('div', { class: 'games-side-card', style: `--accent:${accent}` }, [
      el('div', { class: 'games-side-head' }, [
        el('span', { class: 'games-side-title' }, title),
        el('button', { class: 'games-side-link', type: 'button', onClick: onLink }, linkText),
      ]),
      body,
    ]);
    return { card, body };
  }

  /** 成就：本游戏解锁进度 + 最近几条 */
  function renderAchievementCard(g) {
    const { card, body } = renderSideCard(g, '🏆 成就', '全部 →', () => {
      // 带上当前游戏，成就页首次渲染时直接落到该游戏的分类
      store.set('achievements.initGame', g.id);
      go('achievements');
    });

    function paint() {
      body.innerHTML = '';
      if (!currentAccountId()) {
        body.append(el('p', { class: 'games-side-empty' }, '登录后查看成就进度'));
        return;
      }
      const accountId = currentAccountId();
      if (!achievementCache || achievementAccountId !== accountId) {
        body.append(el('p', { class: 'games-side-empty' }, achievementError ? '成就暂时无法加载' : '成就加载中…'));
        ensureAchievements();
        return;
      }
      const list = gameAchievements(achievementCache, g.id);
      if (!list.length) {
        body.append(el('p', { class: 'games-side-empty' }, '暂无成就'));
        return;
      }
      const unlocked = list.filter((a) => a.unlocked).length;
      const pct = Math.round((unlocked / list.length) * 100);
      // 已解锁的排前面，方便一眼看到拿到的
      const preview = [...list]
        .sort((a, b) => Number(b.unlocked) - Number(a.unlocked))
        .slice(0, 2);
      body.append(
        el('div', { class: 'games-side-metric' }, [
          el('span', { class: 'games-side-strong' }, `${unlocked}/${list.length}`),
          el('span', { class: 'games-side-label' }, '成就已解锁'),
        ]),
        el('div', { class: 'games-side-bar' }, [
          el('div', { class: 'games-side-bar-fill', style: `width:${pct}%` }),
        ]),
        el('div', { class: 'games-side-list' }, preview.map((a) => el('div', { class: 'games-side-row' }, [
          el('span', { class: 'games-side-row-name' }, `${a.unlocked ? '✓' : '○'} ${a.name}`),
          el('span', { class: `games-side-tag${a.unlocked ? ' is-on' : ''}` }, a.unlocked ? '已解锁' : '未解锁'),
        ]))),
      );
    }

    registerPanelCleanup(onAchievementFeed(paint));
    paint();
    ensureAchievements();
    return card;
  }

  /** 道具：本游戏对局可用的商城道具 + 背包剩余数量 */
  function renderItemCard(g) {
    const { card, body } = renderSideCard(g, '🎒 道具', '商城 →', () => go('shop'));
    const ids = GAME_ITEM_IDS[g.id] || [];

    function paint() {
      body.innerHTML = '';
      if (!currentAccountId()) {
        body.append(el('p', { class: 'games-side-empty' }, '登录后查看道具'));
        return;
      }
      const accountId = currentAccountId();
      if (!itemCache || itemCache.accountId !== accountId) {
        body.append(el('p', { class: 'games-side-empty' }, itemError ? '道具暂时无法加载' : '道具加载中…'));
        ensureItems();
        return;
      }
      if (!ids.length) {
        body.append(el('p', { class: 'games-side-empty' }, '暂无专属道具'));
        return;
      }
      const list = ids.map((id) => {
        const meta = itemCache.items[id] || {};
        const cards = itemCache.counts[id] || 0;
        let countText;
        let total;
        if (id === 'item_undo') {
          // 悔棋：直存次数 + 悔棋卡 1 张 = 3 次
          total = itemCache.undoCount + cards * 3;
          countText = `可用 ${total} 次`;
        } else if (id === 'item_hint') {
          // 提示：直存次数 + 提示卡 1 张 = 5 次
          total = itemCache.hintCount + cards * 5;
          countText = `可用 ${total} 次`;
        } else {
          total = cards;
          countText = `×${cards}`;
        }
        return { id, name: meta.name || id, icon: meta.icon || '🎁', total, countText };
      });
      const note = g.id === 'snake'
        ? '对局中双击道具即可使用'
        : '对局中点「悔棋 / 提示」按钮使用';
      body.append(
        el('div', { class: 'games-item-list' }, list.map((it) => el('div', { class: 'games-item-row' }, [
          el('span', { class: 'games-item-icon' }, it.icon),
          el('span', { class: 'games-item-name' }, it.name),
          el('span', { class: `games-item-count${it.total > 0 ? '' : ' is-zero'}` }, it.countText),
        ]))),
        el('p', { class: 'games-side-note' }, note),
      );
    }

    registerPanelCleanup(onItemFeed(paint));
    paint();
    ensureItems();
    return card;
  }

  /** 肉鸽图鉴：收集度 + 可领取里程碑提示 */
  function renderCodexCard() {
    const { card, body } = renderSideCard(
      { id: 'match3' },
      '📖 肉鸽图鉴',
      '查看 →',
      () => go('codex'),
    );

    let disposed = false;
    let offMeta = null;

    registerPanelCleanup(() => {
      disposed = true;
      if (offMeta) offMeta();
    });

    body.append(el('p', { class: 'games-side-empty' }, '图鉴加载中…'));

    // 图鉴模块较重，选中消消乐时才按需加载
    Promise.all([
      import('../../games/match3/save/sync.js'),
      import('../../games/match3/rogue/meta.js'),
    ]).then(([sync, metaMod]) => {
      if (disposed) return;
      const paint = () => {
        body.innerHTML = '';
        const view = metaMod.collectionSummary(sync.getRogueMeta());
        const pct = Math.round(view.ratio * 100);
        body.append(
          el('div', { class: 'games-side-metric' }, [
            el('span', { class: 'games-side-strong' }, `${view.done}/${view.total}`),
            el('span', { class: 'games-side-label' }, '收集度'),
          ]),
          el('div', { class: 'games-side-bar' }, [
            el('div', { class: 'games-side-bar-fill', style: `width:${pct}%` }),
          ]),
          el('p', { class: 'games-side-note' }, `祝福 ${view.perksUnlocked}/${view.perksTotal} · 共鸣 ${view.buffsOn}/${view.buffsTotal}`),
          el('p', { class: 'games-side-note' }, `角色 ${view.charsOn}/${view.charsTotal} · 里程碑 ${view.milestonesClaimed}/${view.milestonesTotal}`),
        );
        if (view.claimable > 0) {
          body.append(el('p', { class: 'games-side-badge' }, `🎁 ${view.claimable} 个里程碑可领取`));
        }
      };
      offMeta = sync.onRogueMeta(paint);
      paint();
      if (!codexSynced) {
        codexSynced = true;
        sync.requestProgress(); // 拉一次服务端最新养成存档
      }
    }).catch((err) => {
      console.error('加载肉鸽图鉴失败', err);
      if (disposed) return;
      body.innerHTML = '';
      body.append(el('p', { class: 'games-side-empty' }, '图鉴暂时无法加载'));
    });

    return card;
  }

  /** 单张玩法卡片：图标 + 玩法名 + 专属说明 + 可选配置 + 开始按钮 */
  function renderModeCard(g, ui, card) {
    const children = [
      el('div', { class: 'games-block-head' }, [
        el('span', { class: 'games-block-icon' }, card.icon),
        el('span', { class: 'games-block-name' }, card.title),
      ]),
      el('p', { class: 'games-block-desc' }, card.desc || ''),
    ];

    if (card.id === 'ai') {
      const current = DIFFICULTIES.find((d) => d.id === state.difficulty) || DIFFICULTIES[0];
      children.push(renderSegmented(DIFFICULTIES, state.difficulty, (id) => {
        state.difficulty = id;
        renderMain();
      }, card.color || ui.accent));
      children.push(el('p', { class: 'games-segment-hint' }, current.desc));
    }
    if (card.id === 'solo' && SOLO_SUBMODES[g.id]) {
      const options = SOLO_SUBMODES[g.id];
      const current = options.find((m) => m.id === state.soloModes[g.id]) || options[0];
      children.push(renderSegmented(options, current.id, (id) => {
        state.soloModes[g.id] = id;
        renderMain();
      }, card.color || ui.accent));
      children.push(el('p', { class: 'games-segment-hint' }, current.desc));
    }

    const startBtn = el('button', { class: 'btn btn-primary games-block-btn' }, card.button || '开始');
    startBtn.addEventListener('click', () => {
      if (card.id === 'online') startMatch();
      else if (card.id === 'ai') startAIBattle();
      else enterSoloMode(g.id);
    });
    children.push(startBtn);

    return el('div', { class: 'games-mode-block' }, children);
  }

  /** 分段选择条（AI 难度 / 单机子玩法共用），选中项用游戏主题色 */
  function renderSegmented(options, selectedId, onPick, accent) {
    return el('div', {
      class: 'games-segmented',
      role: 'tablist',
      style: accent ? `--accent:${accent}` : null,
    }, options.map((o) =>
      el('button', {
        type: 'button',
        role: 'tab',
        class: 'games-segment' + (selectedId === o.id ? ' active' : ''),
        onClick: () => onPick(o.id),
      }, o.label)
    ));
  }

  /** 发起联机匹配（面板按钮与快捷键共用） */
  function startMatch() {
    if (state.isMatching) return;
    if (state.reconnectGame) { toast.warn('存在未完成的对局，请先继续或放弃'); return; }
    if (!store.get('socketConnected')) { toast.error('未连接服务器'); return; }
    if (!store.get('user')) { toast.error('请先登录'); return; }
    state.isMatching = true;
    renderMain();
    emit('match_request', { game: state.selectedGame });
  }

  // ---- 匹配中 UI ----
  function renderMatchingUI() {
    const g = GAME_MAP[state.selectedGame];
    const cancelBtn = el('button', { class: 'btn btn-secondary', style: 'min-width:220px;' }, '❌ 取消匹配');
    cancelBtn.addEventListener('click', () => {
      state.isMatching = false;
      renderMain();
      emit('cancel_match');
    });
    return el('div', { class: 'games-detail games-detail--center games-matching' }, [
      el('div', { class: 'games-matching-spinner' }, '🔍'),
      el('h2', { class: 'games-detail-name' }, `正在寻找 ${g.icon} ${g.name} 对手…`),
      el('div', { class: 'games-matching-dots' }, '匹配成功后自动进入对局，请稍候'),
      cancelBtn,
    ]);
  }

  // ---- 战局重连恢复 UI（战局内刷新后：继续对局 / 放弃对局）----
  function renderReconnectPanel(snapshot) {
    const gameName = snapshot.gameType === 'gobang' ? '五子棋'
      : snapshot.gameType === 'go' ? '围棋'
        : snapshot.gameType === 'chinese-chess' ? '象棋'
          : snapshot.gameType === 'snake' ? '贪吃蛇' : snapshot.gameType;
    const modeLabel = snapshot.mode === 'ai' ? 'AI 对战' : '联机对局';
    const opponentLabel = snapshot.mode === 'ai'
      ? `难度：${snapshot.difficulty || '未知'}`
      : (snapshot.player1Nickname && snapshot.player2Nickname
        ? `👤 ${snapshot.player1Nickname} vs ${snapshot.player2Nickname}`
        : '');

    const resumeBtn = el('button', { class: 'btn btn-primary btn-lg games-cta' }, '▶️ 继续对局');
    resumeBtn.addEventListener('click', () => resumeReconnectGame(snapshot));

    const discardBtn = el('button', { class: 'btn btn-secondary games-cta' }, '🚪 放弃对局');
    discardBtn.addEventListener('click', () => {
      if (!store.get('socketConnected')) {
        // socket 未连接时 discard 事件会被 socket 层丢弃，标记待放弃，重连后自动重发
        pendingDiscard = true;
        toast.error('未连接服务器，重连后将自动放弃对局');
        return;
      }
      emit('discard_current_game');
      toast.info('正在放弃对局…');
    });

    return el('div', { class: 'games-detail' }, [
      el('div', { class: 'games-detail-hero', style: '--accent:#ed8936' }, [
        el('div', { class: 'games-detail-icon' }, '♻️'),
        el('div', { class: 'games-detail-info' }, [
          el('div', { class: 'games-detail-mode' }, '未完成的对局'),
          el('h2', { class: 'games-detail-name' }, `${modeLabel} · ${gameName}`),
          el('p', { class: 'games-detail-desc' }, opponentLabel || '刷新前有对局尚未结束'),
        ]),
      ]),
      el('div', { class: 'games-detail-aside' }, [
        el('div', { class: 'games-aside-title' }, '请选择'),
        el('div', { class: 'games-aside-actions' }, [resumeBtn, discardBtn]),
      ]),
    ]);
  }

  // ---- 继续对局：将快照转为对局启动参数并恢复 ----
  async function resumeReconnectGame(snapshot) {
    const gameType = snapshot.gameType;
    if (gameType === 'snake') {
      toast.warn('贪吃蛇对局暂不支持中途恢复，请放弃对局');
      return;
    }

    // 清理重连快照（本次已消费）
    state.reconnectGame = null;
    store.set('reconnectGame', null);
    state.selectedGame = gameType;
    if (snapshot.difficulty) state.difficulty = snapshot.difficulty;
    renderPicker();

    if (snapshot.mode === 'ai') {
      await startAIBattle(snapshot);
      return;
    }

    // PvP：根据快照推导本人棋色与对手信息
    const myId = localStorage.getItem('currentAccountId');
    const isP1 = String(snapshot.player1) === String(myId);
    const pending = {
      game: gameType,
      gameId: snapshot.gameId,
      opponentId: isP1 ? snapshot.player2 : snapshot.player1,
      color: isP1 ? 1 : 2,
      opponentNickname: isP1 ? snapshot.player2Nickname : snapshot.player1Nickname,
      opponentName: isP1 ? snapshot.player2Nickname : snapshot.player1Nickname,
      snapshot: { board: snapshot.board, currentPlayer: snapshot.currentPlayer },
    };
    store.set('pendingMatch', pending);
    startOnlineGame();
  }

  // ---- 开始 AI 对战 ----
  async function startAIBattle(snapshot) {
    const gameType = state.selectedGame;
    const difficulty = state.difficulty;
    mainEl.innerHTML = '';

    try {
      const mod = await import(`../ai-battle/play.js`);
      const container = el('div', { class: 'games-play-area' });
      mainEl.append(container);
      pageEl.classList.add('is-playing');
      const cleanupFn = mod.startAIBattle(container, { gameType, difficulty, snapshot });
      setShortcutsSuppressed(true); // 对局中关闭全局快捷键
      const prevCleanup = currentCleanup;
      currentCleanup = () => {
        setShortcutsSuppressed(false);
        if (typeof cleanupFn === 'function') cleanupFn();
        if (typeof prevCleanup === 'function') prevCleanup();
      };
      startGameActivity(); // 进入对局：开始活跃续期
      // 首次进入对局：落子/悔棋/认输操作引导
      startGameTour();
    } catch (err) {
      console.error('[Games] AI 对战启动失败:', err);
      toast.error('AI 对战启动失败');
    }
  }

  // ---- 事件订阅 ----
  const offMatchSuccess = eventBus.on('lobby:matchSuccess', (data) => {
    if (data.game !== state.selectedGame) return;
    state.isMatching = false;
    // 已开始新对局，清除可能残留的重连快照
    state.reconnectGame = null;
    store.set('reconnectGame', null);
    store.set('pendingMatch', data);
    startOnlineGame();
  });

  const offMatchTimeout = eventBus.on('lobby:matchTimeout', () => {
    state.isMatching = false;
    toast.error('匹配超时，请重试');
    renderMain();
  });

  const offSnakeFound = eventBus.on('snake:matchFound', (data) => {
    state.isMatching = false;
    if (state.selectedGame !== 'snake') return;
    store.set('pendingMatch', { ...data, game: 'snake' });
    startOnlineGame();
  });

  // ---- 战局重连恢复事件 ----
  // 服务端已恢复会话（game_reconnected / ai_game_start reconnected）或主动查询（get_current_game）
  function applyReconnectSnapshot(data) {
    if (!data || !data.gameType) return;
    state.reconnectGame = data;
    store.set('reconnectGame', data);
    // 若正在对局/匹配中，不打断；否则展示恢复面板
    if (state.isMatching) return;
    if (currentCleanup) return; // 已在对局内（如对局中 socket 重连），不覆盖
    renderMain();
  }
  const offReconnected = eventBus.on('game:reconnected', (data) => applyReconnectSnapshot(data));
  const offCurrentGame = eventBus.on('game:currentGame', (data) => {
    // 主动查询 get_current_game 的响应：data 为 null 表示服务端已无进行中对局
    // （如对局已结束/被放弃），清除本地残留快照，避免误显示恢复面板
    if (!data) {
      if (currentCleanup) return; // 已在对局内，不打断
      pendingDiscard = false; // 服务端已无进行中对局，无需再放弃
      if (state.reconnectGame || store.get('reconnectGame')) {
        state.reconnectGame = null;
        store.set('reconnectGame', null);
        renderMain();
      }
      return;
    }
    applyReconnectSnapshot(data);
  });
  const offDiscardResult = eventBus.on('game:discardResult', (data) => {
    pendingDiscard = false;
    state.reconnectGame = null;
    store.set('reconnectGame', null);
    toast.success(data?.message || '已放弃对局');
    renderMain();
  });

  // 兜底 1：socket 连接（含重连）后主动查询当前对局。
  // 解决挂载时 socket 未连接导致 get_current_game 未发出的缺口——
  // 即使 game_reconnected 事件在懒加载订阅前到达丢失，也会在这里补上。
  const offSocketConnect = eventBus.on('socket:connect', () => {
    emit('get_current_game');
    // socket 断开期间点击过「放弃对局」：重连后自动重发
    if (pendingDiscard) {
      pendingDiscard = false;
      toast.info('已重连，正在放弃对局…');
      emit('discard_current_game');
    }
  });

  // 兜底 2：匹配请求被服务端拒绝（如仍处于 playing 状态）时，退出匹配中
  // 界面并主动查询当前对局，自动切回恢复面板，避免"卡在匹配中无法操作"。
  const offSystemError = eventBus.on('system:error', (data) => {
    if (!state.isMatching) return;
    const msg = data?.message || '';
    if (!msg.includes('匹配')) return;
    state.isMatching = false;
    renderMain();
    emit('get_current_game');
  });

  // 连接状态可见提示：socket 断开时明确告知，避免操作被静默丢弃
  let disconnectNoticeShown = false;
  const offSocketDisconnect = eventBus.on('socket:disconnect', () => {
    if (disconnectNoticeShown) return; // 断开期间只提示一次，避免刷屏
    disconnectNoticeShown = true;
    toast.warn('连接已断开，正在自动重连…');
  });
  const offSocketReconnect = eventBus.on('socket:reconnect', () => {
    disconnectNoticeShown = false;
    toast.success('已重新连接');
  });

  // ---- 进入单机模式 ----
  // 贪吃蛇没有独立路由（snake 会别名回大厅），必须像联机一样在大厅内直接挂载；
  // 消消乐、3D 驾驶等有自己的路由，走正常跳转
  function enterSoloMode(gameId) {
    if (gameId === 'snake') {
      store.set('pendingMatch', null); // 清除可能残留的匹配数据，确保进入单机分支
      mountGame(gameId);
      return;
    }
    // 消消乐 / 3D 驾驶：把面板里预选的子玩法传给对应页面（进入后消费一次）
    store.set('games.initMode', state.soloModes[gameId] || null);
    go(gameId);
  }

  // ---- 在统一大厅内挂载游戏（联机 / 单机共用）----
  async function mountGame(gameId) {
    const gameModulePath = {
      'gobang': '../../games/gobang/index.js',
      'go': '../../games/go/index.js',
      'chinese-chess': '../../games/chinese-chess/index.js',
      'snake': '../../games/snake/index.js',
    }[gameId];

    const exportName = {
      'gobang': 'renderGobang',
      'go': 'renderGo',
      'chinese-chess': 'renderChess',
      'snake': 'renderSnake',
    }[gameId];

    try {
      const mod = await import(gameModulePath);
      const container = el('div', { class: 'games-play-area' });
      mainEl.innerHTML = '';
      mainEl.append(container);
      pageEl.classList.add('is-playing');
      const cleanupFn = mod[exportName](container);
      setShortcutsSuppressed(true); // 对局中关闭全局快捷键，避免 WASD 触发页面跳转
      const prevCleanup = currentCleanup;
      currentCleanup = () => {
        setShortcutsSuppressed(false);
        if (typeof cleanupFn === 'function') cleanupFn();
        if (typeof prevCleanup === 'function') prevCleanup();
      };
      startGameActivity(); // 进入对局：开始活跃续期
      // 首次进入对局引导：贪吃蛇用专属步骤，棋类用棋盘操作引导
      if (gameId === 'snake') startSnakeTour();
      else startGameTour();
    } catch (err) {
      console.error('[Games] 游戏启动失败:', err);
      toast.error('游戏启动失败');
      renderMain();
    }
  }

  // ---- 启动联机游戏 ----
  async function startOnlineGame() {
    await mountGame(state.selectedGame);
  }

  // ---- 路由别名：支持旧的 go('gobang') 等调用 ----
  // 如果是从旧路由跳转过来的，自动进入对应游戏
  const hash = window.location.hash.slice(2);
  const oldRoute = hash.split('/')[0];
  const oldGameMap = {
    'gobang': 'gobang',
    'go': 'go',
    'chinese-chess': 'chinese-chess',
    'snake': 'snake',
    'ai-battle': 'gobang',
  };
  const mapped = oldGameMap[oldRoute];
  if (mapped) state.selectedGame = mapped;

  // ---- 初始化渲染 ----
  renderPicker();
  renderMain();

  // 主动查询服务端当前进行中的对局（双保险：事件可能在懒加载挂载前到达，
  // 或客户端手动放弃了本地的 reconnectGame 但服务端仍处于 playing 状态）
  if (store.get('socketConnected')) {
    emit('get_current_game');
  }

  // ---- 页面内快捷键（走统一分发，键位由设置页「⌨ 快捷键」决定）----
  function runLobbyShortcut(op) {
    if (!op) return;
    const current = ALL_GAMES.find((g) => g.id === state.selectedGame) || ALL_GAMES[0];

    if (op.type === 'pick') {
      const target = ALL_GAMES[op.index];
      if (target && !state.isMatching) {
        state.selectedGame = target.id;
        renderPicker();
        renderMain();
      }
    } else if (op.type === 'mode') {
      if (state.isMatching) return;
      if (op.mode === 'ai') {
        if (!current.modes.includes('ai')) { toast.warn(`${current.name}暂不支持 AI 对战`); return; }
        startAIBattle();
      } else if (op.mode === 'online') {
        if (!current.modes.includes('online')) { toast.warn(`${current.name}暂不支持联机对战`); return; }
        startMatch();
      }
    } else if (op.type === 'start') {
      if (state.isMatching) return;
      // 同时支持联机与单机的游戏（贪吃蛇），快捷键默认走联机匹配
      if (current.modes.includes('online')) { startMatch(); return; }
      if (current.modes.includes('solo')) { enterSoloMode(current.id); return; }
      if (current.modes.includes('ai')) startAIBattle();
    } else if (op.type === 'cancel') {
      if (state.isMatching) {
        state.isMatching = false;
        renderMain();
        emit('cancel_match');
      }
    }
  }

  // 视图挂载时注册，离开大厅时由 cleanup 注销
  const unregisterLobbyShortcut = registerScopeHandler('games', runLobbyShortcut);

  // ---- 清理 ----
  return () => {
    unregisterLobbyShortcut();
    offMatchSuccess();
    offMatchTimeout();
    offSnakeFound();
    offReconnected();
    offCurrentGame();
    offDiscardResult();
    offSocketConnect();
    offSystemError();
    offSocketDisconnect();
    offSocketReconnect();
    runCleanup();
    container.innerHTML = '';
  };
}

/**
 * 快速跳转到游戏大厅并选中指定游戏
 * @param {'online'|'ai'} [_mode] - 保留参数兼容旧调用；大厅已改为平铺，不再区分模式
 * @param {string} [gameId] - 游戏 id
 */
export function goGames(_mode, gameId) {
  if (gameId) store.set('games.initGame', gameId);
  go('games');
}
