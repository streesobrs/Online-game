/**
 * 对局内固定快捷键
 *
 * 对局期间全局快捷键（utils/shortcut.js）会被 setShortcutsSuppressed(true) 屏蔽，
 * 因此这里独立监听 keydown，cleanup 时移除。
 *
 * 键位（不可自定义，设置页只负责全局快捷键）：
 *   Z 悔棋 · Shift+Z 重做 · U 认输 · N 新局 · P 暂停/继续
 *   M 重新匹配 · R 返回大厅 · T 规则
 */
import { toast } from '../components/toast.js';

const INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTypingTarget(target) {
  if (!target || !(target instanceof Element)) return false;
  if (target.isContentEditable) return true;
  return INPUT_TAGS.has(target.tagName);
}

/**
 * 绑定对局快捷键
 * @param {Object} options
 * @param {Object} options.handlers 行为集合（函数，可缺省）
 * @param {() => boolean} [options.isPaused] 当前是否暂停
 * @param {(paused: boolean) => void} [options.setPaused] 切换暂停
 * @returns {{ destroy: () => void }}
 */
export function bindGameKeys({ handlers = {}, isPaused, setPaused } = {}) {
  const call = (name) => {
    const fn = handlers[name];
    if (typeof fn === 'function') fn();
  };

  const onKeyDown = (event) => {
    if (event.defaultPrevented || event.repeat) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    // 弹窗打开时交给弹窗自己处理
    if (document.body.classList.contains('modal-open')) return;

    const key = event.key.toLowerCase();

    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) call('redo');
      else call('undo');
      return;
    }

    switch (key) {
      case 'u':
        event.preventDefault();
        call('resign');
        break;
      case 'n':
        event.preventDefault();
        call('newGame');
        break;
      case 'p':
        event.preventDefault();
        if (typeof setPaused === 'function') {
          const next = !(typeof isPaused === 'function' ? isPaused() : false);
          setPaused(next);
        } else {
          call('pause');
        }
        break;
      case 'm':
        event.preventDefault();
        call('rematch');
        break;
      case 'r':
        event.preventDefault();
        call('back');
        break;
      case 't':
        event.preventDefault();
        call('rules');
        break;
      default:
        break;
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return {
    destroy() {
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}

/** 统一提示：功能暂不可用 */
export function notifyUnavailable(text) {
  toast.info(text);
}

export default bindGameKeys;
