/**
 * 快捷键注册器
 * 从 NAV_ITEMS 的 shortcut 字段自动派生键位映射（元数据驱动）：
 * 按 1/2/3/4 切换游戏，按 A/L/G/V/T/K 切换功能页。
 * 输入框（input/textarea/select/contentEditable）内不触发。
 */
import { NAV_ITEMS } from '../data/navItems.js';
import { go } from '../core/router.js';

/** 键位 → 视图 ID 映射（由元数据派生） */
const SHORTCUTS = new Map();

NAV_ITEMS.forEach((item) => {
  if (item.shortcut) {
    SHORTCUTS.set(item.shortcut.toLowerCase(), item.id);
  }
});

/** 按键处理 */
function handleKeydown(e) {
  // 输入场景不触发
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const id = SHORTCUTS.get(e.key.toLowerCase());
  if (id) {
    e.preventDefault();
    go(id);
  }
}

/**
 * 启用快捷键监听
 * @returns {Function} 停用函数
 */
export function initShortcuts() {
  window.addEventListener('keydown', handleKeydown);
  return () => window.removeEventListener('keydown', handleKeydown);
}
