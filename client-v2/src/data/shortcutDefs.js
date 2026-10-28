/**
 * 快捷键元数据（唯一数据源）
 *
 * 与 NAV_ITEMS 的关系：全局导航键的「默认键位」仍写在 navItems 的 shortcut 字段里
 * （导航栏角标、新手引导文案都读它），本文件把它派生为可自定义的「绑定定义」，
 * 并补上游戏大厅的操作键。这样键位只有一份默认值来源，不会两处维护。
 *
 * 作用域（scope）：
 * - global：全局导航，任何页面生效（输入框内不触发）
 * - games ：游戏大厅，仅 currentView === 'games' 时生效
 *
 * 冲突规则：跨作用域允许同键（互不影响，各自生效）；同作用域内唯一（个人资料里改键时校验）。
 * 优先级：当前视图对应的作用域先于 global（所以大厅里按 T 是切联机，而不是跳主题）。
 */
import { NAV_ITEMS } from './navItems.js';

/** 作用域元数据（个人资料改键页按此分组显示） */
export const SHORTCUT_SCOPES = [
  { id: 'global', name: '全局导航', desc: '任意页面生效；输入框内不触发' },
  { id: 'games', name: '游戏大厅', desc: '仅在游戏大厅生效' },
];

/** 视图 ID → 作用域 ID（决定该视图下哪个作用域优先、以及是否启用） */
export const SCOPE_BY_VIEW = {
  games: 'games',
};

/** 全局导航：由 NAV_ITEMS 派生 */
const NAV_DEFS = NAV_ITEMS
  .filter((item) => item.shortcut)
  .map((item) => ({
    id: `nav.${item.id}`,
    scope: 'global',
    name: item.inProfile ? `个人资料 · ${item.name}` : item.name,
    icon: item.icon,
    def: item.shortcut,
    view: item.id,
  }));

/**
 * 全局界面操作键（不跳转路由，由 utils/shortcut.js 按 op 分发）
 */
const UI_DEFS = [
  { id: 'ui.toggleDrawer', scope: 'global', name: '开关侧边栏菜单', icon: '📂', def: 'Tab', op: { type: 'toggleDrawer' } },
];

/**
 * 游戏大厅操作键
 * op 由 features/games/index.js 的 runLobbyShortcut 消费。
 */
const GAMES_DEFS = [
  { id: 'games.pick1', scope: 'games', name: '选择第 1 个游戏', icon: '1️⃣', def: '1', op: { type: 'pick', index: 0 } },
  { id: 'games.pick2', scope: 'games', name: '选择第 2 个游戏', icon: '2️⃣', def: '2', op: { type: 'pick', index: 1 } },
  { id: 'games.pick3', scope: 'games', name: '选择第 3 个游戏', icon: '3️⃣', def: '3', op: { type: 'pick', index: 2 } },
  { id: 'games.pick4', scope: 'games', name: '选择第 4 个游戏', icon: '4️⃣', def: '4', op: { type: 'pick', index: 3 } },
  { id: 'games.pick5', scope: 'games', name: '选择第 5 个游戏', icon: '5️⃣', def: '5', op: { type: 'pick', index: 4 } },
  { id: 'games.pick6', scope: 'games', name: '选择第 6 个游戏', icon: '6️⃣', def: '6', op: { type: 'pick', index: 5 } },
  { id: 'games.modeOnline', scope: 'games', name: '联机匹配当前游戏', icon: '🌐', def: 'T', op: { type: 'mode', mode: 'online' } },
  { id: 'games.modeAi', scope: 'games', name: 'AI 对战当前游戏', icon: '🤖', def: 'A', op: { type: 'mode', mode: 'ai' } },
  // Enter 不 preventDefault：焦点在按钮上时仍要允许 Enter 触发点击（沿用原行为）
  { id: 'games.start', scope: 'games', name: '开始匹配', icon: '▶️', def: 'Enter', op: { type: 'start' }, preventDefault: false },
  { id: 'games.cancel', scope: 'games', name: '取消匹配', icon: '⏹️', def: 'Escape', op: { type: 'cancel' } },
];

/** 全部绑定定义 */
export const SHORTCUT_DEFS = [...NAV_DEFS, ...UI_DEFS, ...GAMES_DEFS];

/** 按 id 查找定义 */
export function findDef(id) {
  return SHORTCUT_DEFS.find((d) => d.id === id) || null;
}

/** 作用域展示名 */
export function scopeName(scopeId) {
  return SHORTCUT_SCOPES.find((s) => s.id === scopeId)?.name || scopeId;
}
