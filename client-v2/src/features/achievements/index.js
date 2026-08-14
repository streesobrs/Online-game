/**
 * 成就模块（任务 4.2.1）
 * 复刻 v1 成就页：顶部总进度、分类标签、成就卡片（解锁/未解锁/进度/奖励）。
 * 协议：get_achievements → achievements_list { categories, userAchievements, totalAchievements }
 */
import { eventBus } from '../../core/eventBus.js';
import { emit } from '../../core/socket.js';
import { el, viewRoot } from '../../utils/dom.js';
import { modal } from '../../components/modal.js';

const GAME_ORDER = ['gobang', 'chinese-chess', 'go', 'snake'];
const GAME_CONFIG = {
  gobang: { name: '五子棋成就', icon: '⚫', displayName: '五子棋' },
  'chinese-chess': { name: '象棋成就', icon: '♟️', displayName: '象棋' },
  go: { name: '围棋成就', icon: '⚫', displayName: '围棋' },
  snake: { name: '贪吃蛇成就', icon: '🐍', displayName: '贪吃蛇' },
};
const BASE_CATEGORY_CONFIG = {
  game: { name: '胜利成就', icon: '🏆', displayName: '胜利成就' },
  level: { name: '等级成就', icon: '📈', displayName: '等级成就' },
  streak: { name: '连胜成就', icon: '🔥', displayName: '连胜成就' },
  ai: { name: 'AI对战成就', icon: '🤖', displayName: 'AI对战' },
  creative: { name: '特殊成就', icon: '✨', displayName: '特殊成就' },
};

/**
 * 重组服务端分类：game_type 按 condition.gameType 拆分到各游戏分类（对齐 v1），
 * 并在最前面追加「全部成就」分类（任务 4.2.2 分类筛选总览）
 */
function reorganize(data) {
  const unlockedIds = Array.isArray(data.userAchievements) ? data.userAchievements : [];
  const totalAchievements = data.totalAchievements || 0;
  const unlockedCount = unlockedIds.length;
  const progressPercent = totalAchievements > 0 ? Math.round((unlockedCount / totalAchievements) * 100) : 0;

  const gameTypeGroups = {};
  const catTabs = [];

  Object.entries(data.categories).forEach(([type, category]) => {
    if (type === 'game_type') {
      (category.achievements || []).forEach((ach) => {
        const gt = ach.condition && ach.condition.gameType;
        if (gt) {
          if (!gameTypeGroups[gt]) gameTypeGroups[gt] = [];
          gameTypeGroups[gt].push(ach);
        }
      });
    } else {
      const cfg = BASE_CATEGORY_CONFIG[type] || { name: category.name, icon: '🎯', displayName: category.name };
      catTabs.push({
        type,
        name: `${cfg.icon} ${cfg.displayName}`,
        fullName: cfg.name,
        achievements: category.achievements || [],
      });
    }
  });

  GAME_ORDER.forEach((gt) => {
    if (gameTypeGroups[gt] && gameTypeGroups[gt].length > 0) {
      const cfg = GAME_CONFIG[gt];
      catTabs.push({ type: gt, name: `${cfg.icon} ${cfg.displayName}`, fullName: cfg.name, achievements: gameTypeGroups[gt] });
    }
  });

  // 全部成就（汇总去重，置顶）
  const all = { type: 'all', name: '🏅 全部成就', fullName: '全部成就', achievements: [] };
  const seen = new Set();
  catTabs.forEach((t) => t.achievements.forEach((a) => {
    if (!seen.has(a.id)) { seen.add(a.id); all.achievements.push(a); }
  }));
  catTabs.unshift(all);

  catTabs.forEach((t) => {
    t.unlocked = t.achievements.filter((a) => unlockedIds.includes(a.id)).length;
    t.total = t.achievements.length;
  });

  return { catTabs, unlockedIds, unlockedCount, totalAchievements, progressPercent };
}

/** 成就卡片 DOM */
function card(ach, unlocked) {
  const progress = ach.progress && ach.progress.target
    ? el('div', { class: 'ach-card-progress' }, [
      el('div', { class: 'prog-label' }, [
        el('span', {}, '进度'),
        el('span', {}, `${unlocked ? ach.progress.target : ach.progress.current}/${ach.progress.target}`),
      ]),
      el('div', { class: 'prog-bar' }, [
        el('div', {
          class: 'prog-bar-fill',
          style: `width:${unlocked ? 100 : (ach.progress.percent || 0)}%;`,
        }),
      ]),
    ])
    : null;

  return el('div', { class: `ach-card ${unlocked ? 'unlocked' : 'locked'}` }, [
    el('div', { class: 'ach-card-top' }, [
      el('div', { class: 'ach-icon-box' }, unlocked ? '🏆' : '🔒'),
      el('div', { class: 'ach-card-name' }, ach.name),
    ]),
    el('div', { class: 'ach-card-desc' }, ach.description || ''),
    progress,
    el('div', { class: 'ach-card-footer' }, [
      el('span', { class: `ach-status-tag ${unlocked ? 'unlocked' : 'locked'}` }, unlocked ? '✓ 已解锁' : '○ 未解锁'),
      ach.reward ? el('span', { class: 'ach-exp-tag' }, `+${ach.reward.exp} EXP`) : null,
    ]),
  ]);
}

/** 当前活跃的成就视图（供解锁后自动刷新列表） */
const achievementsViews = new Set();

/**
 * 模块级常驻：成就解锁通知（任务 4.2.2，对齐 v1 showAchievementUnlockModal）
 * 对局/任务结算后服务端发 achievements_unlocked { achievements: [...] }，任意视图弹窗展示。
 */
eventBus.on('achievement:unlocked', (data) => {
  const list = Array.isArray(data.achievements) ? data.achievements : [];
  if (list.length === 0) return;
  const contentEl = el('div', { class: 'ach-unlock-content' }, [
    el('div', { class: 'ach-unlock-item', 'data-head': '' }, [
      el('div', { class: 'ach-unlock-item-icon' }, '🎉'),
      el('div', {}, [
        el('div', { class: 'ach-unlock-item-name' }, `恭喜解锁 ${list.length} 个成就！`),
        el('div', { class: 'ach-unlock-item-desc' }, '成就已同步，可在成就页查看'),
      ]),
    ]),
    ...list.map((ach) =>
      el('div', { class: 'ach-unlock-item' }, [
        el('div', { class: 'ach-unlock-item-icon' }, '🏆'),
        el('div', {}, [
          el('div', { class: 'ach-unlock-item-name' }, ach.name),
          el('div', { class: 'ach-unlock-item-desc' }, ach.description || ''),
          ach.reward ? el('div', { class: 'ach-unlock-item-exp' }, `+${ach.reward.exp} EXP`) : null,
        ]),
      ])
    ),
  ]);
  modal.show({ title: '🏆 成就解锁', content: contentEl, confirmText: '太棒了', showCancel: false });

  // 成就列表视图活跃时自动刷新（解锁后列表即时更新，无需手动刷新）
  if (achievementsViews.size > 0) {
    setTimeout(() => emit('get_achievements'), 600);
  }
});

/**
 * 渲染成就视图（路由 #/achievements）
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderAchievements(container = viewRoot()) {
  let achData = null;
  let activeTabId = null;

  const overviewEl = el('div', { class: 'ach-overview' });
  const tabsEl = el('div', { class: 'ach-tabs' });
  const contentEl = el('div', { class: 'ach-scroll' });

  container.innerHTML = '';
  container.append(
    el('div', { class: 'achievements-page' }, [
      el('div', { class: 'ach-page-title' }, '🏆 成就'),
      overviewEl,
      tabsEl,
      contentEl,
    ])
  );

  function renderTab(tabId) {
    if (!achData) return;
    const tab = achData.catTabs.find((t) => t.id === tabId) || achData.catTabs[0];
    if (!tab) return;
    activeTabId = tab.id;

    tabsEl.querySelectorAll('.ach-tab').forEach((elNode) => elNode.classList.toggle('active', elNode.dataset.tab === activeTabId));

    contentEl.innerHTML = '';
    contentEl.append(
      el('div', { class: 'ach-category' }, [
        el('div', { class: 'ach-category-header' }, [
          el('span', { class: 'cat-name' }, tab.fullName),
          el('span', { class: 'cat-progress' }, `${tab.unlocked}/${tab.total} 已解锁`),
        ]),
        el('div', { class: 'ach-grid' }, tab.achievements.map((a) => card(a, achData.unlockedIds.includes(a.id)))),
      ])
    );
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    achData.catTabs.forEach((t, idx) => {
      const tabEl = el('div', {
        class: `ach-tab${idx === 0 ? ' active' : ''}`,
        'data-tab': t.id,
        onClick: () => renderTab(t.id),
      }, [
        el('span', {}, t.name),
        el('span', { class: 'tab-count' }, `${t.unlocked}/${t.total}`),
      ]);
      tabsEl.append(tabEl);
    });
  }

  function renderOverview() {
    overviewEl.innerHTML = '';
    overviewEl.append(
      el('div', { class: 'ach-overview-top' }, [
        el('span', { class: 'title' }, '成就进度'),
        el('span', { class: 'count' }, `${achData.unlockedCount}/${achData.totalAchievements}`),
      ]),
      el('div', { class: 'ach-overview-bar' }, [
        el('div', { class: 'ach-overview-bar-fill', style: `width:${achData.progressPercent}%;` }),
      ]),
      el('div', { class: 'ach-overview-pct' }, `已完成 ${achData.progressPercent}%`)
    );
  }

  function applyData(data) {
    achData = reorganize(data);
    achData.catTabs.forEach((t, idx) => { t.id = `cat-${idx}`; });
    renderOverview();
    renderTabs();
    renderTab(activeTabId || achData.catTabs[0].id);
  }

  // 未登录提示
  if (!localStorage.getItem('currentAccountId')) {
    contentEl.innerHTML = '<div class="ach-empty">请先登录查看成就</div>';
    return () => { container.innerHTML = ''; };
  }

  // 注册为活跃视图（解锁后自动刷新列表）
  achievementsViews.add(container);

  // 请求成就列表；socket 未连接时 emit 会丢弃，连接后补拉
  function load() { emit('get_achievements'); }
  load();
  const offList = eventBus.on('achievement:list', (data) => {
    if (data && data.categories) applyData(data);
  });
  const offConnect = eventBus.on('socket:connect', load);

  return () => {
    achievementsViews.delete(container);
    offList();
    offConnect();
    container.innerHTML = '';
  };
}
