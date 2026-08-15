/**
 * Hash 路由
 * 使用 hash 路由（#/path），无需服务端配合，刷新不丢状态。
 * 业务模块通过 registerRoute(id, handler) 注册视图挂载函数。
 *
 * 路由别名：旧的分散游戏路由（gobang/go/chinese-chess/snake/ai-battle/lobby）
 * 均重定向到统一「游戏大厅」，通过 store 传递初始状态。
 */
import { NAV_ITEMS, ROUTE_ALIASES } from '../data/navItems.js';
import { store } from './store.js';
import { eventBus } from './eventBus.js';

const ROUTES = new Map();
const DEFAULT_ROUTE = 'games';

/**
 * 注册路由处理器
 * @param {string} id - 视图 ID（须存在于 NAV_ITEMS，或为默认大厅 'games'）
 * @param {Function} handler - 挂载视图的函数
 */
export function registerRoute(id, handler) {
  ROUTES.set(id, handler);
}

/**
 * 路由跳转
 * @param {string} id - 视图 ID
 */
export function go(id) {
  const alias = ROUTE_ALIASES[id];
  if (alias) {
    if (alias.tab) {
      // 已迁移模块：跳转到个人资料页对应 Tab；已在个人资料页时直接切换
      store.set('profile.initTab', alias.tab);
      if (window.location.hash === '#/profile') {
        eventBus.emit('profile:openTab', alias.tab);
        return;
      }
      id = 'profile';
    } else {
      if (alias.mode) store.set('games.initMode', alias.mode);
      else store.set('games.initMode', null);
      if (alias.game) store.set('games.initGame', alias.game);
      else store.set('games.initGame', null);
      id = 'games';
    }
  }
  if (!NAV_ITEMS.find((i) => i.id === id)) {
    console.warn(`[Router] 未知路由: ${id}`);
    return;
  }
  const target = `#/${id}`;
  if (window.location.hash === target) {
    // hash 未变化：如统一大厅内从对局返回大厅时 hash 始终为 #/games，
    // 浏览器不会触发 hashchange，需手动重新挂载视图（含退出当前对局）
    handleHashChange();
    return;
  }
  window.location.hash = target;
}

/** 处理 hash 变化 */
function handleHashChange() {
  const hash = window.location.hash.slice(2);
  let id = hash || DEFAULT_ROUTE;

  // 路由别名处理：旧路由重定向到统一入口
  const alias = ROUTE_ALIASES[id];
  if (alias) {
    if (alias.tab) {
      // 已迁移模块 → 个人资料页对应 Tab
      store.set('profile.initTab', alias.tab);
      id = 'profile';
      window.location.hash = '#/profile';
      return;
    }
    if (alias.mode) store.set('games.initMode', alias.mode);
    if (alias.game) store.set('games.initGame', alias.game);
    id = 'games';
    window.location.hash = '#/games';
    return;
  }

  store.set('currentView', id);

  const handler = ROUTES.get(id);
  if (handler) {
    handler();
  } else {
    console.warn(`[Router] 路由未注册: ${id}`);
  }

  eventBus.emit('route:change', id);
}

/**
 * 判断指定视图是否当前激活
 * @param {string} id
 * @returns {boolean}
 */
export function isActive(id) {
  return store.get('currentView') === id;
}

/**
 * 处理导航点击
 * @param {string} id
 */
export function handleNavClick(id) {
  go(id);
}

// 监听 hash 变化
window.addEventListener('hashchange', handleHashChange);

/**
 * 初始化路由
 * 无 hash 时置为 '#/games'；已有 hash 时立即处理一次
 */
export function initRouter() {
  if (!window.location.hash) {
    window.location.hash = '#/';
  } else {
    handleHashChange();
  }
}
