/**
 * 刷怪肉鸽通用小工具：最佳成绩存储、时间格式化与随机数。
 */
import { el } from '../../utils/dom.js';

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

/**
 * 把文案中的数值包成高亮 span，便于在说明文字里快速扫读。
 * 支持正负号、小数与百分号，例如 -7.5%、×1.30、190~300。
 * @param {string} text
 * @returns {Array<string|HTMLElement>}
 */
export function highlightNumbers(text) {
  const str = String(text ?? '');
  const parts = [];
  const re = /[+-]?\d+(?:\.\d+)?%?/g;
  let last = 0;
  for (const match of str.matchAll(re)) {
    if (match.index > last) parts.push(str.slice(last, match.index));
    parts.push(el('span', { class: 'sv-num' }, match[0]));
    last = match.index + match[0].length;
  }
  if (last < str.length) parts.push(str.slice(last));
  return parts;
}
