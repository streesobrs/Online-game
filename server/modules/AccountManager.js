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
        chess: {
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
          chess: {
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
        chess: {
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

      // 检查是否是夜间游戏
      const hour = new Date().getHours();
      if (hour >= 22 || hour <= 6) {
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

  // 添加经验值
  async addExp(id, exp) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return { success: false, message: '账号不存在' };
      }

      // 获取当前总经验值
      const currentExp = account.account?.profile?.exp || 0;
      const newTotalExp = currentExp + exp;

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
      logger.info('添加经验值', { id, addedExp: exp, currentExp, newTotalExp, newLevel: level });

      return { success: true, level, exp: currentLevelExp, totalExp: newTotalExp };
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

      const achievements = account.achievements || [];
      if (achievements.some(ach => ach.id === achievementId)) {
        return {
          success: false,
          message: '该成就已解锁'
        };
      }

      achievements.push({ id: achievementId, unlockedAt: Date.now() });
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

      const achievements = account.achievements || [];
      const index = achievements.findIndex(ach => ach.id === achievementId);
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

  // 管理员重置用户成就
  async resetUserAchievements(id) {
    try {
      const account = await dataStore.findOne('accounts', { 'account.id': id });
      if (!account) {
        return {
          success: false,
          message: '账号不存在'
        };
      }

      await dataStore.update('accounts', { 'account.id': id }, { achievements: [], 'account.updatedAt': Date.now() });
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
