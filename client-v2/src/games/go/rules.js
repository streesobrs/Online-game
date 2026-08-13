/**
 * 围棋规则模块（任务 3.1.2）
 * - 提子：落子后，包围对方且无气的整块棋被提走（与 v1 removeCapturedStones 一致）
 * - 自杀：落子后己方整块无气则禁止落子（与 v1 hasGroupLiberty 判定一致）
 * - 纯函数设计：不修改传入棋盘，返回新棋盘与提子结果，便于联机双方本地同步执行
 *   （服务端 executeGoMove 只落子不提子，提子由客户端本地完成，v1 同样如此）
 */
import { EMPTY, BLACK, WHITE, GO_SIZE } from './board.js';

export { EMPTY, BLACK, WHITE, GO_SIZE };

const DIRECTIONS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

/**
 * 获取与 (r,c) 同色连通的整块棋
 * @param {number[][]} board - 21×21 棋盘
 * @param {number} r
 * @param {number} c
 * @param {number} size
 * @returns {{r:number,c:number}[]} 连通块坐标集合
 */
export function getGroup(board, r, c, size = GO_SIZE) {
  const color = board[r]?.[c];
  if (color === EMPTY || color == null) return [];

  const group = [];
  const visited = new Set();
  const stack = [{ r, c }];

  while (stack.length > 0) {
    const { r: cr, c: cc } = stack.pop();
    const key = cr * size + cc;
    if (visited.has(key)) continue;
    visited.add(key);
    group.push({ r: cr, c: cc });

    for (const [dr, dc] of DIRECTIONS) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === color) {
        stack.push({ r: nr, c: nc });
      }
    }
  }
  return group;
}

/**
 * 判断整块棋是否有气（四邻存在空格即算有气）
 * @returns {boolean}
 */
export function hasLiberty(board, group, size = GO_SIZE) {
  const checked = new Set();
  for (const stone of group) {
    for (const [dr, dc] of DIRECTIONS) {
      const nr = stone.r + dr;
      const nc = stone.c + dc;
      const key = nr * size + nc;
      if (checked.has(key)) continue;
      checked.add(key);
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && board[nr][nc] === EMPTY) {
        return true;
      }
    }
  }
  return false;
}

/**
 * 收集棋盘上所有无气的 color 棋子（整块无气则整块记录）
 * @returns {{r:number,c:number}[]} 可被提走的棋子坐标集合
 */
export function capturedStones(board, color, size = GO_SIZE) {
  const captured = [];
  const seen = new Set();

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] !== color) continue;
      const key = r * size + c;
      if (seen.has(key)) continue;
      const group = getGroup(board, r, c, size);
      group.forEach((s) => seen.add(s.r * size + s.c));
      if (!hasLiberty(board, group, size)) {
        captured.push(...group);
      }
    }
  }
  return captured;
}

/**
 * 尝试在 (r,c) 落子（完整围棋落子流程：落子 → 提对方 → 自杀检查）
 * @returns {{ok:boolean, board:number[][], captured:{r:number,c:number}[]}}
 *   ok=false 表示自杀或位置非法，board 为未变更的克隆棋盘，调用方应忽略
 */
export function tryPlace(board, r, c, color, size = GO_SIZE) {
  const next = board.map((row) => row.slice());
  if (r < 0 || r >= size || c < 0 || c >= size || next[r][c] !== EMPTY) {
    return { ok: false, board: next, captured: [] };
  }

  // 1. 落子
  next[r][c] = color;

  // 2. 提走对方无气的块
  const opponent = 3 - color;
  const captured = capturedStones(next, opponent, size);
  for (const s of captured) {
    next[s.r][s.c] = EMPTY;
  }

  // 3. 自杀检查：落子后己方整块无气 → 禁止
  if (!hasLiberty(next, getGroup(next, r, c, size), size)) {
    return { ok: false, board: next, captured: [] };
  }

  return { ok: true, board: next, captured };
}

/**
 * 空位数（3.1.4 数目/终局判定用）
 */
export function countEmpty(board, size = GO_SIZE) {
  let n = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === EMPTY) n++;
    }
  }
  return n;
}

/**
 * 空地归属（复刻 v1 getGoTerritory）
 * 从空格 BFS 收集连通空域，记录边界是否接触黑/白子；
 * 纯黑边界 → 黑方领地；纯白边界 → 白方领地；混合边界 → 不算任何一方
 * @returns {{emptyCount:number, blackBorder:boolean, whiteBorder:boolean}}
 */
function getTerritory(board, startR, startC, size, visited) {
  let emptyCount = 0;
  let blackBorder = false;
  let whiteBorder = false;
  const stack = [{ r: startR, c: startC }];

  while (stack.length > 0) {
    const { r, c } = stack.pop();
    const key = r * size + c;
    if (visited.has(key)) continue;
    visited.add(key);
    emptyCount++;

    for (const [dr, dc] of DIRECTIONS) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const v = board[nr][nc];
      if (v === EMPTY) {
        stack.push({ r: nr, c: nc });
      } else if (v === BLACK) {
        blackBorder = true;
      } else if (v === WHITE) {
        whiteBorder = true;
      }
    }
  }
  return { emptyCount, blackBorder, whiteBorder };
}

/**
 * 数目/点目（复刻 v1 countGoScore）
 * 黑方：子数 + 纯黑边界空域；白方：子数 + 纯白边界空域 + 贴目（默认 7.5）
 * @returns {{black:number, white:number, blackStones:number, whiteStones:number}} 双方总点数与子数
 */
export function countScore(board, size = GO_SIZE, komi = 7.5) {
  let black = 0;
  let white = 0;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === BLACK) black++;
      else if (board[r][c] === WHITE) white++;
    }
  }

  const blackStones = black;
  const whiteStones = white;
  const visited = new Set();

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === EMPTY && !visited.has(r * size + c)) {
        const territory = getTerritory(board, r, c, size, visited);
        if (territory.blackBorder && !territory.whiteBorder) {
          black += territory.emptyCount;
        } else if (territory.whiteBorder && !territory.blackBorder) {
          white += territory.emptyCount;
        }
      }
    }
  }

  white += komi;
  return { black, white, blackStones, whiteStones };
}
