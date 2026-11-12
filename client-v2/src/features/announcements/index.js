/**
 * 公告中心（路由 #/announcements）
 * 展示管理员发布的公告：置顶优先、按发布时间倒序，支持按类型筛选与展开全文。
 * 数据来源：GET /api/announcements；管理员发布后服务端广播 announcements_updated 实时刷新。
 */
import { el, viewRoot } from '../../utils/dom.js';
import { mdToHtml } from '../../utils/md.js';
import { api } from '../../core/api.js';
import { eventBus } from '../../core/eventBus.js';
import { go } from '../../core/router.js';

const TYPE_CONFIG = {
  notice: { label: '公告', icon: '📢', cls: 'type-notice' },
  update: { label: '更新', icon: '🔄', cls: 'type-update' },
  event: { label: '活动', icon: '🎉', cls: 'type-event' },
  maintenance: { label: '维护', icon: '🔧', cls: 'type-maintenance' },
};

const TABS = [
  { id: 'all', label: '全部' },
  ...Object.entries(TYPE_CONFIG).map(([id, cfg]) => ({ id, label: `${cfg.icon} ${cfg.label}` })),
];

function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString('zh-CN', {
    year: sameYear ? undefined : 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 渲染公告中心
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderAnnouncements(container = viewRoot()) {
  let announcements = [];
  let activeType = 'all';
  const expanded = new Set();
  let loading = true;
  let loadError = '';

  const tabsEl = el('div', { class: 'announcements-tabs' });
  const listEl = el('div', { class: 'announcements-list' });

  const pageEl = el('div', { class: 'announcements-page' }, [
    el('header', { class: 'announcements-head' }, [
      el('button', {
        class: 'page-back-btn',
        type: 'button',
        onClick: () => go('games'),
      }, '← 返回游戏'),
      el('div', { class: 'announcements-head-text' }, [
        el('h1', { class: 'announcements-title' }, '📢 公告中心'),
        el('p', { class: 'announcements-subtitle' }, '游戏更新、活动与维护安排都会在这里发布'),
      ]),
    ]),
    tabsEl,
    listEl,
  ]);

  container.innerHTML = '';
  container.append(pageEl);

  function renderTabs() {
    tabsEl.innerHTML = '';
    TABS.forEach((tab) => {
      tabsEl.append(el('button', {
        class: `announcements-tab${tab.id === activeType ? ' active' : ''}`,
        type: 'button',
        onClick: () => {
          activeType = tab.id;
          renderTabs();
          renderList();
        },
      }, tab.label));
    });
  }

  function renderCard(item) {
    const type = TYPE_CONFIG[item.type] || TYPE_CONFIG.notice;
    const isExpanded = expanded.has(item.id);
    const content = String(item.content || '');
    const canToggle = content.length > 140;

    const contentEl = el('div', {
      class: `announcement-content markdown-body${isExpanded ? ' expanded' : ''}`,
    });
    contentEl.innerHTML = mdToHtml(content);

    return el('article', { class: `announcement-card${item.pinned ? ' is-pinned' : ''}` }, [
      el('div', { class: 'announcement-card-head' }, [
        el('div', { class: 'announcement-badges' }, [
          item.pinned ? el('span', { class: 'announcement-badge is-pinned' }, '📌 置顶') : null,
          el('span', { class: `announcement-badge ${type.cls}` }, `${type.icon} ${type.label}`),
        ]),
        el('span', { class: 'announcement-time' }, formatTime(item.createdAt)),
      ]),
      el('h2', { class: 'announcement-title' }, item.title || '（无标题）'),
      contentEl,
      el('div', { class: 'announcement-card-foot' }, [
        el('span', { class: 'announcement-author' }, '发布者：管理员'),
        canToggle
          ? el('button', {
            class: 'announcement-toggle',
            type: 'button',
            onClick: () => {
              if (expanded.has(item.id)) expanded.delete(item.id);
              else expanded.add(item.id);
              contentEl.classList.toggle('expanded', expanded.has(item.id));
            },
          }, isExpanded ? '收起' : '展开全文')
          : null,
      ]),
    ]);
  }

  function renderList() {
    listEl.innerHTML = '';

    if (loading) {
      listEl.append(el('div', { class: 'announcements-empty' }, '📥 正在加载公告...'));
      return;
    }

    if (loadError) {
      listEl.append(el('div', { class: 'announcements-empty' }, `加载失败：${loadError}`));
      return;
    }

    const filtered = activeType === 'all'
      ? announcements
      : announcements.filter((item) => item.type === activeType);

    if (!filtered.length) {
      listEl.append(el('div', { class: 'announcements-empty' }, '暂无公告'));
      return;
    }

    filtered.forEach((item) => listEl.append(renderCard(item)));
  }

  async function load() {
    loading = true;
    loadError = '';
    renderList();
    try {
      const res = await api.announcements.list();
      announcements = Array.isArray(res?.data) ? res.data : [];
    } catch (err) {
      loadError = err.message || '请稍后重试';
    } finally {
      loading = false;
      renderList();
    }
  }

  renderTabs();
  load();

  // 管理员发布/编辑/删除后，服务端广播最新列表
  const offUpdated = eventBus.on('announcements:updated', (data) => {
    if (!Array.isArray(data?.announcements)) return;
    announcements = data.announcements;
    loadError = '';
    loading = false;
    renderList();
  });

  return () => {
    offUpdated();
    container.innerHTML = '';
  };
}
