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
    // 第一步时，所有难度都只下在用户棋子附近
    if (this.isFirstMove(board)) {
      const nearPositions = this.getPositionsNearUserPiece(board);
      if (nearPositions.length > 0) {
        // 随机选择一个附近的位置
        const randomIndex = Math.floor(Math.random() * nearPositions.length);
        return nearPositions[randomIndex];
      }
    }

    switch (difficulty) {
      case 'easy':
        return this.getGobangEasyMove(board, currentPlayer);
      case 'medium':
        return this.getGobangMediumMove(board, currentPlayer);
      case 'hard':
        return this.getGobangHardMove(board, currentPlayer);
      default:
        return this.getGobangEasyMove(board, currentPlayer);
    }
  }

  // 检查是否是第一步（棋盘上只有一个棋子）
  isFirstMove(board) {
    let count = 0;
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] !== 0) {
          count++;
          if (count > 1) return false;
        }
      }
    }
    return count === 1;
  }

  // 获取用户棋子附近的位置（3x3范围内）
  getPositionsNearUserPiece(board) {
    const positions = [];
    const visited = new Set();

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] !== 0) {
          // 找到用户棋子，获取周围3x3范围
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const nr = r + dr;
              const nc = c + dc;
              const key = `${nr},${nc}`;

              if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length &&
                board[nr][nc] === 0 && !visited.has(key)) {
                visited.add(key);
                positions.push({ r: nr, c: nc });
              }
            }
          }
          return positions; // 只处理第一个找到的棋子
        }
      }
    }

    return positions;
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

    // 统计棋盘上已有棋子数量
    let pieceCount = 0;
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== 0) {
          pieceCount++;
        }
      }
    }

    // 积极进攻：寻找最佳进攻位置（优先于防守活二）
    // 但在开局阶段（棋子太少）时跳过，避免选择边缘位置
    if (pieceCount > 3) {
      const bestAttackMove = this.findBestAttackMove(board, currentPlayer, opponent);
      if (bestAttackMove && bestAttackMove.score >= 50) {
        return { r: bestAttackMove.r, c: bestAttackMove.c };
      }
    }

    // ===== 基础防守 =====
    // 防守活二
    const defensiveLiveTwoMove = this.findBestDefensiveMoveV2(board, opponent, currentPlayer);
    if (defensiveLiveTwoMove) {
      return defensiveLiveTwoMove;
    }

    // 使用最优位置选择（添加随机性，避免固定落子）
    return this.getBestPositionByScoreMedium(board, currentPlayer, opponent);
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

    // 搜索深度 4-6 层（优化性能，减少计算时间）
    // 根据棋盘复杂度动态调整深度
    let depth = 4;  // 降低基础深度
    const emptyCount = this.getEmptyCells(board).length;
    if (emptyCount < 20) depth = 6;   // 残局时深度更深
    else if (emptyCount < 100) depth = 5;  // 中局
    else depth = 4;  // 开局时最浅，保证响应速度

    const result = this.minimaxOptimized(board, depth, currentPlayer, -Infinity, Infinity, true, candidateMoves);

    // 返回最佳移动位置
    if (result && result.move) {
      return result.move;
    }

    // 如果 Minimax 没有找到好棋，回退到中等难度
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
        // 验证位置是否为空
        if (board[cell.r][cell.c] !== 0) {
          continue;
        }

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
        // 验证位置是否为空
        if (board[cell.r][cell.c] !== 0) {
          continue;
        }

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

    // 统计棋盘上已有棋子数量
    let pieceCount = 0;
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== 0) {
          pieceCount++;
        }
      }
    }

    // 如果棋子数量很少（开局阶段），不进行防守，让位置选择函数决定
    if (pieceCount <= 2) {
      return null;
    }

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

  // ========== 象棋 AI 辅助 ==========

  // 判断棋子颜色
  chessColor(p) { if (!p || p === 0) return null; return p.startsWith('r-') ? 'r' : p.startsWith('b-') ? 'b' : null; }
  // 判断棋子类型
  chessType(p) { if (!p || p === 0) return null; const i = p.indexOf('-'); return i >= 0 ? p.substring(i + 1) : null; }
  // 某方所有棋子
  chessPieces(board, color) { const a = []; for (let r = 0; r < 10; r++) for (let c = 0; c < 9; c++) if (this.chessColor(board[r][c]) === color) a.push({ r, c }); return a; }
  // 对友判断
  chessFriend(board, r, c, col) { const p = board[r][c]; return p !== 0 && this.chessColor(p) === col; }
  // 在棋盘内
  chessIn(r, c) { return r >= 0 && r < 10 && c >= 0 && c < 9; }

  // 棋子原始走法（不含将军后合法性）
  chessRaw(board, r, c) {
    const p = board[r][c]; if (!p || p === 0) return [];
    const col = this.chessColor(p), tp = this.chessType(p), m = [], isR = col === 'r', fw = isR ? -1 : 1;
    const ib = this.chessIn.bind(this), fr = (rr, cc) => this.chessFriend(board, rr, cc, col);
    switch (tp) {
      case 'ju': for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { let nr = r + dr, nc = c + dc; while (ib(nr, nc)) { if (fr(nr, nc)) break; m.push({ r: nr, c: nc }); if (board[nr][nc] !== 0) break; nr += dr; nc += dc; } } break;
      case 'ma': for (const [dr, dc, lr, lc] of [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [-1, 2, 0, 1], [1, -2, 0, -1], [1, 2, 0, 1]]) { const nr = r + dr, nc = c + dc; if (ib(nr, nc) && !fr(nr, nc) && board[r + lr][c + lc] === 0) m.push({ r: nr, c: nc }); } break;
      case 'xiang': for (const [dr, dc, er, ec] of [[-2, -2, -1, -1], [-2, 2, -1, 1], [2, -2, 1, -1], [2, 2, 1, 1]]) { const nr = r + dr, nc = c + dc; if (ib(nr, nc) && !fr(nr, nc) && board[r + er][c + ec] === 0) { if (isR ? (nr >= 5 && nr <= 9) : (nr >= 0 && nr <= 4)) m.push({ r: nr, c: nc }); } } break;
      case 'shi': for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) { const nr = r + dr, nc = c + dc; if (nr >= (isR ? 7 : 0) && nr <= (isR ? 9 : 2) && nc >= 3 && nc <= 5 && !fr(nr, nc)) m.push({ r: nr, c: nc }); } break;
      case 'shuai': case 'jiang': for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { const nr = r + dr, nc = c + dc; if (nr >= (isR ? 7 : 0) && nr <= (isR ? 9 : 2) && nc >= 3 && nc <= 5 && !fr(nr, nc)) m.push({ r: nr, c: nc }); } const ok = isR ? 'b-jiang' : 'r-shuai'; let fg = false, bl = false; for (let rr = r + (isR ? -1 : 1); isR ? rr >= 0 : rr < 10; rr += isR ? -1 : 1) { if (board[rr][c] === ok) { fg = true; break } else if (board[rr][c] !== 0) { bl = true; break } } if (fg && !bl) { for (let rr = r + (isR ? -1 : 1); isR ? rr >= 0 : rr < 10; rr += isR ? -1 : 1) { if (board[rr][c] === ok) { m.push({ r: rr, c: c }); break; } } } break;
      case 'pao': for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { let nr = r + dr, nc = c + dc; while (ib(nr, nc) && board[nr][nc] === 0) { m.push({ r: nr, c: nc }); nr += dr; nc += dc; } if (ib(nr, nc) && board[nr][nc] !== 0) { nr += dr; nc += dc; while (ib(nr, nc)) { if (board[nr][nc] !== 0) { if (this.chessColor(board[nr][nc]) !== col) m.push({ r: nr, c: nc }); break; } nr += dr; nc += dc; } } } break;
      case 'bing': case 'zu': const fd = r + fw; if (ib(fd, c) && !fr(fd, c)) m.push({ r: fd, c: c }); if (isR ? r <= 4 : r >= 5) { for (const dc of [-1, 1]) { const nc = c + dc; if (ib(r, nc) && !fr(r, nc)) m.push({ r, c: nc }); } } break;
    }
    return m;
  }

  // 是否被将军
  chessCheck(board, color) {
    const kt = color === 'r' ? 'r-shuai' : 'b-jiang', oc = color === 'r' ? 'b' : 'r'; let kr = -1, kc = -1;
    for (let r = 0; r < 10; r++)for (let c = 0; c < 9; c++)if (board[r][c] === kt) { kr = r; kc = c; break; }
    if (kr < 0) return true;
    for (let r = 0; r < 10; r++)for (let c = 0; c < 9; c++)if (board[r][c] !== 0 && this.chessColor(board[r][c]) === oc) if (this.chessRaw(board, r, c).some(m => m.r === kr && m.c === kc)) return true;
    return false;
  }

  // 合法走法（走后不将军）
  chessLegal(board, r, c) {
    const col = this.chessColor(board[r][c]);
    return this.chessRaw(board, r, c).filter(m => { const sv = board[m.r][m.c]; board[m.r][m.c] = board[r][c]; board[r][c] = 0; const ch = this.chessCheck(board, col); board[r][c] = board[m.r][m.c]; board[m.r][m.c] = sv; return !ch; });
  }

  // 象棋 AI 移动（player: 1=红'r' 2=黑'b'）
  getChessAIMove(board, difficulty, currentPlayer) {
    const aiCol = currentPlayer === 1 ? 'r' : 'b';
    switch (difficulty) {
      case 'easy': return this.chessAIEasy(board, aiCol);
      case 'medium': return this.chessAIMedium(board, aiCol);
      case 'hard': return this.chessAIHard(board, aiCol);
      default: return this.chessAIEasy(board, aiCol);
    }
  }

  // === 象棋AI增强 ===

  // 棋子基础价值
  chessPieceValue(tp) {
    const v = {
      'shuai': 10000, 'jiang': 10000,
      'ju': 900, 'pao': 450, 'ma': 400,
      'xiang': 200, 'shi': 200,
      'bing': 100, 'zu': 100
    };
    return v[tp] || 100;
  }

  // 模拟走棋并返回新棋盘
  chessSimMove(board, fromR, fromC, toR, toC) {
    const nb = board.map(r => [...r]);
    nb[toR][toC] = nb[fromR][fromC];
    nb[fromR][fromC] = 0;
    return nb;
  }

  // 对方所有合法走法
  chessAllLegal(board, color) {
    const res = [];
    for (const p of this.chessPieces(board, color)) {
      for (const m of this.chessLegal(board, p.r, p.c)) {
        res.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c });
      }
    }
    return res;
  }

  // 评估某一方所有棋子总价值
  chessTotalValue(board, color) {
    let sum = 0;
    for (const p of this.chessPieces(board, color)) {
      sum += this.chessPieceValue(this.chessType(board[p.r][p.c]));
    }
    return sum;
  }

  // 检查某个位置是否被对方攻击
  chessIsAttacked(board, r, c, byColor) {
    for (const p of this.chessPieces(board, byColor)) {
      for (const m of this.chessRaw(board, p.r, p.c)) {
        if (m.r === r && m.c === c) return true;
      }
    }
    return false;
  }

  // 对一步棋全面评分
  chessScoreMove(board, fromR, fromC, toR, toC, aiCol, opCol) {
    let s = 0;
    const tp = this.chessType(board[fromR][fromC]);
    const captured = board[toR][toC];
    const isR = aiCol === 'r';

    // 1. 吃子价值
    if (captured !== 0) {
      const capturedType = this.chessType(captured);
      s += this.chessPieceValue(capturedType) * 10;

      // 吃高价值棋子额外加分
      if (this.chessPieceValue(capturedType) >= 400) s += 300;
      if (this.chessPieceValue(capturedType) >= 900) s += 500;
    }

    // 2. 己方棋子被吃风险评估（走之后这个棋子是否会被对方吃掉）
    const simBoard = this.chessSimMove(board, fromR, fromC, toR, toC);
    if (this.chessIsAttacked(simBoard, toR, toC, opCol)) {
      // 如果移动到被攻击的位置且会被吃
      const movingPieceVal = this.chessPieceValue(tp);
      // 看对方是否有能吃这个位置的棋子
      for (const op of this.chessPieces(simBoard, opCol)) {
        for (const om of this.chessLegal(simBoard, op.r, op.c)) {
          if (om.r === toR && om.c === toC) {
            const attackerVal = this.chessPieceValue(this.chessType(simBoard[op.r][op.c]));
            if (attackerVal < movingPieceVal) {
              // 低价值换高价值，可以接受
              s -= (movingPieceVal - attackerVal) * 3;
            } else if (attackerVal > movingPieceVal) {
              // 高价值送吃，严重扣分
              s -= movingPieceVal * 10;
            } else {
              s -= movingPieceVal * 5;
            }
            break;
          }
        }
      }
    }

    // 3. 将军/将杀加分
    if (this.chessCheck(simBoard, opCol)) {
      s += 800;
      // 检查是否将杀
      const opAllLegal = this.chessAllLegal(simBoard, opCol);
      if (opAllLegal.length === 0) {
        s += 10000; // 将杀！最高优先级
      }
    }

    // 4. 己方被将军时解围
    if (this.chessCheck(board, aiCol)) {
      // 当前被将军，能解围的走法加高分
      if (!this.chessCheck(simBoard, aiCol)) {
        s += 1000;
      }
    }

    // 5. 向前推进（红方r减小，黑方r增大）
    if ((isR && toR < fromR) || (!isR && toR > fromR)) {
      s += 10;
      // 兵/卒过河后向前价值更高
      if (tp === 'bing' || tp === 'zu') s += 20;
    }

    // 6. 棋子位置价值
    // 中心控制
    s += 12 - Math.abs(toR - 4.5) - Math.abs(toC - 4);
    // 河界附近（战略要地）
    if (toR >= 4 && toR <= 5) s += 5;

    // 7. 兵/卒过河加分
    if ((tp === 'bing' && isR && toR <= 4) || (tp === 'zu' && !isR && toR >= 5)) {
      s += 50;
    }

    // 8. 活跃棋子加分（离开初始位置）
    if (!this.chessPieceDefaultPos(fromR, fromC, tp, isR)) {
      const startPos = this.chessPieceDefaultPos(fromR, fromC, tp, isR);
      if (startPos) s += 15;
    }

    // 9. 保护己方高价值棋子（如果走到可以保护被攻击的高价值棋子的位置）
    for (const p of this.chessPieces(simBoard, aiCol)) {
      const pt = this.chessType(simBoard[p.r][p.c]);
      if (this.chessPieceValue(pt) >= 400 && this.chessIsAttacked(simBoard, p.r, p.c, opCol)) {
        // 是否因为这次走棋而形成了保护
        if (this.chessFriend(simBoard, toR, toC, aiCol)) {
          // 走到这个位置保护了被攻击的棋子
          s += 60;
        }
      }
    }

    return s;
  }

  // 判断棋子是否在默认起始位置（粗略）
  chessPieceDefaultPos(r, c, tp, isRed) {
    if (isRed) {
      switch (tp) {
        case 'ju': return (r === 9 && (c === 0 || c === 8));
        case 'ma': return (r === 9 && (c === 1 || c === 7));
        case 'xiang': return (r === 9 && (c === 2 || c === 6));
        case 'shi': return (r === 9 && (c === 3 || c === 5));
        case 'shuai': return (r === 9 && c === 4);
        case 'pao': return (r === 7 && (c === 1 || c === 7));
        case 'bing': return (r === 6 && (c % 2 === 0));
      }
    } else {
      switch (tp) {
        case 'ju': return (r === 0 && (c === 0 || c === 8));
        case 'ma': return (r === 0 && (c === 1 || c === 7));
        case 'xiang': return (r === 0 && (c === 2 || c === 6));
        case 'shi': return (r === 0 && (c === 3 || c === 5));
        case 'jiang': return (r === 0 && c === 4);
        case 'pao': return (r === 2 && (c === 1 || c === 7));
        case 'zu': return (r === 3 && (c % 2 === 0));
      }
    }
    return false;
  }

  // 象棋简单AI (增强版)
  chessAIEasy(board, aiCol) {
    const pieces = this.chessPieces(board, aiCol);
    if (pieces.length === 0) return null;
    const opCol = aiCol === 'r' ? 'b' : 'r';
    const scored = [];
    for (const p of pieces) {
      for (const m of this.chessLegal(board, p.r, p.c)) {
        let s = this.chessScoreMove(board, p.r, p.c, m.r, m.c, aiCol, opCol);
        // 简单AI降低一些权重，增加随机性
        s = Math.round(s / 10);
        scored.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c, score: s });
      }
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[Math.floor(Math.random() * Math.min(10, scored.length))];
    return { fromR: pick.fromR, fromC: pick.fromC, toR: pick.toR, toC: pick.toC };
  }

  // 象棋中等AI (增强版)
  chessAIMedium(board, aiCol) {
    const pieces = this.chessPieces(board, aiCol);
    if (pieces.length === 0) return null;
    const opCol = aiCol === 'r' ? 'b' : 'r';
    // 检查是否有直接吃子（不吃会被吃的高价值棋子的防守）
    const defensiveMoves = [];
    const captureMoves = [];
    const scored = [];
    for (const p of pieces) {
      for (const m of this.chessLegal(board, p.r, p.c)) {
        const s = this.chessScoreMove(board, p.r, p.c, m.r, m.c, aiCol, opCol);
        const captured = board[m.r][m.c];
        if (captured !== 0 && this.chessColor(captured) === opCol) {
          captureMoves.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c, score: s });
        }
        // 防守：当前棋子正被攻击
        if (this.chessIsAttacked(board, p.r, p.c, opCol)) {
          defensiveMoves.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c, score: s });
        }
        scored.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c, score: s });
      }
    }

    // 优先级：将军 > 吃高价值子 > 解被将军 > 防守 > 吃子 > 其他
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);

    // 前3候选随机（半确定性）
    const pick = scored[Math.floor(Math.random() * Math.min(5, scored.length))];
    return { fromR: pick.fromR, fromC: pick.fromC, toR: pick.toR, toC: pick.toC };
  }

  // 象棋困难AI (增强版 - 带2层搜索)
  chessAIHard(board, aiCol) {
    const pieces = this.chessPieces(board, aiCol);
    if (pieces.length === 0) return null;
    const opCol = aiCol === 'r' ? 'b' : 'r';
    const scored = [];
    for (const p of pieces) {
      for (const m of this.chessLegal(board, p.r, p.c)) {
        let s = this.chessScoreMove(board, p.r, p.c, m.r, m.c, aiCol, opCol);

        // 2层搜索：走完后评估对手最佳应手的影响
        const simBoard = this.chessSimMove(board, p.r, p.c, m.r, m.c);
        // 查找对手的最佳走法
        let opponentBestResponse = 0;
        for (const op of this.chessPieces(simBoard, opCol)) {
          for (const om of this.chessLegal(simBoard, op.r, op.c)) {
            const opScore = this.chessScoreMove(simBoard, op.r, op.c, om.r, om.c, opCol, aiCol);
            if (opScore > opponentBestResponse) {
              opponentBestResponse = opScore;
            }
          }
        }
        // 扣减对手最佳反击的伤害（对方吃/将军的威胁）
        s -= opponentBestResponse * 0.3;

        scored.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c, score: s });
      }
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    const pick = scored[0];
    return { fromR: pick.fromR, fromC: pick.fromC, toR: pick.toR, toC: pick.toC };
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

    // 减少候选数量到 10 个（优化性能，只保留最有威胁的位置）
    return candidates.slice(0, Math.min(10, candidates.length));
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