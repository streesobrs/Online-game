// GameManager.js - 游戏管理模块
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class GameManager {
  constructor(userManager) {
    this.userManager = userManager;
    this.waitingUsers = new Map(); // gameType -> Set(userId)
    this.games = new Map(); // gameId -> game对象
    this.spectators = new Map(); // gameId -> Set(userId)
    this.gameTimers = new Map(); // gameId -> timer
    this.moveHistory = new Map(); // gameId -> moves数组
  }

  // 生成游戏ID
  generateGameId() {
    return crypto.randomBytes(5).toString('hex'); // 10位十六进制
  }

  // 处理匹配请求
  handleMatchRequest(socketId, gameType, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) {
      logger.warn('匹配请求失败：用户不存在', { socketId });
      return false;
    }

    // 验证游戏类型
    if (!Object.values(config.game.types).includes(gameType)) {
      logger.warn('匹配请求失败：无效的游戏类型', { userId: user.userId, gameType });
      return false;
    }

    // 检查用户状态
    if (user.status !== 'online') {
      logger.warn('匹配请求失败：用户状态不正确', { userId: user.userId, status: user.status });
      return false;
    }

    // 更新用户状态
    user.status = 'waiting';
    user.gameType = gameType;
    user.lastActivity = Date.now();

    // 添加到等待列表
    if (!this.waitingUsers.has(gameType)) {
      this.waitingUsers.set(gameType, new Set());
    }
    this.waitingUsers.get(gameType).add(user.userId);

    logger.userAction(user.userId, '开始匹配', { gameType });

    // 广播用户状态
    this.userManager.broadcastUserStatus(user.userId, 'waiting', io);

    // 检查匹配
    this.checkMatch(gameType, io);

    return true;
  }

  // 处理取消匹配
  handleCancelMatch(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return false;

    if (user.status === 'waiting') {
      // 从等待列表移除
      if (this.waitingUsers.has(user.gameType)) {
        this.waitingUsers.get(user.gameType).delete(user.userId);
        
        // 清理空集合
        if (this.waitingUsers.get(user.gameType).size === 0) {
          this.waitingUsers.delete(user.gameType);
        }
      }

      // 更新用户状态
      user.status = 'online';
      user.lastActivity = Date.now();

      logger.userAction(user.userId, '取消匹配', { gameType: user.gameType });

      // 广播用户状态
      this.userManager.broadcastUserStatus(user.userId, 'online', io);

      return true;
    }

    return false;
  }

  // 检查匹配
  checkMatch(gameType, io) {
    const waitingList = this.waitingUsers.get(gameType);
    if (!waitingList || waitingList.size < 2) return;

    // 获取前两个用户
    const users = Array.from(waitingList);
    const userId1 = users[0];
    const userId2 = users[1];

    // 从等待列表移除
    waitingList.delete(userId1);
    waitingList.delete(userId2);

    // 清理空集合
    if (waitingList.size === 0) {
      this.waitingUsers.delete(gameType);
    }

    // 创建游戏
    this.createGame(userId1, userId2, gameType, io);
  }

  // 创建游戏
  createGame(userId1, userId2, gameType, io) {
    const gameId = this.generateGameId();
    const user1 = this.userManager.getUserByUserId(userId1);
    const user2 = this.userManager.getUserByUserId(userId2);

    if (!user1 || !user2) {
      logger.error('创建游戏失败：用户不存在', { userId1, userId2 });
      return null;
    }

    const game = {
      gameId,
      gameType,
      player1: userId1,
      player2: userId2,
      player1Nickname: user1.nickname,
      player2Nickname: user2.nickname,
      status: 'playing',
      startTime: Date.now(),
      lastMoveTime: Date.now(),
      currentPlayer: 1, // 1 = player1, 2 = player2
      moves: [],
      result: null,
      endTime: null,
      chat: []
    };

    this.games.set(gameId, game);
    this.moveHistory.set(gameId, []);
    this.spectators.set(gameId, new Set());

    // 更新用户状态
    user1.status = 'playing';
    user1.game = gameId;
    user1.lastActivity = Date.now();
    user2.status = 'playing';
    user2.game = gameId;
    user2.lastActivity = Date.now();

    logger.gameEvent(gameId, '游戏开始', {
      gameType,
      player1: userId1,
      player2: userId2
    });

    // 广播用户状态
    this.userManager.broadcastUserStatus(userId1, 'playing', io);
    this.userManager.broadcastUserStatus(userId2, 'playing', io);

    // 通知玩家
    const socket1 = this.userManager.getSocketByUserId(userId1);
    const socket2 = this.userManager.getSocketByUserId(userId2);

    if (socket1) {
      socket1.emit('match_success', {
        gameId,
        game: gameType,
        opponentId: userId2,
        opponentNickname: user2.nickname,
        color: 1,
        timestamp: Date.now()
      });
    }

    if (socket2) {
      socket2.emit('match_success', {
        gameId,
        game: gameType,
        opponentId: userId1,
        opponentNickname: user1.nickname,
        color: 2,
        timestamp: Date.now()
      });
    }

    // 启动游戏计时器
    this.startGameTimer(gameId, io);

    return game;
  }

  // 启动游戏计时器
  startGameTimer(gameId, io) {
    const timer = setInterval(() => {
      const game = this.games.get(gameId);
      if (!game) {
        this.stopGameTimer(gameId);
        return;
      }

      // 检查游戏超时
      const now = Date.now();
      if (now - game.startTime > config.game.maxGameTime) {
        this.endGame(gameId, 'timeout', io);
        return;
      }

      // 检查长时间未移动
      if (now - game.lastMoveTime > 300000) { // 5分钟
        // 通知玩家
        const socket1 = this.userManager.getSocketByUserId(game.player1);
        const socket2 = this.userManager.getSocketByUserId(game.player2);
        
        if (socket1) socket1.emit('game_warning', { message: '长时间未移动，游戏即将结束' });
        if (socket2) socket2.emit('game_warning', { message: '长时间未移动，游戏即将结束' });
      }
    }, 30000); // 每30秒检查一次

    this.gameTimers.set(gameId, timer);
  }

  // 停止游戏计时器
  stopGameTimer(gameId) {
    const timer = this.gameTimers.get(gameId);
    if (timer) {
      clearInterval(timer);
      this.gameTimers.delete(gameId);
    }
  }

  // 处理游戏移动
  handleMove(socketId, data, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user || user.status !== 'playing') {
      return false;
    }

    const game = this.games.get(user.game);
    if (!game || game.status !== 'playing') {
      return false;
    }

    // 验证是否是当前玩家
    const isPlayer1 = game.player1 === user.userId;
    const isPlayer2 = game.player2 === user.userId;
    
    if ((game.currentPlayer === 1 && !isPlayer1) || 
        (game.currentPlayer === 2 && !isPlayer2)) {
      return false;
    }

    // 记录移动
    const move = {
      player: user.userId,
      color: isPlayer1 ? 1 : 2,
      position: data.position,
      timestamp: Date.now()
    };

    game.moves.push(move);
    game.lastMoveTime = Date.now();
    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;

    // 保存移动历史
    const moves = this.moveHistory.get(game.gameId);
    moves.push(move);

    // 更新用户活动
    this.userManager.updateUserActivity(user.userId);

    logger.gameEvent(game.gameId, '移动', {
      player: user.userId,
      position: data.position
    });

    // 发送给对手
    const opponentId = isPlayer1 ? game.player2 : game.player1;
    const opponentSocket = this.userManager.getSocketByUserId(opponentId);
    if (opponentSocket) {
      opponentSocket.emit('move', {
        ...data,
        from: user.userId,
        color: move.color
      });
    }

    // 发送给观战者
    this.broadcastToSpectators(game.gameId, 'move', {
      ...data,
      from: user.userId,
      color: move.color
    }, io);

    return true;
  }

  // 处理游戏重置请求
  handleReset(socketId, data, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user || user.status !== 'playing') {
      return false;
    }

    const game = this.games.get(user.game);
    if (!game) {
      return false;
    }

    // 转发给对手
    const opponentId = game.player1 === user.userId ? game.player2 : game.player1;
    const opponentSocket = this.userManager.getSocketByUserId(opponentId);
    
    if (opponentSocket) {
      opponentSocket.emit('reset_request', {
        from: user.userId,
        message: data.message || '对方请求重置棋盘'
      });
    }

    return true;
  }

  // 处理游戏结果
  handleGameResult(socketId, data, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user || user.status !== 'playing') {
      return false;
    }

    const game = this.games.get(user.game);
    if (!game || game.status !== 'playing') {
      return false;
    }

    const { result, reason } = data;
    
    // 验证结果
    if (!['win', 'draw', 'resign'].includes(result)) {
      return false;
    }

    // 确定胜负
    let winner = null;
    let loser = null;

    if (result === 'win') {
      winner = user.userId;
      loser = game.player1 === user.userId ? game.player2 : game.player1;
    } else if (result === 'resign') {
      loser = user.userId;
      winner = game.player1 === user.userId ? game.player2 : game.player1;
    }

    // 结束游戏
    this.endGame(game.gameId, result, io, winner, reason);

    return true;
  }

  // 结束游戏
  async endGame(gameId, result, io, winner = null, reason = '') {
    const game = this.games.get(gameId);
    if (!game || game.status !== 'playing') {
      return false;
    }

    game.status = 'ended';
    game.result = result;
    game.endTime = Date.now();
    game.endReason = reason;
    game.winner = winner;

    // 停止计时器
    this.stopGameTimer(gameId);

    logger.gameEvent(gameId, '游戏结束', {
      result,
      winner,
      reason,
      duration: game.endTime - game.startTime
    });

    // 更新用户统计
    if (result === 'win' || result === 'resign') {
      this.userManager.updateUserStats(winner, 'win');
      const loser = winner === game.player1 ? game.player2 : game.player1;
      this.userManager.updateUserStats(loser, 'loss');
    } else if (result === 'draw') {
      this.userManager.updateUserStats(game.player1, 'draw');
      this.userManager.updateUserStats(game.player2, 'draw');
    } else if (result === 'timeout') {
      // 超时判负
      this.userManager.updateUserStats(game.player1, 'loss');
      this.userManager.updateUserStats(game.player2, 'loss');
    }

    // 通知玩家
    const socket1 = this.userManager.getSocketByUserId(game.player1);
    const socket2 = this.userManager.getSocketByUserId(game.player2);

    const endData = {
      gameId,
      result,
      winner,
      reason,
      moves: game.moves,
      duration: game.endTime - game.startTime
    };

    if (socket1) socket1.emit('game_ended', endData);
    if (socket2) socket2.emit('game_ended', endData);

    // 通知观战者
    this.broadcastToSpectators(gameId, 'game_ended', endData, io);

    // 更新用户状态
    const user1 = this.userManager.getUserByUserId(game.player1);
    const user2 = this.userManager.getUserByUserId(game.player2);

    if (user1) {
      user1.status = 'online';
      user1.game = null;
      this.userManager.broadcastUserStatus(game.player1, 'online', io);
    }

    if (user2) {
      user2.status = 'online';
      user2.game = null;
      this.userManager.broadcastUserStatus(game.player2, 'online', io);
    }

    // 保存游戏记录
    await this.saveGameRecord(game);

    // 清理观战者
    this.spectators.delete(gameId);
    this.moveHistory.delete(gameId);

    return true;
  }

  // 保存游戏记录
  async saveGameRecord(game) {
    try {
      const record = {
        id: game.gameId,
        gameId: game.gameId,
        gameType: game.gameType,
        player1: game.player1,
        player2: game.player2,
        player1Nickname: game.player1Nickname,
        player2Nickname: game.player2Nickname,
        winner: game.winner,
        result: game.result,
        moves: game.moves,
        startTime: game.startTime,
        endTime: game.endTime,
        duration: game.endTime - game.startTime,
        savedAt: Date.now()
      };

      await dataStore.add('games', record);
      logger.info('游戏记录已保存', { gameId: game.gameId });
    } catch (err) {
      logger.error('保存游戏记录失败', { gameId: game.gameId, error: err.message });
    }
  }

  // 处理返回大厅
  handleReturnLobby(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return false;

    // 如果在等待队列中，先移除
    if (user.status === 'waiting') {
      this.handleCancelMatch(socketId, io);
    }

    // 如果在游戏中，结束游戏
    if (user.status === 'playing' && user.game) {
      const game = this.games.get(user.game);
      if (game && game.status === 'playing') {
        // 通知对手
        const opponentId = game.player1 === user.userId ? game.player2 : game.player1;
        const opponentSocket = this.userManager.getSocketByUserId(opponentId);

        if (opponentSocket) {
          opponentSocket.emit('opponent_left', {
            userId: user.userId,
            message: '对方已离开游戏'
          });
        }

        // 结束游戏，对方获胜
        this.endGame(game.gameId, 'resign', io, opponentId, '玩家离开游戏');
      }
    }

    // 更新用户状态
    user.status = 'online';
    user.game = null;
    user.lastActivity = Date.now();

    logger.userAction(user.userId, '返回大厅');

    // 广播用户状态
    this.userManager.broadcastUserStatus(user.userId, 'online', io);

    return true;
  }

  // 处理用户断开连接
  handleUserDisconnect(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return;

    // 如果在等待队列中，移除
    if (user.status === 'waiting') {
      this.handleCancelMatch(socketId, io);
    }

    // 如果在游戏中，结束游戏
    if (user.status === 'playing' && user.game) {
      const game = this.games.get(user.game);
      if (game && game.status === 'playing') {
        const opponentId = game.player1 === user.userId ? game.player2 : game.player1;
        
        // 延迟结束游戏（给用户重新连接的机会）
        setTimeout(() => {
          const currentGame = this.games.get(game.gameId);
          if (currentGame && currentGame.status === 'playing') {
            // 检查玩家是否重新连接
            const user1 = this.userManager.getUserByUserId(game.player1);
            const user2 = this.userManager.getUserByUserId(game.player2);
            
            if (!user1 || !user2) {
              // 有玩家离线，结束游戏
              const winner = user1 ? game.player1 : game.player2;
              this.endGame(game.gameId, 'resign', io, winner, '对手断开连接');
            }
          }
        }, 30000); // 30秒延迟
      }
    }
  }

  // 添加观战者
  addSpectator(gameId, userId, io) {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, message: '游戏不存在' };
    }

    // 不能观战自己的游戏
    if (game.player1 === userId || game.player2 === userId) {
      return { success: false, message: '不能观战自己的游戏' };
    }

    const spectators = this.spectators.get(gameId);
    if (spectators) {
      spectators.add(userId);
      
      const user = this.userManager.getUserByUserId(userId);
      if (user) {
        user.status = 'spectating';
        user.game = gameId;
        this.userManager.broadcastUserStatus(userId, 'spectating', io);
      }

      logger.userAction(userId, '开始观战', { gameId });

      return {
        success: true,
        game: {
          gameId: game.gameId,
          gameType: game.gameType,
          player1: game.player1Nickname,
          player2: game.player2Nickname,
          moves: game.moves,
          currentPlayer: game.currentPlayer
        }
      };
    }

    return { success: false, message: '无法加入观战' };
  }

  // 移除观战者
  removeSpectator(gameId, userId, io) {
    const spectators = this.spectators.get(gameId);
    if (spectators) {
      spectators.delete(userId);
      
      const user = this.userManager.getUserByUserId(userId);
      if (user) {
        user.status = 'online';
        user.game = null;
        this.userManager.broadcastUserStatus(userId, 'online', io);
      }

      logger.userAction(userId, '结束观战', { gameId });
    }
  }

  // 广播给观战者
  broadcastToSpectators(gameId, event, data, io) {
    const spectators = this.spectators.get(gameId);
    if (spectators) {
      for (const userId of spectators) {
        const socket = this.userManager.getSocketByUserId(userId);
        if (socket) {
          socket.emit(event, data);
        }
      }
    }
  }

  // 获取可观战的游戏列表
  getSpectatableGames() {
    const games = [];
    for (const [gameId, game] of this.games) {
      if (game.status === 'playing') {
        games.push({
          gameId: game.gameId,
          gameType: game.gameType,
          player1: game.player1Nickname,
          player2: game.player2Nickname,
          moveCount: game.moves.length,
          spectatorCount: this.spectators.get(gameId)?.size || 0
        });
      }
    }
    return games;
  }

  // 获取游戏历史
  async getGameHistory(userId, limit = 10) {
    try {
      const games = await dataStore.read('games');
      return games
        .filter(game => game.player1 === userId || game.player2 === userId)
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, limit)
        .map(game => ({
          gameId: game.gameId,
          gameType: game.gameType,
          opponent: game.player1 === userId ? game.player2Nickname : game.player1Nickname,
          result: game.winner === userId ? 'win' : game.winner === null ? 'draw' : 'loss',
          moves: game.moves?.length || 0,
          date: game.endTime,
          duration: game.duration
        }));
    } catch (err) {
      logger.error('获取游戏历史失败', { userId, error: err.message });
      return [];
    }
  }

  // 获取所有游戏
  getAllGames() {
    return Array.from(this.games.values()).map(game => ({
      gameId: game.gameId,
      gameType: game.gameType,
      player1: game.player1Nickname,
      player2: game.player2Nickname,
      status: game.status,
      moveCount: game.moves.length,
      startTime: game.startTime,
      spectatorCount: this.spectators.get(game.gameId)?.size || 0
    }));
  }

  // 根据ID获取游戏
  getGameById(gameId) {
    return this.games.get(gameId);
  }

  // 获取等待中的用户
  getWaitingUsers() {
    const result = {};
    for (const [gameType, users] of this.waitingUsers) {
      result[gameType] = Array.from(users);
    }
    return result;
  }

  // 管理员强制结束游戏
  adminEndGame(gameId, io) {
    const game = this.games.get(gameId);
    if (game && game.status === 'playing') {
      this.endGame(gameId, 'admin', io, null, '管理员结束游戏');
      return true;
    }
    return false;
  }
}

module.exports = GameManager;
