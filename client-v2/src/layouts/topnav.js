/**
 * 顶部导航布局
 * 导航栏由 NAV_ITEMS 元数据驱动：统一游戏（1）+ 功能（若干）+ 旧版入口。
 * 点击按钮 → 路由切换；currentView 变化 → active 高亮同步。
 */
import { NAV_ITEMS } from '../data/navItems.js';
import { handleNavClick, isActive, go } from '../core/router.js';
import { store } from '../core/store.js';
import { isAdminAccount } from './shared.js';
import { el } from '../utils/dom.js';
import { api } from '../core/api.js';
import * as auth from '../core/auth.js';
import * as login from '../features/auth/login.js';
import { avatarNode } from '../utils/avatar.js';

/** 生成导航按钮 */
function navButton(item) {
  return el('button', {
    // mobileTab 的项在窄屏作为底部标签，其余项收进「更多」
    class: `nav-btn${item.mobileTab ? '' : ' nav-btn--more'}${isActive(item.id) ? ' active' : ''}`,
    'data-nav': item.id,
    onClick: () => handleNavClick(item.id),
  }, [
    el('span', { class: 'nav-btn__icon' }, item.icon),
    el('span', { class: 'nav-btn__name' }, item.name),
    el('span', { class: 'nav-btn__name-short' }, item.mobileName || item.name),
    item.shortcut ? el('sup', { class: 'nav-btn__shortcut' }, item.shortcut) : null,
    // 好友申请红点：数量由 store.friendRequestCount 驱动
    item.id === 'friends' ? el('span', { class: 'nav-btn__badge hidden' }) : null,
  ]);
}

/** 账号条位置在 localStorage 里的键名 */
const ACCOUNT_POS_KEY = 'accountBarPos';

/** 距视口边缘的最小间距，避免拖出屏幕外找不回来 */
const EDGE = 8;

/** 按住多久算长按（进入拖动） */
const LONG_PRESS_MS = 260;

/** 按住后位移超过这么多像素也算拖动（两种手势都能拖） */
const DRAG_TOLERANCE = 8;

/**
 * 账号条交互：点击展开/收起，长按拖动（位置记在 localStorage）
 * @param {HTMLElement} root - 定位容器（#account-root，position: fixed）
 * @param {HTMLElement} bar - 账号条本体
 * @param {Function} onToggle - 点击胶囊（非按钮处）时调用
 * @returns {Function} 清理函数
 */
function bindBarInteractions(root, bar, onToggle) {
  const clamp = (pos) => {
    const w = root.offsetWidth || 40;
    const h = root.offsetHeight || 40;
    return {
      r: Math.min(Math.max(EDGE, pos.r), Math.max(EDGE, window.innerWidth - w - EDGE)),
      t: Math.min(Math.max(EDGE, pos.t), Math.max(EDGE, window.innerHeight - h - EDGE)),
    };
  };

  let pos = { r: 12, t: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem(ACCOUNT_POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.r) && Number.isFinite(saved.t)) pos = saved;
  } catch { /* 本地数据损坏时用默认位置 */ }

  const apply = () => {
    root.style.right = `${pos.r}px`;
    root.style.top = `${pos.t}px`;
  };

  pos = clamp(pos);
  apply();

  let drag = null;    // 已进入拖动
  let press = null;   // 已按下，等长按计时器判定
  let swallowClick = false;  // 拖动结束后吞掉紧随而来的那次 click

  /** 进入拖动：起点取按下时的位置，避免指针跳动 */
  const beginDrag = (p) => {
    clearTimeout(p.timer);
    press = null;
    drag = { id: p.id, x: p.x, y: p.y, r: pos.r, t: pos.t };
    bar.classList.add('dragging');
  };

  const moveTo = (x, y) => {
    pos = clamp({ r: drag.r - (x - drag.x), t: drag.t + (y - drag.y) });
    apply();
  };

  const onMove = (e) => {
    if (drag) {
      if (e.pointerId === drag.id) moveTo(e.clientX, e.clientY);
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    // 按住后移动了：直接算拖动（不必等长按计时器）
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_TOLERANCE) {
      beginDrag(press);
      moveTo(e.clientX, e.clientY);
    }
  };

  const onUp = (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      bar.classList.remove('dragging');
      swallowClick = true;
      try {
        localStorage.setItem(ACCOUNT_POS_KEY, JSON.stringify(pos));
      } catch { /* 隐私模式下写不进去，忽略 */ }
      return;
    }
    if (!press || e.pointerId !== press.id) return;
    clearTimeout(press.timer);
    // 按下后没进入拖动、也没落在按钮上 → 展开/收起
    const isClick = !press.onButton;
    press = null;
    if (isClick) onToggle();
  };

  // 指针被系统/浏览器抢走（原生拖拽、手势等）：只清理状态，绝不能当成点击
  const onCancel = (e) => {
    if (drag && e.pointerId === drag.id) {
      drag = null;
      bar.classList.remove('dragging');
    }
    if (press && e.pointerId === press.id) {
      clearTimeout(press.timer);
      press = null;
    }
  };

  // 头像是 <img>，按住拖动会触发浏览器原生图片拖拽（拖出虚影并掐断 pointer 事件）
  const onDragStart = (e) => e.preventDefault();

  const onDown = (e) => {
    if (e.button !== 0 || !e.target.closest('.account-info')) return;
    swallowClick = false;
    const p = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      onButton: !!e.target.closest('button'),
    };
    p.timer = setTimeout(() => {
      // 长按：仍按原处按下且没被 upgrade 成拖动
      if (press === p) beginDrag(p);
    }, LONG_PRESS_MS);
    press = p;
  };

  // 拖动结束时按钮可能还会收到 click，这里把它吃掉，避免误触「退出」等按钮
  const onClickCapture = (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  const onDocDown = (e) => {
    if (!bar.contains(e.target)) onToggle(false);
  };

  const onResize = () => {
    pos = clamp(pos);
    apply();
  };

  bar.addEventListener('pointerdown', onDown);
  bar.addEventListener('click', onClickCapture, true);
  bar.addEventListener('dragstart', onDragStart);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('resize', onResize);
  document.addEventListener('pointerdown', onDocDown);

  return () => {
    bar.removeEventListener('pointerdown', onDown);
    bar.removeEventListener('click', onClickCapture, true);
    bar.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('pointerdown', onDocDown);
  };
}

/**
 * 顶部悬浮账号条
 * @param {HTMLElement} container - 挂载容器
 * @returns {Function} cleanup 函数
 */
export function renderAccountBar(container) {
  const bar = el('div', { class: 'account-bar' });

  /** 是否展开（点击展开，点击外部收起） */
  let expanded = false;

  const setExpanded = (v) => {
    expanded = typeof v === 'boolean' ? v : !expanded;
    bar.classList.toggle('expanded', expanded);
  };

  function render() {
    const user = store.get('user');
    const inner = user?.account?.account || null;
    const userId = inner?.id || localStorage.getItem('currentAccountId');
    bar.className = 'account-bar';
    bar.innerHTML = '';

    if (inner || userId) {
      bar.classList.add('collapsed');
      if (expanded) bar.classList.add('expanded');
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
      expanded = false;
      bar.append(
        el('button', { class: 'account-btn account-btn--primary', onClick: () => login.showLoginModal() }, '登录'),
        el('button', { class: 'account-btn account-btn--success', onClick: () => login.showRegisterModal() }, '注册'),
      );
    }
  }

  render();
  const unsubscribe = store.subscribe('user', render);
  container.append(bar);
  // 挂到 DOM 之后才量得到尺寸，用它校正并记住位置
  const stopInteractions = bindBarInteractions(container, bar, setExpanded);
  return () => { unsubscribe(); stopInteractions(); bar.remove(); };
}

/**
 * 渲染导航栏：桌面在顶部，窄屏由 CSS 变成底部标签栏（同一个元素，不会出现上下两套）
 * @param {HTMLElement} container - 挂载容器
 * @returns {Function} cleanup 函数
 */
export function renderTopNav(container) {
  // 入口统一来自 NAV_ITEMS：inProfile（并入个人资料）与 parent（归入某大类）的项不单独展示；
  // type='game' 里只有大厅入口 id='games' 进导航，其余单机游戏入口都在大厅内
  const topItems = NAV_ITEMS
    .filter((i) => !i.inProfile && !i.parent && (i.id === 'games' || i.type === 'feature'))
    .sort((a, b) => a.order - b.order);

  // 后台入口：默认隐藏，登录账号是管理员时才出现
  const adminBtn = el('a', {
    class: 'nav-btn nav-btn--admin hidden',
    href: '#/admin',
    title: '后台管理（仅管理员可见）',
  }, [
    el('span', { class: 'nav-btn__icon' }, '🛠️'),
    el('span', { class: 'nav-btn__name' }, '后台'),
  ]);

  const legacyLink = el('a', { class: 'nav-btn nav-btn--legacy', href: '/', title: '切换回旧版客户端' }, [
    el('span', { class: 'nav-btn__icon' }, '🕰️'),
    el('span', { class: 'nav-btn__name' }, '旧版'),
  ]);

  // ---- 「更多」：窄屏才显示，承载没进底部标签栏的入口 ----
  let sheetOpen = false;
  const sheet = el('div', { class: 'nav-sheet' });
  const sheetPanel = el('div', { class: 'nav-sheet__panel' });

  const sheetAdmin = el('button', {
    class: 'nav-sheet__item hidden',
    type: 'button',
    onClick: () => { setSheetOpen(false); go('admin'); },
  }, [
    el('span', { class: 'nav-sheet__icon' }, '🛠️'),
    el('span', { class: 'nav-sheet__name' }, '后台'),
  ]);

  const sheetItems = topItems.filter((i) => !i.mobileTab).map((item) => el('button', {
    class: 'nav-sheet__item',
    type: 'button',
    'data-nav': item.id,
    onClick: () => { setSheetOpen(false); handleNavClick(item.id); },
  }, [
    el('span', { class: 'nav-sheet__icon' }, item.icon),
    el('span', { class: 'nav-sheet__name' }, item.name),
  ]));

  const sheetLegacy = el('a', { class: 'nav-sheet__item', href: '/', title: '切换回旧版客户端' }, [
    el('span', { class: 'nav-sheet__icon' }, '🕰️'),
    el('span', { class: 'nav-sheet__name' }, '旧版'),
  ]);

  sheetPanel.append(...sheetItems, sheetAdmin, sheetLegacy);
  sheet.append(el('div', { class: 'nav-sheet__scrim', onClick: () => setSheetOpen(false) }), sheetPanel);

  const moreBtn = el('button', {
    class: 'nav-btn nav-more-btn',
    type: 'button',
    onClick: () => setSheetOpen(),
  }, [
    el('span', { class: 'nav-btn__icon' }, '⋯'),
    el('span', { class: 'nav-btn__name' }, '更多'),
    el('span', { class: 'nav-btn__name-short' }, '更多'),
  ]);

  function setSheetOpen(v) {
    sheetOpen = typeof v === 'boolean' ? v : !sheetOpen;
    sheet.classList.toggle('open', sheetOpen);
    moreBtn.classList.toggle('active', sheetOpen);
  }

  container.append(
    ...topItems.map(navButton),
    el('div', { class: 'nav-divider' }),
    adminBtn,
    el('div', { class: 'nav-divider' }),
    legacyLink,
    moreBtn,
    sheet,
  );

  const syncAdminBtn = () => {
    const isAdmin = isAdminAccount();
    adminBtn.classList.toggle('hidden', !isAdmin);
    sheetAdmin.classList.toggle('hidden', !isAdmin);
  };
  syncAdminBtn();
  const unsubscribeAdmin = store.subscribe('user', syncAdminBtn);

  const buttons = Array.from(container.querySelectorAll('[data-nav]'));

  // 好友申请红点：有待处理申请时亮起，处理完自动消失
  const friendBadge = container.querySelector('[data-nav="friends"] .nav-btn__badge');
  const unsubscribeBadge = store.subscribe('friendRequestCount', (count) => {
    if (!friendBadge) return;
    const n = Number(count) || 0;
    friendBadge.textContent = n > 9 ? '9+' : String(n);
    friendBadge.classList.toggle('hidden', n <= 0);
  });

  const unsubscribe = store.subscribe('currentView', (view) => {
    buttons.forEach((btn) => btn.classList.toggle('active', btn.dataset.nav === view));
  });

  return () => {
    unsubscribe();
    unsubscribeBadge();
    unsubscribeAdmin();
    container.innerHTML = '';
  };
}
