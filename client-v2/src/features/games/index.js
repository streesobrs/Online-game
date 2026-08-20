/**
 * 统一游戏大厅（整合五子棋/围棋/象棋/贪吃蛇/AI对战/联机匹配）
 * 原分散的 6 个导航入口合并为单一入口。
 *
 * 布局：
 * ┌─────────────────────────────────────────────────────┐
 * │ 模式切换: [🎮 联机匹配] [🤖 AI对战]                 │
 * ├──────────┬──────────────────────────────────────────┤
 * │ 游戏选择 │  主内容区                                 │
 * │ 🔴五子棋 │  ┌────────────────────────────────────┐  │
 * │ ⚪围棋   │  │  匹配/选择界面 或 游戏对战界面      │  │
 * │ 🟥象棋   │  │  （动态切换）                       │  │
 * │ 🐍贪吃蛇 │  └────────────────────────────────────┘  │
 * │          │                                          │
 * └──────────┴──────────────────────────────────────────┘
 *
 * 快捷键：1-4 切换游戏，T 联机/A AI，Enter 开始匹配
 */
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { emit } from '../../core/socket.js';
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import { GAMES } from '../../data/navItems.js';
import { go } from '../../core/router.js';
import { startGameTour } from '../../components/onboarding.js';

const GAME_MAP = Object.fromEntries(GAMES.map((g) => [g.id, g]));

const AI_GAMES = [
  { id: 'gobang', name: '五子棋', icon: '🔴' },
  { id: 'go', name: '围棋', icon: '⚪' },
  { id: 'chinese-chess', name: '象棋', icon: '🟥' },
];

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
    mode: 'online',      // 'online' | 'ai'
    selectedGame: GAMES[0].id,
    difficulty: 'easy',
    isMatching: false,
    reconnectGame: store.get('reconnectGame') || null, // 战局内刷新后的对局快照
  };

  // socket 断开时点击「放弃对局」：标记待放弃，重连成功后自动重发
  let pendingDiscard = false;

  // 从 store 读取初始状态（路由跳转带过来的）
  const initialMode = store.get('games.initMode');
  const initialGame = store.get('games.initGame');
  if (initialMode) { state.mode = initialMode; store.set('games.initMode', null); }
  if (initialGame) { state.selectedGame = initialGame; store.set('games.initGame', null); }

  // ---- 子容器 ----
  const sidebarEl = el('div', { class: 'games-sidebar' });
  const mainEl = el('div', { class: 'games-main' });
  const modeTabs = el('div', { class: 'games-mode-tabs' });

  const pageEl = el('div', { class: 'games-page' }, [
    modeTabs,
    el('div', { class: 'games-body' }, [sidebarEl, mainEl]),
  ]);

  container.innerHTML = '';
  container.append(pageEl);

  // ---- 渲染模式 Tab ----
  function renderModeTabs() {
    modeTabs.innerHTML = '';
    const tabs = [
      { key: 'online', icon: '🎮', label: '联机匹配' },
      { key: 'ai', icon: '🤖', label: 'AI对战' },
    ];
    tabs.forEach((t) => {
      const btn = el('button', {
        class: 'games-mode-tab' + (state.mode === t.key ? ' active' : ''),
        onClick: () => {
          if (state.isMatching) return;
          state.mode = t.key;
          renderModeTabs();
          renderSidebar();
          renderMain();
        },
      }, `${t.icon} ${t.label}`);
      modeTabs.append(btn);
    });
  }

  // ---- 渲染侧边栏：游戏选择 ----
  function renderSidebar() {
    sidebarEl.innerHTML = '';
    sidebarEl.append(el('div', { class: 'games-sidebar-title' }, '选择游戏'));

    const games = state.mode === 'ai' ? AI_GAMES : GAMES;
    games.forEach((g) => {
      const card = el('div', {
        class: 'games-game-card' + (state.selectedGame === g.id ? ' active' : ''),
        onClick: () => {
          if (state.isMatching) return;
          state.selectedGame = g.id;
          renderSidebar();
          renderMain();
        },
      }, [
        el('div', { class: 'games-game-icon' }, g.icon),
        el('div', { class: 'games-game-name' }, g.name),
      ]);
      sidebarEl.append(card);
    });

    if (state.mode === 'online') {
      sidebarEl.append(el('div', { class: 'games-sidebar-tip' }, '💡 选择游戏后点击「开始匹配」'));
    } else {
      sidebarEl.append(el('div', { class: 'games-sidebar-tip' }, '💡 选择游戏和难度后开始 AI 对战'));
    }
    sidebarEl.append(el('div', { class: 'games-sidebar-shortcuts' },
      '快捷键: 1-4 切换 · T 联机 · A AI · Enter 开始 · Esc 取消'));
  }

  // ---- 渲染主区域 ----
  function renderMain() {
    runCleanup();
    mainEl.innerHTML = '';

    // 战局内刷新后的对局快照：优先展示恢复/放弃入口
    if (state.reconnectGame) {
      mainEl.append(renderReconnectPanel(state.reconnectGame));
      return;
    }

    if (state.isMatching) {
      mainEl.append(renderMatchingUI());
      return;
    }

    if (state.mode === 'online') {
      mainEl.append(renderOnlinePanel());
    } else {
      mainEl.append(renderAIPanel());
    }
  }

  // ---- 联机匹配面板 ----
  function renderOnlinePanel() {
    const g = GAME_MAP[state.selectedGame];
    const infoBox = el('div', { class: 'games-info-box' }, [
      el('div', { class: 'games-info-title' }, `${g.icon} ${g.name}`),
      el('div', { class: 'games-info-desc' }, '联机对战：将与其他玩家进行实时匹配'),
    ]);

    const startBtn = el('button', { class: 'btn btn-primary btn-lg', style: 'width:100%;' }, '🎯 开始匹配');
    startBtn.addEventListener('click', () => {
      if (state.reconnectGame) { toast.warn('存在未完成的对局，请先继续或放弃'); return; }
      if (!store.get('socketConnected')) { toast.error('未连接服务器'); return; }
      if (!store.get('user')) { toast.error('请先登录'); return; }
      state.isMatching = true;
      renderMain();
      emit('match_request', { game: state.selectedGame });
    });

    return el('div', { class: 'games-panel' }, [
      el('h2', { class: 'games-panel-title' }, '联机匹配'),
      infoBox,
      el('div', { class: 'games-action-row' }, [startBtn]),
    ]);
  }

  // ---- AI 对战面板 ----
  function renderAIPanel() {
    const g = AI_GAMES.find((x) => x.id === state.selectedGame);
    const gameLabel = g ? `${g.icon} ${g.name}` : state.selectedGame;

    const difficultyCards = DIFFICULTIES.map((d) =>
      el('div', {
        class: 'games-difficulty-card' + (state.difficulty === d.id ? ' active' : ''),
        style: `border-color:${state.difficulty === d.id ? d.color : ''};`,
        onClick: () => {
          state.difficulty = d.id;
          renderMain();
        },
      }, [
        el('div', { class: 'games-difficulty-label', style: `color:${d.color};` }, d.label),
        el('div', { class: 'games-difficulty-desc' }, d.desc),
      ])
    );

    const startBtn = el('button', { class: 'btn btn-primary btn-lg', style: 'width:100%;margin-top:16px;' }, '🤖 开始 AI 对战');
    startBtn.addEventListener('click', () => startAIBattle());

    return el('div', { class: 'games-panel' }, [
      el('h2', { class: 'games-panel-title' }, 'AI 对战'),
      el('div', { class: 'games-info-box' }, [
        el('div', { class: 'games-info-title' }, gameLabel),
        el('div', { class: 'games-info-desc' }, '选择 AI 难度，在本地进行人机对战'),
      ]),
      el('div', { class: 'games-difficulties' }, difficultyCards),
      startBtn,
    ]);
  }

  // ---- 匹配中 UI ----
  function renderMatchingUI() {
    const g = GAME_MAP[state.selectedGame];
    const cancelBtn = el('button', { class: 'btn btn-secondary btn-lg', style: 'width:100%;' }, '❌ 取消匹配');
    cancelBtn.addEventListener('click', () => {
      state.isMatching = false;
      renderMain();
      emit('cancel_match');
    });
    return el('div', { class: 'games-panel games-matching' }, [
      el('div', { class: 'games-matching-spinner' }, '🔍'),
      el('h2', { class: 'games-panel-title' }, `正在寻找${g.icon} ${g.name}对手...`),
      el('div', { class: 'games-matching-dots' }, '请稍候'),
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

    const resumeBtn = el('button', { class: 'btn btn-primary btn-lg', style: 'width:100%;' }, '▶️ 继续对局');
    resumeBtn.addEventListener('click', () => resumeReconnectGame(snapshot));

    const discardBtn = el('button', { class: 'btn btn-secondary btn-lg', style: 'width:100%;' }, '🚪 放弃对局');
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

    return el('div', { class: 'games-panel' }, [
      el('h2', { class: 'games-panel-title' }, '♻️ 发现未完成的对局'),
      el('div', { class: 'games-info-box' }, [
        el('div', { class: 'games-info-title' }, `${modeLabel} · ${gameName}`),
        el('div', { class: 'games-info-desc' }, opponentLabel || '刷新前有对局尚未结束'),
      ]),
      el('div', { class: 'games-action-row', style: 'display:flex;flex-direction:column;gap:10px;' }, [
        resumeBtn,
        discardBtn,
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
    state.mode = snapshot.mode === 'ai' ? 'ai' : 'online';
    state.selectedGame = gameType;
    if (snapshot.difficulty) state.difficulty = snapshot.difficulty;
    renderModeTabs();
    renderSidebar();

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
      const cleanupFn = mod.startAIBattle(container, { gameType, difficulty, snapshot });
      const prevCleanup = currentCleanup;
      currentCleanup = () => {
        if (typeof cleanupFn === 'function') cleanupFn();
        if (typeof prevCleanup === 'function') prevCleanup();
      };
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
      const cleanupFn = mod[exportName](container);
      const prevCleanup = currentCleanup;
      currentCleanup = () => {
        if (typeof cleanupFn === 'function') cleanupFn();
        if (typeof prevCleanup === 'function') prevCleanup();
      };
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
    'ai-battle': 'ai',
    'lobby': 'online',
  };
  const mapped = oldGameMap[oldRoute];
  if (mapped) {
    if (mapped === 'ai') state.mode = 'ai';
    else state.selectedGame = mapped;
  }

  // ---- 初始化渲染 ----
  renderModeTabs();
  renderSidebar();
  renderMain();

  // 主动查询服务端当前进行中的对局（双保险：事件可能在懒加载挂载前到达，
  // 或客户端手动放弃了本地的 reconnectGame 但服务端仍处于 playing 状态）
  if (store.get('socketConnected')) {
    emit('get_current_game');
  }

  // ---- 页面内快捷键 ----
  function handlePageKeydown(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (store.get('currentView') !== 'games') return;

    const gamesList = state.mode === 'ai' ? AI_GAMES : GAMES;

    if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') {
      const idx = parseInt(e.key, 10) - 1;
      if (idx < gamesList.length && !state.isMatching) {
        state.selectedGame = gamesList[idx].id;
        renderSidebar();
        renderMain();
        e.preventDefault();
      }
    } else if (e.key === 't' || e.key === 'T') {
      if (state.mode !== 'online' && !state.isMatching) {
        state.mode = 'online';
        renderModeTabs();
        renderSidebar();
        renderMain();
      }
    } else if (e.key === 'a' || e.key === 'A') {
      if (state.mode !== 'ai' && !state.isMatching) {
        state.mode = 'ai';
        renderModeTabs();
        renderSidebar();
        renderMain();
      }
    } else if (e.key === 'Enter') {
      if (!state.isMatching && state.mode === 'online') {
        if (state.reconnectGame) { toast.warn('存在未完成的对局，请先继续或放弃'); return; }
        if (!store.get('socketConnected')) { toast.error('未连接服务器'); return; }
        if (!store.get('user')) { toast.error('请先登录'); return; }
        state.isMatching = true;
        renderMain();
        emit('match_request', { game: state.selectedGame });
      }
    } else if (e.key === 'Escape') {
      if (state.isMatching) {
        state.isMatching = false;
        renderMain();
        emit('cancel_match');
      }
    }
  }

  window.addEventListener('keydown', handlePageKeydown);

  // ---- 清理 ----
  return () => {
    window.removeEventListener('keydown', handlePageKeydown);
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
 * 快速跳转到游戏大厅的指定模式/游戏
 * @param {'online'|'ai'} mode
 * @param {string} [gameId] - 游戏 id
 */
export function goGames(mode, gameId) {
  if (mode) store.set('games.initMode', mode);
  if (gameId) store.set('games.initGame', gameId);
  go('games');
}
