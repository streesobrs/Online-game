/**
 * Toast 提示组件
 * 位置 / 弹出方向 / 停留时长 / 动画速率来自设置页（core/prefs.js），默认右上角、3 秒。
 * 多条同时存在时：新提示从 0 高度展开、旧提示收起后再移除，避免整列突然跳动。
 * 样式自包含（首次使用时注入 <style>），不依赖外部样式表。
 */
import { el } from '../utils/dom.js';
import { getUiPrefs } from '../core/prefs.js';

/** 1x 速率下单次入场/退场时长（毫秒） */
const FADE_MS = 250;

let container = null;
let styleInjected = false;

// 组件专属样式（自包含，后续可迁移至公共样式表）
// 间距用 margin 而不是 gap：收起时能把这条占位一起平滑压掉
const TOAST_STYLE = `
.toast-container{position:fixed;z-index:9999;display:flex;flex-direction:column;pointer-events:none;max-width:360px}
.toast-container[data-pos="top-right"]{top:16px;right:16px;align-items:flex-end}
.toast-container[data-pos="top-left"]{top:16px;left:16px;align-items:flex-start}
.toast-container[data-pos="top-center"]{top:16px;left:50%;transform:translateX(-50%);align-items:center}
.toast-container[data-pos="bottom-right"]{bottom:16px;right:16px;flex-direction:column-reverse;align-items:flex-end}
.toast-container[data-pos="bottom-left"]{bottom:16px;left:16px;flex-direction:column-reverse;align-items:flex-start}
.toast-container[data-pos="bottom-center"]{bottom:16px;left:50%;transform:translateX(-50%);flex-direction:column-reverse;align-items:center}
.toast{box-sizing:border-box;padding:10px 16px;margin-bottom:8px;border-radius:8px;color:#fff;font-size:14px;line-height:1.5;box-shadow:0 4px 12px rgba(0,0,0,.15);max-width:320px;opacity:1;transform:none;transition:opacity calc(.25s / var(--toast-speed,1)) ease,transform calc(.25s / var(--toast-speed,1)) ease,height calc(.25s / var(--toast-speed,1)) ease,padding calc(.25s / var(--toast-speed,1)) ease,margin calc(.25s / var(--toast-speed,1)) ease}
.toast-container[data-pos^="bottom"] .toast{margin-bottom:0;margin-top:8px}
/* 初始 / 退场状态：按方向偏移并透明，移除 is-hidden 即入场，加回即退场 */
.toast.is-hidden{opacity:0}
.toast-container[data-dir="down"] .toast.is-hidden{transform:translateY(-16px)}
.toast-container[data-dir="up"] .toast.is-hidden{transform:translateY(16px)}
.toast-container[data-dir="left"] .toast.is-hidden{transform:translateX(-16px)}
.toast-container[data-dir="right"] .toast.is-hidden{transform:translateX(16px)}
.toast-container[data-dir="fade"] .toast.is-hidden{transform:none}
.toast--success{background:#28a745}
.toast--error{background:#dc3545}
.toast--info{background:#17a2b8}
.toast--warn{background:#ffc107;color:#212529}
`;

function ensureStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = TOAST_STYLE;
  document.head.appendChild(style);
}

/** 位置 → 默认弹出方向：从哪条边进来就贴着哪条边滑 */
function autoDirection(position) {
  if (position.startsWith('top')) return 'down';
  if (position.startsWith('bottom')) return 'up';
  if (position.endsWith('left')) return 'left';
  if (position.endsWith('right')) return 'right';
  return 'down';
}

/** 把最新偏好同步到提示容器上（位置 / 弹出方向 / 动画速率） */
function syncContainerPrefs() {
  if (!container) return;
  const prefs = getUiPrefs();
  container.dataset.pos = prefs.toastPosition;
  container.dataset.dir = prefs.toastDirection === 'auto'
    ? autoDirection(prefs.toastPosition)
    : prefs.toastDirection;
  // 倍率：关闭动画时给一个极大值，让 calc(.25s / n) 归零（用 0.001 反而会把时长放大到 250 秒）
  container.style.setProperty('--toast-speed', prefs.animEnabled ? String(prefs.animSpeed) : '1000');
}

function getContainer() {
  if (!container) {
    container = el('div', { class: 'toast-container', id: 'toast-container' });
    document.body.appendChild(container);
    ensureStyle();
    syncContainerPrefs();
    // 设置页改了位置/方向/速率后立即生效，不用等刷新
    window.addEventListener('ui:prefs-changed', syncContainerPrefs);
  }
  return container;
}

/** 折叠为不占位状态（入场前 / 退场时用） */
function collapse(node) {
  node.style.height = '0px';
  node.style.paddingTop = '0px';
  node.style.paddingBottom = '0px';
  node.style.marginTop = '0px';
  node.style.marginBottom = '0px';
  node.style.overflow = 'hidden';
}

/** 展开到自然高度（量过高后固定像素，才能有过渡） */
function expand(node, height) {
  node.style.height = `${height}px`;
  node.style.paddingTop = '';
  node.style.paddingBottom = '';
  node.style.marginTop = '';
  node.style.marginBottom = '';
}

/**
 * 显示一条提示
 * @param {string} message - 提示内容
 * @param {'success'|'error'|'info'|'warn'} [type='info'] - 提示类型
 * @param {number} [duration] - 显示时长（毫秒），默认取设置页配置
 */
function show(message, type = 'info', duration) {
  const prefs = getUiPrefs();
  const hold = duration === undefined ? prefs.toastDuration : duration;
  const motion = prefs.animEnabled;
  // 与 CSS 的 250ms / 速率对齐，再多留一帧余量
  const fadeOut = motion ? Math.max(60, FADE_MS / prefs.animSpeed) + 40 : 0;

  const node = el('div', { class: `toast toast--${type} is-hidden` }, message);
  getContainer().appendChild(node);

  // 先按自然高度量一次（同一帧内完成，浏览器不会画出中间态）
  const fullHeight = node.offsetHeight;
  collapse(node);

  // 下一帧：展开 + 淡入。已有提示会被平滑推上去，而不是瞬间跳一格
  requestAnimationFrame(() => {
    node.classList.remove('is-hidden');
    expand(node, fullHeight);
  });

  setTimeout(() => {
    node.classList.add('is-hidden');
    // 同步收起高度，后面的提示跟着平滑归位，避免「弹跳」
    collapse(node);
    setTimeout(() => node.remove(), fadeOut);
  }, hold);
}

/** 全局提示对象 */
export const toast = {
  /** @param {string} message */
  success: (message) => show(message, 'success'),
  /** @param {string} message */
  error: (message) => show(message, 'error'),
  /** @param {string} message */
  info: (message) => show(message, 'info'),
  /** @param {string} message */
  warn: (message) => show(message, 'warn'),
  show,
};
