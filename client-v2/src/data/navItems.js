/**
 * 导航元数据（核心）
 * 一份元数据，多个消费者：导航栏、快捷键、路由表、成就分类、移动端菜单均由此派生。
 *
 * 统一游戏大厅：五子棋/围棋/象棋/贪吃蛇/AI对战/联机匹配已整合为单一「游戏」导航项。
 */

export const NAV_ITEMS = [
  // ===== 游戏（统一大厅，整合联机匹配 + AI对战 + 4 棋种）=====
  {
    id: 'games',
    type: 'game',
    name: '游戏',
    icon: '🎮',
    shortcut: 'G',
    order: 1,
  },

  // ===== 功能 =====
  {
    // 消消乐：入口已并入统一游戏大厅的「单机游戏」Tab，
    // type 用 game 使其不进入 FEATURES（导航栏不再单独展示），但路由 #/match3 仍然有效
    id: 'match3',
    type: 'game',
    name: '消消乐',
    icon: '🍬',
    shortcut: 'M',
    category: '游戏',
    order: 2,
  },
  {
    // 3D 火车驾驶：单机游戏，入口同样在「游戏 → 单机游戏」Tab 内
    id: 'train3d',
    type: 'game',
    name: '3D驾驶',
    icon: '🚆',
    category: '游戏',
    order: 3,
  },
  {
    id: 'friends',
    type: 'feature',
    name: '好友',
    icon: '💛',
    shortcut: 'H',
    category: '社交',
    order: 8,
  },
  {
    id: 'chat',
    type: 'feature',
    name: '聊天',
    icon: '💬',
    shortcut: 'C',
    category: '社交',
    order: 9,
  },
  {
    id: 'achievements',
    type: 'feature',
    name: '成就',
    icon: '🏆',
    shortcut: 'A',
    category: '辅助',
    order: 10,
    inProfile: true, // 已迁移进个人资料页，导航栏不再单独展示
  },
  {
    id: 'leaderboard',
    type: 'feature',
    name: '排行榜',
    icon: '📊',
    shortcut: 'L',
    category: '辅助',
    order: 11,
  },
  {
    id: 'spectate',
    type: 'feature',
    name: '观战',
    icon: '👁',
    shortcut: 'V',
    category: '辅助',
    order: 13,
  },
  {
    id: 'feedback',
    type: 'feature',
    name: '帮助/反馈',
    icon: '📝',
    shortcut: 'F',
    category: '辅助',
    order: 12,
  },
  {
    // 肉鸽图鉴 / 养成：不只在消消乐里能看，做成站点级整页入口（#/codex），
    // 大厅 / 任意页面点开都能查池子、花精华
    id: 'codex',
    type: 'feature',
    name: '图鉴',
    icon: '📖',
    category: '辅助',
    order: 12.5,
  },
  {
    id: 'shop',
    type: 'feature',
    name: '商城',
    icon: '🛒',
    shortcut: 'S',
    category: '辅助',
    order: 14,
    inProfile: true, // 已迁移进个人资料页，导航栏不再单独展示
  },
  {
    id: 'profile',
    type: 'feature',
    name: '个人资料',
    icon: '👤',
    shortcut: 'P',
    category: '辅助',
    order: 15,
  },
  {
    id: 'settings',
    type: 'feature',
    name: '设置',
    icon: '⚙️',
    category: '设置',
    order: 19,
  },
  {
    // 后台管理：不在导航栏展示（type 不是 feature），仅用于路由校验；
    // 入口是顶部导航的「后台」按钮 / 设置页入口，且只有管理员可见。
    id: 'admin',
    type: 'admin',
    name: '后台管理',
    icon: '🛠️',
    order: 99,
  },
  {
    id: 'themes',
    type: 'feature',
    name: '主题',
    icon: '🎨',
    shortcut: 'T',
    category: '设置',
    order: 20,
    inProfile: true, // 已迁移进个人资料页，导航栏不再单独展示
  },
  {
    id: 'shortcuts',
    type: 'feature',
    name: '快捷键',
    icon: '⌨',
    shortcut: 'K',
    category: '设置',
    order: 21,
    inProfile: true, // 已迁移进设置页，导航栏不再单独展示
  },
];

/**
 * 游戏元数据（供统一游戏大厅内部使用）
 * 4 个棋种及相关配置，不再作为独立导航项。
 */
export const GAME_META = [
  { id: 'gobang', name: '五子棋', icon: '🔴', boardSize: 15 },
  { id: 'go', name: '围棋', icon: '⚪', boardSize: 19 },
  { id: 'chinese-chess', name: '象棋', icon: '🟥', boardSize: { rows: 10, cols: 9 } },
  { id: 'snake', name: '贪吃蛇', icon: '🐍' },
];

/** 派生：全部游戏（兼容旧代码，指向统一大厅） */
export const GAMES = GAME_META;

/** 派生：全部功能（按 order 排序） */
export const FEATURES = NAV_ITEMS.filter((i) => i.type === 'feature').sort((a, b) => a.order - b.order);

/**
 * 按 id 查找导航项
 * @param {string} id
 * @returns {Object|undefined}
 */
export function findItem(id) {
  return NAV_ITEMS.find((i) => i.id === id);
}

/**
 * 旧路由 → 统一入口的映射
 * - 游戏路由 → 统一游戏大厅（联机匹配/AI对战）
 * - 已迁移模块 → 个人资料页对应 Tab
 */
export const ROUTE_ALIASES = {
  'gobang': { mode: 'online', game: 'gobang' },
  'go': { mode: 'online', game: 'go' },
  'chinese-chess': { mode: 'online', game: 'chinese-chess' },
  'snake': { mode: 'online', game: 'snake' },
  'ai-battle': { mode: 'ai' },
  'lobby': { mode: 'online' },
  'achievements': { tab: 'achievements' },
  'shop': { tab: 'shop' },
  'themes': { tab: 'themes' },
  'shortcuts': { settingsTab: 'shortcuts' },
};
