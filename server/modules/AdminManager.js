// AdminManager.js - 后台管理模块
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');
const fs = require('fs');
const path = require('path');

class AdminManager {
  constructor(userManager, gameManager, chatManager, accountManager = null, io = null) {
    this.userManager = userManager;
    this.gameManager = gameManager;
    this.chatManager = chatManager;
    this.accountManager = accountManager;
    this.io = io;
    this.operationLogger = null;
    this.adminSockets = new Map();
    this.activeTokens = new Map();
    this.logBuffer = []; // 环形日志缓冲区
    this.logListeners = new Set(); // 当前正在接收日志的管理员socket
    this.systemStats = {
      serverStartTime: Date.now(),
      totalRequests: 0,
      totalErrors: 0
    };

    // 订阅logger，收集日志
    this._unsubLogger = logger.onLog((entry) => {
      this.logBuffer.push(entry);
      if (this.logBuffer.length > config.log.adminBufferSize) {
        this.logBuffer.shift();
      }
      // 实时转发给已订阅的管理员
      for (const sock of this.logListeners) {
        try {
          sock.emit('log_entry', entry);
        } catch (e) { /* 忽略发送失败 */ }
      }
    });

    // 清理过期Token的定时任务
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredTokens();
    }, config.admin.tokenCleanupInterval); // 每5分钟清理一次
  }

  // 生成动态管理员Token
  generateDynamicToken() {
    if (!config.admin.enableDynamicTokens) {
      return config.admin.token; // 回退到静态Token
    }

    const token = crypto.randomBytes(config.security.adminTokenBytes).toString('hex');
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

  // 通过用户Token验证并获取管理员账号（从游戏大厅/个人资料页自动登录）
  async verifyUserTokenAndGetAdminAccount(userToken) {
    logger.info('通过用户Token验证管理员身份', { hasToken: !!userToken });

    if (!this.accountManager) {
      return {
        success: false,
        message: '账号管理模块未初始化'
      };
    }

    // 验证用户Token并获取账号信息
    const accountResult = await this.accountManager.verifyTokenAndGetAccount(userToken);

    if (!accountResult.success) {
      return {
        success: false,
        message: accountResult.message || '用户Token无效或已过期'
      };
    }

    const account = accountResult.data.account;
    const accountId = account.account?.id;

    if (!accountId) {
      return {
        success: false,
        message: '账号信息不完整'
      };
    }

    // 检查账号是否有管理员标记
    const rawAccount = await dataStore.findOne('accounts', { 'account.id': accountId });
    const isAdmin = rawAccount?.account?.isAdmin;

    // 兼容旧配置：检查用户名是否在管理员列表中
    const username = account.account?.username;
    const allowedUsernames = config.admin.allowedUsernames || ['admin'];
    const isInList = username ? allowedUsernames.includes(username.toLowerCase()) : false;

    if (!isAdmin && !isInList) {
      return {
        success: false,
        message: '该账号不是管理员账号'
      };
    }

    // 生成动态Token
    const token = this.generateDynamicToken();

    logger.info('通过用户Token自动登录成功', {
      accountId,
      username
    });

    return {
      success: true,
      token: token,
      account: account
    };
  }

  // 验证账号登录（用于后台管理）
  async verifyAccountLogin(username, password) {
    logger.info('验证管理员账号登录', { username });

    // 验证账号密码
    if (!this.accountManager) {
      return {
        success: false,
        message: '账号管理模块未初始化'
      };
    }

    logger.info('调用 accountManager.login', { username });
    const account = await this.accountManager.login(username, password);
    logger.info('accountManager.login 结果', { success: account.success, message: account.message });

    if (!account.success) {
      return {
        success: false,
        message: account.message || '账号或密码错误'
      };
    }

    // 检查账号是否有管理员标记
    const rawAccount = await dataStore.findOne('accounts', { 'account.id': account.account.account?.id });
    const isAdmin = rawAccount?.account?.isAdmin;

    // 兼容旧配置：检查用户名是否在管理员列表中
    const allowedUsernames = config.admin.allowedUsernames || ['admin'];
    const isInList = allowedUsernames.includes(username.toLowerCase());

    if (!isAdmin && !isInList) {
      return {
        success: false,
        message: '该账号不是管理员账号'
      };
    }

    // 生成动态Token
    const token = this.generateDynamicToken();

    return {
      success: true,
      token: token,
      account: account.account
    };
  }

  // 升级账号为管理员
  async upgradeToAdmin(accountId, upgradeKey) {
    // 验证升级密钥
    if (upgradeKey !== config.admin.upgradeKey) {
      return {
        success: false,
        message: '升级密钥错误'
      };
    }

    // 获取账号信息（从数据库读取原始数据）
    const account = await dataStore.findOne('accounts', { 'account.id': accountId });
    if (!account) {
      return {
        success: false,
        message: '账号不存在'
      };
    }

    const username = account.account?.username;
    if (!username) {
      return {
        success: false,
        message: '账号信息不完整'
      };
    }

    // 检查是否已经是管理员
    if (account.account?.isAdmin) {
      return {
        success: false,
        message: '该账号已经是管理员'
      };
    }

    // 在账号文件中存储管理员标记
    await dataStore.update('accounts', { 'account.id': accountId }, {
      'account.isAdmin': true,
      'account.updatedAt': Date.now()
    });

    logger.info('账号已升级为管理员', {
      accountId,
      username
    });

    return {
      success: true,
      message: '升级成功，您现在是管理员'
    };
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
    try { socket.join('admins'); } catch (e) { /* ignore */ }
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
        'chinese-chess': games.filter(g => g.gameType === 'chinese-chess').length,
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
    let registeredTotal = 0;
    let todayUsers = 0;
    let totalGamesPlayed = 0;
    if (this.accountManager) {
      try {
        accounts = await this.accountManager.getAllAccounts();

        const onlineUserIds = new Set();
        if (this.userManager) {
          for (const user of this.userManager.getAllUsers()) {
            if (user.socket && !user.disconnectedAt) {
              onlineUserIds.add(user.accountId);
            }
          }
        }

        accounts = accounts.map(acc => ({
          ...acc,
          account: {
            ...acc.account,
            online: onlineUserIds.has(acc.account?.id)
          }
        }));

        registeredTotal = accounts.length;
        // 创建账号ID到账号对象的映射
        accounts.forEach(account => {
          accountMap.set(account.account?.id, account);
        });
        // 今日活跃用户
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        todayUsers = accounts.filter(a => {
          const acc = a.account || a;
          const lastLogin = acc.lastLogin || acc.lastSeen;
          return lastLogin && new Date(lastLogin) >= today;
        }).length;
      } catch (err) {
        console.error('获取账号数据失败:', err);
      }
    }
    // 历史总对局数
    try {
      const allGames = await dataStore.read('games');
      totalGamesPlayed = allGames.length;
    } catch (err) {
      // games数据可能不存在
    }

    socket.emit('admin_update', {
      timestamp: Date.now(),
      stats: {
        users: {
          ...userStats,
          registeredTotal,
          todayActive: todayUsers
        },
        games: {
          ...gameStats,
          totalPlayed: totalGamesPlayed
        },
        waiting: waitingStats,
        system: systemInfo,
        totalConnections: this.userManager.getSystemStats().totalConnections,
        peakOnline: this.userManager.getSystemStats().peakOnline,
        // 扁平字段，兼容mini统计条
        totalUsers: registeredTotal,
        onlineUsers: userStats.online,
        activeGames: gameStats.active,
        totalGames: totalGamesPlayed,
        todayUsers: todayUsers
      },
      users: users.map(u => {
        let muted = false;
        let muteInfo = null;
        if (this.chatManager) {
          muteInfo = this.chatManager.muteList.get(u.accountId);
          muted = !!muteInfo;
        }

        // 获取用户关联的账号信息
        let account = null;
        const accountId = u.accountId;
        if (accountId) {
          const accountObj = accountMap.get(accountId);
          account = accountObj?.account;
        }

        return {
          userId: u.accountId,
          accountId: u.accountId,
          nickname: account?.nickname || u.nickname,
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
          account: account
        };
      }),
      games: games.map(g => ({
        gameId: g.gameId,
        gameType: g.gameType,
        player1: g.player1,
        player2: g.player2,
        player1Nickname: g.player1Nickname || (g.player1 === 'AI' ? 'AI' : null),
        player2Nickname: g.player2Nickname || (g.player2 === 'AI' ? 'AI' : null),
        isAIGame: g.player1 === 'AI' || g.player2 === 'AI' || g.isAIGame,
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
  kickUser(socket, accountId, reason = '管理员操作') {
    const adminInfo = this.adminSockets.get(socket.id);
    const success = this.userManager.kickUser(accountId, reason);

    if (success) {
      logger.info('管理员踢出用户', { adminSocket: socket.id, accountId, reason });

      // 记录操作日志
      if (this.operationLogger && adminInfo) {
        this.operationLogger.getAdminAction(
          adminInfo.accountId || '',
          adminInfo.username || '管理员',
          'kick_user',
          accountId,
          reason,
          {}
        );
      }

      socket.emit('admin_action_result', {
        action: 'kick_user',
        success: true,
        accountId,
        message: `用户 ${accountId} 已被踢出`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'kick_user',
        success: false,
        accountId,
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

      // 记录操作日志
      if (this.operationLogger && adminInfo) {
        this.operationLogger.getAdminAction(
          adminInfo.accountId || '',
          adminInfo.username || '管理员',
          'end_game',
          gameId,
          gameId,
          {}
        );
      }

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
    const adminInfo = this.adminSockets.get(socket.id);
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

    // 记录操作日志
    if (this.operationLogger && adminInfo) {
      this.operationLogger.getAdminAction(
        adminInfo.accountId || '',
        adminInfo.username || '管理员',
        'broadcast',
        '',
        '',
        { message: message.trim() }
      );
    }

    socket.emit('admin_action_result', {
      action: 'broadcast',
      success: true,
      message: '消息已广播给所有用户'
    });
  }

  // 获取系统日志
  async getSystemLogs(socket, options = {}) {
    try {
      const { level = 'all', limit = config.validation.defaultLogLimit, startTime, endTime } = options;

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
  async getLeaderboard(socket, limit = config.validation.defaultLeaderboardLimit) {
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
      const { limit = config.validation.defaultGameHistoryLimit, gameType, startDate, endDate } = options;

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

  // 获取最近游戏（仪表盘用）
  async getRecentGames(socket) {
    try {
      const games = await dataStore.read('games');
      const recent = games
        .sort((a, b) => (b.endTime || b.startTime || 0) - (a.endTime || a.startTime || 0))
        .slice(0, 8);
      socket.emit('admin_recent_games', { games: recent });
    } catch (err) {
      logger.error('获取最近游戏失败', { error: err.message });
      socket.emit('admin_recent_games', { games: [] });
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
  setMaintenanceMode(socket, enabled, options = {}, io) {
    const config = require('../config');
    const runtimeConfig = require('./runtimeConfig');
    const {
      message = '系统维护中，请稍后再试',
      durationMinutes = 0,
      blockChat = config.system.maintenanceBlockChat,
      kick = config.system.maintenanceKickOnEnable
    } = options;

    if (enabled) {
      // 更新配置
      config.system.maintenanceEnabled = true;
      config.system.maintenanceMessage = message;
      config.system.maintenanceBlockChat = blockChat;
      config.system.maintenanceKickOnEnable = kick;
      config.system.maintenanceCountdownMinutes = durationMinutes;
      config.system.maintenanceStartTime = Date.now();
      config.system.maintenanceEndTime = durationMinutes > 0
        ? Date.now() + durationMinutes * 60 * 1000
        : 0;

      // 持久化到运行时配置
      try {
        runtimeConfig.updateSetting('system.maintenanceEnabled', true);
        runtimeConfig.updateSetting('system.maintenanceMessage', message);
        runtimeConfig.updateSetting('system.maintenanceBlockChat', blockChat);
        runtimeConfig.updateSetting('system.maintenanceKickOnEnable', kick);
        runtimeConfig.updateSetting('system.maintenanceCountdownMinutes', durationMinutes);
      } catch (e) { /* 忽略 */ }

      // 自动退出维护定时器
      if (this._maintenanceAutoEndTimer) {
        clearTimeout(this._maintenanceAutoEndTimer);
        this._maintenanceAutoEndTimer = null;
      }
      if (durationMinutes > 0 && config.system.maintenanceEndTime > Date.now()) {
        const remaining = config.system.maintenanceEndTime - Date.now();
        this._maintenanceAutoEndTimer = setTimeout(() => {
          this.setMaintenanceMode(socket, false, {}, io);
          logger.info('维护倒计时结束，自动退出维护模式');
        }, remaining);
      }

      const noticeData = {
        enabled: true,
        message,
        timestamp: Date.now(),
        endTime: config.system.maintenanceEndTime,
        startTime: config.system.maintenanceStartTime,
        durationMinutes,
        blockNewGames: config.system.maintenanceBlockNewGames,
        blockChat: blockChat,
        blockShop: config.system.maintenanceBlockShop,
        blockMail: config.system.maintenanceBlockMail,
        blockRegister: config.system.maintenanceBlockRegister,
        blockProfile: config.system.maintenanceBlockProfile
      };

      io.emit('maintenance_notice', noticeData);
      logger.info('系统进入维护模式', {
        adminSocket: socket.id, message, durationMinutes,
        blockChat, kick,
        endTime: config.system.maintenanceEndTime
      });

      // 踢出玩家
      if (kick && this.userManager) {
        const users = this.userManager.getAllUsers();
        const adminSocketIds = new Set(this.adminSockets.keys());
        let kickedCount = 0;
        for (const user of users) {
          if (!adminSocketIds.has(user.socketId) && user.socket) {
            user.socket.emit('maintenance_kick', { message: '服务器维护中，您已被断开连接' });
            setTimeout(() => user.socket.disconnect(true), 1500);
            kickedCount++;
          }
        }
        if (kickedCount > 0) {
          logger.info('维护模式已踢出非管理员用户', { kickedCount });
        }
      }

      // 记录维护历史
      this._maintenanceHistory = this._maintenanceHistory || [];
      this._maintenanceHistory.unshift({
        startTime: Date.now(),
        message,
        durationMinutes,
        triggeredBy: socket.id
      });
      if (this._maintenanceHistory.length > 20) this._maintenanceHistory.length = 20;
    } else {
      // 退出维护
      config.system.maintenanceEnabled = false;
      config.system.maintenanceEndTime = 0;

      try {
        runtimeConfig.updateSetting('system.maintenanceEnabled', false);
      } catch (e) { /* 忽略 */ }

      if (this._maintenanceAutoEndTimer) {
        clearTimeout(this._maintenanceAutoEndTimer);
        this._maintenanceAutoEndTimer = null;
      }

      // 预告定时器也清除
      if (this._maintenanceScheduleTimer) {
        clearTimeout(this._maintenanceScheduleTimer);
        this._maintenanceScheduleTimer = null;
      }
      if (this._maintenanceScheduleInterval) {
        clearInterval(this._maintenanceScheduleInterval);
        this._maintenanceScheduleInterval = null;
      }

      // 通知所有客户端取消预告
      io.emit('maintenance_scheduled', { cancelled: true });

      io.emit('maintenance_notice', { enabled: false, timestamp: Date.now() });
      logger.info('系统退出维护模式', { adminSocket: socket.id });

      // 更新历史记录
      if (this._maintenanceHistory && this._maintenanceHistory[0]) {
        this._maintenanceHistory[0].endTime = Date.now();
      }
    }

    socket.emit('admin_action_result', {
      action: 'maintenance_mode',
      success: true,
      enabled,
      message: enabled ? '系统已进入维护模式' : '系统已退出维护模式'
    });
  }

  // 调度维护（预告模式）
  scheduleMaintenance(socket, options, io) {
    const {
      message = '系统维护中，请稍后再试',
      durationMinutes = 30,
      noticeMinutes = 5,
      blockChat = false,
      kick = true
    } = options;

    // 清除之前的调度
    if (this._maintenanceScheduleTimer) {
      clearTimeout(this._maintenanceScheduleTimer);
      this._maintenanceScheduleTimer = null;
    }
    if (this._maintenanceScheduleInterval) {
      clearInterval(this._maintenanceScheduleInterval);
      this._maintenanceScheduleInterval = null;
    }

    const startTime = Date.now() + noticeMinutes * 60 * 1000;
    logger.info('维护调度已设置', { noticeMinutes, startTime: new Date(startTime).toISOString(), message });

    // 发送预告通知
    io.emit('maintenance_scheduled', {
      message,
      startTime,
      durationMinutes,
      noticeMinutes
    });

    // 设置倒计时广播（每分钟一次）
    let remainingMinutes = noticeMinutes;
    this._maintenanceScheduleInterval = setInterval(() => {
      remainingMinutes--;
      if (remainingMinutes > 0) {
        io.emit('maintenance_countdown', {
          remainingMinutes,
          message
        });
      } else {
        clearInterval(this._maintenanceScheduleInterval);
        this._maintenanceScheduleInterval = null;
      }
    }, 60 * 1000);

    // 保存触发socket id，若已断开则不发送结果（避免报错）
    const triggerSocketId = socket.id;

    // 到达时间后进入维护
    this._maintenanceScheduleTimer = setTimeout(() => {
      clearInterval(this._maintenanceScheduleInterval);
      this._maintenanceScheduleInterval = null;
      this._maintenanceScheduleTimer = null;

      // 找一个仍在线的管理员socket来执行（优先使用触发者）
      let execSocket = socket;
      if (!io.sockets.sockets.has(triggerSocketId)) {
        // 触发者已断开，使用任意在线管理员socket
        for (const adminSocketId of this.adminSockets.keys()) {
          if (io.sockets.sockets.has(adminSocketId)) {
            execSocket = io.sockets.sockets.get(adminSocketId);
            break;
          }
        }
      }
      this.setMaintenanceMode(execSocket, true, { message, durationMinutes, blockChat, kick }, io);
    }, noticeMinutes * 60 * 1000);

    try {
      socket.emit('admin_action_result', {
        action: 'maintenance_schedule',
        success: true,
        message: `维护预告已发送，${noticeMinutes}分钟后进入维护模式`
      });
    } catch (e) { /* socket可能已断开 */ }
  }

  // 获取维护历史
  getMaintenanceHistory(socket) {
    socket.emit('maintenance_history', { history: this._maintenanceHistory || [] });
  }

  // 订阅实时日志
  subscribeLogs(socket) {
    if (!this.adminSockets.has(socket.id)) return;
    this.logListeners.add(socket);
    // 发送历史日志缓冲和前端配置
    socket.emit('log_history', {
      logs: [...this.logBuffer],
      config: {
        maxDisplay: config.log.adminMaxDisplay,
        defaultReadLines: config.log.adminFileReadLines,
        maxReadLines: config.log.adminFileReadMaxLines
      }
    });
    logger.info('管理员订阅实时日志', { adminSocket: socket.id });
  }

  // 取消订阅日志
  unsubscribeLogs(socket) {
    this.logListeners.delete(socket);
  }

  // 读取历史日志文件
  async getLogFiles(socket) {
    try {
      const files = fs.readdirSync(config.paths.logs)
        .filter(f => f.endsWith('.log'))
        .map(f => {
          const stat = fs.statSync(path.join(config.paths.logs, f));
          return { name: f, size: stat.size, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      socket.emit('log_files', { files });
    } catch (e) {
      socket.emit('log_files', { files: [], error: e.message });
    }
  }

  async readLogFile(socket, filename, lines) {
    try {
      // 使用配置默认值并限制最大行数
      const requestLines = Number.isInteger(lines) && lines > 0 ? lines : config.log.adminFileReadLines;
      const safeLines = Math.min(requestLines, config.log.adminFileReadMaxLines);
      const filePath = path.join(config.paths.logs, filename);
      // 防止目录遍历
      if (!filePath.startsWith(config.paths.logs)) {
        socket.emit('log_file_content', { error: '非法路径' });
        return;
      }
      if (!fs.existsSync(filePath)) {
        socket.emit('log_file_content', { error: '文件不存在' });
        return;
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      const allLines = content.trim().split('\n').filter(Boolean);
      const recent = allLines.slice(-safeLines).map(line => {
        try { return JSON.parse(line); } catch { return { raw: line }; }
      });
      socket.emit('log_file_content', { filename, lines: recent, totalLines: allLines.length });
    } catch (e) {
      socket.emit('log_file_content', { error: e.message });
    }
  }

  // 禁言用户
  muteUser(socket, accountId, duration = config.admin.defaultMuteMinutes, reason = '') {
    if (!this.chatManager) {
      socket.emit('admin_action_result', {
        action: 'mute_user',
        success: false,
        message: '聊天管理器不可用'
      });
      return;
    }

    const durationMs = duration === 0 ? 24 * 60 * 60 * 1000 * 365 : duration * 60 * 1000;
    const success = this.chatManager.muteUser(accountId, durationMs, reason);

    if (success) {
      logger.info('管理员禁言用户', { adminSocket: socket.id, accountId, duration, reason });
      socket.emit('admin_action_result', {
        action: 'mute_user',
        success: true,
        accountId,
        message: `用户 ${accountId} 已被禁言 ${duration} 分钟${reason ? `，原因：${reason}` : ''}`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'mute_user',
        success: false,
        accountId,
        message: '禁言失败'
      });
    }
  }

  // 解除禁言
  unmuteUser(socket, accountId) {
    if (!this.chatManager) {
      socket.emit('admin_action_result', {
        action: 'unmute_user',
        success: false,
        message: '聊天管理器不可用'
      });
      return;
    }

    const success = this.chatManager.unmuteUser(accountId);

    if (success) {
      logger.info('管理员解除禁言', { adminSocket: socket.id, accountId });
      socket.emit('admin_action_result', {
        action: 'unmute_user',
        success: true,
        accountId,
        message: `用户 ${accountId} 已解除禁言`
      });
    } else {
      socket.emit('admin_action_result', {
        action: 'unmute_user',
        success: false,
        accountId,
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
      const users = await dataStore.read('accounts');
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
          'chinese-chess': games.filter(g => g.gameType === 'chinese-chess').length
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
          })),
        maintenance: {
          enabled: config.system.maintenanceEnabled,
          message: config.system.maintenanceMessage,
          endTime: config.system.maintenanceEndTime || 0,
          startTime: config.system.maintenanceStartTime,
          durationMinutes: config.system.maintenanceCountdownMinutes,
          blockNewGames: config.system.maintenanceBlockNewGames,
          blockChat: config.system.maintenanceBlockChat,
          blockShop: config.system.maintenanceBlockShop,
          blockMail: config.system.maintenanceBlockMail,
          blockRegister: config.system.maintenanceBlockRegister,
          blockProfile: config.system.maintenanceBlockProfile
        }
      };

      socket.emit('admin_system_stats', stats);
    } catch (err) {
      logger.error('获取系统统计失败', { error: err.message });
    }
  }

  // 检查socket是否是已认证的管理员
  isAdmin(socket) {
    return this.adminSockets.has(socket.id);
  }

  // 处理管理员断开连接
  checkAdminAuth(socket) {
    if (!this.adminSockets.has(socket.id)) {
      socket.emit('auth_error', { message: '未授权操作，请重新登录' });
      return false;
    }
    return true;
  }

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
    this.logListeners.delete(socket);
    try { socket.leave('admins'); } catch (e) { /* ignore */ }
    logger.info('管理员断开连接', { socketId: socket.id });
  }

  // 获取用户详情
  getUserDetail(socket, accountId) {
    const user = this.userManager.getUserByAccountId(accountId);
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
      muteInfo = this.chatManager.muteList.get(accountId);
      muted = !!muteInfo;
    }

    socket.emit('admin_user_detail', {
      userId: user.accountId,
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
  async getUserGameHistory(socket, accountId, limit = config.validation.defaultUserGameHistoryLimit) {
    try {
      const games = await dataStore.read('games');
      const userGames = games
        .filter(g => g.player1 === accountId || g.player2 === accountId)
        .sort((a, b) => b.endTime - a.endTime)
        .slice(0, limit);

      socket.emit('admin_user_game_history', {
        accountId,
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

    const { scope = 'global', gameId, limit = config.chat.defaultQueryLimit } = options;
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
  sendUserMessage(socket, accountId, message) {
    const userSocket = this.userManager.getSocketByAccountId(accountId);
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

    logger.info('管理员给用户发送消息', { adminSocket: socket.id, accountId, message });

    socket.emit('admin_action_result', {
      action: 'send_user_message',
      success: true,
      message: `消息已发送给用户 ${accountId}`
    });
  }

  // 强制重置游戏
  resetGame(socket, gameId) {
    const adminInfo = this.adminSockets.get(socket.id);
    const io = adminInfo ? adminInfo.io : null;
    const success = io ? this.gameManager.adminResetGame(gameId, io) : false;

    if (success) {
      logger.info('管理员重置游戏', { adminSocket: socket.id, gameId });

      // 记录操作日志
      if (this.operationLogger && adminInfo) {
        this.operationLogger.getAdminAction(
          adminInfo.accountId || '',
          adminInfo.username || '管理员',
          'reset_game',
          gameId,
          gameId,
          {}
        );
      }

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
    const onlineUserIds = new Set();
    if (this.userManager) {
      for (const user of this.userManager.getAllUsers()) {
        if (user.socket && !user.disconnectedAt) {
          onlineUserIds.add(user.accountId);
        }
      }
    }

    const accountsWithStatus = accounts.map(acc => ({
      ...acc,
      account: {
        ...acc.account,
        online: onlineUserIds.has(acc.account?.id)
      }
    }));

    socket.emit('admin_accounts_list', { accounts: accountsWithStatus });
  }

  // 升级为管理员
  async upgradeToAdmin(socket, accountId) {
    const result = await this.accountManager.upgradeToAdmin(accountId);
    logger.info('管理员升级账号为管理员', { adminSocket: socket.id, accountId });
    socket.emit('admin_action_result', {
      action: 'upgrade_to_admin',
      ...result
    });
    socket.emit('admin_accounts_updated', {});
  }

  // 降级管理员
  async downgradeFromAdmin(socket, accountId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) {
        socket.emit('admin_action_result', {
          action: 'downgrade_from_admin',
          success: false,
          message: '账号不存在'
        });
        return;
      }

      if (!account.account?.isAdmin) {
        socket.emit('admin_action_result', {
          action: 'downgrade_from_admin',
          success: false,
          message: '该账号不是管理员'
        });
        return;
      }

      await dataStore.update('accounts', { 'account.id': accountId }, {
        'account.isAdmin': false,
        'account.updatedAt': Date.now()
      });

      logger.info('管理员取消账号管理员权限', { adminSocket: socket.id, accountId });
      socket.emit('admin_action_result', {
        action: 'downgrade_from_admin',
        success: true,
        message: '已取消管理员权限'
      });
      socket.emit('admin_accounts_updated', {});
    } catch (err) {
      logger.error('降级管理员失败', { accountId, error: err.message });
      socket.emit('admin_action_result', {
        action: 'downgrade_from_admin',
        success: false,
        message: '操作失败'
      });
    }
  }

  // 封禁账号
  async banAccount(socket, accountId, reason = '') {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) {
        socket.emit('admin_action_result', {
          action: 'ban_account',
          success: false,
          message: '账号不存在'
        });
        return;
      }

      if (account.account?.isAdmin) {
        socket.emit('admin_action_result', {
          action: 'ban_account',
          success: false,
          message: '不能封禁管理员账号'
        });
        return;
      }

      await dataStore.update('accounts', { 'account.id': accountId }, {
        'account.isBanned': true,
        'account.banReason': reason,
        'account.banTime': Date.now(),
        'account.updatedAt': Date.now()
      });

      if (this.userManager) {
        this.userManager.kickUser(accountId, reason || '账号被封禁');
      }

      logger.info('管理员封禁账号', { adminSocket: socket.id, accountId, reason });
      socket.emit('admin_action_result', {
        action: 'ban_account',
        success: true,
        message: '账号已封禁'
      });
      socket.emit('admin_accounts_updated', {});
    } catch (err) {
      logger.error('封禁账号失败', { accountId, error: err.message });
      socket.emit('admin_action_result', {
        action: 'ban_account',
        success: false,
        message: '操作失败'
      });
    }
  }

  // 解封账号
  async unbanAccount(socket, accountId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) {
        socket.emit('admin_action_result', {
          action: 'unban_account',
          success: false,
          message: '账号不存在'
        });
        return;
      }

      await dataStore.update('accounts', { 'account.id': accountId }, {
        'account.isBanned': false,
        'account.banReason': null,
        'account.banTime': null,
        'account.updatedAt': Date.now()
      });

      logger.info('管理员解封账号', { adminSocket: socket.id, accountId });
      socket.emit('admin_action_result', {
        action: 'unban_account',
        success: true,
        message: '账号已解封'
      });
      socket.emit('admin_accounts_updated', {});
    } catch (err) {
      logger.error('解封账号失败', { accountId, error: err.message });
      socket.emit('admin_action_result', {
        action: 'unban_account',
        success: false,
        message: '操作失败'
      });
    }
  }

  // 重置密码
  async resetPassword(socket, accountId, password) {
    const result = await this.accountManager.resetPasswordByAdmin(accountId, password);
    logger.info('管理员重置账号密码', { adminSocket: socket.id, accountId });
    socket.emit('admin_action_result', {
      action: 'reset_password',
      ...result
    });
  }

  // 创建账号
  async createAccount(socket, username, password, nickname, isAdmin = false) {
    const result = await this.accountManager.createAdminAccount(username, password, nickname, isAdmin);
    logger.info('管理员创建账号', { adminSocket: socket.id, username, isAdmin });
    socket.emit('admin_action_result', {
      action: 'create_account',
      ...result
    });
    if (result.success) {
      socket.emit('admin_accounts_updated', {});
    }
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
      // 清理UserManager中的在线用户
      if (this.userManager) {
        // 从在线用户中移除
        this.userManager.onlineUsers.delete(id);
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

    // 从UserManager获取用户信息
    let user = null;
    if (this.userManager) {
      user = this.userManager.getUserByAccountId(id);
    }

    let muted = false;
    let muteInfo = null;
    if (user && this.chatManager) {
      muteInfo = this.chatManager.muteList.get(id);
      muted = !!muteInfo;
    }

    socket.emit('admin_account_detail', {
      account: {
        id: account.account?.id || account.id,
        type: account.account?.type,
        username: account.account?.username,
        nickname: account.account?.nickname,
        createdAt: account.account?.createdAt,
        lastSeen: account.account?.lastSeen,
        lastLogin: account.account?.lastLogin,
        stats: account.stats || account.account?.stats,
        profile: account.account?.profile || account.profile,
        achievements: account.achievements || account.account?.achievements
      },
      user: user ? {
        userId: user.accountId,
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

  // 给指定用户发送邮件（带物品/星钻/经验奖励）
  async sendMailToUser(socket, data) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'send_mail',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const { userId, title, content, items = [], cosmetics = [], vip = null, starCoins = 0, exp = 0, from = '管理员' } = data;
    if (!userId) {
      socket.emit('admin_action_result', {
        action: 'send_mail',
        success: false,
        message: '用户ID不能为空'
      });
      return;
    }

    const mailData = { title, content, items, cosmetics, vip, starCoins, exp, from };
    const result = await this.accountManager.sendMail(userId, mailData);
    logger.info('管理员发送邮件', { adminSocket: socket.id, userId, title });
    socket.emit('admin_action_result', {
      action: 'send_mail',
      ...result
    });

    if (result.success && this.io && this.userManager) {
      const userSocket = this.userManager.getSocketByAccountId(userId);
      if (userSocket) {
        const updatedAccount = await this.accountManager.getAccount(userId);
        userSocket.emit('mail_received', { mail: result.mail });
        userSocket.emit('account_updated', { account: updatedAccount });
      }
    }
  }

  // 给多个用户发送邮件
  async sendMailToMultiple(socket, data) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'send_mail_batch',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const { userIds, title, content, items = [], starCoins = 0, exp = 0, from = '管理员' } = data;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      socket.emit('admin_action_result', {
        action: 'send_mail_batch',
        success: false,
        message: '用户列表不能为空'
      });
      return;
    }

    const mailData = { title, content, items, starCoins, exp, from };
    const result = await this.accountManager.sendMailToUsers(userIds, mailData);
    logger.info('管理员批量发送邮件', { adminSocket: socket.id, userCount: userIds.length, title });
    socket.emit('admin_action_result', {
      action: 'send_mail_batch',
      ...result
    });

    if (result.success && this.io && this.userManager && Array.isArray(userIds)) {
      for (const uid of userIds) {
        const userSocket = this.userManager.getSocketByAccountId(uid);
        if (userSocket) {
          const updatedAccount = await this.accountManager.getAccount(uid);
          userSocket.emit('mail_received', { title, content, from });
          userSocket.emit('account_updated', { account: updatedAccount });
        }
      }
    }
  }

  // 给所有用户发送邮件（全站邮件）
  async sendMailToAllUsers(socket, data) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'send_mail_all',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const { title, content, items = [], cosmetics = [], vip = null, starCoins = 0, exp = 0, from = '管理员' } = data;
    const mailData = { title, content, items, cosmetics, vip, starCoins, exp, from };
    const result = await this.accountManager.sendMailToAll(mailData);
    logger.info('管理员发送全站邮件', { adminSocket: socket.id, title, sentCount: result.sentCount });
    socket.emit('admin_action_result', {
      action: 'send_mail_all',
      ...result
    });

    if (this.io && this.userManager) {
      const onlineUsers = this.userManager.getAllUsers();
      for (const userSession of onlineUsers) {
        if (userSession && userSession.socket) {
          const updatedAccount = await this.accountManager.getAccount(userSession.accountId);
          userSession.socket.emit('mail_received', { title, content, from });
          userSession.socket.emit('account_updated', { account: updatedAccount });
        }
      }
    }
  }

  // 直接给用户发放星钻（立即到账，不通过邮件）
  async grantStarCoinsToUser(socket, id, amount, reason) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'grant_starcoins',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.grantStarCoins(id, amount, reason);
    logger.info('管理员发放星钻', { adminSocket: socket.id, id, amount, reason });
    socket.emit('admin_action_result', {
      action: 'grant_starcoins',
      ...result
    });

    if (result.success && this.io && this.userManager) {
      const userSocket = this.userManager.getSocketByAccountId(id);
      if (userSocket) {
        const updatedAccount = await this.accountManager.getAccount(id);
        userSocket.emit('account_updated', { account: updatedAccount });
      }
    }
  }

  // 直接给用户发放经验
  async grantExpToUser(socket, id, amount, reason) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'grant_exp',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.grantExp(id, amount, reason);
    logger.info('管理员发放经验', { adminSocket: socket.id, id, amount, reason });
    socket.emit('admin_action_result', {
      action: 'grant_exp',
      ...result
    });

    if (result.success && this.io && this.userManager) {
      const userSocket = this.userManager.getSocketByAccountId(id);
      if (userSocket) {
        const updatedAccount = await this.accountManager.getAccount(id);
        userSocket.emit('account_updated', { account: updatedAccount });
      }
    }
  }

  // 直接给用户发放物品
  async grantItemsToUser(socket, id, items) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'grant_items',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.grantItems(id, items);
    logger.info('管理员发放物品', { adminSocket: socket.id, id, items });
    socket.emit('admin_action_result', {
      action: 'grant_items',
      ...result
    });

    if (result.success && this.io && this.userManager) {
      const userSocket = this.userManager.getSocketByAccountId(id);
      if (userSocket) {
        const updatedAccount = await this.accountManager.getAccount(id);
        userSocket.emit('account_updated', { account: updatedAccount });
      }
    }
  }

  // 获取用户邮件列表（管理员查看）
  async getUserMails(socket, id) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'get_user_mails',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    const result = await this.accountManager.getMails(id);
    socket.emit('admin_user_mails', {
      userId: id,
      ...result
    });
  }

  // 获取物品列表
  async getItemsList(socket) {
    logger.info('收到物品列表请求', { socketId: socket.id });
    try {
      const itemsPath = path.join(__dirname, '..', 'config', 'shop', 'items.json');
      const packsPath = path.join(__dirname, '..', 'config', 'shop', 'packs.json');
      const cosmeticsPath = path.join(__dirname, '..', 'config', 'shop', 'cosmetics.json');
      const vipPath = path.join(__dirname, '..', 'config', 'shop', 'vip.json');

      const items = [];
      const packs = [];
      const cosmetics = [];
      const vipOptions = [];

      if (fs.existsSync(itemsPath)) {
        const itemsData = JSON.parse(fs.readFileSync(itemsPath, 'utf-8'));
        for (const item of Object.values(itemsData)) {
          items.push({
            id: item.id,
            name: item.name,
            icon: item.icon || '📦',
            description: item.description || '',
            category: item.category || 'item',
            rarity: item.rarity || 'common',
            price: item.price || 0,
            enabled: item.enabled !== false
          });
        }
      }
      logger.info('读取物品列表', { itemsCount: items.length, itemsPath });

      if (fs.existsSync(packsPath)) {
        const packsData = JSON.parse(fs.readFileSync(packsPath, 'utf-8'));
        for (const pack of Object.values(packsData)) {
          packs.push({
            id: pack.id,
            name: pack.name,
            icon: pack.icon || '🎁',
            description: pack.description || '',
            category: 'pack',
            rarity: pack.rarity || 'common',
            price: pack.price || 0,
            content: pack.content || {},
            enabled: pack.enabled !== false
          });
        }
      }
      logger.info('读取礼包列表', { packsCount: packs.length, packsPath });

      if (fs.existsSync(cosmeticsPath)) {
        const cosmeticsData = JSON.parse(fs.readFileSync(cosmeticsPath, 'utf-8'));
        const categories = ['frames', 'avatars', 'skins', 'backgrounds', 'titles'];
        for (const category of categories) {
          if (cosmeticsData[category]) {
            const catMap = { frames: 'frame', avatars: 'avatar', skins: 'skin', backgrounds: 'background', titles: 'title' };
            for (const cosmetic of Object.values(cosmeticsData[category])) {
              cosmetics.push({
                id: cosmetic.id,
                name: cosmetic.name,
                icon: cosmetic.icon || '🎨',
                description: cosmetic.description || '',
                category: catMap[category],
                rarity: cosmetic.rarity || 'common',
                price: cosmetic.price || 0,
                enabled: cosmetic.enabled !== false
              });
            }
          }
        }
      }
      logger.info('读取外观列表', { cosmeticsCount: cosmetics.length, cosmeticsPath });

      if (fs.existsSync(vipPath)) {
        const vipData = JSON.parse(fs.readFileSync(vipPath, 'utf-8'));
        for (const pkg of Object.values(vipData)) {
          if (pkg.category === 'vip') {
            vipOptions.push({
              id: pkg.id,
              name: pkg.name,
              icon: pkg.icon || '💎',
              description: pkg.description || '',
              days: pkg.days,
              expBonus: pkg.expBonus || 2.0,
              price: pkg.price || 0,
              enabled: pkg.enabled !== false
            });
          }
        }
      }
      logger.info('读取会员列表', { vipCount: vipOptions.length, vipPath });

      logger.info('发送物品列表', { items: items.length, packs: packs.length, cosmetics: cosmetics.length, vip: vipOptions.length });
      socket.emit('admin_items_list', { items, packs, cosmetics, vip: vipOptions, success: true });
    } catch (err) {
      logger.error('获取物品列表失败', { error: err.message, stack: err.stack });
      socket.emit('admin_items_list', { items: [], packs: [], cosmetics: [], vip: [], success: false, message: '读取失败' });
    }
  }

  // 获取用户列表（用于搜索和选择）
  async getUsersForSelect(socket, keyword) {
    if (!this.accountManager) {
      socket.emit('admin_action_result', {
        action: 'get_users_for_select',
        success: false,
        message: '账号管理器不可用'
      });
      return;
    }

    try {
      const accounts = await this.accountManager.getAllAccounts(100, 0);
      const kw = keyword?.toLowerCase() || '';
      const filtered = accounts
        .filter(a => {
          const acc = a.account || a;
          if (!kw) return true;
          return (
            acc.username?.toLowerCase().includes(kw) ||
            acc.nickname?.toLowerCase().includes(kw) ||
            acc.id?.toLowerCase().includes(kw)
          );
        })
        .slice(0, 50)
        .map(a => {
          const acc = a.account || a;
          return {
            id: acc.id,
            username: acc.username || '',
            nickname: acc.nickname || '',
            level: acc.profile?.level || 1,
            status: a.status || acc.status || 'offline'
          };
        });
      socket.emit('admin_users_select_list', { users: filtered, success: true });
    } catch (err) {
      logger.error('获取用户列表失败', { error: err.message });
      socket.emit('admin_users_select_list', { users: [], success: false, message: '读取失败' });
    }
  }

  // 经验来源标签映射
  getExpSourceLabel(record) {
    if (record.eventLabel) return record.eventLabel;
    if (record.source) return record.source;
    return '游戏对战';
  }

  // 星钻来源标签映射
  getCoinSourceLabel(source) {
    const sourceMap = {
      'exp_reward': '经验兑换',
      'level_up': '升级奖励',
      'level_reward': '等级奖励',
      'admin_grant': '管理员发放',
      'system': '系统发放',
      'shop_purchase': '商城购买',
      'mail_reward': '邮件奖励',
      'mail_reward_batch': '邮件奖励(批量)',
      'achievement': '成就奖励',
      'daily_login': '每日签到',
      'spend': '消费支出',
      'game_win': '游戏胜利',
      'game_draw': '游戏平局',
      'vip_daily': 'VIP每日礼包'
    };
    return sourceMap[source] || source || '未知来源';
  }

  // 获取经验值获取记录（分页、筛选）
  async getExpRecords(socket, options = {}) {
    try {
      const {
        accountId = null,
        keyword = '',
        source = 'all',
        startTime = null,
        endTime = null,
        page = 1,
        pageSize = 20
      } = options;

      const allRecords = await dataStore.read('expTransactions');
      const accounts = await dataStore.read('accounts');

      const accountMap = new Map();
      for (const acc of accounts) {
        const id = acc.account?.id || acc.id;
        if (id) {
          accountMap.set(id, {
            id,
            username: acc.account?.username || '-',
            nickname: acc.account?.nickname || '-',
            level: acc.account?.profile?.level || 1
          });
        }
      }

      let records = [];

      // 如果指定了单个用户ID，只取该用户的记录
      if (accountId) {
        const userRecords = allRecords.find(r => r.userId === accountId);
        if (userRecords && userRecords.transactions) {
          const userInfo = accountMap.get(accountId);
          records = userRecords.transactions.map(t => ({
            ...t,
            userId: accountId,
            username: userInfo?.username || '-',
            nickname: userInfo?.nickname || '-',
            sourceLabel: this.getExpSourceLabel(t)
          }));
        }
      } else {
        // 合并所有用户的记录
        for (const userRec of allRecords) {
          const userInfo = accountMap.get(userRec.userId);
          if (!userRec.transactions) continue;
          const userTx = userRec.transactions.map(t => ({
            ...t,
            userId: userRec.userId,
            username: userInfo?.username || '-',
            nickname: userInfo?.nickname || '-',
            sourceLabel: this.getExpSourceLabel(t)
          }));
          records.push(...userTx);
        }
      }

      // 按时间倒序
      records.sort((a, b) => b.timestamp - a.timestamp);

      // 筛选时间范围
      if (startTime) {
        const start = new Date(startTime).getTime();
        if (!isNaN(start)) {
          records = records.filter(r => r.timestamp >= start);
        }
      }
      if (endTime) {
        const end = new Date(endTime + ' 23:59:59').getTime();
        if (!isNaN(end)) {
          records = records.filter(r => r.timestamp <= end);
        }
      }

      // 筛选来源
      if (source && source !== 'all') {
        records = records.filter(r => {
          if (source === 'battle') return !r.eventLabel && !r.source;
          return r.sourceLabel.includes(source) || (r.source === source);
        });
      }

      // 关键词搜索（用户名/昵称）
      if (keyword) {
        const kw = keyword.toLowerCase();
        records = records.filter(r =>
          r.username?.toLowerCase().includes(kw) ||
          r.nickname?.toLowerCase().includes(kw)
        );
      }

      const total = records.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(Math.max(1, page), totalPages);
      const startIndex = (currentPage - 1) * pageSize;
      const pagedRecords = records.slice(startIndex, startIndex + pageSize);

      // 汇总统计
      const summary = {
        totalRecords: total,
        totalExp: records.reduce((s, r) => s + (r.finalExp || 0), 0),
        totalBonusExp: records.reduce((s, r) => s + (r.bonusExp || 0), 0),
        uniqueUsers: new Set(records.map(r => r.userId)).size
      };

      socket.emit('admin_exp_records', {
        success: true,
        records: pagedRecords,
        summary,
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages
        }
      });
    } catch (err) {
      logger.error('获取经验记录失败', { error: err.message, stack: err.stack });
      socket.emit('admin_exp_records', {
        success: false,
        message: '获取经验记录失败: ' + err.message,
        records: [],
        summary: {},
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
      });
    }
  }

  // 获取星钻获取/消费记录（分页、筛选）
  async getCoinRecords(socket, options = {}) {
    try {
      const {
        accountId = null,
        keyword = '',
        source = 'all',
        type = 'all',
        startTime = null,
        endTime = null,
        page = 1,
        pageSize = 20
      } = options;

      const allRecords = await dataStore.read('currencyTransactions');
      const accounts = await dataStore.read('accounts');

      const accountMap = new Map();
      for (const acc of accounts) {
        const id = acc.account?.id || acc.id;
        if (id) {
          accountMap.set(id, {
            id,
            username: acc.account?.username || '-',
            nickname: acc.account?.nickname || '-',
            starCoins: acc.currency?.starCoins || 0
          });
        }
      }

      let records = [];

      if (accountId) {
        const userRecords = allRecords.find(r => r.userId === accountId);
        if (userRecords && userRecords.transactions) {
          const userInfo = accountMap.get(accountId);
          records = userRecords.transactions.map(t => ({
            ...t,
            userId: accountId,
            username: userInfo?.username || '-',
            nickname: userInfo?.nickname || '-',
            sourceLabel: this.getCoinSourceLabel(t.source),
            signedAmount: t.type === 'spend' ? -t.amount : t.amount
          }));
        }
      } else {
        for (const userRec of allRecords) {
          const userInfo = accountMap.get(userRec.userId);
          if (!userRec.transactions) continue;
          const userTx = userRec.transactions.map(t => ({
            ...t,
            userId: userRec.userId,
            username: userInfo?.username || '-',
            nickname: userInfo?.nickname || '-',
            sourceLabel: this.getCoinSourceLabel(t.source),
            signedAmount: t.type === 'spend' ? -t.amount : t.amount
          }));
          records.push(...userTx);
        }
      }

      // 按时间倒序
      records.sort((a, b) => b.timestamp - a.timestamp);

      // 筛选时间范围
      if (startTime) {
        const start = new Date(startTime).getTime();
        if (!isNaN(start)) {
          records = records.filter(r => r.timestamp >= start);
        }
      }
      if (endTime) {
        const end = new Date(endTime + ' 23:59:59').getTime();
        if (!isNaN(end)) {
          records = records.filter(r => r.timestamp <= end);
        }
      }

      // 筛选类型（收入/支出）
      if (type && type !== 'all') {
        records = records.filter(r => r.type === type);
      }

      // 筛选来源
      if (source && source !== 'all') {
        records = records.filter(r => r.source === source);
      }

      // 关键词搜索
      if (keyword) {
        const kw = keyword.toLowerCase();
        records = records.filter(r =>
          r.username?.toLowerCase().includes(kw) ||
          r.nickname?.toLowerCase().includes(kw) ||
          r.reason?.toLowerCase().includes(kw)
        );
      }

      const total = records.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(Math.max(1, page), totalPages);
      const startIndex = (currentPage - 1) * pageSize;
      const pagedRecords = records.slice(startIndex, startIndex + pageSize);

      // 汇总统计
      const earnRecords = records.filter(r => r.type === 'earn');
      const spendRecords = records.filter(r => r.type === 'spend');
      const summary = {
        totalRecords: total,
        totalEarned: earnRecords.reduce((s, r) => s + r.amount, 0),
        totalSpent: spendRecords.reduce((s, r) => s + r.amount, 0),
        netFlow: earnRecords.reduce((s, r) => s + r.amount, 0) - spendRecords.reduce((s, r) => s + r.amount, 0),
        uniqueUsers: new Set(records.map(r => r.userId)).size
      };

      socket.emit('admin_coin_records', {
        success: true,
        records: pagedRecords,
        summary,
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages
        }
      });
    } catch (err) {
      logger.error('获取星钻记录失败', { error: err.message, stack: err.stack });
      socket.emit('admin_coin_records', {
        success: false,
        message: '获取星钻记录失败: ' + err.message,
        records: [],
        summary: {},
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
      });
    }
  }

  // 获取邮件发送/领取记录（分页、筛选）
  async getMailRecords(socket, options = {}) {
    try {
      const {
        keyword = '',
        status = 'all',
        from = 'all',
        startTime = null,
        endTime = null,
        page = 1,
        pageSize = 20
      } = options;

      const allMailStores = await dataStore.read('mails');
      const accounts = await dataStore.read('accounts');

      const accountMap = new Map();
      for (const acc of accounts) {
        const id = acc.account?.id || acc.id;
        if (id) {
          accountMap.set(id, {
            id,
            username: acc.account?.username || '-',
            nickname: acc.account?.nickname || '-'
          });
        }
      }

      let mails = [];
      for (const userMail of allMailStores) {
        if (!userMail.mails || !Array.isArray(userMail.mails)) continue;
        const userInfo = accountMap.get(userMail.userId);
        for (const m of userMail.mails) {
          mails.push({
            ...m,
            userId: userMail.userId,
            username: userInfo?.username || '-',
            nickname: userInfo?.nickname || '-'
          });
        }
      }

      // 按发送时间倒序
      mails.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      // 筛选时间范围
      if (startTime) {
        const start = new Date(startTime).getTime();
        if (!isNaN(start)) mails = mails.filter(m => (m.createdAt || 0) >= start);
      }
      if (endTime) {
        const end = new Date(endTime + ' 23:59:59').getTime();
        if (!isNaN(end)) mails = mails.filter(m => (m.createdAt || 0) <= end);
      }

      // 筛选状态（已领取/未领取）
      if (status === 'claimed') {
        mails = mails.filter(m => m.claimed === true);
      } else if (status === 'unclaimed') {
        mails = mails.filter(m => m.claimed !== true);
      }

      // 筛选发件人
      if (from && from !== 'all') {
        mails = mails.filter(m => {
          const sender = (m.from || '系统').toString();
          return sender.includes(from);
        });
      }

      // 关键词搜索（用户名/昵称/标题）
      if (keyword) {
        const kw = keyword.toLowerCase();
        mails = mails.filter(m =>
          m.username?.toLowerCase().includes(kw) ||
          m.nickname?.toLowerCase().includes(kw) ||
          m.title?.toLowerCase().includes(kw) ||
          m.content?.toLowerCase().includes(kw)
        );
      }

      const total = mails.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const currentPage = Math.min(Math.max(1, page), totalPages);
      const startIndex = (currentPage - 1) * pageSize;
      const pagedMails = mails.slice(startIndex, startIndex + pageSize).map(m => {
        const itemList = (m.items || []).map(i => ({
          icon: i.icon || '📦', name: i.name || i.id, count: i.count || 1
        }));
        const cosmeticList = (m.cosmetics || []).map(c => ({
          icon: c.icon || '🎨', name: c.name || c.id, category: c.category || ''
        }));
        const vipInfo = m.vip ? {
          icon: m.vip.icon || '💎', name: m.vip.name || `${m.vip.days}天会员`, days: m.vip.days || 0
        } : null;
        return {
          id: m.id,
          userId: m.userId,
          username: m.username,
          nickname: m.nickname,
          title: m.title,
          content: m.content,
          from: m.from || '系统',
          claimed: !!m.claimed,
          read: !!m.read,
          claimedAt: m.claimedAt || null,
          createdAt: m.createdAt,
          starCoins: m.starCoins || 0,
          exp: m.exp || 0,
          items: itemList,
          cosmetics: cosmeticList,
          vip: vipInfo
        };
      });

      // 汇总统计
      const claimed = mails.filter(m => m.claimed);
      const unclaimed = mails.filter(m => !m.claimed);
      const totalStarCoins = mails.reduce((s, m) => s + (m.starCoins || 0), 0);
      const totalExp = mails.reduce((s, m) => s + (m.exp || 0), 0);
      const summary = {
        totalMails: total,
        totalClaimed: claimed.length,
        totalUnclaimed: unclaimed.length,
        uniqueRecipients: new Set(mails.map(m => m.userId)).size,
        totalStarCoins,
        totalExp
      };

      socket.emit('admin_mail_records', {
        success: true,
        mails: pagedMails,
        summary,
        pagination: {
          page: currentPage,
          pageSize,
          total,
          totalPages
        }
      });
    } catch (err) {
      logger.error('获取邮件记录失败', { error: err.message, stack: err.stack });
      socket.emit('admin_mail_records', {
        success: false,
        message: '获取邮件记录失败: ' + err.message,
        mails: [],
        summary: {},
        pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 }
      });
    }
  }
}

module.exports = AdminManager;
