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
  };

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

  // ---- 开始 AI 对战 ----
  async function startAIBattle() {
    const gameType = state.selectedGame;
    const difficulty = state.difficulty;
    mainEl.innerHTML = '';

    try {
      const mod = await import(`../ai-battle/play.js`);
      const container = el('div', { class: 'games-play-area' });
      mainEl.append(container);
      const cleanupFn = mod.startAIBattle(container, { gameType, difficulty });
      const prevCleanup = currentCleanup;
      currentCleanup = () => {
        if (typeof cleanupFn === 'function') cleanupFn();
        if (typeof prevCleanup === 'function') prevCleanup();
      };
    } catch (err) {
      console.error('[Games] AI 对战启动失败:', err);
      toast.error('AI 对战启动失败');
    }
  }

  // ---- 事件订阅 ----
  const offMatchSuccess = eventBus.on('lobby:matchSuccess', (data) => {
    if (data.game !== state.selectedGame) return;
    state.isMatching = false;
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

  // ---- 启动联机游戏 ----
  async function startOnlineGame() {
    const gameId = state.selectedGame;
    const gameModulePath = {
      'gobang': '../games/gobang/index.js',
      'go': '../games/go/index.js',
      'chinese-chess': '../games/chinese-chess/index.js',
      'snake': '../games/snake/index.js',
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
