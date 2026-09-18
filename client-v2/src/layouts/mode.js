/**
 * 界面自定义（导航相关开关）
 * 两个独立开关，用户自由组合：
 * - topbar：是否显示顶部传统导航栏（默认开）
 * - account：账号入口形态 —— 'drawer' 全局抽屉（默认） | 'float' 悬浮头像
 *
 * 新手引导与「个人资料 → 界面设置」共用同一份偏好，改动即时生效。
 */
import { switchLayout, renderAccountBar, renderNavDrawer } from './registry.js';

const TOPBAR_KEY = 'nav-topbar';
const ACCOUNT_KEY = 'nav-account';

/** 读取当前偏好 */
export function getNavPrefs() {
  return {
    topbar: localStorage.getItem(TOPBAR_KEY) !== '0',
    account: localStorage.getItem(ACCOUNT_KEY) === 'float' ? 'float' : 'drawer',
  };
}

/**
 * 写入偏好并立即生效
 * @param {{topbar?: boolean, account?: 'drawer'|'float'}} patch - 只传要改的项
 */
export function setNavPrefs(patch) {
  if (patch.topbar !== undefined) localStorage.setItem(TOPBAR_KEY, patch.topbar ? '1' : '0');
  if (patch.account !== undefined) localStorage.setItem(ACCOUNT_KEY, patch.account === 'float' ? 'float' : 'drawer');
  applyNavMode();
}

/** 按当前偏好挂载界面（幂等：先拆掉上一套，再挂新的） */
export function applyNavMode() {
  const { topbar, account } = getNavPrefs();
  const navRoot = document.getElementById('nav-root');
  const accountRoot = document.getElementById('account-root');
  const drawerRoot = document.getElementById('drawer-root');

  // 拆掉上一套悬浮界面
  if (window._drawerCleanup) { window._drawerCleanup(); window._drawerCleanup = null; }
  if (window._accountCleanup) { window._accountCleanup(); window._accountCleanup = null; }
  if (accountRoot) accountRoot.innerHTML = '';
  if (drawerRoot) drawerRoot.innerHTML = '';

  document.body.classList.toggle('nav-topbar-off', !topbar);
  document.body.classList.toggle('nav-account-drawer', account === 'drawer');

  // 顶部导航栏（可关）：始终渲染，由 body 类控制显隐，切换时无需重建
  if (navRoot) switchLayout(localStorage.getItem('nav-layout') || 'topnav');

  // 账号入口：全局抽屉 or 悬浮头像
  if (account === 'drawer') {
    if (drawerRoot) window._drawerCleanup = renderNavDrawer(drawerRoot);
    return;
  }
  if (accountRoot) window._accountCleanup = renderAccountBar(accountRoot);
}
