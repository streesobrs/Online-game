/**
 * 五子棋（阶段 1：空棋盘）
 * 仅渲染 15×15 空棋盘 + 落子预览（纯前端）。
 * 完整联机逻辑（socket 事件/禁手/胜利判定）在阶段 2 实现。
 */
import { el } from '../../utils/dom.js';

const BOARD_SIZE = 15;

/**
 * 渲染五子棋视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderGobang(container) {
  const board = el('div', { class: 'gobang-board' });

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = el('div', { class: 'gobang-cell', 'data-r': r, 'data-c': c });
      // 落子预览（阶段 1 仅前端占位，无落子逻辑）
      cell.addEventListener('mouseenter', () => cell.classList.add('gobang-cell--preview'));
      cell.addEventListener('mouseleave', () => cell.classList.remove('gobang-cell--preview'));
      board.append(cell);
    }
  }

  container.innerHTML = '';
  container.append(board);

  return () => { container.innerHTML = ''; };
}
