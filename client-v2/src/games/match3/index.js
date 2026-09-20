/**
 * 消消乐视图入口（模式选择 → 闯关 / 无尽 / 娱乐）
 *
 * 各模式独立成模块，本文件只负责模式选择与生命周期管理：
 * - 闯关：mode-level.js（关卡列表、目标、星级、进度存档）
 * - 无尽：mode-endless.js 的 endless 变体（难度分档、自由结算、局内续存）
 * - 娱乐：二级菜单，放不设目标的爽快玩法，当前有「无尽三色」与「肉鸽试炼」
 *   （mode-endless.js 的 endless3 变体，固定 3 色，成绩独立；mode-rogue.js 限步冲层）
 */
import { ENDLESS3, ENDLESS } from './config.js';
import { renderEndless, renderEndless3, loadBest, loadSession } from './mode-endless.js';
import { renderRogue, loadRogueBest } from './mode-rogue.js';
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
  /** 玩法卡片的副标题：有未结算的局就提示续玩，否则显示历史最佳 */
  function bestMeta(variant) {
    const session = loadSession(variant);
    if (session) return `未结算的一局：${session.score} 分（点击继续）`;
    const best = loadBest(variant);
    return `最高分 ${best.highScore} · 最高连锁 ${best.bestCombo}`;
  }

  function renderMenu() {
    disposeMode();
    const progress = loadProgress();

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
          el('span', { class: 'm3-menu-name' }, '闯关'),
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
          el('span', { class: 'm3-menu-name' }, '无尽'),
          el('span', { class: 'm3-menu-meta' }, bestMeta(ENDLESS.type)),
        ),
        el(
          'button',
          { class: 'm3-menu-card', onClick: () => renderFunView() },
          el('span', { class: 'm3-menu-icon' }, '🎪'),
          el('span', { class: 'm3-menu-name' }, '娱乐'),
          el('span', { class: 'm3-menu-meta' }, '2 种玩法 · 无尽三色 / 肉鸽试炼'),
        ),
      ),
    );
  }

  // ---- 娱乐：二级菜单（不设目标的玩法都收在这里）----
  /** 肉鸽卡片副标题：本地记录的最深层数与最高总分 */
  function rogueMeta() {
    const best = loadRogueBest();
    if (best.maxFloor <= 0) return '限步冲层 · 每层三选一祝福';
    return `最深 ${best.maxFloor} 层 · 最高分 ${best.highScore}`;
  }

  function renderFunView() {
    disposeMode();
    wrap.replaceChildren(
      el(
        'div',
        { class: 'm3-head' },
        el('h2', { class: 'm3-title' }, '🎪 娱乐模式'),
        el('p', { class: 'm3-sub' }, '不设关卡与目标，随便玩玩'),
      ),
      el(
        'div',
        { class: 'm3-menu' },
        el(
          'button',
          { class: 'm3-menu-card', onClick: () => renderEndless3View() },
          el('span', { class: 'm3-menu-icon' }, '🧨'),
          el('span', { class: 'm3-menu-name' }, '无尽三色'),
          el('span', { class: 'm3-menu-meta' }, bestMeta(ENDLESS3.type)),
        ),
        el(
          'button',
          { class: 'm3-menu-card', onClick: () => renderRogueView() },
          el('span', { class: 'm3-menu-icon' }, '🎲'),
          el('span', { class: 'm3-menu-name' }, '肉鸽试炼'),
          el('span', { class: 'm3-menu-meta' }, rogueMeta()),
        ),
      ),
      el(
        'div',
        { class: 'm3-actions' },
        el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => renderMenu() }, '返回选择'),
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
    modeCleanup = renderEndless3(wrap, { onExit: renderFunView });
  }

  function renderRogueView() {
    disposeMode();
    modeCleanup = renderRogue(wrap, { onExit: renderFunView });
  }

  renderMenu();

  return () => {
    disposeMode();
    wrap.remove();
  };
}
