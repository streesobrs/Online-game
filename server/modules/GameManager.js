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
      logger.warn('匹配请求失败：无效的游戏类型', { accountId: user.accountId, gameType });
      return false;
    }

    // 检查用户状态
    if (user.status !== 'online') {
      logger.warn('匹配请求失败：用户状态不正确', { accountId: user.accountId, status: user.status });
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
    this.waitingUsers.get(gameType).add(user.accountId);

    logger.matchEvent(user.accountId, '开始匹配', { gameType });

    // 广播用户状态
    this.userManager.broadcastUserStatus(user.accountId, 'waiting', io);

    // 设置匹配超时（30秒）
    if (user.matchTimeout) {
      clearTimeout(user.matchTimeout);
    }
    user.matchTimeout = setTimeout(() => {
      if (user.status === 'waiting' && user.gameType === gameType) {
        // 超时取消匹配
        this.handleCancelMatch(socketId, io);
        const socket = this.userManager.getSocketByAccountId(user.accountId);
        if (socket) {
          socket.emit('match_timeout', {
            gameType,
            message: '匹配超时，请稍后重试'
          });
        }
        logger.matchEvent(user.accountId, '匹配超时', { gameType });
      }
    }, 30000);

    // 检查匹配
    this.checkMatch(gameType, io);

    return true;
  }

  // 处理取消匹配
  handleCancelMatch(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return false;

    if (user.status === 'waiting') {
      // 清除匹配超时定时器
      if (user.matchTimeout) {
        clearTimeout(user.matchTimeout);
        user.matchTimeout = null;
      }

      // 从等待列表移除
      if (this.waitingUsers.has(user.gameType)) {
        this.waitingUsers.get(user.gameType).delete(user.accountId);

        // 清理空集合
        if (this.waitingUsers.get(user.gameType).size === 0) {
          this.waitingUsers.delete(user.gameType);
        }
      }

      // 更新用户状态
      user.status = 'online';
      user.gameType = null;
      user.lastActivity = Date.now();

      logger.matchEvent(user.accountId, '取消匹配', { gameType: user.gameType });

      // 广播用户状态
      this.userManager.broadcastUserStatus(user.accountId, 'online', io);

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
    const challenged = this.userManager.getUserByAccountId(challengedUserId);

    if (!challenged) {
      io.to(socketId).emit('error', { message: '挑战失败：对方不在线或用户不存在' });
      return;
    }

    if (challenger.accountId === challenged.accountId) {
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
    if (this.challengeRequests.has(challenger.accountId)) {
      io.to(socketId).emit('error', { message: '您已发起一个挑战，请等待回应' });
      return;
    }
    // 检查对方是否已发起挑战
    if (this.challengeRequests.has(challenged.accountId) && this.challengeRequests.get(challenged.accountId).challengedId === challenger.accountId) {
      io.to(socketId).emit('error', { message: '对方已向您发起挑战，请先回应' });
      return;
    }


    // 存储挑战请求
    this.challengeRequests.set(challenger.accountId, {
      challengedId: challenged.accountId,
      gameType,
      timestamp: Date.now()
    });

    // 通知被挑战者
    const challengedSocket = this.userManager.getSocketByAccountId(challenged.accountId);
    if (challengedSocket) {
      challengedSocket.emit('challenge_received', {
        from: challenger.accountId,
        fromNickname: challenger.nickname,
        game: gameType,
        timestamp: Date.now()
      });
      io.to(socketId).emit('challenge_sent', { success: true, message: `已向 ${challenged.nickname} 发起挑战` });
      logger.info('挑战请求已发送', { challenger: challenger.accountId, challenged: challenged.accountId, gameType });
    } else {
      io.to(socketId).emit('error', { message: '挑战失败：对方已离线' });
      this.challengeRequests.delete(challenger.accountId); // 清理请求
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
    const challenger = this.userManager.getUserByAccountId(challengerId);

    if (!challenger) {
      io.to(socketId).emit('error', { message: '响应失败：挑战者已离线' });
      return;
    }

    const challenge = this.challengeRequests.get(challenger.accountId);

    if (!challenge || challenge.challengedId !== challenged.accountId) {
      io.to(socketId).emit('error', { message: '响应失败：挑战请求不存在或已过期' });
      return;
    }

    // 移除挑战请求
    this.challengeRequests.delete(challenger.accountId);

    if (accept) {
      // 检查双方状态是否仍然在线
      if (challenger.status !== 'online' || challenged.status !== 'online') {
        io.to(challenger.socketId).emit('error', { message: '挑战失败：您或对方已不在在线状态' });
        io.to(challenged.socketId).emit('error', { message: '挑战失败：您或对方已不在在线状态' });
        return;
      }

      // 创建游戏
      this.createGame(challenger.accountId, challenged.accountId, challenge.gameType, io);
      io.to(challenged.socketId).emit('challenge_accepted', { from: challenger.accountId, fromNickname: challenger.nickname, game: challenge.gameType });
      io.to(challenger.socketId).emit('challenge_accepted', { to: challenged.accountId, toNickname: challenged.nickname, game: challenge.gameType });
      logger.info('挑战已接受，游戏开始', { challenger: challenger.accountId, challenged: challenged.accountId, gameType: challenge.gameType });
    } else {
      // 通知挑战者被拒绝
      io.to(challenger.socketId).emit('challenge_rejected', {
        from: challenged.accountId,
        fromNickname: challenged.nickname,
        game: challenge.gameType
      });
      io.to(challenged.socketId).emit('challenge_rejected', { success: true, message: `已拒绝 ${challenger.nickname} 的挑战` });
      logger.info('挑战已拒绝', { challenger: challenger.accountId, challenged: challenged.accountId, gameType: challenge.gameType });
    }
  }

  // 检查匹配
  checkMatch(gameType, io) {
    const waitingList = this.waitingUsers.get(gameType);
    if (!waitingList || waitingList.size < 2) return;

    // 获取前两个用户
    const users = Array.from(waitingList);
    const accountId1 = users[0];
    const accountId2 = users[1];

    // 从等待列表移除
    waitingList.delete(accountId1);
    waitingList.delete(accountId2);

    // 清理空集合
    if (waitingList.size === 0) {
      this.waitingUsers.delete(gameType);
    }

    // 创建游戏
    this.createGame(accountId1, accountId2, gameType, io);
  }

  // 创建游戏
  createGame(accountId1, accountId2, gameType, io) {
    const gameId = this.generateGameId(gameType);
    const user1 = this.userManager.getUserByAccountId(accountId1);
    const user2 = this.userManager.getUserByAccountId(accountId2);

    if (!user1 || !user2) {
      logger.error('创建游戏失败：用户不存在', { accountId1, accountId2 });
      return null;
    }

    const game = {
      gameId,
      gameType,
      player1: accountId1,
      player2: accountId2,
      player1Nickname: user1.nickname,
      player2Nickname: user2.nickname,
      status: 'playing',
      startTime: Date.now(),
      lastMoveTime: Date.now(),
      currentPlayer: 1, // 1 = player1, 2 = player2
      moves: [],
      result: null,
      endTime: null,
      chat: [],
      board: this.initializeBoard(gameType) // 初始化棋盘，用于悔棋等需要服务器同步的功能
    };

    this.games.set(gameId, game);
    this.moveHistory.set(gameId, []);
    this.spectators.set(gameId, new Set());

    // 更新用户状态
    user1.status = 'playing';
    user1.game = gameId;
    user1.gameType = gameType;
    user1.lastActivity = Date.now();
    user2.status = 'playing';
    user2.game = gameId;
    user2.gameType = gameType;
    user2.lastActivity = Date.now();

    logger.gameEvent(gameId, '游戏开始', {
      gameType,
      player1: accountId1,
      player2: accountId2
    });

    // 广播用户状态
    this.userManager.broadcastUserStatus(accountId1, 'playing', io);
    this.userManager.broadcastUserStatus(accountId2, 'playing', io);

    // 通知玩家
    const socket1 = this.userManager.getSocketByAccountId(accountId1);
    const socket2 = this.userManager.getSocketByAccountId(accountId2);

    // 贪吃蛇使用特殊的匹配成功事件
    if (gameType === 'snake') {
      // 生成贪吃蛇初始数据
      const foods = [];
      for (let i = 0; i < 8; i++) {
        foods.push({
          x: Math.floor(Math.random() * 30),
          y: Math.floor(Math.random() * 30)
        });
      }

      // 存储初始状态到snakeGames
      if (io && typeof io.sockets !== 'undefined') {
        // 获取server.js中的snakeGames
        const snakeGames = io.snakeGames || new Map();
        snakeGames.set(gameId, {
          matchId: gameId,
          player1: accountId1,
          player2: accountId2,
          player1Snake: [{ x: 5, y: 15 }],
          player2Snake: [{ x: 24, y: 15 }],
          player1Score: 0,
          player2Score: 0,
          foods: foods,
          gameTimeLeft: 120,
          startTime: Date.now()
        });
        // 保存回io对象
        io.snakeGames = snakeGames;

        // 主动同步双方状态
        setTimeout(() => {
          // 通知玩家1关于玩家2的状态
          if (socket1) {
            socket1.emit('snake_opponent_update', {
              snake: [{ x: 24, y: 15 }],
              score: 0,
              foods: foods,
              gameTimeLeft: 120
            });
          }

          // 通知玩家2关于玩家1的状态
          if (socket2) {
            socket2.emit('snake_opponent_update', {
              snake: [{ x: 5, y: 15 }],
              score: 0,
              foods: foods,
              gameTimeLeft: 120
            });
          }
        }, 500);
      }

      if (socket1) {
        socket1.emit('snake_match_found', {
          matchId: gameId,
          playerId: accountId1,
          opponentId: accountId2,
          opponentNickname: user2.nickname,
          snake: [{ x: 5, y: 15 }],
          opponentSnake: [{ x: 24, y: 15 }],
          foods,
          gameTimeLeft: 120
        });
      }

      if (socket2) {
        socket2.emit('snake_match_found', {
          matchId: gameId,
          playerId: accountId2,
          opponentId: accountId1,
          opponentNickname: user1.nickname,
          snake: [{ x: 24, y: 15 }],
          opponentSnake: [{ x: 5, y: 15 }],
          foods,
          gameTimeLeft: 120
        });
      }

      // 启动游戏计时器
      this.startGameTimer(gameId, io);
    } else {
      // 其他棋类游戏使用标准匹配成功事件
      if (socket1) {
        socket1.emit('match_success', {
          gameId,
          game: gameType,
          opponentId: accountId2,
          opponentNickname: user2.nickname,
          color: 1,
          timestamp: Date.now()
        });
      }

      if (socket2) {
        socket2.emit('match_success', {
          gameId,
          game: gameType,
          opponentId: accountId1,
          opponentNickname: user1.nickname,
          color: 2,
          timestamp: Date.now()
        });
      }

      // 启动游戏计时器
      this.startGameTimer(gameId, io);
    }

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
        const socket1 = this.userManager.getSocketByAccountId(game.player1);
        const socket2 = this.userManager.getSocketByAccountId(game.player2);

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
    const isPlayer1 = game.player1 === user.accountId;
    const isPlayer2 = game.player2 === user.accountId;

    if ((game.currentPlayer === 1 && !isPlayer1) ||
      (game.currentPlayer === 2 && !isPlayer2)) {
      return false;
    }

    // 根据游戏类型构建位置数据
    let position;
    if (data.fromR !== undefined) {
      // 象棋：使用 fromR/fromC/toR/toC 格式
      position = { fromR: data.fromR, fromC: data.fromC, toR: data.toR, toC: data.toC };
    } else if (data.position) {
      position = data.position;
    } else {
      position = { r: data.r, c: data.c };
    }

    // 记录移动
    const move = {
      player: user.accountId,
      color: isPlayer1 ? 1 : 2,
      position: position,
      timestamp: Date.now()
    };

    game.moves.push(move);
    game.lastMoveTime = Date.now();
    game.currentPlayer = game.currentPlayer === 1 ? 2 : 1;

    // 保存移动历史
    const moves = this.moveHistory.get(game.gameId);
    moves.push(move);

    // 在服务器棋盘上执行移动（保持服务器与客户端同步）
    if (game.board && game.gameType) {
      this.executeMove(game.gameType, game.board, position, move.color);
    }

    // 更新用户活动
    this.userManager.updateUserActivity(user.accountId);

    logger.gameEvent(game.gameId, '移动', {
      player: user.accountId,
      position: move.position,
      isPlayer1: isPlayer1,
      isPlayer2: isPlayer2,
      gamePlayer1: game.player1,
      gamePlayer2: game.player2
    });

    // 发送给对手（不发送给自己）
    const opponentId = isPlayer1 ? game.player2 : game.player1;
    const opponentSocket = this.userManager.getSocketByAccountId(opponentId);
    logger.info('发送移动消息', {
      from: user.accountId,
      to: opponentId,
      hasOpponentSocket: !!opponentSocket
    });
    if (opponentSocket) {
      opponentSocket.emit('move', {
        ...data,
        from: user.accountId,
        color: move.color
      });
    }

    // 发送给观战者（不发送给玩家自己）
    this.broadcastToSpectators(game.gameId, 'move', {
      ...data,
      from: user.accountId,
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
      const userSocket = this.userManager.getSocketByAccountId(user.accountId);
      if (userSocket) {
        userSocket.emit('reset_request_pending', {
          message: '已有重置请求待处理，请等待对方回应'
        });
      }
      return false;
    }

    // 转发给对手
    const opponentId = game.player1 === user.accountId ? game.player2 : game.player1;
    const opponentSocket = this.userManager.getSocketByAccountId(opponentId);

    if (opponentSocket) {
      // 设置重置请求信息
      game.pendingResetRequest = {
        requesterId: user.accountId,
        requestTime: Date.now(),
        message: (data && data.message) ? data.message : '对方请求重置棋盘'
      };

      // 记录重置请求
      logger.gameEvent(game.gameId, '重置请求', {
        requester: user.accountId,
        opponent: opponentId,
        message: (data && data.message) ? data.message : '对方请求重置棋盘'
      });

      opponentSocket.emit('reset_request', {
        from: user.accountId,
        fromNickname: user.nickname,
        message: (data && data.message) ? data.message : '对方请求重置棋盘',
        requestId: game.pendingResetRequest.requestTime
      });

      // 设置超时（30秒后自动取消）
      game.resetTimeout = setTimeout(() => {
        if (game.pendingResetRequest) {
          const requesterSocket = this.userManager.getSocketByAccountId(game.pendingResetRequest.requesterId);
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
      const userSocket = this.userManager.getSocketByAccountId(user.accountId);
      if (userSocket) {
        userSocket.emit('reset_request_invalid', {
          message: '没有待处理的重置请求'
        });
      }
      return false;
    }

    // 验证请求ID（如果提供）
    if (requestId && game.pendingResetRequest.requestTime !== requestId) {
      const userSocket = this.userManager.getSocketByAccountId(user.accountId);
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
    const user1 = this.userManager.getUserByAccountId(game.player1);
    const user2 = this.userManager.getUserByAccountId(game.player2);

    if (user1) {
      user1.status = 'playing';
    }
    if (user2) {
      user2.status = 'playing';
    }

    // 通知双方重置游戏
    const player1Socket = this.userManager.getSocketByAccountId(game.player1);
    const player2Socket = this.userManager.getSocketByAccountId(game.player2);

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
    const requesterSocket = this.userManager.getSocketByAccountId(requesterId);
    if (requesterSocket) {
      requesterSocket.emit('reset_accepted', {
        message: '对方已同意重置游戏'
      });
    }

    // 重启游戏计时器
    this.startGameTimer(gameId, io);

    logger.gameEvent(game.gameId, '游戏重置', {
      requester: requesterId,
      responder: user.accountId
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
      const userSocket = this.userManager.getSocketByAccountId(user.accountId);
      if (userSocket) {
        userSocket.emit('reset_request_invalid', {
          message: '没有待处理的重置请求'
        });
      }
      return false;
    }

    // 验证请求ID（如果提供）
    if (requestId && game.pendingResetRequest.requestTime !== requestId) {
      const userSocket = this.userManager.getSocketByAccountId(user.accountId);
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
    const requesterSocket = this.userManager.getSocketByAccountId(requesterId);
    if (requesterSocket) {
      requesterSocket.emit('reset_rejected', {
        from: user.accountId,
        fromNickname: user.nickname,
        message: '对方拒绝了重置请求'
      });
    }

    // 清理重置请求信息
    delete game.pendingResetRequest;

    logger.gameEvent(game.gameId, '重置请求被拒绝', {
      requester: requesterId,
      rejecter: user.accountId
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
      winner = user.accountId;
      loser = game.player1 === user.accountId ? game.player2 : game.player1;
    } else if (result === 'resign') {
      loser = user.accountId;
      winner = game.player1 === user.accountId ? game.player2 : game.player1;
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
      for (const accountId of players) {
        if (accountId && this.accountManager) {
          const account = await this.accountManager.getAccount(accountId);
          if (!account) continue;

          const isWinner = accountId === winner;
          const playerResult = isWinner ? 'win' : (result === 'draw' ? 'draw' : 'loss');
          const gameDuration = game.endTime - game.startTime;
          const playerChatted = game.playerChatted && game.playerChatted[accountId];

          // 先给予经验值奖励（更新等级），再检查成就
          let expReward = 0;
          if (playerResult === 'win') {
            expReward = 300;
          } else if (playerResult === 'draw') {
            expReward = 150;
          } else {
            expReward = 75;
          }

          if (expReward > 0) {
            const expResult = await this.accountManager.addExp(accountId, expReward);
            // 通知经验明细
            if (expResult.success) {
              const s = this.userManager.getSocketByAccountId(accountId);
              if (s) {
                s.emit('exp_gained', { expResult });
              }
            }
          }

          // 重新读取账号，获取最新等级
          const postExpAccount = await this.accountManager.getAccount(accountId);
          if (!postExpAccount) continue;

          // 计算最新等级
          let newLevel = 1;
          if (postExpAccount.account && postExpAccount.account.profile && postExpAccount.account.profile.exp) {
            const totalExp = postExpAccount.account.profile.exp;
            let exp = totalExp;
            while (newLevel < this.accountManager.getMaxLevel() && exp >= this.accountManager.getExpForLevel(newLevel + 1)) {
              exp -= this.accountManager.getExpForLevel(newLevel + 1);
              newLevel++;
            }
          }

          const now = new Date();
          const currentHour = now.getHours();
          const currentDay = now.getDay();

          // 聚合所有游戏类型的连胜数据
          let bestStreak = 0;
          let bestMaxStreak = 0;
          const gameTypeWins = {};
          if (postExpAccount.games) {
            Object.values(postExpAccount.games).forEach(g => {
              bestStreak = Math.max(bestStreak, g.streak || 0);
              bestMaxStreak = Math.max(bestMaxStreak, g.maxStreak || 0);
            });
            for (const [gk, gd] of Object.entries(postExpAccount.games)) {
              gameTypeWins[gk] = gd.wins || 0;
            }
          }

          const stats = {
            ...postExpAccount.stats,
            ...(postExpAccount.stats?.flags || {}),
            ...(postExpAccount.account?.activity || {}),
            // 用当前游戏时间覆盖持久标志位
            nightGame: currentHour >= 2 && currentHour <= 6,
            weekendGame: currentDay === 0 || currentDay === 6,
            level: newLevel,
            streak: bestStreak,
            maxStreak: bestMaxStreak,
            result: playerResult,
            silentWin: isWinner && !playerChatted,
            quickGame: gameDuration <= 5 * 60 * 1000,
            slowGame: gameDuration >= 15 * 60 * 1000,
            gameDuration: gameDuration / 60000,
            maxMoves: game.moves ? game.moves.length : 0,
            allGameTypes: postExpAccount.games && Object.keys(postExpAccount.games).filter(k => postExpAccount.games[k].totalGames > 0).length >= 3,
            singleGameType: postExpAccount.games && Object.keys(postExpAccount.games).filter(k => postExpAccount.games[k].totalGames > 0).length === 1 && (postExpAccount.stats?.totalGames || 0) > 1,
            lonerWin: isWinner && (game.gameType === 'snake' || reason === 'resign'),
            wins: postExpAccount.stats?.totalWins || 0,
            losses: postExpAccount.stats?.totalLosses || 0,
            draws: postExpAccount.stats?.totalDraws || 0,
            gameTypeWins,
          };

          const unlockedAchievements = await this.achievementManager.checkAchievements(accountId, stats);
          if (unlockedAchievements.length > 0) {
            const socket = this.userManager.getSocketByAccountId(accountId);
            if (socket) {
              socket.emit('achievements_unlocked', { achievements: unlockedAchievements });
            }
          }

          // 通知客户端最终账号状态（包含基础经验奖励 + 成就奖励）
          const socket = this.userManager.getSocketByAccountId(accountId);
          if (socket) {
            const finalAccount = await this.accountManager.getAccount(accountId);
            socket.emit('account_updated', { account: finalAccount });
          }
        }
      }
    } catch (err) {
      logger.error('检查成就失败', { gameId, error: err.message });
    }

    // 通知玩家
    const socket1 = this.userManager.getSocketByAccountId(game.player1);
    const socket2 = this.userManager.getSocketByAccountId(game.player2);

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

    // 贪吃蛇游戏特殊处理：发送专用事件 + 清理snakeGames
    if (game.gameType === 'snake') {
      if (socket1) socket1.emit('snake_game_over', endData);
      if (socket2) socket2.emit('snake_game_over', endData);
      if (io && io.snakeGames) {
        io.snakeGames.delete(gameId);
      }
    }

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
        case 'chinese-chess':
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
        player1: data.accountId,
        player2: 'computer', // 贪吃蛇是单人游戏
        player1Nickname: '玩家',
        player2Nickname: '电脑',
        winner: data.score > 0 ? data.accountId : 'computer',
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
      accountId: user.accountId,
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
      // AI对战游戏
      if (user.game === 'ai') {
        const aiGame = this.aiGames.get(user.accountId);
        if (aiGame && aiGame.status === 'playing') {
          logger.info('用户从AI对战返回大厅，结束AI游戏', { accountId: user.accountId, gameType: aiGame.gameType });
          aiGame.status = 'ended';
          this.aiGames.delete(user.accountId);
          gameEnded = true;
          gameResult = 'resign';
          reason = reason === '主动返回' ? '主动退出AI对战' : reason;
        }
      } else {
        // PvP游戏
        logger.info('用户正在游戏中，准备结束游戏', { accountId: user.accountId, gameId: user.game });
        const game = this.games.get(user.game);
        logger.info('检查游戏状态', {
          accountId: user.accountId,
          gameId: user.game,
          gameExists: !!game,
          gameStatus: game ? game.status : 'no game'
        });
        if (game && game.status === 'playing') {
          const opponentId = game.player1 === user.accountId ? game.player2 : game.player1;
          const opponent = this.userManager.getUserByAccountId(opponentId);

          // 根据游戏进度决定结算方式
          const gameDuration = Date.now() - game.startTime;
          const moveCount = game.moves.length;

          // 非正常结算逻辑
          if (moveCount < 5 && gameDuration < 60000) {
            gameResult = 'invalid';
            winnerId = null;
            reason = '游戏刚开始，判定为无效游戏';
          } else if (moveCount < 10 && gameDuration < 120000) {
            gameResult = 'draw';
            winnerId = null;
            reason = '游戏进行中，判定为平局';
          } else {
            gameResult = 'resign';
            winnerId = opponentId;
            reason = '玩家离开游戏';
          }

          // 通知对手
          const opponentSocket = this.userManager.getSocketByAccountId(opponentId);
          if (opponentSocket) {
            opponentSocket.emit('opponent_left', {
              userId: user.accountId,
              nickname: user.nickname,
              reason: reason,
              result: gameResult,
              winner: winnerId,
              moveCount: moveCount,
              gameDuration: gameDuration
            });

            opponentSocket.emit('game_ended', {
              result: gameResult,
              winner: winnerId,
              reason: reason,
              opponentLeft: true,
              leaverNickname: user.nickname,
              moveCount: moveCount,
              gameDuration: gameDuration
            });

            opponentSocket.emit('game_message', {
              type: 'opponent_left',
              message: `${user.nickname} 已离开游戏，${reason}`,
              timestamp: Date.now()
            });
          }

          // 结束游戏
          this.endGame(game.gameId, gameResult, io, winnerId, reason);
          gameEnded = true;

          logger.gameEvent(game.gameId, '非正常结算', {
            leaver: user.accountId,
            opponent: opponentId,
            result: gameResult,
            reason: reason,
            moveCount: moveCount,
            duration: gameDuration
          });
        }
      }
    }

    // 更新用户状态（必须在游戏结束逻辑之后）
    user.status = 'online';
    user.game = null;
    user.gameType = null;
    user.lastActivity = Date.now();

    // 通知用户返回大厅结果
    const userSocket = this.userManager.getSocketByAccountId(user.accountId);
    if (userSocket) {
      userSocket.emit('return_lobby_result', {
        success: true,
        gameEnded: gameEnded,
        result: gameResult,
        reason: reason
      });
    }

    logger.userAction(user.accountId, '返回大厅', {
      reason: reason,
      gameEnded: gameEnded,
      result: gameResult
    });

    // 广播用户状态
    this.userManager.broadcastUserStatus(user.accountId, 'online', io);

    return true;
  }

  // 处理用户断开连接
  handleUserDisconnect(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return;

    const accountId = user.accountId;

    // 如果在等待队列中，移除
    if (user.status === 'waiting') {
      this.handleCancelMatch(socketId, io);
    }

    // 如果在游戏中
    if (user.status === 'playing' && user.game) {
      // AI对战游戏
      if (user.game === 'ai') {
        const aiGame = this.aiGames.get(accountId);
        if (aiGame && aiGame.status === 'playing') {
          logger.info('AI对战玩家断开，等待重连', { accountId, gameType: aiGame.gameType });
          // 设置30秒超时，如果未重连则结束AI游戏
          setTimeout(() => {
            const currentAiGame = this.aiGames.get(accountId);
            if (currentAiGame && currentAiGame.status === 'playing') {
              const userSession = this.userManager.getUserByAccountId(accountId);
              const userSocket = userSession ? this.userManager.getSocketByAccountId(accountId) : null;
              if (!userSocket) {
                // 未重连，结束AI游戏（按失败处理）
                logger.info('AI对战玩家超时未重连，结束游戏', { accountId });
                currentAiGame.status = 'ended';
                this.aiGames.delete(accountId);
                // 恢复用户状态
                if (userSession) {
                  userSession.status = 'online';
                  userSession.game = null;
                  userSession.gameType = null;
                }
              }
            }
          }, 30000);
        }
        return;
      }

      // PvP游戏
      const game = this.games.get(user.game);
      if (game && game.status === 'playing') {
        const opponentId = game.player1 === accountId ? game.player2 : game.player1;

        // 贪吃蛇游戏立即结束，不等待重连
        if (game.gameType === 'snake') {
          this.endGame(game.gameId, 'resign', io, opponentId, '对手断开连接');
          return;
        }

        // 延迟结束游戏（给用户重新连接的机会）
        setTimeout(() => {
          const currentGame = this.games.get(game.gameId);
          if (currentGame && currentGame.status === 'playing') {
            // 检查两个玩家是否都已重新连接（有有效socket）
            const user1Socket = this.userManager.getSocketByAccountId(game.player1);
            const user2Socket = this.userManager.getSocketByAccountId(game.player2);

            if (!user1Socket || !user2Socket) {
              // 有玩家未重连，结束游戏
              const winner = user1Socket ? game.player1 : game.player2;
              this.endGame(game.gameId, 'resign', io, winner, '对手断开连接');
            }
          }
        }, 30000); // 30秒延迟
      }
    }
  }

  // 添加观战者
  addSpectator(gameId, accountId, io) {
    const game = this.games.get(gameId);
    if (!game) {
      return { success: false, message: '游戏不存在' };
    }

    // 不能观战自己的游戏
    if (game.player1 === accountId || game.player2 === accountId) {
      return { success: false, message: '不能观战自己的游戏' };
    }

    const spectators = this.spectators.get(gameId);
    if (spectators) {
      spectators.add(accountId);

      const user = this.userManager.getUserByAccountId(accountId);
      if (user) {
        user.status = 'spectating';
        user.game = gameId;
        this.userManager.broadcastUserStatus(accountId, 'spectating', io);
      }

      logger.userAction(accountId, '开始观战', { gameId });

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
  removeSpectator(gameId, accountId, io) {
    const spectators = this.spectators.get(gameId);
    if (spectators) {
      spectators.delete(accountId);

      const user = this.userManager.getUserByAccountId(accountId);
      if (user) {
        user.status = 'online';
        user.game = null;
        this.userManager.broadcastUserStatus(accountId, 'online', io);
      }

      logger.userAction(accountId, '结束观战', { gameId });
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
        const socket = this.userManager.getSocketByAccountId(userId);
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
  async getGameHistory(accountId, limit = 10) {
    try {
      const games = await dataStore.read('games');
      return games
        .filter(game => game.player1 === accountId || game.player2 === accountId)
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, limit)
        .map(game => ({
          gameId: game.gameId,
          gameType: game.gameType,
          opponent: game.player1 === accountId ? game.player2Nickname : game.player1Nickname,
          result: game.gameType === 'snake' ? game.result : (game.winner === accountId ? 'win' : game.winner === null ? 'draw' : 'loss'),
          moves: game.moves?.length || 0,
          date: game.endTime,
          duration: game.duration
        }));
    } catch (err) {
      logger.error('获取游戏历史失败', { accountId, error: err.message });
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
        duration: game.duration,
        score: game.score,
        maxLength: game.maxLength,
        foodEaten: game.foodEaten
      };
    } catch (err) {
      logger.error('获取游戏回放失败', { gameId, error: err.message });
      return null;
    }
  }

  // 获取所有游戏
  getAllGames() {
    const pvpGames = Array.from(this.games.values()).map(game => {
      const user1 = this.userManager.getUserByAccountId(game.player1);
      const user2 = this.userManager.getUserByAccountId(game.player2);
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
      const user = this.userManager.getUserByAccountId(aiGame.userId);
      return {
        gameId: aiGame.gameId,
        gameType: aiGame.gameType,
        player1: user ? { nickname: user.nickname, userId: user.accountId } : null,
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
    for (const [accountId, aiGame] of this.aiGames.entries()) {
      if (aiGame.gameId === gameId && aiGame.status === 'playing') {
        this.endAIGame(accountId, 'loss', io);
        logger.info('管理员结束AI游戏', { gameId, accountId });
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

    const player1Socket = this.userManager.getSocketByAccountId(game.player1);
    const player2Socket = this.userManager.getSocketByAccountId(game.player2);

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

    const user1 = this.userManager.getUserByAccountId(game.player1);
    const user2 = this.userManager.getUserByAccountId(game.player2);

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
  createAIGame(accountId, gameType, difficulty, io) {
    if (!this.aiManager) {
      logger.warn('AI对战功能未启用：AIManager未初始化');
      return false;
    }

    const user = this.userManager.getUserByAccountId(accountId);
    if (!user) {
      logger.warn('创建AI对战失败：用户不存在', { accountId });
      return false;
    }

    // 验证游戏类型
    if (!Object.values(config.game.types).includes(gameType)) {
      logger.warn('创建AI对战失败：无效的游戏类型', { accountId, gameType });
      return false;
    }

    // 验证难度
    if (!['easy', 'medium', 'hard'].includes(difficulty)) {
      logger.warn('创建AI对战失败：无效的难度', { accountId, difficulty });
      return false;
    }

    // 如果存在旧游戏，先删除
    const existingGame = this.aiGames.get(accountId);
    if (existingGame) {
      logger.info('删除已存在的AI游戏', { accountId, status: existingGame.status });
      this.aiGames.delete(accountId);
    }

    // 初始化棋盘
    const board = this.initializeBoard(gameType);

    // 创建AI游戏对象
    const aiGame = {
      gameId: this.generateGameId(gameType),
      accountId: accountId,
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
    this.aiGames.set(accountId, aiGame);

    // 更新用户状态
    user.status = 'playing';
    user.game = 'ai';
    user.gameType = gameType;
    user.lastActivity = Date.now();
    this.userManager.broadcastUserStatus(accountId, 'playing', io);

    logger.aiGameEvent(accountId, '开始AI对战', { gameType, difficulty });

    // 发送游戏开始信息
    const userSocket = this.userManager.getSocketByAccountId(accountId);
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
  async handleAIMove(accountId, position, io) {
    logger.info('🎯 AI对战收到移动', { accountId, position, gameType: this.aiGames.get(accountId)?.gameType });

    const aiGame = this.aiGames.get(accountId);
    if (!aiGame || aiGame.status !== 'playing') {
      logger.warn('❌ AI对战移动失败：游戏不存在或不在进行中', { accountId, game: !!aiGame, status: aiGame?.status });
      return false;
    }

    // 获取用户信息
    const user = this.userManager.getUserByAccountId(accountId);
    if (!user) {
      logger.warn('❌ AI对战移动失败：用户不存在', { accountId });
      return false;
    }

    // 验证是否是玩家回合
    if (aiGame.currentPlayer !== 1) {
      logger.warn('❌ AI对战移动失败：不是玩家回合', { accountId, currentPlayer: aiGame.currentPlayer });
      return false;
    }

    // 验证移动是否有效
    logger.info('🔍 验证移动有效性', { gameType: aiGame.gameType, position, boardSize: aiGame.board.length });
    if (!this.isValidMove(aiGame.gameType, aiGame.board, position, aiGame.currentPlayer)) {
      logger.warn('❌ AI对战移动失败：无效的移动', { accountId, position, gameType: aiGame.gameType });
      return false;
    }

    // 执行玩家移动
    this.executeMove(aiGame.gameType, aiGame.board, position, aiGame.currentPlayer);

    // 记录移动
    const move = {
      player: accountId,
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
      await this.endAIGame(accountId, 'win', io);
      return true;
    }

    // 切换到AI回合
    aiGame.currentPlayer = 2;

    // 发送移动结果
    const userSocket = this.userManager.getSocketByAccountId(accountId);
    if (userSocket) {
      const result = {
        position: position,
        color: 1,
        currentPlayer: 2
      };
      // 象棋需要发送完整棋盘数据
      if (aiGame.gameType === 'chinese-chess') {
        result.board = aiGame.board;
      }
      userSocket.emit('ai_move_result', result);
    }

    // AI思考并移动，根据难度设置不同的随机思考时间
    let thinkTime;
    if (aiGame.difficulty === 'easy') {
      thinkTime = Math.floor(Math.random() * 81) + 20; // 20-100ms
    } else if (aiGame.difficulty === 'medium') {
      thinkTime = Math.floor(Math.random() * 201) + 100; // 100-300ms
    } else {
      thinkTime = Math.floor(Math.random() * 301) + 200; // 200-500ms
    }
    setTimeout(() => {
      this.handleAIAutoMove(accountId, io);
    }, thinkTime);

    return true;
  }

  // AI 自动移动
  handleAIAutoMove(accountId, io) {
    const aiGame = this.aiGames.get(accountId);
    if (!aiGame || aiGame.status !== 'playing' || aiGame.currentPlayer !== 2) {
      return;
    }

    try {
      // 获取 AI 移动
      const aiMove = this.aiManager.getAIMove(
        aiGame.gameType,
        aiGame.board,
        aiGame.difficulty,
        aiGame.currentPlayer
      );

      if (!aiMove) {
        logger.warn('AI 移动失败：无法生成有效移动', { accountId, gameType: aiGame.gameType });
        return;
      }

      logger.info('🤖 AI 执行移动', { accountId, gameType: aiGame.gameType, move: aiMove });

      // 执行 AI 移动
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
      const user = this.userManager.getUserByAccountId(accountId);
      if (user) {
        user.lastActivity = Date.now();
      }

      // 检查游戏是否结束
      const gameOver = this.checkGameOver(aiGame.gameType, aiGame.board, aiGame.currentPlayer);
      if (gameOver) {
        this.endAIGame(accountId, 'loss', io);
        return;
      }

      // 切换回玩家回合
      aiGame.currentPlayer = 1;

      // 发送AI移动结果
      const userSocket = this.userManager.getSocketByAccountId(accountId);
      if (userSocket) {
        const result = {
          position: aiMove,
          color: 2,
          currentPlayer: 1
        };
        // 象棋需要发送完整棋盘数据
        if (aiGame.gameType === 'chinese-chess') {
          result.board = aiGame.board;
        }
        userSocket.emit('ai_move_result', result);
      }
    } catch (error) {
      logger.error('AI 自动移动出错', { accountId, gameType: aiGame.gameType, error: error.message, stack: error.stack });
      // 出错后将回合还给玩家，让游戏可以继续
      aiGame.currentPlayer = 1;
      const userSocket = this.userManager.getSocketByAccountId(accountId);
      if (userSocket) {
        userSocket.emit('ai_move_result', {
          position: null,
          color: 2,
          currentPlayer: 1,
          error: 'AI 思考中遇到问题，请继续你的回合'
        });
      }
    }
  }

  // 结束AI对战
  async endAIGame(accountId, result, io) {
    const aiGame = this.aiGames.get(accountId);
    if (!aiGame) return;

    // 如果游戏已经结束，直接返回，避免重复保存
    if (aiGame.status === 'finished') return;

    aiGame.status = 'finished';
    aiGame.endTime = Date.now();
    aiGame.duration = aiGame.endTime - aiGame.startTime;
    aiGame.result = result;

    // 获取用户信息
    const user = this.userManager.getUserByAccountId(accountId);
    if (!user) return;

    // 保存AI游戏记录到 games.json
    try {
      const gameId = this.generateGameId(aiGame.gameType);
      // 基础记录结构
      const record = {
        id: gameId,
        gameId: gameId,
        gameType: aiGame.gameType,
        player1: accountId,
        player2: 'ai',
        player1Nickname: user.nickname || user.accountId,
        player2Nickname: 'AI',
        winner: result === 'win' ? accountId : 'ai',
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
        case 'chinese-chess':
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
      logger.info('AI游戏记录已保存', { accountId, gameType: aiGame.gameType, result });
    } catch (err) {
      logger.error('保存AI游戏记录失败', { accountId, error: err.message });
    }

    // 更新用户状态
    if (user) {
      user.status = 'online';
      user.game = null;
      this.userManager.broadcastUserStatus(accountId, 'online', io);
    }

    // 发送游戏结束信息
    const userSocket = this.userManager.getSocketByAccountId(accountId);
    if (userSocket) {
      userSocket.emit('ai_game_end', {
        result: result,
        moves: aiGame.moves,
        duration: aiGame.duration
      });
    }

    // 更新用户统计
    await this.userManager.updateUserStats(accountId, result, aiGame.gameType, true, aiGame.difficulty, aiGame.duration);

    // 给予经验值奖励
    if (accountId && this.accountManager && this.achievementManager) {
      // 根据结果给予经验值
      let expReward = 0;
      if (result === 'win') {
        expReward = 200; // 胜利奖励
      } else if (result === 'draw') {
        expReward = 100; // 平局奖励
      } else {
        expReward = 50; // 失败安慰奖
      }

      // 根据难度调整
      if (aiGame.difficulty === 'hard') {
        expReward = Math.floor(expReward * 2.0);
      } else if (aiGame.difficulty === 'medium') {
        expReward = Math.floor(expReward * 1.5);
      }

      // 添加经验值
      if (expReward > 0) {
        const expResult = await this.accountManager.addExp(accountId, expReward);

        // 通知客户端
        if (expResult.success && userSocket) {
          const updatedAccount = await this.accountManager.getAccount(accountId);
          userSocket.emit('account_updated', { account: updatedAccount });
          userSocket.emit('exp_gained', { expResult });
        }
      }

      const account = await this.accountManager.getAccount(accountId);
      if (account) {
        const playerChatted = aiGame.playerChatted && aiGame.playerChatted[accountId];
        let level = 1;
        if (account.account && account.account.profile && account.account.profile.exp) {
          const totalExp = account.account.profile.exp;
          let exp = totalExp;
          while (level < this.accountManager.getMaxLevel() && exp >= this.accountManager.getExpForLevel(level + 1)) {
            exp -= this.accountManager.getExpForLevel(level + 1);
            level++;
          }
        }

        const now = new Date();
        const currentHour = now.getHours();
        const currentDay = now.getDay();

        // 聚合所有游戏类型的连胜数据
        let bestStreak = 0;
        let bestMaxStreak = 0;
        const gameTypeWins = {};
        if (account.games) {
          Object.values(account.games).forEach(g => {
            bestStreak = Math.max(bestStreak, g.streak || 0);
            bestMaxStreak = Math.max(bestMaxStreak, g.maxStreak || 0);
          });
          for (const [gk, gd] of Object.entries(account.games)) {
            gameTypeWins[gk] = gd.wins || 0;
          }
        }

        const stats = {
          ...account.stats,
          // 展开 flags 子对象到顶层（nightGame, weekendGame, firstGame 等）
          ...(account.stats?.flags || {}),
          ...(account.account?.activity || {}),
          // 用当前游戏时间覆盖持久标志位
          nightGame: currentHour >= 2 && currentHour <= 6,
          weekendGame: currentDay === 0 || currentDay === 6,
          level: level,
          streak: bestStreak,
          maxStreak: bestMaxStreak,
          result: result,
          gameDuration: aiGame.duration / 60000,
          aiDifficulty: aiGame.difficulty,
          aiResult: result,
          silentWin: result === 'win' && !playerChatted,
          quickGame: aiGame.duration <= 5 * 60 * 1000,
          slowGame: aiGame.duration >= 60 * 60 * 1000,
          maxMoves: aiGame.moves ? aiGame.moves.length : 0,
          allGameTypes: account.games && Object.keys(account.games).filter(k => account.games[k].totalGames > 0).length >= 3,
          singleGameType: account.games && Object.keys(account.games).filter(k => account.games[k].totalGames > 0).length === 1 && (account.stats?.totalGames || 0) > 1,
          lonerWin: result === 'win',
          wins: account.stats?.totalWins || 0,
          losses: account.stats?.totalLosses || 0,
          draws: account.stats?.totalDraws || 0,
          gameTypeWins,
        };
        const unlockedAchievements = await this.achievementManager.checkAchievements(accountId, stats);
        if (unlockedAchievements.length > 0 && userSocket) {
          userSocket.emit('achievements_unlocked', { achievements: unlockedAchievements });
        }
      }
    }

    logger.aiGameEvent(accountId, 'AI对战结束', {
      gameType: aiGame.gameType,
      difficulty: aiGame.difficulty,
      result: result,
      duration: aiGame.duration
    });

    // 清理AI游戏 - 使用游戏开始时间作为标识，确保不会误删新游戏
    const gameStartTime = aiGame.startTime;
    setTimeout(() => {
      const currentGame = this.aiGames.get(accountId);
      // 只有当游戏仍然存在且是同一个游戏时才删除
      if (currentGame && currentGame.startTime === gameStartTime) {
        this.aiGames.delete(accountId);
        logger.info('清理已结束的AI游戏', { accountId, gameStartTime });
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
      case 'chinese-chess':
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
      case 'chinese-chess':
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

  // ========== 象棋规则实现 ==========

  // 判断棋子颜色：'r' 红方，'b' 黑方
  getChessPieceColor(piece) {
    if (!piece || piece === 0) return null;
    if (piece.startsWith('r-')) return 'r';
    if (piece.startsWith('b-')) return 'b';
    return null;
  }

  // 获取棋子类型：ju, ma, xiang, shi, shuai, pao, bing, jiang, zu
  getChessPieceType(piece) {
    if (!piece || piece === 0) return null;
    const idx = piece.indexOf('-');
    return idx >= 0 ? piece.substring(idx + 1) : null;
  }

  // 获取某位置所有合法目标（不考虑将军后还不解除）
  getChessRawMoves(board, r, c) {
    const piece = board[r][c];
    if (!piece || piece === 0) return [];
    const color = this.getChessPieceColor(piece);
    const type = this.getChessPieceType(piece);
    const moves = [];

    const isRed = color === 'r';
    const forward = isRed ? -1 : 1; // 红方向上是-1，黑方是+1

    const inBounds = (rr, cc) => rr >= 0 && rr < 10 && cc >= 0 && cc < 9;
    const isEnemy = (rr, cc) => {
      const p = board[rr][cc];
      return p !== 0 && this.getChessPieceColor(p) !== color;
    };
    const isFriend = (rr, cc) => {
      const p = board[rr][cc];
      return p !== 0 && this.getChessPieceColor(p) === color;
    };

    switch (type) {
      case 'ju': // 车：直线走，无阻挡
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          let nr = r + dr, nc = c + dc;
          while (inBounds(nr, nc)) {
            if (isFriend(nr, nc)) break;
            moves.push({ r: nr, c: nc });
            if (isEnemy(nr, nc)) break;
            nr += dr; nc += dc;
          }
        }
        break;

      case 'ma': // 马：走"日"字，注意蹩脚
        for (const [dr, dc, legR, legC] of [
          [-2, -1, -1, 0], [-2, 1, -1, 0],
          [2, -1, 1, 0], [2, 1, 1, 0],
          [-1, -2, 0, -1], [-1, 2, 0, 1],
          [1, -2, 0, -1], [1, 2, 0, 1]
        ]) {
          const nr = r + dr, nc = c + dc;
          const lr = r + legR, lc = c + legC;
          if (inBounds(nr, nc) && !isFriend(nr, nc) && board[lr][lc] === 0) {
            moves.push({ r: nr, c: nc });
          }
        }
        break;

      case 'xiang': // 象/相：走"田"字，不能过河，注意塞眼
        for (const [dr, dc, eyeR, eyeC] of [
          [-2, -2, -1, -1], [-2, 2, -1, 1],
          [2, -2, 1, -1], [2, 2, 1, 1]
        ]) {
          const nr = r + dr, nc = c + dc;
          const er = r + eyeR, ec = c + eyeC;
          // 不能过河：红方0-4行，黑方5-9行
          const inOwnHalf = isRed ? (nr >= 5 && nr <= 9) : (nr >= 0 && nr <= 4);
          if (inBounds(nr, nc) && inOwnHalf && !isFriend(nr, nc) && board[er][ec] === 0) {
            moves.push({ r: nr, c: nc });
          }
        }
        break;

      case 'shi': // 士/仕：斜走一格，不出九宫
        const shiColMin = 3, shiColMax = 5;
        const shiRowMin = isRed ? 7 : 0, shiRowMax = isRed ? 9 : 2;
        for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= shiRowMin && nr <= shiRowMax && nc >= shiColMin && nc <= shiColMax && !isFriend(nr, nc)) {
            moves.push({ r: nr, c: nc });
          }
        }
        break;

      case 'shuai': // 帅/将：九宫内直走一格
      case 'jiang':
        const kingColMin = 3, kingColMax = 5;
        const kingRowMin = isRed ? 7 : 0, kingRowMax = isRed ? 9 : 2;
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= kingRowMin && nr <= kingRowMax && nc >= kingColMin && nc <= kingColMax && !isFriend(nr, nc)) {
            moves.push({ r: nr, c: nc });
          }
        }
        // 将帅对面：如果两将同列且中间无子，可以飞将吃对方将
        const kingCol = c;
        const opponentKingType = isRed ? 'b-jiang' : 'r-shuai';
        let foundOpponentKing = false;
        let blocked = false;
        for (let rr = r + (isRed ? -1 : 1); isRed ? rr >= 0 : rr < 10; rr += isRed ? -1 : 1) {
          if (board[rr][kingCol] === opponentKingType) {
            foundOpponentKing = true;
            break;
          } else if (board[rr][kingCol] !== 0) {
            blocked = true;
            break;
          }
        }
        if (foundOpponentKing && !blocked) {
          // 找到对方将的位置
          for (let rr = r + (isRed ? -1 : 1); isRed ? rr >= 0 : rr < 10; rr += isRed ? -1 : 1) {
            if (board[rr][kingCol] === opponentKingType) {
              moves.push({ r: rr, c: kingCol });
              break;
            }
          }
        }
        break;

      case 'pao': // 炮：直线走，但吃子需翻山
        for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
          let nr = r + dr, nc = c + dc;
          // 移动（无阻挡）
          while (inBounds(nr, nc) && board[nr][nc] === 0) {
            moves.push({ r: nr, c: nc });
            nr += dr; nc += dc;
          }
          // 找炮架
          if (inBounds(nr, nc) && board[nr][nc] !== 0) {
            nr += dr; nc += dc; // 跳过炮架
            while (inBounds(nr, nc)) {
              if (board[nr][nc] !== 0) {
                if (isEnemy(nr, nc)) {
                  moves.push({ r: nr, c: nc });
                }
                break;
              }
              nr += dr; nc += dc;
            }
          }
        }
        break;

      case 'bing': // 兵/卒：未过河只能前进，过河可左右
      case 'zu':
        const fwd = r + forward;
        if (inBounds(fwd, c) && !isFriend(fwd, c)) {
          moves.push({ r: fwd, c: c });
        }
        // 过河后可以左右
        const hasCrossedRiver = isRed ? (r <= 4) : (r >= 5);
        if (hasCrossedRiver) {
          for (const dc of [-1, 1]) {
            const nc = c + dc;
            if (inBounds(r, nc) && !isFriend(r, nc)) {
              moves.push({ r: r, c: nc });
            }
          }
        }
        break;
    }

    return moves;
  }

  // 判断某方是否被将军
  isCheck(board, color) {
    const kingType = color === 'r' ? 'r-shuai' : 'b-jiang';
    const opponentColor = color === 'r' ? 'b' : 'r';
    // 找到己方将的位置
    let kingR = -1, kingC = -1;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === kingType) {
          kingR = r; kingC = c;
          break;
        }
      }
      if (kingR >= 0) break;
    }
    if (kingR < 0) return true; // 将已被吃

    // 检查对方所有棋子是否能攻击到将
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] !== 0 && this.getChessPieceColor(board[r][c]) === opponentColor) {
          const moves = this.getChessRawMoves(board, r, c);
          if (moves.some(m => m.r === kingR && m.c === kingC)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  // 判断某方是否被将杀（无合法移动）
  isCheckmate(board, color) {
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] !== 0 && this.getChessPieceColor(board[r][c]) === color) {
          const rawMoves = this.getChessRawMoves(board, r, c);
          for (const move of rawMoves) {
            // 模拟走棋，看是否还处于被将军状态
            const saved = board[move.r][move.c];
            board[move.r][move.c] = board[r][c];
            board[r][c] = 0;
            const stillCheck = this.isCheck(board, color);
            board[r][c] = board[move.r][move.c];
            board[move.r][move.c] = saved;
            if (!stillCheck) return false;
          }
        }
      }
    }
    return true;
  }

  // 验证象棋移动
  isValidChessMove(board, position, player) {
    const { fromR, fromC, toR, toC } = position;
    const piece = board[fromR][fromC];
    if (!piece || piece === 0) return false;

    const color = this.getChessPieceColor(piece);
    // 红方 player=1，黑方 player=2
    const playerColor = player === 1 ? 'r' : 'b';
    if (color !== playerColor) return false;

    const validMoves = this.getChessRawMoves(board, fromR, fromC);
    if (!validMoves.some(m => m.r === toR && m.c === toC)) return false;

    // 模拟走棋，不能让自己的将被将军
    const saved = board[toR][toC];
    board[toR][toC] = piece;
    board[fromR][fromC] = 0;
    const stillCheck = this.isCheck(board, color);
    board[fromR][fromC] = piece;
    board[toR][toC] = saved;

    return !stillCheck;
  }

  // 检查象棋胜利（将杀）
  checkChessWin(board, player) {
    const opponentColor = player === 1 ? 'b' : 'r';
    if (this.isCheckmate(board, opponentColor)) {
      return true;
    }
    return false;
  }

  // ========== 通用游戏方法 ==========

  // 执行移动
  executeMove(gameType, board, position, player) {
    switch (gameType) {
      case 'gobang':
        this.executeGobangMove(board, position, player);
        break;
      case 'go':
        this.executeGoMove(board, position, player);
        break;
      case 'chinese-chess':
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
      case 'chinese-chess':
        return this.checkChessWin(board, player);
      default:
        return false;
    }
  }

  // 检查五子棋胜利
  checkGobangWin(board, player) {
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
    return false;
  }

  // ========== 悔棋系统 ==========

  // 处理悔棋请求
  handleUndoRequest(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return;

    // 检查是否在游戏中
    let game = this.games.get(user.game);
    let isAIGame = false;
    let aiGame = null;
    if (!game) {
      aiGame = this.aiGames.get(user.accountId);
      if (aiGame) {
        isAIGame = true;
        game = aiGame;
      }
    }

    if (!game) {
      const socket = this.userManager.getSocketByAccountId(user.accountId);
      if (socket) socket.emit('error', { message: '当前没有进行中的游戏' });
      return;
    }

    // AI游戏 - 直接执行悔棋
    if (isAIGame) {
      this.executeUndoAIGame(user.accountId, io);
      return;
    }

    // 联机游戏 - 向对手发送请求
    const opponentId = game.player1 === user.accountId ? game.player2 : game.player1;
    const opponentSocket = this.userManager.getSocketByAccountId(opponentId);

    if (!opponentSocket) {
      const socket = this.userManager.getSocketByAccountId(user.accountId);
      if (socket) socket.emit('error', { message: '对手已离线' });
      return;
    }

    // 设置等待中的悔棋请求（防止重复请求）
    if (game.pendingUndoRequest) {
      const socket = this.userManager.getSocketByAccountId(user.accountId);
      if (socket) socket.emit('error', { message: '已有待处理的悔棋请求' });
      return;
    }

    game.pendingUndoRequest = {
      requesterId: user.accountId,
      requestTime: Date.now()
    };

    opponentSocket.emit('undo_request', {
      from: user.accountId,
      fromNickname: user.nickname || '对手'
    });

    const socket = this.userManager.getSocketByAccountId(user.accountId);
    if (socket) socket.emit('undo_request_sent', { message: '已发送悔棋请求，等待对手回应' });
  }

  // 处理悔棋回应
  async handleUndoResponse(socketId, accepted, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return;

    const game = this.games.get(user.game);
    if (!game || !game.pendingUndoRequest) {
      const socket = this.userManager.getSocketByAccountId(user.accountId);
      if (socket) socket.emit('error', { message: '没有待处理的悔棋请求' });
      return;
    }

    const requesterId = game.pendingUndoRequest.requesterId;
    const requesterSocket = this.userManager.getSocketByAccountId(requesterId);

    if (!accepted) {
      // 拒绝悔棋
      game.pendingUndoRequest = null;
      if (requesterSocket) {
        requesterSocket.emit('undo_rejected', { message: '对手拒绝了悔棋请求' });
      }
      const responderSocket = this.userManager.getSocketByAccountId(user.accountId);
      if (responderSocket) responderSocket.emit('undo_rejected', { message: '已拒绝悔棋请求' });
      return;
    }

    // 同意悔棋 - 执行悔棋逻辑
    game.pendingUndoRequest = null;

    // 需要撤销双方最近的一步
    const success = this.executeUndoMove(game, requesterId, io);
    if (success) {
      // 通知双方悔棋成功（附带完整棋盘数据供客户端恢复）
      const gameType = game.gameType || 'gobang';
      const undoData = {
        gameId: game.gameId,
        board: game.board,
        currentPlayer: game.currentPlayer,
        moveCount: game.moves.length,
        gameType: gameType,
        isAI: false
      };

      // 发送更新给双方玩家
      const player1Socket = this.userManager.getSocketByAccountId(game.player1);
      const player2Socket = this.userManager.getSocketByAccountId(game.player2);

      if (player1Socket) player1Socket.emit('undo_accepted', undoData);
      if (player2Socket) player2Socket.emit('undo_accepted', undoData);

      // 扣除请求者的悔棋次数
      const requesterSocket = this.userManager.getSocketByAccountId(requesterId);
      if (requesterSocket) {
        requesterSocket.emit('undo_deduct', { success: true });
        // 服务器端扣除悔棋次数
        await this.deductUndoCount(requesterId, requesterSocket);
      }
    }
  }

  // 执行悔棋（撤销双方各一步）
  executeUndoMove(game, requesterId, io) {
    if (!game || !game.moves || game.moves.length < 2) {
      const socket = this.userManager.getSocketByAccountId(requesterId);
      if (socket) socket.emit('error', { message: '没有可以悔棋的步骤' });
      return false;
    }

    // 执行实际撤销（在服务器棋盘数据上）
    const lastMove = game.moves.pop();
    const prevMove = game.moves.pop();
    if (!lastMove || !prevMove) return false;

    // 还原服务器棋盘状态
    this.revertMove(game.gameType || 'gobang', game.board, lastMove);
    this.revertMove(game.gameType || 'gobang', game.board, prevMove);

    // 更新当前玩家为请求悔棋的玩家
    game.currentPlayer = game.player1 === requesterId ? 1 : 2;

    // 清除游戏结束状态
    game.status = 'playing';

    return true;
  }

  // 撤销落子
  revertMove(gameType, board, move) {
    switch (gameType) {
      case 'gobang':
        if (move.position && move.position.r !== undefined) {
          board[move.position.r][move.position.c] = 0;
        }
        break;
      case 'go':
        if (move.position && move.position.r !== undefined) {
          board[move.position.r][move.position.c] = 0;
        }
        break;
      case 'chinese-chess':
        if (move.position && move.position.fromR !== undefined) {
          // 恢复被吃掉的棋子
          board[move.position.fromR][move.position.fromC] = board[move.position.toR][move.position.toC];
          if (move.captured) {
            board[move.position.toR][move.position.toC] = move.captured;
          } else {
            board[move.position.toR][move.position.toC] = 0;
          }
        }
        break;
    }
  }

  // AI游戏直接悔棋
  async executeUndoAIGame(accountId, io) {
    const aiGame = this.aiGames.get(accountId);
    if (!aiGame || !aiGame.moves || aiGame.moves.length < 2) {
      const socket = this.userManager.getSocketByAccountId(accountId);
      if (socket) socket.emit('error', { message: '没有可以悔棋的步骤' });
      return;
    }

    // 撤销最后两步（玩家的最后一步和AI的最后一步）
    const lastMove = aiGame.moves.pop();
    const prevMove = aiGame.moves.pop();

    this.revertMove(aiGame.gameType, aiGame.board, lastMove);
    this.revertMove(aiGame.gameType, aiGame.board, prevMove);

    aiGame.currentPlayer = 1; // 玩家回合
    aiGame.status = 'playing';
    aiGame.lastMoveTime = Date.now();

    // 发送更新给客户端
    const socket = this.userManager.getSocketByAccountId(accountId);
    if (socket) {
      const undoData = {
        board: aiGame.board,
        currentPlayer: 1,
        moveCount: aiGame.moves.length,
        isAI: true
      };

      // 象棋需要额外信息
      if (aiGame.gameType === 'chinese-chess') {
        undoData.board = aiGame.board;
      }

      socket.emit('undo_accepted', undoData);
      socket.emit('undo_deduct', { success: true });

      // 服务器端扣除悔棋次数
      await this.deductUndoCount(accountId, socket);
    }
  }

  // 扣除悔棋次数
  async deductUndoCount(accountId, socket) {
    if (!this.accountManager) return;
    try {
      const account = await this.accountManager.getAccount(accountId);
      if (account && account.inventory && account.inventory.undoCount > 0) {
        account.inventory.undoCount -= 1;
        await this.accountManager._saveAccount(accountId, account);
      }
    } catch (err) {
      logger.warn('扣除悔棋次数失败', { error: err.message });
    }
  }

  // ========== 提示系统 ==========

  // 处理提示请求
  async handleHintRequest(socketId, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return;

    if (!this.aiManager) {
      const socket = this.userManager.getSocketByAccountId(user.accountId);
      if (socket) socket.emit('error', { message: 'AI系统不可用' });
      return;
    }

    // 查找游戏
    let game = null;
    let gameType = null;
    let board = null;
    let currentPlayer = null;

    // 检查AI游戏
    const aiGame = this.aiGames.get(user.accountId);
    if (aiGame) {
      game = aiGame;
      gameType = aiGame.gameType;
      board = aiGame.board;
      currentPlayer = 1; // 玩家视角
    }

    // 检查联机游戏
    if (!game) {
      const onlineGame = this.games.get(user.game);
      if (onlineGame) {
        game = onlineGame;
        gameType = onlineGame.gameType;
        board = onlineGame.board;
        // 提示给请求者最佳位置（基于当前局面）
        currentPlayer = onlineGame.player1 === user.accountId ? 1 : 2;
      }
    }

    if (!game) {
      const socket = this.userManager.getSocketByAccountId(user.accountId);
      if (socket) socket.emit('error', { message: '当前没有进行中的游戏' });
      return;
    }

    // 使用AI计算最佳移动（智能提示）
    let hintData = null;

    // 将棋盘转为适用AIManager的格式
    const aiBoard = board.map(row => Array.isArray(row) ? [...row] : row);

    try {
      // 使用智能提示系统 - 按战局优先级分析并返回说明
      hintData = this.aiManager.getSmartHint(gameType, aiBoard, currentPlayer);

      if (hintData && hintData.move) {
        const socket = this.userManager.getSocketByAccountId(user.accountId);
        if (socket) {
          // 发送提示结果，包含：位置、类型、说明
          socket.emit('hint_result', {
            move: hintData.move,
            gameType: gameType,
            reason: hintData.reason,
            hintType: hintData.type
          });

          // 扣除提示次数
          if (this.accountManager && user.accountId) {
            try {
              const account = await this.accountManager.getAccount(user.accountId);
              if (account && account.inventory && account.inventory.hintCount > 0) {
                account.inventory.hintCount -= 1;
                await this.accountManager._saveAccount(user.accountId, account);
                socket.emit('hint_deduct', { success: true, hintCount: account.inventory.hintCount });
              } else {
                socket.emit('hint_deduct', { success: false, message: '提示次数不足' });
              }
            } catch (err) {
              logger.warn('扣除提示次数失败', { error: err.message });
              socket.emit('hint_deduct', { success: false, message: '扣除次数失败' });
            }
          } else {
            socket.emit('hint_deduct', { success: true });
          }
        }
      } else {
        const socket = this.userManager.getSocketByAccountId(user.accountId);
        if (socket) socket.emit('error', { message: '无法计算提示位置' });
      }
    } catch (err) {
      logger.error('提示计算失败', { error: err.message });
      const socket = this.userManager.getSocketByAccountId(user.accountId);
      if (socket) socket.emit('error', { message: '提示计算失败' });
    }
  }
}

module.exports = GameManager;
