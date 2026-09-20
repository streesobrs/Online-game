/**
 * 消消乐视图入口（模式选择 → 闯关 / 无尽 / 无尽三色）
 *
 * 各模式独立成模块，本文件只负责模式选择与生命周期管理：
 * - 闯关模式：mode-level.js（关卡列表、目标、星级、进度存档）
 * - 无尽模式：mode-endless.js（难度分档、自由结算、局内续存）
 * - 无尽三色：mode-endless.js 的 endless3 变体（固定 3 色爽局，成绩独立）
 */
import { ENDLESS3, ENDLESS } from './config.js';
import { renderEndless, renderEndless3, loadBest, loadSession } from './mode-endless.js';
import { renderLevelMode, loadProgress, totalStars } from './mode-level.js';
import { LEVEL_COUNT } from './levels.js';
import { viewRoot, el } from '../../utils/dom.js';

/**
 * 渲染消消乐视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderMatch3(container = viewRoot()) {
  const wrap = el('section', { class: 'm3-view' });
  container.replaceChildren(wrap);
  let modeCleanup = null;

  function disposeMode() {
    if (modeCleanup) {
      modeCleanup();
      modeCleanup = null;
    }
  }

  // ---- 模式选择 ----
  function renderMenu() {
    disposeMode();
    const progress = loadProgress();
    const best = loadBest(ENDLESS.type);
    const session = loadSession(ENDLESS.type);
    const endlessMeta = session
      ? `未结算的一局：${session.score} 分（点击继续）`
      : `最高分 ${best.highScore} · 最高连锁 ${best.bestCombo}`;

    const best3 = loadBest(ENDLESS3.type);
    const session3 = loadSession(ENDLESS3.type);
    const endless3Meta = session3
      ? `未结算的一局：${session3.score} 分（点击继续）`
      : `最高分 ${best3.highScore} · 最高连锁 ${best3.bestCombo}`;

    wrap.replaceChildren(
      el(
        'div',
        { class: 'm3-head' },
        el('h2', { class: 'm3-title' }, '🍬 消消乐'),
        el('p', { class: 'm3-sub' }, '选择玩法'),
      ),
      el(
        'div',
        { class: 'm3-menu' },
        el(
          'button',
          { class: 'm3-menu-card', onClick: () => renderLevelView() },
          el('span', { class: 'm3-menu-icon' }, '🍭'),
          el('span', { class: 'm3-menu-name' }, '闯关模式'),
          el(
            'span',
            { class: 'm3-menu-meta' },
            `${LEVEL_COUNT} 关 · 已通关 ${Math.max(0, progress.maxLevel - 1)} · ${totalStars(progress)} ★`,
          ),
        ),
        el(
          'button',
          { class: 'm3-menu-card', onClick: () => renderEndlessView() },
          el('span', { class: 'm3-menu-icon' }, '♾'),
          el('span', { class: 'm3-menu-name' }, '无尽模式'),
          el('span', { class: 'm3-menu-meta' }, endlessMeta),
        ),
        el(
          'button',
          { class: 'm3-menu-card', onClick: () => renderEndless3View() },
          el('span', { class: 'm3-menu-icon' }, '🧨'),
          el('span', { class: 'm3-menu-name' }, '无尽三色'),
          el('span', { class: 'm3-menu-meta' }, endless3Meta),
        ),
      ),
    );
  }

  function renderLevelView() {
    disposeMode();
    modeCleanup = renderLevelMode(wrap, { onExit: renderMenu });
  }

  function renderEndlessView() {
    disposeMode();
    modeCleanup = renderEndless(wrap, { onExit: renderMenu, variant: ENDLESS.type });
  }

  function renderEndless3View() {
    disposeMode();
    modeCleanup = renderEndless3(wrap, { onExit: renderMenu });
  }

  renderMenu();

  return () => {
    disposeMode();
    wrap.remove();
  };
}
