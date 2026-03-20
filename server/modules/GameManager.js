// GameManager.js - 游戏管理模块
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class GameManager {
  constructor(userManager, accountManager = null, achievementManager = null, aiManager = null) {
    this.userManager = userManager;
    this.accountManager = accountManager;
    this.achievementManager = achievementManager;
    this.aiManager = aiManager;
    this.waitingUsers = new Map(); // gameType -> Set(userId)
    this.challengeRequests = new Map(); // challengerId -> { challengedId, gameType, timestamp }
    this.games = new Map(); // gameId -> game对象
    this.spectators = new Map(); // gameId -> Set(userId)
    this.gameTimers = new Map(); // gameId -> timer
    this.moveHistory = new Map(); // gameId -> moves数组
    this.aiGames = new Map(); // userId -> aiGame对象
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

    logger.matchEvent(user.userId, '开始匹配', { gameType });

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

      logger.matchEvent(user.userId, '取消匹配', { gameType: user.gameType });

      // 广播用户状态
      this.userManager.broadcastUserStatus(user.userId, 'online', io);

      return true;
    }

    return false;
  }

  // 处理挑战请求
  handleChallengeRequest(socketId, data, io) {
    const challenger = this.userManager.getUserBySocketId(socketId);
    if (!challenger) {
      io.to(socketId).emit('error', { message: '挑战失败：您的用户状态异常' });
      return;
    }

    const { to: challengedUserId, game: gameType } = data;
    const challenged = this.userManager.getUserByUserId(challengedUserId);

    if (!challenged) {
      io.to(socketId).emit('error', { message: '挑战失败：对方不在线或用户不存在' });
      return;
    }

    if (challenger.userId === challenged.userId) {
      io.to(socketId).emit('error', { message: '挑战失败：不能挑战自己' });
      return;
    }

    if (challenger.status !== 'online' || challenged.status !== 'online') {
      io.to(socketId).emit('error', { message: '挑战失败：您或对方正在游戏中或匹配中' });
      return;
    }

    if (!Object.values(config.game.types).includes(gameType)) {
      io.to(socketId).emit('error', { message: '挑战失败：无效的游戏类型' });
      return;
    }

    // 检查是否已有待处理的挑战
    if (this.challengeRequests.has(challenger.userId)) {
      io.to(socketId).emit('error', { message: '您已发起一个挑战，请等待回应' });
      return;
    }
    // 检查对方是否已发起挑战
    if (this.challengeRequests.has(challenged.userId) && this.challengeRequests.get(challenged.userId).challengedId === challenger.userId) {
      io.to(socketId).emit('error', { message: '对方已向您发起挑战，请先回应' });
      return;
    }


    // 存储挑战请求
    this.challengeRequests.set(challenger.userId, {
      challengedId: challenged.userId,
      gameType,
      timestamp: Date.now()
    });

    // 通知被挑战者
    const challengedSocket = this.userManager.getSocketByUserId(challenged.userId);
    if (challengedSocket) {
      challengedSocket.emit('challenge_received', {
        from: challenger.userId,
        fromNickname: challenger.nickname,
        game: gameType,
        timestamp: Date.now()
      });
      io.to(socketId).emit('challenge_sent', { success: true, message: `已向 ${challenged.nickname} 发起挑战` });
      logger.info('挑战请求已发送', { challenger: challenger.userId, challenged: challenged.userId, gameType });
    } else {
      io.to(socketId).emit('error', { message: '挑战失败：对方已离线' });
      this.challengeRequests.delete(challenger.userId); // 清理请求
    }
  }

  // 处理挑战响应
  handleChallengeResponse(socketId, data, io) {
    const challenged = this.userManager.getUserBySocketId(socketId);
    if (!challenged) {
      io.to(socketId).emit('error', { message: '响应失败：您的用户状态异常' });
      return;
    }

    const { from: challengerId, accept } = data;
    const challenger = this.userManager.getUserByUserId(challengerId);

    if (!challenger) {
      io.to(socketId).emit('error', { message: '响应失败：挑战者已离线' });
      return;
    }

    const challenge = this.challengeRequests.get(challenger.userId);

    if (!challenge || challenge.challengedId !== challenged.userId) {
      io.to(socketId).emit('error', { message: '响应失败：挑战请求不存在或已过期' });
      return;
    }

    // 移除挑战请求
    this.challengeRequests.delete(challenger.userId);

    if (accept) {
      // 检查双方状态是否仍然在线
      if (challenger.status !== 'online' || challenged.status !== 'online') {
        io.to(challenger.socketId).emit('error', { message: '挑战失败：您或对方已不在在线状态' });
        io.to(challenged.socketId).emit('error', { message: '挑战失败：您或对方已不在在线状态' });
        return;
      }

      // 创建游戏
      this.createGame(challenger.userId, challenged.userId, challenge.gameType, io);
      io.to(challenged.socketId).emit('challenge_accepted', { from: challenger.userId, fromNickname: challenger.nickname, game: challenge.gameType });
      io.to(challenger.socketId).emit('challenge_accepted', { to: challenged.userId, toNickname: challenged.nickname, game: challenge.gameType });
      logger.info('挑战已接受，游戏开始', { challenger: challenger.userId, challenged: challenged.userId, gameType: challenge.gameType });
    } else {
      // 通知挑战者被拒绝
      io.to(challenger.socketId).emit('challenge_rejected', {
        from: challenged.userId,
        fromNickname: challenged.nickname,
        game: challenge.gameType
      });
      io.to(challenged.socketId).emit('challenge_rejected', { success: true, message: `已拒绝 ${challenger.nickname} 的挑战` });
      logger.info('挑战已拒绝', { challenger: challenger.userId, challenged: challenged.userId, gameType: challenge.gameType });
    }
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
    if (!user) {
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

  // 处理重置确认
  handleResetConfirm(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) {
      return false;
    }

    const game = this.games.get(user.game);
    if (!game) {
      return false;
    }

    const gameId = game.gameId;

    // 重置游戏状态（支持游戏结束后重置）
    game.status = 'playing';
    game.moves = [];
    game.currentPlayer = 1;
    game.lastMoveTime = Date.now();
    game.result = null;
    game.endTime = null;
    game.endReason = null;
    game.winner = null;

    // 重置移动历史
    this.moveHistory.set(gameId, []);
    const user1 = this.userManager.getUserByUserId(game.player1);
    const user2 = this.userManager.getUserByUserId(game.player2);

    if (user1) {
      user1.status = 'playing';
    }
    if (user2) {
      user2.status = 'playing';
    }

    // 通知双方重置游戏
    const player1Socket = this.userManager.getSocketByUserId(game.player1);
    const player2Socket = this.userManager.getSocketByUserId(game.player2);

    if (player1Socket) {
      player1Socket.emit('reset');
    }
    if (player2Socket) {
      player2Socket.emit('reset');
    }

    // 重启游戏计时器
    this.startGameTimer(gameId, io);

    logger.gameEvent(game.gameId, '游戏重置', {});

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
      const duration = game.endTime - game.startTime;

      await this.userManager.updateUserStats(winner, 'win', game.gameType, false, null, duration);
      const loser = winner === game.player1 ? game.player2 : game.player1;
      await this.userManager.updateUserStats(loser, 'loss', game.gameType, false, null, duration);

      // 检查成就
      const winnerAccountId = this.userManager.userIdToAccountId.get(winner);
      if (winnerAccountId && this.accountManager) {
        const account = await this.accountManager.getAccount(winnerAccountId);
        if (account) {
          const stats = {
            ...account.stats,
            level: account.profile ? account.profile.level : 1,
            result: 'win'
          };
          const unlockedAchievements = await this.achievementManager.checkAchievements(winnerAccountId, stats);
          if (unlockedAchievements.length > 0) {
            const socket = this.userManager.getSocketByUserId(winner);
            if (socket) {
              socket.emit('achievements_unlocked', { achievements: unlockedAchievements });
            }
          }
        }
      }
    } else if (result === 'draw') {
      const duration = game.endTime - game.startTime;

      await this.userManager.updateUserStats(game.player1, 'draw', game.gameType, false, null, duration);
      await this.userManager.updateUserStats(game.player2, 'draw', game.gameType, false, null, duration);
    } else if (result === 'timeout') {
      // 超时判负
      await this.userManager.updateUserStats(game.player1, 'loss', game.gameType);
      await this.userManager.updateUserStats(game.player2, 'loss', game.gameType);
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

    // 暂时不更新用户状态，让用户可以选择"再来一把"
    // 用户状态和游戏关联将在返回大厅或确认再来一局时更新

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

  // 管理员强制重置游戏
  adminResetGame(gameId, io) {
    const game = this.games.get(gameId);
    if (!game) {
      return false;
    }

    const player1Socket = this.userManager.getSocketByUserId(game.player1);
    const player2Socket = this.userManager.getSocketByUserId(game.player2);

    if (player1Socket) {
      player1Socket.emit('game_reset', {
        message: '游戏已被管理员重置'
      });
    }
    if (player2Socket) {
      player2Socket.emit('game_reset', {
        message: '游戏已被管理员重置'
      });
    }

    this.broadcastToSpectators(gameId, 'game_reset', {
      message: '游戏已被管理员重置'
    }, io);

    this.games.delete(gameId);
    this.spectators.delete(gameId);

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

    return true;
  }

  // ========== AI对战功能 ==========

  // 创建AI对战游戏
  createAIGame(userId, gameType, difficulty, io) {
    if (!this.aiManager) {
      logger.warn('AI对战功能未启用：AIManager未初始化');
      return false;
    }

    const user = this.userManager.getUserByUserId(userId);
    if (!user) {
      logger.warn('创建AI对战失败：用户不存在', { userId });
      return false;
    }

    // 验证游戏类型
    if (!Object.values(config.game.types).includes(gameType)) {
      logger.warn('创建AI对战失败：无效的游戏类型', { userId, gameType });
      return false;
    }

    // 验证难度
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      logger.warn('创建AI对战失败：无效的难度', { userId, difficulty });
      return false;
    }

    // 初始化棋盘
    const board = this.initializeBoard(gameType);

    // 创建AI游戏对象
    const aiGame = {
      userId: userId,
      gameType: gameType,
      difficulty: difficulty,
      board: board,
      currentPlayer: 1, // 玩家先手
      moves: [],
      status: 'playing',
      startTime: Date.now(),
      lastMoveTime: Date.now()
    };

    // 保存AI游戏
    this.aiGames.set(userId, aiGame);

    // 更新用户状态
    user.status = 'playing';
    user.game = 'ai';
    this.userManager.broadcastUserStatus(userId, 'playing', io);

    logger.aiGameEvent(userId, '开始AI对战', { gameType, difficulty });

    // 发送游戏开始信息
    const userSocket = this.userManager.getSocketByUserId(userId);
    if (userSocket) {
      userSocket.emit('ai_game_start', {
        gameType: gameType,
        difficulty: difficulty,
        board: board,
        currentPlayer: 1
      });
    }

    return true;
  }

  // 处理AI对战移动
  handleAIMove(userId, position, io) {
    const aiGame = this.aiGames.get(userId);
    if (!aiGame || aiGame.status !== 'playing') {
      return false;
    }

    // 验证是否是玩家回合
    if (aiGame.currentPlayer !== 1) {
      return false;
    }

    // 验证移动是否有效
    if (!this.isValidMove(aiGame.gameType, aiGame.board, position, aiGame.currentPlayer)) {
      return false;
    }

    // 执行玩家移动
    this.executeMove(aiGame.gameType, aiGame.board, position, aiGame.currentPlayer);

    // 记录移动
    const move = {
      player: userId,
      color: aiGame.currentPlayer,
      position: position,
      timestamp: Date.now()
    };
    aiGame.moves.push(move);
    aiGame.lastMoveTime = Date.now();

    // 检查游戏是否结束
    const gameOver = this.checkGameOver(aiGame.gameType, aiGame.board, aiGame.currentPlayer);
    if (gameOver) {
      this.endAIGame(userId, 'win', io);
      return true;
    }

    // 切换到AI回合
    aiGame.currentPlayer = 2;

    // 发送移动结果
    const userSocket = this.userManager.getSocketByUserId(userId);
    if (userSocket) {
      userSocket.emit('ai_move_result', {
        position: position,
        color: 1,
        currentPlayer: 2
      });
    }

    // AI思考并移动
    setTimeout(() => {
      this.handleAIAutoMove(userId, io);
    }, 500);

    return true;
  }

  // AI自动移动
  handleAIAutoMove(userId, io) {
    const aiGame = this.aiGames.get(userId);
    if (!aiGame || aiGame.status !== 'playing' || aiGame.currentPlayer !== 2) {
      return;
    }

    // 获取AI移动
    const aiMove = this.aiManager.getAIMove(
      aiGame.gameType,
      aiGame.board,
      aiGame.difficulty,
      aiGame.currentPlayer
    );

    if (!aiMove) {
      logger.warn('AI移动失败：无法生成有效移动', { userId, gameType: aiGame.gameType });
      return;
    }

    // 执行AI移动
    this.executeMove(aiGame.gameType, aiGame.board, aiMove, aiGame.currentPlayer);

    // 记录移动
    const move = {
      player: 'ai',
      color: aiGame.currentPlayer,
      position: aiMove,
      timestamp: Date.now()
    };
    aiGame.moves.push(move);
    aiGame.lastMoveTime = Date.now();

    // 检查游戏是否结束
    const gameOver = this.checkGameOver(aiGame.gameType, aiGame.board, aiGame.currentPlayer);
    if (gameOver) {
      this.endAIGame(userId, 'loss', io);
      return;
    }

    // 切换回玩家回合
    aiGame.currentPlayer = 1;

    // 发送AI移动结果
    const userSocket = this.userManager.getSocketByUserId(userId);
    if (userSocket) {
      userSocket.emit('ai_move_result', {
        position: aiMove,
        color: 2,
        currentPlayer: 1
      });
    }
  }

  // 结束AI对战
  endAIGame(userId, result, io) {
    const aiGame = this.aiGames.get(userId);
    if (!aiGame) return;

    aiGame.status = 'finished';
    aiGame.endTime = Date.now();
    aiGame.duration = aiGame.endTime - aiGame.startTime;
    aiGame.result = result;

    // 更新用户状态
    const user = this.userManager.getUserByUserId(userId);
    if (user) {
      user.status = 'online';
      user.game = null;
      this.userManager.broadcastUserStatus(userId, 'online', io);
    }

    // 发送游戏结束信息
    const userSocket = this.userManager.getSocketByUserId(userId);
    if (userSocket) {
      userSocket.emit('ai_game_end', {
        result: result,
        moves: aiGame.moves,
        duration: aiGame.duration
      });
    }

    logger.aiGameEvent(userId, 'AI对战结束', {
      gameType: aiGame.gameType,
      difficulty: aiGame.difficulty,
      result: result,
      duration: aiGame.duration
    });

    // 清理AI游戏
    setTimeout(() => {
      this.aiGames.delete(userId);
    }, 5000);
  }

  // 初始化棋盘
  initializeBoard(gameType) {
    switch (gameType) {
      case 'gobang':
        return this.initializeGobangBoard();
      case 'go':
        return this.initializeGoBoard();
      case 'chess':
        return this.initializeChessBoard();
      default:
        return null;
    }
  }

  // 初始化五子棋棋盘
  initializeGobangBoard() {
    const board = [];
    for (let i = 0; i < 15; i++) {
      board.push(Array(15).fill(0));
    }
    return board;
  }

  // 初始化围棋棋盘
  initializeGoBoard() {
    const board = [];
    for (let i = 0; i < 19; i++) {
      board.push(Array(19).fill(0));
    }
    return board;
  }

  // 初始化象棋棋盘
  initializeChessBoard() {
    // 简化实现，返回空棋盘
    const board = [];
    for (let i = 0; i < 10; i++) {
      board.push(Array(9).fill(0));
    }
    return board;
  }

  // 验证移动是否有效
  isValidMove(gameType, board, position, player) {
    switch (gameType) {
      case 'gobang':
        return this.isValidGobangMove(board, position);
      case 'go':
        return this.isValidGoMove(board, position);
      case 'chess':
        return this.isValidChessMove(board, position, player);
      default:
        return false;
    }
  }

  // 验证五子棋移动
  isValidGobangMove(board, position) {
    const { r, c } = position;
    return r >= 0 && r < board.length && c >= 0 && c < board[0].length && board[r][c] === 0;
  }

  // 验证围棋移动
  isValidGoMove(board, position) {
    const { r, c } = position;
    return r >= 0 && r < board.length && c >= 0 && c < board[0].length && board[r][c] === 0;
  }

  // 验证象棋移动
  isValidChessMove(board, position, player) {
    // 简化实现，总是返回true
    return true;
  }

  // 执行移动
  executeMove(gameType, board, position, player) {
    switch (gameType) {
      case 'gobang':
        this.executeGobangMove(board, position, player);
        break;
      case 'go':
        this.executeGoMove(board, position, player);
        break;
      case 'chess':
        this.executeChessMove(board, position, player);
        break;
    }
  }

  // 执行五子棋移动
  executeGobangMove(board, position, player) {
    const { r, c } = position;
    board[r][c] = player;
  }

  // 执行围棋移动
  executeGoMove(board, position, player) {
    const { r, c } = position;
    board[r][c] = player;
  }

  // 执行象棋移动
  executeChessMove(board, position, player) {
    // 简化实现
    const { fromR, fromC, toR, toC } = position;
    board[toR][toC] = board[fromR][fromC];
    board[fromR][fromC] = 0;
  }

  // 检查游戏是否结束
  checkGameOver(gameType, board, player) {
    switch (gameType) {
      case 'gobang':
        return this.checkGobangWin(board, player);
      case 'go':
        return this.checkGoWin(board, player);
      case 'chess':
        return this.checkChessWin(board, player);
      default:
        return false;
    }
  }

  // 检查五子棋胜利
  checkGobangWin(board, player) {
    // 简化实现，检查是否有五子连珠
    const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] === player) {
          for (const [dr, dc] of directions) {
            let count = 1;
            for (let i = 1; i < 5; i++) {
              const nr = r + dr * i;
              const nc = c + dc * i;
              if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length && board[nr][nc] === player) {
                count++;
              } else {
                break;
              }
            }
            if (count >= 5) return true;
          }
        }
      }
    }
    return false;
  }

  // 检查围棋胜利
  checkGoWin(board, player) {
    // 简化实现，总是返回false
    return false;
  }

  // 检查象棋胜利
  checkChessWin(board, player) {
    // 简化实现，总是返回false
    return false;
  }
}

module.exports = GameManager;
