/**
 * 五子棋视图（阶段 2）
 * 2.1.1 起由 games/gobang/board.js 的 createBoard 渲染 19×19 棋盘并提供落子交互。
 * 完整联机逻辑（socket 事件/胜负判定/悔棋等）在 2.2~2.4 接入。
 */
import { createBoard } from './board.js';
import { viewRoot } from '../../utils/dom.js';

/**
 * 渲染五子棋视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderGobang(container = viewRoot()) {
  const boardEl = document.createElement('div');
  const board = createBoard(boardEl);

  container.innerHTML = '';
  container.append(boardEl);

  // 调试辅助：控制台可验证 createBoard API
  window.gobangBoard = board;

  return () => {
    board.destroy();
    if (window.gobangBoard === board) delete window.gobangBoard;
  };
}
