// AdminManager.js - 后台管理模块
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class AdminManager {
  constructor(userManager, gameManager) {
    this.userManager = userManager;
    this.gameManager = gameManager;
    this.adminSockets = new Map(); // socketId -> admin信息
    this.systemStats = {
      serverStartTime: Date.now(),
      totalRequests: 0,
      totalErrors: 0
    };
  }

  // 验证管理员token
  verifyToken(token) {
    return token === config.admin.token;
  }

  // 处理管理员连接
  handleAdminConnection(socket, token, io) {
    if (!this.verifyToken(token)) {
      socket.emit('auth_error', { message: '认证失败，无效的token' });
      socket.disconnect();
      return false;
    }

    const adminInfo = {
      socketId: socket.id,
      connectedAt: Date.now(),
      ip: socket.handshake.address
    };

    this.adminSockets.set(socket.id, adminInfo);
    logger.info('管理员连接', { socketId: socket.id, ip: adminInfo.ip });

    // 发送初始数据
    this.sendAdminData(socket);

    // 设置定时更新
    const updateInterval = setInterval(() => {
      if (socket.connected) {
        this.sendAdminData(socket);
      } else {
        clearInterval(updateInterval);
      }
    }, config.admin.updateInterval);

    socket.adminInterval = updateInterval;

    return true;
  }

  // 发送管理数据
  sendAdminData(socket) {
    const users = this.userManager.getAllUsers();
    const games = this.gameManager.getAllGames();
    const waitingUsers = this.gameManager.getWaitingUsers();
    const spectatableGames = this.gameManager.getSpectatableGames();

    // 用户统计
    const userStats = {
      total: users.length,
      online: users.filter(u => u.status === 'online').length,
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
        chess: games.filter(g => g.gameType === 'chess').length
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
      users: users.map(u => ({
        userId: u.userId,
        nickname: u.nickname,
        status: u.status,
        gameType: u.gameType,
        game: u.game,
        connectedAt: u.connectedAt,
        lastActivity: u.lastActivity,
        stats: u.stats,
        ip: u.ip
      })),
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
      waitingQueue: waitingUsers
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
    const success = this.gameManager.adminEndGame(gameId, io);
    
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
          .filter(g => g.endTime < thirtyDaysAgo)
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
      
      const stats = {
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
            userId: u.userId,
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
    
    this.adminSockets.delete(socket.id);
    logger.info('管理员断开连接', { socketId: socket.id });
  }

  // 获取在线管理员数量
  getOnlineAdminCount() {
    return this.adminSockets.size;
  }
}

module.exports = AdminManager;
