/**
 * 围棋视图（阶段 3）
 * - 本地模式：createBoard 渲染 21×21 棋盘 + 本地交替落子（调试/演示用）
 * - 对局模式：匹配成功后（store.pendingMatch 有数据）由 play.js 启动联机对局
 */
import { createBoard, BLACK } from './board.js';
import { tryPlace } from './rules.js';
import { startMatch, cleanupMatch } from './play.js';
import { store } from '../../core/store.js';
import { viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

/**
 * 渲染围棋视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderGo(container = viewRoot()) {
  // 对局模式：有待开始的对局（lobby 匹配成功写入 pendingMatch，game 必须是本游戏）
  const pending = store.get('pendingMatch');
  if (pending && (!pending.game || pending.game === 'go')) {
    store.set('pendingMatch', null);
    const match = startMatch(container, pending);
    window.goMatch = match;
    return () => {
      cleanupMatch();
      if (window.goMatch === match) delete window.goMatch;
    };
  }

  // 本地模式（调试）：接入提子/自杀规则，黑先交替落子
  // 增量更新：只移除被提棋子、只新增落下棋子，避免全量重绘导致所有棋子跳动
  const boardEl = document.createElement('div');
  const board = createBoard(boardEl, {
    onPlace: (r, c, color) => {
      const res = tryPlace(board.board, r, c, color);
      if (!res.ok) {
        toast.warn('该位置无法落子（自杀或已占用）');
        return;
      }
      res.captured.forEach((s) => board.removeStone(s.r, s.c));
      board.place(r, c, color);
      board.turn = 3 - color;
      if (res.captured.length > 0) {
        toast.info(`⚫⚪ 提子 ${res.captured.length} 颗`);
      }
    },
  });
  board.turn = BLACK;

  container.innerHTML = '';
  container.append(boardEl);

  window.goBoard = board;

  return () => {
    board.destroy();
    if (window.goBoard === board) delete window.goBoard;
  };
}
