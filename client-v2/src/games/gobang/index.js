/**
 * 五子棋视图（阶段 2）
 * - 本地模式：createBoard 渲染 19×19 棋盘 + 本地交替落子（调试/演示用）
 * - 对局模式：匹配成功后（store.pendingMatch 有数据）由 play.js 启动联机对局
 */
import { createBoard } from './board.js';
import { startMatch, cleanupMatch } from './play.js';
import { store } from '../../core/store.js';
import { viewRoot } from '../../utils/dom.js';

/**
 * 渲染五子棋视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderGobang(container = viewRoot()) {
  // 对局模式：有待开始的对局（lobby 匹配成功写入 pendingMatch）
  const pending = store.get('pendingMatch');
  if (pending) {
    store.set('pendingMatch', null);
    const match = startMatch(container, pending);
    window.gobangMatch = match;
    return () => {
      cleanupMatch();
      if (window.gobangMatch === match) delete window.gobangMatch;
    };
  }

  // 本地模式（调试）
  const boardEl = document.createElement('div');
  const board = createBoard(boardEl);

  container.innerHTML = '';
  container.append(boardEl);

  window.gobangBoard = board;

  return () => {
    board.destroy();
    if (window.gobangBoard === board) delete window.gobangBoard;
  };
}
