/**
 * 消消乐渲染与交互（开发方案 6.2）
 *
 * 职责边界：只做「渲染 + 拖拽交换 + 动画编排」，玩法规则全部来自引擎层。
 * - 棋子绝对定位（异形 / 分仓棋盘不能靠统一 grid 布局），位置由 grid 行列映射得出
 * - 动画用 async/await 串 Promise，动画期间锁输入
 * - 引擎层不碰 DOM，本文件不写玩法规则
 */
import { ANIM, BLOCKER_KINDS, BLOCKERS, COLOR_LIMITS, LAYOUT, SPECIAL, colorScoreMultiplier } from './config.js';
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
import { shuffleBoard, swapCells } from './deadlock.js';
import { hasMatch } from './match.js';
import { createRng } from './rng.js';
import { el } from '../../utils/dom.js';
import { fitBoard } from '../../utils/responsive.js';

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
 * @param {number} [options.seed] - 覆盖默认种子（默认取 payload.id，保证同一关可复现）
 * @param {Object} [options.snapshot] - 局内续存快照（无尽模式刷新后续玩）
 * @param {Function} [options.onUpdate] - 每次状态变化回调 (info)
 * @param {Function} [options.onGameOver] - 步数用尽回调 ({ score, maxCascade })
 * @returns {Object} { grid, destroy, getState, getSnapshot, setColors, attemptSwap }
 */
export function createMatch3Board(container, options = {}) {
  const payload = options.payload || {};
  const { rows, cols } = payload;
  const cell = LAYOUT.cellSize;
  const onUpdate = options.onUpdate || (() => { });
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
    }).grid;
  }
  const rng = createRng(seed);
  if (snapshot && snapshot.rngState != null) rng.setState(snapshot.rngState);

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
  const fit = fitBoard(boardEl, container);

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
  const currentColorMult = () => (colorScaling ? colorScoreMultiplier(state.colors) : 1);

  // ---- 动画 ----
  /** 逐轮播放 消除 → 下落 → 补充 */
  async function playSteps(steps) {
    for (const step of steps) {
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
        ? resolve(grid, { rng, colors: state.colors, focus: b, colorMult: currentColorMult() })
        : resolveRainbowSwap(grid, {
          rng,
          colors: state.colors,
          rainbowIndex,
          targetIndex: target,
          colorMult: currentColorMult(),
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
  snap();

  return {
    grid,
    getState: () => ({ ...state }),
    /** 更新元素种类（无尽模式按分数升档时调用，只影响后续补充的方块） */
    setColors(next) {
      state.colors = next;
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
      collected: { ...state.collected },
      blockersCleared: state.blockersCleared,
      breakdown: mergeBreakdown(state.breakdown, null),
    }),
    attemptSwap,
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
