// AIManager.js - AI 管理模块
const config = require('../config');
const logger = require('../utils/logger');

class AIManager {
  constructor() {
    this.difficultyLevels = ['easy', 'medium', 'hard'];
  }

  // 获取 AI 移动
  getAIMove(gameType, board, difficulty, currentPlayer) {
    switch (gameType) {
      case 'gobang':
        return this.getGobangAIMove(board, difficulty, currentPlayer);
      case 'chess':
        return this.getChessAIMove(board, difficulty, currentPlayer);
      case 'go':
        return this.getGoAIMove(board, difficulty, currentPlayer);
      default:
        return null;
    }
  }

  // 五子棋 AI 移动
  getGobangAIMove(board, difficulty, currentPlayer) {
    switch (difficulty) {
      case 'easy':
        return this.getGobangEasyMove(board);
      case 'medium':
        return this.getGobangMediumMove(board, currentPlayer);
      case 'hard':
        return this.getGobangHardMove(board, currentPlayer);
      default:
        return this.getGobangEasyMove(board);
    }
  }

  // 五子棋简单难度 - 随机落子
  getGobangEasyMove(board) {
    const emptyCells = [];
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] === 0) {
          emptyCells.push({ r, c });
        }
      }
    }
    if (emptyCells.length === 0) {
      return null;
    }
    return emptyCells[Math.floor(Math.random() * emptyCells.length)];
  }

  // 五子棋中等难度 - 基于规则的 AI
  getGobangMediumMove(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;

    // 检查是否可以赢
    const winningMove = this.findWinningMove(board, currentPlayer);
    if (winningMove) {
      return winningMove;
    }

    // 检查是否需要防守
    const defensiveMove = this.findWinningMove(board, opponent);
    if (defensiveMove) {
      return defensiveMove;
    }

    // 检查是否可以形成活三
    const liveThreeMove = this.findLiveThreeMove(board, currentPlayer);
    if (liveThreeMove) {
      return liveThreeMove;
    }

    // 检查是否需要防守活三
    const defensiveLiveThreeMove = this.findLiveThreeMove(board, opponent);
    if (defensiveLiveThreeMove) {
      return defensiveLiveThreeMove;
    }

    // 随机落子
    return this.getGobangEasyMove(board);
  }

  // 五子棋困难难度 - 基于 Minimax 算法
  getGobangHardMove(board, currentPlayer) {
    // 实现 Minimax 算法
    // 为了性能，限制搜索深度
    const depth = 3;
    const bestMove = this.minimax(board, depth, currentPlayer, -Infinity, Infinity, true);
    return bestMove;
  }

  // Minimax 算法
  minimax(board, depth, currentPlayer, alpha, beta, maximizingPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;

    // 终止条件
    if (depth === 0 || this.isGameOver(board)) {
      const score = this.evaluateBoard(board, currentPlayer);
      return { score };
    }

    if (maximizingPlayer) {
      let bestScore = -Infinity;
      let bestMove = null;

      const emptyCells = this.getEmptyCells(board);
      for (const cell of emptyCells) {
        board[cell.r][cell.c] = currentPlayer;
        const result = this.minimax(board, depth - 1, currentPlayer, alpha, beta, false);
        board[cell.r][cell.c] = 0;

        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = cell;
        }

        alpha = Math.max(alpha, bestScore);
        if (beta <= alpha) {
          break;
        }
      }

      return { score: bestScore, move: bestMove };
    } else {
      let bestScore = Infinity;
      let bestMove = null;

      const emptyCells = this.getEmptyCells(board);
      for (const cell of emptyCells) {
        board[cell.r][cell.c] = opponent;
        const result = this.minimax(board, depth - 1, currentPlayer, alpha, beta, true);
        board[cell.r][cell.c] = 0;

        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = cell;
        }

        beta = Math.min(beta, bestScore);
        if (beta <= alpha) {
          break;
        }
      }

      return { score: bestScore, move: bestMove };
    }
  }

  // 评估棋盘
  evaluateBoard(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    let score = 0;

    // 评估自己的连子
    score += this.evaluateLines(board, currentPlayer) * 10;

    // 评估对手的连子
    score -= this.evaluateLines(board, opponent) * 8;

    return score;
  }

  // 评估连子
  evaluateLines(board, player) {
    let score = 0;

    // 检查横向
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = board[r].slice(c, c + 5);
        score += this.evaluateLine(line, player);
      }
    }

    // 检查纵向
    for (let c = 0; c < board[0].length; c++) {
      for (let r = 0; r < board.length - 4; r++) {
        const line = [];
        for (let i = 0; i < 5; i++) {
          line.push(board[r + i][c]);
        }
        score += this.evaluateLine(line, player);
      }
    }

    // 检查正对角线
    for (let r = 0; r < board.length - 4; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = [];
        for (let i = 0; i < 5; i++) {
          line.push(board[r + i][c + i]);
        }
        score += this.evaluateLine(line, player);
      }
    }

    // 检查反对角线
    for (let r = 4; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = [];
        for (let i = 0; i < 5; i++) {
          line.push(board[r - i][c + i]);
        }
        score += this.evaluateLine(line, player);
      }
    }

    return score;
  }

  // 评估连子
  evaluateLine(line, player) {
    const opponent = player === 1 ? 2 : 1;
    const count = line.filter(cell => cell === player).length;
    const emptyCount = line.filter(cell => cell === 0).length;
    const opponentCount = line.filter(cell => cell === opponent).length;

    if (opponentCount > 0) {
      return 0;
    }

    if (count === 5) {
      return 10000;
    } else if (count === 4 && emptyCount === 1) {
      return 1000;
    } else if (count === 3 && emptyCount === 2) {
      return 100;
    } else if (count === 2 && emptyCount === 3) {
      return 10;
    } else if (count === 1 && emptyCount === 4) {
      return 1;
    }

    return 0;
  }

  // 寻找获胜移动
  findWinningMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      if (this.isWinning(board, player)) {
        board[cell.r][cell.c] = 0;
        return cell;
      }
      board[cell.r][cell.c] = 0;
    }
    return null;
  }

  // 寻找活三移动
  findLiveThreeMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      if (this.hasLiveThree(board, player)) {
        board[cell.r][cell.c] = 0;
        return cell;
      }
      board[cell.r][cell.c] = 0;
    }
    return null;
  }

  // 检查是否获胜
  isWinning(board, player) {
    // 检查横向
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        if (board[r][c] === player && board[r][c + 1] === player && board[r][c + 2] === player && board[r][c + 3] === player && board[r][c + 4] === player) {
          return true;
        }
      }
    }

    // 检查纵向
    for (let c = 0; c < board[0].length; c++) {
      for (let r = 0; r < board.length - 4; r++) {
        if (board[r][c] === player && board[r + 1][c] === player && board[r + 2][c] === player && board[r + 3][c] === player && board[r + 4][c] === player) {
          return true;
        }
      }
    }

    // 检查正对角线
    for (let r = 0; r < board.length - 4; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        if (board[r][c] === player && board[r + 1][c + 1] === player && board[r + 2][c + 2] === player && board[r + 3][c + 3] === player && board[r + 4][c + 4] === player) {
          return true;
        }
      }
    }

    // 检查反对角线
    for (let r = 4; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        if (board[r][c] === player && board[r - 1][c + 1] === player && board[r - 2][c + 2] === player && board[r - 3][c + 3] === player && board[r - 4][c + 4] === player) {
          return true;
        }
      }
    }

    return false;
  }

  // 检查是否有活三
  hasLiveThree(board, player) {
    // 检查横向
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = board[r].slice(c, c + 5);
        if (this.isLiveThree(line, player)) {
          return true;
        }
      }
    }

    // 检查纵向
    for (let c = 0; c < board[0].length; c++) {
      for (let r = 0; r < board.length - 4; r++) {
        const line = [];
        for (let i = 0; i < 5; i++) {
          line.push(board[r + i][c]);
        }
        if (this.isLiveThree(line, player)) {
          return true;
        }
      }
    }

    // 检查正对角线
    for (let r = 0; r < board.length - 4; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = [];
        for (let i = 0; i < 5; i++) {
          line.push(board[r + i][c + i]);
        }
        if (this.isLiveThree(line, player)) {
          return true;
        }
      }
    }

    // 检查反对角线
    for (let r = 4; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = [];
        for (let i = 0; i < 5; i++) {
          line.push(board[r - i][c + i]);
        }
        if (this.isLiveThree(line, player)) {
          return true;
        }
      }
    }

    return false;
  }

  // 检查是否是活三
  isLiveThree(line, player) {
    const opponent = player === 1 ? 2 : 1;
    const count = line.filter(cell => cell === player).length;
    const emptyCount = line.filter(cell => cell === 0).length;
    const opponentCount = line.filter(cell => cell === opponent).length;

    if (opponentCount > 0) {
      return false;
    }

    if (count === 3 && emptyCount === 2) {
      // 检查是否是活三
      // 活三是指两端都有空位的三
      if ((line[0] === 0 && line[4] === 0) || (line[0] === player && line[4] === 0) || (line[0] === 0 && line[4] === player)) {
        return true;
      }
    }

    return false;
  }

  // 检查游戏是否结束
  isGameOver(board) {
    return this.isWinning(board, 1) || this.isWinning(board, 2) || this.getEmptyCells(board).length === 0;
  }

  // 获取空单元格
  getEmptyCells(board) {
    const emptyCells = [];
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] === 0) {
          emptyCells.push({ r, c });
        }
      }
    }
    return emptyCells;
  }

  // 象棋 AI 移动
  getChessAIMove(board, difficulty, currentPlayer) {
    switch (difficulty) {
      case 'easy':
        return this.getChessEasyMove(board, currentPlayer);
      case 'medium':
        return this.getChessMediumMove(board, currentPlayer);
      case 'hard':
        return this.getChessHardMove(board, currentPlayer);
      default:
        return this.getChessEasyMove(board, currentPlayer);
    }
  }

  // 象棋简单难度 - 随机走棋
  getChessEasyMove(board, currentPlayer) {
    const pieces = this.getChessPieces(board, currentPlayer);
    if (pieces.length === 0) return null;

    // 随机选择一个棋子
    const piece = pieces[Math.floor(Math.random() * pieces.length)];
    const validMoves = this.getChessValidMoves(board, piece);

    if (validMoves.length === 0) return null;

    // 随机选择一个移动
    const move = validMoves[Math.floor(Math.random() * validMoves.length)];
    return {
      fromR: piece.r,
      fromC: piece.c,
      toR: move.r,
      toC: move.c
    };
  }

  // 象棋中等难度 - 基于规则的AI
  getChessMediumMove(board, currentPlayer) {
    // 先尝试吃子
    const captureMove = this.findChessCaptureMove(board, currentPlayer);
    if (captureMove) return captureMove;

    // 随机走棋
    return this.getChessEasyMove(board, currentPlayer);
  }

  // 象棋困难难度 - 基于Minimax算法
  getChessHardMove(board, currentPlayer) {
    // 简化实现，使用中等难度
    return this.getChessMediumMove(board, currentPlayer);
  }

  // 围棋 AI 移动
  getGoAIMove(board, difficulty, currentPlayer) {
    switch (difficulty) {
      case 'easy':
        return this.getGoEasyMove(board);
      case 'medium':
        return this.getGoMediumMove(board, currentPlayer);
      case 'hard':
        return this.getGoHardMove(board, currentPlayer);
      default:
        return this.getGoEasyMove(board);
    }
  }

  // 围棋简单难度 - 随机落子
  getGoEasyMove(board) {
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) return null;
    return emptyCells[Math.floor(Math.random() * emptyCells.length)];
  }

  // 围棋中等难度 - 基于规则的AI
  getGoMediumMove(board, currentPlayer) {
    // 简化实现，随机落子
    return this.getGoEasyMove(board);
  }

  // 围棋困难难度 - 基于Minimax算法
  getGoHardMove(board, currentPlayer) {
    // 简化实现，随机落子
    return this.getGoEasyMove(board);
  }

  // 获取象棋棋子
  getChessPieces(board, currentPlayer) {
    const pieces = [];
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] !== 0 && board[r][c] === currentPlayer) {
          pieces.push({ r, c, type: board[r][c] });
        }
      }
    }
    return pieces;
  }

  // 获取象棋有效移动
  getChessValidMoves(board, piece) {
    // 简化实现，返回周围8个方向
    const moves = [];
    const directions = [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [-1, 1], [1, -1], [1, 1]
    ];

    for (const [dr, dc] of directions) {
      const newR = piece.r + dr;
      const newC = piece.c + dc;

      if (newR >= 0 && newR < board.length && newC >= 0 && newC < board[0].length) {
        if (board[newR][newC] === 0 || board[newR][newC] !== piece.type) {
          moves.push({ r: newR, c: newC });
        }
      }
    }

    return moves;
  }

  // 寻找象棋吃子移动
  findChessCaptureMove(board, currentPlayer) {
    const pieces = this.getChessPieces(board, currentPlayer);
    const opponent = currentPlayer === 1 ? 2 : 1;

    for (const piece of pieces) {
      const validMoves = this.getChessValidMoves(board, piece);
      for (const move of validMoves) {
        if (board[move.r][move.c] === opponent) {
          return {
            fromR: piece.r,
            fromC: piece.c,
            toR: move.r,
            toC: move.c
          };
        }
      }
    }

    return null;
  }
}

module.exports = AIManager;