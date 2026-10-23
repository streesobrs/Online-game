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
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import { GAMES } from '../../data/navItems.js';
import { go } from '../../core/router.js';
import { startGameActivity, stopGameActivity } from '../../core/activity.js';
import { startGameTour } from '../../components/onboarding.js';
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
  snake: ['online'],
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
    desc: '多人同场贪吃蛇，活得越久得分越高',
    accent: '#2f9e6e',
    tags: ['多人同场', '实时对战'],
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
  { id: 'easy', label: '🟢 简单', desc: 'AI 随机落子', color: '#48bb78' },
  { id: 'medium', label: '🟡 中等', desc: 'AI 简单策略', color: '#ed8936' },
  { id: 'hard', label: '🔴 困难', desc: 'AI 深度思考', color: '#f56565' },
];

/** 缓存的 cleanup 函数（切换游戏/页面时清理旧对局） */
let currentCleanup = null;

function runCleanup() {
  if (typeof currentCleanup === 'function') {
    try { currentCleanup(); } catch (e) { console.error(e); }
  }
  currentCleanup = null;
  stopGameActivity(); // 退出对局：停止活跃续期心跳
}

/**
 * 渲染统一游戏大厅
 * @param {HTMLElement} container - #view-root
 * @returns {Function} cleanup
 */
export function renderGames(container) {
  runCleanup();

  // 状态
  const state = {
    selectedGame: GAMES[0].id,
    difficulty: 'easy',
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

  // ---- 详情面板：按游戏支持的玩法并列展示所有入口 ----
  function renderGamePanel() {
    const g = ALL_GAMES.find((x) => x.id === state.selectedGame) || ALL_GAMES[0];
    const ui = GAME_UI[g.id] || {};
    const fullLabel = { online: '联机匹配', ai: 'AI 对战', solo: '单机游戏' };
    const modeLabel = g.modes.map((m) => fullLabel[m]).join(' · ');

    const blocks = [];
    if (g.modes.includes('online')) blocks.push(renderOnlineBlock());
    if (g.modes.includes('ai')) blocks.push(renderAIBlock());
    if (g.modes.includes('solo')) blocks.push(renderSoloBlock(g));

    return el('div', { class: 'games-detail games-detail--flat' }, [
      renderGameHero(g, ui, modeLabel),
      el('div', { class: 'games-mode-section' }, [
        el('div', { class: 'games-aside-title' }, '选择玩法 · 直接开局'),
        el('div', { class: 'games-mode-grid' }, blocks),
      ]),
    ]);
  }

  /** 详情面板内的模式标题 */
  function renderBlockHead(icon, label) {
    return el('div', { class: 'games-block-head' }, [
      el('span', { class: 'games-block-icon' }, icon),
      el('span', {}, label),
    ]);
  }

  // ---- 联机匹配入口 ----
  function renderOnlineBlock() {
    const startBtn = el('button', { class: 'btn btn-primary games-block-btn' }, '🎯 开始匹配');
    startBtn.addEventListener('click', startMatch);
    return el('div', { class: 'games-mode-block' }, [
      renderBlockHead('🌐', '联机匹配'),
      el('p', { class: 'games-block-desc' }, '系统匹配真人玩家，实时对局'),
      startBtn,
    ]);
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

  // ---- AI 对战入口 ----
  function renderAIBlock() {
    const difficultyCards = DIFFICULTIES.map((d) =>
      el('button', {
        type: 'button',
        class: 'games-diff' + (state.difficulty === d.id ? ' active' : ''),
        style: `--accent:${d.color}`,
        onClick: () => {
          state.difficulty = d.id;
          renderMain();
        },
      }, [
        el('span', { class: 'games-diff-label' }, d.label),
        el('span', { class: 'games-diff-desc' }, d.desc),
      ])
    );

    const startBtn = el('button', { class: 'btn btn-primary games-block-btn' }, '🤖 开始 AI 对战');
    startBtn.addEventListener('click', () => startAIBattle());

    return el('div', { class: 'games-mode-block' }, [
      renderBlockHead('🤖', 'AI 对战'),
      el('div', { class: 'games-diff-list' }, difficultyCards),
      startBtn,
    ]);
  }

  // ---- 单机游戏入口 ----
  function renderSoloBlock(g) {
    const enterBtn = el('button', { class: 'btn btn-primary games-block-btn' }, '🚀 进入游戏');
    enterBtn.addEventListener('click', () => go(g.id));
    return el('div', { class: 'games-mode-block' }, [
      renderBlockHead('🕹', '单机游戏'),
      el('p', { class: 'games-block-desc' }, '在独立页面中游玩，随时可返回大厅'),
      enterBtn,
    ]);
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
      const prevCleanup = currentCleanup;
      currentCleanup = () => {
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

  // ---- 启动联机游戏 ----
  async function startOnlineGame() {
    const gameId = state.selectedGame;
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
      const prevCleanup = currentCleanup;
      currentCleanup = () => {
        if (typeof cleanupFn === 'function') cleanupFn();
        if (typeof prevCleanup === 'function') prevCleanup();
      };
      startGameActivity(); // 进入对局：开始活跃续期
      // 首次进入对局：落子/悔棋/认输操作引导
      startGameTour();
    } catch (err) {
      console.error('[Games] 游戏启动失败:', err);
      toast.error('游戏启动失败');
      renderMain();
    }
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
      if (current.modes.includes('solo')) { go(current.id); return; }
      if (current.modes.includes('online')) { startMatch(); return; }
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
