/**
 * 中国象棋视图（阶段 3）
 * - 本地模式：createChessBoard 渲染 9×10 棋盘 + 标准布局，接入 getChessMoves 规则：
 *   点击己方棋子选中并显示合法走位（蓝点），点击合法走位走子（本地红黑交替，调试/演示用）
 * - 对局模式：匹配成功后（store.pendingMatch 有数据）由 play.js 启动联机对局（任务 3.2.3）
 */
import { createChessBoard } from './board.js';
import { getChessMoves } from './rules.js';
import { startMatch, cleanupMatch } from './play.js';
import { store } from '../../core/store.js';
import { viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

/**
 * 渲染中国象棋视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderChess(container = viewRoot()) {
  // 对局模式：有待开始的对局（lobby 匹配成功写入 pendingMatch，game 必须是本游戏）
  const pending = store.get('pendingMatch');
  if (pending && (!pending.game || pending.game === 'chinese-chess')) {
    store.set('pendingMatch', null);
    startMatch(container, pending);
    return () => cleanupMatch();
  }

  let selected = null;   // 当前选中的棋子 {r, c}
  let turn = 'red';      // 本地模式红方先行（联机回合由服务端控制）

  const boardEl = document.createElement('div');
  const board = createChessBoard(boardEl, {
    onCellClick: (r, c) => {
      const piece = board.get(r, c);

      // 已有选中棋子：尝试走子
      if (selected) {
        const moves = getChessMoves(board.board, selected.r, selected.c);
        if (moves.some((m) => m.r === r && m.c === c)) {
          const captured = board.movePiece(selected.r, selected.c, r, c);
          board.setLastMove(r, c);
          toast.success(`${captured ? '吃子！' : ''}${turn === 'red' ? '红' : '黑'}方走子`);
          turn = turn === 'red' ? 'black' : 'red';
          board.clearSelection();
          selected = null;
          return;
        }
      }

      // 未选中或点击无效：选中己方棋子并显示合法走位
      if (piece && piece.color === turn) {
        board.select(r, c);
        board.setValidMoves(getChessMoves(board.board, r, c));
        selected = { r, c };
      } else {
        board.clearSelection();
        selected = null;
      }
    },
  });

  container.innerHTML = '';
  container.append(boardEl);

  window.chessBoard = board;

  return () => {
    board.destroy();
    if (window.chessBoard === board) delete window.chessBoard;
  };
}
