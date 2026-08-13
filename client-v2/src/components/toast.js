/**
 * Toast 提示组件
 * 页面右上角显示，默认 3 秒自动消失。
 * 样式自包含（首次使用时注入 <style>），不依赖外部样式表。
 */
import { el } from '../utils/dom.js';

let container = null;
let styleInjected = false;

// 组件专属样式（自包含，后续可迁移至公共样式表）
const TOAST_STYLE = `
.toast-container{position:fixed;top:16px;right:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none}
.toast{padding:10px 16px;border-radius:8px;color:#fff;font-size:14px;line-height:1.5;box-shadow:0 4px 12px rgba(0,0,0,.15);opacity:0;transform:translateX(20px);transition:opacity .25s ease,transform .25s ease;max-width:320px}
.toast--show{opacity:1;transform:translateX(0)}
.toast--success{background:#28a745}
.toast--error{background:#dc3545}
.toast--info{background:#17a2b8}
`;

function ensureStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = TOAST_STYLE;
  document.head.appendChild(style);
}

function getContainer() {
  if (!container) {
    container = el('div', { class: 'toast-container', id: 'toast-container' });
    document.body.appendChild(container);
  }
  return container;
}

/**
 * 显示一条提示
 * @param {string} message - 提示内容
 * @param {'success'|'error'|'info'} [type='info'] - 提示类型
 * @param {number} [duration=3000] - 显示时长（毫秒）
 */
function show(message, type = 'info', duration = 3000) {
  ensureStyle();
  const node = el('div', { class: `toast toast--${type}` }, message);
  getContainer().appendChild(node);

  // 下一帧触发过渡动画
  requestAnimationFrame(() => node.classList.add('toast--show'));

  setTimeout(() => {
    node.classList.remove('toast--show');
    setTimeout(() => node.remove(), 300);
  }, duration);
}

/** 全局提示对象 */
export const toast = {
  /** @param {string} message */
  success: (message) => show(message, 'success'),
  /** @param {string} message */
  error: (message) => show(message, 'error'),
  /** @param {string} message */
  info: (message) => show(message, 'info'),
  show,
};
