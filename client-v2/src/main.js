/**
 * 应用入口（v2 客户端）
 * 初始化顺序：eventBus → store → socket → api → auth → theme → router(含视图注册) → shortcut → layout → 登录检测。
 *
 * 统一游戏大厅：五子棋/围棋/象棋/贪吃蛇/AI对战/联机匹配已整合为单一「游戏」入口。
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
import { renderGames } from './features/games/index.js';
import { renderChat, initFloatingChat } from './features/chat/index.js';

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

// 3. 注册业务视图路由
// 统一游戏大厅（整合联机匹配 + AI对战 + 4 棋种）
registerRoute('games', () => renderGames(viewRoot()));
registerRoute('chat', () => renderChat(viewRoot()));

// 其余视图按需懒加载
// 已迁移模块（成就/商城/主题/快捷键）不再注册独立路由，旧路由经 ROUTE_ALIASES 重定向到个人资料页对应 Tab
registerRoute('leaderboard', lazyView('./features/leaderboard/index.js', 'renderLeaderboard'));
registerRoute('spectate', lazyView('./features/spectate/index.js', 'renderSpectate'));
registerRoute('profile', lazyView('./features/profile/index.js', 'renderProfile'));

// 4. 初始化路由（hashchange 监听 + 处理当前 hash）
initRouter();

// 5. 初始化快捷键（元数据驱动）
initShortcuts();

// 6. 渲染布局（导航栏；读取本地保存的布局，默认 topnav）
switchLayout(localStorage.getItem('nav-layout') || 'topnav');

// 6.1 初始化顶部悬浮账号条
renderAccountBar(document.getElementById('account-root') || document.body);

// 7. 初始化常驻悬浮坞（合并聊天 + 在线玩家）
initFloatingChat();

// 8. 自动登录检测
login.initLoginCheck();

// 校验挂载点
const app = document.getElementById('app');
if (!app) {
  console.error('[v2] 未找到 #app 挂载点');
}
