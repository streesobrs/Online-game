// UserManager.js - 用户管理模块
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class UserManager {
  constructor(accountManager = null) {
    this.accountManager = accountManager;
    this.users = new Map(); // socketId -> user对象
    this.userSockets = new Map(); // userId -> socket
    this.userIdToSocketId = new Map(); // userId -> socketId
    this.onlineUsers = new Map(); // userId -> user数据
    this.userIdToAccountId = new Map(); // userId -> accountId
    this.accountIdToUserId = new Map(); // accountId -> userId
    this.stats = {
      totalConnections: 0,
      peakOnline: 0,
      totalGames: 0
    };
    this.loadStats();
  }

  // 加载统计数据
  async loadStats() {
    try {
      const saved = await dataStore.read('systemStats');
      if (saved && saved.length > 0) {
        this.stats = { ...this.stats, ...saved[0] };
      }
    } catch (err) {
      logger.warn('加载统计数据失败', { error: err.message });
    }
  }

  // 保存统计数据
  async saveStats() {
    await dataStore.write('systemStats', [this.stats]);
  }

  // 生成用户ID
  generateUserId() {
    return crypto.randomBytes(4).toString('hex'); // 8位十六进制
  }

  // 生成会话token
  generateToken() {
    return crypto.randomBytes(16).toString('hex'); // 32位十六进制
  }

  // 处理用户连接
  async handleUserConnection(socket, data, io) {
    this.stats.totalConnections++;

    // 检查客户端是否提供了已保存的userId
    let userId = data && data.savedUserId ? data.savedUserId : null;
    const token = this.generateToken();

    let userData = null;

    // 如果有userId，尝试从AccountManager加载用户数据
    if (userId && this.accountManager) {
      userData = await this.accountManager.getUser(userId);
    }

    // 如果没有用户数据，创建新的游客用户
    if (!userData) {
      if (this.accountManager) {
        userData = await this.accountManager.createGuestUser();
        userId = userData.id;
      } else {
        // 如果没有AccountManager，使用旧的逻辑
        userId = this.generateUserId();
        userData = {
          id: userId,
          nickname: `玩家${userId.substr(0, 4)}`,
          stats: {
            wins: 0,
            losses: 0,
            draws: 0,
            totalGames: 0
          },
          createdAt: Date.now(),
          lastSeen: Date.now(),
          updatedAt: Date.now()
        };
      }
    }

    // 检查这个userId是否已经在线
    if (this.userSockets.has(userId)) {
      // 如果在线，生成新的userId
      if (this.accountManager) {
        userData = await this.accountManager.createGuestUser();
        userId = userData.id;
      } else {
        userId = this.generateUserId();
      }
    }

    const user = {
      userId,
      token,
      socketId: socket.id,
      nickname: userData.nickname,
      status: 'online',
      game: null,
      gameType: null,
      connectedAt: Date.now(),
      lastActivity: Date.now(),
      stats: userData.stats || {
        wins: 0,
        losses: 0,
        draws: 0,
        totalGames: 0
      },
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent']
    };

    // 存储用户数据
    this.users.set(socket.id, user);
    this.userSockets.set(userId, socket);
    this.userIdToSocketId.set(userId, socket.id);
    this.onlineUsers.set(userId, user);

    // 更新峰值在线人数
    if (this.onlineUsers.size > this.stats.peakOnline) {
      this.stats.peakOnline = this.onlineUsers.size;
      await this.saveStats();
    }

    logger.userAction(userId, '连接', { ip: user.ip });

    // 发送用户信息
    socket.emit('user_connected', {
      userId,
      token,
      nickname: user.nickname,
      status: user.status,
      stats: user.stats
    });

    // 广播用户上线
    this.broadcastUserStatus(userId, 'online', io);

    // 发送在线用户列表
    this.sendOnlineUsers(socket, io);

    // 发送系统统计
    socket.emit('system_stats', {
      onlineUsers: this.onlineUsers.size,
      peakOnline: this.stats.peakOnline,
      totalConnections: this.stats.totalConnections
    });

    return user;
  }

  // 处理用户登录（使用token恢复会话）
  async handleUserLogin(socket, data, io) {
    const { token, nickname } = data;

    // 这里可以实现基于token的用户识别
    // 简化版本：更新昵称
    const user = this.users.get(socket.id);
    if (user && nickname) {
      const oldNickname = user.nickname;
      user.nickname = nickname.trim().substring(0, 20); // 限制长度
      user.lastActivity = Date.now();

      logger.userAction(user.userId, '更新昵称', { oldNickname, newNickname: user.nickname });

      socket.emit('user_updated', {
        userId: user.userId,
        nickname: user.nickname
      });

      // 广播更新
      this.broadcastUserStatus(user.userId, user.status, io);
    }
  }

  // 更新用户状态
  updateUserStatus(userId, status, gameType = null) {
    const user = this.onlineUsers.get(userId);
    if (user) {
      user.status = status;
      if (gameType) user.gameType = gameType;
      user.lastActivity = Date.now();
      return user;
    }
    return null;
  }

  // 更新用户活动
  updateUserActivity(userId) {
    const user = this.onlineUsers.get(userId);
    if (user) {
      user.lastActivity = Date.now();
      // 重置警告状态
      this.resetUserWarning(userId);
    }
  }

  // 更新用户统计
  async updateUserStats(userId, result, gameType = null, isAI = false, aiDifficulty = null, duration = null) {
    const user = this.onlineUsers.get(userId);

    // 同时更新账号统计（如果有账号关联）
    const accountId = this.userIdToAccountId.get(userId);
    if (accountId && this.accountManager) {
      const statsResult = await this.accountManager.updateGameStats(accountId, result, gameType, isAI, aiDifficulty, duration);

      // 获取更新后的账号信息并发送给客户端
      const updatedAccount = await this.accountManager.getAccount(accountId);
      if (updatedAccount) {
        // 同步用户对象的统计数据
        if (user) {
          user.stats = updatedAccount.stats || {
            wins: 0,
            losses: 0,
            draws: 0,
            totalGames: 0,
            streak: 0
          };
          // 异步保存到数据库
          this.saveUserToDB(user);
        }

        const socket = this.getSocketByUserId(userId);
        if (socket) {
          socket.emit('account_updated', { account: updatedAccount });
        }
      }

      return statsResult;
    } else if (user) {
      // 没有账号关联时，只更新本地用户统计
      user.stats.totalGames++;
      if (result === 'win') {
        user.stats.wins++;
        user.stats.streak = (user.stats.streak || 0) + 1;
      } else if (result === 'loss' || result === 'draw') {
        user.stats.streak = 0;
        if (result === 'loss') user.stats.losses++;
        else if (result === 'draw') user.stats.draws++;
      }

      // 异步保存到数据库
      this.saveUserToDB(user);
    }

    return { success: false };
  }

  // 关联用户ID和账号ID
  setUserAccount(userId, accountId) {
    this.userIdToAccountId.set(userId, accountId);
    this.accountIdToUserId.set(accountId, userId);
  }

  // 根据用户ID获取账号ID
  getAccountIdByUserId(userId) {
    return this.userIdToAccountId.get(userId);
  }

  // 保存用户到数据库
  async saveUserToDB(user) {
    try {
      const existing = await dataStore.findOne('users', { id: user.userId });
      if (existing) {
        await dataStore.update('users', user.userId, {
          nickname: user.nickname,
          stats: user.stats,
          lastSeen: Date.now()
        });
      } else {
        await dataStore.add('users', {
          id: user.userId,
          nickname: user.nickname,
          stats: user.stats,
          createdAt: user.connectedAt,
          lastSeen: Date.now()
        });
      }
    } catch (err) {
      logger.error('保存用户数据失败', { userId: user.userId, error: err.message });
    }
  }

  // 广播用户状态
  broadcastUserStatus(userId, status, io) {
    const user = this.onlineUsers.get(userId);
    if (user) {
      io.emit('user_status', {
        userId: user.userId,
        nickname: user.nickname,
        status,
        gameType: user.gameType,
        timestamp: Date.now()
      });
    }
  }

  // 发送在线用户列表
  sendOnlineUsers(socket, io) {
    const onlineUsers = Array.from(this.onlineUsers.values()).map(user => ({
      userId: user.userId,
      nickname: user.nickname,
      status: user.status,
      gameType: user.gameType,
      stats: user.stats
    }));

    socket.emit('online_users', onlineUsers);
  }

  // 处理用户断开连接
  async handleUserDisconnect(socketId, io) {
    const user = this.users.get(socketId);
    if (user) {
      logger.userAction(user.userId, '断开连接', {
        onlineDuration: Date.now() - user.connectedAt
      });

      // 广播离线状态
      this.broadcastUserStatus(user.userId, 'offline', io);

      // 保存用户数据到数据库
      if (this.accountManager) {
        try {
          await this.accountManager.updateUser(user.userId, {
            nickname: user.nickname,
            stats: user.stats,
            lastSeen: Date.now()
          });
        } catch (err) {
          logger.warn('保存用户数据失败', { userId: user.userId, error: err.message });
        }
      } else {
        // 如果没有AccountManager，使用旧的逻辑
        this.saveUserToDB(user);
      }

      // 清理数据
      this.users.delete(socketId);
      this.userSockets.delete(user.userId);
      this.userIdToSocketId.delete(user.userId);
      this.onlineUsers.delete(user.userId);

      // 清理账号映射
      const accountId = this.userIdToAccountId.get(user.userId);
      if (accountId) {
        this.userIdToAccountId.delete(user.userId);
        this.accountIdToUserId.delete(accountId);
      }

      return user;
    }
    return null;
  }

  // 获取用户（通过socketId）
  getUserBySocketId(socketId) {
    return this.users.get(socketId);
  }

  // 获取用户（通过userId）
  getUserByUserId(userId) {
    return this.onlineUsers.get(userId);
  }

  // 获取用户socket
  getSocketByUserId(userId) {
    return this.userSockets.get(userId);
  }

  // 获取所有在线用户
  getAllUsers() {
    return Array.from(this.onlineUsers.values());
  }

  // 获取在线用户数
  getOnlineCount() {
    return this.onlineUsers.size;
  }

  // 获取等待匹配的用户数
  getWaitingCount(gameType = null) {
    let count = 0;
    for (const user of this.onlineUsers.values()) {
      if (user.status === 'waiting') {
        if (!gameType || user.gameType === gameType) {
          count++;
        }
      }
    }
    return count;
  }

  // 获取游戏中的用户数
  getPlayingCount() {
    let count = 0;
    for (const user of this.onlineUsers.values()) {
      if (user.status === 'playing') {
        count++;
      }
    }
    return count;
  }

  // 踢出用户
  kickUser(userId, reason = '管理员操作') {
    const socket = this.userSockets.get(userId);
    if (socket) {
      socket.emit('kicked', { reason });
      socket.disconnect(true);
      logger.userAction(userId, '被踢出', { reason });
      return true;
    }
    return false;
  }

  // 检查不活跃用户（增强版）
  checkInactiveUsers(io, timeout = config.game.inactivityTimeout) {
    const now = Date.now();
    const inactiveUsers = [];
    const warningUsers = [];

    for (const [userId, user] of this.onlineUsers) {
      if (user.status === 'online') {
        const inactivityTime = now - user.lastActivity;

        // 第一阶段：15分钟无活动，发送警告
        if (inactivityTime > 15 * 60 * 1000 && !user.warningSent) {
          warningUsers.push({ userId, user, inactivityTime });
        }

        // 第二阶段：超过超时时间，准备断开
        if (inactivityTime > timeout) {
          inactiveUsers.push(userId);
        }
      }
    }

    // 发送警告消息
    for (const { userId, user, inactivityTime } of warningUsers) {
      const socket = this.userSockets.get(userId);
      if (socket) {
        const remainingMinutes = Math.ceil((timeout - inactivityTime) / 1000 / 60);
        socket.emit('inactive_warning', {
          message: `您已${Math.floor(inactivityTime / 1000 / 60)}分钟未活动，${remainingMinutes}分钟后将被断开连接`,
          level: 'warning',
          remainingTime: remainingMinutes * 60 * 1000
        });
        user.warningSent = true;
        logger.info('发送不活跃警告', { userId, inactivityTime: Math.floor(inactivityTime / 1000 / 60) });
      }
    }

    // 处理超时用户
    for (const userId of inactiveUsers) {
      const socket = this.userSockets.get(userId);
      if (socket) {
        socket.emit('inactive_warning', {
          message: '您已长时间未活动，即将断开连接',
          level: 'critical'
        });

        // 30秒后断开连接
        setTimeout(() => {
          const user = this.onlineUsers.get(userId);
          if (user && user.status === 'online') {
            this.kickUser(userId, '长时间未活动');
            logger.info('断开不活跃用户', { userId, inactivityTime: Math.floor((Date.now() - user.lastActivity) / 1000 / 60) });
          }
        }, 30000); // 30秒后断开
      }
    }

    return { inactiveCount: inactiveUsers.length, warningCount: warningUsers.length };
  }

  // 重置用户警告状态（当用户有活动时调用）
  resetUserWarning(userId) {
    const user = this.onlineUsers.get(userId);
    if (user && user.warningSent) {
      user.warningSent = false;
      logger.info('重置用户警告状态', { userId });
    }
  }

  // 获取排行榜
  async getLeaderboard(limit = 10) {
    try {
      if (this.accountManager) {
        const accounts = await this.accountManager.getAllAccounts();
        return accounts
          .sort((a, b) => (b.stats?.wins || 0) - (a.stats?.wins || 0))
          .slice(0, limit)
          .map((account, index) => ({
            rank: index + 1,
            id: account.id,
            username: account.username,
            nickname: account.nickname,
            level: account.profile?.level || 1,
            wins: account.stats?.wins || 0,
            losses: account.stats?.losses || 0,
            draws: account.stats?.draws || 0,
            totalGames: account.stats?.totalGames || 0,
            winRate: account.stats?.totalGames > 0
              ? Math.round((account.stats.wins / account.stats.totalGames) * 100)
              : 0
          }));
      } else {
        const users = await dataStore.read('users');
        return users
          .sort((a, b) => (b.stats?.wins || 0) - (a.stats?.wins || 0))
          .slice(0, limit)
          .map((user, index) => ({
            rank: index + 1,
            userId: user.userId,
            nickname: user.nickname,
            wins: user.stats?.wins || 0,
            losses: user.stats?.losses || 0,
            draws: user.stats?.draws || 0,
            totalGames: user.stats?.totalGames || 0,
            winRate: user.stats?.totalGames > 0
              ? Math.round((user.stats.wins / user.stats.totalGames) * 100)
              : 0
          }));
      }
    } catch (err) {
      logger.error('获取排行榜失败', { error: err.message });
      return [];
    }
  }

  // 获取系统统计
  getSystemStats() {
    return {
      ...this.stats,
      onlineUsers: this.onlineUsers.size,
      waitingUsers: this.getWaitingCount(),
      playingUsers: this.getPlayingCount()
    };
  }
}

module.exports = UserManager;
