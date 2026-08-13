/**
 * 五子棋规则模块（任务 2.2）
 * - 胜负判定 checkWin：以最后一手 (r,c) 为原点，四方向（横/竖/双斜）计数 >=5 即胜。
 *   与 v1 完全一致（含长连 >5 也算赢，v1 客户端/服务端均为简化规则）。
 * - 平局判定 checkDraw：棋盘填满且无人五连。
 * 注意：真正对局胜负由服务端判定（PvP 走服务端 checkGameOver → game_result），
 * 本模块用于本地即时反馈、AI 模式判定及棋盘状态统计。
 */
import { EMPTY, BLACK, WHITE } from './board.js';

export { EMPTY, BLACK, WHITE };

const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [1, -1]];

/**
 * 胜负判定：最后落子 (r, c) 后，该 color 是否已形成五连或以上
 * @param {number[][]} board - 19×19 二维数组（0 空 / 1 黑 / 2 白）
 * @param {number} r - 最后落子行
 * @param {number} c - 最后落子列
 * @param {number} color - 1 黑 / 2 白
 * @param {number} [size=19]
 * @returns {boolean}
 */
export function checkWin(board, r, c, color, size = 19) {
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    // 正方向延伸
    for (let i = 1; i < 5; i++) {
      const nr = r + dr * i;
      const nc = c + dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || board[nr][nc] !== color) break;
      count++;
      if (count >= 5) return true;
    }
    // 反方向延伸
    for (let i = 1; i < 5; i++) {
      const nr = r - dr * i;
      const nc = c - dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || board[nr][nc] !== color) break;
      count++;
      if (count >= 5) return true;
    }
    if (count >= 5) return true;
  }
  return false;
}

/**
 * 最长连子数（与 v1 calculateGobangChain 一致，用于对局统计）
 * @returns {number} 四方向中的最大连子数（上限 5）
 */
export function maxChain(board, r, c, color, size = 19) {
  let max = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    for (let i = 1; i < 5; i++) {
      const nr = r + dr * i;
      const nc = c + dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || board[nr][nc] !== color) break;
      count++;
      if (count >= 5) return 5;
    }
    for (let i = 1; i < 5; i++) {
      const nr = r - dr * i;
      const nc = c + dc * i;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size || board[nr][nc] !== color) break;
      count++;
      if (count >= 5) return 5;
    }
    if (count > max) max = count;
  }
  return max;
}

/**
 * 平局判定（任务 2.2.3）：棋盘是否已填满
 * @returns {boolean}
 */
export function checkDraw(board, size = 19) {
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === EMPTY) return false;
    }
  }
  return true;
}

/**
 * 剩余空位数（对局状态统计）
 * @returns {number}
 */
export function countEmpty(board, size = 19) {
  let n = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === EMPTY) n++;
    }
  }
  return n;
}
