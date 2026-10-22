/**
 * 界面自定义开关组（导航栏 / 账号入口）
 * 新手引导气泡、设置页（#/settings）共用，拨动即时生效。
 */
import { el } from '../utils/dom.js';
import { getNavPrefs, setNavPrefs } from '../layouts/mode.js';

/**
 * 单个开关行：左侧名称+说明，右侧拨动开关（整行可点）
 * 设置页的其它开关（如「减少动效」）也复用它
 */
export function switchRow({ name, hint, checked, onChange }) {
  const input = el('input', { type: 'checkbox', checked: !!checked });
  input.addEventListener('change', () => onChange(input.checked));
  return el('label', { class: 'nav-pref-row' }, [
    el('div', { class: 'nav-pref-label' }, [
      el('span', { class: 'nav-pref-name' }, name),
      el('span', { class: 'nav-pref-hint' }, hint),
    ]),
    el('span', { class: 'nav-pref-switch' }, [input, el('span', { class: 'nav-pref-slider' })]),
  ]);
}

/**
 * 单个下拉选择行：左侧名称+说明，右侧 select（与开关行同一套排版）
 * 用于「动画效果」「界面密度」这类多选一
 */
export function selectRow({ name, hint, options, value, onChange }) {
  const select = el('select', { class: 'nav-pref-select' });
  options.forEach((opt) => {
    const option = el('option', { value: opt.id }, opt.name);
    if (opt.id === value) option.selected = true;
    select.appendChild(option);
  });
  select.addEventListener('change', () => onChange(select.value));
  return el('div', { class: 'nav-pref-row nav-pref-row--select' }, [
    el('div', { class: 'nav-pref-label' }, [
      el('span', { class: 'nav-pref-name' }, name),
      el('span', { class: 'nav-pref-hint' }, hint),
    ]),
    select,
  ]);
}

/**
 * 渲染界面自定义开关组
 * @param {Function} [onChange] - 任一开关变化后回调（如刷新引导气泡）
 * @returns {HTMLElement}
 */
export function buildNavPrefsPanel(onChange) {
  const prefs = getNavPrefs();
  const done = () => { if (typeof onChange === 'function') onChange(); };
  return el('div', { class: 'nav-prefs' }, [
    switchRow({
      name: '顶部导航栏',
      hint: '游戏 / 好友 / 聊天 / 排行榜等导航按钮',
      checked: prefs.topbar,
      onChange: (v) => { setNavPrefs({ topbar: v }); done(); },
    }),
    switchRow({
      name: '全局抽屉',
      hint: '账号信息收进右侧贴边把手；关闭则用右上角悬浮头像',
      checked: prefs.account === 'drawer',
      onChange: (v) => { setNavPrefs({ account: v ? 'drawer' : 'float' }); done(); },
    }),
  ]);
}
