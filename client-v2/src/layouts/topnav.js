/**
 * 顶部导航布局
 * 导航栏由 NAV_ITEMS 元数据驱动：左侧游戏（4）+ 分隔线 + 右侧功能（6）。
 * 点击按钮 → 路由切换；currentView 变化 → active 高亮同步。
 * 参照开发文档第十章 10.3。
 */
import { GAMES, FEATURES } from '../data/navItems.js';
import { handleNavClick, isActive, go } from '../core/router.js';
import { store } from '../core/store.js';
import { el } from '../utils/dom.js';
import { api } from '../core/api.js';
import * as auth from '../core/auth.js';
import * as login from '../features/auth/login.js';
import { avatarNode } from '../utils/avatar.js';

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
 * 顶部悬浮账号条（复刻 v1 account-bar，功能补齐 5.3.2）
 * - 未登录：顶部居中「登录」「注册」按钮
 * - 已登录：右上角收起为小头像卡片（半透明），hover 展开完整账号信息（头像/昵称/Lv/EXP/💎 + 资料/历史/退出）
 * 挂载到独立 #account-root，与导航布局解耦；store.user 变化时重渲染。
 * @param {HTMLElement} container - 挂载容器（#account-root）
 * @returns {Function} cleanup 函数
 */
export function renderAccountBar(container) {
  const bar = el('div', { class: 'account-bar' });

  function render() {
    const user = store.get('user');
    const inner = user?.account?.account || null;
    const userId = inner?.id || localStorage.getItem('currentAccountId');
    bar.className = 'account-bar';
    bar.innerHTML = '';

    if (inner || userId) {
      bar.classList.add('collapsed');
      const nickname = inner?.nickname || inner?.username || '玩家';

      const details = el('div', { class: 'account-user-details' }, [
        el('span', { class: 'account-nickname', title: nickname }, nickname),
        el('div', { class: 'account-stats' }, [
          el('span', { class: 'account-level' }, 'Lv…'),
          el('span', { class: 'account-exp' }, '… EXP'),
          el('span', { class: 'account-starcoins' }, '💎 …'),
        ]),
      ]);
      const userSection = el('div', { class: 'account-user-section' }, [
        avatarNode(userId, 40),
        details,
      ]);
      const buttons = el('div', { class: 'account-buttons' }, [
        el('button', { class: 'account-btn account-btn--info', onClick: () => go('profile') }, '👤 资料'),
        el('button', { class: 'account-btn', onClick: () => go('profile') }, '📜 历史'),
        el('button', { class: 'account-btn account-btn--danger', onClick: () => auth.logout() }, '退出'),
      ]);
      bar.append(el('div', { class: 'account-info' }, [userSection, buttons]));

      // 异步加载等级/经验/货币，填充占位
      api.profile.get(userId)
        .then((res) => {
          const d = res?.data;
          if (!d) return;
          const lv = d.profile?.level ?? 1;
          const exp = d.profile?.exp ?? 0;
          const levelEl = bar.querySelector('.account-level');
          const expEl = bar.querySelector('.account-exp');
          const coinsEl = bar.querySelector('.account-starcoins');
          if (levelEl) levelEl.textContent = `Lv.${lv}`;
          if (expEl) expEl.textContent = `${exp} EXP`;
          if (coinsEl) coinsEl.textContent = `💎 ${d.currency ?? 0}`;
        })
        .catch(() => { });
    } else {
      bar.append(
        el('button', { class: 'account-btn account-btn--primary', onClick: () => login.showLoginModal() }, '登录'),
        el('button', { class: 'account-btn account-btn--success', onClick: () => login.showRegisterModal() }, '注册'),
      );
    }
  }

  render();
  const unsubscribe = store.subscribe('user', render);
  container.append(bar);
  return () => { unsubscribe(); bar.remove(); };
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
    el('div', { class: 'nav-group nav-group--features' }, FEATURES.map(navButton)),
    el('div', { class: 'nav-divider' }),
    el('a', { class: 'nav-btn nav-btn--legacy', href: '/', title: '切换回旧版客户端' }, [
      el('span', { class: 'nav-btn__icon' }, '🕰️'),
      el('span', { class: 'nav-btn__name' }, '旧版'),
    ])
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
