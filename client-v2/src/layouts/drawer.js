/**
 * 全局抽屉布局（界面形态：drawer）
 * 右侧贴边把手（半露头像，可上下拖动并记忆位置）→ 点开滑出面板。
 * 面板内容 = 账号信息 + 导航快捷入口，用来替代右上角的悬浮账号条（传统导航栏保留）。
 */
import { FEATURES } from '../data/navItems.js';
import { handleNavClick, isActive, go } from '../core/router.js';
import { store } from '../core/store.js';
import { el } from '../utils/dom.js';
import { api } from '../core/api.js';
import * as auth from '../core/auth.js';
import * as login from '../features/auth/login.js';
import { avatarNode } from '../utils/avatar.js';

/** 把手纵向位置（px）的存储键 */
const HANDLE_TOP_KEY = 'navDrawerHandleTop';

/** 把手距视口上/下边缘的最小间距 */
const EDGE = 12;

/** 位移超过这么多像素才算拖动（否则当成点击） */
const DRAG_TOLERANCE = 6;

/** 默认纵向位置：视口高度的 38% 处 */
const DEFAULT_TOP_RATIO = 0.38;

/**
 * 渲染全局抽屉
 * @param {HTMLElement} container - 挂载容器（#drawer-root，position: fixed 覆盖全屏）
 * @returns {Function} cleanup 函数
 */
export function renderNavDrawer(container) {
  const root = el('div', { class: 'nav-drawer' });
  const scrim = el('div', { class: 'nav-drawer-scrim' });
  const handle = el('button', { class: 'nav-drawer-handle', type: 'button', title: '打开菜单' });
  const panel = el('aside', { class: 'nav-drawer-panel' });

  /** 是否展开 */
  let open = false;

  const setOpen = (v) => {
    open = typeof v === 'boolean' ? v : !open;
    root.classList.toggle('open', open);
    handle.setAttribute('title', open ? '收起菜单' : '打开菜单');
  };

  /** 当前登录用户 id（与账号条取法保持一致） */
  function currentUserId() {
    const user = store.get('user');
    return user?.account?.account?.id || localStorage.getItem('currentAccountId') || null;
  }

  // ---- 把手 ----
  function renderHandle() {
    const userId = currentUserId();
    handle.innerHTML = '';
    handle.append(
      avatarNode(userId, 28),
      el('span', { class: 'nav-drawer-handle__chevron' }, '‹'),
    );
  }

  // ---- 面板：账号区 ----
  function buildAccount(userId) {
    if (!userId) {
      return el('div', { class: 'nav-drawer-account guest' }, [
        el('div', { class: 'nav-drawer-guest-text' }, '登录后可使用好友、聊天、排行榜等功能'),
        el('div', { class: 'nav-drawer-actions' }, [
          el('button', { class: 'account-btn account-btn--primary', onClick: () => { setOpen(false); login.showLoginModal(); } }, '登录'),
          el('button', { class: 'account-btn account-btn--success', onClick: () => { setOpen(false); login.showRegisterModal(); } }, '注册'),
        ]),
      ]);
    }

    const inner = store.get('user')?.account?.account || null;
    const nickname = inner?.nickname || inner?.username || '玩家';
    const levelEl = el('span', { class: 'account-level' }, 'Lv…');
    const expEl = el('span', { class: 'account-exp' }, '… EXP');
    const coinEl = el('span', { class: 'account-starcoins' }, '💎 …');

    api.profile.get(userId)
      .then((res) => {
        const d = res?.data;
        if (!d) return;
        levelEl.textContent = `Lv.${d.profile?.level ?? 1}`;
        expEl.textContent = `${d.profile?.exp ?? 0} EXP`;
        coinEl.textContent = `💎 ${d.currency ?? 0}`;
      })
      .catch(() => { });

    return el('div', { class: 'nav-drawer-account' }, [
      el('div', { class: 'nav-drawer-user' }, [
        avatarNode(userId, 44),
        el('div', { class: 'nav-drawer-user-info' }, [
          el('div', { class: 'account-nickname', title: nickname }, nickname),
          el('div', { class: 'account-stats' }, [levelEl, expEl, coinEl]),
        ]),
      ]),
      el('div', { class: 'nav-drawer-actions' }, [
        el('button', { class: 'account-btn account-btn--info', onClick: () => { setOpen(false); go('profile'); } }, '👤 个人资料'),
        el('button', { class: 'account-btn account-btn--danger', onClick: () => { setOpen(false); auth.logout(); } }, '退出登录'),
      ]),
    ]);
  }

  // ---- 面板：主导航 ----
  function buildNav() {
    const items = [{ id: 'games', name: '游戏', icon: '🎮' }, ...FEATURES.filter((i) => !i.inProfile)];
    return items.map((item) => el('button', {
      class: `nav-drawer-item${isActive(item.id) ? ' active' : ''}`,
      'data-nav': item.id,
      type: 'button',
      onClick: () => { setOpen(false); handleNavClick(item.id); },
    }, [
      el('span', { class: 'nav-drawer-item__icon' }, item.icon),
      el('span', { class: 'nav-drawer-item__name' }, item.name),
      // 好友申请红点：数量由 store.friendRequestCount 驱动
      item.id === 'friends' ? el('span', { class: 'nav-drawer-item__badge hidden' }) : null,
    ]));
  }

  /** 好友申请红点：有待处理申请时亮起 */
  function updateFriendBadge(count) {
    const badge = panel.querySelector('[data-nav="friends"] .nav-drawer-item__badge');
    if (!badge) return;
    const n = Number(count) || 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.classList.toggle('hidden', n <= 0);
  }

  /** 整体重渲染面板 */
  function renderPanel() {
    panel.innerHTML = '';
    panel.append(
      el('div', { class: 'nav-drawer-head' }, [
        el('span', { class: 'nav-drawer-title' }, '菜单'),
        el('button', { class: 'nav-drawer-close', type: 'button', title: '收起', onClick: () => setOpen(false) }, '✕'),
      ]),
      buildAccount(currentUserId()),
      el('div', { class: 'nav-drawer-section' }, [
        el('div', { class: 'nav-drawer-section-title' }, '导航'),
        el('div', { class: 'nav-drawer-list' }, buildNav()),
      ]),
      el('a', { class: 'nav-drawer-legacy', href: '/', title: '切换回旧版客户端' }, '🕰️ 返回旧版客户端'),
    );
    // 导航项是重建的，重建后按当前申请数补齐红点
    updateFriendBadge(store.get('friendRequestCount'));
  }

  // ---- 把手拖动：沿右边缘上下移动，位置记忆 ----
  let top = 0;
  let drag = null;
  let moved = false;

  const clampTop = (v) => {
    const h = handle.offsetHeight || 64;
    return Math.min(Math.max(EDGE, v), Math.max(EDGE, window.innerHeight - h - EDGE));
  };

  const applyTop = () => { handle.style.top = `${top}px`; };

  /** 恢复上次位置（首次进入默认落在视口中部偏上） */
  function initTop() {
    const saved = Number(localStorage.getItem(HANDLE_TOP_KEY));
    top = Number.isFinite(saved) && saved > 0 ? saved : Math.round(window.innerHeight * DEFAULT_TOP_RATIO);
    top = clampTop(top);
    applyTop();
  }

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    drag = { id: e.pointerId, y: e.clientY, start: top };
    moved = false;
    try { handle.setPointerCapture(e.pointerId); } catch { /* 捕获失败也不影响拖动 */ }
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y;
    if (!moved && Math.abs(dy) < DRAG_TOLERANCE) return;
    moved = true;
    handle.classList.add('dragging');
    top = clampTop(drag.start + dy);
    applyTop();
  };

  const onPointerUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    if (moved) {
      handle.classList.remove('dragging');
      try { localStorage.setItem(HANDLE_TOP_KEY, String(Math.round(top))); } catch { /* 隐私模式忽略 */ }
    } else {
      setOpen(); // 没移动 = 点击，展开/收起
    }
  };

  const onPointerCancel = () => {
    if (!drag) return;
    drag = null;
    handle.classList.remove('dragging');
  };

  // 把手里的头像是 <img>，禁用浏览器原生图片拖拽，否则会拖出虚影并掐断指针事件
  const onDragStart = (e) => e.preventDefault();

  const onResize = () => {
    top = clampTop(top);
    applyTop();
  };

  scrim.addEventListener('click', () => setOpen(false));

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerCancel);
  handle.addEventListener('dragstart', onDragStart);
  window.addEventListener('resize', onResize);

  renderHandle();
  renderPanel();
  root.append(scrim, panel, handle);
  container.append(root);
  // 挂到 DOM 之后才量得到尺寸，用它校正并记住位置
  initTop();

  const unsubscribeUser = store.subscribe('user', () => {
    renderHandle();
    renderPanel();
  });

  const unsubscribeView = store.subscribe('currentView', (view) => {
    panel.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.nav === view);
    });
  });

  // 好友申请红点：有待处理申请时亮起，处理完自动消失
  const unsubscribeBadge = store.subscribe('friendRequestCount', updateFriendBadge);

  return () => {
    unsubscribeUser();
    unsubscribeView();
    unsubscribeBadge();
    handle.removeEventListener('pointerdown', onPointerDown);
    handle.removeEventListener('pointermove', onPointerMove);
    handle.removeEventListener('pointerup', onPointerUp);
    handle.removeEventListener('pointercancel', onPointerCancel);
    handle.removeEventListener('dragstart', onDragStart);
    window.removeEventListener('resize', onResize);
    root.remove();
  };
}
