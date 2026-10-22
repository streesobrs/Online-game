/**
 * 隐私开关行（设置页 / 个人资料弹窗共用）
 */
import { el } from '../utils/dom.js';
import { PRIVACY_OPTIONS } from '../data/privacyOptions.js';

/**
 * 按 PRIVACY_OPTIONS 生成开关行，改动直接写回 toggles
 * @param {Record<string, boolean>} toggles - 会被就地修改
 * @returns {HTMLElement[]}
 */
export function buildPrivacyRows(toggles) {
  return PRIVACY_OPTIONS.map((opt) => {
    const row = el('div', { class: 'privacy-row' }, [
      el('div', { class: 'privacy-row-label' }, [
        el('span', { class: 'privacy-row-name' }, opt.label),
        el('span', { class: 'privacy-row-hint' }, opt.hint),
      ]),
      // checked 只能传 true / false（el() 会跳过 false），不能用空字符串
      el('label', { class: 'privacy-switch' }, [
        el('input', { type: 'checkbox', checked: !!toggles[opt.key] }),
        el('span', { class: 'privacy-slider' }),
      ]),
    ]);
    row.querySelector('input[type=checkbox]')
      .addEventListener('change', (e) => { toggles[opt.key] = e.target.checked; });
    return row;
  });
}

/** 把服务端返回的 privacy 与默认值合并成完整开关表 */
export function mergePrivacy(serverPrivacy) {
  const toggles = {};
  PRIVACY_OPTIONS.forEach((opt) => {
    toggles[opt.key] = serverPrivacy && serverPrivacy[opt.key] !== undefined
      ? !!serverPrivacy[opt.key]
      : opt.default;
  });
  return toggles;
}
