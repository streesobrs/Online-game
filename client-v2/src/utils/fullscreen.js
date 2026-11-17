/**
 * 全屏模式工具
 *
 * 优先调用原生 Fullscreen API（隐藏浏览器地址栏/状态栏）；
 * iPhone Safari 等不支持元素全屏的环境会静默失败，此时保留 CSS 沉浸式全屏
 * （fixed 铺满视口 + 隐藏导航），保证两端交互一致。
 */

const ACTIVE_CLASS = 'fs-active';
const LOCK_CLASS = 'fs-locked';

/** 当前是否处于原生全屏（兼容 webkit 前缀） */
export function isNativeFullscreen() {
  return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
}

function requestNative(node) {
  const request = node.requestFullscreen || node.webkitRequestFullscreen;
  if (!request) return Promise.resolve(false);
  try {
    const ret = request.call(node, { navigationUI: 'hide' });
    if (ret && typeof ret.then === 'function') {
      return ret.then(() => true).catch(() => false);
    }
    return Promise.resolve(true);
  } catch (err) {
    return Promise.resolve(false);
  }
}

function exitNative() {
  const exit = document.exitFullscreen || document.webkitExitFullscreen;
  if (!exit) return;
  try {
    const ret = exit.call(document);
    if (ret && typeof ret.catch === 'function') ret.catch(() => {});
  } catch (err) {
    // 忽略：已经不在原生全屏里
  }
}

/** 尝试锁定屏幕方向（仅 Android Chrome 等支持且在原生全屏下可用） */
function lockOrientation(orientation) {
  const so = screen.orientation;
  if (!so || typeof so.lock !== 'function') return Promise.resolve(false);
  try {
    const ret = so.lock(orientation);
    if (ret && typeof ret.then === 'function') return ret.then(() => true).catch(() => false);
    return Promise.resolve(true);
  } catch (err) {
    return Promise.resolve(false);
  }
}

function unlockOrientation() {
  const so = screen.orientation;
  if (!so || typeof so.unlock !== 'function') return;
  try {
    so.unlock();
  } catch (err) {
    // 忽略：未锁定过方向
  }
}

/**
 * 创建全屏控制器
 * @param {HTMLElement} target - 全屏元素（切换时挂载 fs-active 类）
 * @param {(active: boolean) => void} [onChange] - 全屏状态变化回调
 * @param {{ orientation?: 'landscape'|'portrait' }} [options] - 进入全屏后尝试锁定的屏幕方向
 * @returns {{ active: boolean, enter: Function, exit: Function, toggle: Function, destroy: Function }}
 */
export function createFullscreen(target, onChange, options = {}) {
  const { orientation = null } = options;
  let active = false;

  function apply(next) {
    if (active === next) return;
    active = next;
    target.classList.toggle(ACTIVE_CLASS, active);
    document.body.classList.toggle(LOCK_CLASS, active);
    if (typeof onChange === 'function') onChange(active);
  }

  // 用户按 Esc / 系统手势退出原生全屏时，同步移除沉浸式布局
  function onNativeChange() {
    if (!active) return;
    if (isNativeFullscreen()) return;
    apply(false);
  }

  async function enter() {
    if (active) return;
    apply(true);
    const native = await requestNative(target);
    // 锁方向必须在原生全屏成功后调用；iOS 不支持时静默失败，由 CSS 竖屏提示兜底
    if (native && orientation) await lockOrientation(orientation);
  }

  function exit() {
    if (!active) return;
    apply(false);
    unlockOrientation();
    if (isNativeFullscreen()) exitNative();
  }

  document.addEventListener('fullscreenchange', onNativeChange);
  document.addEventListener('webkitfullscreenchange', onNativeChange);

  return {
    get active() {
      return active;
    },
    enter,
    exit,
    toggle() {
      if (active) exit();
      else enter();
    },
    destroy() {
      document.removeEventListener('fullscreenchange', onNativeChange);
      document.removeEventListener('webkitfullscreenchange', onNativeChange);
      // 销毁时只清理样式，不再回调（视图可能已经卸载）
      active = false;
      target.classList.remove(ACTIVE_CLASS);
      document.body.classList.remove(LOCK_CLASS);
      unlockOrientation();
      if (isNativeFullscreen()) exitNative();
    },
  };
}
