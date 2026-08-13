/**
 * 顶部导航布局
 * 导航栏由 NAV_ITEMS 元数据驱动：左侧游戏（4）+ 分隔线 + 右侧功能（6）。
 * 点击按钮 → 路由切换；currentView 变化 → active 高亮同步。
 * 参照开发文档第十章 10.3。
 */
import { GAMES, FEATURES } from '../data/navItems.js';
import { handleNavClick, isActive } from '../core/router.js';
import { store } from '../core/store.js';
import { el } from '../utils/dom.js';

/** 生成导航按钮 */
function navButton(item) {
  return el('button', {
    class: `nav-btn${isActive(item.id) ? ' active' : ''}`,
    'data-nav': item.id,
    onClick: () => handleNavClick(item.id),
  }, [
    el('span', { class: 'nav-btn__icon' }, item.icon),
    el('span', { class: 'nav-btn__name' }, item.name),
    item.shortcut ? el('sup', { class: 'nav-btn__shortcut' }, item.shortcut) : null,
  ]);
}

/**
 * 渲染顶部导航布局
 * @param {HTMLElement} container - 挂载容器
 * @returns {Function} cleanup 函数
 */
export function renderTopNav(container) {
  container.append(
    el('div', { class: 'nav-group nav-group--games' }, GAMES.map(navButton)),
    el('div', { class: 'nav-divider' }),
    el('div', { class: 'nav-group nav-group--features' }, FEATURES.map(navButton))
  );

  const buttons = Array.from(container.querySelectorAll('[data-nav]'));

  // 订阅状态变化，更新 active（路由切换/快捷键触发均会同步）
  const unsubscribe = store.subscribe('currentView', (view) => {
    buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === view));
  });

  // 返回 cleanup：取消订阅 + 销毁 DOM（按钮事件监听随元素销毁自动释放）
  return () => {
    unsubscribe();
    container.innerHTML = '';
  };
}
