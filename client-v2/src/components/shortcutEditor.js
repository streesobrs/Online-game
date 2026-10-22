/**
 * 快捷键编辑器（设置页 → ⌨ 快捷键）
 *
 * 单一实例：同一时间只允许一处采集新键位。切换分类/离开页面时调用
 * cancelShortcutCapture()，否则监听会一直拦下全站按键。
 */
import { el } from '../utils/dom.js';
import { toast } from './toast.js';
import { SHORTCUT_DEFS, SHORTCUT_SCOPES, scopeName } from '../data/shortcutDefs.js';
import {
  getBinding, isCustomized, setBinding, resetBinding, resetAll, formatCombo, comboFromEvent,
} from '../core/shortcuts.js';

/** 当前的采集监听（同一时间至多一个） */
let capture = null;

/** 取消正在进行的改键采集（切换页面/分类时调用） */
export function cancelShortcutCapture() {
  if (!capture) return;
  document.removeEventListener('keydown', capture.handler, true);
  capture = null;
}

/**
 * 构建快捷键编辑器
 * @returns {{ el: HTMLElement, destroy: Function }}
 */
export function buildShortcutEditor() {
  const scopeListEl = el('div', { class: 'profile-shortcut-scopes' });

  let capturingId = null;

  /** 结束采集并重绘 */
  function stopKeyCapture() {
    cancelShortcutCapture();
    capturingId = null;
  }

  /** 开始采集：按下新键即写入，Esc 取消 */
  function startKeyCapture(def, refresh) {
    stopKeyCapture();
    const handler = (e) => {
      // 捕获阶段拦下按键，避免改键时误触发全局快捷键
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { stopKeyCapture(); refresh(); return; }

      const combo = comboFromEvent(e);
      if (!combo) return; // 只按了修饰键：继续等主键

      const res = setBinding(def.id, combo);
      if (!res.ok) { toast.error(res.message); return; }

      stopKeyCapture();
      refresh();
      toast.success(`「${def.name}」已改为 ${formatCombo(getBinding(def.id))}`);
      if (res.crossScope) {
        toast.info(`该键在「${scopeName(res.crossScope.scope)}」中也被「${res.crossScope.name}」使用，两者互不影响`);
      }
    };
    document.addEventListener('keydown', handler, true);
    capture = { handler, defId: def.id, refresh };
    capturingId = def.id;
    refresh();
  }

  function renderRow(def, refresh) {
    const customized = isCustomized(def.id);
    const capturing = capturingId === def.id;

    const kbd = el('kbd', { class: 'profile-shortcut-key' + (capturing ? ' capturing' : '') },
      capturing ? '按下新键…' : formatCombo(getBinding(def.id)));

    const actionBtn = el('button', {
      class: 'profile-shortcut-btn',
      type: 'button',
      onClick: () => {
        if (capturing) { stopKeyCapture(); refresh(); return; }
        startKeyCapture(def, refresh);
      },
    }, capturing ? '取消' : '改键');

    const resetBtn = el('button', {
      class: 'profile-shortcut-btn profile-shortcut-btn--ghost',
      type: 'button',
      disabled: !customized,
      onClick: () => {
        stopKeyCapture();
        if (resetBinding(def.id)) toast.info(`「${def.name}」已恢复默认键位`);
        refresh();
      },
    }, '重置');

    return el('div', { class: 'profile-shortcut-row' + (capturing ? ' capturing' : '') }, [
      el('span', { class: 'profile-shortcut-icon' }, def.icon),
      el('span', { class: 'profile-shortcut-name' }, def.name),
      customized ? el('span', { class: 'profile-shortcut-status' }, '已自定义') : null,
      el('span', { class: 'profile-shortcut-spacer' }),
      kbd,
      actionBtn,
      resetBtn,
    ]);
  }

  const resetAllBtn = el('button', {
    class: 'profile-shortcut-btn profile-shortcut-btn--ghost',
    type: 'button',
    onClick: () => {
      stopKeyCapture();
      if (resetAll()) toast.info('已全部恢复默认键位');
      refresh();
    },
  }, '全部恢复默认');

  function refresh() {
    // 采集中的那一行需要保持标记，重绘后仍在同一作用域内
    scopeListEl.innerHTML = '';
    SHORTCUT_SCOPES.forEach((scope) => {
      const defs = SHORTCUT_DEFS.filter((d) => d.scope === scope.id);
      if (!defs.length) return;
      scopeListEl.append(el('div', { class: 'profile-shortcut-scope' }, [
        el('div', { class: 'profile-shortcut-scope-head' }, [
          el('span', { class: 'profile-shortcut-scope-name' }, scope.name),
          el('span', { class: 'profile-shortcut-scope-desc' }, scope.desc),
        ]),
        el('div', { class: 'profile-shortcut-list' }, defs.map((d) => renderRow(d, refresh))),
      ]));
    });
    resetAllBtn.disabled = !SHORTCUT_DEFS.some((d) => isCustomized(d.id));
  }
  refresh();

  const wrapper = el('div', { class: 'shortcut-editor' }, [
    el('div', { class: 'profile-shortcut-head' }, [
      el('span', { class: 'settings-hint', style: 'margin:0;' }, '点「改键」后按下新键即可；同一分类内键位不可重复，不同分类之间允许同键。'),
      resetAllBtn,
    ]),
    el('p', { class: 'profile-shortcut-tip' },
      '支持 Ctrl / Alt / Shift 组合键（如 Ctrl+K）。在输入框内按键不会触发；改键时按 Esc 取消。'),
    scopeListEl,
  ]);

  return {
    el: wrapper,
    destroy: stopKeyCapture,
  };
}
