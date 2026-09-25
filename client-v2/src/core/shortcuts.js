/**
 * 快捷键管理器
 *
 * 职责：
 * 1. 键位归一化：把 KeyboardEvent 变成稳定字符串（'ctrl+shift+k' / 'enter' / 'num1'）
 * 2. 绑定状态：默认键（data/shortcutDefs.js） + 账号级自定义覆盖（account.shortcuts）
 * 3. 匹配分发：按「当前视图作用域 > global」的顺序找命中的绑定
 * 4. 持久化：改动后经 auth.updateProfile 同步到账号（跨设备一致）
 *
 * 归一化 / 匹配部分是纯逻辑，不碰 DOM 网络，可直接在控制台或测试里验证。
 */
import { SHORTCUT_DEFS, SCOPE_BY_VIEW, findDef } from '../data/shortcutDefs.js';
import { store } from './store.js';
import * as auth from './auth.js';

/** 修饰键固定顺序，保证 'shift+ctrl+k' 与 'ctrl+shift+k' 归一化为同一串 */
const MOD_ORDER = ['ctrl', 'alt', 'shift'];

const MOD_LABELS = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };

/** 具名键展示文案（未列出的走兜底） */
const KEY_LABELS = {
  enter: 'Enter',
  escape: 'Esc',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  home: 'Home',
  end: 'End',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  insert: 'Insert',
};

/** e.key 的常见别名 → 归一化名 */
const KEY_ALIASES = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  space: ' ',
  spacebar: ' ',
  '↑': 'arrowup',
  '↓': 'arrowdown',
  '←': 'arrowleft',
  '→': 'arrowright',
};

/** 修饰键本身不构成主键 */
const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta', 'os']);

/** 单个主键归一化：'K' → 'k'、'ArrowUp' → 'arrowup'、'1' → '1' */
function normalizeBaseKey(raw) {
  if (raw == null) return '';
  const key = String(raw).trim();
  if (!key) return '';
  const lower = key.toLowerCase();
  if (MODIFIER_KEYS.has(lower)) return '';
  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];
  if (key.length === 1) return lower;
  return lower;
}

/**
 * 把任意键位描述解析为归一化组合串，非法返回 ''
 * 例：'Ctrl + Shift + K' → 'ctrl+shift+k'；'Esc' → 'escape'；'A' → 'a'
 */
export function normalizeCombo(input) {
  if (typeof input !== 'string') return '';
  const parts = input.split('+').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return '';
  const mods = [];
  let base = '';
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control') { if (!mods.includes('ctrl')) mods.push('ctrl'); continue; }
    if (p === 'alt' || p === 'option') { if (!mods.includes('alt')) mods.push('alt'); continue; }
    if (p === 'shift') { if (!mods.includes('shift')) mods.push('shift'); continue; }
    base = normalizeBaseKey(p);
  }
  // '+' 会被当成分隔符，无法往返，直接视为非法
  if (!base || base === '+') return '';
  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  return [...ordered, base].join('+');
}

/**
 * 从 KeyboardEvent 生成归一化组合串；只按修饰键时返回 null
 * 主键优先取 e.code，避免 Shift 把数字变成符号（Shift+1 的 e.key 是 '!'）、大小写漂移
 */
export function comboFromEvent(e) {
  if (!e) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');

  const code = e.code || '';
  let base = '';
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) base = m[1].toLowerCase();
  else if ((m = /^Digit([0-9])$/.exec(code))) base = m[1];
  else if ((m = /^Numpad([0-9])$/.exec(code))) base = `num${m[1]}`;
  else base = normalizeBaseKey(e.key);

  if (!base || base === '+') return null;
  return [...mods, base].join('+');
}

/** 组合串 → 展示文案：'ctrl+shift+k' → 'Ctrl + Shift + K' */
export function formatCombo(combo) {
  if (!combo) return '';
  return combo.split('+').map((p) => {
    if (MOD_LABELS[p]) return MOD_LABELS[p];
    if (KEY_LABELS[p]) return KEY_LABELS[p];
    if (/^num[0-9]$/.test(p)) return `小键盘 ${p.slice(3)}`;
    if (p.length === 1) return p.toUpperCase();
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' + ');
}

// ===== 绑定状态 =====

/** 自定义覆盖：{ defId: combo }，仅存与默认不同的项，随账号同步 */
let overrides = {};
/** 作用域处理函数（视图挂载时注册，如游戏大厅） */
const scopeHandlers = new Map();
/** 变更订阅者 */
const listeners = new Set();

/** 从账号数据里读取自定义键位（忽略已下线的绑定与非法值） */
function readAccountShortcuts() {
  const user = store.get('user');
  const inner = user?.account?.account || user?.account || null;
  const raw = inner && typeof inner.shortcuts === 'object' && inner.shortcuts ? inner.shortcuts : {};
  const clean = {};
  for (const [id, combo] of Object.entries(raw)) {
    if (!findDef(id)) continue;
    const norm = normalizeCombo(combo);
    if (norm) clean[id] = norm;
  }
  return clean;
}

/** 登录/账号数据变化后重新加载（由 utils/shortcut.js 在账号变更时调用） */
export function loadFromAccount() {
  overrides = readAccountShortcuts();
  emitChange();
}

export function onShortcutChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emitChange() {
  listeners.forEach((fn) => {
    try { fn(); } catch (err) { console.error('[Shortcuts] 订阅回调异常', err); }
  });
}

/** 取某绑定的当前键位（自定义优先，否则默认） */
export function getBinding(id) {
  const def = findDef(id);
  if (!def) return '';
  return overrides[id] || normalizeCombo(def.def);
}

/** 是否已被自定义 */
export function isCustomized(id) {
  return !!overrides[id];
}

/** 全部绑定的当前键位 */
export function getBindings() {
  const map = {};
  SHORTCUT_DEFS.forEach((d) => { map[d.id] = getBinding(d.id); });
  return map;
}

/**
 * 同作用域内是否已被占用（同作用域不允许重复）
 * @returns {Object|null} 占用该键的绑定定义
 */
export function findConflict(scope, combo, exceptId) {
  const norm = normalizeCombo(combo);
  if (!norm) return null;
  return SHORTCUT_DEFS.find((d) => d.scope === scope && d.id !== exceptId && getBinding(d.id) === norm) || null;
}

/** 其它作用域是否也用了该键（允许重复，仅用于提示） */
export function findCrossScope(scope, combo, exceptId) {
  const norm = normalizeCombo(combo);
  if (!norm) return null;
  return SHORTCUT_DEFS.find((d) => d.scope !== scope && d.id !== exceptId && getBinding(d.id) === norm) || null;
}

/**
 * 设置绑定（同作用域冲突时拒绝）
 * @returns {{ok: boolean, message?: string, crossScope?: Object|null}}
 */
export function setBinding(id, combo) {
  const def = findDef(id);
  const norm = normalizeCombo(combo);
  if (!def || !norm) return { ok: false, message: '无效的键位' };

  const dup = findConflict(def.scope, norm, id);
  if (dup) return { ok: false, message: `该键已被「${dup.name}」占用` };

  // 改回默认键 = 取消自定义，避免存一份冗余覆盖
  if (norm === normalizeCombo(def.def)) delete overrides[id];
  else overrides[id] = norm;

  persist();
  emitChange();
  return { ok: true, crossScope: findCrossScope(def.scope, norm, id) };
}

/** 单条恢复默认 */
export function resetBinding(id) {
  if (!overrides[id]) return false;
  delete overrides[id];
  persist();
  emitChange();
  return true;
}

/** 全部恢复默认 */
export function resetAll() {
  if (!Object.keys(overrides).length) return false;
  overrides = {};
  persist();
  emitChange();
  return true;
}

/** 写入本地 store + 同步到账号 */
function persist() {
  const map = { ...overrides };
  const user = store.get('user');
  const inner = user?.account?.account;
  if (inner) {
    inner.shortcuts = map;
    store.set('user', { ...user });
  }
  auth.updateProfile({ shortcuts: map });
}

// ===== 匹配分发 =====

/**
 * 解析一次按键：按「当前视图作用域 > global」的顺序匹配
 * @param {KeyboardEvent} e
 * @param {string} currentView - store.currentView
 * @returns {Object|null} 命中的绑定定义（含 scope / view / op / preventDefault）
 */
export function resolveShortcut(e, currentView) {
  const combo = comboFromEvent(e);
  if (!combo) return null;
  const order = [];
  const viewScope = SCOPE_BY_VIEW[currentView];
  if (viewScope) order.push(viewScope);
  order.push('global');
  for (const scope of order) {
    const hit = SHORTCUT_DEFS.find((d) => d.scope === scope && getBinding(d.id) === combo);
    if (hit) return hit;
  }
  return null;
}

/** 注册某作用域的处理函数（视图挂载时调用），返回注销函数 */
export function registerScopeHandler(scope, fn) {
  scopeHandlers.set(scope, fn);
  return () => {
    if (scopeHandlers.get(scope) === fn) scopeHandlers.delete(scope);
  };
}

export function getScopeHandler(scope) {
  return scopeHandlers.get(scope) || null;
}
