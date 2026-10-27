/**
 * 全局快捷键监听（单入口分发）
 *
 * 从 core/shortcuts.js 的绑定表解析按键，按作用域分发：
 * - global → 路由跳转（go(view)）
 * - 其它作用域（如 games）→ 交给该作用域注册的处理函数（视图挂载时注册，卸载时注销）
 *
 * 键位可由用户在「设置 → ⌨ 快捷键」自定义，见 core/shortcuts.js。
 * 输入框（input/textarea/select/contentEditable）内不触发。
 */
import { go } from '../core/router.js';
import { store } from '../core/store.js';
import { eventBus } from '../core/eventBus.js';
import { resolveShortcut, getScopeHandler, loadFromAccount } from '../core/shortcuts.js';

/** 输入场景不触发快捷键 */
function isTypingTarget(target) {
  const tag = (target?.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || !!target?.isContentEditable;
}

/** 对局进行中暂停全局快捷键（避免 WASD 等游戏操作触发页面跳转） */
let suppressed = false;

/** 游戏开始/结束时调用，暂停或恢复快捷键分发 */
export function setShortcutsSuppressed(value) {
  suppressed = !!value;
}

function handleKeydown(e) {
  if (suppressed) return;
  if (isTypingTarget(e.target)) return;

  const hit = resolveShortcut(e, store.get('currentView'));
  if (!hit) return;

  if (hit.scope === 'global') {
    // 界面操作键（如开关侧边栏）：交给注册了 global 作用域的模块处理；
    // 目标模块未挂载时不拦截，保留浏览器原生行为（如 Tab 切换焦点）
    if (hit.op) {
      const uiHandler = getScopeHandler('global');
      // 弹窗内保留原生 Tab 焦点切换，不抢快捷键
      if (!uiHandler || document.body.classList.contains('modal-open')) return;
      if (hit.preventDefault !== false) e.preventDefault();
      uiHandler(hit.op, hit);
      return;
    }
    if (hit.preventDefault !== false) e.preventDefault();
    go(hit.view);
    return;
  }

  // 个别绑定（如大厅的 Enter）不拦截默认行为，避免影响按钮的原生回车点击
  if (hit.preventDefault !== false) e.preventDefault();
  const handler = getScopeHandler(hit.scope);
  if (handler) handler(hit.op, hit);
}

/**
 * 启用快捷键监听
 * @returns {Function} 停用函数
 */
export function initShortcuts() {
  window.addEventListener('keydown', handleKeydown);
  loadFromAccount();
  const offAccount = eventBus.on('user:accountChanged', () => loadFromAccount());
  return () => {
    window.removeEventListener('keydown', handleKeydown);
    if (typeof offAccount === 'function') offAccount();
  };
}
