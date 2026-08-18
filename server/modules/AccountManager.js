// AccountManager.js - 账号管理模块
const crypto = require('crypto');
const { execFile, execFileSync } = require('child_process');
const logger = require('../utils/logger');
const config = require('../config');
const dataStore = require('../utils/dataStore');
const fs = require('fs');
const path = require('path');

class AccountManager {
  constructor(io = null) {
    // 密码哈希迭代次数 - 可根据需要调整
    this.iterations = config.security.passwordHashIterations;
    // 密钥长度
    this.keyLength = config.security.passwordKeyLength;
    // 哈希算法
    this.digest = 'sha512';
    // socket.io 引用，用于发送实时通知
    this.io = io;
    // 加载等级经验配置
    this.levelExpConfig = this.loadLevelExpConfig();
    // 商店配置缓存（避免请求路径上同步读文件阻塞事件循环）
    // 结构: { [fileName]: { data, ts } }
    this._shopConfigCache = {};
    this._shopConfigTTL = 30000; // 30秒缓存，平衡新鲜度与性能
  }

  // 读取商店配置（带 TTL 缓存，避免高并发下阻塞事件循环）
  _getShopConfig(fileName) {
    const now = Date.now();
    const cached = this._shopConfigCache[fileName];
    if (cached && (now - cached.ts) < this._shopConfigTTL) {
      return cached.data;
    }
    const filePath = path.join(__dirname, '..', 'config', 'shop', fileName);
    if (!fs.existsSync(filePath)) return null;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    this._shopConfigCache[fileName] = { data, ts: now };
    return data;
  }

  // 清除商店配置缓存（配置变更后可手动调用）
  invalidateShopConfigCache() {
    this._shopConfigCache = {};
  }

  // 节假日名称→倍率映射
  static HOLIDAY_MULTIPLIERS = {
    '春节': config.holidays.majorHolidayMultiplier,
    '除夕': config.holidays.majorHolidayMultiplier,
    '国庆节': config.holidays.majorHolidayMultiplier,
    '元旦': config.holidays.normalHolidayMultiplier,
    '劳动节': config.holidays.normalHolidayMultiplier,
    '清明节': config.holidays.normalHolidayMultiplier,
    '端午节': config.holidays.normalHolidayMultiplier,
    '中秋节': config.holidays.normalHolidayMultiplier,
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
          const mult = AccountManager.HOLIDAY_MULTIPLIERS[info.name] || config.holidays.normalHolidayMultiplier;
          cache[dateStr] = { name: info.name, multiplier: mult };
        } else {
          cache[dateStr] = { name: info.name, multiplier: config.exp.workdayMultiplier, isMakeup: true };
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
    // 如果配置表中没有，使用最高配置等级的经验值（避免超出配置后经验暴跌）
    if (!this._maxLevelExp) {
      const keys = Object.keys(this.levelExpConfig).map(Number);
      if (keys.length > 0) {
        this._maxLevelExp = Math.max(...keys);
      } else {
        this._maxLevelExp = 1;
      }
    }
    if (level > this._maxLevelExp) {
      return this.levelExpConfig[this._maxLevelExp] || config.exp.baseExpPerLevel;
    }
    // 等级 <=1 的特殊情况
    return (level - 1) * config.exp.baseExpPerLevel;
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
    return crypto.randomBytes(config.security.passwordSaltBytes).toString('hex');
  }

  // 哈希密码
  hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, this.iterations, this.keyLength, this.digest).toString('hex');
  }

  // 验证密码（使用常量时间比较，防止时序攻击）
  verifyPassword(password, salt, hash) {
    if (!salt || !hash) {
      return false;
    }
    const hashToVerify = this.hashPassword(password, salt);
    try {
      // 长度不同时也先做一次常量时间比较以保持时间恒定
      const a = Buffer.from(hashToVerify, 'hex');
      const b = Buffer.from(hash, 'hex');
      if (a.length !== b.length) {
        // 长度不一致直接返回 false，但仍做一次比较以避免长度泄漏
        crypto.timingSafeEqual(a, a);
        return false;
      }
      return crypto.timingSafeEqual(a, b);
    } catch (err) {
      logger.error('密码验证失败', { error: err.message });
      return false;
    }
  }

  // 生成用户ID
  generateUserId() {
    return crypto.randomBytes(config.security.userIdBytes).toString('hex');
  }

  // 生成会话token
  generateSessionToken(accountId) {
    const timestamp = Date.now();
    const random = crypto.randomBytes(config.security.sessionTokenBytes).toString('hex');
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

      // 验证token时效性（7天有效期）
      const tokenAge = Date.now() - parseInt(timestamp);
      const maxAge = config.security.sessionTokenExpiry; // 7天

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
        'account.loginCount': loginCount,
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
    const random = crypto.randomBytes(config.security.sessionTokenBytes).toString('hex');
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
          loginType: account.account?.type || 'guest',
          token: this.generateSessionToken(accountId)
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

      const hasPassword = !!(account.account?.security?.passwordSalt && account.account?.security?.passwordHash);

      // 不返回密码相关信息
      return {
        ...account,
        hasPassword,
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

  // 获取排行榜
  async getLeaderboard(limit = 20, gameType = 'all') {
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

      // 获取游戏类型的辅助函数
      const getGameStats = (account, type) => {
        if (!type || type === 'all') {
          // 总榜：所有游戏合计
          const games = account.games || {};
          let totalWins = 0, totalLosses = 0, totalDraws = 0, totalGames = 0;
          let maxStreakOverall = 0;
          Object.values(games).forEach(g => {
            totalWins += g.wins || 0;
            totalLosses += g.losses || 0;
            totalDraws += g.draws || 0;
            totalGames += g.totalGames || 0;
            if ((g.maxStreak || 0) > maxStreakOverall) maxStreakOverall = g.maxStreak;
          });
          // 总榜连胜 = 最后玩过的游戏类型的连胜
          const lastGameType = Object.keys(games).reverse().find(k => games[k]?.lastPlayedAt);
          const streak = lastGameType ? (games[lastGameType]?.streak || 0) : 0;
          return { wins: totalWins, losses: totalLosses, draws: totalDraws, totalGames, streak, maxStreak: maxStreakOverall };
        }
        if (type === 'snake') {
          const g = account.games?.snake || {};
          const score = account.stats?.snakeGames?.highScore || g.highScore || 0;
          return { wins: 0, losses: 0, draws: 0, totalGames: g.totalGames || 0, streak: 0, maxStreak: 0, score };
        }
        const g = account.games?.[type] || {};
        const wins = g.wins || 0;
        const losses = g.losses || 0;
        const draws = g.draws || 0;
        const totalGames = g.totalGames || 0;
        return { wins, losses, draws, totalGames, streak: g.streak || 0, maxStreak: g.maxStreak || 0, score: 0 };
      };

      // 计算排序分数
      const getSortScore = (account, type) => {
        if (!type || type === 'all') {
          return Object.values(account.games || {}).reduce((sum, g) => sum + (g.wins || 0), 0);
        }
        if (type === 'snake') {
          return account.stats?.snakeGames?.highScore || account.games?.snake?.highScore || 0;
        }
        return account.games?.[type]?.wins || 0;
      };

      return uniqueAccounts
        .sort((a, b) => {
          const scoreA = getSortScore(a, gameType);
          const scoreB = getSortScore(b, gameType);
          if (scoreB !== scoreA) return scoreB - scoreA;
          // 分数相同时按等级排序
          const lvA = a.account?.profile?.level || 1;
          const lvB = b.account?.profile?.level || 1;
          return lvB - lvA;
        })
        .slice(0, limit)
        .map((account, index) => {
          const stats = getGameStats(account, gameType);
          const name = account.account?.nickname || account.account?.username || `玩家${account.account?.id?.substr(0, 4) || '0000'}`;
          const total = stats.totalGames || stats.wins + stats.losses + stats.draws;
          const winrateNum = total > 0 ? Math.round((stats.wins / total) * 100) : 0;

          return {
            rank: index + 1,
            id: account.account?.id,
            username: account.account?.username,
            name: name,
            level: account.account?.profile?.level || 1,
            exp: account.account?.profile?.exp || 0,
            wins: stats.wins,
            losses: stats.losses,
            draws: stats.draws,
            totalGames: total,
            streak: stats.streak,
            maxStreak: stats.maxStreak,
            score: stats.score || 0,
            winrate: `${winrateNum}%`,
            winrateNum: winrateNum
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
      const salt = crypto.randomBytes(config.security.passwordSaltBytes).toString('hex');
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
          loginType: account.account.type === 'guest' ? 'guest' : 'account',
          token: this.generateSessionToken(accountId) // 每次验证成功刷新token
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
        'account.loginCount': loginCount,
        'account.updatedAt': now
      });

      logger.info('账号登录', { id: account.account.id, username: account.account.username });

      // 生成登录token
      const loginToken = crypto.randomBytes(32).toString('hex');

      // 不返回敏感信息
      const hasPassword = !!(account.account?.security?.passwordSalt && account.account?.security?.passwordHash);
      const safeAccount = {
        ...account,
        hasPassword,
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

      const hasPassword = !!(account.account?.security?.passwordSalt && account.account?.security?.passwordHash);

      let inventory = account.inventory || null;
      if (!inventory) {
        try {
          const invResult = await this.getInventory(id);
          if (invResult && invResult.inventory) {
            inventory = invResult.inventory;
          }
        } catch (invErr) {
          logger.warn('获取账号背包数据失败', { id, error: invErr.message });
        }
      }

      const safeAccount = {
        ...account,
        hasPassword,
        inventory: inventory || { items: {}, undoCount: 0, hintCount: 0 },
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

      // 更新逆转连胜：胜利时+1，失败时归零
      if (result === 'win') {
        stats.comebackStreak = (stats.comebackStreak || 0) + 1;
      } else if (result === 'loss') {
        stats.comebackStreak = 0;
      }

      // 更新低等级胜利计数：等级 <= 5 时的胜利
      if (result === 'win') {
        const playerLevel = account.account?.profile?.level || 1;
        if (playerLevel <= 5) {
          stats.lowLevelWins = (stats.lowLevelWins || 0) + 1;
        }
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
      if (h.isMakeup) return { multiplier: config.exp.workdayMultiplier, label: '' }; // 补班日，无加成
      if (isWeekend) {
        const stacked = h.multiplier * config.exp.weekendHolidayMultiplier;
        return { multiplier: stacked, label: `${h.name}·周末 限时翻倍×${stacked}` };
      }
      return { multiplier: h.multiplier, label: `${h.name} 限时翻倍×${h.multiplier}` };
    }

    // 2. 检查国际节假日（计算规则）
    const intl = this.getInternationalHoliday();
    if (intl) {
      if (isWeekend) {
        const stacked = intl.multiplier * config.exp.weekendHolidayMultiplier;
        return { multiplier: stacked, label: `${intl.label.split('限时')[0]}·周末 限时翻倍×${stacked}` };
      }
      return intl;
    }

    // 3. 周末 1.5 倍
    if (isWeekend) {
      return { multiplier: config.exp.weekendMultiplier, label: `周末 限时翻倍×${config.exp.weekendMultiplier}` };
    }

    return { multiplier: config.exp.workdayMultiplier, label: '' };
  }

  // 等级经验倍率：等级越高倍率越大，保证后期升级不吃力
  getExpMultiplier(level) {
    const lm = config.exp.levelMultipliers;
    if (level <= lm.low.maxLevel) return lm.low.multiplier;
    if (level <= lm.mid.maxLevel) return lm.mid.multiplier;
    if (level <= lm.high.maxLevel) return lm.high.multiplier;
    if (level <= lm.veryHigh.maxLevel) return lm.veryHigh.multiplier;
    return lm.max.multiplier;
  }

  // 添加经验值
  // applyEventMult: false 表示不应用任何倍率（如经验药水、等级直升券）
  // source: 经验来源标识，用于后台记录统计
  // gameType: 若经验来自对局，记录具体游戏类型（gobang/go/chinese-chess/snake）
  async addExp(id, exp, applyEventMult = true, source = 'battle', gameType = null) {
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
        if (eventResult.multiplier !== config.exp.workdayMultiplier) {
          multipliers.push(eventResult.multiplier);
          labels.push(eventResult.label);
        }

        // 2. 双倍/三倍经验buff（优先使用三倍）
        if (account.activeBuffs?.tripleExp && account.activeBuffs.tripleExp > now) {
          multipliers.push(config.exp.itemMultipliers.tripleExp);
          labels.push('三倍经验');
        } else if (account.activeBuffs?.doubleExp && account.activeBuffs.doubleExp > now) {
          multipliers.push(config.exp.itemMultipliers.doubleExp);
          labels.push('双倍经验');
        }

        // 3. VIP会员
        if (account.vip?.expireAt > now) {
          const vipBonus = account.vip.expBonus || config.exp.vipDefaultMultiplier;
          multipliers.push(vipBonus);
          labels.push(`VIP×${vipBonus}`);
        }

        // 计算总倍率
        let eventMultTotal = config.exp.workdayMultiplier;
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

      // 每获得N点经验，奖励1星钻
      let currencyReward = Math.max(1, Math.floor(finalExp / config.exp.expToCoinRatio));
      // 幸运符提升星钻奖励
      if (account.activeBuffs?.luckBoost && account.activeBuffs.luckBoost > Date.now()) {
        currencyReward = Math.floor(currencyReward * 2); // 双倍星钻奖励
      }
      if (currencyReward > 0) {
        await this.addCurrency(id, currencyReward, `获得${finalExp}经验值奖励`, 'exp_reward', gameType);
      }

      // 升级时额外奖励星钻并检查等级奖励
      let levelUpCurrency = 0;
      if (level > oldLevel) {
        levelUpCurrency = (level - oldLevel) * config.exp.levelUpCoinReward; // 每升1级奖励星钻
        await this.addCurrency(id, levelUpCurrency, `从${oldLevel}级升到${level}级奖励`, 'level_up');

        // 记录升级操作日志
        if (this.operationLogger) {
          const username = account?.account?.nickname || account?.account?.username || '';
          this.operationLogger.getLevelUp(id, username, oldLevel, level, { source });
        }
      }
      await this.checkLevelRewards(id);

      // 记录经验值变化操作日志
      if (this.operationLogger && finalExp > 0) {
        const username = account?.account?.nickname || account?.account?.username || '';
        this.operationLogger.getExpChange(id, username, finalExp, source, { oldLevel, newLevel: level, totalExp: newTotalExp });
      }

      // 记录经验变动
      try {
        const expRecords = await this.getExpRecords(id);
        expRecords.transactions.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
          baseExp: exp,
          bonusExp: finalExp - exp,
          finalExp,
          levelMult,
          source,
          gameType,
          eventLabel: eventLabel || null,
          oldLevel,
          newLevel: level,
          totalExp: newTotalExp,
          timestamp: Date.now()
        });
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

  // 设置密码（用于没有密码的账号首次设置密码）
  async setPassword(id, newPassword) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      // 验证密码
      if (!this.validatePassword(newPassword)) {
        return {
          success: false,
          message: '密码长度至少6位'
        };
      }

      // 生成密码哈希
      const salt = this.generateSalt();
      const hash = this.hashPassword(newPassword, salt);

      await dataStore.update('accounts', { 'account.id': id }, {
        'account.security': {
          passwordSalt: salt,
          passwordHash: hash
        },
        'account.updatedAt': Date.now()
      });

      logger.info('密码设置', { id });
      return {
        success: true,
        message: '密码设置成功'
      };
    } catch (err) {
      logger.error('设置密码失败', { id, error: err.message });
      return {
        success: false,
        message: '设置失败，请稍后重试'
      };
    }
  }

  // 验证用户名格式
  validateUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < config.validation.usernameMinLength || username.length > config.validation.usernameMaxLength) return false;
    return /^[a-zA-Z0-9_]+$/.test(username);
  }

  // 验证密码格式
  validatePassword(password) {
    if (!password || typeof password !== 'string') return false;
    return password.length >= config.validation.passwordMinLength;
  }

  // 获取所有账号列表（用于后台管理）
  async getAllAccounts(limit = config.validation.defaultAccountListLimit) {
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

  // 管理员升级为管理员
  async upgradeToAdmin(accountId) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      if (account.account?.isAdmin) {
        return {
          success: false,
          message: '该账号已经是管理员'
        };
      }

      await dataStore.update('accounts', { 'account.id': accountId }, {
        'account.isAdmin': true,
        'account.updatedAt': Date.now()
      });

      logger.info('账号升级为管理员', { accountId, username: account.account?.username });
      return {
        success: true,
        message: '升级成功'
      };
    } catch (err) {
      logger.error('升级管理员失败', { accountId, error: err.message });
      return {
        success: false,
        message: '操作失败'
      };
    }
  }

  // 管理员重置密码
  async resetPasswordByAdmin(accountId, newPassword) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': accountId });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      if (!this.validatePassword(newPassword)) {
        return {
          success: false,
          message: '密码长度至少6位'
        };
      }

      const newSalt = this.generateSalt();
      const newHash = this.hashPassword(newPassword, newSalt);

      await dataStore.update('accounts', { 'account.id': accountId }, {
        'account.security': {
          passwordSalt: newSalt,
          passwordHash: newHash
        },
        'account.type': 'registered',
        'account.updatedAt': Date.now()
      });

      logger.info('管理员重置账号密码', { accountId, username: account.account?.username });
      return {
        success: true,
        message: '密码重置成功'
      };
    } catch (err) {
      logger.error('重置密码失败', { accountId, error: err.message });
      return {
        success: false,
        message: '操作失败'
      };
    }
  }

  // 管理员创建账号
  async createAdminAccount(username, password, nickname, isAdmin = false) {
    try {
      if (!this.validateUsername(username)) {
        return {
          success: false,
          message: '用户名格式不正确（3-20位字母数字下划线）'
        };
      }

      if (!this.validatePassword(password)) {
        return {
          success: false,
          message: '密码长度至少6位'
        };
      }

      const existing = await dataStore.findOne('accounts', { 'account.username': username });
      if (existing) {
        return {
          success: false,
          message: '用户名已存在'
        };
      }

      const salt = this.generateSalt();
      const hash = this.hashPassword(password, salt);

      const accountData = {
        account: {
          id: this.generateId(),
          type: 'registered',
          username: username,
          nickname: nickname || username,
          security: {
            passwordSalt: salt,
            passwordHash: hash
          },
          isAdmin: isAdmin,
          isBanned: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          profile: {
            level: 1,
            exp: 0
          },
          stats: {
            gameCount: 0,
            winCount: 0,
            loginCount: 0
          }
        }
      };

      await dataStore.insert('accounts', accountData);
      logger.info('管理员创建账号', { username, nickname, isAdmin });

      return {
        success: true,
        message: '账号创建成功',
        accountId: accountData.account.id
      };
    } catch (err) {
      logger.error('创建账号失败', { username, error: err.message });
      return {
        success: false,
        message: '操作失败'
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

  // 管理员重置用户所有成就
  async resetUserAchievements(id) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      const oldAchievements = this._normalizeAchievements(account.achievements || []);
      await dataStore.update('accounts', { 'account.id': id }, { achievements: [], 'account.updatedAt': Date.now() });
      logger.info('管理员重置用户所有成就', { id, count: oldAchievements.length });

      return {
        success: true,
        message: '成就重置成功',
        removedAchievements: oldAchievements
      };
    } catch (err) {
      logger.error('重置用户成就失败', { id, error: err.message });
      return {
        success: false,
        message: '重置失败，请稍后重试'
      };
    }
  }

  // ========== 星钻货币系统 ==========

  // 货币名称配置
  static get CURRENCY_NAME() { return '星钻'; }
  static get CURRENCY_ICON() { return '💎'; }

  // 等级奖励配置
  getLevelRewards() {
    const milestones = config.levelRewards.milestones;
    const result = [];

    const levelTitles = {
      5: '棋坛新秀',
      10: '对弈达人',
      15: '棋艺高手',
      25: '棋坛精英',
      40: '传奇大师',
      50: '至尊棋圣'
    };

    const levelBadges = {
      20: 'level_20_reward',
      30: 'level_30_reward',
      50: 'level_50_reward'
    };

    for (const [levelStr, milestone] of Object.entries(milestones)) {
      const level = parseInt(levelStr);
      const rewards = [];
      const descParts = [];

      if (milestone.starCoins) {
        rewards.push({ type: 'currency', amount: milestone.starCoins });
        descParts.push(`${milestone.starCoins}💎`);
      }

      if (levelBadges[level]) {
        rewards.push({ type: 'badge', name: levelBadges[level] });
        descParts.push('限定徽章');
      }

      if (levelTitles[level]) {
        rewards.push({ type: 'title', name: levelTitles[level] });
        descParts.push(`称号"${levelTitles[level]}"`);
      }

      if (milestone.expPotions) {
        rewards.push({ type: 'item', id: 'item_exp_potion', count: milestone.expPotions });
        descParts.push(`🧪经验药水×${milestone.expPotions}`);
      }

      if (milestone.undoCards) {
        rewards.push({ type: 'item', id: 'item_undo', count: milestone.undoCards });
        descParts.push(`↩️悔棋卡×${milestone.undoCards}`);
      }

      if (milestone.doubleExpCards) {
        rewards.push({ type: 'item', id: 'item_double_exp', count: milestone.doubleExpCards });
        descParts.push(`✨双倍经验卡×${milestone.doubleExpCards}`);
      }

      if (milestone.hintCards) {
        rewards.push({ type: 'item', id: 'item_hint', count: milestone.hintCards });
        descParts.push(`💡提示卡×${milestone.hintCards}`);
      }

      if (milestone.tripleExpCards) {
        rewards.push({ type: 'item', id: 'item_triple_exp', count: milestone.tripleExpCards });
        descParts.push(`🌟三倍经验卡×${milestone.tripleExpCards}`);
      }

      if (milestone.luckyCharms) {
        rewards.push({ type: 'item', id: 'item_luck_boost', count: milestone.luckyCharms });
        descParts.push(`🍀幸运符×${milestone.luckyCharms}`);
      }

      if (milestone.levelUpTickets) {
        rewards.push({ type: 'item', id: 'item_level_up', count: milestone.levelUpTickets });
        descParts.push(`🚀等级直升券×${milestone.levelUpTickets}`);
      }

      if (milestone.vipDays) {
        const vipMultiplier = milestone.vipMultiplier || config.exp.vipDefaultMultiplier;
        rewards.push({ type: 'vip', days: milestone.vipDays, expBonus: vipMultiplier });
        descParts.push(`💎${milestone.vipDays}天月卡`);
      }

      result.push({
        level,
        rewards,
        description: '获得' + descParts.join(' + ')
      });
    }

    result.sort((a, b) => a.level - b.level);
    return result;
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
  // gameType: 若交易来自对局（经验兑换），记录具体游戏类型
  async addCurrency(accountId, amount, reason, source = 'system', gameType = null) {
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
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
        type: 'earn',
        amount,
        balance: newBalance,
        source,
        gameType,
        reason,
        timestamp: Date.now()
      });

      await dataStore.writeOne('currencyTransactions', accountId, transactionRecords);
      logger.info('添加星钻', { accountId, amount, reason, balance: newBalance });

      if (this.operationLogger) {
        this.operationLogger.getCurrencyAdd(accountId, account?.account?.nickname || account?.account?.username || '', amount, reason, { source });
      }

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
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
        type: 'spend',
        amount,
        balance: newBalance,
        source: 'spend',
        reason,
        timestamp: Date.now()
      });

      await dataStore.writeOne('currencyTransactions', accountId, transactionRecords);
      logger.info('使用星钻', { accountId, amount, reason, balance: newBalance });

      if (this.operationLogger) {
        this.operationLogger.getCurrencySpend(accountId, account?.account?.nickname || account?.account?.username || '', amount, reason);
      }

      return { success: true, balance: newBalance, used: amount };
    } catch (err) {
      logger.error('使用星钻失败', { accountId, error: err.message });
      return { success: false, message: '使用失败' };
    }
  }

  // 获取星钻交易记录
  async getCurrencyTransactions(accountId, limit = config.validation.defaultTransactionQueryLimit) {
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
  async getExpTransactions(accountId, limit = config.exp.defaultQueryLimit) {
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
    const BASE_BONUS = config.compensation.newPlayerGiftCoins;

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
          const expComp = Math.max(0, Math.floor(totalExp / config.compensation.expToCoinRate));
          const levelComp = (level - 1) * config.compensation.perLevelCoins;
          const achieveComp = achievementCount * config.compensation.perAchievementCoins;
          const gameComp = totalGames * config.compensation.perGameCoins;
          const winComp = totalWins * config.compensation.perWinCoins;
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
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
            type: 'earn', amount: total, balance: account.currency.starCoins,
            source: 'compensation', reason, timestamp: Date.now()
          });
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

  // ========== 邮件独立存储 ==========

  /**
   * 获取用户邮件（独立存储，不再放在账号数据里）
   */
  async _getMailStore(userId) {
    try {
      let store = await dataStore.readOne('mails', userId);

      // 检查账号里是否还有残留的 mails 字段，有则合并迁移并清理
      const account = await this._getAccount(userId);
      const hasOldMails = account && account.mails && Array.isArray(account.mails) && account.mails.length > 0;

      if (!store && hasOldMails) {
        store = { userId, mails: account.mails };
        await dataStore.writeOne('mails', userId, store);
        delete account.mails;
        await this._saveAccount(userId, account);
        logger.info('邮件数据已迁移到独立存储', { userId, mailCount: store.mails.length });
      } else if (store && hasOldMails) {
        // 独立文件已存在，把账号里的旧邮件合并进去（按 id 去重）
        const existingIds = new Set(store.mails.map(m => m.id));
        for (const oldMail of account.mails) {
          if (!existingIds.has(oldMail.id)) store.mails.push(oldMail);
        }
        await dataStore.writeOne('mails', userId, store);
        delete account.mails;
        await this._saveAccount(userId, account);
        logger.info('邮件数据已迁移到独立存储', { userId, mailCount: store.mails.length });
      } else if (account && account.mails !== undefined && !hasOldMails) {
        // 空数组，直接清理
        delete account.mails;
        await this._saveAccount(userId, account);
      }

      return store || { userId, mails: [] };
    } catch (err) {
      logger.error('获取邮件存储失败', { userId, error: err.message });
      return { userId, mails: [] };
    }
  }

  /**
   * 保存用户邮件到独立存储
   */
  async _saveMailStore(userId, store) {
    try {
      await dataStore.writeOne('mails', userId, store);
      return true;
    } catch (err) {
      logger.error('保存邮件存储失败', { userId, error: err.message });
      return false;
    }
  }

  // ========== 背包独立存储 ==========

  /**
   * 获取用户背包（独立存储，不再放在账号数据里）
   */
  async _getInventoryStore(userId) {
    try {
      let store = await dataStore.readOne('inventories', userId);

      const account = await this._getAccount(userId);
      const oldInv = account?.inventory;
      const hasOldData = oldInv && (
        (oldInv.items && Object.keys(oldInv.items).length > 0) ||
        oldInv?.undoCount > 0 ||
        oldInv?.hintCount > 0
      );

      if (!store && hasOldData) {
        store = {
          userId,
          items: oldInv.items || {},
          undoCount: oldInv.undoCount || 0,
          hintCount: oldInv.hintCount || 0
        };
        await dataStore.writeOne('inventories', userId, store);
        delete account.inventory;
        await this._saveAccount(userId, account);
        const itemCount = Object.keys(store.items || {}).length;
        logger.info('背包数据已迁移到独立存储', { userId, itemCount });
      } else if (store && hasOldData) {
        // 独立文件已存在，把账号里的旧物品合并进去
        if (oldInv.items) {
          for (const [itemId, count] of Object.entries(oldInv.items)) {
            store.items[itemId] = (store.items[itemId] || 0) + count;
          }
        }
        store.undoCount = Math.max(store.undoCount || 0, oldInv.undoCount || 0);
        store.hintCount = Math.max(store.hintCount || 0, oldInv.hintCount || 0);
        await dataStore.writeOne('inventories', userId, store);
        delete account.inventory;
        await this._saveAccount(userId, account);
        const itemCount = Object.keys(store.items || {}).length;
        logger.info('背包数据已迁移到独立存储', { userId, itemCount });
      } else if (account && account.inventory !== undefined && !hasOldData) {
        delete account.inventory;
        await this._saveAccount(userId, account);
      }

      return store || { userId, items: {}, undoCount: 0, hintCount: 0 };
    } catch (err) {
      logger.error('获取背包存储失败', { userId, error: err.message });
      return { userId, items: {}, undoCount: 0, hintCount: 0 };
    }
  }

  /**
   * 保存用户背包到独立存储
   */
  async _saveInventoryStore(userId, store) {
    try {
      await dataStore.writeOne('inventories', userId, store);
      return true;
    } catch (err) {
      logger.error('保存背包存储失败', { userId, error: err.message });
      return false;
    }
  }

  /**
   * 全量迁移邮件和背包数据到独立存储（服务器启动时调用一次）
   */
  static async migrateAll() {
    try {
      const accounts = await dataStore.read('accounts');
      if (!accounts || accounts.length === 0) {
        logger.info('无账号数据，跳过迁移');
        return { success: true, migratedAccounts: 0, mailCount: 0, inventoryItemCount: 0 };
      }

      let migratedAccounts = 0;
      let totalMailCount = 0;
      let totalInventoryItemCount = 0;

      for (const account of accounts) {
        const userId = account?.account?.id || account?.id;
        if (!userId) continue;

        let needsSave = false;

        // 只要账号里还有 mails 字段，就合并到独立文件并清理
        if (account.mails && Array.isArray(account.mails) && account.mails.length > 0) {
          let existingMailStore = null;
          try { existingMailStore = await dataStore.readOne('mails', userId); } catch (e) { /* 忽略 */ }

          const existingIds = new Set(
            existingMailStore && existingMailStore.mails
              ? existingMailStore.mails.map(m => m.id)
              : []
          );
          const merged = existingMailStore && existingMailStore.mails
            ? [...existingMailStore.mails]
            : [];

          for (const oldMail of account.mails) {
            if (!existingIds.has(oldMail.id)) merged.push(oldMail);
          }

          await dataStore.writeOne('mails', userId, { userId, mails: merged });
          delete account.mails;
          needsSave = true;
          totalMailCount += merged.length;
          logger.info('迁移邮件数据', { userId, mailCount: merged.length });
        } else if (account.mails !== undefined) {
          delete account.mails;
          needsSave = true;
        }

        // 只要账号里还有 inventory 字段，就合并到独立文件并清理
        if (account.inventory) {
          const oldInv = account.inventory;
          const hasData = (oldInv.items && Object.keys(oldInv.items).length > 0) ||
            oldInv?.undoCount > 0 || oldInv?.hintCount > 0;

          if (hasData) {
            let existingInvStore = null;
            try { existingInvStore = await dataStore.readOne('inventories', userId); } catch (e) { /* 忽略 */ }

            const mergedItems = { ...(existingInvStore?.items || {}) };
            if (oldInv.items) {
              for (const [itemId, count] of Object.entries(oldInv.items)) {
                mergedItems[itemId] = (mergedItems[itemId] || 0) + count;
              }
            }

            await dataStore.writeOne('inventories', userId, {
              userId,
              items: mergedItems,
              undoCount: Math.max(existingInvStore?.undoCount || 0, oldInv.undoCount || 0),
              hintCount: Math.max(existingInvStore?.hintCount || 0, oldInv.hintCount || 0)
            });
            delete account.inventory;
            needsSave = true;
            const itemCount = Object.keys(mergedItems).length;
            totalInventoryItemCount += itemCount;
            logger.info('迁移背包数据', { userId, itemCount });
          } else {
            delete account.inventory;
            needsSave = true;
          }
        }

        if (needsSave) {
          await dataStore.writeOne('accounts', userId, account);
          migratedAccounts++;
        }
      }

      logger.info('全量迁移完成', { migratedAccounts, totalMailCount, totalInventoryItemCount });
      return { success: true, migratedAccounts, mailCount: totalMailCount, inventoryItemCount: totalInventoryItemCount };
    } catch (err) {
      logger.error('全量迁移失败', { error: err.message, stack: err.stack });
      return { success: false, message: err.message };
    }
  }

  // ========== 背包系统 ==========

  /**
   * 获取用户背包
   */
  async getInventory(userId) {
    const invStore = await this._getInventoryStore(userId);
    const items = {};
    if (invStore.items) {
      for (const [id, val] of Object.entries(invStore.items)) {
        items[id] = Array.isArray(val) ? val.length : (Number(val) || 0);
      }
    }
    const inventory = {
      items,
      undoCount: invStore.undoCount || 0,
      hintCount: invStore.hintCount || 0
    };
    return { success: true, inventory };
  }

  /**
   * 根据等级取动态价格系数（不同等级区间用不同系数）
   */
  getPriceRatio(level) {
    const lr = config.dynamicPricing.levelRatios;
    if (level <= lr.low.maxLevel) return lr.low.ratio;
    if (level <= lr.mid.maxLevel) return lr.mid.ratio;
    if (level <= lr.high.maxLevel) return lr.high.ratio;
    return lr.max.ratio;
  }

  /**
   * 计算某个商品的动态价格（根据用户当前等级）
   */
  getDynamicPrice(itemConfig, currentLevel) {
    if (!itemConfig?.dynamic) return itemConfig?.price || 0;
    const maxLevel = this.getMaxLevel();
    // 达到/超出最高等级时按上一级计算（防止价格回落）
    const calcLevel = Math.min(currentLevel, maxLevel - 1);
    const nextLevel = calcLevel + 1;
    const expNeeded = this.getExpForLevel(nextLevel);

    const maxRatio = itemConfig.maxRatio || config.dynamicPricing.maxRatio;
    const minRatio = itemConfig.minRatio || config.dynamicPricing.minRatio;
    const t = Math.min(1, (calcLevel - 1) / Math.max(1, maxLevel - 1));
    const power = itemConfig.ratioPower || config.dynamicPricing.curveExponent;
    const adjustedT = Math.pow(t, power);
    const ratio = maxRatio - (maxRatio - minRatio) * adjustedT;

    return Math.max(1, Math.floor(expNeeded * ratio));
  }

  /**
   * 获取某个道具的持有数量（兼容数字和数组两种存储格式）
   */
  _getItemCount(invStore, itemId) {
    const val = invStore?.items?.[itemId];
    if (val == null) return 0;
    if (Array.isArray(val)) return val.length;
    return Number(val) || 0;
  }

  /**
   * 添加道具（支持带 meta 信息的道具，meta 模式下用数组存储每个实例）
   */
  async addItem(userId, itemId, count = 1, meta = null, shopManager = null) {
    const invStore = await this._getInventoryStore(userId);
    if (!invStore.items) invStore.items = {};

    let hasMeta = meta != null;
    if (!hasMeta && shopManager) {
      const cfg = shopManager.findItem(itemId);
      if (cfg?.hasMeta) hasMeta = true;
    }

    if (hasMeta) {
      if (!Array.isArray(invStore.items[itemId])) {
        const existingCount = invStore.items[itemId] || 0;
        invStore.items[itemId] = [];
        for (let i = 0; i < existingCount; i++) {
          invStore.items[itemId].push({});
        }
      }
      for (let i = 0; i < count; i++) {
        invStore.items[itemId].push(meta || {});
      }
    } else {
      invStore.items[itemId] = (invStore.items[itemId] || 0) + count;
    }
    await this._saveInventoryStore(userId, invStore);
    return { success: true };
  }

  /**
   * 从背包中扣除道具（兼容数字和数组两种存储格式）
   */
  _consumeItem(invStore, itemId, count) {
    const val = invStore.items[itemId];
    if (Array.isArray(val)) {
      val.splice(0, count);
      if (val.length === 0) delete invStore.items[itemId];
    } else {
      invStore.items[itemId] = val - count;
      if (invStore.items[itemId] <= 0) delete invStore.items[itemId];
    }
  }

  /**
   * 使用道具
   */
  async useItem(userId, itemId, count = 1, shopManager = null) {
    const invStore = await this._getInventoryStore(userId);
    const itemCount = this._getItemCount(invStore, itemId);
    if (itemCount < count) {
      return { success: false, message: '道具不足' };
    }

    // 如果是礼包类型，交由 shopManager 处理
    if (shopManager) {
      const itemInfo = shopManager.findItem(itemId);
      if (itemInfo && itemInfo.category === 'pack') {
        const openResult = await shopManager.openPack(userId, itemId, this);
        if (openResult.success) {
          this._consumeItem(invStore, itemId, count);
          await this._saveInventoryStore(userId, invStore);
          return { ...openResult };
        }
        return openResult;
      }

      // 如果是头像槽位类型物品，直接增加槽位
      if (itemInfo && itemInfo.category === 'slot') {
        const slotAdd = (itemInfo.slots || 1) * count;
        await this.addAvatarSlots(userId, slotAdd);
        this._consumeItem(invStore, itemId, count);
        await this._saveInventoryStore(userId, invStore);
        return { success: true, message: `成功增加${slotAdd}个自定义头像槽位！` };
      }
    }

    let result = { success: true };
    let expToAdd = 0;
    let eventLabel = '道具使用';
    const account = await this._getAccount(userId);

    switch (itemId) {
      case 'item_double_exp':
        if (!account) return { success: false, message: '账号不存在' };
        if (!account.activeBuffs) account.activeBuffs = {};
        const now = Date.now();
        const existingExpire = account.activeBuffs.doubleExp || now;
        account.activeBuffs.doubleExp = Math.max(existingExpire, now) + config.items.durations.doubleExp;
        result.message = '双倍经验卡已激活！1小时内经验翻倍';
        await this._saveAccount(userId, account);
        break;
      case 'item_luck_boost':
        if (!account) return { success: false, message: '账号不存在' };
        if (!account.activeBuffs) account.activeBuffs = {};
        const luckNow = Date.now();
        const existingLuckExpire = account.activeBuffs.luckBoost || luckNow;
        account.activeBuffs.luckBoost = Math.max(existingLuckExpire, luckNow) + config.items.durations.luckyCharm;
        result.message = '幸运符已激活！1小时内星钻奖励翻倍';
        await this._saveAccount(userId, account);
        break;
      case 'item_triple_exp':
        if (!account) return { success: false, message: '账号不存在' };
        if (!account.activeBuffs) account.activeBuffs = {};
        const tripleNow = Date.now();
        const existingTripleExpire = account.activeBuffs.tripleExp || tripleNow;
        account.activeBuffs.tripleExp = Math.max(existingTripleExpire, tripleNow) + config.items.durations.tripleExp;
        result.message = '三倍经验卡已激活！1小时内经验三倍';
        await this._saveAccount(userId, account);
        break;
      case 'item_exp_potion':
        expToAdd = config.items.effects.expPotion * count;
        eventLabel = '经验药水';
        result.message = `使用成功！获得${expToAdd}经验值`;
        break;
      case 'item_level_up':
        if (!account) return { success: false, message: '账号不存在' };
        const lvUpCurrentLevel = account.account?.profile?.level || 1;
        const lvUpTargetLevel = lvUpCurrentLevel + count;
        let lvUpExp = 0;
        for (let l = lvUpCurrentLevel + 1; l <= lvUpTargetLevel; l++) {
          lvUpExp += this.getExpForLevel(l);
        }
        expToAdd = lvUpExp;
        eventLabel = '等级直升券';
        result.message = `使用成功！等级从${lvUpCurrentLevel}提升到${lvUpTargetLevel}`;
        break;
      case 'item_exp_pack':
        if (!account) return { success: false, message: '账号不存在' };
        // 遍历选中的 count 个实例，累加锁定的经验值
        let lockedTotal = 0;
        const instArr = invStore.items[itemId];
        if (Array.isArray(instArr)) {
          for (let i = 0; i < count && i < instArr.length; i++) {
            lockedTotal += instArr[i]?.lockedExp || 0;
          }
        } else {
          // 老数据（数字形式）：按当前等级换算
          const lv = account.account?.profile?.level || 1;
          lockedTotal = this.getExpForLevel(lv + 1) * count;
        }
        expToAdd = lockedTotal;
        eventLabel = '等级经验包';
        result.message = `使用成功！获得${expToAdd}经验值`;
        break;
      case 'item_reward_exp':
        expToAdd = config.items.effects.expPackage * count;
        eventLabel = '奖励经验包';
        result.message = `使用成功！获得${expToAdd}经验值`;
        break;
      case 'item_undo':
        if (!invStore.undoCount) invStore.undoCount = 0;
        invStore.undoCount += config.items.effects.undoCard * count;
        result.message = `使用成功！获得${config.items.effects.undoCard * count}次悔棋次数`;
        break;
      case 'item_hint':
        if (!invStore.hintCount) invStore.hintCount = 0;
        invStore.hintCount += config.items.effects.hintCard * count;
        result.message = `使用成功！获得${config.items.effects.hintCard * count}次提示次数`;
        break;
      default:
        break;
    }

    // 处理经验添加、星钻奖励、经验记录
    if (expToAdd > 0) {
      if (!account) return { success: false, message: '账号不存在' };
      if (!account.account) account.account = {};
      if (!account.account.profile) account.account.profile = {};

      const oldLevel = account.account.profile.level || 1;
      const oldExp = account.account.profile.exp || 0;
      const newTotalExp = oldExp + expToAdd;

      const { level: calculatedLevel } = this.calculateLevelAndExp(newTotalExp);
      account.account.profile.exp = newTotalExp;
      account.account.profile.level = calculatedLevel;
      const newLevel = calculatedLevel;

      let currencyReward = Math.max(1, Math.floor(expToAdd / config.exp.expToCoinRatio));
      if (currencyReward > 0) {
        await this.addCurrency(userId, currencyReward, `获得${expToAdd}经验值奖励`, 'exp_reward');
      }

      if (newLevel > oldLevel) {
        const levelUpCurrency = (newLevel - oldLevel) * config.exp.levelUpCoinReward;
        await this.addCurrency(userId, levelUpCurrency, `从${oldLevel}级升到${newLevel}级奖励`, 'level_up');
      }
      await this.checkLevelRewards(userId);

      try {
        const expRecords = await this.getExpRecords(userId);
        expRecords.transactions.push({
          id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
          baseExp: expToAdd,
          bonusExp: 0,
          finalExp: expToAdd,
          levelMult: 1,
          source: 'item_use',
          eventLabel: eventLabel,
          oldLevel: oldLevel,
          newLevel: newLevel,
          totalExp: account.account.profile.exp,
          timestamp: Date.now()
        });
        await dataStore.writeOne('expTransactions', userId, expRecords);
      } catch (recErr) {
        logger.warn('记录经验变动失败', { userId, error: recErr.message });
      }

      await this._saveAccount(userId, account);
    }

    // 扣除道具
    this._consumeItem(invStore, itemId, count);

    await this._saveInventoryStore(userId, invStore);

    if (result.success && this.operationLogger) {
      let itemName = itemId;
      if (shopManager) {
        const itemInfo = shopManager.findItem(itemId);
        itemName = itemInfo?.name || itemId;
      }
      const logDetails = {
        message: result.message,
        expGained: expToAdd > 0 ? expToAdd : undefined
      };
      this.operationLogger.getItemUse(userId, account?.account?.nickname || account?.account?.username || '', itemId, itemName, count, logDetails);
    }

    return result;
  }

  // ========== 外观系统 ==========

  /**
   * 获取用户外观
   */
  async getCosmetics(userId) {
    const account = await this._getAccount(userId);
    const cosmetics = account?.cosmetics || {
      slots: 0,
      owned: { frames: [], avatars: [], customAvatars: [], skins: [], backgrounds: [], titles: [] },
      equipped: { frame: null, avatar: null, avatarCustom: null, skin: null, background: null, title: null }
    };
    if (cosmetics.slots === undefined || cosmetics.slots === null) cosmetics.slots = 0;
    if (!cosmetics.owned.avatars) cosmetics.owned.avatars = [];
    if (!cosmetics.owned.customAvatars) cosmetics.owned.customAvatars = [];
    // 确保用户有默认头像和默认头像框
    if (!cosmetics.owned.avatars.includes('avatar_default')) cosmetics.owned.avatars.push('avatar_default');
    if (!cosmetics.owned.frames.includes('frame_default')) cosmetics.owned.frames.push('frame_default');
    // 如果没有装备任何头像，装备默认头像
    if (!cosmetics.equipped.avatar && !cosmetics.equipped.avatarCustom) cosmetics.equipped.avatar = 'avatar_default';
    // 如果没有装备任何头像框，装备默认头像框
    if (!cosmetics.equipped.frame) cosmetics.equipped.frame = 'frame_default';
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
        owned: { frames: [], avatars: [], customAvatars: [], skins: [], backgrounds: [], titles: [] },
        equipped: { frame: null, avatar: null, avatarCustom: null, skin: null, background: null, title: null }
      };
    }
    if (!account.cosmetics.owned.avatars) account.cosmetics.owned.avatars = [];
    if (!account.cosmetics.owned.customAvatars) account.cosmetics.owned.customAvatars = [];

    const categoryMap = {
      frame: 'frames',
      avatar: 'avatars',
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
      account.cosmetics = {
        owned: { frames: [], avatars: [], customAvatars: [], skins: [], backgrounds: [], titles: [] },
        equipped: { frame: null, avatar: null, avatarCustom: null, skin: null, background: null, title: null }
      };
    }
    if (!account.cosmetics.owned.avatars) account.cosmetics.owned.avatars = [];
    if (!account.cosmetics.owned.customAvatars) account.cosmetics.owned.customAvatars = [];

    if (category === 'avatar') {
      if (cosmeticId === 'custom') {
        if (!account.cosmetics.equipped.avatarCustom) {
          return { success: false, message: '请先上传自定义头像' };
        }
        account.cosmetics.equipped.avatar = null;
      } else {
        if (!account.cosmetics.owned.avatars.includes(cosmeticId) && cosmeticId !== 'avatar_default') {
          return { success: false, message: '未拥有该外观' };
        }
        account.cosmetics.equipped.avatarCustom = null;
        account.cosmetics.equipped.avatar = cosmeticId;
      }
    } else if (category === 'avatarCustom') {
      const hasCustom = account.cosmetics.owned.customAvatars.some(a => a.file === cosmeticId);
      if (!hasCustom) {
        return { success: false, message: '该自定义头像不存在' };
      }
      account.cosmetics.equipped.avatar = null;
      account.cosmetics.equipped.avatarCustom = userId + '/' + cosmeticId;
    } else {
      const categoryMap = {
        frame: 'frames',
        avatar: 'avatars',
        skin: 'skins',
        background: 'backgrounds',
        title: 'titles'
      };
      const ownedKey = categoryMap[category];
      if (!ownedKey) {
        return { success: false, message: '类型错误' };
      }
      if (cosmeticId && ownedKey && !account.cosmetics.owned[ownedKey].includes(cosmeticId) && cosmeticId !== 'frame_default') {
        return { success: false, message: '未拥有该外观' };
      }
      account.cosmetics.equipped[category] = cosmeticId || null;
    }

    await this._saveAccount(userId, account);

    if (this.operationLogger) {
      this.operationLogger.getCosmeticEquip(userId, account?.account?.nickname || account?.account?.username || '', category, cosmeticId, cosmeticId || '');
    }

    return { success: true };
  }

  /**
   * 保存自定义头像（base64数据）
   * @param {string} userId - 用户ID
   * @param {string} base64Data - base64图片数据
   * @param {number|string} replaceIndex - 可选，要替换的头像索引或文件名。null=新增
   * @param {string} name - 可选，头像名称
   */
  async saveCustomAvatar(userId, base64Data, replaceIndex = null, name = null) {
    try {
      const account = await this._getAccount(userId);
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      if (!account.cosmetics) {
        account.cosmetics = {
          slots: 0,
          owned: { frames: [], avatars: [], customAvatars: [], skins: [], backgrounds: [], titles: [] },
          equipped: { frame: null, avatar: null, avatarCustom: null, skin: null, background: null, title: null }
        };
      }
      if (!account.cosmetics.owned.customAvatars) account.cosmetics.owned.customAvatars = [];

      const now = Date.now();
      const isVipActive = account.vip?.expireAt > now || account.rank === 'svip' || account.rank === 'admin';
      const defaultSlots = config.avatar.defaultSlots;
      const purchasedSlots = account.cosmetics.slots || 0;
      const vipBonusSlots = isVipActive ? config.avatar.vipBonusSlots : 0;
      const maxAvatars = defaultSlots + purchasedSlots + vipBonusSlots;

      const avatarDir = path.join(__dirname, '..', '..', 'data', 'cosmetics', 'avatars', userId);
      if (!fs.existsSync(avatarDir)) {
        fs.mkdirSync(avatarDir, { recursive: true });
      }

      const mimeMatch = base64Data.match(/^data:image\/(\w+);base64,/);
      const extMap = { png: 'png', gif: 'gif', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', bmp: 'bmp' };
      const ext = mimeMatch && extMap[mimeMatch[1]] ? extMap[mimeMatch[1]] : 'png';

      const existingNames = account.cosmetics.owned.customAvatars.map(a => a.name);
      const getNextDefaultName = () => {
        let n = 1;
        while (existingNames.includes(`自定义头像 ${n}`)) n++;
        return `自定义头像 ${n}`;
      };

      let avatarFile;
      let avatarId;
      let isReplace = false;

      if (replaceIndex !== null && replaceIndex !== undefined && replaceIndex !== '') {
        let targetIdx = -1;
        if (typeof replaceIndex === 'number') {
          targetIdx = replaceIndex;
        } else {
          targetIdx = account.cosmetics.owned.customAvatars.findIndex(a => a.file === replaceIndex);
        }
        if (targetIdx >= 0 && targetIdx < account.cosmetics.owned.customAvatars.length) {
          const oldAvatar = account.cosmetics.owned.customAvatars[targetIdx];
          const oldPath = path.join(avatarDir, oldAvatar.file);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) { }
          }
          avatarId = Date.now().toString();
          avatarFile = avatarId + '.' + ext;
          account.cosmetics.owned.customAvatars[targetIdx] = {
            file: avatarFile,
            name: name || oldAvatar.name || getNextDefaultName(),
            uploadedAt: Date.now()
          };
          isReplace = true;

          if (account.cosmetics.equipped.avatarCustom &&
            account.cosmetics.equipped.avatarCustom.endsWith('/' + oldAvatar.file)) {
            account.cosmetics.equipped.avatarCustom = userId + '/' + avatarFile;
          }
        }
      }

      if (!isReplace) {
        if (account.cosmetics.owned.customAvatars.length >= maxAvatars) {
          return {
            success: false,
            message: `已达到${maxAvatars}个自定义头像上限`,
            needReplace: true,
            currentAvatars: account.cosmetics.owned.customAvatars
          };
        }
        avatarId = Date.now().toString();
        avatarFile = avatarId + '.' + ext;
        account.cosmetics.owned.customAvatars.push({
          file: avatarFile,
          name: name || getNextDefaultName(),
          uploadedAt: Date.now()
        });
      }

      const avatarPath = path.join(avatarDir, avatarFile);
      const base64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      fs.writeFileSync(avatarPath, buffer);

      const originalSizeKB = Math.round(buffer.length / 1024);

      // 如果是 GIF，尝试用 ffmpeg 压缩（根据文件大小动态调整策略）
      if (ext === 'gif') {
        try {
          // 文件过小（<3MB）直接跳过，避免越压越大
          const SIZE_THRESHOLD_SKIP_KB = 3 * 1024;
          if (originalSizeKB < SIZE_THRESHOLD_SKIP_KB) {
            logger.info('GIF 头像较小，跳过压缩', { userId, size: originalSizeKB + 'KB' });
          } else {
            const compressedPath = await this._compressGifWithFfmpeg(avatarPath, originalSizeKB);
            if (compressedPath) {
              const compressedSizeKB = Math.round(fs.statSync(compressedPath).size / 1024);
              const reductionRatio = 1 - compressedSizeKB / originalSizeKB;
              // 只有压缩后至少减小 25% 才替换，否则可能反而变大
              if (reductionRatio >= 0.25) {
                logger.info('GIF 头像已压缩', {
                  userId,
                  original: originalSizeKB + 'KB',
                  compressed: compressedSizeKB + 'KB',
                  saved: Math.round(reductionRatio * 100) + '%'
                });
                fs.copyFileSync(compressedPath, avatarPath);
              } else {
                logger.info('GIF 压缩效果不明显（减小不足25%），保留原始文件', {
                  userId,
                  original: originalSizeKB + 'KB',
                  compressed: compressedSizeKB + 'KB',
                  reduction: Math.round(reductionRatio * 100) + '%'
                });
              }
              try { fs.unlinkSync(compressedPath); } catch (e) { }
            }
          }
        } catch (gifErr) {
          logger.warn('GIF 压缩失败，保留原始文件', { userId, error: gifErr.message });
        }
      }

      account.cosmetics.equipped.avatarCustom = userId + '/' + avatarFile;
      account.cosmetics.equipped.avatar = null;
      await this._saveAccount(userId, account);

      return {
        success: true,
        avatarFile: avatarFile,
        message: '头像上传成功',
        avatars: account.cosmetics.owned.customAvatars,
        equipped: account.cosmetics.equipped.avatarCustom
      };
    } catch (err) {
      logger.error('保存自定义头像失败', { userId, error: err.message });
      return { success: false, message: '头像保存失败' };
    }
  }

  /**
   * 用 ffmpeg 压缩 GIF 动图
   * 根据文件大小动态调整压缩强度，避免越压越大
   * @param {string} inputPath - 原始 GIF 路径
   * @param {number} originalSizeKB - 原始文件大小（KB）
   * @returns {string|null} 压缩后的文件路径，或 null（ffmpeg 不可用）
   */
  async _compressGifWithFfmpeg(inputPath, originalSizeKB) {
    const tmpDir = path.dirname(inputPath);
    const outputPath = path.join(tmpDir, 'tmp_compressed_' + Date.now() + '.gif');

    const ffmpegPath = this._findFfmpeg();
    if (!ffmpegPath) {
      logger.warn('未找到 ffmpeg，跳过 GIF 压缩。如需启用，请安装 ffmpeg 并确保它在 PATH 中');
      return null;
    }

    // 根据文件大小动态调整压缩强度
    let maxSize = 512;      // 最大尺寸
    let fps = 12;           // 帧率
    let maxColors = 128;    // 调色板颜色数

    if (originalSizeKB >= 20 * 1024) {
      // 20MB+：强压缩
      maxSize = 256;
      fps = 8;
      maxColors = 64;
    } else if (originalSizeKB >= 10 * 1024) {
      // 10-20MB：中等偏强压缩
      maxSize = 384;
      fps = 10;
      maxColors = 96;
    } else if (originalSizeKB >= 5 * 1024) {
      // 5-10MB：中等压缩
      maxSize = 448;
      fps = 12;
      maxColors = 128;
    } else {
      // 3-5MB：轻度压缩（主要降帧）
      maxSize = 512;
      fps = 15;
      maxColors = 192;
    }

    const ffmpegConfig = (typeof config !== 'undefined' && config.ffmpeg) || {};
    const timeoutMs = ffmpegConfig.timeout || 30000;

    return new Promise((resolve, reject) => {
      const args = [
        '-i', inputPath,
        '-vf', `fps=${fps},scale=${maxSize}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:diff_mode=rectangle`,
        '-y',
        outputPath
      ];

      execFile(ffmpegPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
        if (err) {
          try { fs.unlinkSync(outputPath); } catch (e) { }
          reject(err);
          return;
        }
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
          try { fs.unlinkSync(outputPath); } catch (e) { }
          reject(new Error('ffmpeg 输出为空'));
          return;
        }
        resolve(outputPath);
      });
    });
  }

  /**
   * 查找 ffmpeg 可执行文件
   * 优先级：config.ffmpeg.path > process.env.FFMPEG_PATH > 系统 PATH > 注册表读取 > 常见安装位置
   */
  _findFfmpeg() {
    if (this._ffmpegPathCache !== undefined) return this._ffmpegPathCache;

    const isWin = process.platform === 'win32';

    // 1. 配置文件显式指定
    try {
      if (typeof config !== 'undefined' && config.ffmpeg && config.ffmpeg.path && fs.existsSync(config.ffmpeg.path)) {
        this._ffmpegPathCache = config.ffmpeg.path;
        return this._ffmpegPathCache;
      }
    } catch (e) { /* config 可能未加载 */ }

    // 2. 环境变量（server.js 启动时已自动注入）
    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
      this._ffmpegPathCache = process.env.FFMPEG_PATH;
      return this._ffmpegPathCache;
    }

    // 3. 当前进程 PATH 中是否已有
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: config.ffmpeg.versionCheckTimeout });
      this._ffmpegPathCache = 'ffmpeg';
      return 'ffmpeg';
    } catch (e) { /* PATH 中找不到 */ }

    // 4. Windows: 从注册表读取系统最新 PATH（绕过进程缓存）
    if (isWin) {
      const { execSync } = require('child_process');
      let freshPathDirs = [];
      try {
        const sysOut = execSync('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path', { encoding: 'utf8', timeout: config.ffmpeg.registryQueryTimeout });
        const sysMatch = sysOut.match(/Path\s+(?:REG_SZ|REG_EXPAND_SZ|REG_MULTI_SZ)\s+([\s\S]+?)(?:\r?\n\r?\n|$)/i);
        if (sysMatch) freshPathDirs.push(...sysMatch[1].trim().split(';').filter(Boolean));
      } catch (e) { /* 继续 */ }
      try {
        const userOut = execSync('reg query "HKCU\\Environment" /v Path', { encoding: 'utf8', timeout: config.ffmpeg.registryQueryTimeout });
        const userMatch = userOut.match(/Path\s+(?:REG_SZ|REG_EXPAND_SZ|REG_MULTI_SZ)\s+([\s\S]+?)(?:\r?\n\r?\n|$)/i);
        if (userMatch) freshPathDirs.push(...userMatch[1].trim().split(';').filter(Boolean));
      } catch (e) { /* 继续 */ }

      for (let dir of freshPathDirs) {
        dir = dir.replace(/%([^%]+)%/g, (m, name) => process.env[name] || m);
        const candidate = path.join(dir, 'ffmpeg.exe');
        if (fs.existsSync(candidate)) {
          this._ffmpegPathCache = candidate;
          return candidate;
        }
      }

      // 5. 常见安装位置兜底（扫描 C:\ D:\ E:\ 等）
      const userProfile = process.env.USERPROFILE || process.env.HOMEPATH || '';
      const commonDirs = [
        path.join(userProfile, 'scoop', 'shims'),
        path.join('C:\\ProgramData', 'scoop', 'shims'),
        'C:\\ProgramData\\chocolatey\\bin',
        'C:\\ffmpeg\\bin',
        'D:\\ffmpeg\\bin',
        'E:\\ffmpeg\\bin',
        'C:\\Program Files\\ffmpeg\\bin',
        'C:\\Program Files (x86)\\ffmpeg\\bin',
        'D:\\Program Files\\ffmpeg\\bin',
      ];
      for (const dir of commonDirs) {
        const candidate = path.join(dir, 'ffmpeg.exe');
        if (fs.existsSync(candidate)) {
          this._ffmpegPathCache = candidate;
          return candidate;
        }
      }
    }

    // 6. Linux/macOS 常见位置
    const nixCandidates = ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/bin/ffmpeg'];
    for (const candidate of nixCandidates) {
      if (fs.existsSync(candidate)) {
        this._ffmpegPathCache = candidate;
        return candidate;
      }
    }

    this._ffmpegPathCache = null;
    return null;
  }

  /**
   * 删除自定义头像
   */
  async deleteCustomAvatar(userId, avatarFile) {
    try {
      const account = await this._getAccount(userId);
      if (!account) {
        return { success: false, message: '账号不存在' };
      }
      if (!account.cosmetics || !account.cosmetics.owned.customAvatars) {
        return { success: false, message: '没有自定义头像' };
      }

      const idx = account.cosmetics.owned.customAvatars.findIndex(a => a.file === avatarFile);
      if (idx < 0) {
        return { success: false, message: '头像不存在' };
      }

      const avatarDir = path.join(__dirname, '..', '..', 'data', 'cosmetics', 'avatars', userId);
      const filePath = path.join(avatarDir, avatarFile);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) { }
      }

      account.cosmetics.owned.customAvatars.splice(idx, 1);

      if (account.cosmetics.equipped.avatarCustom &&
        account.cosmetics.equipped.avatarCustom.endsWith('/' + avatarFile)) {
        if (account.cosmetics.owned.customAvatars.length > 0) {
          account.cosmetics.equipped.avatarCustom = userId + '/' + account.cosmetics.owned.customAvatars[0].file;
        } else {
          account.cosmetics.equipped.avatarCustom = null;
        }
      }

      await this._saveAccount(userId, account);
      return { success: true, message: '删除成功', avatars: account.cosmetics.owned.customAvatars };
    } catch (err) {
      logger.error('删除自定义头像失败', { userId, error: err.message });
      return { success: false, message: '删除失败' };
    }
  }

  /**
   * 重命名自定义头像
   */
  async renameCustomAvatar(userId, avatarFile, newName) {
    try {
      const account = await this._getAccount(userId);
      if (!account) {
        return { success: false, message: '账号不存在' };
      }
      if (!account.cosmetics || !account.cosmetics.owned.customAvatars) {
        return { success: false, message: '没有自定义头像' };
      }

      const idx = account.cosmetics.owned.customAvatars.findIndex(a => a.file === avatarFile);
      if (idx < 0) {
        return { success: false, message: '头像不存在' };
      }

      const trimmedName = (newName || '').toString().trim();
      if (!trimmedName) {
        return { success: false, message: '名称不能为空' };
      }
      if (trimmedName.length > 20) {
        return { success: false, message: '名称不能超过20字' };
      }

      account.cosmetics.owned.customAvatars[idx].name = trimmedName;
      await this._saveAccount(userId, account);
      return { success: true, message: '改名成功', avatars: account.cosmetics.owned.customAvatars };
    } catch (err) {
      logger.error('重命名自定义头像失败', { userId, error: err.message });
      return { success: false, message: '改名失败' };
    }
  }

  /**
   * 获取所有可用的外观配置（供客户端展示）
   */
  getAllCosmeticsConfig() {
    try {
      const data = this._getShopConfig('cosmetics.json');
      if (!data) {
        return { success: false, message: '配置不存在' };
      }
      return { success: true, cosmetics: data };
    } catch (err) {
      logger.error('获取外观配置失败', { error: err.message });
      return { success: false, message: '读取失败' };
    }
  }

  // ========== 会员系统 ==========

  /**
   * 获取用户会员信息
   */
  async getVip(userId) {
    const account = await this._getAccount(userId);
    const vip = account?.vip || { type: null, expireAt: 0, expBonus: 0, lastDailyGift: 0, lastWeeklyGift: 0, lastMonthlyGift: 0, lastDailyGiftDate: '' };

    const now = Date.now();
    const isActive = vip.expireAt > now;

    let discountPercent = 0;
    let expBonus = vip.expBonus || 0;
    if (isActive && vip.type) {
      try {
        const vipConfig = this._getShopConfig('vip.json');
        if (vipConfig) {
          const cfg = vipConfig[vip.type];
          if (cfg) {
            discountPercent = cfg.discountPercent || 0;
            expBonus = Math.max(expBonus, cfg.expBonus || 0);
          }
        }
      } catch (e) { /* 读取失败时用默认值 */ }

      if (discountPercent === 0) {
        if (vip.type === 'vip_year' || vip.type === 'vip_season') discountPercent = 15;
        else discountPercent = 10;
      }

      // 检查并发送每日邮件礼包
      try {
        await this.checkAndSendDailyReward(userId);
      } catch (e) {
        logger.warn('每日礼包发送失败', { userId, error: e.message });
      }
    }

    return {
      success: true,
      vip: {
        ...vip,
        expBonus,
        isActive,
        discountPercent,
        remainingDays: isActive ? Math.ceil((vip.expireAt - now) / (1000 * 60 * 60 * 24)) : 0,
        remainingHours: isActive ? Math.ceil((vip.expireAt - now) / (1000 * 60 * 60)) : 0,
        expireAtFormatted: isActive ? new Date(vip.expireAt).toLocaleString('zh-CN', { hour12: false }) : ''
      }
    };
  }

  /**
   * 检查并发送会员每日邮件礼包（根据VIP等级发放不同奖励）
   * 每天最多发一次，通过日期字符串去重
   */
  async checkAndSendDailyReward(userId) {
    const account = await this._getAccount(userId);
    if (!account || !account.vip) return;

    const vip = account.vip;
    const now = Date.now();
    if (vip.expireAt <= now) return; // 非激活会员不发
    if (!vip.type) return;

    const todayDate = new Date(now);
    const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;
    if (vip.lastDailyGiftDate === today) return; // 今天已发过

    // 读取每日奖励配置
    let vipConfig;
    try {
      vipConfig = this._getShopConfig('vip.json');
      if (!vipConfig) return;
    } catch (e) { return; }

    const cfg = vipConfig[vip.type];
    if (!cfg || !cfg.dailyReward) return;

    const reward = cfg.dailyReward;

    // 发送邮件
    const mailData = {
      title: reward.title || '会员每日礼包',
      content: reward.content || '每日礼包已送达',
      starCoins: reward.starCoins || 0,
      exp: reward.exp || 0,
      from: '会员中心'
    };
    if (Array.isArray(reward.items) && reward.items.length > 0) {
      mailData.items = reward.items;
    }

    // 发送邮件前二次检查最新状态，防止与 batchCheckAndSendDailyRewards 并发导致重复发
    const freshAccount = await this._getAccount(userId);
    if (!freshAccount || !freshAccount.vip) return;
    if (freshAccount.vip.lastDailyGiftDate === today) return; // 已被定时任务发过了

    const sendResult = await this.sendMail(userId, mailData);
    if (!sendResult.success) return;

    // 记录发送日期，确保每天只发一次
    freshAccount.vip.lastDailyGiftDate = today;
    await this._saveAccount(userId, freshAccount);
    logger.info('会员每日礼包已发放', { userId, vipType: freshAccount.vip.type, date: today });
  }

  /**
   * 批量检查并发送所有VIP每日邮件礼包（服务器定时调用，不依赖用户登录）
   * 遍历所有账号，找出VIP在有效期内且今天还没发过礼包的用户，自动发邮件
   */
  async batchCheckAndSendDailyRewards() {
    try {
      const accounts = await dataStore.read('accounts');
      const now = Date.now();
      const todayDate = new Date(now);
      const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`;

      // 读取VIP配置
      let vipConfig;
      try {
        vipConfig = this._getShopConfig('vip.json');
        if (!vipConfig) {
          return { success: true, sent: 0, total: 0, reason: 'vip config not found' };
        }
      } catch (e) {
        return { success: false, sent: 0, total: 0, reason: 'vip config read error' };
      }

      let sentCount = 0;
      let totalVipActive = 0;

      for (const account of accounts) {
        try {
          const vip = account.vip;
          if (!vip || !vip.type) continue;
          if (vip.expireAt <= now) continue;
          totalVipActive++;

          const userId = account.account?.id;
          if (!userId) continue;

          // 发送邮件前重新读取最新账号数据，防止与 checkAndSendDailyReward 并发导致重复发
          const freshAccount = await this._getAccount(userId);
          if (!freshAccount || !freshAccount.vip) continue;
          if (freshAccount.vip.expireAt <= now) continue;
          if (freshAccount.vip.lastDailyGiftDate === today) continue; // 已发过，跳过

          const cfg = vipConfig[freshAccount.vip.type];
          if (!cfg || !cfg.dailyReward) continue;

          const reward = cfg.dailyReward;
          const mailData = {
            title: reward.title || '会员每日礼包',
            content: reward.content || '每日礼包已送达',
            starCoins: reward.starCoins || 0,
            exp: reward.exp || 0,
            from: '会员中心'
          };
          if (Array.isArray(reward.items) && reward.items.length > 0) {
            mailData.items = reward.items;
          }

          const sendResult = await this.sendMail(userId, mailData);
          if (sendResult.success) {
            freshAccount.vip.lastDailyGiftDate = today;
            await this._saveAccount(userId, freshAccount);
            sentCount++;
            logger.info('定时任务-会员每日礼包已发放', { userId, vipType: freshAccount.vip.type, date: today });
          }
        } catch (err) {
          logger.warn('定时任务-单个账号VIP礼包发送失败', { accountId: account.account?.id, error: err.message });
        }
      }

      logger.info('定时任务-VIP每日礼包批量检查完成', { activeVip: totalVipActive, sent: sentCount });
      return { success: true, sent: sentCount, total: totalVipActive };
    } catch (err) {
      logger.error('定时任务-VIP每日礼包批量检查失败', { error: err.message });
      return { success: false, sent: 0, total: 0, reason: err.message };
    }
  }

  /**
   * 统一触发器入口：服务器定时调用，检查所有需要发送的邮件
   * 目前包括：VIP每日礼包
   * 后续可扩展：等级奖励邮件、成就邮件、指定时间邮件等
   */
  async checkAndSendAllTriggers() {
    const results = {};
    results.vipDaily = await this.batchCheckAndSendDailyRewards();
    return results;
  }

  /**
   * 添加自定义头像槽位
   */
  async addAvatarSlots(userId, count) {
    const account = await this._getAccount(userId);
    if (!account) {
      return { success: false, message: '账号不存在' };
    }
    if (!account.cosmetics) {
      account.cosmetics = {
        slots: 0,
        owned: { frames: [], avatars: [], customAvatars: [], skins: [], backgrounds: [], titles: [] },
        equipped: { frame: null, avatar: null, avatarCustom: null, skin: null, background: null, title: null }
      };
    }
    account.cosmetics.slots = (account.cosmetics.slots || 0) + count;
    await this._saveAccount(userId, account);
    return { success: true, message: `成功增加${count}个自定义头像槽位` };
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

    let newType;
    if (days === 7) newType = 'vip_week';
    else if (days === 30) newType = 'vip_month';
    else if (days === 90) newType = 'vip_season';
    else newType = 'vip_year';

    const priority = { vip_week: 1, vip_month: 2, vip_season: 3, vip_year: 4 };
    const currentPriority = priority[account.vip.type] || 0;
    const newPriority = priority[newType] || 0;

    if (newPriority >= currentPriority) {
      account.vip.type = newType;
    }

    account.vip.expBonus = Math.max(account.vip.expBonus || 0, expBonus);

    await this._saveAccount(userId, account);
    return { success: true };
  }

  // ===== 邮件系统 =====

  /**
   * 发送邮件给用户
   */
  async sendMail(userId, mailData) {
    try {
      const account = await this._getAccount(userId);
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      // 从配置文件读取物品/礼包/外观信息，填充 name/icon
      let itemsConfig = {};
      let packsConfig = {};
      let cosmeticsConfig = {};
      let vipConfig = {};

      try {
        itemsConfig = this._getShopConfig('items.json') || {};
        packsConfig = this._getShopConfig('packs.json') || {};
        cosmeticsConfig = this._getShopConfig('cosmetics.json') || {};
        vipConfig = this._getShopConfig('vip.json') || {};
      } catch (e) { /* 忽略配置读取错误 */ }

      // 处理物品列表：填充 name/icon
      const processedItems = [];
      if (Array.isArray(mailData.items) && mailData.items.length > 0) {
        for (const item of mailData.items) {
          const itemConfig = itemsConfig[item.id] || packsConfig[item.id];
          processedItems.push({
            id: item.id,
            count: item.count || 1,
            name: itemConfig?.name || item.name || item.id,
            icon: itemConfig?.icon || '📦',
            category: itemConfig?.category || 'item'
          });
        }
      }

      // 处理外观列表：填充 name/icon
      const processedCosmetics = [];
      if (Array.isArray(mailData.cosmetics) && mailData.cosmetics.length > 0) {
        const catMap = { frame: 'frames', avatar: 'avatars', skin: 'skins', background: 'backgrounds', title: 'titles' };
        for (const cosmetic of mailData.cosmetics) {
          const catKey = catMap[cosmetic.category] || cosmetic.category;
          const cosmeticConfig = cosmeticsConfig[catKey]?.[cosmetic.id] || {};
          processedCosmetics.push({
            id: cosmetic.id,
            category: cosmetic.category,
            name: cosmeticConfig.name || cosmetic.id,
            icon: cosmeticConfig.icon || '🎨'
          });
        }
      }

      // 处理会员信息
      let processedVip = mailData.vip || null;
      if (processedVip) {
        let vipName = `${processedVip.days}天会员`;
        for (const pkg of Object.values(vipConfig)) {
          if (pkg.days === processedVip.days) {
            vipName = pkg.name || vipName;
            break;
          }
        }
        processedVip = { ...processedVip, name: vipName, icon: '💎' };
      }

      const mail = {
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 6),
        title: mailData.title || '系统邮件',
        content: mailData.content || '',
        items: processedItems,
        cosmetics: processedCosmetics,
        vip: processedVip,
        starCoins: mailData.starCoins || 0,
        exp: mailData.exp || 0,
        from: mailData.from || '系统',
        claimed: false,
        read: false,
        createdAt: Date.now()
      };

      const mailStore = await this._getMailStore(userId);
      if (!mailStore.mails) mailStore.mails = [];
      mailStore.mails.unshift(mail);

      // 限制邮件数量，最多保留100封
      if (mailStore.mails.length > 100) {
        mailStore.mails = mailStore.mails.slice(0, 100);
      }

      await this._saveMailStore(userId, mailStore);
      logger.info('发送邮件', { userId, mailId: mail.id, title: mail.title });

      // 通过 socket.io 通知前端有新邮件
      if (this.io) {
        try {
          this.io.to(userId).emit('mail_received', { mail });
          logger.info('已通知前端新邮件', { userId, mailId: mail.id });
        } catch (notifyErr) {
          logger.warn('通知前端新邮件失败', { userId, mailId: mail.id, error: notifyErr.message });
        }
      }

      return { success: true, mail };
    } catch (err) {
      logger.error('发送邮件失败', { userId, error: err.message, stack: err.stack });
      return { success: false, message: '发送邮件失败' };
    }
  }

  /**
   * 批量发送邮件给多个用户
   */
  async sendMailToUsers(userIds, mailData) {
    const results = [];
    for (const userId of userIds) {
      const result = await this.sendMail(userId, mailData);
      results.push({ userId, ...result });
    }
    return { success: true, results, sentCount: results.filter(r => r.success).length };
  }

  /**
   * 给所有用户发送邮件
   */
  async sendMailToAll(mailData) {
    try {
      const accounts = await this.getAllAccounts();
      const userIds = accounts.map(a => a.account?.id).filter(Boolean);
      return await this.sendMailToUsers(userIds, mailData);
    } catch (err) {
      logger.error('群发邮件失败', { error: err.message });
      return { success: false, message: '群发邮件失败' };
    }
  }

  /**
   * 获取用户邮件列表
   */
  async getMails(userId) {
    try {
      const mailStore = await this._getMailStore(userId);
      const mails = mailStore.mails || [];
      const unreadCount = mails.filter(m => !m.read).length;
      const unclaimedCount = mails.filter(m => !m.claimed && ((m.items && m.items.length > 0) || (m.cosmetics && m.cosmetics.length > 0) || m.vip || m.starCoins > 0 || m.exp > 0)).length;
      return { success: true, mails, unreadCount, unclaimedCount };
    } catch (err) {
      logger.error('获取邮件失败', { userId, error: err.message });
      return { success: false, message: '获取邮件失败' };
    }
  }

  /**
   * 领取单封邮件奖励
   */
  async claimMail(userId, mailId) {
    try {
      const account = await this._getAccount(userId);
      if (!account) {
        return { success: false, message: '账号不存在' };
      }
      const mailStore = await this._getMailStore(userId);
      if (!mailStore.mails || mailStore.mails.length === 0) {
        return { success: false, message: '没有邮件' };
      }

      const mailIndex = mailStore.mails.findIndex(m => m.id === mailId);
      if (mailIndex < 0) {
        return { success: false, message: '邮件不存在' };
      }

      const mail = mailStore.mails[mailIndex];
      if (mail.claimed) {
        return { success: false, message: '该邮件已领取' };
      }

      const rewards = { items: [], cosmetics: [], vip: null, starCoins: 0, exp: 0, slots: 0 };

      // 发放物品和礼包（使用独立背包存储）
      if (mail.items && mail.items.length > 0) {
        const invStore = await this._getInventoryStore(userId);
        if (!invStore.items) invStore.items = {};
        for (const item of mail.items) {
          invStore.items[item.id] = (invStore.items[item.id] || 0) + item.count;
          rewards.items.push(item);
        }
        await this._saveInventoryStore(userId, invStore);
      }

      // 发放外观
      if (mail.cosmetics && mail.cosmetics.length > 0) {
        if (!account.cosmetics) {
          account.cosmetics = {
            slots: 0,
            owned: { frames: [], avatars: [], customAvatars: [], skins: [], backgrounds: [], titles: [] },
            equipped: { frame: null, avatar: null, avatarCustom: null, skin: null, background: null, title: null }
          };
        }
        if (!account.cosmetics.owned.avatars) account.cosmetics.owned.avatars = [];
        const categoryMap = { frame: 'frames', avatar: 'avatars', skin: 'skins', background: 'backgrounds', title: 'titles' };
        for (const cosmetic of mail.cosmetics) {
          const ownedKey = categoryMap[cosmetic.category];
          if (ownedKey && !account.cosmetics.owned[ownedKey].includes(cosmetic.id)) {
            account.cosmetics.owned[ownedKey].push(cosmetic.id);
            rewards.cosmetics.push(cosmetic);
          }
        }
      }

      // 发放头像槽位
      if (mail.slots && mail.slots > 0) {
        if (!account.cosmetics) {
          account.cosmetics = {
            slots: 0,
            owned: { frames: [], avatars: [], customAvatars: [], skins: [], backgrounds: [], titles: [] },
            equipped: { frame: null, avatar: null, avatarCustom: null, skin: null, background: null, title: null }
          };
        }
        account.cosmetics.slots = (account.cosmetics.slots || 0) + mail.slots;
        rewards.slots = mail.slots;
      }

      // 发放会员
      if (mail.vip && mail.vip.days > 0) {
        if (!account.vip) {
          account.vip = { type: null, expireAt: 0, expBonus: 0, lastDailyGift: 0, lastWeeklyGift: 0, lastMonthlyGift: 0 };
        }
        const now = Date.now();
        if (account.vip.expireAt > now) {
          account.vip.expireAt += mail.vip.days * 24 * 60 * 60 * 1000;
        } else {
          account.vip.expireAt = now + mail.vip.days * 24 * 60 * 60 * 1000;
        }
        account.vip.type = `vip_${mail.vip.days === 7 ? 'week' : mail.vip.days === 30 ? 'month' : 'year'}`;
        account.vip.expBonus = Math.max(account.vip.expBonus || 0, mail.vip.expBonus || 0);
        rewards.vip = mail.vip;
      }

      // 发放星钻
      if (mail.starCoins && mail.starCoins > 0) {
        if (!account.currency) account.currency = { starCoins: 0 };
        account.currency.starCoins = (account.currency.starCoins || 0) + mail.starCoins;
        rewards.starCoins = mail.starCoins;

        // 添加星钻交易记录（独立文件）
        try {
          const transactionRecords = await this.getTransactionRecords(userId);
          transactionRecords.transactions.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
            type: 'earn',
            amount: mail.starCoins,
            balance: account.currency.starCoins,
            source: 'mail_reward',
            reason: mail.title + ' - 邮件奖励',
            timestamp: Date.now()
          });
          await dataStore.writeOne('currencyTransactions', userId, transactionRecords);
        } catch (recErr) {
          logger.warn('记录邮件星钻奖励失败', { userId, error: recErr.message });
        }
      }

      // 发放经验
      if (mail.exp && mail.exp > 0) {
        if (!account.account) account.account = {};
        if (!account.account.profile) account.account.profile = { exp: 0 };
        const oldExp = account.account.profile.exp || 0;
        const oldLevel = account.account.profile.level || 1;
        const newExp = oldExp + mail.exp;
        const { level: newLevel } = this.calculateLevelAndExp(newExp);
        account.account.profile.exp = newExp;
        account.account.profile.level = newLevel;
        rewards.exp = mail.exp;

        // 添加经验交易记录（独立文件）
        try {
          const expRecords = await this.getExpRecords(userId);
          expRecords.transactions.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
            baseExp: mail.exp,
            bonusExp: 0,
            finalExp: mail.exp,
            levelMult: 1,
            source: 'mail_reward',
            eventLabel: '邮件奖励',
            oldLevel,
            newLevel,
            totalExp: newExp,
            reason: mail.title,
            timestamp: Date.now()
          });
          await dataStore.writeOne('expTransactions', userId, expRecords);
        } catch (recErr) {
          logger.warn('记录邮件经验奖励失败', { userId, error: recErr.message });
        }
      }

      // 标记邮件为已领取（使用独立邮件存储）
      mailStore.mails[mailIndex].claimed = true;
      mailStore.mails[mailIndex].read = true;
      mailStore.mails[mailIndex].claimedAt = Date.now();
      if (account.account) account.account.updatedAt = Date.now();

      await this._saveMailStore(userId, mailStore);
      await this._saveAccount(userId, account);
      logger.info('领取邮件奖励', { userId, mailId, rewards });
      return { success: true, rewards, message: '领取成功' };
    } catch (err) {
      logger.error('领取邮件失败', { userId, mailId, error: err.message });
      return { success: false, message: '领取失败' };
    }
  }

  /**
   * 一键领取所有未领取邮件
   */
  async claimAllMails(userId) {
    try {
      const account = await this._getAccount(userId);
      if (!account) {
        return { success: false, message: '账号不存在' };
      }
      const mailStore = await this._getMailStore(userId);
      if (!mailStore.mails || mailStore.mails.length === 0) {
        return { success: true, claimedCount: 0, rewards: { items: [], cosmetics: [], vip: null, starCoins: 0, exp: 0 } };
      }

      const totalRewards = { items: [], cosmetics: [], vip: null, starCoins: 0, exp: 0 };
      const itemMap = new Map();
      const cosmeticSet = new Set();
      let vipDaysToAdd = 0;
      let vipMaxExpBonus = 0;
      let claimedCount = 0;
      let starCoinsToAdd = 0;
      let expToAdd = 0;

      for (let i = 0; i < mailStore.mails.length; i++) {
        const mail = mailStore.mails[i];
        if (mail.claimed) continue;

        const hasReward = (mail.items && mail.items.length > 0) || (mail.cosmetics && mail.cosmetics.length > 0) || mail.vip || mail.starCoins > 0 || mail.exp > 0;
        if (!hasReward) {
          mailStore.mails[i].read = true;
          continue;
        }

        if (mail.items && mail.items.length > 0) {
          for (const item of mail.items) {
            const current = itemMap.get(item.id) || 0;
            itemMap.set(item.id, current + item.count);
          }
        }

        if (mail.cosmetics && mail.cosmetics.length > 0) {
          for (const cosmetic of mail.cosmetics) {
            const key = `${cosmetic.category}:${cosmetic.id}`;
            if (!cosmeticSet.has(key)) {
              cosmeticSet.add(key);
            }
          }
        }

        if (mail.vip && mail.vip.days > 0) {
          vipDaysToAdd += mail.vip.days;
          vipMaxExpBonus = Math.max(vipMaxExpBonus, mail.vip.expBonus || 0);
        }

        if (mail.starCoins && mail.starCoins > 0) {
          starCoinsToAdd += mail.starCoins;
        }

        if (mail.exp && mail.exp > 0) {
          expToAdd += mail.exp;
        }

        mailStore.mails[i].claimed = true;
        mailStore.mails[i].read = true;
        mailStore.mails[i].claimedAt = Date.now();
        claimedCount++;
      }

      // 应用物品奖励（使用独立背包存储）
      if (itemMap.size > 0) {
        const invStore = await this._getInventoryStore(userId);
        if (!invStore.items) invStore.items = {};
        for (const [itemId, count] of itemMap.entries()) {
          invStore.items[itemId] = (invStore.items[itemId] || 0) + count;
          totalRewards.items.push({ id: itemId, count });
        }
        await this._saveInventoryStore(userId, invStore);
      }

      // 应用外观奖励
      if (cosmeticSet.size > 0) {
        if (!account.cosmetics) {
          account.cosmetics = {
            owned: { frames: [], skins: [], backgrounds: [], titles: [] },
            equipped: { frame: null, skin: null, background: null, title: null }
          };
        }
        const categoryMap = { frame: 'frames', skin: 'skins', background: 'backgrounds', title: 'titles' };
        for (const key of cosmeticSet) {
          const [category, id] = key.split(':');
          const ownedKey = categoryMap[category];
          if (ownedKey && !account.cosmetics.owned[ownedKey].includes(id)) {
            account.cosmetics.owned[ownedKey].push(id);
            totalRewards.cosmetics.push({ category, id });
          }
        }
      }

      // 应用会员奖励
      if (vipDaysToAdd > 0) {
        if (!account.vip) {
          account.vip = { type: null, expireAt: 0, expBonus: 0, lastDailyGift: 0, lastWeeklyGift: 0, lastMonthlyGift: 0 };
        }
        const now = Date.now();
        if (account.vip.expireAt > now) {
          account.vip.expireAt += vipDaysToAdd * 24 * 60 * 60 * 1000;
        } else {
          account.vip.expireAt = now + vipDaysToAdd * 24 * 60 * 60 * 1000;
        }
        account.vip.type = `vip_${vipDaysToAdd === 7 ? 'week' : vipDaysToAdd === 30 ? 'month' : 'year'}`;
        account.vip.expBonus = Math.max(account.vip.expBonus || 0, vipMaxExpBonus);
        totalRewards.vip = { days: vipDaysToAdd, expBonus: vipMaxExpBonus };
      }

      // 应用星钻奖励
      if (starCoinsToAdd > 0) {
        if (!account.currency) account.currency = { starCoins: 0 };
        account.currency.starCoins = (account.currency.starCoins || 0) + starCoinsToAdd;
        totalRewards.starCoins = starCoinsToAdd;

        try {
          const transactionRecords = await this.getTransactionRecords(userId);
          transactionRecords.transactions.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
            type: 'earn',
            amount: starCoinsToAdd,
            balance: account.currency.starCoins,
            source: 'mail_reward_batch',
            reason: '邮件奖励（批量）',
            timestamp: Date.now()
          });
          await dataStore.writeOne('currencyTransactions', userId, transactionRecords);
        } catch (recErr) {
          logger.warn('记录批量邮件星钻奖励失败', { userId, error: recErr.message });
        }
      }

      // 应用经验奖励
      if (expToAdd > 0) {
        if (!account.account) account.account = {};
        if (!account.account.profile) account.account.profile = { exp: 0 };
        const oldExp = account.account.profile.exp || 0;
        const oldLevel = account.account.profile.level || 1;
        const newExp = oldExp + expToAdd;
        const { level: newLevel } = this.calculateLevelAndExp(newExp);
        account.account.profile.exp = newExp;
        account.account.profile.level = newLevel;
        totalRewards.exp = expToAdd;

        try {
          const expRecords = await this.getExpRecords(userId);
          expRecords.transactions.push({
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, config.security.randomIdSuffixLength),
            baseExp: expToAdd,
            bonusExp: 0,
            finalExp: expToAdd,
            levelMult: 1,
            source: 'mail_reward',
            eventLabel: '邮件奖励',
            oldLevel,
            newLevel,
            totalExp: newExp,
            reason: '批量领取邮件奖励',
            timestamp: Date.now()
          });
          await dataStore.writeOne('expTransactions', userId, expRecords);
        } catch (recErr) {
          logger.warn('记录批量邮件经验奖励失败', { userId, error: recErr.message });
        }
      }

      await this._saveMailStore(userId, mailStore);
      await this._saveAccount(userId, account);
      logger.info('批量领取邮件', { userId, claimedCount, totalRewards });
      return { success: true, claimedCount, rewards: totalRewards };
    } catch (err) {
      logger.error('批量领取邮件失败', { userId, error: err.message });
      return { success: false, message: '批量领取失败' };
    }
  }

  /**
   * 标记邮件为已读
   */
  async readMail(userId, mailId) {
    try {
      const mailStore = await this._getMailStore(userId);
      if (!mailStore.mails || mailStore.mails.length === 0) {
        return { success: false, message: '没有邮件' };
      }

      const mail = mailStore.mails.find(m => m.id === mailId);
      if (!mail) {
        return { success: false, message: '邮件不存在' };
      }

      mail.read = true;
      await this._saveMailStore(userId, mailStore);
      return { success: true };
    } catch (err) {
      logger.error('标记邮件已读失败', { userId, mailId, error: err.message });
      return { success: false, message: '操作失败' };
    }
  }

  /**
   * 标记所有邮件为已读
   */
  async readAllMails(userId) {
    try {
      const mailStore = await this._getMailStore(userId);
      if (!mailStore.mails || mailStore.mails.length === 0) {
        return { success: true, readCount: 0 };
      }

      let count = 0;
      for (const mail of mailStore.mails) {
        if (!mail.read) {
          mail.read = true;
          count++;
        }
      }

      await this._saveMailStore(userId, mailStore);
      return { success: true, readCount: count };
    } catch (err) {
      logger.error('批量标记已读失败', { userId, error: err.message });
      return { success: false, message: '操作失败' };
    }
  }

  /**
   * 删除单封邮件
   */
  async deleteMail(userId, mailId) {
    try {
      const mailStore = await this._getMailStore(userId);
      if (!mailStore.mails || mailStore.mails.length === 0) {
        return { success: true, deleted: 0 };
      }

      const beforeLen = mailStore.mails.length;
      mailStore.mails = mailStore.mails.filter(m => m.id !== mailId);
      const deleted = beforeLen - mailStore.mails.length;

      await this._saveMailStore(userId, mailStore);
      return { success: true, deleted };
    } catch (err) {
      logger.error('删除邮件失败', { userId, mailId, error: err.message });
      return { success: false, message: '删除失败' };
    }
  }

  /**
   * 删除所有已领取的邮件
   */
  async deleteClaimedMails(userId) {
    try {
      const mailStore = await this._getMailStore(userId);
      if (!mailStore.mails || mailStore.mails.length === 0) {
        return { success: true, deleted: 0 };
      }

      const beforeLen = mailStore.mails.length;
      mailStore.mails = mailStore.mails.filter(m => !m.claimed);
      const deleted = beforeLen - mailStore.mails.length;

      await this._saveMailStore(userId, mailStore);
      return { success: true, deleted };
    } catch (err) {
      logger.error('清理已领取邮件失败', { userId, error: err.message });
      return { success: false, message: '清理失败' };
    }
  }

  /**
   * 给用户直接发放星钻（不走邮件系统）
   */
  async grantStarCoins(userId, amount, reason = '管理员发放') {
    if (!Number.isInteger(amount) || amount <= 0) {
      return { success: false, message: '星钻数量必须是正整数' };
    }
    const result = await this.addCurrency(userId, amount, reason, 'admin_grant');
    if (result.success) {
      // 发送邮件记录
      await this.sendMail(userId, {
        title: '星钻发放通知',
        content: `${reason}\n\n已成功发放 ${amount} 星钻到您的账户。`,
        starCoins: 0,
        exp: 0,
        from: '系统'
      });
    }
    return result;
  }

  /**
   * 给用户直接发放经验（不走邮件系统）
   */
  async grantExp(userId, amount, reason = '管理员发放') {
    if (!Number.isInteger(amount) || amount <= 0) {
      return { success: false, message: '经验值数量必须是正整数' };
    }
    const result = await this.modifyUserExp(userId, 'add', amount);
    if (result.success) {
      // 发送邮件记录
      await this.sendMail(userId, {
        title: '经验值发放通知',
        content: `${reason}\n\n已成功发放 ${amount} 点经验值到您的账户。`,
        starCoins: 0,
        exp: 0,
        from: '系统'
      });
    }
    return result;
  }

  /**
   * 给用户直接发放物品（不走邮件系统）
   */
  async grantItems(userId, items) {
    try {
      if (!Array.isArray(items) || items.length === 0) {
        return { success: false, message: '物品列表不能为空' };
      }
      const account = await this._getAccount(userId);
      if (!account) {
        return { success: false, message: '账号不存在' };
      }
      const invStore = await this._getInventoryStore(userId);
      if (!invStore.items) invStore.items = {};

      let itemsConfig = {};
      let packsConfig = {};
      try {
        itemsConfig = this._getShopConfig('items.json') || {};
        packsConfig = this._getShopConfig('packs.json') || {};
      } catch (e) { /* 忽略 */ }

      for (const item of items) {
        if (!item.id || !item.count) continue;
        invStore.items[item.id] = (invStore.items[item.id] || 0) + item.count;
      }

      await this._saveInventoryStore(userId, invStore);
      logger.info('管理员发放物品', { userId, items });

      const itemDescriptions = items.map(i => {
        const conf = itemsConfig[i.id] || packsConfig[i.id] || {};
        return `${conf.icon || '📦'} ${conf.name || i.id} ×${i.count}`;
      }).join('\n');
      await this.sendMail(userId, {
        title: '物品发放通知',
        content: `管理员发放物品到您的账户。\n\n发放的物品：\n${itemDescriptions}`,
        starCoins: 0,
        exp: 0,
        from: '系统'
      });

      return { success: true, granted: items };
    } catch (err) {
      logger.error('发放物品失败', { userId, error: err.message, stack: err.stack });
      return { success: false, message: '发放失败' };
    }
  }
}

module.exports = AccountManager;
