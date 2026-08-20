// AIManager.js - AI 管理模块
const config = require('../config');
const logger = require('../utils/logger');
const { Worker } = require('worker_threads');
const path = require('path');

// 象棋棋子中文名（用于提示讲解）
const CHESS_NAMES = {
  shuai: '帅', jiang: '将', ju: '车', pao: '炮', ma: '马',
  xiang: '相', shi: '士', bing: '兵', zu: '卒',
};

class AIManager {
  constructor() {
    this.difficultyLevels = ['easy', 'medium', 'hard'];
    // AI 计算 worker（懒加载，避免阻塞主线程事件循环）
    this._worker = null;
    this._workerReady = false;
    this._pendingCalls = new Map(); // id -> { resolve, reject }
    this._callId = 0;
    this._workerDisabled = false; // worker 创建失败时降级为同步
  }

  // 初始化 worker（懒加载）
  _initWorker() {
    if (this._worker || this._workerDisabled) return;
    try {
      this._worker = new Worker(path.join(__dirname, 'AIWorker.js'));
      this._worker.on('message', (msg) => {
        if (msg.type === 'ready') {
          this._workerReady = true;
          logger.info('AI 计算 worker 已就绪');
          return;
        }
        const pending = this._pendingCalls.get(msg.id);
        if (pending) {
          this._pendingCalls.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
      });
      this._worker.on('error', (err) => {
        logger.error('AI worker 错误，降级为同步模式', { error: err.message });
        // worker 异常时降级，所有 pending 调用转为同步执行
        for (const [id, pending] of this._pendingCalls) {
          pending.reject(new Error('worker 不可用'));
        }
        this._pendingCalls.clear();
        this._workerDisabled = true;
        try { this._worker.terminate(); } catch (e) { }
        this._worker = null;
      });
    } catch (err) {
      logger.warn('创建 AI worker 失败，降级为同步模式', { error: err.message });
      this._workerDisabled = true;
    }
  }

  // 通过 worker 异步调用 AI 方法（worker 不可用时降级为同步）
  _callAsync(method, args) {
    // 降级路径：直接同步调用
    if (this._workerDisabled) {
      try {
        return Promise.resolve(this[method](...args));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    this._initWorker();
    if (this._workerDisabled) {
      try {
        return Promise.resolve(this[method](...args));
      } catch (err) {
        return Promise.reject(err);
      }
    }
    const id = ++this._callId;
    return new Promise((resolve, reject) => {
      this._pendingCalls.set(id, { resolve, reject });
      this._worker.postMessage({ id, method, args });
    });
  }

  // 异步版 getAIMove（不阻塞事件循环）
  getAIMoveAsync(gameType, board, difficulty, currentPlayer) {
    return this._callAsync('getAIMove', [gameType, board, difficulty, currentPlayer]);
  }

  // 异步版 getSmartHint（不阻塞事件循环）
  getSmartHintAsync(gameType, board, currentPlayer) {
    return this._callAsync('getSmartHint', [gameType, board, currentPlayer]);
  }

  // 获取 AI 移动
  getAIMove(gameType, board, difficulty, currentPlayer) {
    try {
      switch (gameType) {
        case 'gobang':
          return this.getGobangAIMove(board, difficulty, currentPlayer);
        case 'chinese-chess':
          return this.getChessAIMove(board, difficulty, currentPlayer);
        case 'go':
          return this.getGoAIMove(board, difficulty, currentPlayer);
        default:
          return null;
      }
    } catch (error) {
      logger.error('getAIMove 出错', { error: error.message, stack: error.stack });
      return null;
    }
  }

  // 五子棋 AI 移动
  getGobangAIMove(board, difficulty, currentPlayer) {
    try {
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
    } catch (error) {
      logger.error('getGobangAIMove 出错', { error: error.message, stack: error.stack });
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
    try {
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
    } catch (error) {
      logger.error('getGobangHardMove 出错', { error: error.message, stack: error.stack });
      return this.getGobangMediumMove(board, currentPlayer);
    }
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
    score += this.evaluatePosition(board, r, c, currentPlayer) * 1.5;
    board[r][c] = 0;

    // 防守评分
    board[r][c] = opponent;
    score += this.evaluatePosition(board, r, c, opponent);
    board[r][c] = 0;

    return score;
  }

  // 优化的 Minimax 算法
  minimaxOptimized(board, depth, currentPlayer, alpha, beta, maximizingPlayer, candidateMoves) {
    try {
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
    } catch (error) {
      logger.error('minimaxOptimized 出错', { error: error.message, stack: error.stack });
      return { score: 0, move: null };
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

  // 分析以 (r,c) 为落点、方向 (dr,dc) 上的连子情况（含刚落子的那枚）
  // 返回 { count: 连续己方子数, ends: 两端空端数(0/1/2) }
  analyzeLine(board, r, c, dr, dc, player) {
    let count = 1;
    let ends = 0;
    // 正向
    let i = 1;
    for (; ; i++) {
      const nr = r + dr * i;
      const nc = c + dc * i;
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
      if (board[nr][nc] === player) { count++; continue; }
      if (board[nr][nc] === 0) ends++;
      break;
    }
    // 反向
    for (i = 1; ; i++) {
      const nr = r - dr * i;
      const nc = c - dc * i;
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) break;
      if (board[nr][nc] === player) { count++; continue; }
      if (board[nr][nc] === 0) ends++;
      break;
    }
    return { count, ends };
  }

  // 寻找活三移动（落子后在某方向形成 _AAA_：3连+两端空）
  findLiveThreeMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      let hit = false;
      for (const [dr, dc] of dirs) {
        const { count, ends } = this.analyzeLine(board, cell.r, cell.c, dr, dc, player);
        if (count === 3 && ends === 2) { hit = true; break; }
      }
      board[cell.r][cell.c] = 0;
      if (hit) return cell;
    }
    return null;
  }

  // 寻找活四移动（落子后在某方向形成 _AAAA_：4连+两端空）
  findLiveFourMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      let hit = false;
      for (const [dr, dc] of dirs) {
        const { count, ends } = this.analyzeLine(board, cell.r, cell.c, dr, dc, player);
        if (count === 4 && ends === 2) { hit = true; break; }
      }
      board[cell.r][cell.c] = 0;
      if (hit) return cell;
    }
    return null;
  }

  // 寻找冲四移动（落子后在某方向形成 AAAA_ 或 _AAAA：4连+一端空）
  findRushFourMove(board, player) {
    const emptyCells = this.getEmptyCells(board);
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (const cell of emptyCells) {
      board[cell.r][cell.c] = player;
      let hit = false;
      for (const [dr, dc] of dirs) {
        const { count, ends } = this.analyzeLine(board, cell.r, cell.c, dr, dc, player);
        if (count === 4 && ends === 1) { hit = true; break; }
      }
      board[cell.r][cell.c] = 0;
      if (hit) return cell;
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

  // 对手在 (r,c) 可成四连时，返回四连的「开口端」位置
  // - 活四（两端空）→ 返回 null（应堵中间，即原防守点）
  // - 冲四（一端空一端封）→ 返回开口端（堵这里才真正阻止对手成五）
  // - 两端封死 → 返回 null（死四，无需防守）
  findFourOpenEnd(board, player, move) {
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    board[move.r][move.c] = player;

    for (const [dr, dc] of dirs) {
      const { count } = this.analyzeLine(board, move.r, move.c, dr, dc, player);
      if (count !== 4) continue;

      // 找到四连段的两端外侧位置
      let r1 = move.r;
      let c1 = move.c;
      while (r1 - dr >= 0 && r1 - dr < board.length && c1 - dc >= 0 && c1 - dc < board[0].length && board[r1 - dr][c1 - dc] === player) {
        r1 -= dr;
        c1 -= dc;
      }
      const frontR = r1 - dr;
      const frontC = c1 - dc;
      const frontEmpty = frontR >= 0 && frontR < board.length && frontC >= 0 && frontC < board[0].length && board[frontR][frontC] === 0;

      let r2 = move.r;
      let c2 = move.c;
      while (r2 + dr >= 0 && r2 + dr < board.length && c2 + dc >= 0 && c2 + dc < board[0].length && board[r2 + dr][c2 + dc] === player) {
        r2 += dr;
        c2 += dc;
      }
      const backR = r2 + dr;
      const backC = c2 + dc;
      const backEmpty = backR >= 0 && backR < board.length && backC >= 0 && backC < board[0].length && board[backR][backC] === 0;

      board[move.r][move.c] = 0;

      if (frontEmpty && backEmpty) return null; // 活四：堵中间（保持原防守点）
      if (frontEmpty) return { r: frontR, c: frontC }; // 冲四：堵开口端
      if (backEmpty) return { r: backR, c: backC };
      return null; // 死四：无需防守
    }

    board[move.r][move.c] = 0;
    return null;
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

  // 计算活三数量（正确检测：3连 + 两端空，基于连续段不重复计数）
  countLiveThree(board, player) {
    let count = 0;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const seen = new Set();

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== player) continue;

        for (const [dr, dc] of dirs) {
          const key = `${r},${c},${dr},${dc}`;
          if (seen.has(key)) continue;
          // 若前一格也是己方子，说明本段已从更早起点统计过
          const pr = r - dr;
          const pc = c - dc;
          if (pr >= 0 && pr < board.length && pc >= 0 && pc < board[0].length && board[pr][pc] === player) continue;

          // 从段起点沿方向统计连续子数
          let cr = r;
          let cc = c;
          let cnt = 0;
          while (cr >= 0 && cr < board.length && cc >= 0 && cc < board[0].length && board[cr][cc] === player) {
            cnt++;
            seen.add(`${cr},${cc},${dr},${dc}`);
            cr += dr;
            cc += dc;
            if (cnt > 5) break;
          }

          const endEmpty = (cr < 0 || cr >= board.length || cc < 0 || cc >= board[0].length) ? false : board[cr][cc] === 0;
          const begEmpty = (r - dr < 0 || r - dr >= board.length || c - dc < 0 || c - dc >= board[0].length) ? false : board[r - dr][c - dc] === 0;

          if (cnt === 3 && endEmpty && begEmpty) count++;
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

  // 计算活二数量（正确检测：2连 + 两端空，基于连续段不重复计数）
  countLiveTwo(board, player) {
    let count = 0;
    const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    const seen = new Set();

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] !== player) continue;

        for (const [dr, dc] of dirs) {
          const key = `${r},${c},${dr},${dc}`;
          if (seen.has(key)) continue;
          // 若前一格也是己方子，说明本段已从更早起点统计过
          const pr = r - dr;
          const pc = c - dc;
          if (pr >= 0 && pr < board.length && pc >= 0 && pc < board[0].length && board[pr][pc] === player) continue;

          let cr = r;
          let cc = c;
          let cnt = 0;
          while (cr >= 0 && cr < board.length && cc >= 0 && cc < board[0].length && board[cr][cc] === player) {
            cnt++;
            seen.add(`${cr},${cc},${dr},${dc}`);
            cr += dr;
            cc += dc;
            if (cnt > 5) break;
          }

          const endEmpty = (cr < 0 || cr >= board.length || cc < 0 || cc >= board[0].length) ? false : board[cr][cc] === 0;
          const begEmpty = (r - dr < 0 || r - dr >= board.length || c - dc < 0 || c - dc >= board[0].length) ? false : board[r - dr][c - dc] === 0;

          if (cnt === 2 && endEmpty && begEmpty) count++;
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

  // 中等难度位置评分 - 增加进攻权重
  getBestPositionByScoreMedium(board, currentPlayer, opponent) {
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) return null;

    const scoredCells = emptyCells.map(cell => {
      let score = 0;

      // 进攻评分
      board[cell.r][cell.c] = currentPlayer;
      score += this.evaluatePosition(board, cell.r, cell.c, currentPlayer) * 1.5;
      board[cell.r][cell.c] = 0;

      // 防守评分
      board[cell.r][cell.c] = opponent;
      score += this.evaluatePosition(board, cell.r, cell.c, opponent) * 1.0;
      board[cell.r][cell.c] = 0;

      // 中心位置加分
      const centerR = Math.floor(board.length / 2);
      const centerC = Math.floor(board[0].length / 2);
      const distanceToCenter = Math.abs(cell.r - centerR) + Math.abs(cell.c - centerC);
      score += Math.max(0, 10 - distanceToCenter);

      return { r: cell.r, c: cell.c, score };
    });

    scoredCells.sort((a, b) => b.score - a.score);
    const topCandidates = scoredCells.slice(0, Math.min(3, scoredCells.length));
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    return { r: selected.r, c: selected.c };
  }

  // 困难难度位置评分 - 全面评估
  getBestPositionByScoreHard(board, currentPlayer, opponent) {
    const emptyCells = this.getEmptyCells(board);
    if (emptyCells.length === 0) return null;

    const scoredCells = emptyCells.map(cell => {
      let score = 0;

      // 进攻评分（更高权重）
      board[cell.r][cell.c] = currentPlayer;
      const attackScore = this.evaluatePosition(board, cell.r, cell.c, currentPlayer);
      // 连五直接给最高分
      board[cell.r][cell.c] = 0;

      // 防守评分
      board[cell.r][cell.c] = opponent;
      const defenseScore = this.evaluatePosition(board, cell.r, cell.c, opponent);
      board[cell.r][cell.c] = 0;

      score += attackScore * 1.8;
      score += defenseScore * 1.2;

      // 中心权重
      const centerR = Math.floor(board.length / 2);
      const centerC = Math.floor(board[0].length / 2);
      const distanceToCenter = Math.abs(cell.r - centerR) + Math.abs(cell.c - centerC);
      score += Math.max(0, 12 - distanceToCenter);

      // 周围棋子密度加分
      let neighborCount = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = cell.r + dr;
          const nc = cell.c + dc;
          if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length && board[nr][nc] !== 0) {
            neighborCount++;
          }
        }
      }
      score += neighborCount * 3;

      return { r: cell.r, c: cell.c, score };
    });

    scoredCells.sort((a, b) => b.score - a.score);
    const topCandidates = scoredCells.slice(0, Math.min(2, scoredCells.length));
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
      'shuai': 100000, 'jiang': 100000,
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

  // 检查一步棋后目标位置是否会被对方合法吃掉
  chessMoveWillBeCaptured(board, fromR, fromC, toR, toC, opCol) {
    const simBoard = this.chessSimMove(board, fromR, fromC, toR, toC);
    for (const op of this.chessPieces(simBoard, opCol)) {
      for (const om of this.chessLegal(simBoard, op.r, op.c)) {
        if (om.r === toR && om.c === toC) return true;
      }
    }
    return false;
  }

  // 棋子位置加分
  chessPosBonus(tp, r, c, isRed) {
    let score = 0;
    const rr = isRed ? (9 - r) : r;
    switch (tp) {
      case 'ju':
        if (c === 4) score += 8;
        if (rr >= 3 && rr <= 6) score += 5;
        break;
      case 'ma':
        if (rr >= 2 && rr <= 7 && (c === 3 || c === 4 || c === 5)) score += 10;
        break;
      case 'pao':
        if (c === 4) score += 6;
        if (rr >= 4 && rr <= 6) score += 4;
        break;
      case 'bing':
      case 'zu':
        if (rr <= 4) {
          score += 20 + (4 - rr) * 6;
          if (c === 3 || c === 4 || c === 5) score += 5;
        }
        break;
      default:
        break;
    }
    return score;
  }

  // 直接在棋盘上走子，返回被吃的子
  chessDoMove(board, fromR, fromC, toR, toC) {
    const captured = board[toR][toC];
    board[toR][toC] = board[fromR][fromC];
    board[fromR][fromC] = 0;
    return captured;
  }

  // 撤销一步棋
  chessUndoMove(board, fromR, fromC, toR, toC, captured) {
    board[fromR][fromC] = board[toR][toC];
    board[toR][toC] = captured;
  }

  // 对一步棋的启发式评分（新版）
  chessScoreMove(board, fromR, fromC, toR, toC, aiCol, opCol) {
    let s = 0;
    const tp = this.chessType(board[fromR][fromC]);
    const captured = board[toR][toC];
    const isR = aiCol === 'r';
    const movingPieceVal = this.chessPieceValue(tp);

    // 1. 吃子价值（被吃子价值越高分越高）
    let capturedVal = 0;
    if (captured !== 0) {
      capturedVal = this.chessPieceValue(this.chessType(captured));
      s += capturedVal * 10;
      if (movingPieceVal < capturedVal) s += (capturedVal - movingPieceVal) * 5;
    }

    // 2. 走子后是否会被对方吃掉（避免送子）
    if (this.chessMoveWillBeCaptured(board, fromR, fromC, toR, toC, opCol)) {
      if (captured !== 0) {
        const net = capturedVal - movingPieceVal;
        if (net < 0) s += net * 8;
        else s += net * 3;
      } else {
        s -= movingPieceVal * 8;
      }
    }

    // 3. 将军 / 将杀
    const simBoard = this.chessSimMove(board, fromR, fromC, toR, toC);
    if (this.chessCheck(simBoard, opCol)) {
      s += 1500;
      const opMoves = this.chessAllLegal(simBoard, opCol);
      if (opMoves.length === 0) s += 100000;
    }

    // 4. 己方被将军时的防守加分
    if (this.chessCheck(board, aiCol)) {
      if (!this.chessCheck(simBoard, aiCol)) s += 1200;
    }

    // 5. 向前推进
    if ((isR && toR < fromR) || (!isR && toR > fromR)) {
      s += 8;
      if (tp === 'bing' || tp === 'zu') s += 15;
    }

    // 6. 位置加分
    s += this.chessPosBonus(tp, toR, toC, isR);

    // 7. 兵 / 卒过河
    if ((tp === 'bing' && isR && toR <= 4) || (tp === 'zu' && !isR && toR >= 5)) {
      s += 30;
    }

    // 8. 让棋子离开初始位置
    if (this.chessPieceDefaultPos(fromR, fromC, tp, isR)) {
      s += 12;
    }

    // 9. 己方高价值棋子被攻击时逃开
    if (this.chessIsAttacked(board, fromR, fromC, opCol)) {
      s += 50;
    }

    return s;
  }

  // 整体棋盘评估（用于 Minimax）
  chessEvaluateBoard(board, aiCol) {
    const opCol = aiCol === 'r' ? 'b' : 'r';
    let score = 0;
    const aiPieces = this.chessPieces(board, aiCol);
    const opPieces = this.chessPieces(board, opCol);

    let aiVal = 0, opVal = 0;
    const isR = aiCol === 'r';
    for (let i = 0; i < aiPieces.length; i++) {
      const p = aiPieces[i];
      const tp = this.chessType(board[p.r][p.c]);
      aiVal += this.chessPieceValue(tp);
      score += this.chessPosBonus(tp, p.r, p.c, isR);
    }
    for (let i = 0; i < opPieces.length; i++) {
      const p = opPieces[i];
      const tp = this.chessType(board[p.r][p.c]);
      opVal += this.chessPieceValue(tp);
      score -= this.chessPosBonus(tp, p.r, p.c, !isR);
    }
    score += (aiVal - opVal) * 10;

    if (this.chessCheck(board, opCol)) score += 200;
    if (this.chessCheck(board, aiCol)) score -= 200;

    return score;
  }

  // 获取排序后的合法走法（支持限制返回数量以加速搜索）
  chessOrderedMoves(board, color, limit) {
    const opCol = color === 'r' ? 'b' : 'r';
    const pieces = this.chessPieces(board, color);
    const all = [];
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i];
      const legal = this.chessLegal(board, p.r, p.c);
      for (let j = 0; j < legal.length; j++) {
        const m = legal[j];
        const s = this.chessScoreMove(board, p.r, p.c, m.r, m.c, color, opCol);
        all.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c, score: s });
      }
    }
    all.sort((a, b) => b.score - a.score);
    if (limit && limit > 0 && all.length > limit) return all.slice(0, limit);
    return all;
  }

  // Minimax + Alpha-Beta 剪枝搜索（修复了 alpha/beta 传递 bug）
  chessMinimax(board, depth, alpha, beta, maximizing, aiCol, moveLimit) {
    if (depth === 0) {
      return { score: this.chessEvaluateBoard(board, aiCol) };
    }

    const currentCol = maximizing ? aiCol : (aiCol === 'r' ? 'b' : 'r');
    const moves = this.chessOrderedMoves(board, currentCol, moveLimit);

    if (moves.length === 0) {
      if (this.chessCheck(board, currentCol)) {
        return { score: maximizing ? -100000 : 100000 };
      }
      return { score: this.chessEvaluateBoard(board, aiCol) };
    }

    let bestMove = null;
    if (maximizing) {
      let bestScore = -Infinity;
      for (let i = 0; i < moves.length; i++) {
        const mv = moves[i];
        const captured = this.chessDoMove(board, mv.fromR, mv.fromC, mv.toR, mv.toC);
        const result = this.chessMinimax(board, depth - 1, alpha, beta, false, aiCol, moveLimit);
        this.chessUndoMove(board, mv.fromR, mv.fromC, mv.toR, mv.toC, captured);
        if (result.score > bestScore) {
          bestScore = result.score;
          bestMove = mv;
        }
        alpha = Math.max(alpha, bestScore);
        if (beta <= alpha) break;
      }
      return { score: bestScore, move: bestMove };
    } else {
      let bestScore = Infinity;
      for (let i = 0; i < moves.length; i++) {
        const mv = moves[i];
        const captured = this.chessDoMove(board, mv.fromR, mv.fromC, mv.toR, mv.toC);
        const result = this.chessMinimax(board, depth - 1, alpha, beta, true, aiCol, moveLimit);
        this.chessUndoMove(board, mv.fromR, mv.fromC, mv.toR, mv.toC, captured);
        if (result.score < bestScore) {
          bestScore = result.score;
          bestMove = mv;
        }
        beta = Math.min(beta, bestScore);
        if (beta <= alpha) break;
      }
      return { score: bestScore, move: bestMove };
    }
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

  // 象棋简单 AI：避免送子，从前若干高分走法中随机选择
  chessAIEasy(board, aiCol) {
    const pieces = this.chessPieces(board, aiCol);
    if (pieces.length === 0) return null;
    const opCol = aiCol === 'r' ? 'b' : 'r';
    const scored = [];
    for (const p of pieces) {
      for (const m of this.chessLegal(board, p.r, p.c)) {
        const s = this.chessScoreMove(board, p.r, p.c, m.r, m.c, aiCol, opCol);
        scored.push({ fromR: p.r, fromC: p.c, toR: m.r, toC: m.c, score: s });
      }
    }
    if (scored.length === 0) return null;
    scored.sort((a, b) => b.score - a.score);
    const topN = Math.min(6, scored.length);
    const pick = scored[Math.floor(Math.random() * topN)];
    return { fromR: pick.fromR, fromC: pick.fromC, toR: pick.toR, toC: pick.toC };
  }

  // 象棋中等 AI：1 步前瞻 + 整体评估
  chessAIMedium(board, aiCol) {
    const pieces = this.chessPieces(board, aiCol);
    if (pieces.length === 0) return null;
    const opCol = aiCol === 'r' ? 'b' : 'r';

    const moves = this.chessOrderedMoves(board, aiCol);
    if (moves.length === 0) return null;

    // 只在前 10 个候选走法中进行一步前瞻
    const topMoves = moves.slice(0, Math.min(10, moves.length));
    let bestScore = -Infinity;
    let bestMoves = [];

    for (const mv of topMoves) {
      const simBoard = this.chessSimMove(board, mv.fromR, mv.fromC, mv.toR, mv.toC);
      let score = this.chessEvaluateBoard(simBoard, aiCol);
      // 扣减对手最佳反击的粗略影响
      const opMoves = this.chessOrderedMoves(simBoard, opCol);
      if (opMoves.length > 0) score -= opMoves[0].score * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestMoves = [mv];
      } else if (score === bestScore) {
        bestMoves.push(mv);
      }
    }
    const pick = bestMoves[Math.floor(Math.random() * bestMoves.length)];
    return { fromR: pick.fromR, fromC: pick.fromC, toR: pick.toR, toC: pick.toC };
  }

  // 象棋困难 AI：Minimax + Alpha-Beta 剪枝搜索 (2-3 层 + 走法限制)
  chessAIHard(board, aiCol) {
    const pieces = this.chessPieces(board, aiCol);
    if (pieces.length === 0) return null;
    const opCol = aiCol === 'r' ? 'b' : 'r';
    const totalPieces = pieces.length + this.chessPieces(board, opCol).length;

    let depth = 2;
    let moveLimit = 12;
    if (totalPieces <= 10) { depth = 3; moveLimit = 15; }
    if (totalPieces <= 6) { depth = 4; moveLimit = 20; }

    const result = this.chessMinimax(board, depth, -Infinity, Infinity, true, aiCol, moveLimit);
    if (result && result.move) {
      return { fromR: result.move.fromR, fromC: result.move.fromC, toR: result.move.toR, toC: result.move.toC };
    }
    return this.chessAIMedium(board, aiCol);
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
      const threatScore = this.evaluatePosition(board, cell.r, cell.c, opponent);
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
      score += this.evaluatePosition(board, cell.r, cell.c, currentPlayer) * 1.2;
      board[cell.r][cell.c] = 0;

      // 评估这个位置的防守价值（阻断玩家）
      board[cell.r][cell.c] = opponent;
      score += this.evaluatePosition(board, cell.r, cell.c, opponent) * 0.8;
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
    score += this.evaluatePosition(board, r, c, currentPlayer) * 2.5;
    board[r][c] = 0;

    // 防守评分（降低权重，让AI更具进攻性）
    board[r][c] = opponent;
    score += this.evaluatePosition(board, r, c, opponent) * 0.8;
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

  // ========== 智能提示系统 ==========

  // 通用智能提示入口
  getSmartHint(gameType, board, currentPlayer) {
    try {
      switch (gameType) {
        case 'gobang':
          return this.getGobangSmartHint(board, currentPlayer);
        case 'chinese-chess':
          return this.getChessSmartHint(board, 'hard', currentPlayer);
        case 'go':
          return this.getGoSmartHint(board, currentPlayer);
        default:
          return null;
      }
    } catch (error) {
      logger.error('getSmartHint 出错', { error: error.message });
      return null;
    }
  }

  // 五子棋智能提示 - 按战局优先级分析
  getGobangSmartHint(board, currentPlayer) {
    const opponent = currentPlayer === 1 ? 2 : 1;
    const aiBoard = board.map(row => [...row]);

    // 第一步直接给中心位置
    if (this.isFirstMove(aiBoard)) {
      const centerR = Math.floor(aiBoard.length / 2);
      const centerC = Math.floor(aiBoard[0].length / 2);
      return {
        move: { r: centerR, c: centerC },
        reason: '💡 开局第一步，抢占中心位置控制战局',
        type: 'opening'
      };
    }

    // ===== 最高优先级：立即获胜 =====
    const winningMove = this.findWinningMove(aiBoard, currentPlayer);
    if (winningMove) {
      return {
        move: winningMove,
        reason: '🎯 这里可以直接获胜！点击此位置完成五连',
        type: 'win'
      };
    }

    // ===== 次高优先级：对手即将获胜，必须防守 =====
    const mustDefendMove = this.findWinningMove(aiBoard, opponent);
    if (mustDefendMove) {
      return {
        move: mustDefendMove,
        reason: '🛡️ 紧急防守！对手在此处即将五连，必须阻止',
        type: 'block-win'
      };
    }

    // ===== 高优先级：防守对手的四连 =====
    const fourInRowDefense = this.findFourInRowDefense(aiBoard, opponent);
    if (fourInRowDefense) {
      return {
        move: fourInRowDefense,
        reason: '🛡️ 防守对手的四连威胁，防止对方形成必胜局面',
        type: 'block-four'
      };
    }

    const opponentFourInRow = this.findFourInRowMove(aiBoard, opponent);
    if (opponentFourInRow) {
      // 若对手成四连的一端被封（冲四），应堵「开口端」才能真正阻止成五
      const openEnd = this.findFourOpenEnd(aiBoard, opponent, opponentFourInRow);
      if (openEnd) {
        return {
          move: openEnd,
          reason: '🛡️ 防守：对手可在此形成四连，堵住开口端彻底阻止成五',
          type: 'block-four',
        };
      }
      return {
        move: opponentFourInRow,
        reason: '🛡️ 防守：对手可以在此形成四连，需要提前阻止',
        type: 'block-four',
      };
    }

    // ===== 高优先级：自己形成活四（必胜） =====
    const myLiveFour = this.findLiveFourMove(aiBoard, currentPlayer);
    if (myLiveFour) {
      return {
        move: myLiveFour,
        reason: '⚡ 在此处落子可形成活四，对手无法防守，必胜！',
        type: 'live-four'
      };
    }

    // ===== 高优先级：自己形成冲四 =====
    const myRushFour = this.findRushFourMove(aiBoard, currentPlayer);
    if (myRushFour) {
      return {
        move: myRushFour,
        reason: '🔥 在此处落子可形成冲四，对方必须防守，你将获得先手',
        type: 'rush-four'
      };
    }

    // ===== 中优先级：防守对手的活四/冲四 =====
    const opponentLiveFour = this.findLiveFourMove(aiBoard, opponent);
    if (opponentLiveFour) {
      return {
        move: opponentLiveFour,
        reason: '🛡️ 防守对手的活四机会，否则对手将获得必胜局面',
        type: 'block-live-four'
      };
    }

    const opponentRushFour = this.findRushFourMove(aiBoard, opponent);
    if (opponentRushFour) {
      return {
        move: opponentRushFour,
        reason: '🛡️ 防守对手即将形成的冲四威胁',
        type: 'block-rush-four'
      };
    }

    // ===== 中优先级：形成双活三（必胜局面） =====
    const doubleLiveThree = this.findDoubleLiveThreeMove(aiBoard, currentPlayer);
    if (doubleLiveThree) {
      return {
        move: doubleLiveThree,
        reason: '⚡ 双活三！在此处落子可同时形成两个活三，必胜局面',
        type: 'double-live-three'
      };
    }

    const opponentDoubleLiveThree = this.findDoubleLiveThreeMove(aiBoard, opponent);
    if (opponentDoubleLiveThree) {
      return {
        move: opponentDoubleLiveThree,
        reason: '🛡️ 防守：对手可以在此形成双活三，必须提前阻止',
        type: 'block-double-live-three'
      };
    }

    // ===== 中低优先级：形成活三 =====
    const liveThreeMove = this.findLiveThreeMove(aiBoard, currentPlayer);
    if (liveThreeMove) {
      return {
        move: liveThreeMove,
        reason: '🔥 在此处落子可形成活三，为后续进攻打下基础',
        type: 'live-three'
      };
    }

    const opponentLiveThree = this.findLiveThreeMove(aiBoard, opponent);
    if (opponentLiveThree) {
      return {
        move: opponentLiveThree,
        reason: '🛡️ 防守对手的活三机会，防止其形成更强攻势',
        type: 'block-live-three'
      };
    }

    // ===== 低优先级：使用困难模式Minimax分析最佳位置 =====
    try {
      const hardMove = this.getGobangHardMove(aiBoard, currentPlayer);
      if (hardMove) {
        // 判断该点的攻守属性：紧邻对方棋子多 → 防守；紧邻己方多 → 进攻
        let nearOwn = 0;
        let nearOp = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const nr = hardMove.r + dr;
            const nc = hardMove.c + dc;
            if (nr < 0 || nr >= aiBoard.length || nc < 0 || nc >= aiBoard[0].length) continue;
            if (aiBoard[nr][nc] === currentPlayer) nearOwn++;
            else if (aiBoard[nr][nc] === opponent) nearOp++;
          }
        }
        let reason;
        if (nearOp >= 2 && nearOwn <= 1) {
          reason = '🛡️ 防守反击：紧邻对手多枚棋子，阻断其攻势的同时埋下自己的伏笔';
        } else if (nearOwn >= 2) {
          reason = '⚡ 乘胜追击：紧邻己方棋子，延续攻势、扩大控制区域';
        } else {
          reason = '💡 综合分析：此处攻守价值均衡，最适合稳步推进';
        }
        return { move: hardMove, reason, type: 'strategic' };
      }
    } catch (e) {
      // 回退到中等难度
    }

    // ===== 兜底：使用中等难度 =====
    const mediumMove = this.getGobangMediumMove(aiBoard, currentPlayer);
    if (mediumMove) {
      return {
        move: mediumMove,
        reason: '💡 建议位置：此处有利于构建攻势',
        type: 'general'
      };
    }

    // ===== 最后兜底：简单模式 =====
    const easyMove = this.getGobangEasyMove(aiBoard, currentPlayer);
    if (easyMove) {
      return {
        move: easyMove,
        reason: '💡 推荐位置',
        type: 'general'
      };
    }

    return null;
  }

  // 中国象棋智能提示（带意图讲解）
  getChessSmartHint(board, difficulty, currentPlayer) {
    try {
      const aiCol = currentPlayer === 1 ? 'r' : 'b';
      const opCol = aiCol === 'r' ? 'b' : 'r';

      // 使用困难模式AI获取最佳走法
      const move = this.getChessAIMove(board, 'hard', currentPlayer);
      if (move) {
        const hint = this.chessHintReason(board, move, aiCol, opCol);
        return { move, reason: hint.text, type: hint.type };
      }

      // 兜底：中等难度
      const mediumMove = this.getChessAIMove(board, 'medium', currentPlayer);
      if (mediumMove) {
        const hint = this.chessHintReason(board, mediumMove, aiCol, opCol);
        return { move: mediumMove, reason: hint.text, type: hint.type };
      }
    } catch (e) {
      logger.error('getChessSmartHint 出错', { error: e.message });
    }

    return null;
  }

  // 分析一步棋的意图：绝杀/将军/吃子/兑子/防守/威胁大子/战略
  chessHintReason(board, move, aiCol, opCol) {
    const { fromR, fromC, toR, toC } = move;
    const tp = this.chessType(board[fromR][fromC]) || '兵';
    const captured = board[toR][toC];
    const selfName = CHESS_NAMES[tp] || '子';
    const simBoard = this.chessSimMove(board, fromR, fromC, toR, toC);

    // 1. 将军 / 绝杀
    if (this.chessCheck(simBoard, opCol)) {
      const opMoves = this.chessAllLegal(simBoard, opCol);
      if (opMoves.length === 0) {
        return { type: 'checkmate', text: `🚨 绝杀！${selfName}这一步直接将军并锁死对方，对方已无路可走` };
      }
      return { type: 'check', text: `🚨 将军！用${selfName}直逼对方主将，对手必须立即应对` };
    }

    // 2. 吃子
    if (captured) {
      const capTp = this.chessType(captured);
      const capName = CHESS_NAMES[capTp] || '子';
      const capVal = this.chessPieceValue(capTp);
      // 走子后会被对方反吃 → 兑子
      if (this.chessMoveWillBeCaptured(board, fromR, fromC, toR, toC, opCol)) {
        return {
          type: 'exchange',
          text: `⚖️ 兑子！吃掉对方${capName}（价值${capVal}），对方可反吃，本手等价交换、不吃亏`,
        };
      }
      if (capVal >= 400) {
        return { type: 'capture', text: `🛡️ 吃大子！白吃对方${capName}（价值${capVal}），子力优势大幅领先` };
      }
      return { type: 'capture', text: `🛡️ 吃子：白吃对方${capName}，稳步扩大子力优势` };
    }

    // 3. 防守：本方棋子正被攻击，走到安全位置
    if (this.chessIsAttacked(board, fromR, fromC, opCol)) {
      if (!this.chessMoveWillBeCaptured(board, fromR, fromC, toR, toC, opCol)) {
        return { type: 'defend', text: `🛡️ 防守：${selfName}正被对方威胁，这步走到安全位置并继续施压` };
      }
    }

    // 4. 威胁对方大子：走子后攻击到车/炮/马
    const threat = this.chessThreatenedByMove(board, move, opCol);
    if (threat) {
      return { type: 'threat', text: `⚔️ 攻击！这一步的${selfName}直指对方${threat}，逼对方防守、抢夺主动权` };
    }

    // 5. 战略走法
    return { type: 'strategic', text: `📊 战略走法：调动${selfName}占据要点、改善阵型，为后续进攻蓄力` };
  }

  // 检查走子后是否攻击到对方的车/炮/马（返回最高价值被攻击棋子名）
  chessThreatenedByMove(board, move, opCol) {
    const sim = this.chessSimMove(board, move.fromR, move.fromC, move.toR, move.toC);
    let bestName = null;
    let bestVal = 0;
    for (const t of this.chessRaw(sim, move.toR, move.toC)) {
      const target = sim[t.r][t.c];
      if (!target || this.chessColor(target) !== opCol) continue;
      const val = this.chessPieceValue(this.chessType(target));
      if (val > bestVal) {
        bestVal = val;
        bestName = CHESS_NAMES[this.chessType(target)] || '子';
      }
    }
    return bestName;
  }

  // 围棋智能提示（带意图讲解）
  getGoSmartHint(board, currentPlayer) {
    try {
      const opponent = currentPlayer === 1 ? 2 : 1;
      const aiBoard = board.map(row => [...row]);
      const empties = this.getEmptyCells(aiBoard);
      if (empties.length === 0) return null;

      // 开局第一步：天元
      if (this.isFirstMove(aiBoard)) {
        const centerR = Math.floor(aiBoard.length / 2);
        const centerC = Math.floor(aiBoard[0].length / 2);
        return { move: { r: centerR, c: centerC }, reason: '💡 开局第一步，抢占天元控制全局', type: 'opening' };
      }

      // 1. 提子：落子可提掉对方棋子
      for (const cell of empties) {
        if (this.canCapture(aiBoard, cell.r, cell.c, currentPlayer)) {
          return {
            move: { r: cell.r, c: cell.c },
            reason: '⚔️ 提子！落在这里直接提掉对方棋子，收获实空并削弱对手',
            type: 'capture',
          };
        }
      }

      // 2. 打吃：落子使对方棋子只剩一口气
      for (const cell of empties) {
        if (this.isAtariMove(aiBoard, cell.r, cell.c, currentPlayer, opponent)) {
          return {
            move: { r: cell.r, c: cell.c },
            reason: '🔥 打吃！落子后对方棋子只剩一口气，下一手即可提子',
            type: 'atari',
          };
        }
      }

      // 3. 逃子：己方棋子只剩一口气，先保命
      const escape = this.findEscapeMove(aiBoard, currentPlayer);
      if (escape) return escape;

      // 4. 连接 / 分断
      for (const cell of empties) {
        const conn = this.isConnectionMove(aiBoard, cell.r, cell.c, currentPlayer, opponent);
        if (conn) {
          return { move: { r: cell.r, c: cell.c }, reason: conn.text, type: conn.type };
        }
      }

      // 5. 星位 / 角部要点
      for (const cell of empties) {
        if (this.isNearStarPoint(cell.r, cell.c)) {
          return {
            move: { r: cell.r, c: cell.c },
            reason: '🌐 抢占要点：这里是角部/星位附近，是布局的关键位置',
            type: 'star',
          };
        }
      }

      // 6. 战略：综合评分最高的落点
      const mediumMove = this.getGoMediumMove(aiBoard, currentPlayer);
      if (mediumMove) {
        return {
          move: mediumMove,
          reason: '📊 战略落子：紧贴己方棋子巩固势力，兼顾攻防、稳步经营',
          type: 'strategic',
        };
      }

      // 兜底：简单模式
      const easyMove = this.getGoEasyMove(aiBoard);
      if (easyMove) {
        return { move: easyMove, reason: '💡 推荐位置', type: 'general' };
      }
    } catch (e) {
      logger.error('getGoSmartHint 出错', { error: e.message });
    }

    return null;
  }

  // 判断落子是否对相邻对方棋子形成「打吃」（落子后只剩一口气）
  isAtariMove(board, r, c, player, opponent) {
    const nb = board.map(row => [...row]);
    nb[r][c] = player;
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr >= 0 && nr < nb.length && nc >= 0 && nc < nb[0].length && nb[nr][nc] === opponent) {
        if (this.countLiberties(nb, nr, nc) === 1) return true;
      }
    }
    return false;
  }

  // 找己方只剩一口气的棋子，返回逃跑落点（带讲解）
  findEscapeMove(board, player) {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[0].length; c++) {
        if (board[r][c] === player && this.countLiberties(board, r, c) === 1) {
          for (const [dr, dc] of dirs) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length && board[nr][nc] === 0) {
              return {
                move: { r: nr, c: nc },
                reason: '🏃 逃子！你的棋子只剩一口气了，落在这里延长气、避免被提',
                type: 'escape',
              };
            }
          }
        }
      }
    }
    return null;
  }

  // 判断落子意图：连接己方（≥2 邻己）或分断对方（≥2 邻敌）
  isConnectionMove(board, r, c, player, opponent) {
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    let own = 0;
    let op = 0;
    for (const [dr, dc] of dirs) {
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board[0].length) continue;
      if (board[nr][nc] === player) own++;
      else if (board[nr][nc] === opponent) op++;
    }
    if (own >= 2) {
      return { text: '🔗 连接！把己方棋子连成一体，增强气数与韧性', type: 'connect' };
    }
    if (op >= 2) {
      return { text: '✂️ 分断！切断对方棋子的联系，使其各自为战', type: 'cut' };
    }
    return null;
  }
}

module.exports = AIManager;