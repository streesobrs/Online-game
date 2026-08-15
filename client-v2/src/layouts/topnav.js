/**
 * 顶部导航布局
 * 导航栏由 NAV_ITEMS 元数据驱动：统一游戏（1）+ 功能（若干）+ 旧版入口。
 * 点击按钮 → 路由切换；currentView 变化 → active 高亮同步。
 */
import { FEATURES } from '../data/navItems.js';
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
 * 顶部悬浮账号条
 * @param {HTMLElement} container - 挂载容器
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
        avatarNode(userId, 32),
        details,
      ]);
      const buttons = el('div', { class: 'account-buttons' }, [
        el('button', { class: 'account-btn account-btn--info', onClick: () => go('profile') }, '👤 资料'),
        el('button', { class: 'account-btn', onClick: () => go('games') }, '🎮 游戏'),
        el('button', { class: 'account-btn account-btn--danger', onClick: () => auth.logout() }, '退出'),
      ]);
      bar.append(el('div', { class: 'account-info' }, [userSection, buttons]));

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
  // GAMES 现在是游戏元数据（非导航项），需映射回导航项
  // 使用 FEATURES 中的第一个导航项 'games' 作为入口
  const gamesNav = { id: 'games', name: '游戏', icon: '🎮', shortcut: 'G' };

  container.append(
    el('div', { class: 'nav-group nav-group--games' }, navButton(gamesNav)),
    el('div', { class: 'nav-divider' }),
    // 已迁移进个人资料页的模块（成就/商城/主题/快捷键）不再出现在导航栏
    el('div', { class: 'nav-group nav-group--features' }, FEATURES.filter((i) => !i.inProfile).map(navButton)),
    el('div', { class: 'nav-divider' }),
    el('a', { class: 'nav-btn nav-btn--legacy', href: '/', title: '切换回旧版客户端' }, [
      el('span', { class: 'nav-btn__icon' }, '🕰️'),
      el('span', { class: 'nav-btn__name' }, '旧版'),
    ])
  );

  const buttons = Array.from(container.querySelectorAll('[data-nav]'));

  const unsubscribe = store.subscribe('currentView', (view) => {
    buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === view));
  });

  return () => {
    unsubscribe();
    container.innerHTML = '';
  };
}
