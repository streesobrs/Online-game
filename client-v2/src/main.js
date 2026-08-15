/**
 * 应用入口（v2 客户端）
 * 初始化顺序：eventBus → store → socket → api → auth → theme → router(含视图注册) → shortcut → layout → 登录检测。
 */
import { eventBus } from './core/eventBus.js';
import { store } from './core/store.js';
import { el } from './utils/dom.js';
import { toast } from './components/toast.js';
import { modal } from './components/modal.js';
import { api } from './core/api.js';
import { socket } from './core/socket.js';
import * as auth from './core/auth.js';
import { initRouter, registerRoute, go, isActive } from './core/router.js';
import { initShortcuts } from './utils/shortcut.js';
import { NAV_ITEMS, GAMES, FEATURES, findItem } from './data/navItems.js';
import * as themes from './features/themes/index.js';
import { switchLayout, renderAccountBar } from './layouts/registry.js';
import { viewRoot } from './utils/dom.js';
import * as login from './features/auth/login.js';
import { renderLobby } from './features/lobby/index.js';
import { renderChat, initFloatingChat } from './features/chat/index.js';
import { initOnlinePlayers } from './features/online-players/index.js';

console.log('[v2] main.js 已加载');

// 调试辅助：暴露核心对象到全局，方便浏览器控制台验证
window.eventBus = eventBus;
window.store = store;
window.el = el;
window.toast = toast;
window.modal = modal;
window.api = api;
window.socket = socket;
window.auth = auth;
window.go = go;
window.isActive = isActive;
window.registerRoute = registerRoute;
window.shortcuts = { initShortcuts };
window.navItems = { NAV_ITEMS, GAMES, FEATURES, findItem };
window.themes = themes;
window.switchLayout = switchLayout;
window.login = login;

// 1. 初始化登录态（恢复 token、订阅登录事件、socket 连接后自动登录）
auth.initAuth();

// 2. 初始化主题（应用 v1/v2 共享的 selectedTheme）
themes.initThemes();

/**
 * 路由懒加载（5.2.1 首屏优化）
 * 首次进入视图时才动态 import 对应模块，import 失败时不阻断路由切换
 */
function lazyView(path, exportName) {
  return async () => {
    try {
      const mod = await import(path);
      const render = mod[exportName];
      if (typeof render === 'function') render(viewRoot());
    } catch (err) {
      console.error('[v2] 视图懒加载失败:', path, err);
    }
  };
}

// 3. 注册业务视图路由（须在 initRouter 之前，保证当前 hash 首次处理即命中）
registerRoute('lobby', () => renderLobby(viewRoot()));
registerRoute('chat', () => renderChat(viewRoot()));
registerRoute('themes', () => themes.renderThemePanel(viewRoot()));

// 其余视图按需懒加载（5.2.1 首屏优化：非首屏模块首次进入时才动态 import）
registerRoute('achievements', lazyView('./features/achievements/index.js', 'renderAchievements'));
registerRoute('leaderboard', lazyView('./features/leaderboard/index.js', 'renderLeaderboard'));
registerRoute('ai-battle', lazyView('./features/ai-battle/index.js', 'renderAIBattle'));
registerRoute('spectate', lazyView('./features/spectate/index.js', 'renderSpectate'));
registerRoute('shop', lazyView('./features/shop/index.js', 'renderShop'));
registerRoute('profile', lazyView('./features/profile/index.js', 'renderProfile'));
registerRoute('gobang', lazyView('./games/gobang/index.js', 'renderGobang'));
registerRoute('go', lazyView('./games/go/index.js', 'renderGo'));
registerRoute('chinese-chess', lazyView('./games/chinese-chess/index.js', 'renderChess'));
registerRoute('snake', lazyView('./games/snake/index.js', 'renderSnake'));

// 4. 初始化路由（hashchange 监听 + 处理当前 hash）
initRouter();

// 5. 初始化快捷键（元数据驱动，按 1/2/3/4 切换游戏）
initShortcuts();

// 6. 渲染布局（导航栏；读取本地保存的布局，默认 topnav）
switchLayout(localStorage.getItem('nav-layout') || 'topnav');

// 6.1 初始化顶部悬浮账号条（复刻 v1 account-bar，登录/注册/账号信息，独立于导航布局）
renderAccountBar(document.getElementById('account-root') || document.body);

// 7. 初始化常驻浮动聊天窗（任意页面随时聊天）
initFloatingChat();

// 7.1 初始化在线玩家浮动面板（在线列表 + 挑战，任意页面可用）
initOnlinePlayers();

// 8. 自动登录检测：未登录（无 token / token 失效）时弹出登录框
login.initLoginCheck();

// 校验挂载点是否存在
const app = document.getElementById('app');
if (!app) {
  console.error('[v2] 未找到 #app 挂载点');
}
