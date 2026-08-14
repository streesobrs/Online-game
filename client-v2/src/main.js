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
import { switchLayout } from './layouts/registry.js';
import { viewRoot } from './utils/dom.js';
import * as login from './features/auth/login.js';
import { renderLobby } from './features/lobby/index.js';
import { renderChat, initFloatingChat } from './features/chat/index.js';
import { renderAchievements } from './features/achievements/index.js';
import { renderLeaderboard } from './features/leaderboard/index.js';
import { renderGobang } from './games/gobang/index.js';
import { renderGo } from './games/go/index.js';
import { renderChess } from './games/chinese-chess/index.js';
import { renderSnake } from './games/snake/index.js';

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

// 3. 注册业务视图路由（须在 initRouter 之前，保证当前 hash 首次处理即命中）
registerRoute('lobby', () => renderLobby(viewRoot()));
registerRoute('chat', () => renderChat(viewRoot()));
registerRoute('achievements', () => renderAchievements(viewRoot()));
registerRoute('leaderboard', () => renderLeaderboard(viewRoot()));
registerRoute('gobang', () => renderGobang(viewRoot()));
registerRoute('go', () => renderGo(viewRoot()));
registerRoute('chinese-chess', () => renderChess(viewRoot()));
registerRoute('snake', () => renderSnake(viewRoot()));

// 4. 初始化路由（hashchange 监听 + 处理当前 hash）
initRouter();

// 5. 初始化快捷键（元数据驱动，按 1/2/3/4 切换游戏）
initShortcuts();

// 6. 渲染布局（导航栏；读取本地保存的布局，默认 topnav）
switchLayout(localStorage.getItem('nav-layout') || 'topnav');

// 7. 初始化常驻浮动聊天窗（任意页面随时聊天）
initFloatingChat();

// 8. 自动登录检测：未登录（无 token / token 失效）时弹出登录框
login.initLoginCheck();

// 校验挂载点是否存在
const app = document.getElementById('app');
if (!app) {
  console.error('[v2] 未找到 #app 挂载点');
}
