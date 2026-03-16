// ChatManager.js - 聊天管理模块
const logger = require('../utils/logger');

class ChatManager {
  constructor(userManager, gameManager, accountManager) {
    this.userManager = userManager;
    this.gameManager = gameManager;
    this.accountManager = accountManager;
    this.globalChatHistory = []; // 全局聊天记录
    this.gameChatHistory = new Map(); // gameId -> 聊天记录
    this.maxHistoryLength = 100; // 最大保存消息数
    this.muteList = new Map(); // 被禁言用户列表 -> { reason, expiresAt, timeoutId }
    this.messageRateLimit = new Map(); // 用户消息频率限制
  }

  // 处理全局聊天消息
  handleGlobalChat(socketId, data, io) {
    const user = this.userManager.getUserBySocketId(socketId);
    if (!user) return { success: false, message: '用户不存在' };

    // 检查是否被禁言
    const muteInfo = this.muteList.get(user.userId);
    if (muteInfo) {
      const remaining = Math.max(0, Math.ceil((muteInfo.expiresAt - Date.now()) / 1000 / 60));
      let message = '您已被禁言';
      if (remaining > 0 && remaining < 365 * 24 * 60) {
        message += `，剩余 ${remaining} 分钟`;
      }
      if (muteInfo.reason) {
        message += `，原因：${muteInfo.reason}`;
      }
      return { success: false, message };
    }

    // 检查消息频率
    if (!this.checkRateLimit(user.userId)) {
      return { success: false, message: '发送消息过于频繁，请稍后再试' };
    }

    const { message, type = 'text' } = data;

    // 验证消息
    if (!this.validateMessage(message)) {
      return { success: false, message: '消息内容无效' };
    }

    const chatMessage = {
      id: this.generateMessageId(),
      userId: user.userId,
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

    // 广播消息
    io.emit('chat_message', {
      scope: 'global',
      ...chatMessage
    });

    logger.chatEvent(user.userId, '大厅', { messageLength: message.length });

    // 更新聊天消息统计
    this.updateChatMessageCount(user.userId);

    return { success: true };
  }

  // 更新用户聊天消息统计
  async updateChatMessageCount(userId) {
    try {
      const accountId = this.userManager.userIdToAccountId.get(userId);
      if (accountId && this.accountManager) {
        await this.accountManager.updateChatMessages(accountId);
      }
    } catch (err) {
      logger.error('更新聊天消息统计失败', { userId, error: err.message });
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
    const muteInfo = this.muteList.get(user.userId);
    if (muteInfo) {
      const remaining = Math.max(0, Math.ceil((muteInfo.expiresAt - Date.now()) / 1000 / 60));
      let message = '您已被禁言';
      if (remaining > 0 && remaining < 365 * 24 * 60) {
        message += `，剩余 ${remaining} 分钟`;
      }
      if (muteInfo.reason) {
        message += `，原因：${muteInfo.reason}`;
      }
      return { success: false, message };
    }

    const game = this.gameManager.getGameById(user.game);
    if (!game) {
      return { success: false, message: '游戏不存在' };
    }

    const { message, type = 'text' } = data;

    // 验证消息
    if (!this.validateMessage(message)) {
      return { success: false, message: '消息内容无效' };
    }

    const chatMessage = {
      id: this.generateMessageId(),
      userId: user.userId,
      nickname: user.nickname,
      message: this.sanitizeMessage(message),
      type,
      timestamp: Date.now()
    };

    // 保存到游戏聊天记录
    if (!this.gameChatHistory.has(game.gameId)) {
      this.gameChatHistory.set(game.gameId, []);
    }
    const gameChat = this.gameChatHistory.get(game.gameId);
    gameChat.push(chatMessage);
    if (gameChat.length > this.maxHistoryLength) {
      gameChat.shift();
    }

    // 发送给游戏内玩家和观战者
    const socket1 = this.userManager.getSocketByUserId(game.player1);
    const socket2 = this.userManager.getSocketByUserId(game.player2);

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

    logger.chatEvent(user.userId, '局内', { gameId: game.gameId, messageLength: message.length });

    // 更新聊天消息统计
    this.updateChatMessageCount(user.userId);

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

    const targetSocket = this.userManager.getSocketByUserId(targetUserId);
    if (!targetSocket) {
      return { success: false, message: '对方不在线' };
    }

    const chatMessage = {
      id: this.generateMessageId(),
      fromUserId: user.userId,
      fromNickname: user.nickname,
      message: this.sanitizeMessage(message),
      timestamp: Date.now()
    };

    // 发送给目标用户
    targetSocket.emit('private_message', chatMessage);

    // 发送给自己（确认发送成功）
    const senderSocket = this.userManager.getSocketByUserId(user.userId);
    if (senderSocket) {
      senderSocket.emit('private_message_sent', {
        toUserId: targetUserId,
        ...chatMessage
      });
    }

    return { success: true };
  }

  // 获取全局聊天记录
  getGlobalChatHistory(limit = 50) {
    return this.globalChatHistory.slice(-limit);
  }

  // 获取游戏聊天记录
  getGameChatHistory(gameId, limit = 50) {
    const history = this.gameChatHistory.get(gameId);
    return history ? history.slice(-limit) : [];
  }

  // 禁言用户
  muteUser(userId, duration = 3600000, reason = '') { // 默认1小时
    // 如果用户已被禁言，先清理之前的定时器
    const existingMute = this.muteList.get(userId);
    if (existingMute && existingMute.timeoutId) {
      clearTimeout(existingMute.timeoutId);
    }

    const expiresAt = Date.now() + duration;

    // 定时解除禁言
    const timeoutId = setTimeout(() => {
      this.muteList.delete(userId);
    }, duration);

    this.muteList.set(userId, {
      reason: reason,
      expiresAt: expiresAt,
      timeoutId: timeoutId
    });

    logger.info('用户被禁言', { userId, duration, reason });
    return true;
  }

  // 解除禁言
  unmuteUser(userId) {
    const muteInfo = this.muteList.get(userId);
    if (muteInfo && muteInfo.timeoutId) {
      clearTimeout(muteInfo.timeoutId);
    }
    this.muteList.delete(userId);
    logger.info('用户解除禁言', { userId });
    return true;
  }

  // 检查消息频率限制
  checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = this.messageRateLimit.get(userId);

    if (!userLimit) {
      this.messageRateLimit.set(userId, { count: 1, lastTime: now });
      return true;
    }

    // 1分钟内最多发送20条消息
    if (now - userLimit.lastTime > 60000) {
      this.messageRateLimit.set(userId, { count: 1, lastTime: now });
      return true;
    }

    if (userLimit.count >= 20) {
      return false;
    }

    userLimit.count++;
    return true;
  }

  // 验证消息
  validateMessage(message) {
    if (!message || typeof message !== 'string') return false;
    if (message.trim().length === 0) return false;
    if (message.length > 500) return false; // 最大500字符
    return true;
  }

  // 清理消息中的危险内容
  sanitizeMessage(message) {
    return message
      .trim()
      .substring(0, 500)
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
      userId: u.userId,
      nickname: u.nickname
    }));
  }
}

module.exports = ChatManager;
