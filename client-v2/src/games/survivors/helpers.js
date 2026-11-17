/**
 * 刷怪肉鸽通用小工具：最佳成绩存储、时间格式化与随机数。
 */

export const BEST_KEY = 'survivorsBest';

export function loadBest() {
  try {
    const raw = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    return {
      time: Number(raw.time) || 0,
      kills: Number(raw.kills) || 0,
    };
  } catch (e) {
    return { time: 0, kills: 0 };
  }
}

export function saveBest(best) {
  return setBest(best);
}

/** 写入最佳纪录（云存档同步用），返回是否写入成功 */
export function setBest(best) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best || {}));
    return true;
  } catch (e) {
    // 隐私模式下 localStorage 不可写，忽略即可
    return false;
  }
}

export function formatTime(sec) {
  const total = Math.max(0, Math.floor(sec));
  const m = String(Math.floor(total / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function rand(min, max) {
  return min + Math.random() * (max - min);
}
