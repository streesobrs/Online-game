/**
 * 主题切换功能
 * 机制与 v1 一致：body[data-theme="xxx"] 触发 CSS 变量作用域换肤 + 动态加载主题 CSS。
 * 持久化 key：selectedTheme（与 v1 完全一致，v1/v2 切换共享主题选择）。
 * 主题 CSS 使用本地相对路径（./themes/xxx.css，来自任务 1.5.2 复制）。
 */
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

const THEME_KEY = 'selectedTheme';

/** 主题列表：default 本地（变量在 variables.css）+ 3 个复制自 v1 的主题 */
export const THEMES = [
  { id: 'default', name: '默认', icon: '🌞', description: '明亮简洁', cssUrl: '' },
  { id: 'cyberpunk', name: '赛博朋克', icon: '🌃', description: '霓虹紫蓝', cssUrl: './themes/cyberpunk.css' },
  { id: 'forest', name: '森林', icon: '🌲', description: '自然绿意', cssUrl: './themes/forest.css' },
  { id: 'ocean', name: '海洋', icon: '🌊', description: '清新蓝调', cssUrl: './themes/ocean.css' },
];

let currentThemeId = 'default';
const cssCache = new Map(); // cssUrl → css 文本缓存

function getTheme(id) {
  return THEMES.find((t) => t.id === id);
}

/** 当前主题 ID */
export function getCurrentTheme() {
  return currentThemeId;
}

/** 主题列表（副本） */
export function getThemeList() {
  return THEMES.map((t) => ({ ...t }));
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
 */
export function initThemes() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved && getTheme(saved)) {
    currentThemeId = saved;
    document.body.dataset.theme = saved;
    const theme = getTheme(saved);
    if (theme.cssUrl) loadThemeCss(theme.cssUrl);
  } else {
    document.body.dataset.theme = 'default';
  }
}

/**
 * 渲染主题选择面板（按钮式，当前主题高亮）
 * @param {HTMLElement} container - 挂载容器
 * @returns {HTMLElement} 面板元素
 */
export function renderThemePanel(container) {
  const panel = el('div', { class: 'theme-container panel' }, [
    el('h2', { class: 'panel-title' }, '主题设置'),
    el('div', { class: 'flex gap-8', style: 'flex-wrap: wrap; margin-top: 8px' },
      THEMES.map((theme) =>
        el('button', {
          class: 'btn theme-btn',
          'data-theme-btn': theme.id,
          onClick: () => applyTheme(theme.id),
        }, `${theme.icon} ${theme.name}`)
      )
    ),
    el('p', { class: 'text-muted', style: 'margin-top: 8px' },
      '选择主题后立即生效，刷新后保持（与 v1 共享选择）。'),
  ]);

  container.innerHTML = '';
  container.appendChild(panel);
  syncPanel();
  return panel;
}
