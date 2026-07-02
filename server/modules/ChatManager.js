// ChatManager.js - 聊天管理模块
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class ChatManager {
  constructor(userManager, gameManager, accountManager) {
    this.userManager = userManager;
    this.gameManager = gameManager;
    this.accountManager = accountManager;
    this.operationLogger = null;
    this.globalChatHistory = []; // 全局聊天记录
    this.gameChatHistory = new Map(); // gameId -> 聊天记录
    this.maxHistoryLength = config.chat.maxHistoryMessages; // 最大保存消息数
    this.muteList = new Map(); // 被禁言用户列表 -> { reason, expiresAt, timeoutId }
    this.messageRateLimit = new Map(); // 用户消息频率限制
    this.init();
  }

  async init() {
    try {
      await this.loadChatHistory();
      logger.info('聊天记录加载完成');
    } catch (err) {
      logger.error('加载聊天记录失败', { error: err.message });
    }
  }

  async loadChatHistory() {
    try {
      const globalChats = await dataStore.read('globalChats');
      this.globalChatHistory = globalChats || [];

      const gameChats = await dataStore.read('gameChats');
      if (gameChats) {
        for (const [gameId, messages] of Object.entries(gameChats)) {
          this.gameChatHistory.set(gameId, messages);
        }
      }
    } catch (err) {
      logger.error('加载聊天记录失败', { error: err.message });
    }
  }

  async saveChatHistory() {
    try {
      await dataStore.write('globalChats', this.globalChatHistory);

      const gameChatsObj = {};
      for (const [gameId, messages] of this.gameChatHistory.entries()) {
        gameChatsObj[gameId] = messages;
      }
      await dataStore.write('gameChats', gameChatsObj);
    } catch (err) {
      logger.error('保存聊天记录失败', { error: err.message });
    }
  }

  // 处理全局聊天消息
  handleGlobalChat(socketId, data, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return { success: false, message: '用户不存在' };

    // 检查是否被禁言
    const muteInfo = this.muteList.get(user.accountId);
    if (muteInfo) {
      const remaining = Math.max(0, Math.ceil((muteInfo.expiresAt - Date.now()) / 1000 / 60));
      let message = '您已被禁言';
      if (remaining > 0 && remaining < config.chat.permanentMuteThresholdMinutes) {
        message += `，剩余 ${remaining} 分钟`;
      }
      if (muteInfo.reason) {
        message += `，原因：${muteInfo.reason}`;
      }
      return { success: false, message };
    }

    // 检查消息频率
    if (!this.checkRateLimit(user.accountId)) {
      return { success: false, message: '发送消息过于频繁，请稍后再试' };
    }

    const { message, type = 'text' } = data;

    // 验证消息
    if (!this.validateMessage(message)) {
      return { success: false, message: '消息内容无效' };
    }

    const chatMessage = {
      messageId: this.generateMessageId(),
      userId: user.accountId,
      nickname: user.nickname,
      message: this.sanitizeMessage(message),
      type,
      timestamp: Date.now()
    };

    // 保存到历史记录
    this.globalChatHistory.push(chatMessage);
    if (this.globalChatHistory.length > this.maxHistoryLength) {
      this.globalChatHistory.shift();
    }

    // 保存到文件
    this.saveChatHistory();

    // 广播消息
    io.emit('chat_message', {
      scope: 'global',
      ...chatMessage
    });

    logger.chatEvent(user.accountId, '大厅', { messageLength: message.length });

    // 记录操作日志
    if (this.operationLogger) {
      this.operationLogger.getChat(user.accountId, user.nickname || '', 'global', this.sanitizeMessage(message));
    }

    // 更新聊天消息统计
    this.updateChatMessageCount(user.accountId);

    return { success: true };
  }

  // 更新用户聊天消息统计
  async updateChatMessageCount(accountId) {
    try {
      if (accountId && this.accountManager) {
        await this.accountManager.updateChatMessages(accountId);
      }
    } catch (err) {
      logger.error('更新聊天消息统计失败', { accountId, error: err.message });
    }
  }

  // 处理游戏内聊天
  handleGameChat(socketId, data, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return { success: false, message: '用户不存在' };

    // 检查是否在游戏中
    if (user.status !== 'playing' && user.status !== 'spectating') {
      return { success: false, message: '您不在游戏中' };
    }

    // 检查是否被禁言
    const muteInfo = this.muteList.get(user.accountId);
    if (muteInfo) {
      const remaining = Math.max(0, Math.ceil((muteInfo.expiresAt - Date.now()) / 1000 / 60));
      let message = '您已被禁言';
      if (remaining > 0 && remaining < config.chat.permanentMuteThresholdMinutes) {
        message += `，剩余 ${remaining} 分钟`;
      }
      if (muteInfo.reason) {
        message += `，原因：${muteInfo.reason}`;
      }
      return { success: false, message };
    }

    const game = this.gameManager.getGameById(user.game);
    let targetGame = game;

    // 如果不是PvP游戏，检查是否是AI游戏
    if (!game) {
      targetGame = this.gameManager.aiGames.get(user.accountId);
    }

    if (!targetGame) {
      return { success: false, message: '游戏不存在' };
    }

    const { message, type = 'text' } = data;

    // 验证消息
    if (!this.validateMessage(message)) {
      return { success: false, message: '消息内容无效' };
    }

    const chatMessage = {
      messageId: this.generateMessageId(),
      userId: user.accountId,
      nickname: user.nickname,
      message: this.sanitizeMessage(message),
      type,
      timestamp: Date.now()
    };

    // 保存到游戏聊天记录（仅PvP游戏）
    if (game && !this.gameChatHistory.has(game.gameId)) {
      this.gameChatHistory.set(game.gameId, []);
    }
    if (game) {
      const gameChat = this.gameChatHistory.get(game.gameId);
      gameChat.push(chatMessage);
      if (gameChat.length > this.maxHistoryLength) {
        gameChat.shift();
      }
    }

    // 标记玩家在游戏中发送了消息（用于沉默杀手成就检测）
    if (!targetGame.playerChatted) {
      targetGame.playerChatted = {};
    }
    targetGame.playerChatted[user.accountId] = true;

    // 更新聊天消息统计（游戏内聊天也计入话痨成就）
    this.updateChatMessageCount(user.accountId);

    // 保存到文件
    this.saveChatHistory();

    // 发送给游戏内玩家和观战者（仅PvP游戏）
    if (game) {
      const socket1 = this.userManager.getSocketByAccountId(game.player1);
      const socket2 = this.userManager.getSocketByAccountId(game.player2);

      if (socket1) {
        socket1.emit('chat_message', {
          scope: 'game',
          gameId: game.gameId,
          ...chatMessage
        });
      }
      if (socket2) {
        socket2.emit('chat_message', {
          scope: 'game',
          gameId: game.gameId,
          ...chatMessage
        });
      }

      // 发送给观战者
      this.gameManager.broadcastToSpectators(game.gameId, 'chat_message', {
        scope: 'game',
        gameId: game.gameId,
        ...chatMessage
      }, io);
    } else {
      // AI游戏，发送给自己和所有观战者
      const userSocket = this.userManager.getSocketByAccountId(user.accountId);
      if (userSocket) {
        userSocket.emit('chat_message', {
          scope: 'game',
          gameId: targetGame.gameId,
          ...chatMessage
        });
      }

      // 发送给AI游戏的观战者
      this.gameManager.broadcastToSpectators(targetGame.gameId, 'chat_message', {
        scope: 'game',
        gameId: targetGame.gameId,
        ...chatMessage
      }, io);
    }

    logger.chatEvent(user.accountId, '局内', { gameId: targetGame.gameId, messageLength: message.length });

    // 记录操作日志
    if (this.operationLogger) {
      this.operationLogger.getChat(user.accountId, user.nickname || '', 'game', this.sanitizeMessage(message), { gameId: targetGame.gameId });
    }

    // 更新聊天消息统计
    this.updateChatMessageCount(user.accountId);

    return { success: true };
  }

  // 处理私聊
  handlePrivateChat(socketId, data, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return { success: false, message: '用户不存在' };

    const { targetUserId, message } = data;

    // 验证消息
    if (!this.validateMessage(message)) {
      return { success: false, message: '消息内容无效' };
    }

    const targetSocket = this.userManager.getSocketByAccountId(targetUserId);
    if (!targetSocket) {
      return { success: false, message: '对方不在线' };
    }

    const chatMessage = {
      messageId: this.generateMessageId(),
      fromUserId: user.accountId,
      fromNickname: user.nickname,
      message: this.sanitizeMessage(message),
      timestamp: Date.now()
    };

    // 发送给目标用户
    targetSocket.emit('private_message', chatMessage);

    // 发送给自己（确认发送成功）
    const senderSocket = this.userManager.getSocketByAccountId(user.accountId);
    if (senderSocket) {
      senderSocket.emit('private_message_sent', {
        toUserId: targetUserId,
        ...chatMessage
      });
    }

    return { success: true };
  }

  // 获取全局聊天记录
  getGlobalChatHistory(limit = config.chat.defaultHistoryLimit) {
    return this.globalChatHistory.slice(-limit);
  }

  // 获取游戏聊天记录
  getGameChatHistory(gameId, limit = config.chat.defaultHistoryLimit) {
    const history = this.gameChatHistory.get(gameId);
    return history ? history.slice(-limit) : [];
  }

  // 禁言用户
  muteUser(accountId, duration = config.chat.defaultMuteDuration, reason = '') { // 默认1小时
    // 如果用户已被禁言，先清理之前的定时器
    const existingMute = this.muteList.get(accountId);
    if (existingMute && existingMute.timeoutId) {
      clearTimeout(existingMute.timeoutId);
    }

    const expiresAt = Date.now() + duration;

    // 定时解除禁言
    const timeoutId = setTimeout(() => {
      this.muteList.delete(accountId);
    }, duration);

    this.muteList.set(accountId, {
      reason: reason,
      expiresAt: expiresAt,
      timeoutId: timeoutId
    });

    logger.info('用户被禁言', { accountId, duration, reason });
    return true;
  }

  // 解除禁言
  unmuteUser(accountId) {
    const muteInfo = this.muteList.get(accountId);
    if (muteInfo && muteInfo.timeoutId) {
      clearTimeout(muteInfo.timeoutId);
    }
    this.muteList.delete(accountId);
    logger.info('用户解除禁言', { accountId });
    return true;
  }

  // 检查消息频率限制
  checkRateLimit(accountId) {
    const now = Date.now();
    const userLimit = this.messageRateLimit.get(accountId);

    if (!userLimit) {
      this.messageRateLimit.set(accountId, { count: 1, lastTime: now });
      return true;
    }

    // 1分钟内最多发送20条消息
    if (now - userLimit.lastTime > config.chat.rateLimitWindowMs) {
      this.messageRateLimit.set(accountId, { count: 1, lastTime: now });
      return true;
    }

    if (userLimit.count >= config.chat.maxMessagesPerMinute) {
      return false;
    }

    userLimit.count++;
    return true;
  }

  // 验证消息
  validateMessage(message) {
    if (!message || typeof message !== 'string') return false;
    if (message.trim().length === 0) return false;
    if (message.length > config.chat.maxMessageLength) return false; // 最大500字符
    return true;
  }

  // 清理消息中的危险内容
  sanitizeMessage(message) {
    return message
      .trim()
      .substring(0, config.chat.maxMessageLength)
      .replace(/[<>]/g, '') // 移除HTML标签
      .replace(/\s+/g, ' '); // 合并连续空格
  }

  // 生成消息ID
  generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  // 清理游戏聊天记录
  clearGameChat(gameId) {
    this.gameChatHistory.delete(gameId);
  }

  // 获取在线用户列表（用于@功能）
  getOnlineUsers() {
    return this.userManager.getAllUsers().map(u => ({
      userId: u.accountId,
      nickname: u.nickname
    }));
  }
}

module.exports = ChatManager;
