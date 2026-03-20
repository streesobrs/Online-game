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

  // 五子棋简单难度 - 智能随机落子
  getGobangEasyMove(board) {
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) {
      return null;
    }

    // 优先选择靠近已有棋子的位置
    const scoredCells = emptyCells.map(cell => {
      let score = 0;
      // 检查周围8个方向是否有棋子
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
            if (board[nr][nc] !== 0) {
              // 距离越近分数越高
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 10;
            }
          }
        }
      }
      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 从前20个候选位置中随机选择
    const topCandidates = scoredCells.slice(0, Math.min(20, scoredCells.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    // 只返回 r 和 c
    return { r: selected.r, c: selected.c };
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

    // 检查是否可以形成活四
    const liveFourMove = this.findLiveFourMove(board, currentPlayer);
    if (liveFourMove) {
      return liveFourMove;
    }

    // 检查是否需要防守活四
    const defensiveLiveFourMove = this.findLiveFourMove(board, opponent);
    if (defensiveLiveFourMove) {
      return defensiveLiveFourMove;
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

    // 检查是否可以形成冲四
    const rushFourMove = this.findRushFourMove(board, currentPlayer);
    if (rushFourMove) {
      return rushFourMove;
    }

    // 检查是否需要防守冲四
    const defensiveRushFourMove = this.findRushFourMove(board, opponent);
    if (defensiveRushFourMove) {
      return defensiveRushFourMove;
    }

    // 使用智能随机
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

  // 寻找活四移动
  findLiveFourMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      if (this.hasLiveFour(board, player)) {
        board[cell.r][cell.c] = 0;
        return cell;
      }
      board[cell.r][cell.c] = 0;
    }
    return null;
  }

  // 寻找冲四移动
  findRushFourMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      if (this.hasRushFour(board, player)) {
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

  // 检查是否有活四
  hasLiveFour(board, player) {
    // 检查横向
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = board[r].slice(c, c + 5);
        if (this.isLiveFour(line, player)) {
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
        if (this.isLiveFour(line, player)) {
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
        if (this.isLiveFour(line, player)) {
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
        if (this.isLiveFour(line, player)) {
          return true;
        }
      }
    }

    return false;
  }

  // 检查是否是活四
  isLiveFour(line, player) {
    const opponent = player === 1 ? 2 : 1;
    const count = line.filter(cell => cell === player).length;
    const emptyCount = line.filter(cell => cell === 0).length;
    const opponentCount = line.filter(cell => cell === opponent).length;

    if (opponentCount > 0) {
      return false;
    }

    if (count === 4 && emptyCount === 1) {
      return true;
    }

    return false;
  }

  // 检查是否有冲四
  hasRushFour(board, player) {
    // 检查横向
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length - 4; c++) {
        const line = board[r].slice(c, c + 5);
        if (this.isRushFour(line, player)) {
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
        if (this.isRushFour(line, player)) {
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
        if (this.isRushFour(line, player)) {
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
        if (this.isRushFour(line, player)) {
          return true;
        }
      }
    }

    return false;
  }

  // 检查是否是冲四
  isRushFour(line, player) {
    const opponent = player === 1 ? 2 : 1;
    const count = line.filter(cell => cell === player).length;
    const emptyCount = line.filter(cell => cell === 0).length;
    const opponentCount = line.filter(cell => cell === opponent).length;

    if (opponentCount > 0) {
      return false;
    }

    if (count === 4 && emptyCount === 1) {
      // 冲四是指一端被堵住的四
      if (line[0] === 0 || line[4] === 0) {
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

  // 象棋简单难度 - 智能随机走棋
  getChessEasyMove(board, currentPlayer) {
    const pieces = this.getChessPieces(board, currentPlayer);
    if (pieces.length === 0) return null;

    // 评估每个棋子的移动
    const scoredMoves = [];
    for (const piece of pieces) {
      const validMoves = this.getChessValidMoves(board, piece);
      for (const move of validMoves) {
        let score = 0;

        // 优先吃子
        if (board[move.r][move.c] !== 0 && board[move.r][move.c] !== currentPlayer) {
          score += 50;
        }

        // 优先向前移动
        if (currentPlayer === 1 && move.r > piece.r) {
          score += 5;
        } else if (currentPlayer === 2 && move.r < piece.r) {
          score += 5;
        }

        // 优先靠近中心
        const centerDistance = Math.abs(move.r - 4.5) + Math.abs(move.c - 4);
        score += (10 - centerDistance);

        scoredMoves.push({
          fromR: piece.r,
          fromC: piece.c,
          toR: move.r,
          toC: move.c,
          score: score
        });
      }
    }

    if (scoredMoves.length === 0) return null;

    // 按分数排序
    scoredMoves.sort((a, b) => b.score - a.score);

    // 从前10个候选移动中随机选择
    const topCandidates = scoredMoves.slice(0, Math.min(10, scoredMoves.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    // 只返回移动信息，不包含score
    return { fromR: selected.fromR, fromC: selected.fromC, toR: selected.toR, toC: selected.toC };
  }

  // 象棋中等难度 - 基于规则的AI
  getChessMediumMove(board, currentPlayer) {
    // 先尝试吃子
    const captureMove = this.findChessCaptureMove(board, currentPlayer);
    if (captureMove) return captureMove;

    // 评估所有移动
    const pieces = this.getChessPieces(board, currentPlayer);
    const scoredMoves = [];
    for (const piece of pieces) {
      const validMoves = this.getChessValidMoves(board, piece);
      for (const move of validMoves) {
        let score = 0;

        // 优先吃子
        if (board[move.r][move.c] !== 0 && board[move.r][move.c] !== currentPlayer) {
          score += 100;
        }

        // 优先向前移动
        if (currentPlayer === 1 && move.r > piece.r) {
          score += 10;
        } else if (currentPlayer === 2 && move.r < piece.r) {
          score += 10;
        }

        // 优先靠近中心
        const centerDistance = Math.abs(move.r - 4.5) + Math.abs(move.c - 4);
        score += (15 - centerDistance);

        // 优先保护重要棋子
        if (this.isImportantPiece(piece.type)) {
          score += 20;
        }

        scoredMoves.push({
          fromR: piece.r,
          fromC: piece.c,
          toR: move.r,
          toC: move.c,
          score: score
        });
      }
    }

    if (scoredMoves.length === 0) return null;

    // 按分数排序
    scoredMoves.sort((a, b) => b.score - a.score);

    // 从前5个候选移动中随机选择
    const topCandidates = scoredMoves.slice(0, Math.min(5, scoredMoves.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    // 只返回移动信息，不包含score
    return { fromR: selected.fromR, fromC: selected.fromC, toR: selected.toR, toC: selected.toC };
  }

  // 象棋困难难度 - 基于Minimax算法
  getChessHardMove(board, currentPlayer) {
    // 使用中等难度算法，但选择最优位置
    const pieces = this.getChessPieces(board, currentPlayer);
    const scoredMoves = [];
    for (const piece of pieces) {
      const validMoves = this.getChessValidMoves(board, piece);
      for (const move of validMoves) {
        let score = 0;

        // 优先吃子
        if (board[move.r][move.c] !== 0 && board[move.r][move.c] !== currentPlayer) {
          score += 150;
        }

        // 优先向前移动
        if (currentPlayer === 1 && move.r > piece.r) {
          score += 15;
        } else if (currentPlayer === 2 && move.r < piece.r) {
          score += 15;
        }

        // 优先靠近中心
        const centerDistance = Math.abs(move.r - 4.5) + Math.abs(move.c - 4);
        score += (20 - centerDistance);

        // 优先保护重要棋子
        if (this.isImportantPiece(piece.type)) {
          score += 30;
        }

        // 优先攻击重要棋子
        if (this.isImportantPiece(board[move.r][move.c])) {
          score += 50;
        }

        scoredMoves.push({
          fromR: piece.r,
          fromC: piece.c,
          toR: move.r,
          toC: move.c,
          score: score
        });
      }
    }

    if (scoredMoves.length === 0) return null;

    // 按分数排序
    scoredMoves.sort((a, b) => b.score - a.score);

    // 选择最优移动
    const selected = scoredMoves[0];
    // 只返回移动信息，不包含score
    return { fromR: selected.fromR, fromC: selected.fromC, toR: selected.toR, toC: selected.toC };
  }

  // 检查是否是重要棋子
  isImportantPiece(pieceType) {
    // 将、车、马、炮是重要棋子
    return pieceType === 'king' || pieceType === 'rook' || pieceType === 'horse' || pieceType === 'cannon';
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

  // 围棋简单难度 - 智能随机落子
  getGoEasyMove(board) {
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) return null;

    // 优先选择靠近已有棋子的位置
    const scoredCells = emptyCells.map(cell => {
      let score = 0;
      // 检查周围4个方向是否有棋子
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
            if (board[nr][nc] !== 0) {
              // 距离越近分数越高
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 10;
            }
          }
        }
      }
      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 从前20个候选位置中随机选择
    const topCandidates = scoredCells.slice(0, Math.min(20, scoredCells.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    // 只返回 r 和 c
    return { r: selected.r, c: selected.c };
  }

  // 围棋中等难度 - 基于规则的AI
  getGoMediumMove(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) return null;

    // 评估每个空位
    const scoredCells = emptyCells.map(cell => {
      let score = 0;

      // 检查周围棋子
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
            if (board[nr][nc] === currentPlayer) {
              score += 5; // 靠近自己的棋子
            } else if (board[nr][nc] === opponent) {
              score += 3; // 靠近对手的棋子（阻挡）
            }
          }
        }
      }

      // 检查是否可以吃子
      if (this.canCapture(board, cell.r, cell.c, currentPlayer)) {
        score += 50;
      }

      // 检查是否会被吃
      if (!this.willBeCaptured(board, cell.r, cell.c, currentPlayer)) {
        score += 20; // 安全位置
      }

      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 从前10个候选位置中随机选择
    const topCandidates = scoredCells.slice(0, Math.min(10, scoredCells.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    // 只返回 r 和 c
    return { r: selected.r, c: selected.c };
  }

  // 围棋困难难度 - 基于Minimax算法
  getGoHardMove(board, currentPlayer) {
    // 使用中等难度算法，但选择最优位置
    const opponent = currentPlayer === 1 ? 2 : 1;
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) return null;

    // 评估每个空位
    const scoredCells = emptyCells.map(cell => {
      let score = 0;

      // 检查周围棋子
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
            if (board[nr][nc] === currentPlayer) {
              // 距离越近分数越高
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 8;
            } else if (board[nr][nc] === opponent) {
              // 靠近对手的棋子（阻挡）
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 5;
            }
          }
        }
      }

      // 检查是否可以吃子
      if (this.canCapture(board, cell.r, cell.c, currentPlayer)) {
        score += 100;
      }

      // 检查是否会被吃
      if (!this.willBeCaptured(board, cell.r, cell.c, currentPlayer)) {
        score += 30; // 安全位置
      }

      // 检查是否在星位附近
      if (this.isNearStarPoint(cell.r, cell.c)) {
        score += 15;
      }

      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 选择最优位置
    const selected = scoredCells[0];
    // 只返回 r 和 c
    return { r: selected.r, c: selected.c };
  }

  // 检查是否可以吃子
  canCapture(board, r, c, player) {
    const opponent = player === 1 ? 2 : 1;
    let canCapture = false;

    // 检查四个方向的对手棋子
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of directions) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
        if (board[nr][nc] === opponent) {
          // 检查这个棋子是否只有一口气
          if (this.countLiberties(board, nr, nc) === 1) {
            canCapture = true;
            break;
          }
        }
      }
    }

    return canCapture;
  }

  // 检查是否会被吃
  willBeCaptured(board, r, c, player) {
    // 模拟落子
    board[r][c] = player;
    const liberties = this.countLiberties(board, r, c);
    board[r][c] = 0;

    return liberties === 0;
  }

  // 计算气的数量
  countLiberties(board, r, c) {
    const player = board[r][c];
    if (player === 0) return 0;

    const liberties = new Set();
    const directions = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    for (const [dr, dc] of directions) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
        if (board[nr][nc] === 0) {
          liberties.add(`${nr},${nc}`);
        }
      }
    }

    return liberties.size;
  }

  // 检查是否在星位附近
  isNearStarPoint(r, c) {
    const starPoints = [
      [3, 3], [3, 9], [3, 15],
      [9, 3], [9, 9], [9, 15],
      [15, 3], [15, 9], [15, 15]
    ];

    for (const [sr, sc] of starPoints) {
      const distance = Math.abs(r - sr) + Math.abs(c - sc);
      if (distance <= 2) {
        return true;
      }
    }

    return false;
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