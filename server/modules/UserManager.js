// UserManager.js - 用户连接和会话管理模块
// 职责：管理在线用户、Socket连接、实时用户状态
// 数据持久化由AccountManager负责
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class UserManager {
  constructor(accountManager = null) {
    this.accountManager = accountManager;
    // Socket连接管理：socketId -> accountId
    this.socketToAccount = new Map();
    // 在线用户管理：accountId -> 用户会话数据
    this.onlineUsers = new Map();
    // 系统统计
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

  // 处理用户连接 - 只负责连接管理，不自动分配ID
  async handleUserConnection(socket, data, io) {
    this.stats.totalConnections++;

    let accountId = null;
    let accountData = null;
    let sessionToken = null;

    try {
      // 情况1：客户端提供了保存的token，尝试验证并恢复会话
      if (data && data.token && data.token !== 'none' && this.accountManager) {
        const tokenResult = await this.accountManager.verifyTokenAndGetAccount(data.token);
        if (tokenResult.success) {
          accountId = tokenResult.data.account.account.id;
          accountData = tokenResult.data.account;
          sessionToken = data.token; // 重用现有token
          logger.info('通过token恢复会话', { accountId, socketId: socket.id });
        }
      }

      // 情况2：没有有效token，创建匿名会话（不分配ID）
      if (!accountId) {
        accountId = null; // 不分配ID
        sessionToken = null;
        accountData = {
          account: {
            id: null,
            type: 'anonymous',
            nickname: '未登录',
            profile: { level: 1, exp: 0 }
          },
          stats: {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0
          }
        };
        logger.info('创建匿名会话', { socketId: socket.id });
      }

      // 创建在线用户会话数据
      const userSession = {
        accountId: accountId,
        socketId: socket.id,
        socket: socket,
        token: sessionToken,
        nickname: accountData.account?.nickname || '未登录',
        status: 'online',
        gameType: null,
        connectedAt: Date.now(),
        lastActivity: Date.now(),
        accountData: accountData,
        ip: socket.handshake.address,
        userAgent: socket.handshake.headers['user-agent'],
        warningSent: false
      };

      // 存储会话数据（使用socketId作为key，因为没有accountId）
      this.socketToAccount.set(socket.id, accountId || socket.id);
      if (accountId) {
        this.onlineUsers.set(accountId, userSession);
        // 加入以 accountId 命名的房间，用于发送私人通知（邮件、账号更新等）
        try {
          socket.join(accountId);
          logger.info('用户加入房间', { accountId, socketId: socket.id });
        } catch (roomErr) {
          logger.warn('用户加入房间失败', { accountId, error: roomErr.message });
        }
      } else {
        this.onlineUsers.set(socket.id, userSession);
      }

      // 更新峰值在线人数
      if (this.onlineUsers.size > this.stats.peakOnline) {
        this.stats.peakOnline = this.onlineUsers.size;
        await this.saveStats();
      }

      logger.userAction(accountId || socket.id, '连接', { ip: userSession.ip });

      // 发送用户信息给客户端
      socket.emit('user_connected', {
        accountId: accountId,
        token: sessionToken,
        nickname: userSession.nickname,
        status: userSession.status,
        accountType: accountData.account?.type || 'anonymous',
        stats: accountData.stats || {}
      });

      // 广播用户上线（只有已登录用户）
      if (accountId) {
        this.broadcastUserStatus(accountId, 'online', io);
      }

      // 发送在线用户列表
      this.sendOnlineUsers(socket, io);

      // 发送系统统计
      socket.emit('system_stats', {
        onlineUsers: this.onlineUsers.size,
        peakOnline: this.stats.peakOnline,
        totalConnections: this.stats.totalConnections
      });

      return userSession;

    } catch (err) {
      logger.error('处理用户连接失败', { socketId: socket.id, error: err.message });

      // 发送错误信息给客户端
      socket.emit('connection_error', {
        message: '连接失败，请稍后重试',
        code: 'CONNECTION_FAILED'
      });

      return null;
    }
  }

  // 生成会话token
  generateSessionToken(accountId) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    const tokenData = `${accountId}|${timestamp}|${random}`;
    return Buffer.from(tokenData).toString('base64');
  }

  // 更新用户状态
  updateUserStatus(accountId, status, gameType = null) {
    const userSession = this.onlineUsers.get(accountId);
    if (userSession) {
      userSession.status = status;
      if (gameType) userSession.gameType = gameType;
      userSession.lastActivity = Date.now();
      return userSession;
    }
    return null;
  }

  // 更新用户活动时间
  updateUserActivity(accountId) {
    const userSession = this.onlineUsers.get(accountId);
    if (userSession) {
      userSession.lastActivity = Date.now();
      this.resetUserWarning(accountId);
    }
  }

  // 更新用户统计 - 委托给AccountManager
  async updateUserStats(accountId, result, gameType = null, isAI = false, aiDifficulty = null, duration = null) {
    if (this.accountManager) {
      try {
        // 委托给AccountManager处理数据持久化
        const statsResult = await this.accountManager.updateGameStats(accountId, result, gameType, isAI, aiDifficulty, duration);

        // 更新本地会话数据
        const userSession = this.onlineUsers.get(accountId);
        if (userSession && statsResult.success) {
          // 获取更新后的账号数据
          const updatedAccount = await this.accountManager.getAccount(accountId);
          if (updatedAccount) {
            userSession.accountData = updatedAccount;
            userSession.nickname = updatedAccount.account?.nickname || userSession.nickname;

            // 通知客户端
            const socket = this.getSocketByAccountId(accountId);
            if (socket) {
              socket.emit('account_updated', { account: updatedAccount });
            }
          }
        }

        return statsResult;
      } catch (err) {
        logger.error('更新用户统计失败', { accountId, error: err.message });
        return { success: false, message: '更新统计失败' };
      }
    }
    return { success: false, message: 'AccountManager不可用' };
  }

  // 广播用户状态
  broadcastUserStatus(accountId, status, io) {
    const userSession = this.onlineUsers.get(accountId);
    if (userSession) {
      io.emit('user_status', {
        accountId: accountId,
        nickname: userSession.nickname,
        status,
        gameType: userSession.gameType,
        timestamp: Date.now()
      });
    }
  }

  // 发送在线用户列表
  sendOnlineUsers(socket, io) {
    const onlineUsers = Array.from(this.onlineUsers.values())
      .filter(userSession => userSession.accountId && userSession.accountId !== userSession.socketId) // 过滤匿名用户（accountId 为 null 或等于 socketId）
      .map(userSession => ({
        accountId: userSession.accountId,
        nickname: userSession.nickname,
        status: userSession.status,
        gameType: userSession.gameType,
        accountType: userSession.accountData?.account?.type || 'guest',
        level: userSession.accountData?.account?.profile?.level || 1
      }));

    socket.emit('online_users', onlineUsers);
  }

  // 处理用户断开连接
  async handleUserDisconnect(socketId, io) {
    const accountId = this.socketToAccount.get(socketId);
    if (accountId) {
      // 检查是否是匿名用户（accountId === socketId）
      if (accountId === socketId) {
        // 匿名用户，直接清理
        this.onlineUsers.delete(socketId);
        this.socketToAccount.delete(socketId);
        logger.info('匿名用户断开连接', { socketId });
        return null;
      }

      // 已登录用户
      const userSession = this.onlineUsers.get(accountId);
      if (userSession) {
        logger.userAction(accountId, '断开连接', {
          onlineDuration: Date.now() - userSession.connectedAt
        });

        // 广播离线状态
        this.broadcastUserStatus(accountId, 'offline', io);

        // 委托给AccountManager保存最后在线时间
        if (this.accountManager) {
          try {
            await this.accountManager.updateLastSeen(accountId);
          } catch (err) {
            logger.warn('保存最后在线时间失败', { accountId, error: err.message });
          }
        }

        // 清理会话数据
        this.socketToAccount.delete(socketId);
        this.onlineUsers.delete(accountId);

        return userSession;
      }
    }
    return null;
  }

  // 获取用户会话（通过socketId）
  getUserBySocketId(socketId) {
    const accountId = this.socketToAccount.get(socketId);
    // 如果accountId是socketId本身（匿名用户），直接返回
    if (accountId === socketId) {
      return this.onlineUsers.get(socketId);
    }
    return accountId ? this.onlineUsers.get(accountId) : null;
  }

  // 游客登录 - 分配游客账号
  async handleGuestLogin(socket) {
    try {
      if (!this.accountManager) {
        return { success: false, message: 'AccountManager不可用' };
      }

      const guestResult = await this.accountManager.createGuestUser();
      if (!guestResult) {
        return { success: false, message: '创建游客账号失败' };
      }

      const accountId = guestResult.account.id;
      const sessionToken = this.accountManager.generateSessionToken(accountId);

      // 更新用户会话
      const userSession = this.getUserBySocketId(socket.id);
      if (userSession) {
        // 删除旧的匿名会话
        this.onlineUsers.delete(socket.id);

        // 创建新的游客会话
        userSession.accountId = accountId;
        userSession.token = sessionToken;
        userSession.nickname = guestResult.account.nickname;
        userSession.accountData = guestResult;
        userSession.accountType = 'guest';

        // 存储新的会话
        this.socketToAccount.set(socket.id, accountId);
        this.onlineUsers.set(accountId, userSession);
      }

      logger.info('游客登录成功', { accountId, socketId: socket.id });

      return {
        success: true,
        message: '游客登录成功',
        data: {
          account: guestResult,
          token: sessionToken,
          loginType: 'guest'
        }
      };
    } catch (err) {
      logger.error('游客登录失败', { socketId: socket.id, error: err.message });
      return { success: false, message: '游客登录失败' };
    }
  }

  // 账号登录 - 验证用户名密码
  async handleAccountLogin(socket, username, password) {
    try {
      if (!this.accountManager) {
        return { success: false, message: 'AccountManager不可用' };
      }

      const result = await this.accountManager.login(username, password);
      if (!result.success) {
        return result;
      }

      const account = result.account;
      const accountId = account.account.id;
      const sessionToken = this.accountManager.generateSessionToken(accountId);

      // 更新用户会话
      const userSession = this.getUserBySocketId(socket.id);
      if (userSession) {
        // 删除旧的匿名会话
        this.onlineUsers.delete(socket.id);

        // 创建新的账号会话
        userSession.accountId = accountId;
        userSession.token = sessionToken;
        userSession.nickname = account.account.nickname;
        userSession.accountData = account;
        userSession.accountType = account.account.type;

        // 存储新的会话
        this.socketToAccount.set(socket.id, accountId);
        this.onlineUsers.set(accountId, userSession);
      }

      logger.info('账号登录成功', { accountId, username, socketId: socket.id });

      return {
        success: true,
        message: '账号登录成功',
        data: {
          account: account,
          token: sessionToken,
          loginType: 'account'
        }
      };
    } catch (err) {
      logger.error('账号登录失败', { username, socketId: socket.id, error: err.message });
      return { success: false, message: '账号登录失败' };
    }
  }

  // 获取用户会话（通过accountId）
  getUserByAccountId(accountId) {
    return this.onlineUsers.get(accountId);
  }

  // 获取用户socket（通过accountId）
  getSocketByAccountId(accountId) {
    const userSession = this.onlineUsers.get(accountId);
    return userSession ? userSession.socket : null;
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
    for (const userSession of this.onlineUsers.values()) {
      if (userSession.status === 'waiting') {
        if (!gameType || userSession.gameType === gameType) {
          count++;
        }
      }
    }
    return count;
  }

  // 获取游戏中的用户数
  getPlayingCount() {
    let count = 0;
    for (const userSession of this.onlineUsers.values()) {
      if (userSession.status === 'playing') {
        count++;
      }
    }
    return count;
  }

  // 踢出用户
  kickUser(accountId, reason = '管理员操作') {
    const socket = this.getSocketByAccountId(accountId);
    if (socket) {
      socket.emit('kicked', { reason });
      socket.disconnect(true);
      logger.userAction(accountId, '被踢出', { reason });
      return true;
    }
    return false;
  }

  // 检查不活跃用户
  checkInactiveUsers(io, timeout = config.game.inactivityTimeout) {
    const now = Date.now();
    const inactiveUsers = [];
    const warningUsers = [];

    for (const [accountId, userSession] of this.onlineUsers) {
      if (userSession.status === 'online') {
        const inactivityTime = now - userSession.lastActivity;

        // 第一阶段：15分钟无活动，发送警告
        if (inactivityTime > 15 * 60 * 1000 && !userSession.warningSent) {
          warningUsers.push({ accountId, userSession, inactivityTime });
        }

        // 第二阶段：超过超时时间，准备断开
        if (inactivityTime > timeout) {
          inactiveUsers.push(accountId);
        }
      }
    }

    // 发送警告消息
    for (const { accountId, userSession, inactivityTime } of warningUsers) {
      const socket = this.getSocketByAccountId(accountId);
      if (socket) {
        const remainingMinutes = Math.ceil((timeout - inactivityTime) / 1000 / 60);
        socket.emit('inactive_warning', {
          message: `您已${Math.floor(inactivityTime / 1000 / 60)}分钟未活动，${remainingMinutes}分钟后将被断开连接`,
          level: 'warning',
          remainingTime: remainingMinutes * 60 * 1000
        });
        userSession.warningSent = true;
        logger.info('发送不活跃警告', { accountId, inactivityTime: Math.floor(inactivityTime / 1000 / 60) });
      }
    }

    // 处理超时用户
    for (const accountId of inactiveUsers) {
      const socket = this.getSocketByAccountId(accountId);
      if (socket) {
        socket.emit('inactive_warning', {
          message: '您已长时间未活动，即将断开连接',
          level: 'critical'
        });

        // 30秒后断开连接
        setTimeout(() => {
          const userSession = this.onlineUsers.get(accountId);
          if (userSession && userSession.status === 'online') {
            this.kickUser(accountId, '长时间未活动');
            logger.info('断开不活跃用户', { accountId, inactivityTime: Math.floor((Date.now() - userSession.lastActivity) / 1000 / 60) });
          }
        }, 30000); // 30秒后断开
      }
    }

    return { inactiveCount: inactiveUsers.length, warningCount: warningUsers.length };
  }

  // 重置用户警告状态
  resetUserWarning(accountId) {
    const userSession = this.onlineUsers.get(accountId);
    if (userSession && userSession.warningSent) {
      userSession.warningSent = false;
      logger.info('重置用户警告状态', { accountId });
    }
  }

  // 获取排行榜 - 委托给AccountManager
  async getLeaderboard(limit = 10, gameType = 'all') {
    if (!this.accountManager) {
      logger.error('AccountManager不可用，无法获取排行榜');
      return [];
    }

    try {
      return await this.accountManager.getLeaderboard(limit, gameType);
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
