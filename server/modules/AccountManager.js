// AccountManager.js - 账号管理模块
const crypto = require('crypto');
const logger = require('../utils/logger');
const dataStore = require('../utils/dataStore');
const fs = require('fs');
const path = require('path');

class AccountManager {
  constructor() {
    // 密码哈希迭代次数 - 可根据需要调整
    this.iterations = 10000;
    // 密钥长度
    this.keyLength = 64;
    // 哈希算法
    this.digest = 'sha512';
    // 加载等级经验配置
    this.levelExpConfig = this.loadLevelExpConfig();
  }

  loadLevelExpConfig() {
    try {
      const configPath = path.join(__dirname, '../config/levelExp.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      return config.levelExp || {};
    } catch (err) {
      logger.error('加载等级经验配置失败', { error: err.message });
      // 默认使用 level * 100 的公式
      return {};
    }
  }

  getExpForLevel(level) {
    if (this.levelExpConfig[level]) {
      return this.levelExpConfig[level];
    }
    // 如果配置表中没有，使用默认公式
    return (level - 1) * 100;
  }

  getTotalExpForLevel(level) {
    let totalExp = 0;
    for (let i = 1; i <= level; i++) {
      totalExp += this.getExpForLevel(i);
    }
    return totalExp;
  }

  // 根据总经验值计算等级和剩余经验值
  calculateLevelAndExp(totalExp) {
    let level = 1;
    let exp = totalExp;

    while (exp >= this.getExpForLevel(level + 1)) {
      exp -= this.getExpForLevel(level + 1);
      level++;
    }

    return { level, exp };
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

  // 生成用户ID
  generateUserId() {
    return crypto.randomBytes(8).toString('hex');
  }

  // 检查用户名是否已存在
  async usernameExists(username) {
    try {
      const account = await dataStore.findOne('accounts', { username: username.toLowerCase(), type: { $ne: 'guest' } });
      return !!account;
    } catch (err) {
      logger.error('检查用户名失败', { username, error: err.message });
      return false;
    }
  }

  // 游客登录
  async guestLogin() {
    try {
      // 创建游客用户
      const guestUser = await this.createGuestUser();
      if (!guestUser) {
        return {
          success: false,
          message: '创建游客账号失败'
        };
      }

      // 获取权限配置
      const config = require('../config');
      const permissions = config.permissions.guest;

      // 返回完整的登录响应
      return {
        success: true,
        message: '游客登录成功',
        data: {
          account: guestUser,
          permissions: permissions,
          token: this.generateSessionToken(guestUser.id),
          loginType: 'guest'
        }
      };
    } catch (err) {
      logger.error('游客登录失败', { error: err.message });
      return {
        success: false,
        message: '游客登录失败'
      };
    }
  }

  // 账号密码登录
  async accountLogin(username, password) {
    try {
      // 查找用户（用户名转小写匹配）
      const account = await dataStore.findOne('accounts', {
        username: username.toLowerCase(),
        type: { $ne: 'guest' }
      });

      if (!account) {
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      // 验证密码
      if (!this.verifyPassword(password, account.passwordSalt, account.passwordHash)) {
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      // 检查是否为回归玩家（用于成就检测）
      const now = Date.now();
      const lastLogin = account.lastLogin || 0;
      const daysSinceLastLogin = (now - lastLogin) / (1000 * 60 * 60 * 24);
      const returnPlayer = daysSinceLastLogin >= 7;
      const longReturnPlayer = daysSinceLastLogin >= 30;

      // 更新最后登录时间
      await dataStore.update('accounts', { id: account.id }, {
        lastLogin: now,
        lastSeen: now,
        'stats.returnPlayer': returnPlayer,
        'stats.longReturnPlayer': longReturnPlayer
      });

      // 获取权限配置
      const config = require('../config');
      const permissions = config.permissions[account.type] || config.permissions.registered;

      // 返回完整的登录响应
      return {
        success: true,
        message: '登录成功',
        data: {
          account: {
            ...account,
            passwordSalt: undefined,
            passwordHash: undefined
          },
          permissions: permissions,
          token: this.generateSessionToken(account.id),
          loginType: 'account'
        }
      };
    } catch (err) {
      logger.error('账号登录失败', { username, error: err.message });
      return {
        success: false,
        message: '登录失败，请稍后重试'
      };
    }
  }

  // 生成会话令牌
  generateSessionToken(id) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    const tokenData = `${id}|${timestamp}|${random}`;
    return Buffer.from(tokenData).toString('base64');
  }

  // 验证会话令牌
  verifySessionToken(token) {
    try {
      const tokenData = Buffer.from(token, 'base64').toString('utf8');
      const [id, timestamp, random] = tokenData.split('|');

      // 检查令牌是否过期（24小时）
      const tokenAge = Date.now() - parseInt(timestamp);
      if (tokenAge > 24 * 60 * 60 * 1000) {
        return null;
      }

      return id;
    } catch (err) {
      return null;
    }
  }

  // 创建游客用户
  async createGuestUser(nickname = null) {
    const guestId = this.generateUserId();
    const guestUser = {
      id: guestId,
      type: 'guest',
      nickname: nickname || `玩家${guestId.substr(0, 4)}`,
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

    try {
      await dataStore.add('accounts', guestUser);
      logger.info('创建游客用户', { guestId, nickname: guestUser.nickname });

      // 不返回敏感信息
      const { ...safeGuest } = guestUser;
      return safeGuest;
    } catch (err) {
      logger.error('创建游客用户失败', { guestId, error: err.message });
      return null;
    }
  }

  // 获取用户信息（支持游客和注册用户）
  async getUser(id) {
    try {
      const user = await dataStore.findOne('accounts', { id });
      if (!user) {
        return null;
      }

      // 不返回密码相关信息
      const { passwordSalt, passwordHash, ...safeUser } = user;
      return safeUser;
    } catch (err) {
      logger.error('获取用户信息失败', { id, error: err.message });
      return null;
    }
  }

  // 通过token获取账号信息
  async getAccountByToken(token) {
    try {
      // 验证token并获取用户ID
      const userId = this.verifySessionToken(token);
      if (!userId) {
        return {
          success: false,
          message: 'Token无效或已过期'
        };
      }

      // 获取账号信息
      const account = await this.getUser(userId);
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 获取权限配置
      const config = require('../config');
      const permissions = config.permissions[account.type] || config.permissions.registered;

      return {
        success: true,
        data: {
          account: account,
          permissions: permissions,
          loginType: account.type === 'guest' ? 'guest' : 'account'
        }
      };
    } catch (err) {
      logger.error('通过token获取账号信息失败', { error: err.message });
      return {
        success: false,
        message: '获取账号信息失败'
      };
    }
  }

  // 更新用户信息（支持游客和注册用户）
  async updateUser(id, updates) {
    try {
      const user = await dataStore.findOne('accounts', { id });
      if (!user) {
        return {
          success: false,
          message: '用户不存在'
        };
      }

      // 更新用户信息
      const updateData = { ...updates, updatedAt: Date.now() };
      await dataStore.update('accounts', id, updateData);

      logger.info('更新用户信息', { id, updates: Object.keys(updates) });

      return {
        success: true,
        message: '更新成功'
      };
    } catch (err) {
      logger.error('更新用户信息失败', { id, error: err.message });
      return {
        success: false,
        message: '更新失败'
      };
    }
  }

  // 注册新账号（支持游客升级）
  async register(username, password, nickname = null, guestUserId = null) {
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

    // 检查是否有游客账号需要升级
    let guestAccount = null;
    if (guestUserId) {
      guestAccount = await dataStore.findOne('accounts', {
        id: guestUserId,
        type: 'guest'
      });
    }

    // 创建密码哈希
    const salt = this.generateSalt();
    const passwordHash = this.hashPassword(password, salt);
    const now = Date.now();

    if (guestAccount) {
      // 升级游客账号为正式账号，保持原有 id 不变
      const updatedAccount = {
        ...guestAccount,
        type: 'registered',
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
        lastLogin: now,
        lastSeen: now,
        updatedAt: now
      };

      try {
        // 直接更新账号（保持 id 不变）
        await dataStore.update('accounts', guestUserId, updatedAccount);
        logger.info('游客账号升级为正式账号', {
          id: guestUserId,
          username
        });

        return {
          success: true,
          id: guestUserId,
          username: updatedAccount.username,
          nickname: updatedAccount.nickname,
          message: '注册成功'
        };
      } catch (err) {
        logger.error('账号升级失败', { username, error: err.message });
        return {
          success: false,
          message: '注册失败，请稍后重试'
        };
      }
    } else {
      // 没有游客账号，创建新账号
      const accountId = this.generateUserId();
      const account = {
        id: accountId,
        type: 'registered',
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
        createdAt: now,
        lastLogin: now,
        lastSeen: now,
        updatedAt: now
      };

      try {
        await dataStore.add('accounts', account);
        logger.info('新账号注册', { id: accountId, username });

        return {
          success: true,
          id: accountId,
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
      await dataStore.update('accounts', account.id, {
        lastLogin: Date.now()
      });

      logger.info('账号登录', { id: account.id, username: account.username });

      // 生成登录token
      const loginToken = crypto.randomBytes(32).toString('hex');

      return {
        success: true,
        account: {
          id: account.id,
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
  async getAccount(id) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return null;
      }
      // 不返回密码相关信息
      const { passwordSalt, passwordHash, ...safeAccount } = account;
      return safeAccount;
    } catch (err) {
      logger.error('获取账号信息失败', { id, error: err.message });
      return null;
    }
  }

  // 更新账号资料
  async updateProfile(id, updates) {
    try {
      const account = await dataStore.findOne('accounts', { id });
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

      await dataStore.update('accounts', id, updateData);
      logger.info('账号资料更新', { id, updates: Object.keys(updateData) });

      return {
        success: true,
        message: '资料更新成功'
      };
    } catch (err) {
      logger.error('更新账号资料失败', { id, error: err.message });
      return {
        success: false,
        message: '更新失败，请稍后重试'
      };
    }
  }

  // 更新聊天消息统计
  async updateChatMessages(id) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      const stats = account.stats || { chatMessages: 0 };
      stats.chatMessages = (stats.chatMessages || 0) + 1;

      await dataStore.update('accounts', id, { stats });
      logger.info('聊天消息统计更新', { id, total: stats.chatMessages });

      return { success: true };
    } catch (err) {
      logger.error('更新聊天消息统计失败', { id, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }

  // 更新游戏统计
  async updateGameStats(id, result, gameType = null, isAI = false, aiDifficulty = null, duration = null) {
    try {
      const account = await dataStore.findOne('accounts', { id });
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

        if (account.profile && account.profile.exp) {
          const totalExp = account.profile.exp;
          let level = 1;
          let exp = totalExp;
          while (exp >= this.getExpForLevel(level + 1)) {
            exp -= this.getExpForLevel(level + 1);
            level++;
          }
          if (level < 10) {
            stats.lowLevelWins++;
          }
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

      const profile = account.profile || { exp: 0 };
      profile.exp += result === 'win' ? 10 : (result === 'draw' ? 5 : 2);

      await dataStore.update('accounts', id, { stats, profile });
      logger.info('账号游戏统计更新', { id, result, gameType, isAI });

      return { success: true, stats };
    } catch (err) {
      logger.error('更新账号游戏统计失败', { id, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }

  // 添加经验值
  async addExp(id, exp) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      const profile = account.profile || { exp: 0 };
      profile.exp += exp;

      await dataStore.update('accounts', id, { profile });
      logger.info('添加经验值', { id, exp });

      return { success: true };
    } catch (err) {
      logger.error('添加经验值失败', { id, error: err.message });
      return { success: false, message: '添加失败' };
    }
  }

  // 修改密码
  async changePassword(id, oldPassword, newPassword) {
    try {
      const account = await dataStore.findOne('accounts', { id });
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

      await dataStore.update('accounts', id, {
        passwordSalt: newSalt,
        passwordHash: newHash
      });

      logger.info('密码修改', { id });
      return {
        success: true,
        message: '密码修改成功'
      };
    } catch (err) {
      logger.error('修改密码失败', { id, error: err.message });
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
      // 强制重新读取数据，确保获取最新状态
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
  async deleteAccount(id) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      await dataStore.delete('accounts', id);
      logger.info('账号被删除', { id, username: account.username });

      return {
        success: true,
        message: '账号已删除'
      };
    } catch (err) {
      logger.error('删除账号失败', { id, error: err.message });
      return {
        success: false,
        message: '删除失败，请稍后重试'
      };
    }
  }

  // 管理员修改用户经验值
  async modifyUserExp(id, operation, amount) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 确保profile对象存在
      const profile = account.profile || { exp: 0 };
      let exp = profile.exp || 0;

      switch (operation) {
        case 'add':
          exp = exp + amount;
          break;
        case 'subtract':
          exp = Math.max(0, exp - amount);
          break;
        case 'reset':
          exp = 0;
          break;
        case 'set':
          exp = Math.max(0, amount);
          break;
        default:
          return {
            success: false,
            message: '无效的操作类型'
          };
      }

      await dataStore.update('accounts', id, { profile: { exp } });
      logger.info('管理员修改用户经验值', { id, operation, amount, oldExp: profile.exp, newExp: exp });

      return {
        success: true,
        message: '经验值修改成功',
        oldExp: profile.exp,
        newExp: exp
      };
    } catch (err) {
      logger.error('修改用户经验值失败', { id, error: err.message });
      return {
        success: false,
        message: '修改失败，请稍后重试'
      };
    }
  }

  // 管理员添加用户成就
  async addUserAchievement(id, achievementId) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      const achievements = account.achievements || [];
      if (achievements.includes(achievementId)) {
        return {
          success: false,
          message: '该成就已解锁'
        };
      }

      achievements.push(achievementId);
      await dataStore.update('accounts', id, { achievements });
      logger.info('管理员添加用户成就', { id, achievementId });

      return {
        success: true,
        message: '成就添加成功',
        achievementId: achievementId
      };
    } catch (err) {
      logger.error('添加用户成就失败', { id, achievementId, error: err.message });
      return {
        success: false,
        message: '添加失败，请稍后重试'
      };
    }
  }

  // 管理员移除用户成就
  async removeUserAchievement(id, achievementId) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      const achievements = account.achievements || [];
      const index = achievements.indexOf(achievementId);
      if (index === -1) {
        return {
          success: false,
          message: '该成就未解锁'
        };
      }

      achievements.splice(index, 1);
      await dataStore.update('accounts', id, { achievements });
      logger.info('管理员移除用户成就', { id, achievementId });

      return {
        success: true,
        message: '成就移除成功',
        achievementId: achievementId
      };
    } catch (err) {
      logger.error('移除用户成就失败', { id, achievementId, error: err.message });
      return {
        success: false,
        message: '移除失败，请稍后重试'
      };
    }
  }

  // 管理员重置用户成就
  async resetUserAchievements(id) {
    try {
      const account = await dataStore.findOne('accounts', { id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      await dataStore.update('accounts', id, { achievements: [] });
      logger.info('管理员重置用户成就', { id });

      return {
        success: true,
        message: '成就重置成功'
      };
    } catch (err) {
      logger.error('重置用户成就失败', { id, error: err.message });
      return {
        success: false,
        message: '重置失败，请稍后重试'
      };
    }
  }
}

module.exports = AccountManager;
