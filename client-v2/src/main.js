/**
 * 应用入口（v2 客户端）
 * 骨架阶段：验证 ES Modules 加载链路，并暴露核心对象到全局供控制台调试。
 * 完整初始化顺序（eventBus → store → socket → api → auth → router → shortcut → layout → 默认视图）
 * 将在任务 1.8.1 整合实现。
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

console.log('[v2] main.js 已加载');

// 调试辅助：暴露核心对象到全局，方便浏览器控制台验证（参照 v1 的 window.applyTheme 先例；正式整合见 1.8.1）
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

// 初始化登录态（恢复 token、订阅登录事件、socket 连接后自动登录）
auth.initAuth();

// 初始化主题（应用 v1/v2 共享的 selectedTheme）
themes.initThemes();

// 初始化路由（hashchange 监听 + 处理当前 hash）
initRouter();

// 初始化快捷键（元数据驱动，按 1/2/3/4 切换游戏）
initShortcuts();

// 校验挂载点是否存在
const app = document.getElementById('app');
if (!app) {
  console.error('[v2] 未找到 #app 挂载点');
}
