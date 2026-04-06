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
  generateGameId(gameType) {
    const date = new Date();
    // 使用本地时间生成文件名
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const readableTime = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;
    const randomId = Math.random().toString(36).substr(2, 9);
    return `${gameType}_${readableTime}_${randomId}`;
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
    const gameId = this.generateGameId(gameType);
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
      position: data.position || { r: data.r, c: data.c },
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
      position: move.position,
      isPlayer1: isPlayer1,
      isPlayer2: isPlayer2,
      gamePlayer1: game.player1,
      gamePlayer2: game.player2
    });

    // 发送给对手（不发送给自己）
    const opponentId = isPlayer1 ? game.player2 : game.player1;
    const opponentSocket = this.userManager.getSocketByUserId(opponentId);
    logger.info('发送移动消息', {
      from: user.userId,
      to: opponentId,
      hasOpponentSocket: !!opponentSocket
    });
    if (opponentSocket) {
      opponentSocket.emit('move', {
        ...data,
        from: user.userId,
        color: move.color
      });
    }

    // 发送给观战者（不发送给玩家自己）
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

    // 检查是否已有待处理的请求
    if (game.pendingResetRequest) {
      const userSocket = this.userManager.getSocketByUserId(user.userId);
      if (userSocket) {
        userSocket.emit('reset_request_pending', {
          message: '已有重置请求待处理，请等待对方回应'
        });
      }
      return false;
    }

    // 转发给对手
    const opponentId = game.player1 === user.userId ? game.player2 : game.player1;
    const opponentSocket = this.userManager.getSocketByUserId(opponentId);

    if (opponentSocket) {
      // 设置重置请求信息
      game.pendingResetRequest = {
        requesterId: user.userId,
        requestTime: Date.now(),
        message: (data && data.message) ? data.message : '对方请求重置棋盘'
      };

      // 记录重置请求
      logger.gameEvent(game.gameId, '重置请求', {
        requester: user.userId,
        opponent: opponentId,
        message: (data && data.message) ? data.message : '对方请求重置棋盘'
      });

      opponentSocket.emit('reset_request', {
        from: user.userId,
        fromNickname: user.nickname,
        message: (data && data.message) ? data.message : '对方请求重置棋盘',
        requestId: game.pendingResetRequest.requestTime
      });

      // 设置超时（30秒后自动取消）
      game.resetTimeout = setTimeout(() => {
        if (game.pendingResetRequest) {
          const requesterSocket = this.userManager.getSocketByUserId(game.pendingResetRequest.requesterId);
          if (requesterSocket) {
            requesterSocket.emit('reset_request_timeout', {
              message: '重置请求超时，对方未回应'
            });
          }
          delete game.pendingResetRequest;
          delete game.resetTimeout;
        }
      }, 30000);

      return true;
    }

    return false;
  }

  // 处理重置确认
  handleResetConfirm(socketId, io, requestId = null) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) {
      return false;
    }

    const game = this.games.get(user.game);
    if (!game) {
      return false;
    }

    // 检查是否有待处理的请求
    if (!game.pendingResetRequest) {
      const userSocket = this.userManager.getSocketByUserId(user.userId);
      if (userSocket) {
        userSocket.emit('reset_request_invalid', {
          message: '没有待处理的重置请求'
        });
      }
      return false;
    }

    // 验证请求ID（如果提供）
    if (requestId && game.pendingResetRequest.requestTime !== requestId) {
      const userSocket = this.userManager.getSocketByUserId(user.userId);
      if (userSocket) {
        userSocket.emit('reset_request_invalid', {
          message: '重置请求已过期'
        });
      }
      return false;
    }

    // 清理超时计时器
    if (game.resetTimeout) {
      clearTimeout(game.resetTimeout);
      delete game.resetTimeout;
    }

    const gameId = game.gameId;
    const requesterId = game.pendingResetRequest.requesterId;

    // 重置游戏状态（支持游戏结束后重置）
    game.status = 'playing';
    game.moves = [];
    game.currentPlayer = 1;
    game.lastMoveTime = Date.now();
    game.result = null;
    game.endTime = null;
    game.endReason = null;
    game.winner = null;

    // 清理重置请求信息
    delete game.pendingResetRequest;

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
      player1Socket.emit('reset', {
        message: '游戏已重置，重新开始'
      });
    }
    if (player2Socket) {
      player2Socket.emit('reset', {
        message: '游戏已重置，重新开始'
      });
    }

    // 通知请求者重置成功
    const requesterSocket = this.userManager.getSocketByUserId(requesterId);
    if (requesterSocket) {
      requesterSocket.emit('reset_accepted', {
        message: '对方已同意重置游戏'
      });
    }

    // 重启游戏计时器
    this.startGameTimer(gameId, io);

    logger.gameEvent(game.gameId, '游戏重置', {
      requester: requesterId,
      responder: user.userId
    });

    return true;
  }

  // 处理重置拒绝
  handleResetReject(socketId, io, requestId = null) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) {
      return false;
    }

    const game = this.games.get(user.game);
    if (!game) {
      return false;
    }

    // 检查是否有待处理的请求
    if (!game.pendingResetRequest) {
      const userSocket = this.userManager.getSocketByUserId(user.userId);
      if (userSocket) {
        userSocket.emit('reset_request_invalid', {
          message: '没有待处理的重置请求'
        });
      }
      return false;
    }

    // 验证请求ID（如果提供）
    if (requestId && game.pendingResetRequest.requestTime !== requestId) {
      const userSocket = this.userManager.getSocketByUserId(user.userId);
      if (userSocket) {
        userSocket.emit('reset_request_invalid', {
          message: '重置请求已过期'
        });
      }
      return false;
    }

    // 清理超时计时器
    if (game.resetTimeout) {
      clearTimeout(game.resetTimeout);
      delete game.resetTimeout;
    }

    const requesterId = game.pendingResetRequest.requesterId;

    // 通知请求者重置被拒绝
    const requesterSocket = this.userManager.getSocketByUserId(requesterId);
    if (requesterSocket) {
      requesterSocket.emit('reset_rejected', {
        from: user.userId,
        fromNickname: user.nickname,
        message: '对方拒绝了重置请求'
      });
    }

    // 清理重置请求信息
    delete game.pendingResetRequest;

    logger.gameEvent(game.gameId, '重置请求被拒绝', {
      requester: requesterId,
      rejecter: user.userId
    });

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
    if (!game) {
      logger.warn('结束游戏失败：游戏不存在', { gameId });
      return false;
    }

    if (game.status !== 'playing') {
      logger.warn('结束游戏失败：游戏状态不正确', { gameId, status: game.status });
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
    try {
      if (result === 'win' || result === 'resign') {
        const duration = game.endTime - game.startTime;

        await this.userManager.updateUserStats(winner, 'win', game.gameType, false, null, duration);
        const loser = winner === game.player1 ? game.player2 : game.player1;
        await this.userManager.updateUserStats(loser, 'loss', game.gameType, false, null, duration);
      } else if (result === 'draw') {
        const duration = game.endTime - game.startTime;

        await this.userManager.updateUserStats(game.player1, 'draw', game.gameType, false, null, duration);
        await this.userManager.updateUserStats(game.player2, 'draw', game.gameType, false, null, duration);
      } else if (result === 'timeout') {
        // 超时判负
        await this.userManager.updateUserStats(game.player1, 'loss', game.gameType);
        await this.userManager.updateUserStats(game.player2, 'loss', game.gameType);
      } else if (result === 'invalid') {
        // 无效游戏，不更新统计
        logger.gameEvent(gameId, '无效游戏，不更新统计', {
          reason: reason,
          moveCount: game.moves ? game.moves.length : 0,
          duration: game.endTime - game.startTime
        });
      }
    } catch (err) {
      logger.error('更新用户统计失败', { gameId, error: err.message });
    }

    // 为所有玩家检查成就
    try {
      const players = [game.player1, game.player2];
      for (const player of players) {
        const accountId = this.userManager.userIdToAccountId.get(player);
        if (accountId && this.accountManager) {
          const account = await this.accountManager.getAccount(accountId);
          if (account) {
            const isWinner = player === winner;
            const playerResult = isWinner ? 'win' : (result === 'draw' ? 'draw' : 'loss');
            const gameDuration = game.endTime - game.startTime;
            const playerChatted = game.playerChatted && game.playerChatted[player];
            let level = 1;
            if (account.profile && account.profile.exp) {
              const totalExp = account.profile.exp;
              let exp = totalExp;
              while (exp >= this.accountManager.getExpForLevel(level + 1)) {
                exp -= this.accountManager.getExpForLevel(level + 1);
                level++;
              }
            }

            const stats = {
              ...account.stats,
              level: level,
              result: playerResult,
              silentWin: isWinner && !playerChatted,
              quickGame: gameDuration <= 5 * 60 * 1000,
              slowGame: gameDuration >= 60 * 60 * 1000,
              maxMoves: game.moves ? game.moves.length : 0
            };
            const unlockedAchievements = await this.achievementManager.checkAchievements(accountId, stats);
            if (unlockedAchievements.length > 0) {
              const socket = this.userManager.getSocketByUserId(player);
              if (socket) {
                socket.emit('achievements_unlocked', { achievements: unlockedAchievements });
              }
            }
          }
        }
      }
    } catch (err) {
      logger.error('检查成就失败', { gameId, error: err.message });
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
      // 基础记录结构
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

      // 根据游戏类型添加独特字段
      switch (game.gameType) {
        case 'gobang':
        case 'chess':
        case 'go':
          // 棋类游戏特有字段
          record.boardSize = game.boardSize || 15; // 棋盘大小
          record.gameMode = game.gameMode || 'pvp'; // 游戏模式：pvp或ai
          record.difficulty = game.difficulty || 'normal'; // AI难度（如果是AI对战）
          record.winReason = game.winReason || 'normal'; // 获胜原因
          break;
        case 'snake':
          // 贪吃蛇游戏特有字段（在saveSnakeGameRecord中处理）
          break;
      }

      await dataStore.add('games', record);
      logger.info('游戏记录已保存', { gameId: game.gameId, gameType: game.gameType });
    } catch (err) {
      logger.error('保存游戏记录失败', { gameId: game.gameId, error: err.message });
    }
  }

  // 保存贪吃蛇游戏记录
  async saveSnakeGameRecord(data) {
    try {
      const record = {
        gameId: this.generateGameId('snake'),
        gameType: 'snake',
        player1: data.userId,
        player2: 'computer', // 贪吃蛇是单人游戏
        player1Nickname: '玩家',
        player2Nickname: '电脑',
        winner: data.score > 0 ? data.userId : 'computer',
        result: data.score > 0 ? 'win' : 'end',
        moves: data.moveHistory,
        score: data.score,
        maxLength: data.maxLength || 0, // 蛇的最大长度
        foodEaten: data.foodEaten || 0, // 吃到的食物数量
        gameMode: 'single', // 游戏模式：single
        startTime: data.startTime,
        endTime: data.endTime,
        duration: data.endTime - data.startTime,
        savedAt: Date.now()
      };

      await dataStore.add('games', record);
      logger.info('贪吃蛇游戏记录已保存', { gameId: record.gameId, score: data.score, maxLength: record.maxLength });
    } catch (err) {
      logger.error('保存贪吃蛇游戏记录失败', { error: err.message });
    }
  }

  // 处理返回大厅
  handleReturnLobby(socketId, io, reason = '主动返回') {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) {
      logger.warn('返回大厅失败：用户不存在', { socketId });
      return false;
    }

    logger.info('用户返回大厅', {
      userId: user.userId,
      userStatus: user.status,
      userGame: user.game,
      reason: reason
    });

    let gameEnded = false;
    let gameResult = null;
    let winnerId = null;

    // 如果在等待队列中，先移除
    if (user.status === 'waiting') {
      this.handleCancelMatch(socketId, io);
    }

    // 如果在游戏中，结束游戏
    if (user.status === 'playing' && user.game) {
      logger.info('用户正在游戏中，准备结束游戏', { userId: user.userId, gameId: user.game });
      const game = this.games.get(user.game);
      logger.info('检查游戏状态', {
        userId: user.userId,
        gameId: user.game,
        gameExists: !!game,
        gameStatus: game ? game.status : 'no game'
      });
      if (game && game.status === 'playing') {
        const opponentId = game.player1 === user.userId ? game.player2 : game.player1;
        const opponent = this.userManager.getUserByUserId(opponentId);

        // 根据游戏进度决定结算方式
        const gameDuration = Date.now() - game.startTime;
        const moveCount = game.moves.length;

        // 非正常结算逻辑
        if (moveCount < 5 && gameDuration < 60000) {
          // 游戏刚开始不久，判定为无效游戏
          gameResult = 'invalid';
          winnerId = null;
          reason = '游戏刚开始，判定为无效游戏';
        } else if (moveCount < 10 && gameDuration < 120000) {
          // 游戏进行中但时间较短，判定为平局
          gameResult = 'draw';
          winnerId = null;
          reason = '游戏进行中，判定为平局';
        } else {
          // 正常游戏，对方获胜
          gameResult = 'resign';
          winnerId = opponentId;
          reason = '玩家离开游戏';
        }

        // 通知对手
        const opponentSocket = this.userManager.getSocketByUserId(opponentId);
        if (opponentSocket) {
          // 发送即时通知
          opponentSocket.emit('opponent_left', {
            userId: user.userId,
            nickname: user.nickname,
            reason: reason,
            result: gameResult,
            winner: winnerId,
            moveCount: moveCount,
            gameDuration: gameDuration
          });

          // 发送游戏结束通知
          opponentSocket.emit('game_ended', {
            result: gameResult,
            winner: winnerId,
            reason: reason,
            opponentLeft: true,
            leaverNickname: user.nickname,
            moveCount: moveCount,
            gameDuration: gameDuration
          });

          // 发送广播消息
          opponentSocket.emit('game_message', {
            type: 'opponent_left',
            message: `${user.nickname} 已离开游戏，${reason}`,
            timestamp: Date.now()
          });
        }

        // 结束游戏
        this.endGame(game.gameId, gameResult, io, winnerId, reason);
        gameEnded = true;

        // 记录非正常结算
        logger.gameEvent(game.gameId, '非正常结算', {
          leaver: user.userId,
          opponent: opponentId,
          result: gameResult,
          reason: reason,
          moveCount: moveCount,
          duration: gameDuration
        });
      }
    }

    // 更新用户状态（必须在游戏结束逻辑之后）
    user.status = 'online';
    user.game = null;
    user.lastActivity = Date.now();

    // 通知用户返回大厅结果
    const userSocket = this.userManager.getSocketByUserId(user.userId);
    if (userSocket) {
      userSocket.emit('return_lobby_result', {
        success: true,
        gameEnded: gameEnded,
        result: gameResult,
        reason: reason
      });
    }

    logger.userAction(user.userId, '返回大厅', {
      reason: reason,
      gameEnded: gameEnded,
      result: gameResult
    });

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
        // 不发送给落子玩家自己
        if (data.from === userId) {
          continue;
        }
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
          result: game.gameType === 'snake' ? game.result : (game.winner === userId ? 'win' : game.winner === null ? 'draw' : 'loss'),
          moves: game.moves?.length || 0,
          date: game.endTime,
          duration: game.duration
        }));
    } catch (err) {
      logger.error('获取游戏历史失败', { userId, error: err.message });
      return [];
    }
  }

  // 获取完整游戏记录（用于回放）
  async getGameReplay(gameId) {
    try {
      const games = await dataStore.read('games');
      const game = games.find(g => g.gameId === gameId);

      if (!game) {
        return null;
      }

      return {
        gameId: game.gameId,
        gameType: game.gameType,
        player1: {
          id: game.player1,
          nickname: game.player1Nickname
        },
        player2: {
          id: game.player2,
          nickname: game.player2Nickname
        },
        winner: game.winner,
        result: game.result,
        moves: game.moves || [],
        startTime: game.startTime,
        endTime: game.endTime,
        duration: game.duration
      };
    } catch (err) {
      logger.error('获取游戏回放失败', { gameId, error: err.message });
      return null;
    }
  }

  // 获取所有游戏
  getAllGames() {
    const pvpGames = Array.from(this.games.values()).map(game => {
      const user1 = this.userManager.getUserByUserId(game.player1);
      const user2 = this.userManager.getUserByUserId(game.player2);
      return {
        gameId: game.gameId,
        gameType: game.gameType,
        player1: user1 ? { nickname: user1.nickname, userId: user1.userId } : { nickname: game.player1Nickname, userId: game.player1 },
        player2: user2 ? { nickname: user2.nickname, userId: user2.userId } : { nickname: game.player2Nickname, userId: game.player2 },
        status: game.status,
        moveCount: game.moves.length,
        startTime: game.startTime,
        spectatorCount: this.spectators.get(game.gameId)?.size || 0
      };
    });

    // 添加AI对战游戏
    const aiGames = Array.from(this.aiGames.values()).map(aiGame => {
      const user = this.userManager.getUserByUserId(aiGame.userId);
      return {
        gameId: aiGame.gameId,
        gameType: aiGame.gameType,
        player1: user ? { nickname: user.nickname, userId: user.userId } : null,
        player2: { nickname: 'AI', userId: 'ai' },
        status: aiGame.status === 'finished' ? 'ended' : aiGame.status,
        moveCount: aiGame.moves.length,
        startTime: aiGame.startTime,
        spectatorCount: 0
      };
    });

    return [...pvpGames, ...aiGames];
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
    // 先尝试结束普通游戏
    const game = this.games.get(gameId);
    if (game && game.status === 'playing') {
      this.endGame(gameId, 'admin', io, null, '管理员结束游戏');
      return true;
    }

    // 尝试结束AI游戏
    for (const [userId, aiGame] of this.aiGames.entries()) {
      if (aiGame.gameId === gameId && aiGame.status === 'playing') {
        this.endAIGame(userId, 'loss', io);
        logger.info('管理员结束AI游戏', { gameId, userId });
        return true;
      }
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

    // 如果存在旧游戏，先删除
    const existingGame = this.aiGames.get(userId);
    if (existingGame) {
      logger.info('删除已存在的AI游戏', { userId, status: existingGame.status });
      this.aiGames.delete(userId);
    }

    // 初始化棋盘
    const board = this.initializeBoard(gameType);

    // 创建AI游戏对象
    const aiGame = {
      gameId: this.generateGameId(gameType),
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
    user.lastActivity = Date.now();
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
  async handleAIMove(userId, position, io) {
    logger.info('🎯 AI对战收到移动', { userId, position, gameType: this.aiGames.get(userId)?.gameType });

    const aiGame = this.aiGames.get(userId);
    if (!aiGame || aiGame.status !== 'playing') {
      logger.warn('❌ AI对战移动失败：游戏不存在或不在进行中', { userId, game: !!aiGame, status: aiGame?.status });
      return false;
    }

    // 获取用户信息
    const user = this.userManager.getUserByUserId(userId);
    if (!user) {
      logger.warn('❌ AI对战移动失败：用户不存在', { userId });
      return false;
    }

    // 验证是否是玩家回合
    if (aiGame.currentPlayer !== 1) {
      logger.warn('❌ AI对战移动失败：不是玩家回合', { userId, currentPlayer: aiGame.currentPlayer });
      return false;
    }

    // 验证移动是否有效
    logger.info('🔍 验证移动有效性', { gameType: aiGame.gameType, position, boardSize: aiGame.board.length });
    if (!this.isValidMove(aiGame.gameType, aiGame.board, position, aiGame.currentPlayer)) {
      logger.warn('❌ AI对战移动失败：无效的移动', { userId, position, gameType: aiGame.gameType });
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

    // 更新用户活动时间
    user.lastActivity = Date.now();

    // 检查游戏是否结束
    const gameOver = this.checkGameOver(aiGame.gameType, aiGame.board, aiGame.currentPlayer);
    if (gameOver) {
      await this.endAIGame(userId, 'win', io);
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

    // AI思考并移动，根据难度设置不同的思考时间
    const thinkTime = aiGame.difficulty === 'easy' ? 800 :
      aiGame.difficulty === 'medium' ? 1500 : 2500;
    setTimeout(() => {
      this.handleAIAutoMove(userId, io);
    }, thinkTime);

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

    // 更新用户活动时间
    const user = this.userManager.getUserByUserId(userId);
    if (user) {
      user.lastActivity = Date.now();
    }

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
  async endAIGame(userId, result, io) {
    const aiGame = this.aiGames.get(userId);
    if (!aiGame) return;

    // 如果游戏已经结束，直接返回，避免重复保存
    if (aiGame.status === 'finished') return;

    aiGame.status = 'finished';
    aiGame.endTime = Date.now();
    aiGame.duration = aiGame.endTime - aiGame.startTime;
    aiGame.result = result;

    // 获取用户信息
    const user = this.userManager.getUserByUserId(userId);
    if (!user) return;

    // 保存AI游戏记录到 games.json
    try {
      const gameId = this.generateGameId(aiGame.gameType);
      // 基础记录结构
      const record = {
        id: gameId,
        gameId: gameId,
        gameType: aiGame.gameType,
        player1: userId,
        player2: 'ai',
        player1Nickname: user.nickname || user.userId,
        player2Nickname: 'AI',
        winner: result === 'win' ? userId : 'ai',
        result: result,
        moves: aiGame.moves,
        startTime: aiGame.startTime,
        endTime: aiGame.endTime,
        duration: aiGame.duration,
        savedAt: Date.now()
      };

      // 根据游戏类型添加独特字段
      switch (aiGame.gameType) {
        case 'gobang':
        case 'chess':
        case 'go':
          // 棋类游戏特有字段
          record.boardSize = aiGame.boardSize || 15; // 棋盘大小
          record.gameMode = 'ai'; // 游戏模式：ai
          record.difficulty = aiGame.difficulty || 'normal'; // AI难度
          record.winReason = result === 'win' ? 'player_win' : 'ai_win'; // 获胜原因
          break;
        case 'snake':
          // 贪吃蛇游戏特有字段
          record.score = aiGame.score || 0; // 游戏得分
          record.maxLength = aiGame.maxLength || 0; // 蛇的最大长度
          record.foodEaten = aiGame.foodEaten || 0; // 吃到的食物数量
          break;
      }

      await dataStore.add('games', record);
      logger.info('AI游戏记录已保存', { userId, gameType: aiGame.gameType, result });
    } catch (err) {
      logger.error('保存AI游戏记录失败', { userId, error: err.message });
    }

    // 更新用户状态
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

    // 更新用户统计
    await this.userManager.updateUserStats(userId, result, aiGame.gameType, true, aiGame.difficulty, aiGame.duration);

    // 检查成就
    const accountId = this.userManager.userIdToAccountId.get(userId);
    if (accountId && this.accountManager && this.achievementManager) {
      const account = await this.accountManager.getAccount(accountId);
      if (account) {
        const playerChatted = aiGame.playerChatted && aiGame.playerChatted[userId];
        let level = 1;
        if (account.profile && account.profile.exp) {
          const totalExp = account.profile.exp;
          let exp = totalExp;
          while (exp >= this.accountManager.getExpForLevel(level + 1)) {
            exp -= this.accountManager.getExpForLevel(level + 1);
            level++;
          }
        }

        const stats = {
          ...account.stats,
          level: level,
          result: result,
          aiDifficulty: aiGame.difficulty,
          aiResult: result,
          silentWin: result === 'win' && !playerChatted,
          quickGame: aiGame.duration <= 5 * 60 * 1000,
          slowGame: aiGame.duration >= 60 * 60 * 1000,
          maxMoves: aiGame.moves ? aiGame.moves.length : 0
        };
        const unlockedAchievements = await this.achievementManager.checkAchievements(accountId, stats);
        if (unlockedAchievements.length > 0 && userSocket) {
          userSocket.emit('achievements_unlocked', { achievements: unlockedAchievements });
        }
      }
    }

    logger.aiGameEvent(userId, 'AI对战结束', {
      gameType: aiGame.gameType,
      difficulty: aiGame.difficulty,
      result: result,
      duration: aiGame.duration
    });

    // 清理AI游戏 - 使用游戏开始时间作为标识，确保不会误删新游戏
    const gameStartTime = aiGame.startTime;
    setTimeout(() => {
      const currentGame = this.aiGames.get(userId);
      // 只有当游戏仍然存在且是同一个游戏时才删除
      if (currentGame && currentGame.startTime === gameStartTime) {
        this.aiGames.delete(userId);
        logger.info('清理已结束的AI游戏', { userId, gameStartTime });
      }
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
    for (let i = 0; i < 19; i++) {
      board.push(Array(19).fill(0));
    }
    return board;
  }

  // 初始化围棋棋盘
  initializeGoBoard() {
    const board = [];
    for (let i = 0; i < 21; i++) {
      board.push(Array(21).fill(0));
    }
    return board;
  }

  // 初始化象棋棋盘
  initializeChessBoard() {
    const board = Array(10).fill().map(() => Array(9).fill(0));

    // 初始化红方棋子
    board[9][0] = 'r-ju';    // 车
    board[9][1] = 'r-ma';    // 马
    board[9][2] = 'r-xiang'; // 相
    board[9][3] = 'r-shi';   // 仕
    board[9][4] = 'r-shuai'; // 帅
    board[9][5] = 'r-shi';   // 仕
    board[9][6] = 'r-xiang'; // 相
    board[9][7] = 'r-ma';    // 马
    board[9][8] = 'r-ju';    // 车
    board[7][1] = 'r-pao';   // 炮
    board[7][7] = 'r-pao';   // 炮
    board[6][0] = 'r-bing';  // 兵
    board[6][2] = 'r-bing';  // 兵
    board[6][4] = 'r-bing';  // 兵
    board[6][6] = 'r-bing';  // 兵
    board[6][8] = 'r-bing';  // 兵

    // 初始化黑方棋子
    board[0][0] = 'b-ju';    // 车
    board[0][1] = 'b-ma';    // 马
    board[0][2] = 'b-xiang'; // 象
    board[0][3] = 'b-shi';   // 士
    board[0][4] = 'b-jiang'; // 将
    board[0][5] = 'b-shi';   // 士
    board[0][6] = 'b-xiang'; // 象
    board[0][7] = 'b-ma';    // 马
    board[0][8] = 'b-ju';    // 车
    board[2][1] = 'b-pao';   // 炮
    board[2][7] = 'b-pao';   // 炮
    board[3][0] = 'b-zu';    // 卒
    board[3][2] = 'b-zu';    // 卒
    board[3][4] = 'b-zu';    // 卒
    board[3][6] = 'b-zu';    // 卒
    board[3][8] = 'b-zu';    // 卒

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
    logger.info('🔍 验证五子棋移动', { r, c, boardLength: board.length, board0Length: board[0]?.length, cellValue: board[r]?.[c] });
    const isValid = r >= 0 && r < board.length && c >= 0 && c < board[0].length && board[r][c] === 0;
    logger.info('✅ 五子棋移动验证结果', { isValid });
    return isValid;
  }

  // 验证围棋移动
  isValidGoMove(board, position) {
    const { r, c } = position;
    logger.info('🔍 验证围棋移动', { r, c, boardLength: board.length, board0Length: board[0]?.length, cellValue: board[r]?.[c] });
    const isValid = r >= 0 && r < board.length && c >= 0 && c < board[0].length && board[r][c] === 0;
    logger.info('✅ 围棋移动验证结果', { isValid });
    return isValid;
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
    // 检查是否将帅被吃
    let redGeneralExists = false;
    let blackGeneralExists = false;

    for (let r = 0; r < board.length; r++) {
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] === 'r-shuai') {
          redGeneralExists = true;
        } else if (board[r][c] === 'b-jiang') {
          blackGeneralExists = true;
        }
      }
    }

    if (!redGeneralExists) {
      // 红方帅被吃，黑方获胜
      return player === 2 ? 'win' : 'loss';
    }

    if (!blackGeneralExists) {
      // 黑方将被吃，红方获胜
      return player === 1 ? 'win' : 'loss';
    }

    return false;
  }
}

module.exports = GameManager;
