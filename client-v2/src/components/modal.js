/**
 * 模态框组件
 * 支持标题、内容（字符串或 DOM 节点）、确认/取消回调、点击遮罩关闭、右上角关闭。
 * 样式自包含（首次使用时注入 <style>），不依赖外部样式表。
 */
import { el } from '../utils/dom.js';

let activeOverlay = null;
let styleInjected = false;

// 组件专属样式（自包含，后续可迁移至公共样式表）
const MODAL_STYLE = `
.modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;animation:modal-fade .2s ease}
.modal{background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.2);width:90%;max-width:420px;max-height:80vh;display:flex;flex-direction:column;animation:modal-pop .2s ease}
.modal__header{padding:16px 20px 0;display:flex;align-items:center;justify-content:space-between}
.modal__title{margin:0;font-size:16px;font-weight:600;color:#212529}
.modal__body{padding:16px 20px;font-size:14px;color:#495057;overflow-y:auto;line-height:1.6}
.modal__footer{padding:0 20px 16px;display:flex;justify-content:flex-end;gap:8px}
.modal__close{border:none;background:none;font-size:22px;line-height:1;color:#adb5bd;cursor:pointer;padding:0 4px}
.modal__close:hover{color:#495057}
.modal .btn{border:none;border-radius:6px;padding:8px 16px;font-size:14px;cursor:pointer;transition:background .15s ease}
.modal .btn--primary{background:#007bff;color:#fff}
.modal .btn--primary:hover{background:#0056b3}
.modal .btn--ghost{background:#f1f3f5;color:#495057}
.modal .btn--ghost:hover{background:#e9ecef}
@keyframes modal-fade{from{opacity:0}to{opacity:1}}
@keyframes modal-pop{from{transform:scale(.95);opacity:0}to{transform:scale(1);opacity:1}}
`;

function ensureStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = MODAL_STYLE;
  document.head.appendChild(style);
}

/**
 * 显示模态框
 * @param {Object} [options]
 * @param {string} [options.title=''] - 标题
 * @param {string|Node} [options.content=''] - 内容（字符串或 DOM 节点）
 * @param {Function} [options.onConfirm] - 点击「确定」回调
 * @param {Function} [options.onCancel] - 取消回调（取消按钮 / 遮罩点击 / 关闭按钮）
 * @param {string} [options.confirmText='确定'] - 确认按钮文案
 * @param {string} [options.cancelText='取消'] - 取消按钮文案
 * @param {boolean} [options.showCancel=true] - 是否显示取消按钮
 * @returns {HTMLElement} 遮罩层元素
 */
export function show(options = {}) {
  const {
    title = '',
    content = '',
    onConfirm,
    onCancel,
    confirmText = '确定',
    cancelText = '取消',
    showCancel = true,
  } = options;

  close(); // 同一时刻只允许一个模态框

  ensureStyle();

  const overlay = el('div', { class: 'modal-overlay' });
  const modal = el('div', { class: 'modal' });
  const header = el('div', { class: 'modal__header' },
    el('h3', { class: 'modal__title' }, title),
    el('button', { class: 'modal__close', type: 'button', 'aria-label': '关闭' }, '×')
  );
  const body = el('div', { class: 'modal__body' });
  body.append(content instanceof Node ? content : document.createTextNode(String(content)));
  const footer = el('div', { class: 'modal__footer' });

  if (showCancel) {
    footer.append(el('button', { class: 'btn btn--ghost', type: 'button' }, cancelText));
  }
  footer.append(el('button', { class: 'btn btn--primary', type: 'button' }, confirmText));

  modal.append(header, body, footer);
  overlay.append(modal);
  document.body.appendChild(overlay);

  // 确认
  modal.querySelector('.btn--primary').addEventListener('click', () => {
    close();
    if (typeof onConfirm === 'function') onConfirm();
  });

  // 取消按钮
  if (showCancel) {
    modal.querySelector('.btn--ghost').addEventListener('click', () => {
      close();
      if (typeof onCancel === 'function') onCancel();
    });
  }

  // 右上角关闭按钮（视为取消）
  modal.querySelector('.modal__close').addEventListener('click', () => {
    close();
    if (typeof onCancel === 'function') onCancel();
  });

  // 点击遮罩关闭
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
      if (typeof onCancel === 'function') onCancel();
    }
  });

  activeOverlay = overlay;
  return overlay;
}

/**
 * 关闭当前模态框
 */
export function close() {
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}

/** 全局模态框对象 */
export const modal = { show, close };
