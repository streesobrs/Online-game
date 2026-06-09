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

  // 节假日名称→倍率映射
  static HOLIDAY_MULTIPLIERS = {
    '春节': 2.5,
    '除夕': 2.5,
    '国庆节': 2.5,
    '元旦': 2.0,
    '劳动节': 2.0,
    '清明节': 2.0,
    '端午节': 2.0,
    '中秋节': 2.0,
  };

  // 节假日缓存（静态）
  static holidayCache = null;
  static holidayCacheDate = null; // 缓存日期字符串，用于判断是否过期

  // 节假日缓存文件路径
  static get HOLIDAY_CACHE_PATH() {
    return path.join(__dirname, '..', 'config', 'holidayCache.json');
  }

  // 从本地文件读取节假日缓存
  static loadHolidayCacheFromFile() {
    try {
      if (fs.existsSync(AccountManager.HOLIDAY_CACHE_PATH)) {
        const raw = fs.readFileSync(AccountManager.HOLIDAY_CACHE_PATH, 'utf8');
        const data = JSON.parse(raw);
        const yearNow = new Date().getFullYear();
        if (data.year === yearNow && data.cache) {
          AccountManager.holidayCache = data.cache;
          AccountManager.holidayCacheDate = yearNow;
          logger.info('节假日缓存加载成功', { year: yearNow, count: Object.keys(data.cache).length });
          return true;
        }
      }
    } catch (err) {
      logger.warn('读取节假日缓存文件失败', { error: err.message });
    }
    return false;
  }

  // 保存节假日缓存到本地文件
  static saveHolidayCacheToFile(year, cache) {
    try {
      const data = JSON.stringify({ year, cache, updatedAt: new Date().toISOString() });
      fs.writeFileSync(AccountManager.HOLIDAY_CACHE_PATH, data, 'utf8');
    } catch (err) {
      logger.warn('保存节假日缓存失败', { error: err.message });
    }
  }

  // 从 API 获取节假日数据
  static async initHolidays() {
    // 先尝试加载本地缓存，有有效缓存则跳过API请求
    if (AccountManager.loadHolidayCacheFromFile()) {
      return;
    }

    const year = new Date().getFullYear();
    const url = `https://api.jiejiariapi.com/v1/holidays/${year}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const cache = {};
      for (const [dateStr, info] of Object.entries(data)) {
        if (info.isOffDay) {
          const mult = AccountManager.HOLIDAY_MULTIPLIERS[info.name] || 2.0;
          cache[dateStr] = { name: info.name, multiplier: mult };
        } else {
          cache[dateStr] = { name: info.name, multiplier: 1.0, isMakeup: true };
        }
      }
      AccountManager.holidayCache = cache;
      AccountManager.holidayCacheDate = year;
      AccountManager.saveHolidayCacheToFile(year, cache);
      logger.info('节假日数据加载成功', { year, count: Object.keys(cache).length });
    } catch (err) {
      if (AccountManager.holidayCache && Object.keys(AccountManager.holidayCache).length > 0) {
        logger.warn('节假日API获取失败，使用本地缓存', { error: err.message });
      } else {
        logger.warn('节假日API获取失败，仅使用周末翻倍', { error: err.message });
        AccountManager.holidayCache = {};
      }
    }
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

  // 获取配置中的最高等级
  getMaxLevel() {
    const keys = Object.keys(this.levelExpConfig).map(Number);
    return Math.max(...keys, 1);
  }

  // 根据总经验值计算等级和剩余经验值（上限按配置文件自动确定）
  calculateLevelAndExp(totalExp) {
    const maxLevel = this.getMaxLevel();
    let level = 1;
    let exp = totalExp;

    while (level < maxLevel && exp >= this.getExpForLevel(level + 1)) {
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
    if (!salt || !hash) {
      return false;
    }
    const hashToVerify = this.hashPassword(password, salt);
    return hashToVerify === hash;
  }

  // 生成用户ID
  generateUserId() {
    return crypto.randomBytes(8).toString('hex');
  }

  // 生成会话token
  generateSessionToken(accountId) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString('hex');
    const tokenData = `${accountId}|${timestamp}|${random}`;
    return Buffer.from(tokenData).toString('base64');
  }

  // 验证会话token
  verifySessionToken(token) {
    try {
      if (!token) return null;

      const tokenData = Buffer.from(token, 'base64').toString('utf8');
      const parts = tokenData.split('|');

      if (parts.length !== 3) return null;

      const [accountId, timestamp, random] = parts;

      // 验证token格式
      if (!accountId || !timestamp || !random) return null;

      // 验证token时效性（24小时有效期）
      const tokenAge = Date.now() - parseInt(timestamp);
      const maxAge = 24 * 60 * 60 * 1000; // 24小时

      if (tokenAge > maxAge) {
        logger.warn('Token已过期', { accountId, tokenAge });
        return null;
      }

      return accountId;
    } catch (err) {
      logger.error('验证token失败', { error: err.message });
      return null;
    }
  }

  // 检查用户名是否已存在
  async usernameExists(username) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.username': username.toLowerCase(), 'account.type': { $ne: 'guest' } });
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
      logger.info('开始账号登录验证', { username });

      // 查找用户（用户名转小写匹配）
      const account = await dataStore.findOne('accounts', {
        'account.username': username.toLowerCase(),
        'account.type': { $ne: 'guest' }
      });

      if (!account) {
        logger.warn('账号登录失败 - 用户不存在', { username });
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      logger.info('找到用户', { id: account.account?.id, username: account.account?.username });

      // 验证密码
      const hasSalt = !!account.account?.security?.passwordSalt;
      const hasHash = !!account.account?.security?.passwordHash;
      logger.info('密码验证信息', { hasSalt, hasHash });

      if (!this.verifyPassword(password, account.account?.security?.passwordSalt, account.account?.security?.passwordHash)) {
        logger.warn('账号登录失败 - 密码验证失败', { username, id: account.account?.id });
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      // 检查是否为回归玩家（用于成就检测）
      const now = Date.now();
      const lastLogin = account.account?.lastLogin || 0;
      const daysSinceLastLogin = (now - lastLogin) / (1000 * 60 * 60 * 24);
      const returnPlayer = daysSinceLastLogin >= 7;
      const longReturnPlayer = daysSinceLastLogin >= 30;

      // 更新最后登录时间和登录次数
      const loginCount = (account.account?.loginCount || 0) + 1;
      await dataStore.update('accounts', { 'account.id': account.account.id }, {
        'account.lastLogin': now,
        'account.lastSeen': now,
        'account.activity.returnPlayer': returnPlayer,
        'account.activity.longReturnPlayer': longReturnPlayer,
        'account.activity.loginCount': loginCount,
        'account.updatedAt': now
      });

      // 获取权限配置
      const config = require('../config');
      const permissions = config.permissions[account.account.type] || config.permissions.registered;

      // 返回完整的登录响应
      const safeAccount = {
        ...account,
        account: {
          ...account.account,
          security: undefined
        }
      };

      return {
        success: true,
        message: '登录成功',
        data: {
          account: safeAccount,
          permissions: permissions,
          token: this.generateSessionToken(account.account.id),
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

  // 验证会话令牌并获取账号信息
  async verifyTokenAndGetAccount(token) {
    try {
      const accountId = this.verifySessionToken(token);
      if (!accountId) {
        return {
          success: false,
          message: 'Token无效或已过期'
        };
      }

      const account = await this.getAccount(accountId);
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 更新最后登录时间
      await this.updateLastSeen(accountId);

      return {
        success: true,
        data: {
          account: account,
          loginType: account.account?.type || 'guest'
        }
      };
    } catch (err) {
      logger.error('验证token并获取账号信息失败', { error: err.message });
      return {
        success: false,
        message: '验证失败'
      };
    }
  }

  // 更新最后在线时间
  async updateLastSeen(accountId) {
    try {
      await dataStore.update('accounts', { 'account.id': accountId }, {
        'account.lastSeen': Date.now(),
        'account.updatedAt': Date.now()
      });
    } catch (err) {
      logger.error('更新最后在线时间失败', { accountId, error: err.message });
    }
  }

  // 获取账号信息
  async getAccount(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) {
        return null;
      }

      // 不返回密码相关信息
      return {
        ...account,
        account: {
          ...account.account,
          security: undefined
        }
      };
    } catch (err) {
      logger.error('获取账号信息失败', { accountId, error: err.message });
      return null;
    }
  }

  // 更新游戏统计
  async updateGameStats(accountId, result, gameType = null, isAI = false, aiDifficulty = null, duration = null) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 更新通用统计
      account.stats.totalGames = (account.stats.totalGames || 0) + 1;

      if (result === 'win') {
        account.stats.totalWins = (account.stats.totalWins || 0) + 1;
      } else if (result === 'loss') {
        account.stats.totalLosses = (account.stats.totalLosses || 0) + 1;
      } else if (result === 'draw') {
        account.stats.totalDraws = (account.stats.totalDraws || 0) + 1;
      }

      // 更新真人对战和AI对战统计
      if (isAI) {
        account.stats.aiWins = (account.stats.aiWins || 0) + (result === 'win' ? 1 : 0);
        account.stats.aiLosses = (account.stats.aiLosses || 0) + (result === 'loss' ? 1 : 0);
        account.stats.aiDraws = (account.stats.aiDraws || 0) + (result === 'draw' ? 1 : 0);
      } else {
        account.stats.humanWins = (account.stats.humanWins || 0) + (result === 'win' ? 1 : 0);
        account.stats.humanLosses = (account.stats.humanLosses || 0) + (result === 'loss' ? 1 : 0);
        account.stats.humanDraws = (account.stats.humanDraws || 0) + (result === 'draw' ? 1 : 0);
      }

      // 更新游戏类型统计
      if (gameType && account.games[gameType]) {
        account.games[gameType].totalGames = (account.games[gameType].totalGames || 0) + 1;

        if (result === 'win') {
          account.games[gameType].wins = (account.games[gameType].wins || 0) + 1;
          account.games[gameType].streak = (account.games[gameType].streak || 0) + 1;
          account.games[gameType].maxStreak = Math.max(
            account.games[gameType].maxStreak || 0,
            account.games[gameType].streak
          );
        } else if (result === 'loss') {
          account.games[gameType].losses = (account.games[gameType].losses || 0) + 1;
          account.games[gameType].streak = 0;
        } else if (result === 'draw') {
          account.games[gameType].draws = (account.games[gameType].draws || 0) + 1;
        }

        // AI游戏统计
        if (isAI && gameType !== 'snake') {
          account.games[gameType].aiWins = (account.games[gameType].aiWins || 0) + (result === 'win' ? 1 : 0);
          account.games[gameType].aiLosses = (account.games[gameType].aiLosses || 0) + (result === 'loss' ? 1 : 0);
          account.games[gameType].aiDraws = (account.games[gameType].aiDraws || 0) + (result === 'draw' ? 1 : 0);
          account.games[gameType].aiDifficulty = aiDifficulty;
          account.games[gameType].aiResult = result;
        }

        account.games[gameType].lastPlayedAt = Date.now();
      }

      // 更新活动统计
      const now = Date.now();
      account.account.activity.dailyGames = (account.account.activity.dailyGames || 0) + 1;
      account.account.activity.lastDailyReset = now;
      account.stats.lastGamePlayedAt = now;

      // 保存更新
      await dataStore.update('accounts', { 'account.id': accountId }, account);

      return {
        success: true,
        message: '统计更新成功'
      };
    } catch (err) {
      logger.error('更新游戏统计失败', { accountId, error: err.message });
      return {
        success: false,
        message: '更新统计失败'
      };
    }
  }

  // 获取排行榜
  async getLeaderboard(limit = 10, gameType = 'all') {
    try {
      const accounts = await this.getAllAccounts();

      // 去重，基于accountId
      const uniqueAccounts = [];
      const seenIds = new Set();

      for (const account of accounts) {
        const accountId = account.account?.id;
        if (accountId && !seenIds.has(accountId)) {
          seenIds.add(accountId);
          uniqueAccounts.push(account);
        }
      }

      return uniqueAccounts
        .sort((a, b) => {
          let scoreA, scoreB;
          if (gameType && gameType !== 'all') {
            if (gameType === 'snake') {
              // 贪吃蛇排行榜：基于最高分数
              scoreA = a.stats?.snakeGames?.highScore || a.games?.snake?.highScore || 0;
              scoreB = b.stats?.snakeGames?.highScore || b.games?.snake?.highScore || 0;
            } else {
              // 其他游戏类型的排行榜：基于获胜次数
              scoreA = a.games?.[gameType]?.wins || 0;
              scoreB = b.games?.[gameType]?.wins || 0;
            }
          } else {
            // 总榜：计算所有游戏类型的获胜次数总和
            scoreA = Object.values(a.games || {}).reduce((sum, game) => sum + (game.wins || 0), 0);
            scoreB = Object.values(b.games || {}).reduce((sum, game) => sum + (game.wins || 0), 0);
          }
          return scoreB - scoreA;
        })
        .slice(0, limit)
        .map((account, index) => {
          let wins, score;
          if (gameType && gameType !== 'all') {
            if (gameType === 'snake') {
              score = account.stats?.snakeGames?.highScore || account.games?.snake?.highScore || 0;
              wins = 0;
            } else {
              wins = account.games?.[gameType]?.wins || 0;
              score = 0;
            }
          } else {
            wins = Object.values(account.games || {}).reduce((sum, game) => sum + (game.wins || 0), 0);
            score = 0;
          }

          const totalGames = Object.values(account.games || {}).reduce((sum, game) => sum + (game.totalGames || 0), 0);
          const name = account.account?.nickname || account.account?.username || `玩家${account.account?.id?.substr(0, 4) || '0000'}`;

          return {
            rank: index + 1,
            id: account.account?.id,
            username: account.account?.username,
            name: name,
            level: account.account?.profile?.level || 1,
            wins: wins,
            losses: account.stats?.totalLosses || 0,
            draws: account.stats?.totalDraws || 0,
            totalGames: totalGames,
            score: score,
            winrate: totalGames > 0 ? `${Math.round((wins / totalGames) * 100)}%` : '0%'
          };
        });
    } catch (err) {
      logger.error('获取排行榜失败', { error: err.message });
      return [];
    }
  }

  // 重置密码
  async resetPassword(username, newPassword) {
    try {
      // 查找账号
      const accounts = await dataStore.read('accounts');
      const accountIndex = accounts.findIndex(a => a.account.username === username);

      if (accountIndex === -1) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      const account = accounts[accountIndex];

      // 生成新的盐和哈希
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = this.hashPassword(newPassword, salt);

      // 更新账号信息
      account.account.security = {
        passwordSalt: salt,
        passwordHash: hash
      };
      account.account.updatedAt = Date.now();
      account.updatedAt = Date.now();

      // 保存更新
      await dataStore.writeOne('accounts', account.account.id, account);

      return {
        success: true,
        message: '密码重置成功'
      };
    } catch (err) {
      logger.error('重置密码失败', { username, error: err.message });
      return {
        success: false,
        message: '重置密码失败，请稍后重试'
      };
    }
  }

  // 创建游客用户
  async createGuestUser(nickname = null) {
    const guestId = this.generateUserId();
    const now = Date.now();
    const guestUser = {
      id: guestId,
      account: {
        id: guestId,
        type: 'guest',
        username: null,
        nickname: nickname || `玩家${guestId.substr(0, 4)}`,
        createdAt: now,
        updatedAt: now,
        lastSeen: now,
        lastLogin: now,
        loginCount: 1,
        profile: {
          avatar: null,
          bio: '',
          exp: 0,
          level: 1
        },
        security: null,
        activity: {
          chatMessages: 0,
          signInStreak: 0,
          returnPlayer: false,
          longReturnPlayer: false,
          dailyGames: 0,
          weeklyGames: 0,
          monthlyGames: 0,
          lastDailyReset: now,
          lastWeeklyReset: now,
          lastMonthlyReset: now
        }
      },
      games: {
        gobang: {
          wins: 0,
          losses: 0,
          draws: 0,
          totalGames: 0,
          streak: 0,
          maxStreak: 0,
          aiWins: 0,
          aiDifficulty: null,
          aiResult: null,
          lastPlayedAt: null
        },
        'chinese-chess': {
          wins: 0,
          losses: 0,
          draws: 0,
          totalGames: 0,
          streak: 0,
          maxStreak: 0,
          lastPlayedAt: null
        },
        go: {
          wins: 0,
          losses: 0,
          draws: 0,
          totalGames: 0,
          streak: 0,
          maxStreak: 0,
          lastPlayedAt: null
        },
        snake: {
          totalGames: 0,
          highScore: 0,
          totalScore: 0,
          lastPlayedAt: null
        }
      },
      stats: {
        totalGames: 0,
        totalWins: 0,
        totalLosses: 0,
        totalDraws: 0,
        comebackStreak: 0,
        lowLevelWins: 0,
        lastGamePlayedAt: null,
        flags: {
          firstGame: false,
          nightGame: false,
          weekendGame: false,
          silentWin: false,
          allGameTypes: false,
          singleGameType: false,
          quickGame: false,
          slowGame: false,
          luckyWin: false,
          unluckyLoss: false,
          lonerWin: false
        }
      },
      permissions: {
        role: 'guest',
        access: {
          chat: true,
          createGame: true,
          joinGame: true,
          spectate: true,
          leaderboard: true
        }
      },
      social: {
        friends: 0,
        invites: 0
      },
      achievements: []
    };

    try {
      await dataStore.add('accounts', guestUser);
      logger.info('创建游客用户', { guestId, nickname: guestUser.account.nickname });

      // 不返回敏感信息
      const { ...safeGuest } = guestUser;
      return safeGuest;
    } catch (err) {
      logger.error('创建游客用户失败', { guestId, error: err.message });
      return null;
    }
  }

  // 获取用户信息（支持游客和注册用户）
  async getUser(accountId) {
    try {
      const user = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!user) {
        return null;
      }

      // 不返回密码相关信息
      const safeUser = {
        ...user,
        account: {
          ...user.account,
          security: undefined
        }
      };
      return safeUser;
    } catch (err) {
      logger.error('获取用户信息失败', { accountId, error: err.message });
      return null;
    }
  }

  // 通过token获取账号信息
  async getAccountByToken(token) {
    try {
      // 验证token并获取账号ID
      const accountId = this.verifySessionToken(token);
      if (!accountId) {
        return {
          success: false,
          message: 'Token无效或已过期'
        };
      }

      // 获取账号信息
      const account = await this.getAccount(accountId);
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 更新最后登录时间和登录次数
      const now = Date.now();
      const loginCount = (account.account?.loginCount || 0) + 1;
      await dataStore.update('accounts', { 'account.id': account.account.id }, {
        'account.lastLogin': now,
        'account.lastSeen': now,
        'account.loginCount': loginCount,
        'account.updatedAt': now
      });

      // 获取权限配置
      const config = require('../config');
      const permissions = config.permissions[account.account.type] || config.permissions.registered;

      return {
        success: true,
        data: {
          account: account,
          permissions: permissions,
          loginType: account.account.type === 'guest' ? 'guest' : 'account'
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
      const user = await dataStore.findOne('accounts', { 'account.id': id });
      if (!user) {
        return {
          success: false,
          message: '用户不存在'
        };
      }

      // 更新用户信息
      const updateData = { ...updates, 'account.updatedAt': Date.now() };
      await dataStore.update('accounts', { 'account.id': id }, updateData);

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
  async register(username, password, nickname = null, guestAccountId = null) {
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
      logger.warn('账号注册失败 - 用户名已存在', { username, guestAccountId });
      return {
        success: false,
        message: '用户名已存在'
      };
    }

    // 检查是否有游客账号需要升级
    let guestAccount = null;
    if (guestAccountId) {
      guestAccount = await dataStore.findOne('accounts', {
        'account.id': guestAccountId,
        'account.type': 'guest'
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
        account: {
          ...guestAccount.account,
          type: 'registered',
          username: username.toLowerCase(),
          nickname: nickname || username,
          updatedAt: now,
          security: {
            passwordSalt: salt,
            passwordHash: passwordHash
          },
          activity: {
            ...guestAccount.account.activity,
            loginCount: 1, // 初始化登录次数为1
            lastLogin: now,
            lastSeen: now
          }
        },
        permissions: {
          ...guestAccount.permissions,
          role: 'registered'
        }
      };

      try {
        // 直接更新账号（保持 id 不变）
        await dataStore.update('accounts', { 'account.id': guestAccountId }, updatedAccount);
        logger.info('游客账号升级为正式账号', {
          id: guestAccountId,
          username
        });

        return {
          success: true,
          id: guestAccountId,
          username: updatedAccount.account.username,
          nickname: updatedAccount.account.nickname,
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
        account: {
          id: accountId,
          type: 'registered',
          username: username.toLowerCase(),
          nickname: nickname || username,
          createdAt: now,
          updatedAt: now,
          lastSeen: now,
          lastLogin: now,
          loginCount: 1,
          profile: {
            avatar: null,
            bio: '',
            exp: 0,
            level: 1
          },
          security: {
            passwordSalt: salt,
            passwordHash: passwordHash
          },
          activity: {
            chatMessages: 0,
            signInStreak: 0,
            returnPlayer: false,
            longReturnPlayer: false,
            dailyGames: 0,
            weeklyGames: 0,
            monthlyGames: 0,
            lastDailyReset: now,
            lastWeeklyReset: now,
            lastMonthlyReset: now
          }
        },
        games: {
          gobang: {
            wins: 0,
            losses: 0,
            draws: 0,
            totalGames: 0,
            streak: 0,
            maxStreak: 0,
            aiWins: 0,
            aiDifficulty: null,
            aiResult: null,
            lastPlayedAt: null
          },
          'chinese-chess': {
            wins: 0,
            losses: 0,
            draws: 0,
            totalGames: 0,
            streak: 0,
            maxStreak: 0,
            lastPlayedAt: null
          },
          go: {
            wins: 0,
            losses: 0,
            draws: 0,
            totalGames: 0,
            streak: 0,
            maxStreak: 0,
            lastPlayedAt: null
          },
          snake: {
            totalGames: 0,
            highScore: 0,
            totalScore: 0,
            lastPlayedAt: null
          }
        },
        stats: {
          totalGames: 0,
          totalWins: 0,
          totalLosses: 0,
          totalDraws: 0,
          comebackStreak: 0,
          lowLevelWins: 0,
          lastGamePlayedAt: null,
          flags: {
            firstGame: false,
            nightGame: false,
            weekendGame: false,
            silentWin: false,
            allGameTypes: false,
            singleGameType: false,
            quickGame: false,
            slowGame: false,
            luckyWin: false,
            unluckyLoss: false,
            lonerWin: false
          }
        },
        permissions: {
          role: 'registered',
          access: {
            chat: true,
            createGame: true,
            joinGame: true,
            spectate: true,
            leaderboard: true
          }
        },
        social: {
          friends: 0,
          invites: 0
        },
        achievements: []
      };

      try {
        await dataStore.add('accounts', account);
        logger.info('新账号注册', { id: accountId, username });

        return {
          success: true,
          id: accountId,
          username: account.account.username,
          nickname: account.account.nickname,
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
      const account = await dataStore.findOne('accounts', { 'account.username': username.toLowerCase() });

      if (!account) {
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      // 验证密码
      const isValid = this.verifyPassword(password, account.account?.security?.passwordSalt, account.account?.security?.passwordHash);

      if (!isValid) {
        return {
          success: false,
          message: '用户名或密码错误'
        };
      }

      // 检查是否为回归玩家（用于成就检测）
      const now = Date.now();
      const lastLogin = account.account?.lastLogin || 0;
      const daysSinceLastLogin = (now - lastLogin) / (1000 * 60 * 60 * 24);
      const returnPlayer = daysSinceLastLogin >= 7;
      const longReturnPlayer = daysSinceLastLogin >= 30;

      // 更新最后登录时间和登录次数
      const loginCount = (account.account?.loginCount || 0) + 1;
      await dataStore.update('accounts', { 'account.id': account.account.id }, {
        'account.lastLogin': now,
        'account.lastSeen': now,
        'account.activity.returnPlayer': returnPlayer,
        'account.activity.longReturnPlayer': longReturnPlayer,
        'account.activity.loginCount': loginCount,
        'account.updatedAt': now
      });

      logger.info('账号登录', { id: account.account.id, username: account.account.username });

      // 生成登录token
      const loginToken = crypto.randomBytes(32).toString('hex');

      // 不返回敏感信息
      const safeAccount = {
        ...account,
        account: {
          ...account.account,
          security: undefined
        }
      };

      return {
        success: true,
        account: safeAccount,
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
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return null;
      }
      // 不返回密码相关信息
      const safeAccount = {
        ...account,
        account: {
          ...account.account,
          security: undefined
        }
      };
      return safeAccount;
    } catch (err) {
      logger.error('获取账号信息失败', { id, error: err.message });
      return null;
    }
  }

  // 更新账号资料
  async updateProfile(id, updates) {
    try {
      const account = await dataStore.findOne('accounts', { id: id });
      if (!account) {
        logger.warn('账号不存在', { id });
        return {
          success: false,
          message: '账号不存在'
        };
      }

      const updateData = {};

      // 处理nickname更新
      if (updates.nickname !== undefined) {
        updateData['account.nickname'] = updates.nickname;
        updateData['account.updatedAt'] = Date.now();
      }

      // 处理profile更新
      if (updates.profile !== undefined) {
        updateData['account.profile'] = updates.profile;
        updateData['account.updatedAt'] = Date.now();
      }

      await dataStore.update('accounts', { id: id }, updateData);
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
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      const activity = account.account?.activity || { chatMessages: 0 };
      activity.chatMessages = (activity.chatMessages || 0) + 1;

      await dataStore.update('accounts', { 'account.id': id }, { 'account.activity': activity, 'account.updatedAt': Date.now() });
      logger.info('聊天消息统计更新', { id, total: activity.chatMessages });

      return { success: true };
    } catch (err) {
      logger.error('更新聊天消息统计失败', { id, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }

  // 更新游戏统计
  async updateGameStats(id, result, gameType = null, isAI = false, aiDifficulty = null, duration = null) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      // 初始化游戏统计数据
      const games = account.games || {
        gobang: {
          wins: 0,
          losses: 0,
          draws: 0,
          totalGames: 0,
          streak: 0,
          maxStreak: 0,
          aiWins: 0,
          aiDifficulty: null,
          aiResult: null,
          lastPlayedAt: null
        },
        'chinese-chess': {
          wins: 0,
          losses: 0,
          draws: 0,
          totalGames: 0,
          streak: 0,
          maxStreak: 0,
          lastPlayedAt: null
        },
        go: {
          wins: 0,
          losses: 0,
          draws: 0,
          totalGames: 0,
          streak: 0,
          maxStreak: 0,
          lastPlayedAt: null
        },
        snake: {
          totalGames: 0,
          highScore: 0,
          totalScore: 0,
          lastPlayedAt: null
        }
      };

      // 初始化统计数据
      const stats = account.stats || {
        totalGames: 0,
        totalWins: 0,
        totalLosses: 0,
        totalDraws: 0,
        comebackStreak: 0,
        lowLevelWins: 0,
        lastGamePlayedAt: null,
        flags: {
          firstGame: false,
          nightGame: false,
          weekendGame: false,
          silentWin: false,
          allGameTypes: false,
          singleGameType: false,
          quickGame: false,
          slowGame: false,
          luckyWin: false,
          unluckyLoss: false,
          lonerWin: false
        }
      };

      // 初始化活动数据
      const activity = account.account?.activity || {
        chatMessages: 0,
        signInStreak: 0,
        returnPlayer: false,
        longReturnPlayer: false,
        dailyGames: 0,
        weeklyGames: 0,
        monthlyGames: 0,
        lastDailyReset: Date.now(),
        lastWeeklyReset: Date.now(),
        lastMonthlyReset: Date.now()
      };
      const now = Date.now();

      // 处理游戏结果
      if (gameType && games[gameType]) {
        const gameData = games[gameType];
        gameData.totalGames += 1;
        gameData.lastPlayedAt = now;

        if (result === 'win') {
          gameData.wins += 1;
          gameData.streak += 1;
          if (gameData.streak > gameData.maxStreak) {
            gameData.maxStreak = gameData.streak;
          }
          if (isAI) {
            gameData.aiWins += 1;
            gameData.aiDifficulty = aiDifficulty;
            gameData.aiResult = 'win';
          }
        } else if (result === 'loss') {
          gameData.losses += 1;
          gameData.streak = 0;
          if (isAI) {
            gameData.aiDifficulty = aiDifficulty;
            gameData.aiResult = 'loss';
          }
        } else if (result === 'draw') {
          gameData.draws += 1;
          if (isAI) {
            gameData.aiDifficulty = aiDifficulty;
            gameData.aiResult = 'draw';
          }
        }
      }

      // 更新统计数据
      stats.totalGames += 1;
      stats.lastGamePlayedAt = now;

      if (result === 'win') {
        stats.totalWins += 1;
      } else if (result === 'loss') {
        stats.totalLosses += 1;
      } else if (result === 'draw') {
        stats.totalDraws += 1;
      }

      // 更新真人对战和AI对战统计
      if (isAI) {
        stats.aiWins = (stats.aiWins || 0) + (result === 'win' ? 1 : 0);
        stats.aiLosses = (stats.aiLosses || 0) + (result === 'loss' ? 1 : 0);
        stats.aiDraws = (stats.aiDraws || 0) + (result === 'draw' ? 1 : 0);
      } else {
        stats.humanWins = (stats.humanWins || 0) + (result === 'win' ? 1 : 0);
        stats.humanLosses = (stats.humanLosses || 0) + (result === 'loss' ? 1 : 0);
        stats.humanDraws = (stats.humanDraws || 0) + (result === 'draw' ? 1 : 0);
      }

      // 更新活动数据
      activity.dailyGames += 1;
      activity.weeklyGames += 1;
      activity.monthlyGames += 1;

      // 检查是否是首次游戏
      if (stats.totalGames === 1) {
        stats.flags.firstGame = true;
      }

      // 检查是否是夜间游戏（匹配成就描述：凌晨2点到6点）
      const hour = new Date().getHours();
      if (hour >= 2 && hour <= 6) {
        stats.flags.nightGame = true;
      }

      // 检查是否是周末游戏
      const day = new Date().getDay();
      if (day === 0 || day === 6) {
        stats.flags.weekendGame = true;
      }

      // 保存更新后的数据
      await dataStore.update('accounts', { 'account.id': id }, {
        games: games,
        stats: stats,
        'account.activity': activity,
        'account.updatedAt': now
      });

      logger.info('游戏统计更新', { id, result, gameType, totalGames: stats.totalGames });

      return { success: true };
    }
    catch (err) {
      logger.error('更新游戏统计失败', { id, error: err.message });
      return { success: false, message: '更新失败' };
    }
  }

  // 国际节假日配置（按计算规则）
  static INTERNATIONAL_HOLIDAYS() {
    return [
      // 固定日期
      { rule: 'fixed', month: 1, day: 1, name: '元旦', multiplier: 2.0 },
      { rule: 'fixed', month: 2, day: 14, name: '情人节', multiplier: 1.5 },
      { rule: 'fixed', month: 3, day: 8, name: '妇女节', multiplier: 1.5 },
      { rule: 'fixed', month: 4, day: 22, name: '地球日', multiplier: 1.5 },
      { rule: 'fixed', month: 6, day: 1, name: '儿童节', multiplier: 2.0 },
      { rule: 'fixed', month: 10, day: 31, name: '万圣节', multiplier: 1.5 },
      { rule: 'fixed', month: 12, day: 25, name: '圣诞节', multiplier: 2.0 },

      // 计算日期
      // 母亲节：5月第二个周日
      { rule: 'weekday', month: 5, week: 2, weekday: 0, name: '母亲节', multiplier: 2.0 },
      // 父亲节：6月第三个周日
      { rule: 'weekday', month: 6, week: 3, weekday: 0, name: '父亲节', multiplier: 2.0 },
      // 感恩节：11月第四个周四
      { rule: 'weekday', month: 11, week: 4, weekday: 4, name: '感恩节', multiplier: 2.0 },
    ];
  }

  // 计算某个月第N个星期几的日期
  static calcNthWeekdayOfMonth(year, month, week, weekday) {
    // 当月1号
    const first = new Date(year, month - 1, 1);
    // 1号是星期几
    const firstWeekday = first.getDay();
    // 第一个目标星期几是几号
    let diff = weekday - firstWeekday;
    if (diff < 0) diff += 7;
    const firstDate = 1 + diff; // 第一个目标星期几的日期
    const date = firstDate + (week - 1) * 7;
    // 安全检查：不超过当月天数
    const lastDay = new Date(year, month, 0).getDate();
    if (date > lastDay) return null;
    return date;
  }

  // 获取国际节假日（如果有）
  getInternationalHoliday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();

    const holidays = AccountManager.INTERNATIONAL_HOLIDAYS();
    for (const h of holidays) {
      let match = false;
      if (h.rule === 'fixed') {
        match = (month === h.month && day === h.day);
      } else if (h.rule === 'weekday') {
        const calcDay = AccountManager.calcNthWeekdayOfMonth(year, h.month, h.week, h.weekday);
        match = (calcDay !== null && month === h.month && day === calcDay);
      }
      if (match) {
        return { multiplier: h.multiplier, label: h.name + '限时翻倍×' + h.multiplier };
      }
    }
    return null;
  }

  // 限时经验倍率：周末/节假日自动翻倍
  getEventMultiplier() {
    const now = new Date();
    const day = now.getDay();
    const isWeekend = (day === 0 || day === 6);
    const mmdd = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

    // 1. 检查中国节假日（API 拉取，优先级最高）
    if (AccountManager.holidayCache && AccountManager.holidayCache[mmdd]) {
      const h = AccountManager.holidayCache[mmdd];
      if (h.isMakeup) return { multiplier: 1.0, label: '' }; // 补班日，无加成
      if (isWeekend) {
        const stacked = h.multiplier * 1.5;
        return { multiplier: stacked, label: `${h.name}·周末 限时翻倍×${stacked}` };
      }
      return { multiplier: h.multiplier, label: `${h.name} 限时翻倍×${h.multiplier}` };
    }

    // 2. 检查国际节假日（计算规则）
    const intl = this.getInternationalHoliday();
    if (intl) {
      if (isWeekend) {
        const stacked = intl.multiplier * 1.5;
        return { multiplier: stacked, label: `${intl.label.split('限时')[0]}·周末 限时翻倍×${stacked}` };
      }
      return intl;
    }

    // 3. 周末 1.5 倍
    if (isWeekend) {
      return { multiplier: 1.5, label: '周末 限时翻倍×1.5' };
    }

    return { multiplier: 1.0, label: '' };
  }

  // 等级经验倍率：等级越高倍率越大，保证后期升级不吃力
  getExpMultiplier(level) {
    if (level <= 10) return 1.0;
    if (level <= 20) return 1.5;
    if (level <= 30) return 2.0;
    if (level <= 40) return 2.5;
    return 3.0;
  }

  // 添加经验值
  // applyEventMult: false 表示不应用任何倍率（如经验药水、等级直升券）
  async addExp(id, exp, applyEventMult = true) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      // 获取当前等级
      const oldLevel = account.account?.profile?.level || 1;
      const now = Date.now();
      let finalExp = exp;
      let levelMult = 1;
      let eventLabel = '';
      let totalMult = 1;

      // 只有在 applyEventMult 为 true 时才应用倍率
      if (applyEventMult) {
        levelMult = this.getExpMultiplier(oldLevel);

        // 收集所有倍率和标签
        const multipliers = [];
        const labels = [];

        // 1. 周末/节假日活动倍率
        const eventResult = this.getEventMultiplier();
        if (eventResult.multiplier !== 1.0) {
          multipliers.push(eventResult.multiplier);
          labels.push(eventResult.label);
        }

        // 2. 双倍/三倍经验buff（优先使用三倍）
        if (account.activeBuffs?.tripleExp && account.activeBuffs.tripleExp > now) {
          multipliers.push(3.0);
          labels.push('三倍经验');
        } else if (account.activeBuffs?.doubleExp && account.activeBuffs.doubleExp > now) {
          multipliers.push(2.0);
          labels.push('双倍经验');
        }

        // 3. VIP会员
        if (account.vip?.expireAt > now) {
          const vipBonus = account.vip.expBonus || 2.0;
          multipliers.push(vipBonus);
          labels.push(`VIP×${vipBonus}`);
        }

        // 计算总倍率
        let eventMultTotal = 1.0;
        for (const m of multipliers) {
          eventMultTotal *= m;
        }

        totalMult = levelMult * eventMultTotal;
        finalExp = Math.floor(exp * totalMult);

        // 构建标签
        if (labels.length > 0) {
          eventLabel = labels.join('+');
        }
      }

      // 获取当前总经验值
      const currentExp = account.account?.profile?.exp || 0;
      const newTotalExp = currentExp + finalExp;

      // 计算新的等级和当前等级剩余经验
      const { level, exp: currentLevelExp } = this.calculateLevelAndExp(newTotalExp);

      // 保留原有 profile 属性，只更新 exp 和 level
      const existingProfile = account.account?.profile || {};
      const updatedProfile = {
        ...existingProfile,
        exp: newTotalExp,  // 保存总经验
        level: level
      };

      await dataStore.update('accounts', { 'account.id': id }, { 'account.profile': updatedProfile, 'account.updatedAt': Date.now() });
      logger.info('添加经验值', { id, addedExp: finalExp, levelMult, eventLabel, totalMult, baseExp: exp, currentExp, newTotalExp, newLevel: level });

      // 每获得10点经验，奖励1星钻
      let currencyReward = Math.max(1, Math.floor(finalExp / 10));
      // 幸运符提升星钻奖励
      if (account.activeBuffs?.luckBoost && account.activeBuffs.luckBoost > Date.now()) {
        currencyReward = Math.floor(currencyReward * 2); // 双倍星钻奖励
      }
      if (currencyReward > 0) {
        await this.addCurrency(id, currencyReward, `获得${finalExp}经验值奖励`, 'exp_reward');
      }

      // 升级时额外奖励星钻并检查等级奖励
      let levelUpCurrency = 0;
      if (level > oldLevel) {
        levelUpCurrency = (level - oldLevel) * 50; // 每升1级奖励50星钻
        await this.addCurrency(id, levelUpCurrency, `从${oldLevel}级升到${level}级奖励`, 'level_up');
      }
      await this.checkLevelRewards(id);

      // 记录经验变动
      try {
        const expRecords = await this.getExpRecords(id);
        expRecords.transactions.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          baseExp: exp,
          bonusExp: finalExp - exp,
          finalExp,
          levelMult,
          eventLabel: eventLabel || null,
          oldLevel,
          newLevel: level,
          totalExp: newTotalExp,
          timestamp: Date.now()
        });
        if (expRecords.transactions.length > 500) {
          expRecords.transactions = expRecords.transactions.slice(-500);
        }
        await dataStore.writeOne('expTransactions', id, expRecords);
      } catch (recErr) {
        logger.warn('记录经验变动失败', { id, error: recErr.message });
      }

      return {
        success: true,
        level,
        exp: currentLevelExp,
        totalExp: newTotalExp,
        levelUp: level > oldLevel,
        oldLevel,
        currencyReward,
        levelUpCurrency,
        // 经验明细
        baseExp: exp,
        bonusExp: finalExp - exp,      // 额外经验（倍率加成部分）
        finalExp,
        levelMult,
        eventLabel: eventLabel || null
      };
    } catch (err) {
      logger.error('添加经验值失败', { id, error: err.message });
      return { success: false, message: '添加失败' };
    }
  }

  // 修改密码
  async changePassword(id, oldPassword, newPassword) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 验证旧密码
      const isValid = this.verifyPassword(oldPassword, account.account?.security?.passwordSalt, account.account?.security?.passwordHash);
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

      await dataStore.update('accounts', { 'account.id': id }, {
        'account.security': {
          passwordSalt: newSalt,
          passwordHash: newHash
        },
        'account.updatedAt': Date.now()
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

      // 直接返回所有账号，不进行限制和反转，让调用方决定如何处理
      return accounts.map(acc => {
        const safeAcc = {
          ...acc,
          account: {
            ...acc.account,
            security: undefined
          }
        };
        safeAcc.lastLoginAt = safeAcc.account?.lastLogin;
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
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      await dataStore.delete('accounts', { 'account.id': id });
      logger.info('账号被删除', { id, username: account.account?.username });

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
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 确保profile对象存在
      const profile = account.account?.profile || { exp: 0 };
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

      // 重新计算等级
      const { level } = this.calculateLevelAndExp(exp);

      // 保留原有profile属性，只更新exp和level
      const existingProfile = account.account?.profile || {};
      const updatedProfile = {
        ...existingProfile,
        exp: exp,
        level: level
      };

      await dataStore.update('accounts', { 'account.id': id }, { 'account.profile': updatedProfile, 'account.updatedAt': Date.now() });
      logger.info('管理员修改用户经验值', { id, operation, amount, oldExp: profile.exp, newExp: exp, newLevel: level });

      return {
        success: true,
        message: '经验值修改成功',
        oldExp: profile.exp,
        newExp: exp,
        level: level
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
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 兼容新旧格式：统一转为纯ID数组
      let achievements = this._normalizeAchievements(account.achievements || []);
      if (achievements.includes(achievementId)) {
        return {
          success: false,
          message: '该成就已解锁'
        };
      }

      achievements.push(achievementId);
      await dataStore.update('accounts', { 'account.id': id }, { achievements, 'account.updatedAt': Date.now() });
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

  // 将成就数据统一转为纯ID数组（兼容旧格式 [{id, unlockedAt}]）
  _normalizeAchievements(achievements) {
    if (!achievements || achievements.length === 0) return [];
    if (typeof achievements[0] === 'number' || typeof achievements[0] === 'string') {
      return achievements.slice(); // 已经是纯ID数组
    }
    // 旧格式：对象数组，提取 id 字段
    return achievements.map(a => a.id);
  }

  // 管理员移除用户成就
  async removeUserAchievement(id, achievementId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 兼容新旧格式
      const achievements = this._normalizeAchievements(account.achievements || []);
      const index = achievements.indexOf(achievementId);
      if (index === -1) {
        return {
          success: false,
          message: '该成就未解锁'
        };
      }

      achievements.splice(index, 1);
      await dataStore.update('accounts', { 'account.id': id }, { achievements, 'account.updatedAt': Date.now() });
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

  // ========== 星钻货币系统 ==========

  // 货币名称配置
  static get CURRENCY_NAME() { return '星钻'; }
  static get CURRENCY_ICON() { return '💎'; }

  // 等级奖励配置
  getLevelRewards() {
    return [
      {
        level: 5, rewards: [
          { type: 'currency', amount: 100 },
          { type: 'title', name: '棋坛新秀' },
          { type: 'item', id: 'item_exp_potion', count: 3 },
          { type: 'item', id: 'item_undo', count: 1 }
        ], description: '获得100💎 + 称号"棋坛新秀" + 🧪经验药水×3 + ↩️悔棋卡×1'
      },
      {
        level: 10, rewards: [
          { type: 'currency', amount: 250 },
          { type: 'title', name: '对弈达人' },
          { type: 'item', id: 'item_exp_potion', count: 5 },
          { type: 'item', id: 'item_double_exp', count: 2 },
          { type: 'item', id: 'item_hint', count: 3 },
          { type: 'vip', days: 7, expBonus: 2.0 }
        ], description: '获得250💎 + 称号"对弈达人" + 🧪经验药水×5 + ✨双倍经验卡×2 + 💡提示卡×3 + 💎7天月卡'
      },
      {
        level: 15, rewards: [
          { type: 'currency', amount: 500 },
          { type: 'title', name: '棋艺高手' },
          { type: 'item', id: 'item_exp_potion', count: 10 },
          { type: 'item', id: 'item_double_exp', count: 3 },
          { type: 'item', id: 'item_undo', count: 3 }
        ], description: '获得500💎 + 称号"棋艺高手" + 🧪经验药水×10 + ✨双倍经验卡×3 + ↩️悔棋卡×3'
      },
      {
        level: 20, rewards: [
          { type: 'currency', amount: 800 },
          { type: 'badge', name: 'level_20_reward' },
          { type: 'item', id: 'item_exp_potion', count: 10 },
          { type: 'item', id: 'item_double_exp', count: 5 },
          { type: 'item', id: 'item_hint', count: 5 },
          { type: 'item', id: 'item_luck_boost', count: 1 },
          { type: 'vip', days: 30, expBonus: 2.0 }
        ], description: '获得800💎 + 限定徽章 + 🧪经验药水×10 + ✨双倍经验卡×5 + 💡提示卡×5 + 🍀幸运符×1 + 💎30天月卡'
      },
      {
        level: 25, rewards: [
          { type: 'currency', amount: 1200 },
          { type: 'title', name: '棋坛精英' },
          { type: 'item', id: 'item_triple_exp', count: 2 },
          { type: 'item', id: 'item_undo', count: 5 },
          { type: 'item', id: 'item_hint', count: 5 }
        ], description: '获得1200💎 + 称号"棋坛精英" + 🌟三倍经验卡×2 + ↩️悔棋卡×5 + 💡提示卡×5'
      },
      {
        level: 30, rewards: [
          { type: 'currency', amount: 1800 },
          { type: 'badge', name: 'level_30_reward' },
          { type: 'item', id: 'item_triple_exp', count: 3 },
          { type: 'item', id: 'item_exp_potion', count: 20 },
          { type: 'item', id: 'item_luck_boost', count: 3 },
          { type: 'vip', days: 30, expBonus: 2.0 }
        ], description: '获得1800💎 + 限定徽章 + 🌟三倍经验卡×3 + 🧪经验药水×20 + 🍀幸运符×3 + 💎30天月卡'
      },
      {
        level: 40, rewards: [
          { type: 'currency', amount: 3000 },
          { type: 'title', name: '传奇大师' },
          { type: 'item', id: 'item_triple_exp', count: 5 },
          { type: 'item', id: 'item_exp_potion', count: 30 },
          { type: 'item', id: 'item_level_up', count: 1 },
          { type: 'vip', days: 30, expBonus: 2.0 }
        ], description: '获得3000💎 + 称号"传奇大师" + 🌟三倍经验卡×5 + 🧪经验药水×30 + 🚀等级直升券×1 + 💎30天月卡'
      },
      {
        level: 50, rewards: [
          { type: 'currency', amount: 5000 },
          { type: 'badge', name: 'level_50_reward' },
          { type: 'title', name: '至尊棋圣' },
          { type: 'item', id: 'item_triple_exp', count: 10 },
          { type: 'item', id: 'item_exp_potion', count: 50 },
          { type: 'item', id: 'item_level_up', count: 3 },
          { type: 'item', id: 'item_luck_boost', count: 5 },
          { type: 'vip', days: 30, expBonus: 2.0 }
        ], description: '获得5000💎 + 限定徽章 + 称号"至尊棋圣" + 🌟三倍经验卡×10 + 🧪经验药水×50 + 🚀等级直升券×3 + 🍀幸运符×5 + 💎30天月卡'
      }
    ];
  }

  // 获取用户星钻余额
  async getCurrency(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      const currency = account?.currency || { starCoins: 0 };
      return { success: true, balance: currency.starCoins || 0 };
    } catch (err) {
      logger.error('获取星钻余额失败', { accountId, error: err.message });
      return { success: true, balance: 0 };
    }
  }

  // 获取用户交易记录
  async getTransactionRecords(accountId) {
    try {
      const records = await dataStore.readOne('currencyTransactions', accountId);
      return records || { userId: accountId, transactions: [] };
    } catch (err) {
      logger.error('获取交易记录失败', { accountId, error: err.message });
      return { userId: accountId, transactions: [] };
    }
  }

  // 获取经验记录文件
  async getExpRecords(accountId) {
    try {
      const records = await dataStore.readOne('expTransactions', accountId);
      return records || { userId: accountId, transactions: [] };
    } catch (err) {
      logger.error('获取经验记录失败', { accountId, error: err.message });
      return { userId: accountId, transactions: [] };
    }
  }

  // 添加星钻（带交易记录）
  async addCurrency(accountId, amount, reason, source = 'system') {
    try {
      if (amount <= 0) return { success: false, message: '数量必须大于0' };

      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) return { success: false, message: '账号不存在' };

      // 更新余额
      const currency = account.currency || { starCoins: 0 };
      const newBalance = (currency.starCoins || 0) + amount;
      currency.starCoins = newBalance;
      await dataStore.update('accounts', { 'account.id': accountId }, { currency, 'account.updatedAt': Date.now() });

      // 添加交易记录到独立集合
      const transactionRecords = await this.getTransactionRecords(accountId);
      transactionRecords.transactions.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        type: 'earn',
        amount,
        balance: newBalance,
        source,
        reason,
        timestamp: Date.now()
      });

      // 限制交易记录数量，只保留最近1000条
      if (transactionRecords.transactions.length > 1000) {
        transactionRecords.transactions = transactionRecords.transactions.slice(-1000);
      }

      await dataStore.writeOne('currencyTransactions', accountId, transactionRecords);
      logger.info('添加星钻', { accountId, amount, reason, balance: newBalance });

      return { success: true, balance: newBalance, added: amount };
    } catch (err) {
      logger.error('添加星钻失败', { accountId, error: err.message });
      return { success: false, message: '添加失败' };
    }
  }

  // 使用星钻（预留接口）
  async useCurrency(accountId, amount, reason) {
    try {
      if (amount <= 0) return { success: false, message: '数量必须大于0' };

      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) return { success: false, message: '账号不存在' };

      const currency = account.currency || { starCoins: 0 };
      const currentBalance = currency.starCoins || 0;

      if (currentBalance < amount) {
        return { success: false, message: '星钻不足', balance: currentBalance };
      }

      const newBalance = currentBalance - amount;
      currency.starCoins = newBalance;
      await dataStore.update('accounts', { 'account.id': accountId }, { currency, 'account.updatedAt': Date.now() });

      // 添加交易记录到独立集合
      const transactionRecords = await this.getTransactionRecords(accountId);
      transactionRecords.transactions.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        type: 'spend',
        amount,
        balance: newBalance,
        source: 'spend',
        reason,
        timestamp: Date.now()
      });

      if (transactionRecords.transactions.length > 1000) {
        transactionRecords.transactions = transactionRecords.transactions.slice(-1000);
      }

      await dataStore.writeOne('currencyTransactions', accountId, transactionRecords);
      logger.info('使用星钻', { accountId, amount, reason, balance: newBalance });

      return { success: true, balance: newBalance, used: amount };
    } catch (err) {
      logger.error('使用星钻失败', { accountId, error: err.message });
      return { success: false, message: '使用失败' };
    }
  }

  // 获取星钻交易记录
  async getCurrencyTransactions(accountId, limit = 50) {
    try {
      const [account, transactionRecords] = await Promise.all([
        dataStore.findOne('accounts', { 'account.id': accountId }),
        this.getTransactionRecords(accountId)
      ]);

      if (!account) return { success: false, message: '账号不存在', transactions: [] };

      const currency = account.currency || { starCoins: 0 };
      const transactions = (transactionRecords.transactions || []).slice(-limit).reverse();
      return { success: true, transactions, balance: currency.starCoins || 0 };
    } catch (err) {
      logger.error('获取星钻交易记录失败', { accountId, error: err.message });
      return { success: false, message: '获取失败', transactions: [] };
    }
  }

  // 获取经验记录
  async getExpTransactions(accountId, limit = 50) {
    try {
      const records = await this.getExpRecords(accountId);
      const transactions = (records.transactions || []).slice(-limit).reverse();
      return { success: true, transactions };
    } catch (err) {
      logger.error('获取经验记录失败', { accountId, error: err.message });
      return { success: false, message: '获取失败', transactions: [] };
    }
  }

  // 检查并领取等级奖励
  async checkLevelRewards(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) return { success: false, message: '账号不存在', rewards: [] };

      const currentLevel = account.account?.profile?.level || 1;
      const claimedRewards = account.claimedLevelRewards || [];
      const availableRewards = [];

      const levelRewards = this.getLevelRewards();
      for (const rewardConfig of levelRewards) {
        if (currentLevel >= rewardConfig.level && !claimedRewards.includes(rewardConfig.level)) {
          // 发放奖励
          for (const reward of rewardConfig.rewards) {
            if (reward.type === 'currency') {
              await this.addCurrency(accountId, reward.amount, `达到${rewardConfig.level}级奖励`, 'level_reward');
            } else if (reward.type === 'item') {
              await this.addItem(accountId, reward.id, reward.count);
            } else if (reward.type === 'vip') {
              await this.addVip(accountId, reward.days, reward.expBonus);
            }
            // title 和 badge 类型预留，未来可扩展
          }

          claimedRewards.push(rewardConfig.level);
          availableRewards.push(rewardConfig);
        }
      }

      if (availableRewards.length > 0) {
        await dataStore.update('accounts', { 'account.id': accountId }, {
          claimedLevelRewards: claimedRewards,
          'account.updatedAt': Date.now()
        });
        logger.info('发放等级奖励', { accountId, levels: availableRewards.map(r => r.level) });
      }

      return { success: true, rewards: availableRewards, claimedLevels: claimedRewards };
    } catch (err) {
      logger.error('检查等级奖励失败', { accountId, error: err.message });
      return { success: false, message: '检查失败', rewards: [] };
    }
  }

  // 获取可领取的等级奖励列表
  async getAvailableLevelRewards(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) return { success: false, message: '账号不存在', rewards: [], claimedLevels: [] };

      const currentLevel = account.account?.profile?.level || 1;
      const claimedRewards = account.claimedLevelRewards || [];
      const levelRewards = this.getLevelRewards();
      const available = levelRewards.filter(r => currentLevel >= r.level && !claimedRewards.includes(r.level));
      const future = levelRewards.filter(r => currentLevel < r.level);

      return {
        success: true,
        available,
        future,
        claimedLevels: claimedRewards,
        totalClaimed: claimedRewards.length
      };
    } catch (err) {
      logger.error('获取等级奖励列表失败', { accountId, error: err.message });
      return { success: false, message: '获取失败', rewards: [] };
    }
  }

  // ========== 批量更新账号数据（为新老账号添加货币字段） ==========

  // 为所有账号初始化货币字段（用于数据迁移）
  async initializeCurrencyForAllAccounts() {
    try {
      const accounts = await dataStore.read('accounts');
      let updated = 0;
      for (const account of accounts) {
        if (!account.currency) {
          account.currency = { starCoins: 0, transactions: [] };
          await dataStore.writeOne('accounts', account.account?.id || account.id, account);
          updated++;
        }
      }
      logger.info('初始化账号货币字段', { total: accounts.length, updated });
      return { success: true, total: accounts.length, updated };
    } catch (err) {
      logger.error('初始化货币字段失败', { error: err.message });
      return { success: false, message: '初始化失败' };
    }
  }

  // ========== 老玩家星钻补偿 ==========

  /**
   * 发放新手礼包 + 老玩家补偿（每种账号仅领取一次）
   * 固定部分（所有人）：
   *   - 新手礼包 500💎
   * 额外部分（老玩家，基于已有数据）：
   *   - 每10点经验补偿1星钻
   *   - 每级（从1级开始）补偿50星钻
   *   - 每个成就补偿50星钻
   *   - 每局游戏补偿5星钻
   *   - 每场胜利补偿10星钻
   */
  async compensateOldPlayers() {
    const BASE_BONUS = 500;

    try {
      const accounts = await dataStore.read('accounts');
      const stats = { total: 0, compensated: 0, skipped: 0, totalCoins: 0, errors: [] };

      for (const account of accounts) {
        const accountId = account.account?.id || account.id;
        if (!accountId) continue;
        stats.total++;

        if (account.compensatedAt) {
          stats.skipped++;
          continue;
        }

        try {
          if (!account.currency) account.currency = { starCoins: 0 };

          const level = account.account?.profile?.level || 1;
          const totalExp = account.account?.profile?.exp || 0;
          const achievements = this._normalizeAchievements(account.achievements || []);
          const achievementCount = achievements.length;
          const playerStats = account.stats || {};
          const totalGames = playerStats.totalGames || 0;
          const totalWins = playerStats.totalWins || 0;

          // 老玩家额外部分
          const expComp = Math.max(0, Math.floor(totalExp / 10));
          const levelComp = (level - 1) * 50;
          const achieveComp = achievementCount * 50;
          const gameComp = totalGames * 5;
          const winComp = totalWins * 10;
          const veteranTotal = expComp + levelComp + achieveComp + gameComp + winComp;

          // 总发放 = 固定礼包 + 老玩家额外
          const total = BASE_BONUS + veteranTotal;

          // 发放星钻
          account.currency.starCoins = (account.currency.starCoins || 0) + total;
          account.compensatedAt = Date.now();
          account.compensationSummary = {
            baseBonus: BASE_BONUS,
            expComp, levelComp, achieveComp, achievementCount,
            gameComp, winComp, veteranTotal,
            total,
            oldLevel: level, oldExp: totalExp, oldGames: totalGames, oldWins: totalWins
          };
          await dataStore.writeOne('accounts', accountId, account);

          // 构建原因
          const parts = [`${BASE_BONUS}(新手礼包)`];
          if (expComp > 0) parts.push(`${expComp}(经验)`);
          if (levelComp > 0) parts.push(`${levelComp}(等级)`);
          if (achieveComp > 0) parts.push(`${achieveComp}(${achievementCount}个成就)`);
          if (gameComp > 0) parts.push(`${gameComp}(${totalGames}局)`);
          if (winComp > 0) parts.push(`${winComp}(${totalWins}胜)`);
          const reason = `新手礼包+老玩家补偿：${parts.join(' + ')}`;

          // 交易记录
          const records = await this.getTransactionRecords(accountId);
          records.transactions.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            type: 'earn', amount: total, balance: account.currency.starCoins,
            source: 'compensation', reason, timestamp: Date.now()
          });
          if (records.transactions.length > 1000) records.transactions = records.transactions.slice(-1000);
          await dataStore.writeOne('currencyTransactions', accountId, records);

          await this.checkLevelRewards(accountId);

          stats.compensated++;
          stats.totalCoins += total;

          logger.info('新手礼包+补偿完成', { accountId, baseBonus: BASE_BONUS, veteranTotal, total, balance: account.currency.starCoins });
        } catch (err) {
          logger.error('补偿失败', { accountId, error: err.message });
          stats.errors.push({ accountId, error: err.message });
        }
      }

      logger.info('新手礼包+补偿统计', { total: stats.total, compensated: stats.compensated, skipped: stats.skipped, totalCoins: stats.totalCoins, errors: stats.errors.length });
      return { success: true, ...stats };
    } catch (err) {
      logger.error('新手礼包+补偿失败', { error: err.message });
      return { success: false, message: '领取失败', error: err.message };
    }
  }

  // ========== 内部辅助方法 ==========

  /**
   * 获取原始账号数据（包含完整字段，供内部使用）
   */
  async _getAccount(userId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': userId });
      return account || null;
    } catch (err) {
      logger.error('_getAccount 失败', { userId, error: err.message });
      return null;
    }
  }

  /**
   * 保存账号数据（供内部使用）
   */
  async _saveAccount(userId, account) {
    try {
      await dataStore.writeOne('accounts', userId, account);
      return true;
    } catch (err) {
      logger.error('_saveAccount 失败', { userId, error: err.message });
      return false;
    }
  }

  // ========== 背包系统 ==========

  /**
   * 获取用户背包
   */
  async getInventory(userId) {
    const account = await this._getAccount(userId);
    const inventory = account?.inventory || { items: {} };
    return { success: true, inventory };
  }

  /**
   * 添加道具
   */
  async addItem(userId, itemId, count = 1) {
    const account = await this._getAccount(userId);
    if (!account) {
      return { success: false, message: '账号不存在' };
    }
    if (!account.inventory) {
      account.inventory = { items: {} };
    }
    if (!account.inventory.items) {
      account.inventory.items = {};
    }
    account.inventory.items[itemId] = (account.inventory.items[itemId] || 0) + count;
    await this._saveAccount(userId, account);
    return { success: true };
  }

  /**
   * 使用道具
   */
  async useItem(userId, itemId, count = 1) {
    const account = await this._getAccount(userId);
    if (!account) {
      return { success: false, message: '账号不存在' };
    }
    if (!account.inventory?.items?.[itemId] || account.inventory.items[itemId] < count) {
      return { success: false, message: '道具不足' };
    }

    let result = { success: true };
    let expToAdd = 0;

    switch (itemId) {
      case 'item_double_exp':
        // 双倍经验卡：添加1小时的双倍经验buff
        if (!account.activeBuffs) account.activeBuffs = {};
        const now = Date.now();
        const existingExpire = account.activeBuffs.doubleExp || now;
        account.activeBuffs.doubleExp = Math.max(existingExpire, now) + 60 * 60 * 1000; // 1小时
        result.message = '双倍经验卡已激活！1小时内经验翻倍';
        break;
      case 'item_luck_boost':
        // 幸运符：添加1小时的幸运buff
        if (!account.activeBuffs) account.activeBuffs = {};
        const luckNow = Date.now();
        const existingLuckExpire = account.activeBuffs.luckBoost || luckNow;
        account.activeBuffs.luckBoost = Math.max(existingLuckExpire, luckNow) + 60 * 60 * 1000; // 1小时
        result.message = '幸运符已激活！1小时内星钻奖励翻倍';
        break;
      case 'item_triple_exp':
        // 三倍经验卡：添加1小时的三倍经验buff
        if (!account.activeBuffs) account.activeBuffs = {};
        const tripleNow = Date.now();
        const existingTripleExpire = account.activeBuffs.tripleExp || tripleNow;
        account.activeBuffs.tripleExp = Math.max(existingTripleExpire, tripleNow) + 60 * 60 * 1000; // 1小时
        result.message = '三倍经验卡已激活！1小时内经验三倍';
        break;
      case 'item_exp_potion':
        // 经验药水：立即获得500经验
        expToAdd = 500 * count;
        result.message = `使用成功！获得${expToAdd}经验值`;
        break;
      case 'item_level_up':
        // 等级直升券：加每一级所需经验，让等级表自动计算
        const currentLevel = account.account?.profile?.level || 1;
        const targetLevel = currentLevel + count;
        let totalExpNeeded = 0;
        for (let l = currentLevel + 1; l <= targetLevel; l++) {
          totalExpNeeded += this.getExpForLevel(l);
        }
        expToAdd = totalExpNeeded;
        result.message = `使用成功！等级从${currentLevel}提升到${targetLevel}`;
        break;
      case 'item_undo':
        // 悔棋卡：添加悔棋次数
        if (!account.inventory) account.inventory = {};
        if (!account.inventory.undoCount) account.inventory.undoCount = 0;
        account.inventory.undoCount += 3 * count;
        result.message = `使用成功！获得${3 * count}次悔棋次数`;
        break;
      case 'item_hint':
        // 提示卡：添加提示次数
        if (!account.inventory) account.inventory = {};
        if (!account.inventory.hintCount) account.inventory.hintCount = 0;
        account.inventory.hintCount += 5 * count;
        result.message = `使用成功！获得${5 * count}次提示次数`;
        break;
      default:
        break;
    }

    // 处理经验添加、星钻奖励、经验记录
    if (expToAdd > 0) {
      if (!account.account) account.account = {};
      if (!account.account.profile) account.account.profile = {};

      const oldLevel = account.account.profile.level || 1;
      const oldExp = account.account.profile.exp || 0;
      const newTotalExp = oldExp + expToAdd;

      // 通过总经验重新计算等级
      const { level: calculatedLevel, exp: currentLevelExp } = this.calculateLevelAndExp(newTotalExp);
      account.account.profile.exp = newTotalExp;
      account.account.profile.level = calculatedLevel;
      const newLevel = calculatedLevel;

      // 星钻奖励
      let currencyReward = Math.max(1, Math.floor(expToAdd / 10));
      if (currencyReward > 0) {
        await this.addCurrency(userId, currencyReward, `获得${expToAdd}经验值奖励`, 'exp_reward');
      }

      // 升级奖励
      if (newLevel > oldLevel) {
        const levelUpCurrency = (newLevel - oldLevel) * 50;
        await this.addCurrency(userId, levelUpCurrency, `从${oldLevel}级升到${newLevel}级奖励`, 'level_up');
      }
      await this.checkLevelRewards(userId);

      // 记录经验变动
      try {
        const expRecords = await this.getExpRecords(userId);
        expRecords.transactions.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
          baseExp: expToAdd,
          bonusExp: 0,
          finalExp: expToAdd,
          levelMult: 1,
          eventLabel: itemId === 'item_exp_potion' ? '经验药水' : '等级直升券',
          oldLevel: oldLevel,
          newLevel: newLevel,
          totalExp: account.account.profile.exp,
          timestamp: Date.now()
        });
        if (expRecords.transactions.length > 500) {
          expRecords.transactions = expRecords.transactions.slice(-500);
        }
        await dataStore.writeOne('expTransactions', userId, expRecords);
      } catch (recErr) {
        logger.warn('记录经验变动失败', { userId, error: recErr.message });
      }
    }

    // 扣除道具
    account.inventory.items[itemId] -= count;
    if (account.inventory.items[itemId] <= 0) {
      delete account.inventory.items[itemId];
    }

    await this._saveAccount(userId, account);
    return result;
  }

  // ========== 外观系统 ==========

  /**
   * 获取用户外观
   */
  async getCosmetics(userId) {
    const account = await this._getAccount(userId);
    const cosmetics = account?.cosmetics || {
      owned: { frames: [], skins: [], backgrounds: [], titles: [] },
      equipped: { frame: null, skin: null, background: null, title: null }
    };
    return { success: true, cosmetics };
  }

  /**
   * 添加外观
   */
  async addCosmetic(userId, category, cosmeticId) {
    const account = await this._getAccount(userId);
    if (!account) {
      return { success: false, message: '账号不存在' };
    }
    if (!account.cosmetics) {
      account.cosmetics = {
        owned: { frames: [], skins: [], backgrounds: [], titles: [] },
        equipped: { frame: null, skin: null, background: null, title: null }
      };
    }

    const categoryMap = {
      frame: 'frames',
      skin: 'skins',
      background: 'backgrounds',
      title: 'titles'
    };
    const ownedKey = categoryMap[category];

    if (!ownedKey) {
      return { success: false, message: '类型错误' };
    }

    if (!account.cosmetics.owned[ownedKey].includes(cosmeticId)) {
      account.cosmetics.owned[ownedKey].push(cosmeticId);
    }

    await this._saveAccount(userId, account);
    return { success: true };
  }

  /**
   * 装备外观
   */
  async equipCosmetic(userId, category, cosmeticId) {
    const account = await this._getAccount(userId);
    if (!account) {
      return { success: false, message: '账号不存在' };
    }
    if (!account.cosmetics) {
      return { success: false, message: '请先购买' };
    }

    const categoryMap = {
      frame: 'frames',
      skin: 'skins',
      background: 'backgrounds',
      title: 'titles'
    };
    const ownedKey = categoryMap[category];

    if (!ownedKey) {
      return { success: false, message: '类型错误' };
    }

    if (cosmeticId && !account.cosmetics.owned[ownedKey].includes(cosmeticId)) {
      return { success: false, message: '未拥有该外观' };
    }

    account.cosmetics.equipped[category] = cosmeticId || null;
    await this._saveAccount(userId, account);
    return { success: true };
  }

  // ========== 会员系统 ==========

  /**
   * 获取用户会员信息
   */
  async getVip(userId) {
    const account = await this._getAccount(userId);
    const vip = account?.vip || { type: null, expireAt: 0, expBonus: 0, lastDailyGift: 0, lastWeeklyGift: 0, lastMonthlyGift: 0 };

    const now = Date.now();
    const isActive = vip.expireAt > now;

    return {
      success: true,
      vip: {
        ...vip,
        isActive,
        remainingDays: isActive ? Math.ceil((vip.expireAt - now) / (1000 * 60 * 60 * 24)) : 0
      }
    };
  }

  /**
   * 添加会员
   */
  async addVip(userId, days, expBonus) {
    const account = await this._getAccount(userId);
    if (!account) {
      return { success: false, message: '账号不存在' };
    }
    if (!account.vip) {
      account.vip = { type: null, expireAt: 0, expBonus: 0, lastDailyGift: 0, lastWeeklyGift: 0, lastMonthlyGift: 0 };
    }

    const now = Date.now();
    if (account.vip.expireAt > now) {
      account.vip.expireAt += days * 24 * 60 * 60 * 1000;
    } else {
      account.vip.expireAt = now + days * 24 * 60 * 60 * 1000;
    }
    account.vip.type = `vip_${days === 7 ? 'week' : days === 30 ? 'month' : 'year'}`;
    account.vip.expBonus = Math.max(account.vip.expBonus || 0, expBonus);

    await this._saveAccount(userId, account);
    return { success: true };
  }
}

module.exports = AccountManager;
