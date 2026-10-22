/**
 * 全局界面偏好（localStorage）
 * 与 layouts/mode.js 的导航偏好（nav-topbar / nav-account）分开存放，
 * 但统一由「设置页」（features/settings）管理。
 *
 * - animEnabled：动画总开关
 * - animSpeed：动画速率倍率（0.5x ~ 2x）
 * - toastPosition：提示条位置（top-right / top-left / bottom-right / bottom-left / top-center / bottom-center）
 * - toastDuration：提示条停留时长（毫秒）
 * - startPage：打开站点时默认落在哪一页
 * - floatChat：右下角悬浮聊天坞
 * - friendBadge：好友申请红点
 * - friendToast：好友申请弹窗提示
 * - lastMove：棋盘最后一步标记
 */

const ANIM_ENABLED_KEY = 'ui-anim-enabled';
const ANIM_SPEED_KEY = 'ui-anim-speed';
const DENSITY_KEY = 'ui-density';
const TOAST_POS_KEY = 'ui-toast-pos';
const TOAST_DIR_KEY = 'ui-toast-dir';
const TOAST_DURATION_KEY = 'ui-toast-duration';
const START_PAGE_KEY = 'ui-start-page';
const FLOAT_CHAT_KEY = 'ui-float-chat';
const FRIEND_BADGE_KEY = 'ui-friend-badge';
const FRIEND_TOAST_KEY = 'ui-friend-toast';
const LAST_MOVE_KEY = 'ui-last-move';

// 旧版偏好，读取时迁移
const LEGACY_MOTION_KEY = 'ui-motion';
const LEGACY_REDUCE_MOTION_KEY = 'ui-reduce-motion';

/** 启动页可选值（必须都能在 NAV_ITEMS 里找到对应路由） */
export const START_PAGE_OPTIONS = [
  { id: 'games', name: '游戏大厅', icon: '🎮' },
  { id: 'match3', name: '消消乐', icon: '🍬' },
  { id: 'friends', name: '好友', icon: '💛' },
  { id: 'profile', name: '个人资料', icon: '👤' },
];

/** 动画速率可选值 */
export const ANIM_SPEED_OPTIONS = [
  { id: '0.5', name: '0.5x（很慢）' },
  { id: '0.75', name: '0.75x' },
  { id: '1', name: '1x（标准）' },
  { id: '1.25', name: '1.25x' },
  { id: '1.5', name: '1.5x' },
  { id: '2', name: '2x（很快）' },
];

/** 界面密度可选值 */
export const DENSITY_OPTIONS = [
  { id: 'standard', name: '标准' },
  { id: 'compact', name: '紧凑（一屏显示更多）' },
];

/** 提示条位置可选值 */
export const TOAST_POSITION_OPTIONS = [
  { id: 'top-right', name: '右上角（默认）' },
  { id: 'top-center', name: '顶部居中' },
  { id: 'top-left', name: '左上角' },
  { id: 'bottom-right', name: '右下角' },
  { id: 'bottom-center', name: '底部居中' },
  { id: 'bottom-left', name: '左下角' },
];

/** 提示条弹出方向可选值（auto = 跟着位置走） */
export const TOAST_DIRECTION_OPTIONS = [
  { id: 'auto', name: '自动（跟随位置）' },
  { id: 'down', name: '从上方滑入' },
  { id: 'up', name: '从下方滑入' },
  { id: 'left', name: '从左侧滑入' },
  { id: 'right', name: '从右侧滑入' },
  { id: 'fade', name: '原地淡入' },
];

/** 提示条停留时长可选值 */
export const TOAST_DURATION_OPTIONS = [
  { id: '2000', name: '2 秒' },
  { id: '3000', name: '3 秒（默认）' },
  { id: '5000', name: '5 秒' },
  { id: '8000', name: '8 秒' },
];

const DEFAULT_START_PAGE = 'games';
const DEFAULT_ANIM_SPEED = 1;
const DEFAULT_DENSITY = 'standard';
const DEFAULT_TOAST_POSITION = 'top-right';
const DEFAULT_TOAST_DIRECTION = 'auto';
const DEFAULT_TOAST_DURATION = 3000;

/** 读取动画开关 / 速率（含旧版三档动画设置的迁移） */
function readAnim() {
  const legacy = localStorage.getItem(LEGACY_MOTION_KEY);
  const legacyReduce = localStorage.getItem(LEGACY_REDUCE_MOTION_KEY);

  let enabled = localStorage.getItem(ANIM_ENABLED_KEY) !== '0';
  if (legacy === 'off' || legacyReduce === '1') enabled = false;

  const savedSpeed = parseFloat(localStorage.getItem(ANIM_SPEED_KEY));
  // 旧版「精简」相当于 1.5x
  const speed = Number.isFinite(savedSpeed) && savedSpeed > 0
    ? savedSpeed
    : (legacy === 'lite' ? 1.5 : DEFAULT_ANIM_SPEED);

  return { enabled, speed };
}

function readChoice(key, options, fallback) {
  const saved = localStorage.getItem(key);
  return options.some((o) => o.id === saved) ? saved : fallback;
}

/** 读取当前界面偏好 */
export function getUiPrefs() {
  const { enabled, speed } = readAnim();
  return {
    animEnabled: enabled,
    animSpeed: speed,
    density: readChoice(DENSITY_KEY, DENSITY_OPTIONS, DEFAULT_DENSITY),
    toastPosition: readChoice(TOAST_POS_KEY, TOAST_POSITION_OPTIONS, DEFAULT_TOAST_POSITION),
    toastDirection: readChoice(TOAST_DIR_KEY, TOAST_DIRECTION_OPTIONS, DEFAULT_TOAST_DIRECTION),
    toastDuration: parseInt(readChoice(TOAST_DURATION_KEY, TOAST_DURATION_OPTIONS, String(DEFAULT_TOAST_DURATION)), 10),
    startPage: readChoice(START_PAGE_KEY, START_PAGE_OPTIONS, DEFAULT_START_PAGE),
    // 下面几项默认开启：只有显式关掉（存 '0'）才隐藏
    floatChat: localStorage.getItem(FLOAT_CHAT_KEY) !== '0',
    friendBadge: localStorage.getItem(FRIEND_BADGE_KEY) !== '0',
    friendToast: localStorage.getItem(FRIEND_TOAST_KEY) !== '0',
    lastMove: localStorage.getItem(LAST_MOVE_KEY) !== '0',
  };
}

/**
 * 写入偏好并立即生效（只传要改的项）
 * @param {{animEnabled?: boolean, animSpeed?: number, toastPosition?: string, toastDuration?: number, startPage?: string, floatChat?: boolean, friendBadge?: boolean, friendToast?: boolean, lastMove?: boolean}} patch
 */
export function setUiPrefs(patch) {
  if (patch.animEnabled !== undefined) {
    localStorage.setItem(ANIM_ENABLED_KEY, patch.animEnabled ? '1' : '0');
    localStorage.removeItem(LEGACY_MOTION_KEY);
    localStorage.removeItem(LEGACY_REDUCE_MOTION_KEY);
  }
  if (patch.animSpeed !== undefined) {
    localStorage.setItem(ANIM_SPEED_KEY, String(patch.animSpeed));
    localStorage.removeItem(LEGACY_MOTION_KEY);
    localStorage.removeItem(LEGACY_REDUCE_MOTION_KEY);
  }
  if (patch.density !== undefined) localStorage.setItem(DENSITY_KEY, patch.density);
  if (patch.toastPosition !== undefined) localStorage.setItem(TOAST_POS_KEY, patch.toastPosition);
  if (patch.toastDirection !== undefined) localStorage.setItem(TOAST_DIR_KEY, patch.toastDirection);
  if (patch.toastDuration !== undefined) localStorage.setItem(TOAST_DURATION_KEY, String(patch.toastDuration));
  if (patch.startPage !== undefined) localStorage.setItem(START_PAGE_KEY, patch.startPage);

  const boolKeys = {
    floatChat: FLOAT_CHAT_KEY,
    friendBadge: FRIEND_BADGE_KEY,
    friendToast: FRIEND_TOAST_KEY,
    lastMove: LAST_MOVE_KEY,
  };
  Object.entries(boolKeys).forEach(([field, key]) => {
    if (patch[field] !== undefined) localStorage.setItem(key, patch[field] ? '1' : '0');
  });
  applyUiPrefs();
}

/** 恢复默认界面偏好 */
export function resetUiPrefs() {
  [
    ANIM_ENABLED_KEY, ANIM_SPEED_KEY, DENSITY_KEY, TOAST_POS_KEY, TOAST_DIR_KEY, TOAST_DURATION_KEY, START_PAGE_KEY,
    FLOAT_CHAT_KEY, FRIEND_BADGE_KEY, FRIEND_TOAST_KEY, LAST_MOVE_KEY,
    LEGACY_MOTION_KEY, LEGACY_REDUCE_MOTION_KEY,
  ].forEach((key) => localStorage.removeItem(key));
  applyUiPrefs();
}

/** 把需要作用于全局的偏好落到 body 上（启动时调一次，改动后立即再调） */
export function applyUiPrefs() {
  const prefs = getUiPrefs();
  const body = document.body;

  body.classList.toggle('anim-off', !prefs.animEnabled);
  // 非 1x 时才用全局速率覆盖，避免无谓的 !important
  body.classList.toggle('anim-custom', prefs.animEnabled && prefs.animSpeed !== 1);
  body.style.setProperty('--anim-speed', String(prefs.animSpeed));

  body.classList.toggle('density-compact', prefs.density === 'compact');
  body.classList.toggle('hide-float-dock', !prefs.floatChat);
  body.classList.toggle('hide-friend-badge', !prefs.friendBadge);
  body.classList.toggle('hide-last-move', !prefs.lastMove);

  // 通知常驻组件（toast）等即时刷新
  window.dispatchEvent(new CustomEvent('ui:prefs-changed'));
}

/** 启动页：路由在没有 hash 时使用 */
export function getStartPage() {
  return getUiPrefs().startPage;
}
