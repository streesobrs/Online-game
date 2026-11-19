/**
 * 主题切换功能
 * 机制与 v1 一致：body[data-theme="xxx"] 触发 CSS 变量作用域换肤 + 动态加载主题 CSS。
 * 主题元数据与 CSS 统一由服务端提供（GET /api/themes → server/config/themes/*.json|*.css），
 * v1/v2 共用同一份主题，新增/修改主题只需维护服务端，不再两边各存一份。
 * 持久化 key：selectedTheme（与 v1 完全一致，v1/v2 切换共享主题选择）。
 */
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { api } from '../../core/api.js';

const THEME_KEY = 'selectedTheme';

/** 默认主题：无独立 CSS，变量定义在 variables.css */
const DEFAULT_THEME = {
  id: 'default',
  name: '默认',
  icon: '🌞',
  description: '明亮简洁，经典蓝调',
  preview: '#3498db',
  cssUrl: '',
};

/** 卡片图标是 v2 展示用的装饰，服务端主题元数据不包含该字段 */
const THEME_ICONS = { cyberpunk: '🌃', forest: '🌲', ocean: '🌊' };

let themes = [DEFAULT_THEME];
let currentThemeId = 'default';
let loadingPromise = null;
const cssCache = new Map(); // cssUrl → css 文本缓存

function getTheme(id) {
  return themes.find((t) => t.id === id);
}

/** 把服务端主题元数据转换成卡片所需的展示字段 */
function normalizeTheme(meta, fallbackId) {
  const id = meta.id || fallbackId;
  return {
    id,
    name: meta.name || id,
    icon: THEME_ICONS[id] || '🎨',
    description: meta.description || '',
    preview: meta.primaryColor || '#3498db',
    cssUrl: meta.cssUrl || '',
  };
}

/** 拉取服务端主题列表（失败时保留默认主题，页面仍可正常使用） */
async function loadThemes() {
  try {
    const res = await api.get('/api/themes');
    const data = res?.data || {};
    const list = Object.entries(data)
      .map(([id, meta]) => normalizeTheme(meta || {}, id))
      .filter((t) => t.id !== 'default');
    themes = [DEFAULT_THEME, ...list];
  } catch (err) {
    console.warn('[Themes] 获取主题列表失败，仅使用默认主题', err?.message || err);
  }
  return themes;
}

/** 主题列表只拉一次，多处调用共享同一个 Promise */
function ensureThemes() {
  if (!loadingPromise) loadingPromise = loadThemes();
  return loadingPromise;
}

/** 当前主题 ID */
export function getCurrentTheme() {
  return currentThemeId;
}

/** 主题列表（副本） */
export function getThemeList() {
  return themes.map((t) => ({ ...t }));
}

/** 动态加载主题 CSS（异步，已缓存直接应用） */
async function loadThemeCss(cssUrl) {
  const oldStyle = document.getElementById('theme-dynamic-css');
  if (oldStyle) oldStyle.remove();
  if (!cssUrl) return;

  let cssText = cssCache.get(cssUrl);
  if (cssText === undefined) {
    try {
      const res = await fetch(cssUrl);
      cssText = await res.text();
      cssCache.set(cssUrl, cssText);
    } catch (err) {
      console.warn('[Themes] 主题 CSS 加载失败', cssUrl, err.message);
      toast.error('主题样式加载失败');
      return;
    }
  }

  const style = document.createElement('style');
  style.id = 'theme-dynamic-css';
  style.textContent = cssText;
  document.head.appendChild(style);
}

/** 同步面板按钮高亮 */
function syncPanel() {
  document.querySelectorAll('[data-theme-btn]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.themeBtn === currentThemeId);
  });
}

/**
 * 应用主题
 * @param {string} id - 主题 ID
 */
export async function applyTheme(id) {
  await ensureThemes();
  const theme = getTheme(id);
  if (!theme) {
    console.warn('[Themes] 未知主题:', id);
    return;
  }

  currentThemeId = theme.id;
  document.body.dataset.theme = theme.id;      // 触发 CSS 变量换肤
  await loadThemeCss(theme.cssUrl);            // 加载主题 CSS
  localStorage.setItem(THEME_KEY, theme.id);   // 持久化（与 v1 一致）
  syncPanel();
  toast.success(`已切换主题：${theme.name}`);
}

/**
 * 初始化：应用本地保存的主题（v1/v2 共享 selectedTheme）
 * 先同步设置 data-theme 避免闪烁，待服务端主题列表就绪后再加载对应 CSS。
 */
export async function initThemes() {
  const saved = localStorage.getItem(THEME_KEY) || 'default';
  document.body.dataset.theme = saved;
  await ensureThemes();
  const theme = getTheme(saved);
  currentThemeId = theme ? theme.id : 'default';
  document.body.dataset.theme = currentThemeId;
  if (theme?.cssUrl) loadThemeCss(theme.cssUrl);
}

/**
 * 渲染主题选择面板（卡片式，当前主题高亮）
 * @param {HTMLElement} container - 挂载容器
 * @returns {Promise<HTMLElement>} 面板元素
 */
export async function renderThemePanel(container) {
  await ensureThemes();
  const panel = el('div', { class: 'theme-container panel' }, [
    el('h2', { class: 'panel-title' }, '🎨 主题设置'),
    el('div', { class: 'theme-grid' },
      themes.map((theme) => {
        const active = theme.id === currentThemeId;
        return el('div', {
          class: 'theme-card' + (active ? ' active' : ''),
          'data-theme-btn': theme.id,
          onClick: () => applyTheme(theme.id),
        }, [
          el('div', { class: 'theme-card-preview', style: `background:linear-gradient(135deg, ${theme.preview}, ${theme.preview}88);` },
            el('span', { class: 'theme-card-icon' }, theme.icon)),
          el('div', { class: 'theme-card-body' }, [
            el('div', { class: 'theme-card-name' }, [
              theme.name,
              active ? el('span', { class: 'theme-card-badge' }, '使用中') : null,
            ]),
            el('div', { class: 'theme-card-desc' }, theme.description),
          ]),
        ]);
      })
    ),
    el('p', { class: 'text-muted', style: 'margin-top: 12px' },
      '选择主题后立即生效，刷新后保持（与 v1 共享选择）。'),
  ]);

  container.innerHTML = '';
  container.appendChild(panel);
  syncPanel();
  return panel;
}
