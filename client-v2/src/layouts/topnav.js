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
