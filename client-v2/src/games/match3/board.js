/**
 * 消消乐渲染与交互（开发方案 6.2）
 *
 * 职责边界：只做「渲染 + 拖拽交换 + 动画编排」，玩法规则全部来自引擎层。
 * - 棋子绝对定位（异形 / 分仓棋盘不能靠统一 grid 布局），位置由 grid 行列映射得出
 * - 动画用 async/await 串 Promise，动画期间锁输入
 * - 引擎层不碰 DOM，本文件不写玩法规则
 */
import { ANIM, BLOCKER_KINDS, BLOCKERS, COLOR_LIMITS, LAYOUT, SCORE, SPECIAL, colorScoreMultiplier } from './config.js';
import {
  colOf,
  createGrid,
  index as idx,
  isPlayable,
  isPlayableIndex,
  rowOf,
  setAt,
  toPixel,
} from './grid.js';
import { createInitialBoard, mergeBreakdown, resolve, resolveRainbowSwap } from './cascade.js';
import { shuffleBoard, findValidMove, swapCells } from './deadlock.js';
import { hasMatch } from './match.js';
import { makeSpecial } from './special.js';
import { createRng } from './rng.js';
import { el } from '../../utils/dom.js';

/** 特殊元素在棋子上的标记（彩球用配色表示，不叠符号） */
const SPECIAL_MARK = {
  [SPECIAL.ROW]: '↔',
  [SPECIAL.COL]: '↕',
  [SPECIAL.BOMB]: '💣',
};

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * 创建消消乐棋盘
 * @param {HTMLElement} container - 挂载容器
 * @param {Object} options
 * @param {Object} options.payload - 关卡 payload（纯数据，见开发方案 4.5）
 *   通用字段：rows / cols / mask / colors / moves / blockers / id；
 *   可选表现与规则字段：colorScaling（按颜色数缩放得分，仅无尽模式）、
 *   scoreMult（额外得分倍率，肉鸽模式的自选祝福用）、cascadeMax（连锁倍率上限，默认 SCORE.cascadeMax）、
 *   specials（开局注入的特殊元素，形如 [{ kind, count }]，肉鸽模式的「军火库」类祝福用）、
 *   colorWeights（各颜色的出现权重数组，缺省等概率，肉鸽模式的「同色磁石」祝福用）
 * @param {number} [options.seed] - 覆盖默认种子（默认取 payload.id，保证同一关可复现）
 * @param {Object} [options.snapshot] - 局内续存快照（无尽模式刷新后续玩）
 * @param {Function} [options.onUpdate] - 每次状态变化回调 (info)
 * @param {Function} [options.onStep] - 连锁逐层回调 ({ cascade, gained, stepGained, cleared })，用于实时连消 / 本步得分
 * @param {Function} [options.onGameOver] - 步数用尽回调 ({ score, maxCascade })
 * @returns {Object} { grid, destroy, getState, getSnapshot, setColors, attemptSwap }
 */
export function createMatch3Board(container, options = {}) {
  const payload = options.payload || {};
  const { rows, cols } = payload;
  // 单元格边长：随容器自适应取整数像素（见 fitBoardCells）。
  // 刻意不用 zoom / scale 整体缩放棋盘——小数缩放会让棋子的渐变、圆角与内阴影
  // 落在半像素上，渲染发虚并出现重影，且各设备可用宽度不同、缩放比不同导致观感不一致
  let cell = LAYOUT.cellSize;
  const onUpdate = options.onUpdate || (() => { });
  const onStep = options.onStep || (() => { });
  const onGameOver = options.onGameOver || (() => { });
  const movesLimit = Number.isFinite(payload.moves) ? payload.moves : Infinity;
  const snapshot = options.snapshot || null;

  // 关卡 id 作默认种子：同一 payload 反复加载得到完全相同的局面（开发方案 4.5）
  const seed = options.seed == null ? (Number.isFinite(payload.id) ? payload.id : 1) : options.seed;

  let grid;
  if (snapshot && Array.isArray(snapshot.cells) && snapshot.cells.length === rows * cols) {
    grid = createGrid({ rows, cols, mask: payload.mask || null });
    snapshot.cells.forEach((saved, i) => setAt(grid, i, saved ? { ...saved } : null));
  } else {
    grid = createInitialBoard({
      rows,
      cols,
      mask: payload.mask || null,
      colors: payload.colors || COLOR_LIMITS.default,
      seed,
      blockers: payload.blockers || null,
      weights: payload.colorWeights || null,
    }).grid;
  }
  const rng = createRng(seed);
  if (snapshot && snapshot.rngState != null) rng.setState(snapshot.rngState);

  /**
   * 开局注入特殊元素（肉鸽模式的「军火库 / 爆破专家 / 彩球礼物」祝福）
   * 在已有糖果上就地加标记、不动颜色，因此不会凭空造出连线；
   * 注入后若全盘再无可行步（概率极低），重排一次，与引擎其它位置的兜底策略一致
   */
  function injectSpecials(list) {
    const kinds = [];
    for (const item of list) {
      for (let n = 0; n < (item.count || 0); n += 1) kinds.push(item.kind);
    }
    const candidates = grid.cellIndex.filter((i) => {
      const cell = grid.cells[i];
      return cell && !cell.blocker && cell.special == null;
    });
    for (const kind of kinds) {
      if (candidates.length === 0) return;
      const [i] = candidates.splice(rng.int(candidates.length), 1);
      setAt(grid, i, makeSpecial(kind, grid.cells[i].color));
    }
    if (kinds.length > 0 && !findValidMove(grid)) shuffleBoard(grid, rng);
  }

  // 续存快照里的格子已经带着特殊标记，不重复注入
  if (!snapshot) injectSpecials(payload.specials || []);

  const state = {
    colors: snapshot?.colors || payload.colors || COLOR_LIMITS.default,
    score: snapshot?.score || 0,
    maxCascade: snapshot?.maxCascade || 0,
    cleared: snapshot?.cleared || 0,
    moves: snapshot?.moves || 0,
    movesLeft: snapshot?.movesLeft == null ? movesLimit : snapshot.movesLeft,
    collected: snapshot?.collected || {}, // 各颜色累计消除数（collect 目标用）
    blockersCleared: snapshot?.blockersCleared || 0, // 累计击碎障碍数（clearBlockers 目标用）
    breakdown: mergeBreakdown(snapshot?.breakdown, null), // 分数构成（积分详情用）
    busy: false,
    over: false,
    selected: null,
    disposed: false,
  };

  // ---- DOM ----
  const boardEl = el('div', { class: 'm3-board' });
  boardEl.style.width = `${cols * cell}px`;
  boardEl.style.height = `${rows * cell}px`;
  boardEl.style.setProperty('--m3-cell', `${cell}px`);
  const cellEls = new Map();
  for (const i of grid.cellIndex) {
    const node = el('div', { class: 'm3-cell', 'data-index': i }, el('span', { class: 'm3-gem' }));
    cellEls.set(i, node);
    boardEl.appendChild(node);
  }
  container.appendChild(boardEl);

  // 棋盘浮层反馈（连消 / 本步得分）：盖在棋子之上、不拦截指针，飘一次即自行移除
  const floatEl = el('div', { class: 'm3-floats' });
  boardEl.appendChild(floatEl);
  function popFloat(text, variant) {
    if (state.disposed) return;
    const node = el('span', { class: `m3-float m3-float--${variant}` }, text);
    node.addEventListener('animationend', () => node.remove());
    floatEl.appendChild(node);
  }

  const posOf = (i) => {
    const { x, y } = toPixel(grid, rowOf(grid, i), colOf(grid, i), cell);
    return `translate(${x}px, ${y}px)`;
  };
  const setPos = (node, i) => {
    if (node) node.style.transform = posOf(i);
  };
  const setDur = (ms) => boardEl.style.setProperty('--m3-dur', `${ms}ms`);

  /** 把棋子内容画到节点上 */
  function paint(node, content) {
    if (!node) return;
    const gem = node.firstChild;
    node.classList.remove('m3-clearing', 'm3-selected', 'm3-hit');
    if (!content) {
      gem.className = 'm3-gem m3-empty';
      gem.textContent = '';
      return;
    }
    // 障碍格不承载糖果，单独一套表现（显示剩余 hp）
    if (content.blocker) {
      const meta = BLOCKERS[content.blocker.kind] || BLOCKERS[BLOCKER_KINDS[0]];
      gem.className = `m3-gem m3-blocker m3-blocker-${content.blocker.kind}`;
      gem.textContent = meta.label;
      node.dataset.hp = String(content.blocker.hp);
      return;
    }
    delete node.dataset.hp;
    const rainbow = content.special === SPECIAL.RAINBOW;
    const special = content.special && !rainbow ? ` m3-special m3-special-${content.special}` : '';
    gem.className = `m3-gem ${rainbow ? 'm3-rainbow' : `m3-c${content.color}`}${special}`;
    gem.textContent = SPECIAL_MARK[content.special] || '';
  }

  /** 无动画对齐：位置与内容一次性同步到当前 grid（视觉上瞬时完成） */
  function snap() {
    if (state.disposed) return;
    boardEl.classList.add('m3-no-anim');
    for (const [i, node] of cellEls) {
      node.style.transform = posOf(i);
      paint(node, grid.cells[i]);
    }
    void boardEl.offsetHeight;
    boardEl.classList.remove('m3-no-anim');
  }

  /**
   * 棋盘自适应：按容器可用宽度取「整数」格边长后整体重排，不做任何整体缩放。
   *
   * 与棋类棋盘（go/gobang/chinese-chess）的处理保持一致：缩放整个棋盘会让棋子
   * 落不到整像素上，渐变与描边被半像素混合后发虚、出现重影，且不同设备可用宽度
   * 不同、缩放比不同，同一颗棋子的观感就会不一致。
   */
  function fitBoardCells() {
    const MIN_CELL = 28; // 触控最小可点尺寸
    const MAX_CELL = LAYOUT.cellSize; // 设计尺寸，只缩不放

    function apply() {
      const avail = (container && container.clientWidth) || window.innerWidth;
      if (!avail) return;
      const next = Math.max(MIN_CELL, Math.min(MAX_CELL, Math.floor(avail / cols)));
      if (next === cell) return;
      cell = next;
      boardEl.style.setProperty('--m3-cell', `${cell}px`);
      boardEl.style.width = `${cols * cell}px`;
      boardEl.style.height = `${rows * cell}px`;
      snap(); // 格边长变了：位置与内容一次性重排
    }

    apply();
    requestAnimationFrame(apply); // 挂载后布局稳定，再量一次
    window.addEventListener('resize', apply);

    return {
      refresh: apply,
      destroy() {
        window.removeEventListener('resize', apply);
      },
    };
  }

  /** 当前状态的可读快照（onUpdate 与 onGameOver 共用同一份字段，避免两条路径口径不一致） */
  function snapshotInfo(extra = {}) {
    return {
      score: state.score,
      maxCascade: state.maxCascade,
      cleared: state.cleared,
      moves: state.moves,
      colors: state.colors,
      movesLeft: state.movesLeft,
      collected: { ...state.collected },
      blockersCleared: state.blockersCleared,
      breakdown: mergeBreakdown(state.breakdown, null),
      ...extra,
    };
  }

  function emit(extra = {}) {
    onUpdate(snapshotInfo(extra));
  }

  // 颜色数得分倍率：仅无尽模式启用（payload.colorScaling）。
  // 闯关关卡的颜色数与目标值已逐关标定，不能再缩放，故默认关闭。
  const colorScaling = payload.colorScaling === true;
  // 额外得分倍率：肉鸽模式的自选祝福在此累乘（与颜色数倍率同时生效）。
  // 用 let 是因为肉鸽的局内任务奖励（「狂暴」）会在层中临时抬高它，见 setScoreMult
  let scoreMult = Number.isFinite(payload.scoreMult) && payload.scoreMult > 0 ? payload.scoreMult : 1;
  // 续存快照里的倍率优先于开局 payload：肉鸽的局内任务「狂暴」会在层中抬过它，
  // 不还原的话「刷新一下奖励就没了」（见 setScoreMult）
  if (snapshot && Number.isFinite(snapshot.scoreMult) && snapshot.scoreMult > 0) {
    scoreMult = snapshot.scoreMult;
  }
  // 连锁倍率上限：肉鸽模式的「连环爆发」祝福可抬高，默认与全局配置一致
  const cascadeMax = Number.isFinite(payload.cascadeMax) ? payload.cascadeMax : SCORE.cascadeMax;
  // 各颜色的出现权重（肉鸽的「同色磁石」祝福），缺省等概率
  const weights = payload.colorWeights || null;
  const currentColorMult = () => (colorScaling ? colorScoreMultiplier(state.colors) : 1) * scoreMult;

  // ---- 动画 ----
  /** 逐轮播放 消除 → 下落 → 补充 */
  async function playSteps(steps) {
    let gained = 0; // 本步（玩家一次操作）累计得分：连锁中逐层累加，实时反馈用
    for (const step of steps) {
      gained += step.gained;
      onStep({ cascade: step.cascade, gained, stepGained: step.gained, cleared: step.cleared.length });
      popFloat(`+${gained}`, 'score');
      if (step.cascade >= 2) popFloat(`连消 ×${step.cascade}`, 'combo');

      setDur(ANIM.clear);
      step.cleared.forEach((i) => cellEls.get(i)?.classList.add('m3-clearing'));
      // 障碍受击：抖动一下再按新 hp 重绘（碎裂的那格随后变成空格）
      const hit = [...step.damagedBlockers, ...step.removedBlockers];
      hit.forEach((i) => cellEls.get(i)?.classList.add('m3-hit'));
      if (step.cleared.length || hit.length) await wait(ANIM.clear);
      if (state.disposed) return;

      // 新方块先摆到该列上方（无动画），再与已有方块一起下落
      boardEl.classList.add('m3-no-anim');
      const stacked = new Map();
      for (const item of step.added) {
        const c = colOf(grid, item.index);
        const k = (stacked.get(c) || 0) + 1;
        stacked.set(c, k);
        const node = cellEls.get(item.index);
        paint(node, item.cell);
        node.style.transform = `translate(${c * cell}px, ${(rowOf(grid, item.index) - k) * cell}px)`;
      }
      void boardEl.offsetHeight;
      boardEl.classList.remove('m3-no-anim');

      setDur(ANIM.fall);
      step.moves.forEach((mv) => setPos(cellEls.get(mv.from), mv.to));
      step.added.forEach((item) => setPos(cellEls.get(item.index), item.index));
      await wait(ANIM.fall);
      if (state.disposed) return;
      snap();
    }
  }

  /** 死局洗牌：整盘淡出 → 重排（区域粒度由引擎决定）→ 淡入 */
  async function reshuffle() {
    setDur(ANIM.clear);
    boardEl.classList.add('m3-shuffling');
    await wait(ANIM.clear);
    if (state.disposed) return;
    shuffleBoard(grid, rng);
    snap();
    boardEl.classList.remove('m3-shuffling');
    await wait(ANIM.clear);
  }

  // ---- 交换 ----
  async function attemptSwap(a, b) {
    if (state.busy || state.over || state.disposed) return false;
    if (a == null || b == null || a === b) return false;
    if (!isPlayableIndex(grid, a) || !isPlayableIndex(grid, b)) return false;
    if (grid.cells[a]?.blocker || grid.cells[b]?.blocker) return false; // 障碍不可交换
    const adjacent =
      Math.abs(rowOf(grid, a) - rowOf(grid, b)) + Math.abs(colOf(grid, a) - colOf(grid, b)) === 1;
    if (!adjacent) return false;

    state.busy = true;
    state.selected = null;

    swapCells(grid, a, b);
    setDur(ANIM.swap);
    setPos(cellEls.get(a), b);
    setPos(cellEls.get(b), a);
    await wait(ANIM.swap);
    if (state.disposed) return false;

    const rainbowIndex = [a, b].find((i) => grid.cells[i]?.special === SPECIAL.RAINBOW);
    const target = rainbowIndex === a ? b : a;

    // 非法交换：数据与视觉一并回弹
    if (rainbowIndex == null && !hasMatch(grid)) {
      swapCells(grid, a, b);
      setPos(cellEls.get(a), a);
      setPos(cellEls.get(b), b);
      await wait(ANIM.swap);
      snap();
      state.busy = false;
      emit({ valid: false });
      return false;
    }

    snap(); // 交换后视觉已与数据一致，后续统一按「节点停在自己格子上」处理

    const result =
      rainbowIndex == null
        ? resolve(grid, { rng, colors: state.colors, focus: b, colorMult: currentColorMult(), cascadeMax, weights })
        : resolveRainbowSwap(grid, {
          rng,
          colors: state.colors,
          rainbowIndex,
          targetIndex: target,
          colorMult: currentColorMult(),
          cascadeMax,
          weights,
        });

    state.score += result.gained;
    state.maxCascade = Math.max(state.maxCascade, result.maxCascade);
    state.moves += 1;
    state.movesLeft -= 1;
    state.blockersCleared += result.blockersCleared;
    state.breakdown = mergeBreakdown(state.breakdown, result.breakdown);
    for (const [color, count] of Object.entries(result.colors)) {
      state.collected[color] = (state.collected[color] || 0) + count;
    }
    result.steps.forEach((step) => {
      state.cleared += step.cleared.length;
    });

    await playSteps(result.steps);
    if (state.disposed) return false;

    let shuffled = false;
    if (!result.resolvable) {
      await reshuffle();
      shuffled = true;
    }
    if (state.disposed) return false;

    state.busy = false;
    emit({ valid: true, gained: result.gained, cascade: result.maxCascade, shuffled });
    if (state.movesLeft <= 0) {
      state.over = true;
      onGameOver(snapshotInfo());
    }
    return true;
  }

  // ---- 输入（拖拽交换 + 点击两次交换）----
  let drag = null;

  function onDown(e) {
    if (state.busy || state.over || state.disposed) return;
    const node = e.target.closest('.m3-cell');
    if (!node) return;
    const index = Number(node.dataset.index);
    if (grid.cells[index]?.blocker) return; // 障碍格不参与选择与拖拽
    e.preventDefault();
    drag = { index, x: e.clientX, y: e.clientY };
  }

  function onMove(e) {
    if (!drag || state.busy || state.disposed) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.abs(dx) < LAYOUT.dragThreshold && Math.abs(dy) < LAYOUT.dragThreshold) return;

    const from = drag.index;
    drag = null;
    const r = rowOf(grid, from);
    const c = colOf(grid, from);
    const nr = Math.abs(dx) >= Math.abs(dy) ? r : r + (dy > 0 ? 1 : -1);
    const nc = Math.abs(dx) >= Math.abs(dy) ? c + (dx > 0 ? 1 : -1) : c;
    if (!isPlayable(grid, nr, nc)) return;
    attemptSwap(from, idx(grid, nr, nc));
  }

  function onUp() {
    if (!drag) return;
    const { index: i } = drag;
    drag = null;
    if (state.busy || state.over || state.disposed) return;

    if (state.selected == null) {
      state.selected = i;
      cellEls.get(i)?.classList.add('m3-selected');
      return;
    }
    const first = state.selected;
    state.selected = null;
    cellEls.get(first)?.classList.remove('m3-selected');
    if (first !== i) attemptSwap(first, i);
  }

  boardEl.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  const fit = fitBoardCells();
  snap();

  return {
    grid,
    getState: () => ({ ...state }),
    /** 更新元素种类（无尽模式按分数升档时调用，只影响后续补充的方块） */
    setColors(next) {
      state.colors = next;
    },
    /**
     * 层中改写得分倍率（肉鸽的局内任务奖励「狂暴」用：本层剩余步数内得分翻倍）
     * 只影响之后的结算，已经落袋的分数不回滚
     */
    setScoreMult(next) {
      if (Number.isFinite(next) && next > 0) scoreMult = next;
    },
    /**
     * 层中就地注入特殊元素（肉鸽的局内任务奖励「爆破 / 彩球」用）
     * 与开局注入同一套逻辑：在已有糖果上加标记、不动颜色，不会凭空造出连线
     */
    addSpecials(list) {
      if (state.disposed || !Array.isArray(list) || list.length === 0) return;
      injectSpecials(list);
      snap();
    },
    /** 局内续存快照（纯数据，可直接 JSON 序列化） */
    getSnapshot: () => ({
      seed,
      rngState: rng.getState(),
      colors: state.colors,
      cells: grid.cells.map((item) =>
        item
          ? {
            color: item.color,
            special: item.special,
            blocker: item.blocker ? { ...item.blocker } : null,
          }
          : null,
      ),
      score: state.score,
      maxCascade: state.maxCascade,
      cleared: state.cleared,
      moves: state.moves,
      movesLeft: state.movesLeft,
      scoreMult, // 层中被改过的倍率（肉鸽的局内任务奖励），不带上就还原不回来
      collected: { ...state.collected },
      blockersCleared: state.blockersCleared,
      breakdown: mergeBreakdown(state.breakdown, null),
    }),
    attemptSwap,
    /**
     * 追加步数并重新激活棋盘（肉鸽模式的「免死金牌」等祝福用）
     * 步数用尽时引擎已把棋盘置为 over，这里补足步数后要一并解锁
     */
    addMoves(count) {
      const n = Math.max(0, Math.floor(count || 0));
      if (n === 0 || state.disposed) return;
      state.movesLeft += n;
      if (state.movesLeft > 0) state.over = false;
      emit();
    },
    /** 免费洗牌（不消耗步数）：肉鸽模式的「备用洗牌」祝福用 */
    async shuffle() {
      if (state.busy || state.over || state.disposed) return false;
      state.busy = true;
      state.selected = null;
      await reshuffle();
      state.busy = false;
      if (state.disposed) return false;
      emit({ shuffled: true });
      return true;
    },
    /** 锁定输入（自由结算 / 步数用尽后，棋盘保持可见但不再接受操作） */
    lock() {
      state.over = true;
    },
    destroy() {
      state.disposed = true;
      boardEl.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      fit.destroy();
      boardEl.remove();
    },
  };
}
