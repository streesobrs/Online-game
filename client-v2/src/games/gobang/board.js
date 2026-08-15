/**
 * 五子棋棋盘模块（任务 2.1.1）
 * 19×19 棋盘渲染与点击落子交互（与 v1 尺寸一致，v1 五子棋为 19×19）。
 * 数据模型与 v1 一致：board[r][c] = 0 空 / 1 黑 / 2 白；黑棋先行。
 * 棋子 DOM 与 v1 一致：cell 内子元素 div.gobang-black / .gobang-white。
 */
import { el } from '../../utils/dom.js';
import { fitBoard } from '../../utils/responsive.js';

export const GO_SIZE = 19;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

/**
 * 创建五子棋棋盘
 * @param {HTMLElement} container - 棋盘挂载容器
 * @param {Object} [options]
 * @param {(r: number, c: number, color: number) => void} [options.onPlace]
 *        落子回调：外部接管落子流程（联机/AI）时使用；
 *        未提供时走本地交替模式（点击自动落子并轮换颜色）。
 * @returns {Object} 棋盘 API
 */
export function createBoard(container, options = {}) {
  const size = GO_SIZE;
  let board = Array.from({ length: size }, () => Array(size).fill(EMPTY));
  let turn = BLACK;
  let lastMove = null;
  let destroyed = false;

  const root = el('div', { class: 'gobang-board' });
  const cells = [];

  /** 同步单个格子的棋子 DOM（增量更新） */
  function updateCell(r, c) {
    const cell = cells[r][c];
    const v = board[r][c];
    // 落子后移除该格悬停预览（若鼠标仍停留）
    const preview = cell.querySelector('.stone-preview');
    if (v !== EMPTY && preview) preview.remove();
    const piece = cell.querySelector('.gobang-black, .gobang-white');
    if (v === EMPTY) {
      if (piece) piece.remove();
    } else if (!piece) {
      const p = document.createElement('div');
      p.className = v === BLACK ? 'gobang-black' : 'gobang-white';
      cell.appendChild(p);
    }
  }

  /** 悬停预览（任务 2.1.3）：空格子显示当前回合颜色的半透明棋子 */
  function showPreview(r, c) {
    const cell = cells[r][c];
    if (board[r][c] !== EMPTY) return;
    const color = turn;
    const cls = 'stone-preview ' + (color === BLACK ? 'preview-black' : 'preview-white');
    const prev = cell.querySelector('.stone-preview');
    if (prev) {
      if (prev.className !== cls) prev.className = cls; // 已有预览仅换色，避免重建抖动
      return;
    }
    const p = document.createElement('div');
    p.className = cls;
    cell.appendChild(p);
  }

  function hidePreview(r, c) {
    const prev = cells[r][c].querySelector('.stone-preview');
    if (prev) prev.remove();
  }

  /** 清除上一手落子高亮 */
  function clearLastMove() {
    if (!lastMove) return;
    const cell = cells[lastMove.r] && cells[lastMove.r][lastMove.c];
    if (cell) cell.classList.remove('last-move');
  }

  /** 标记最新落子 */
  function markLastMove(r, c) {
    clearLastMove();
    lastMove = { r, c };
    cells[r][c].classList.add('last-move');
  }

  /**
   * 放置棋子（本地交互与联机同步共用）
   * @returns {boolean} 是否放置成功
   */
  function place(r, c, color) {
    if (destroyed) return false;
    if (r < 0 || r >= size || c < 0 || c >= size) return false;
    if (board[r][c] !== EMPTY) return false;
    board[r][c] = color;
    updateCell(r, c);
    markLastMove(r, c);
    return true;
  }

  function handleClick(r, c) {
    if (destroyed) return;
    if (board[r][c] !== EMPTY) return;
    if (typeof options.onPlace === 'function') {
      // 外部接管（联机/AI），由外部校验后调用 place
      options.onPlace(r, c, turn);
      return;
    }
    // 本地交替模式：黑先，落子后轮换
    if (place(r, c, turn)) {
      turn = turn === BLACK ? WHITE : BLACK;
    }
  }

  /** 重置棋盘（清空棋子、黑先、清除标记与预览） */
  function reset() {
    board = Array.from({ length: size }, () => Array(size).fill(EMPTY));
    turn = BLACK;
    lastMove = null;
    cells.forEach((row) => row.forEach((cell) => {
      cell.querySelectorAll('.gobang-black, .gobang-white, .stone-preview').forEach((n) => n.remove());
      cell.classList.remove('last-move');
    }));
  }

  /**
   * 用服务端数据恢复棋盘（悔棋 undo_accepted / 重连）
   * @param {number[][]} nextBoard - 19×19 棋盘数据
   * @param {number} [currentPlayer] - 当前应落子方（1 黑 / 2 白）
   */
  function restore(nextBoard, currentPlayer) {
    board = (nextBoard || []).map((row) => Array.from(row || []));
    if (currentPlayer) turn = currentPlayer;
    lastMove = null;
    cells.forEach((row, r) => row.forEach((cell, c) => {
      cell.querySelectorAll('.gobang-black, .gobang-white, .stone-preview').forEach((n) => n.remove());
      cell.classList.remove('last-move');
      updateCell(r, c);
    }));
  }

  function destroy() {
    destroyed = true;
    fit.destroy();
    container.innerHTML = '';
  }

  // 渲染棋盘
  container.innerHTML = '';
  for (let r = 0; r < size; r++) {
    cells[r] = [];
    for (let c = 0; c < size; c++) {
      const cell = el('div', { class: 'gobang-cell', 'data-r': r, 'data-c': c });
      cells[r][c] = cell;
      root.append(cell);
    }
  }
  // 事件委托（5.2.2 性能优化：3 个委托监听替代 361×3 个单元格监听，降低初始渲染成本）
  root.addEventListener('click', (e) => {
    const cell = e.target.closest('.gobang-cell');
    if (!cell || destroyed) return;
    handleClick(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  root.addEventListener('mouseover', (e) => {
    const cell = e.target.closest('.gobang-cell');
    if (!cell || destroyed) return;
    showPreview(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  root.addEventListener('mouseout', (e) => {
    const cell = e.target.closest('.gobang-cell');
    if (!cell || destroyed) return;
    if (e.relatedTarget && cell.contains(e.relatedTarget)) return; // 在 cell 内部子元素间移动，不隐藏
    hidePreview(Number(cell.dataset.r), Number(cell.dataset.c));
  });
  container.append(root);
  const fit = fitBoard(root, container);

  return {
    size,
    get board() { return board; },
    get turn() { return turn; },
    set turn(v) { turn = v; },
    get lastMove() { return lastMove; },
    place,
    reset,
    restore,
    destroy,
  };
}
