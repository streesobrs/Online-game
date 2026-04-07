// AdminManager.js - 后台管理模块
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class AdminManager {
  constructor(userManager, gameManager, chatManager, accountManager = null) {
    this.userManager = userManager;
    this.gameManager = gameManager;
    this.chatManager = chatManager;
    this.accountManager = accountManager;
    this.adminSockets = new Map(); // socketId -> admin信息
    this.activeTokens = new Map(); // token -> {createdAt, lastUsed, socketIds}
    this.systemStats = {
      serverStartTime: Date.now(),
      totalRequests: 0,
      totalErrors: 0
    };

    // 清理过期Token的定时任务
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, 5 * 60 * 1000); // 每5分钟清理一次
  }

  // 生成动态管理员Token
  generateDynamicToken() {
    if (!config.admin.enableDynamicTokens) {
      return config.admin.token; // 回退到静态Token
    }

    const token = crypto.randomBytes(32).toString('hex');
    const tokenInfo = {
      token: token,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      socketIds: new Set()
    };

    this.activeTokens.set(token, tokenInfo);
    logger.info('生成动态管理员Token', { token: token.substr(0, 8) + '...' });
    return token;
  }

  // 验证管理员token
  verifyToken(token) {
    // 首先检查静态Token
    if (token === config.admin.token) {
      return true;
    }

    // 检查动态Token
    const tokenInfo = this.activeTokens.get(token);
    if (!tokenInfo) {
      return false;
    }

    // 检查Token是否过期
    if (Date.now() - tokenInfo.createdAt > config.admin.tokenExpiry) {
      this.activeTokens.delete(token);
      logger.info('管理员Token已过期', { token: token.substr(0, 8) + '...' });
      return false;
    }

    // 更新最后使用时间
    tokenInfo.lastUsed = Date.now();
    return true;
  }

  // 清理过期Token
  cleanupExpiredTokens() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [token, tokenInfo] of this.activeTokens.entries()) {
      if (now - tokenInfo.createdAt > config.admin.tokenExpiry) {
        this.activeTokens.delete(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.info('清理过期Token', { count: cleanedCount });
    }
  }

  // 检查会话限制
  checkSessionLimit(token) {
    const tokenInfo = this.activeTokens.get(token);
    if (!tokenInfo) return true; // 静态Token无限制

    return tokenInfo.socketIds.size < config.admin.maxActiveSessions;
  }

  // 处理管理员连接
  handleAdminConnection(socket, token, io) {
    if (!this.verifyToken(token)) {
      socket.emit('auth_error', { message: '认证失败，无效的token' });
      socket.disconnect();
      return false;
    }

    // 检查会话限制
    if (!this.checkSessionLimit(token)) {
      socket.emit('auth_error', { message: '已达到最大活跃会话数，请先关闭其他会话' });
      socket.disconnect();
      return false;
    }

    const adminInfo = {
      socketId: socket.id,
      token: token,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      ip: socket.handshake.address,
      io
    };

    // 记录会话
    if (token !== config.admin.token) {
      const tokenInfo = this.activeTokens.get(token);
      if (tokenInfo) {
        tokenInfo.socketIds.add(socket.id);
        tokenInfo.lastUsed = Date.now();
      }
    }

    this.adminSockets.set(socket.id, adminInfo);
    logger.info('管理员连接', { socketId: socket.id, ip: adminInfo.ip, token: token.substr(0, 8) + '...' });

    // 发送初始数据
    this.sendAdminData(socket);

    // 设置定时更新和活动检查
    const updateInterval = setInterval(() => {
      if (socket.connected) {
        this.sendAdminData(socket);
        this.checkAdminActivity(socket);
      } else {
        clearInterval(updateInterval);
      }
    }, config.admin.updateInterval);

    socket.adminInterval = updateInterval;

    return true;
  }

  // 检查管理员活动状态
  checkAdminActivity(socket) {
    const adminInfo = this.adminSockets.get(socket.id);
    if (!adminInfo) return;

    const inactivityTime = Date.now() - adminInfo.lastActivity;
    if (inactivityTime > 30 * 60 * 1000) { // 30分钟无活动
      logger.info('管理员会话因长时间无活动而断开', { socketId: socket.id });
      socket.emit('auth_error', { message: '会话因长时间无活动已断开' });
      socket.disconnect();
    }
  }

  // 发送管理数据
  async sendAdminData(socket) {
    const users = this.userManager.getAllUsers();
    const games = this.gameManager.getAllGames();
    const waitingUsers = this.gameManager.getWaitingUsers();
    const spectatableGames = this.gameManager.getSpectatableGames();

    // 用户统计
    const userStats = {
      total: users.length,
      online: users.length,  // 所有连接的用户都算在线
      waiting: users.filter(u => u.status === 'waiting').length,
      playing: users.filter(u => u.status === 'playing').length,
      spectating: users.filter(u => u.status === 'spectating').length
    };

    // 游戏统计
    const gameStats = {
      total: games.length,
      active: games.filter(g => g.status === 'playing').length,
      ended: games.filter(g => g.status === 'ended').length,
      byType: {
        gobang: games.filter(g => g.gameType === 'gobang').length,
        go: games.filter(g => g.gameType === 'go').length,
        chess: games.filter(g => g.gameType === 'chess').length,
        snake: games.filter(g => g.gameType === 'snake').length
      }
    };

    // 等待队列统计
    const waitingStats = {};
    for (const [gameType, userIds] of Object.entries(waitingUsers)) {
      waitingStats[gameType] = userIds.length;
    }

    // 系统信息
    const systemInfo = {
      uptime: Date.now() - this.systemStats.serverStartTime,
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      nodeVersion: process.version,
      platform: process.platform
    };

    // 获取账号数据（如果账号管理器可用）
    let accounts = [];
    let accountMap = new Map();
    if (this.accountManager) {
      try {
        accounts = await this.accountManager.getAllAccounts();
        // 创建账号ID到账号对象的映射
        accounts.forEach(account => {
          accountMap.set(account.id, account);
        });
      } catch (err) {
        console.error('获取账号数据失败:', err);
      }
    }

    socket.emit('admin_update', {
      timestamp: Date.now(),
      stats: {
        users: userStats,
        games: gameStats,
        waiting: waitingStats,
        system: systemInfo,
        totalConnections: this.userManager.getSystemStats().totalConnections,
        peakOnline: this.userManager.getSystemStats().peakOnline
      },
      users: users.map(u => {
        let muted = false;
        let muteInfo = null;
        if (this.chatManager) {
          muteInfo = this.chatManager.muteList.get(u.userId);
          muted = !!muteInfo;
        }
        
        // 获取用户关联的账号信息
        let account = null;
        const accountId = this.userManager.getAccountIdByUserId(u.userId);
        if (accountId) {
          account = accountMap.get(accountId);
        }
        
        return {
          userId: u.userId,
          nickname: u.nickname,
          status: u.status,
          gameType: u.gameType,
          game: u.game,
          connectedAt: u.connectedAt,
          lastActivity: u.lastActivity,
          stats: u.stats,
          ip: u.ip,
          muted: muted,
          muteInfo: muteInfo ? {
            reason: muteInfo.reason,
            expiresAt: muteInfo.expiresAt,
            remainingMinutes: muteInfo.expiresAt ? Math.max(0, Math.ceil((muteInfo.expiresAt - Date.now()) / 1000 / 60)) : null
          } : null,
          account: account // 添加关联的账号信息
        };
      }),
      games: games.map(g => ({
        gameId: g.gameId,
        gameType: g.gameType,
        player1: g.player1,
        player2: g.player2,
        status: g.status,
        moveCount: g.moveCount,
        startTime: g.startTime,
        spectatorCount: g.spectatorCount
      })),
      spectatableGames,
      waitingQueue: waitingUsers,
      accounts: accounts
    });
  }

  // 踢出用户
  kickUser(socket, userId, reason = '管理员操作') {
    const success = this.userManager.kickUser(userId, reason);

    if (success) {
      logger.info('管理员踢出用户', { adminSocket: socket.id, userId, reason });
      socket.emit('admin_action_result', {
        action: 'kick_user',
        success: true,
        userId,
        message: `用户 ${userId} 已被踢出`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'kick_user',
        success: false,
        userId,
        message: '踢出用户失败，用户可能已离线'
      });
    }
  }

  // 结束游戏
  endGame(socket, gameId) {
    const adminInfo = this.adminSockets.get(socket.id);
    const io = adminInfo ? adminInfo.io : null;
    const success = io ? this.gameManager.adminEndGame(gameId, io) : false;

    if (success) {
      logger.info('管理员结束游戏', { adminSocket: socket.id, gameId });
      socket.emit('admin_action_result', {
        action: 'end_game',
        success: true,
        gameId,
        message: `游戏 ${gameId} 已结束`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'end_game',
        success: false,
        gameId,
        message: '结束游戏失败，游戏可能已结束或不存在'
      });
    }
  }

  // 广播消息
  broadcastMessage(socket, message, io) {
    if (!message || message.trim().length === 0) {
      socket.emit('admin_action_result', {
        action: 'broadcast',
        success: false,
        message: '消息内容不能为空'
      });
      return;
    }

    // 广播给所有用户
    io.emit('system_broadcast', {
      message: message.trim(),
      timestamp: Date.now(),
      from: '管理员'
    });

    logger.info('管理员广播消息', { adminSocket: socket.id, message: message.trim() });

    socket.emit('admin_action_result', {
      action: 'broadcast',
      success: true,
      message: '消息已广播给所有用户'
    });
  }

  // 获取系统日志
  async getSystemLogs(socket, options = {}) {
    try {
      const { level = 'all', limit = 100, startTime, endTime } = options;

      // 这里可以从日志文件读取
      // 简化版本：返回最近的系统事件
      const logs = [];

      socket.emit('admin_logs', {
        logs,
        total: logs.length
      });
    } catch (err) {
      logger.error('获取系统日志失败', { error: err.message });
      socket.emit('admin_action_result', {
        action: 'get_logs',
        success: false,
        message: '获取日志失败'
      });
    }
  }

  // 获取排行榜数据
  async getLeaderboard(socket, limit = 10) {
    try {
      const leaderboard = await this.userManager.getLeaderboard(limit);

      socket.emit('admin_leaderboard', {
        leaderboard,
        timestamp: Date.now()
      });
    } catch (err) {
      logger.error('获取排行榜失败', { error: err.message });
      socket.emit('admin_action_result', {
        action: 'get_leaderboard',
        success: false,
        message: '获取排行榜失败'
      });
    }
  }

  // 获取历史游戏记录
  async getGameHistory(socket, options = {}) {
    try {
      const { limit = 50, gameType, startDate, endDate } = options;

      let games = await dataStore.read('games');

      // 筛选
      if (gameType) {
        games = games.filter(g => g.gameType === gameType);
      }
      if (startDate) {
        games = games.filter(g => g.startTime >= startDate);
      }
      if (endDate) {
        games = games.filter(g => g.endTime <= endDate);
      }

      // 排序和限制
      games = games
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, limit);

      socket.emit('admin_game_history', {
        games,
        total: games.length
      });
    } catch (err) {
      logger.error('获取游戏历史失败', { error: err.message });
      socket.emit('admin_action_result', {
        action: 'get_game_history',
        success: false,
        message: '获取游戏历史失败'
      });
    }
  }

  // 系统配置管理
  getSystemConfig(socket) {
    socket.emit('admin_config', {
      config: {
        server: config.server,
        game: config.game,
        admin: {
          updateInterval: config.admin.updateInterval
        }
      }
    });
  }

  // 更新系统配置（部分配置支持热更新）
  updateSystemConfig(socket, updates) {
    // 这里可以实现配置热更新
    // 注意：某些配置需要重启服务器才能生效

    logger.info('管理员更新配置', { adminSocket: socket.id, updates });

    socket.emit('admin_action_result', {
      action: 'update_config',
      success: true,
      message: '配置已更新（部分配置可能需要重启服务器）'
    });
  }

  // 系统维护模式
  setMaintenanceMode(socket, enabled, message = '系统维护中', io) {
    if (enabled) {
      // 通知所有用户
      io.emit('maintenance_notice', {
        enabled: true,
        message,
        timestamp: Date.now()
      });

      logger.info('系统进入维护模式', { adminSocket: socket.id, message });
    } else {
      io.emit('maintenance_notice', {
        enabled: false,
        timestamp: Date.now()
      });

      logger.info('系统退出维护模式', { adminSocket: socket.id });
    }

    socket.emit('admin_action_result', {
      action: 'maintenance_mode',
      success: true,
      enabled,
      message: enabled ? '系统已进入维护模式' : '系统已退出维护模式'
    });
  }

  // 禁言用户
  muteUser(socket, userId, duration = 10, reason = '') {
    if (!this.chatManager) {
      socket.emit('admin_action_result', {
        action: 'mute_user',
        success: false,
        message: '聊天管理器不可用'
      });
      return;
    }

    const durationMs = duration === 0 ? 24 * 60 * 60 * 1000 * 365 : duration * 60 * 1000;
    const success = this.chatManager.muteUser(userId, durationMs, reason);

    if (success) {
      logger.info('管理员禁言用户', { adminSocket: socket.id, userId, duration, reason });
      socket.emit('admin_action_result', {
        action: 'mute_user',
        success: true,
        userId,
        message: `用户 ${userId} 已被禁言 ${duration} 分钟${reason ? `，原因：${reason}` : ''}`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'mute_user',
        success: false,
        userId,
        message: '禁言失败'
      });
    }
  }

  // 解除禁言
  unmuteUser(socket, userId) {
    if (!this.chatManager) {
      socket.emit('admin_action_result', {
        action: 'unmute_user',
        success: false,
        message: '聊天管理器不可用'
      });
      return;
    }

    const success = this.chatManager.unmuteUser(userId);

    if (success) {
      logger.info('管理员解除禁言', { adminSocket: socket.id, userId });
      socket.emit('admin_action_result', {
        action: 'unmute_user',
        success: true,
        userId,
        message: `用户 ${userId} 已解除禁言`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'unmute_user',
        success: false,
        userId,
        message: '解除禁言失败'
      });
    }
  }

  // 清理数据
  async cleanupData(socket, options = {}) {
    try {
      const { oldGames = false, oldLogs = false, inactiveUsers = false } = options;
      let cleaned = 0;

      if (oldGames) {
        // 清理旧的游戏记录（30天前）
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const games = await dataStore.read('games');
        const oldGameIds = games
          .filter(g => g.endTime && g.endTime < thirtyDaysAgo)
          .map(g => g.gameId);

        for (const gameId of oldGameIds) {
          await dataStore.delete('games', gameId);
          cleaned++;
        }
      }

      logger.info('管理员清理数据', { adminSocket: socket.id, cleaned });

      socket.emit('admin_action_result', {
        action: 'cleanup_data',
        success: true,
        cleaned,
        message: `已清理 ${cleaned} 条记录`
      });
    } catch (err) {
      logger.error('清理数据失败', { error: err.message });
      socket.emit('admin_action_result', {
        action: 'cleanup_data',
        success: false,
        message: '清理数据失败'
      });
    }
  }

  // 获取系统统计
  async getSystemStats(socket) {
    try {
      const users = await dataStore.read('users');
      const games = await dataStore.read('games');
      const userStats = this.userManager.getSystemStats();
      const allGames = this.gameManager.getAllGames();
      const activeGames = allGames.filter(g => g.status === 'playing');

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayUsers = users.filter(u => {
        const lastLogin = u.lastLogin || u.lastSeen;
        return lastLogin && new Date(lastLogin) >= today;
      }).length;

      const stats = {
        totalUsers: users.length,
        onlineUsers: userStats.onlineUsers || 0,
        activeGames: activeGames.length,
        totalGames: games.length,
        todayUsers: todayUsers,
        peakOnline: userStats.peakOnline || 0,
        totalConnections: userStats.totalConnections || 0,
        totalRegisteredUsers: users.length,
        totalGamesPlayed: games.length,
        gamesByType: {
          gobang: games.filter(g => g.gameType === 'gobang').length,
          go: games.filter(g => g.gameType === 'go').length,
          chess: games.filter(g => g.gameType === 'chess').length
        },
        averageGameDuration: games.length > 0
          ? Math.round(games.reduce((sum, g) => sum + (g.duration || 0), 0) / games.length)
          : 0,
        topPlayers: users
          .sort((a, b) => (b.stats?.wins || 0) - (a.stats?.wins || 0))
          .slice(0, 5)
          .map(u => ({
            id: u.id,
            nickname: u.nickname,
            wins: u.stats?.wins || 0
          }))
      };

      socket.emit('admin_system_stats', stats);
    } catch (err) {
      logger.error('获取系统统计失败', { error: err.message });
    }
  }

  // 处理管理员断开连接
  handleAdminDisconnect(socket) {
    if (socket.adminInterval) {
      clearInterval(socket.adminInterval);
    }

    const adminInfo = this.adminSockets.get(socket.id);
    if (adminInfo) {
      // 清理Token会话记录
      if (adminInfo.token && adminInfo.token !== config.admin.token) {
        const tokenInfo = this.activeTokens.get(adminInfo.token);
        if (tokenInfo) {
          tokenInfo.socketIds.delete(socket.id);
          // 如果该Token没有活跃会话，可以清理
          if (tokenInfo.socketIds.size === 0) {
            logger.info('动态Token无活跃会话', { token: adminInfo.token.substr(0, 8) + '...' });
          }
        }
      }
    }

    this.adminSockets.delete(socket.id);
    logger.info('管理员断开连接', { socketId: socket.id });
  }

  // 获取用户详情
  getUserDetail(socket, userId) {
    const user = this.userManager.getUserByUserId(userId);
    if (!user) {
      socket.emit('admin_action_result', {
        action: 'get_user_detail',
        success: false,
        message: '用户不存在'
      });
      return;
    }

    let muted = false;
    let muteInfo = null;
    if (this.chatManager) {
      muteInfo = this.chatManager.muteList.get(userId);
      muted = !!muteInfo;
    }

    socket.emit('admin_user_detail', {
      userId: user.userId,
      nickname: user.nickname,
      status: user.status,
      gameType: user.gameType,
      game: user.game,
      connectedAt: user.connectedAt,
      lastActivity: user.lastActivity,
      ip: user.ip,
      stats: user.stats,
      muted: muted,
      muteInfo: muteInfo ? {
        reason: muteInfo.reason,
        expiresAt: muteInfo.expiresAt,
        remainingMinutes: muteInfo.expiresAt ? Math.max(0, Math.ceil((muteInfo.expiresAt - Date.now()) / 1000 / 60)) : null
      } : null
    });
  }

  // 获取用户游戏历史
  async getUserGameHistory(socket, userId, limit = 20) {
    try {
      const games = await dataStore.read('games');
      const userGames = games
        .filter(g => g.player1 === userId || g.player2 === userId)
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, limit);

      socket.emit('admin_user_game_history', {
        userId,
        games: userGames
      });
    } catch (err) {
      logger.error('获取用户游戏历史失败', { error: err.message });
      socket.emit('admin_action_result', {
        action: 'get_user_game_history',
        success: false,
        message: '获取用户游戏历史失败'
      });
    }
  }

  // 获取聊天记录
  getChatHistory(socket, options = {}) {
    if (!this.chatManager) {
      socket.emit('admin_action_result', {
        action: 'get_chat_history',
        success: false,
        message: '聊天管理器不可用'
      });
      return;
    }

    const { scope = 'global', gameId, limit = 50 } = options;
    let messages = [];

    if (scope === 'all') {
      // 获取所有类型的聊天记录
      const globalMessages = this.chatManager.globalChatHistory.slice(-limit).map(msg => ({
        ...msg,
        type: 'global',
        senderNickname: msg.nickname,
        sender: msg.userId
      }));

      const gameMessages = [];
      for (const [gameId, gameChat] of this.chatManager.gameChatHistory.entries()) {
        const gameMsgs = gameChat.slice(-limit).map(msg => ({
          ...msg,
          type: 'game',
          gameId: gameId,
          senderNickname: msg.nickname,
          sender: msg.userId
        }));
        gameMessages.push(...gameMsgs);
      }

      messages = [...globalMessages, ...gameMessages].sort((a, b) => b.timestamp - a.timestamp).slice(-limit * 2);
    } else if (scope === 'global') {
      messages = this.chatManager.globalChatHistory.slice(-limit).map(msg => ({
        ...msg,
        type: 'global',
        senderNickname: msg.nickname,
        sender: msg.userId
      }));
    } else if (scope === 'game' && gameId) {
      messages = (this.chatManager.gameChatHistory.get(gameId) || []).slice(-limit).map(msg => ({
        ...msg,
        type: 'game',
        gameId: gameId,
        senderNickname: msg.nickname,
        sender: msg.userId
      }));
    }

    socket.emit('admin_chat_history', {
      scope,
      gameId,
      history: messages
    });
  }

  // 给特定用户发送消息
  sendUserMessage(socket, userId, message) {
    const userSocket = this.userManager.getSocketByUserId(userId);
    if (!userSocket) {
      socket.emit('admin_action_result', {
        action: 'send_user_message',
        success: false,
        message: '用户不在线'
      });
      return;
    }

    userSocket.emit('admin_message', {
      message,
      timestamp: Date.now(),
      from: '管理员'
    });

    logger.info('管理员给用户发送消息', { adminSocket: socket.id, userId, message });

    socket.emit('admin_action_result', {
      action: 'send_user_message',
      success: true,
      message: `消息已发送给用户 ${userId}`
    });
  }

  // 强制重置游戏
  resetGame(socket, gameId) {
    const adminInfo = this.adminSockets.get(socket.id);
    const io = adminInfo ? adminInfo.io : null;
    const success = io ? this.gameManager.adminResetGame(gameId, io) : false;

    if (success) {
      logger.info('管理员重置游戏', { adminSocket: socket.id, gameId });
      socket.emit('admin_action_result', {
        action: 'reset_game',
        success: true,
        gameId,
        message: `游戏 ${gameId} 已重置`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'reset_game',
        success: false,
        gameId,
        message: '重置游戏失败，游戏可能不存在'
      });
    }
  }

  // ========== 账号管理 ==========

  // 获取所有账号列表
  async getAllAccounts(socket) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'get_all_accounts',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const accounts = await this.accountManager.getAllAccounts();
    socket.emit('admin_accounts_list', { accounts });
  }

  // 删除账号
  async deleteAccount(socket, id) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'delete_account',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.deleteAccount(id);
    if (result.success) {
      // 清理UserManager中的映射关系
      if (this.userManager) {
        // 找到对应的userId
        let userId = null;
        for (const [accountId, user] of this.userManager.accountIdToUserId.entries()) {
          if (accountId === id) {
            userId = user;
            break;
          }
        }

        // 删除映射关系
        if (userId) {
          this.userManager.accountIdToUserId.delete(id);
          this.userManager.userIdToAccountId.delete(userId);
          // 从在线用户中移除
          this.userManager.onlineUsers.delete(userId);
        }
      }

      logger.info('管理员删除账号', { adminSocket: socket.id, id });
    }
    socket.emit('admin_action_result', {
      action: 'delete_account',
      ...result
    });

    // 发送账号列表更新事件
    socket.emit('admin_accounts_updated', {});
  }

  // 获取账号详情
  async getAccountDetail(socket, id) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'get_account_detail',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const account = await this.accountManager.getAccount(id);
    if (!account) {
      socket.emit('admin_action_result', {
        action: 'get_account_detail',
        success: false,
        message: '账号不存在'
      });
      return;
    }

    // 从UserManager获取映射关系
    let userId = null;
    let user = null;
    if (this.userManager) {
      userId = this.userManager.accountIdToUserId.get(id);
      user = userId ? this.userManager.getUserByUserId(userId) : null;
    }

    let muted = false;
    let muteInfo = null;
    if (user && this.chatManager) {
      muteInfo = this.chatManager.muteList.get(userId);
      muted = !!muteInfo;
    }

    socket.emit('admin_account_detail', {
      account: {
        id: account.id,
        type: account.type,
        username: account.username,
        nickname: account.nickname,
        createdAt: account.createdAt,
        lastSeen: account.lastSeen,
        lastLogin: account.lastLogin,
        stats: account.stats,
        profile: account.profile
      },
      user: user ? {
        userId: user.userId,
        nickname: user.nickname,
        status: user.status,
        gameType: user.gameType,
        game: user.game,
        connectedAt: user.connectedAt,
        lastActivity: user.lastActivity,
        ip: user.ip,
        muted: muted,
        muteInfo: muteInfo ? {
          reason: muteInfo.reason,
          expiresAt: muteInfo.expiresAt,
          remainingMinutes: muteInfo.expiresAt ? Math.max(0, Math.ceil((muteInfo.expiresAt - Date.now()) / 1000 / 60)) : null
        } : null
      } : null
    });
  }

  // 修改用户经验值
  async modifyUserExp(socket, id, operation, amount) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'modify_user_exp',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.modifyUserExp(id, operation, amount);
    logger.info('管理员修改用户经验值', { adminSocket: socket.id, id, operation, amount });
    socket.emit('admin_action_result', {
      action: 'modify_user_exp',
      ...result
    });
  }

  // 添加用户成就
  async addUserAchievement(socket, id, achievementId) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'add_user_achievement',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.addUserAchievement(id, achievementId);
    logger.info('管理员添加用户成就', { adminSocket: socket.id, id, achievementId });
    socket.emit('admin_action_result', {
      action: 'add_user_achievement',
      ...result
    });
  }

  // 移除用户成就
  async removeUserAchievement(socket, id, achievementId) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'remove_user_achievement',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.removeUserAchievement(id, achievementId);
    logger.info('管理员移除用户成就', { adminSocket: socket.id, id, achievementId });
    socket.emit('admin_action_result', {
      action: 'remove_user_achievement',
      ...result
    });
  }

  // 重置用户成就
  async resetUserAchievements(socket, id) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'reset_user_achievements',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.resetUserAchievements(id);
    logger.info('管理员重置用户成就', { adminSocket: socket.id, id });
    socket.emit('admin_action_result', {
      action: 'reset_user_achievements',
      ...result
    });
  }

  // 获取在线管理员数量
  getOnlineAdminCount() {
    return this.adminSockets.size;
  }
}

module.exports = AdminManager;
