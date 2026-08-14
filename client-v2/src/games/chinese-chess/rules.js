/**
 * 中国象棋走子规则模块（任务 3.2.2）
 * 复刻 v1 calculateChessMoves 逻辑，改为纯函数（基于棋盘数据数组，不依赖 DOM）。
 * 数据模型：board[r][c] = { name, color } | null（10 行 × 9 列，红方在下、黑方在上）
 * 走子规则与 v1 完全一致：车直线、炮翻山、马日+蹩马腿、相田+塞象眼+不过河、
 * 仕/士九宫斜线、帅/将九宫直线+白脸将、兵/卒过河前后。
 */
export const BOARD_H = 10;
export const BOARD_W = 9;

const PALACE_R = { red: [7, 8, 9], black: [0, 1, 2] };
const PALACE_C = [3, 4, 5];

function inBoard(r, c) {
  return r >= 0 && r < BOARD_H && c >= 0 && c < BOARD_W;
}

function pieceAt(board, r, c) {
  return (inBoard(r, c) && board[r][c]) || null;
}

/** 目标格为空或可吃（不能吃己方棋子） */
function canCaptureOrEmpty(board, r, c, color) {
  const p = pieceAt(board, r, c);
  return !p || p.color !== color;
}

/**
 * 计算 (r, c) 处棋子的全部合法走位
 * @param {Array} board - 10×9 棋盘数据
 * @param {number} r
 * @param {number} c
 * @returns {Array<{r: number, c: number}>}
 */
export function getChessMoves(board, r, c) {
  const piece = pieceAt(board, r, c);
  if (!piece) return [];
  const { name, color } = piece;
  const moves = [];
  const isRed = color === 'red';

  switch (name) {
    case '帅':
    case '将': {
      // 将帅只能在九宫内移动
      const palaceR = isRed ? PALACE_R.red : PALACE_R.black;
      const kingDirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of kingDirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (palaceR.includes(nr) && PALACE_C.includes(nc) && canCaptureOrEmpty(board, nr, nc, color)) {
          moves.push({ r: nr, c: nc });
        }
      }
      // 白脸将：同列直线对将时可以"吃"对方将帅
      const enemyKing = isRed ? '将' : '帅';
      for (let i = 1; i < 10; i++) {
        const nr = r + (isRed ? -i : i);
        if (nr < 0 || nr >= BOARD_H) break;
        const p = pieceAt(board, nr, c);
        if (p) {
          if (p.name === enemyKing && p.color !== color) {
            moves.push({ r: nr, c });
          }
          break;
        }
      }
      break;
    }

    case '仕':
    case '士': {
      // 士只能走九宫斜线
      const palaceR = isRed ? PALACE_R.red : PALACE_R.black;
      const advisorDirs = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
      for (const [dr, dc] of advisorDirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (palaceR.includes(nr) && PALACE_C.includes(nc) && canCaptureOrEmpty(board, nr, nc, color)) {
          moves.push({ r: nr, c: nc });
        }
      }
      break;
    }

    case '相':
    case '象': {
      // 象走田字
      const elephantDirs = [[-2, -2], [-2, 2], [2, -2], [2, 2]];
      for (const [dr, dc] of elephantDirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        // 不能过河（红方在下、黑方在上）
        if ((isRed && nr < 5) || (!isRed && nr > 4)) continue;
        // 塞象眼：田字中心不能有棋子
        if (pieceAt(board, r + dr / 2, c + dc / 2)) continue;
        if (canCaptureOrEmpty(board, nr, nc, color)) {
          moves.push({ r: nr, c: nc });
        }
      }
      break;
    }

    case '马': {
      // 马走日字，[dr, dc, legR, legC]：leg 为蹩马腿位置
      const horseDirs = [
        [-2, -1, -1, 0], [-2, 1, -1, 0],
        [2, -1, 1, 0], [2, 1, 1, 0],
        [-1, -2, 0, -1], [-1, 2, 0, 1],
        [1, -2, 0, -1], [1, 2, 0, 1]
      ];
      for (const [dr, dc, legR, legC] of horseDirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (!inBoard(nr, nc)) continue;
        if (!pieceAt(board, r + legR, c + legC) && canCaptureOrEmpty(board, nr, nc, color)) {
          moves.push({ r: nr, c: nc });
        }
      }
      break;
    }

    case '车': {
      // 车走直线，遇子挡路
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        for (let i = 1; i <= 9; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (!inBoard(nr, nc)) break;
          const p = pieceAt(board, nr, nc);
          if (!p) {
            moves.push({ r: nr, c: nc });
          } else {
            if (p.color !== color) moves.push({ r: nr, c: nc });
            break;
          }
        }
      }
      break;
    }

    case '炮': {
      // 炮翻山：隔一个棋子吃子，无子时沿直线移动
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        let jumped = false;
        for (let i = 1; i <= 9; i++) {
          const nr = r + dr * i;
          const nc = c + dc * i;
          if (!inBoard(nr, nc)) break;
          const p = pieceAt(board, nr, nc);
          if (!p) {
            if (!jumped) moves.push({ r: nr, c: nc });
          } else {
            if (!jumped) {
              jumped = true;
            } else {
              if (p.color !== color) moves.push({ r: nr, c: nc });
              break;
            }
          }
        }
      }
      break;
    }

    case '兵':
    case '卒': {
      // 过河前只能向前，过河后可以左右
      const soldierDirs = isRed ? [[-1, 0]] : [[1, 0]];
      if ((isRed && r < 5) || (!isRed && r > 4)) {
        soldierDirs.push([0, -1], [0, 1]);
      }
      for (const [dr, dc] of soldierDirs) {
        const nr = r + dr;
        const nc = c + dc;
        if (inBoard(nr, nc) && canCaptureOrEmpty(board, nr, nc, color)) {
          moves.push({ r: nr, c: nc });
        }
      }
      break;
    }
  }

  return moves;
}

/**
 * 判断 (r,c) 棋子能否走到 (toR,toC)
 */
export function isValidMove(board, r, c, toR, toC) {
  return getChessMoves(board, r, c).some((m) => m.r === toR && m.c === toC);
}

/**
 * 判断某方是否被将军（将/帅正被对方棋子攻击）
 * @param {Array} board - 10×9 棋盘数据
 * @param {'red'|'black'} color - 被检查方
 * @returns {boolean}
 */
export function isInCheck(board, color) {
  const kingName = color === 'red' ? '帅' : '将';
  // 找到己方将/帅位置
  let kingR = -1;
  let kingC = -1;
  for (let r = 0; r < BOARD_H; r++) {
    for (let c = 0; c < BOARD_W; c++) {
      const p = board[r][c];
      if (p && p.name === kingName && p.color === color) {
        kingR = r;
        kingC = c;
        break;
      }
    }
    if (kingR >= 0) break;
  }
  if (kingR < 0) return true; // 将/帅已被吃，视为被将军

  // 遍历对方所有棋子：任一合法走位能攻击到将/帅 → 将军
  for (let r = 0; r < BOARD_H; r++) {
    for (let c = 0; c < BOARD_W; c++) {
      const p = board[r][c];
      if (p && p.color !== color) {
        const moves = getChessMoves(board, r, c);
        if (moves.some((m) => m.r === kingR && m.c === kingC)) return true;
      }
    }
  }
  return false;
}

/**
 * 判断某方是否被将死（处于被将军状态且无任何合法走法能解除将军）
 * @param {Array} board - 10×9 棋盘数据
 * @param {'red'|'black'} color - 被检查方
 * @returns {boolean}
 */
export function isCheckmate(board, color) {
  if (!isInCheck(board, color)) return false;
  // 模拟己方每一枚棋子的每个合法走位，看能否解除将军
  for (let r = 0; r < BOARD_H; r++) {
    for (let c = 0; c < BOARD_W; c++) {
      const p = board[r][c];
      if (p && p.color === color) {
        const moves = getChessMoves(board, r, c);
        for (const m of moves) {
          // 模拟走子后检查是否仍被将军
          const saved = board[m.r][m.c];
          board[m.r][m.c] = p;
          board[r][c] = null;
          const stillCheck = isInCheck(board, color);
          board[r][c] = p;
          board[m.r][m.c] = saved;
          if (!stillCheck) return false;
        }
      }
    }
  }
  return true;
}
