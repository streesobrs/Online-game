// AccountManager.js - 账号管理模块
const crypto = require('crypto');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');

class AccountManager {
  constructor() {
    // 密码哈希迭代次数 - 可根据需要调整
    this.iterations = 10000;
    // 密钥长度
    this.keyLength = 64;
    // 哈希算法
    this.digest = 'sha512';
  }

  // 生成密码盐
  generateSalt() {
    return crypto.randomBytes(16).toString('hex');
  }

  // 哈希密码
  hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.digest).toString('hex');
  }

  // 验证密码
  verifyPassword(password, salt, hash) {
    const hashToVerify = this.hashPassword(password, salt);
    return hashToVerify === hash;
  }

  // 生成账号ID
  generateAccountId() {
    return 'acc_' + crypto.randomBytes(8).toString('hex');
  }

  // 检查用户名是否已存在
  async usernameExists(username) {
    try {
      const account = await dataStore.findOne('accounts', { username });
      return !!account;
    } catch (err) {
      logger.error('检查用户名失败', { username, error: err.message });
      return false;
    }
  }

  // 注册新账号
  async register(username, password, nickname = null) {
    // 验证用户名
    if (!this.validateUsername(username)) {
      return {
        success: false,
        message: '用户名只能包含字母、数字和下划线，长度3-20位'
      };
    }

    // 验证密码
    if (!this.validatePassword(password)) {
      return {
        success: false,
        message: '密码长度至少6位'
      };
    }

    // 检查用户名是否已存在
    if (await this.usernameExists(username)) {
      return {
        success: false,
        message: '用户名已存在'
      };
    }

    // 创建账号
    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(password, salt);
    const accountId = this.generateAccountId();

    const account = {
      id: accountId,
      accountId: accountId,
      username: username.toLowerCase(),
      passwordSalt: salt,
      passwordHash: passwordHash,
      nickname: nickname || username,
      profile: {
        avatar: null,
        bio: '',
        level: 1,
        exp: 0
      },
      stats: {
        wins: 0,
        losses: 0,
        draws: 0,
        totalGames: 0,
        gameTypeWins: {
          gobang: 0,
          chess: 0,
          go: 0
        },
        streak: 0,
        maxStreak: 0,
        aiWins: 0,
        aiDifficulty: null,
        aiResult: null,
        firstGame: false,
        nightGame: false,
        weekendGame: false,
        chatMessages: 0,
        silentWin: false,
        comebackStreak: 0,
        allGameTypes: false,
        singleGameType: false,
        quickGame: false,
        slowGame: false,
        luckyWin: false,
        unluckyLoss: false,
        friends: 0,
        lonerWin: false,
        signInStreak: 0,
        badges: 0,
        dailyGames: 0,
        weeklyGames: 0,
        monthlyGames: 0,
        lowLevelWins: 0,
        returnPlayer: false,
        invites: 0
      },
      createdAt: Date.now(),
      lastLogin: Date.now()
    };

    try {
      await dataStore.add('accounts', account);
      logger.info('新账号注册', { accountId, username });

      return {
        success: true,
        accountId: accountId,
        username: account.username,
        nickname: account.nickname,
        message: '注册成功'
      };
    } catch (err) {
      logger.error('账号注册失败', { username, error: err.message });
      return {
        success: false,
        message: '注册失败，请稍后重试'
      };
    }
  }

  // 登录
  async login(username, password) {
    try {
      const account = await dataStore.findOne('accounts', { username: username.toLowerCase() });

      if (!account) {
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      // 验证密码
      const isValid = this.verifyPassword(password, account.passwordSalt, account.passwordHash);

      if (!isValid) {
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      // 更新最后登录时间
      account.lastLogin = Date.now();
      await dataStore.update('accounts', account.accountId, {
        lastLogin: Date.now()
      });

      logger.info('账号登录', { accountId: account.accountId, username: account.username });

      // 生成登录token
      const loginToken = crypto.randomBytes(32).toString('hex');

      return {
        success: true,
        account: {
          accountId: account.accountId,
          username: account.username,
          nickname: account.nickname,
          profile: account.profile,
          stats: account.stats,
          createdAt: account.createdAt,
          lastLoginAt: account.lastLogin
        },
        token: loginToken,
        message: '登录成功'
      };
    } catch (err) {
      logger.error('账号登录失败', { username, error: err.message });
      return {
        success: false,
        message: '登录失败，请稍后重试'
      };
    }
  }

  // 获取账号信息
  async getAccount(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { accountId });
      if (!account) {
        return null;
      }
      // 不返回密码相关信息
      const { passwordSalt, passwordHash, ...safeAccount } = account;
      return safeAccount;
    } catch (err) {
      logger.error('获取账号信息失败', { accountId, error: err.message });
      return null;
    }
  }

  // 更新账号资料
  async updateProfile(accountId, updates) {
    try {
      const account = await dataStore.findOne('accounts', { accountId });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      const allowedUpdates = ['nickname', 'profile'];
      const updateData = {};

      for (const key of allowedUpdates) {
        if (updates[key] !== undefined) {
          updateData[key] = updates[key];
        }
      }

      await dataStore.update('accounts', accountId, updateData);
      logger.info('账号资料更新', { accountId, updates: Object.keys(updateData) });

      return {
        success: true,
        message: '资料更新成功'
      };
    } catch (err) {
      logger.error('更新账号资料失败', { accountId, error: err.message });
      return {
        success: false,
        message: '更新失败，请稍后重试'
      };
    }
  }

  // 更新聊天消息统计
  async updateChatMessages(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { accountId });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      const stats = account.stats || { chatMessages: 0 };
      stats.chatMessages = (stats.chatMessages || 0) + 1;

      await dataStore.update('accounts', accountId, { stats });
      logger.info('聊天消息统计更新', { accountId, total: stats.chatMessages });

      return { success: true };
    } catch (err) {
      logger.error('更新聊天消息统计失败', { accountId, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }

  // 更新游戏统计
  async updateGameStats(accountId, result, gameType = null, isAI = false, aiDifficulty = null, duration = null) {
    try {
      const account = await dataStore.findOne('accounts', { accountId });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      const stats = account.stats || {
        wins: 0, losses: 0, draws: 0, totalGames: 0,
        gameTypeWins: { gobang: 0, chess: 0, go: 0 },
        streak: 0, maxStreak: 0, aiWins: 0,
        aiDifficulty: null, aiResult: null, firstGame: false,
        nightGame: false, weekendGame: false, chatMessages: 0,
        silentWin: false, comebackStreak: 0, allGameTypes: false,
        singleGameType: false, quickGame: false, slowGame: false,
        luckyWin: false, unluckyLoss: false, friends: 0,
        lonerWin: false, signInStreak: 0, badges: 0,
        dailyGames: 0, weeklyGames: 0, monthlyGames: 0,
        lowLevelWins: 0, returnPlayer: false, invites: 0
      };

      if (result === 'win') {
        stats.wins++;
        stats.streak++;
        if (stats.streak > stats.maxStreak) {
          stats.maxStreak = stats.streak;
        }

        if (gameType) {
          if (!stats.gameTypeWins) stats.gameTypeWins = { gobang: 0, chess: 0, go: 0 };
          stats.gameTypeWins[gameType] = (stats.gameTypeWins[gameType] || 0) + 1;
        }

        if (isAI) {
          stats.aiWins++;
          stats.aiDifficulty = aiDifficulty;
          stats.aiResult = 'win';
        }

        if (account.profile && account.profile.level < 10) {
          stats.lowLevelWins++;
        }
      } else if (result === 'loss') {
        stats.losses++;
        stats.streak = 0;

        if (isAI) {
          stats.aiDifficulty = aiDifficulty;
          stats.aiResult = 'loss';
        }
      } else if (result === 'draw') {
        stats.draws++;
        stats.streak = 0;
      }
      stats.totalGames++;

      if (stats.totalGames === 1) {
        stats.firstGame = true;
      }

      const now = new Date();
      const hour = now.getHours();
      if (hour >= 2 && hour < 6) {
        stats.nightGame = true;
      }

      const day = now.getDay();
      if (day === 0 || day === 6) {
        stats.weekendGame = true;
      }

      if (duration) {
        if (duration < 5 * 60 * 1000) {
          stats.quickGame = true;
        } else if (duration > 60 * 60 * 1000) {
          stats.slowGame = true;
        }
      }

      const profile = account.profile || { level: 1, exp: 0 };
      profile.exp += result === 'win' ? 10 : (result === 'draw' ? 5 : 2);

      while (profile.exp >= profile.level * 100) {
        profile.exp -= profile.level * 100;
        profile.level++;
      }

      await dataStore.update('accounts', accountId, { stats, profile });
      logger.info('账号游戏统计更新', { accountId, result, gameType, isAI });

      return { success: true, stats };
    } catch (err) {
      logger.error('更新账号游戏统计失败', { accountId, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }

  // 添加经验值
  async addExp(accountId, exp) {
    try {
      const account = await dataStore.findOne('accounts', { accountId });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      const profile = account.profile || { level: 1, exp: 0 };
      profile.exp += exp;

      while (profile.exp >= profile.level * 100) {
        profile.exp -= profile.level * 100;
        profile.level++;
      }

      await dataStore.update('accounts', accountId, { profile });
      logger.info('添加经验值', { accountId, exp });

      return { success: true };
    } catch (err) {
      logger.error('添加经验值失败', { accountId, error: err.message });
      return { success: false, message: '添加失败' };
    }
  }

  // 修改密码
  async changePassword(accountId, oldPassword, newPassword) {
    try {
      const account = await dataStore.findOne('accounts', { accountId });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 验证旧密码
      const isValid = this.verifyPassword(oldPassword, account.passwordSalt, account.passwordHash);
      if (!isValid) {
        return {
          success: false,
          message: '原密码错误'
        };
      }

      // 验证新密码
      if (!this.validatePassword(newPassword)) {
        return {
          success: false,
          message: '新密码长度至少6位'
        };
      }

      // 生成新的密码哈希
      const newSalt = this.generateSalt();
      const newHash = this.hashPassword(newPassword, newSalt);

      await dataStore.update('accounts', accountId, {
        passwordSalt: newSalt,
        passwordHash: newHash
      });

      logger.info('密码修改', { accountId });
      return {
        success: true,
        message: '密码修改成功'
      };
    } catch (err) {
      logger.error('修改密码失败', { accountId, error: err.message });
      return {
        success: false,
        message: '修改失败，请稍后重试'
      };
    }
  }

  // 验证用户名格式
  validateUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < 3 || username.length > 20) return false;
    return /^[a-zA-Z0-9_]+$/.test(username);
  }

  // 验证密码格式
  validatePassword(password) {
    if (!password || typeof password !== 'string') return false;
    return password.length >= 6;
  }

  // 获取所有账号列表（用于后台管理）
  async getAllAccounts(limit = 50) {
    try {
      const accounts = await dataStore.read('accounts');
      return accounts
        .slice(-limit)
        .reverse()
        .map(acc => {
          const { passwordSalt, passwordHash, ...safeAcc } = acc;
          safeAcc.lastLoginAt = safeAcc.lastLogin;
          return safeAcc;
        });
    } catch (err) {
      logger.error('获取账号列表失败', { error: err.message });
      return [];
    }
  }

  // 管理员删除账号
  async deleteAccount(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { accountId });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      await dataStore.remove('accounts', { accountId });
      logger.info('账号被删除', { accountId, username: account.username });

      return {
        success: true,
        message: '账号已删除'
      };
    } catch (err) {
      logger.error('删除账号失败', { accountId, error: err.message });
      return {
        success: false,
        message: '删除失败，请稍后重试'
      };
    }
  }
}

module.exports = AccountManager;
