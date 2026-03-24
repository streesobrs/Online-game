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

  // 五子棋简单难度 - 基于基础规则的AI（平衡攻防）
  getGobangEasyMove(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;

    // ===== 最高优先级：立即获胜或阻止对手获胜 =====
    // 检查是否可以赢
    const winningMove = this.findWinningMove(board, currentPlayer);
    if (winningMove) {
      return winningMove;
    }

    // 检查是否需要防守（对手即将获胜）
    const defensiveMove = this.findWinningMove(board, opponent);
    if (defensiveMove) {
      return defensiveMove;
    }

    // 检查是否需要防守4连珠（紧急防守）
    const defensiveFourInRow = this.findFourInRowDefense(board, opponent);
    if (defensiveFourInRow) {
      return defensiveFourInRow;
    }

    // 检查是否需要防守对手可以形成的4连珠（包括间隔的情况）
    const defensiveFourInRowMove = this.findFourInRowMove(board, opponent);
    if (defensiveFourInRowMove) {
      return defensiveFourInRowMove;
    }

    // ===== 高优先级：形成自己的攻势 =====
    // 检查是否可以形成活四（必胜）
    const liveFourMove = this.findLiveFourMove(board, currentPlayer);
    if (liveFourMove) {
      return liveFourMove;
    }

    // 检查是否可以形成4连珠
    const fourInRowMove = this.findFourInRowMove(board, currentPlayer);
    if (fourInRowMove) {
      return fourInRowMove;
    }

    // 检查是否可以形成冲四
    const rushFourMove = this.findRushFourMove(board, currentPlayer);
    if (rushFourMove) {
      return rushFourMove;
    }

    // ===== 中优先级：防守对手的强威胁 =====
    // 检查是否需要防守活四
    const defensiveLiveFourMove = this.findLiveFourMove(board, opponent);
    if (defensiveLiveFourMove) {
      return defensiveLiveFourMove;
    }

    // 检查是否需要防守冲四
    const defensiveRushFourMove = this.findRushFourMove(board, opponent);
    if (defensiveRushFourMove) {
      return defensiveRushFourMove;
    }

    // ===== 低优先级：活三攻防 =====
    // 检查是否可以形成活三（优先于防守活三）
    const liveThreeMove = this.findLiveThreeMove(board, currentPlayer);
    if (liveThreeMove) {
      return liveThreeMove;
    }

    // 检查是否需要防守活三
    const defensiveLiveThreeMove = this.findLiveThreeMove(board, opponent);
    if (defensiveLiveThreeMove) {
      return defensiveLiveThreeMove;
    }

    // 积极防守：寻找对手最有威胁的位置并阻挡
    const bestDefensiveMove = this.findBestDefensiveMoveV2(board, opponent, currentPlayer);
    if (bestDefensiveMove) {
      return bestDefensiveMove;
    }

    // 使用困难级位置选择（让简单AI也更聪明）
    return this.getBestPositionByScoreHard(board, currentPlayer, opponent);
  }

  // 智能随机落子 - 优先选择靠近已有棋子的位置
  getGobangRandomMove(board) {
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

  // 五子棋中等难度 - 在简单基础上更具侵略性
  getGobangMediumMove(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;

    // ===== 最高优先级：立即获胜或阻止对手获胜 =====
    // 检查是否可以赢
    const winningMove = this.findWinningMove(board, currentPlayer);
    if (winningMove) {
      return winningMove;
    }

    // 检查是否需要防守（对手即将获胜）
    const defensiveMove = this.findWinningMove(board, opponent);
    if (defensiveMove) {
      return defensiveMove;
    }

    // 检查是否需要防守4连珠（紧急防守）
    const defensiveFourInRow = this.findFourInRowDefense(board, opponent);
    if (defensiveFourInRow) {
      return defensiveFourInRow;
    }

    // 检查是否需要防守对手可以形成的4连珠（包括间隔的情况）
    const defensiveFourInRowMove = this.findFourInRowMove(board, opponent);
    if (defensiveFourInRowMove) {
      return defensiveFourInRowMove;
    }

    // ===== 高优先级：形成自己的强攻势 =====
    // 检查是否可以形成活四（必胜）
    const liveFourMove = this.findLiveFourMove(board, currentPlayer);
    if (liveFourMove) {
      return liveFourMove;
    }

    // 检查是否可以形成4连珠
    const fourInRowMove = this.findFourInRowMove(board, currentPlayer);
    if (fourInRowMove) {
      return fourInRowMove;
    }

    // 检查是否可以形成冲四
    const rushFourMove = this.findRushFourMove(board, currentPlayer);
    if (rushFourMove) {
      return rushFourMove;
    }

    // ===== 中优先级：防守对手的强威胁 =====
    // 检查是否需要防守活四
    const defensiveLiveFourMove = this.findLiveFourMove(board, opponent);
    if (defensiveLiveFourMove) {
      return defensiveLiveFourMove;
    }

    // 检查是否需要防守冲四
    const defensiveRushFourMove = this.findRushFourMove(board, opponent);
    if (defensiveRushFourMove) {
      return defensiveRushFourMove;
    }

    // ===== 中等难度新增：高级进攻策略（优先于防守活三） =====
    // 检查是否可以形成双活三（必胜局面）
    const doubleLiveThreeMove = this.findDoubleLiveThreeMove(board, currentPlayer);
    if (doubleLiveThreeMove) {
      return doubleLiveThreeMove;
    }

    // 检查是否需要防守对手的双活三
    const defensiveDoubleLiveThree = this.findDoubleLiveThreeMove(board, opponent);
    if (defensiveDoubleLiveThree) {
      return defensiveDoubleLiveThree;
    }

    // 检查是否可以形成双活二
    const doubleLiveTwoMove = this.findDoubleLiveTwoMove(board, currentPlayer);
    if (doubleLiveTwoMove) {
      return doubleLiveTwoMove;
    }

    // ===== 低优先级：活三攻防 =====
    // 检查是否可以形成活三（优先于防守活三）
    const liveThreeMove = this.findLiveThreeMove(board, currentPlayer);
    if (liveThreeMove) {
      return liveThreeMove;
    }

    // 检查是否需要防守活三
    const defensiveLiveThreeMove = this.findLiveThreeMove(board, opponent);
    if (defensiveLiveThreeMove) {
      return defensiveLiveThreeMove;
    }

    // 积极进攻：寻找最佳进攻位置（优先于防守活二）
    const bestAttackMove = this.findBestAttackMove(board, currentPlayer, opponent);
    if (bestAttackMove && bestAttackMove.score >= 50) {
      return { r: bestAttackMove.r, c: bestAttackMove.c };
    }

    // ===== 基础防守 =====
    // 防守活二
    const defensiveLiveTwoMove = this.findBestDefensiveMoveV2(board, opponent, currentPlayer);
    if (defensiveLiveTwoMove) {
      return defensiveLiveTwoMove;
    }

    // 使用最优位置选择（无随机性，始终选择最佳）
    return this.getBestPositionByScoreHard(board, currentPlayer, opponent);
  }

  // 五子棋困难难度 - 基于 Minimax 算法（增强进攻版）
  getGobangHardMove(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;

    // ===== 立即检测关键位置 =====
    // 检查是否可以赢
    const winningMove = this.findWinningMove(board, currentPlayer);
    if (winningMove) {
      return winningMove;
    }

    // 检查是否需要防守（对手即将获胜）
    const defensiveMove = this.findWinningMove(board, opponent);
    if (defensiveMove) {
      return defensiveMove;
    }

    // 检查是否需要防守4连珠
    const defensiveFourInRow = this.findFourInRowDefense(board, opponent);
    if (defensiveFourInRow) {
      return defensiveFourInRow;
    }

    // 检查是否需要防守对手可以形成的4连珠（包括间隔的情况）
    const defensiveFourInRowMove = this.findFourInRowMove(board, opponent);
    if (defensiveFourInRowMove) {
      return defensiveFourInRowMove;
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

    // 检查是否可以形成4连珠（更全面的检测）
    const fourInRowMove = this.findFourInRowMove(board, currentPlayer);
    if (fourInRowMove) {
      return fourInRowMove;
    }

    // 检查是否可以形成冲四（形成4连珠）
    const rushFourMove = this.findRushFourMove(board, currentPlayer);
    if (rushFourMove) {
      return rushFourMove;
    }

    // 检查是否需要防守冲四
    const defensiveRushFourMove = this.findRushFourMove(board, opponent);
    if (defensiveRushFourMove) {
      return defensiveRushFourMove;
    }

    // 检查是否可以形成双活三（必胜）
    const doubleLiveThreeMove = this.findDoubleLiveThreeMove(board, currentPlayer);
    if (doubleLiveThreeMove) {
      return doubleLiveThreeMove;
    }

    // 检查是否需要防守对手的双活三
    const defensiveDoubleLiveThree = this.findDoubleLiveThreeMove(board, opponent);
    if (defensiveDoubleLiveThree) {
      return defensiveDoubleLiveThree;
    }

    // ===== 预测玩家关键落子位置 =====
    // 预测玩家最可能的下一步（高威胁位置）
    const predictedPlayerMove = this.predictPlayerMove(board, opponent);
    if (predictedPlayerMove && predictedPlayerMove.score >= 2000) {
      // 优先阻断玩家的高威胁位置
      const blockMove = this.findBlockingMove(board, opponent, predictedPlayerMove);
      if (blockMove) {
        return blockMove;
      }
    }

    // ===== 使用增强的 Minimax 算法 =====
    // 获取候选位置（只搜索最有威胁的位置）
    const candidateMoves = this.getCandidateMovesEnhanced(board, currentPlayer);

    if (candidateMoves.length === 0) {
      // 如果没有候选位置，下在中心
      const centerR = Math.floor(board.length / 2);
      const centerC = Math.floor(board[0].length / 2);
      return { r: centerR, c: centerC };
    }

    // 搜索深度8-10层（更深的搜索，实现3-5步预测）
    // 根据棋盘复杂度动态调整深度
    let depth = 8;
    const emptyCount = this.getEmptyCells(board).length;
    if (emptyCount < 20) depth = 10; // 残局时深度更深
    if (emptyCount > 40) depth = 7;  // 开局时稍浅一点

    const result = this.minimaxOptimized(board, depth, currentPlayer, -Infinity, Infinity, true, candidateMoves);

    // 返回最佳移动位置
    if (result && result.move) {
      return result.move;
    }

    // 如果Minimax没有找到好棋，回退到中等难度
    return this.getGobangMediumMove(board, currentPlayer);
  }

  // 获取候选位置（更大范围搜索，更多候选位置）
  getCandidateMoves(board, currentPlayer) {
    const candidates = [];
    const visited = new Set();

    // 遍历所有已有棋子周围的位置
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== 0) {
          // 检查周围3格范围内的空位（更大搜索范围）
          for (let dr = -3; dr <= 3; dr++) {
            for (let dc = -3; dc <= 3; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              const key = `${nr},${nc}`;

              if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length &&
                board[nr][nc] === 0 && !visited.has(key)) {
                visited.add(key);
                // 评估这个位置的优先级
                const score = this.evaluateCandidatePosition(board, nr, nc, currentPlayer);
                candidates.push({ r: nr, c: nc, score });
              }
            }
          }
        }
      }
    }

    // 按分数排序，优先搜索高分位置
    candidates.sort((a, b) => b.score - a.score);

    // 增加候选数量到30个（更全面的搜索）
    return candidates.slice(0, Math.min(30, candidates.length));
  }

  // 评估候选位置的优先级
  evaluateCandidatePosition(board, r, c, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    let score = 0;

    // 进攻评分
    board[r][c] = currentPlayer;
    score += this.evaluatePositionV2(board, r, c, currentPlayer) * 1.5;
    board[r][c] = 0;

    // 防守评分
    board[r][c] = opponent;
    score += this.evaluatePositionV2(board, r, c, opponent);
    board[r][c] = 0;

    return score;
  }

  // 优化的 Minimax 算法
  minimaxOptimized(board, depth, currentPlayer, alpha, beta, maximizingPlayer, candidateMoves) {
    const opponent = currentPlayer === 1 ? 2 : 1;

    // 终止条件
    if (depth === 0 || this.isGameOver(board)) {
      const score = this.evaluateBoardAdvanced(board, currentPlayer);
      return { score };
    }

    // 获取候选位置
    let moves = candidateMoves;
    if (!moves || moves.length === 0) {
      moves = this.getCandidateMoves(board, currentPlayer);
    }

    if (moves.length === 0) {
      return { score: this.evaluateBoardAdvanced(board, currentPlayer) };
    }

    if (maximizingPlayer) {
      let bestScore = -Infinity;
      let bestMove = null;

      for (const cell of moves) {
        board[cell.r][cell.c] = currentPlayer;
        const result = this.minimaxOptimized(board, depth - 1, currentPlayer, alpha, beta, false, null);
        board[cell.r][cell.c] = 0;

        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = { r: cell.r, c: cell.c };
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

      for (const cell of moves) {
        board[cell.r][cell.c] = opponent;
        const result = this.minimaxOptimized(board, depth - 1, currentPlayer, alpha, beta, true, null);
        board[cell.r][cell.c] = 0;

        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = { r: cell.r, c: cell.c };
        }

        beta = Math.min(beta, bestScore);
        if (beta <= alpha) {
          break;
        }
      }

      return { score: bestScore, move: bestMove };
    }
  }

  // 高级棋盘评估函数（增强版 - 更高的进攻和防守权重
  evaluateBoardAdvanced(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    let score = 0;

    // 评估连子情况 - 显著提高权重
    score += this.evaluateLinesAdvanced(board, currentPlayer) * 20;
    score -= this.evaluateLinesAdvanced(board, opponent) * 18;

    // 位置优势评估
    score += this.evaluatePositionAdvantage(board, currentPlayer);
    score -= this.evaluatePositionAdvantage(board, opponent) * 1.2;

    return score;
  }

  // 高级连子评估
  evaluateLinesAdvanced(board, player) {
    let score = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== player) continue;

        for (const [dr, dc] of directions) {
          // 检查这个方向上的连子
          let count = 1;
          let emptyEnds = 0;
          let blocked = 0;

          // 正向检查
          for (let i = 1; i < 5; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) {
              blocked++;
              break;
            }
            if (board[nr][nc] === player) {
              count++;
            } else if (board[nr][nc] === 0) {
              emptyEnds++;
              break;
            } else {
              blocked++;
              break;
            }
          }

          // 反向检查
          for (let i = 1; i < 5; i++) {
            const nr = r - dr * i;
            const nc = c - dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) {
              blocked++;
              break;
            }
            if (board[nr][nc] === player) {
              count++;
            } else if (board[nr][nc] === 0) {
              emptyEnds++;
              break;
            } else {
              blocked++;
              break;
            }
          }

          // 评分（大幅提高 - 更重视连子）
          if (count >= 5) {
            score += 500000; // 获胜 - 极高权重
          } else if (count === 4 && emptyEnds === 2) {
            score += 50000; // 活四 - 必胜局面
          } else if (count === 4 && emptyEnds === 1) {
            score += 5000; // 冲四 - 强威胁
          } else if (count === 3 && emptyEnds === 2) {
            score += 2000; // 活三 - 很强的威胁
          } else if (count === 3 && emptyEnds === 1) {
            score += 500; // 眠三
          } else if (count === 2 && emptyEnds === 2) {
            score += 200; // 活二
          } else if (count === 2 && emptyEnds === 1) {
            score += 50; // 眠二
          }
        }
      }
    }

    return score;
  }

  // 位置优势评估
  evaluatePositionAdvantage(board, player) {
    let score = 0;
    const centerR = Math.floor(board.length / 2);
    const centerC = Math.floor(board[0].length / 2);

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] === player) {
          // 越靠近中心分数越高
          const distanceToCenter = Math.abs(r - centerR) + Math.abs(c - centerC);
          score += Math.max(0, 20 - distanceToCenter);
        }
      }
    }

    return score;
  }

  // 评估棋盘（保留旧版本兼容性）
  evaluateBoard(board, currentPlayer) {
    return this.evaluateBoardAdvanced(board, currentPlayer);
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

  // 寻找可以形成4连珠的位置（更全面的检测）
  findFourInRowMove(board, player) {
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];
    let bestMove = null;
    let bestScore = 0;

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== 0) continue;

        // 模拟在这个位置落子
        board[r][c] = player;

        // 检查每个方向是否能形成4连珠
        for (const [dr, dc] of directions) {
          let count = 1;
          let emptyEnds = 0;

          // 正向检查
          for (let i = 1; i < 5; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
            if (board[nr][nc] === player) {
              count++;
            } else if (board[nr][nc] === 0) {
              emptyEnds++;
              break;
            } else {
              break;
            }
          }

          // 反向检查
          for (let i = 1; i < 5; i++) {
            const nr = r - dr * i;
            const nc = c - dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
            if (board[nr][nc] === player) {
              count++;
            } else if (board[nr][nc] === 0) {
              emptyEnds++;
              break;
            } else {
              break;
            }
          }

          // 如果能形成4连珠，评估这个位置
          if (count === 4) {
            let score = 1000;
            // 活四（两端都空）优先级更高
            if (emptyEnds === 2) {
              score = 10000;
            }
            if (score > bestScore) {
              bestScore = score;
              bestMove = { r, c };
            }
          }
        }

        board[r][c] = 0;
      }
    }

    return bestMove;
  }

  // 寻找4连珠防守位置（检测并阻挡对手的4连珠）
  findFourInRowDefense(board, opponent) {
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== opponent) continue;

        for (const [dr, dc] of directions) {
          // 收集这个方向上的所有连续棋子
          let positions = [{ r, c }];
          let emptyBefore = null;
          let emptyAfter = null;

          // 正向检查
          for (let i = 1; i < 6; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;

            if (board[nr][nc] === opponent) {
              positions.push({ r: nr, c: nc });
            } else if (board[nr][nc] === 0) {
              emptyAfter = { r: nr, c: nc };
              break;
            } else {
              break;
            }
          }

          // 反向检查
          for (let i = 1; i < 6; i++) {
            const nr = r - dr * i;
            const nc = c - dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;

            if (board[nr][nc] === opponent) {
              positions.unshift({ r: nr, c: nc });
            } else if (board[nr][nc] === 0) {
              emptyBefore = { r: nr, c: nc };
              break;
            } else {
              break;
            }
          }

          // 如果对手有4连珠，立即阻挡
          if (positions.length === 4) {
            // 优先阻挡有威胁的一端（靠近边缘或已有棋子的方向）
            if (emptyBefore) return emptyBefore;
            if (emptyAfter) return emptyAfter;
          }

          // 如果对手有3连珠且两端都是空的，也要防守（可能形成活四）
          if (positions.length === 3 && emptyBefore && emptyAfter) {
            // 这是一个活三，优先选择靠近中心的位置
            return emptyBefore;
          }
        }
      }
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

  // 寻找双活三移动（形成两个活三，必胜局面）
  findDoubleLiveThreeMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      const liveThreeCount = this.countLiveThree(board, player);
      board[cell.r][cell.c] = 0;
      if (liveThreeCount >= 2) {
        return cell;
      }
    }
    return null;
  }

  // 计算活三数量
  countLiveThree(board, player) {
    let count = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== player) continue;

        for (const [dr, dc] of directions) {
          // 检查以(r,c)开始的5个格子
          let playerCount = 0;
          let emptyCount = 0;
          let emptyPositions = [];

          for (let i = 0; i < 5; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;

            if (board[nr][nc] === player) {
              playerCount++;
            } else if (board[nr][nc] === 0) {
              emptyCount++;
              emptyPositions.push({ r: nr, c: nc });
            } else {
              break;
            }
          }

          // 活三：3个自己的棋子，2个空位，且两端都是空的
          if (playerCount === 3 && emptyCount === 2) {
            const beforeR = r - dr;
            const beforeC = c - dc;
            const afterR = r + dr * 5;
            const afterC = c + dc * 5;

            const beforeEmpty = beforeR < 0 || beforeR >= board.length || beforeC < 0 || beforeC >= board[0].length || board[beforeR][beforeC] === 0;
            const afterEmpty = afterR < 0 || afterR >= board.length || afterC < 0 || afterC >= board[0].length || board[afterR][afterC] === 0;

            if (beforeEmpty && afterEmpty) {
              count++;
            }
          }
        }
      }
    }
    return count;
  }

  // 寻找双活二移动
  findDoubleLiveTwoMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      const liveTwoCount = this.countLiveTwo(board, player);
      board[cell.r][cell.c] = 0;
      if (liveTwoCount >= 2) {
        return cell;
      }
    }
    return null;
  }

  // 计算活二数量
  countLiveTwo(board, player) {
    let count = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== player) continue;

        for (const [dr, dc] of directions) {
          let playerCount = 0;
          let emptyCount = 0;

          for (let i = 0; i < 5; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;

            if (board[nr][nc] === player) {
              playerCount++;
            } else if (board[nr][nc] === 0) {
              emptyCount++;
            } else {
              break;
            }
          }

          // 活二：2个自己的棋子，3个空位
          if (playerCount === 2 && emptyCount === 3) {
            count++;
          }
        }
      }
    }
    return count;
  }

  // 通过位置评分选择最佳位置
  getBestPositionByScore(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    const emptyCells = this.getEmptyCells(board);

    if (emptyCells.length === 0) return null;

    // 评估每个空位
    const scoredCells = emptyCells.map(cell => {
      let score = 0;

      // 进攻评分：在这个位置落子后自己的连子情况
      board[cell.r][cell.c] = currentPlayer;
      score += this.evaluatePosition(board, cell.r, cell.c, currentPlayer) * 1.2;
      board[cell.r][cell.c] = 0;

      // 防守评分：对手在这个位置落子后的威胁
      board[cell.r][cell.c] = opponent;
      score += this.evaluatePosition(board, cell.r, cell.c, opponent) * 0.8;
      board[cell.r][cell.c] = 0;

      // 中心位置加分
      const centerR = Math.floor(board.length / 2);
      const centerC = Math.floor(board[0].length / 2);
      const distanceToCenter = Math.abs(cell.r - centerR) + Math.abs(cell.c - centerC);
      score += Math.max(0, 10 - distanceToCenter);

      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 从前5个候选位置中随机选择（增加变化性）
    const topCandidates = scoredCells.slice(0, Math.min(5, scoredCells.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    return { r: selected.r, c: selected.c };
  }

  // 评估某个位置的威胁程度
  evaluatePosition(board, r, c, player) {
    let score = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (const [dr, dc] of directions) {
      // 检查这个方向上的连子情况
      let count = 1; // 包括当前位置
      let emptyEnds = 0;

      // 正向检查
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i;
        const nc = c + dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          count++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          break;
        } else {
          break;
        }
      }

      // 反向检查
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i;
        const nc = c - dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          count++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          break;
        } else {
          break;
        }
      }

      // 根据连子数和开放端评分
      if (count >= 5) {
        score += 10000; // 获胜
      } else if (count === 4 && emptyEnds === 2) {
        score += 1000; // 活四
      } else if (count === 4 && emptyEnds === 1) {
        score += 100; // 冲四
      } else if (count === 3 && emptyEnds === 2) {
        score += 50; // 活三
      } else if (count === 3 && emptyEnds === 1) {
        score += 10; // 冲三
      } else if (count === 2 && emptyEnds === 2) {
        score += 5; // 活二
      }
    }

    return score;
  }

  // 寻找最佳防守位置（阻挡对手的棋）
  findBestDefensiveMove(board, opponent, currentPlayer) {
    const emptyCells = this.getEmptyCells(board);
    let bestMove = null;
    let maxThreat = 0;

    for (const cell of emptyCells) {
      // 模拟对手在这个位置落子后的威胁程度
      board[cell.r][cell.c] = opponent;
      const threatScore = this.evaluateThreat(board, cell.r, cell.c, opponent);
      board[cell.r][cell.c] = 0;

      // 如果这个位置对手的威胁很高，我们应该防守
      if (threatScore > maxThreat && threatScore >= 30) { // 30分以上是活二或更高威胁
        maxThreat = threatScore;
        bestMove = cell;
      }
    }

    return bestMove;
  }

  // 评估某个位置对玩家的威胁程度
  evaluateThreat(board, r, c, player) {
    let maxThreat = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (const [dr, dc] of directions) {
      // 检查这个方向上的连子情况
      let count = 1; // 包括当前位置
      let emptyEnds = 0;
      let consecutive = true;

      // 正向检查
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i;
        const nc = c + dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          if (consecutive) count++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          consecutive = false;
        } else {
          break;
        }
      }

      // 反向检查
      consecutive = true;
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i;
        const nc = c - dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          if (consecutive) count++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          consecutive = false;
        } else {
          break;
        }
      }

      // 计算威胁分数
      let threat = 0;
      if (count >= 4) {
        threat = 100; // 很高威胁
      } else if (count === 3 && emptyEnds >= 1) {
        threat = 50; // 中等威胁（活三或冲三）
      } else if (count === 2 && emptyEnds === 2) {
        threat = 30; // 低威胁（活二）
      }

      maxThreat = Math.max(maxThreat, threat);
    }

    return maxThreat;
  }

  // 寻找最佳防守位置V2（更积极的防守）
  findBestDefensiveMoveV2(board, opponent, currentPlayer) {
    const emptyCells = this.getEmptyCells(board);
    let bestMove = null;
    let maxThreat = 0;

    for (const cell of emptyCells) {
      // 模拟对手在这个位置落子后的威胁程度
      board[cell.r][cell.c] = opponent;
      const threatScore = this.evaluateThreatV2(board, cell.r, cell.c, opponent);
      board[cell.r][cell.c] = 0;

      // 只要有威胁就考虑防守，降低阈值到5分（任何连子）
      if (threatScore > maxThreat && threatScore >= 5) {
        maxThreat = threatScore;
        bestMove = cell;
      }
    }

    return bestMove;
  }

  // 评估某个位置对玩家的威胁程度V2（更敏感）
  evaluateThreatV2(board, r, c, player) {
    let maxThreat = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (const [dr, dc] of directions) {
      // 检查这个方向上的连子情况
      let count = 1; // 包括当前位置
      let emptyEnds = 0;
      let consecutiveCount = 1;

      // 正向检查
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i;
        const nc = c + dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          count++;
          consecutiveCount++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          break;
        } else {
          break;
        }
      }

      // 反向检查
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i;
        const nc = c - dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          count++;
          consecutiveCount++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          break;
        } else {
          break;
        }
      }

      // 计算威胁分数（更敏感的评分）
      let threat = 0;
      if (consecutiveCount >= 5) {
        threat = 10000; // 获胜
      } else if (consecutiveCount === 4) {
        threat = 1000; // 四连
      } else if (consecutiveCount === 3 && emptyEnds >= 1) {
        threat = 100; // 三连
      } else if (consecutiveCount === 2 && emptyEnds === 2) {
        threat = 10; // 二连（活二）
      } else if (consecutiveCount === 2 && emptyEnds >= 1) {
        threat = 5; // 二连（冲二）
      } else if (consecutiveCount === 1 && emptyEnds >= 1) {
        threat = 1; // 单点连接
      }

      maxThreat = Math.max(maxThreat, threat);
    }

    return maxThreat;
  }

  // 防守型智能随机落子（优先靠近对手棋子）
  getGobangRandomMoveDefensive(board, opponent) {
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) {
      return null;
    }

    // 优先选择靠近对手棋子的位置
    const scoredCells = emptyCells.map(cell => {
      let score = 0;
      // 检查周围8个方向是否有对手的棋子
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
            if (board[nr][nc] === opponent) {
              // 距离越近分数越高
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 20; // 提高对手棋子的权重
            } else if (board[nr][nc] !== 0) {
              // 自己的棋子也考虑，但权重较低
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 5;
            }
          }
        }
      }
      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 从前10个候选位置中随机选择
    const topCandidates = scoredCells.slice(0, Math.min(10, scoredCells.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];

    return { r: selected.r, c: selected.c };
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

  // 寻找最佳进攻位置（更具侵略性）
  findBestAttackMove(board, currentPlayer, opponent) {
    const emptyCells = this.getEmptyCells(board);
    let bestMove = null;
    let maxScore = 0;

    for (const cell of emptyCells) {
      // 评估进攻分数
      board[cell.r][cell.c] = currentPlayer;
      const attackScore = this.evaluatePositionV2(board, cell.r, cell.c, currentPlayer);
      board[cell.r][cell.c] = 0;

      // 只考虑有威胁的进攻位置
      if (attackScore > maxScore && attackScore >= 50) {
        maxScore = attackScore;
        bestMove = { r: cell.r, c: cell.c, score: attackScore };
      }
    }

    return bestMove;
  }

  // 评估某个位置的威胁程度V2（更详细的评分）
  evaluatePositionV2(board, r, c, player) {
    let totalScore = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (const [dr, dc] of directions) {
      // 检查这个方向上的连子情况
      let count = 1; // 包括当前位置
      let emptyEnds = 0;
      let space = 0;

      // 正向检查
      for (let i = 1; i < 5; i++) {
        const nr = r + dr * i;
        const nc = c + dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          count++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          space++;
          break;
        } else {
          break;
        }
      }

      // 反向检查
      for (let i = 1; i < 5; i++) {
        const nr = r - dr * i;
        const nc = c - dc * i;
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
        if (board[nr][nc] === player) {
          count++;
        } else if (board[nr][nc] === 0) {
          emptyEnds++;
          space++;
          break;
        } else {
          break;
        }
      }

      // 根据连子数和开放端评分（进攻导向 - 大幅提高）
      let score = 0;
      if (count >= 5) {
        score = 100000; // 获胜 - 极高权重
      } else if (count === 4 && emptyEnds === 2) {
        score = 20000; // 活四（必胜）- 极高权重
      } else if (count === 4 && emptyEnds === 1) {
        score = 5000; // 冲四 - 很高权重
      } else if (count === 3 && emptyEnds === 2) {
        score = 2000; // 活三（很强）- 高权重
      } else if (count === 3 && emptyEnds === 1) {
        score = 800; // 冲三
      } else if (count === 2 && emptyEnds === 2) {
        score = 500; // 活二
      } else if (count === 2 && emptyEnds === 1) {
        score = 200; // 冲二
      } else if (count === 1 && emptyEnds >= 1) {
        score = 50; // 单点
      }

      totalScore += score;
    }

    return totalScore;
  }

  // 进攻性位置评分（优先进攻）
  getBestPositionByScoreAggressive(board, currentPlayer, opponent) {
    const emptyCells = this.getEmptyCells(board);

    if (emptyCells.length === 0) return null;

    // 评估每个空位
    const scoredCells = emptyCells.map(cell => {
      let score = 0;

      // 进攻评分：在这个位置落子后自己的连子情况（权重更高）
      board[cell.r][cell.c] = currentPlayer;
      score += this.evaluatePositionV2(board, cell.r, cell.c, currentPlayer) * 1.5;
      board[cell.r][cell.c] = 0;

      // 防守评分：对手在这个位置落子后的威胁（权重较低）
      board[cell.r][cell.c] = opponent;
      score += this.evaluatePositionV2(board, cell.r, cell.c, opponent) * 0.5;
      board[cell.r][cell.c] = 0;

      // 中心位置加分
      const centerR = Math.floor(board.length / 2);
      const centerC = Math.floor(board[0].length / 2);
      const distanceToCenter = Math.abs(cell.r - centerR) + Math.abs(cell.c - centerC);
      score += Math.max(0, 15 - distanceToCenter);

      // 靠近已有棋子加分（进攻性）
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
            if (board[nr][nc] === currentPlayer) {
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 3; // 靠近自己的棋子
            }
          }
        }
      }

      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 从前3个候选位置中选择最佳（减少随机性，增加侵略性）
    const topCandidates = scoredCells.slice(0, Math.min(3, scoredCells.length));
    const selected = topCandidates[0]; // 总是选择最佳位置

    return { r: selected.r, c: selected.c };
  }

  // 困难级位置评分（最强进攻+最强防守，无随机性）
  getBestPositionByScoreHard(board, currentPlayer, opponent) {
    const emptyCells = this.getEmptyCells(board);

    if (emptyCells.length === 0) return null;

    // 评估每个空位 - 更高的权重
    const scoredCells = emptyCells.map(cell => {
      let score = 0;

      // 进攻评分：在这个位置落子后自己的连子情况（权重更高）
      board[cell.r][cell.c] = currentPlayer;
      score += this.evaluatePositionV2(board, cell.r, cell.c, currentPlayer) * 3.0;
      board[cell.r][cell.c] = 0;

      // 防守评分：对手在这个位置落子后的威胁（权重显著提高）
      board[cell.r][cell.c] = opponent;
      score += this.evaluatePositionV2(board, cell.r, cell.c, opponent) * 2.5;
      board[cell.r][cell.c] = 0;

      // 中心位置加分（更高权重）
      const centerR = Math.floor(board.length / 2);
      const centerC = Math.floor(board[0].length / 2);
      const distanceToCenter = Math.abs(cell.r - centerR) + Math.abs(cell.c - centerC);
      score += Math.max(0, 30 - distanceToCenter * 2);

      // 靠近已有棋子加分（更强的进攻性）
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
            if (board[nr][nc] === currentPlayer) {
              const distance = Math.abs(dr) + Math.abs(dc);
              score += (3 - distance) * 8; // 更高的自己棋子权重
            }
          }
        }
      }

      return { r: cell.r, c: cell.c, score };
    });

    // 按分数排序
    scoredCells.sort((a, b) => b.score - a.score);

    // 总是选择最佳位置 - 无任何随机性
    const selected = scoredCells[0];

    return { r: selected.r, c: selected.c };
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

  // ===== 增强的AI辅助函数 =====

  // 预测玩家最可能的下一步落子
  predictPlayerMove(board, opponent) {
    const emptyCells = this.getEmptyCells(board);
    let bestMove = null;
    let maxScore = 0;

    for (const cell of emptyCells) {
      board[cell.r][cell.c] = opponent;
      const threatScore = this.evaluatePositionV2(board, cell.r, cell.c, opponent);
      board[cell.r][cell.c] = 0;

      if (threatScore > maxScore) {
        maxScore = threatScore;
        bestMove = { r: cell.r, c: cell.c, score: threatScore };
      }
    }

    return bestMove;
  }

  // 寻找阻断玩家的最佳位置
  findBlockingMove(board, opponent, predictedMove) {
    const emptyCells = this.getEmptyCells(board);
    const currentPlayer = opponent === 1 ? 2 : 1;
    let bestMove = null;
    let maxScore = 0;

    for (const cell of emptyCells) {
      let score = 0;

      // 优先考虑能阻断预测位置的位置
      const distance = Math.abs(cell.r - predictedMove.r) + Math.abs(cell.c - predictedMove.c);
      if (distance <= 2) {
        score += 500; // 靠近预测位置
      }

      // 评估这个位置的进攻价值
      board[cell.r][cell.c] = currentPlayer;
      score += this.evaluatePositionV2(board, cell.r, cell.c, currentPlayer) * 1.2;
      board[cell.r][cell.c] = 0;

      // 评估这个位置的防守价值（阻断玩家）
      board[cell.r][cell.c] = opponent;
      score += this.evaluatePositionV2(board, cell.r, cell.c, opponent) * 0.8;
      board[cell.r][cell.c] = 0;

      if (score > maxScore) {
        maxScore = score;
        bestMove = { r: cell.r, c: cell.c };
      }
    }

    return bestMove;
  }

  // 增强版候选位置获取（更严格的筛选）
  getCandidateMovesEnhanced(board, currentPlayer) {
    const candidates = [];
    const visited = new Set();
    const opponent = currentPlayer === 1 ? 2 : 1;

    // 遍历所有已有棋子周围的位置
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== 0) {
          // 检查周围2格范围内的空位（缩小搜索范围提高效率）
          for (let dr = -2; dr <= 2; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              const key = `${nr},${nc}`;

              if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length &&
                board[nr][nc] === 0 && !visited.has(key)) {
                visited.add(key);
                // 评估这个位置的优先级（更激进的评分）
                const score = this.evaluateCandidatePositionEnhanced(board, nr, nc, currentPlayer);
                if (score > 0) { // 只保留有价值的位置
                  candidates.push({ r: nr, c: nc, score });
                }
              }
            }
          }
        }
      }
    }

    // 按分数排序，优先搜索高分位置
    candidates.sort((a, b) => b.score - a.score);

    // 减少候选数量到15个（只保留最有威胁的位置）
    return candidates.slice(0, Math.min(15, candidates.length));
  }

  // 增强版候选位置评估（更重视进攻）
  evaluateCandidatePositionEnhanced(board, r, c, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    let score = 0;

    // 进攻评分（极高权重）
    board[r][c] = currentPlayer;
    score += this.evaluatePositionV2(board, r, c, currentPlayer) * 2.5;
    board[r][c] = 0;

    // 防守评分（降低权重，让AI更具进攻性）
    board[r][c] = opponent;
    score += this.evaluatePositionV2(board, r, c, opponent) * 0.8;
    board[r][c] = 0;

    return score;
  }

  // 高级棋盘评估函数（增强进攻版）
  evaluateBoardAdvanced(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    let score = 0;

    // 评估连子情况 - 显著提高进攻权重
    score += this.evaluateLinesAdvanced(board, currentPlayer) * 25; // 进攻权重进一步提高
    score -= this.evaluateLinesAdvanced(board, opponent) * 16;     // 防守权重相对降低

    // 位置优势评估
    score += this.evaluatePositionAdvantage(board, currentPlayer);
    score -= this.evaluatePositionAdvantage(board, opponent) * 1.1;

    return score;
  }

  // 高级连子评估（增强进攻版）
  evaluateLinesAdvanced(board, player) {
    let score = 0;
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== player) continue;

        for (const [dr, dc] of directions) {
          // 检查这个方向上的连子
          let count = 1;
          let emptyEnds = 0;
          let blocked = 0;

          // 正向检查
          for (let i = 1; i < 5; i++) {
            const nr = r + dr * i;
            const nc = c + dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) {
              blocked++;
              break;
            }
            if (board[nr][nc] === player) {
              count++;
            } else if (board[nr][nc] === 0) {
              emptyEnds++;
              break;
            } else {
              blocked++;
              break;
            }
          }

          // 反向检查
          for (let i = 1; i < 5; i++) {
            const nr = r - dr * i;
            const nc = c - dc * i;
            if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) {
              blocked++;
              break;
            }
            if (board[nr][nc] === player) {
              count++;
            } else if (board[nr][nc] === 0) {
              emptyEnds++;
              break;
            } else {
              blocked++;
              break;
            }
          }

          // 评分（进一步提高进攻相关评分）
          if (count >= 5) {
            score += 600000; // 获胜 - 极高权重
          } else if (count === 4 && emptyEnds === 2) {
            score += 60000; // 活四 - 必胜局面，权重提高
          } else if (count === 4 && emptyEnds === 1) {
            score += 6000; // 冲四 - 强威胁，权重提高
          } else if (count === 3 && emptyEnds === 2) {
            score += 2500; // 活三 - 很强的威胁，权重提高
          } else if (count === 3 && emptyEnds === 1) {
            score += 600; // 眠三
          } else if (count === 2 && emptyEnds === 2) {
            score += 250; // 活二
          } else if (count === 2 && emptyEnds === 1) {
            score += 60; // 眠二
          }
        }
      }
    }

    return score;
  }
}

module.exports = AIManager;