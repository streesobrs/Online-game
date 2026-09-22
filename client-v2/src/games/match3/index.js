/**
 * 消消乐视图入口（模式选择 → 闯关 / 无尽 / 娱乐）
 *
 * 各模式独立成模块，本文件只负责模式选择与生命周期管理：
 * - 闯关：mode-level.js（关卡列表、目标、星级、进度存档）
 * - 无尽：mode-endless.js 的 endless 变体（难度分档、自由结算、局内续存）
 * - 娱乐：二级菜单，放不设目标的爽快玩法，当前有「无尽三色」与「肉鸽试炼」
 *   （mode-endless.js 的 endless3 变体，固定 3 色，成绩独立；mode-rogue.js 限步冲层）
 */
import { ENDLESS3, ENDLESS, ROGUE } from './config.js';
import { renderEndless, renderEndless3, loadBest, loadSession } from './mode-endless.js';
import { renderRogue, loadRogueBest } from './mode-rogue.js';
import { renderLevelMode, loadProgress, totalStars } from './mode-level.js';
import { loadLocalSession, onProgress, requestProgress } from './sync.js';
import { LEVEL_COUNT } from './levels.js';
import { viewRoot, el } from '../../utils/dom.js';
import { startGameActivity, stopGameActivity } from '../../core/activity.js';

/**
 * 渲染消消乐视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderMatch3(container = viewRoot()) {
  const wrap = el('section', { class: 'm3-view' });
  container.replaceChildren(wrap);
  // 消消乐为本地判定玩法，局中几乎不与服务端通信，进入本视图即开始活跃续期，
  // 否则长时间游玩会被服务端判为挂机踢下线，结算上报（match3_game_end）随之丢失
  startGameActivity();
  let modeCleanup = null;
  // 当前界面若为菜单（模式选择 / 娱乐），服务端进度到达时直接重绘；
  // 进入具体模式后置空，交给各模式模块自己刷新，避免打断对局
  let currentScreen = null;

  function disposeMode() {
    if (modeCleanup) {
      modeCleanup();
      modeCleanup = null;
    }
    currentScreen = null;
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
    currentScreen = renderMenu;
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
  /** 肉鸽卡片副标题：有未结算的一轮就提示续玩，否则显示历史最佳 */
  function rogueMeta() {
    const session = loadLocalSession(ROGUE.type);
    if (session) return `未结算的一轮：第 ${session.floor} 层（点击继续）`;
    const best = loadRogueBest();
    if (best.maxFloor <= 0) return '限步冲层 · 每层三选一祝福';
    return `最深 ${best.maxFloor} 层 · 最高分 ${best.highScore}`;
  }

  function renderFunView() {
    disposeMode();
    currentScreen = renderFunView;
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

  // 进度以服务端为准：进入消消乐先拉一次，菜单上的「已通关 N 关」与最佳分才不会显示成空
  const offProgress = onProgress(() => currentScreen?.());
  renderMenu();
  requestProgress();

  return () => {
    offProgress();
    disposeMode();
    stopGameActivity();
    wrap.remove();
  };
}
