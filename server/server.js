const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

// 加载配置
const config = require('./config');
const logger = require('./utils/logger');

// 加载模块
const UserManager = require('./modules/UserManager');
const GameManager = require('./modules/GameManager');
const AdminManager = require('./modules/AdminManager');
const ChatManager = require('./modules/ChatManager');
const VersionManager = require('./modules/VersionManager');
const AccountManager = require('./modules/AccountManager');
const AchievementManager = require('./modules/AchievementManager');
const AIManager = require('./modules/AIManager');
const ThemeManager = require('./modules/ThemeManager');

// 初始化Express应用
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 120000,
  pingInterval: 30000,
  transports: ['websocket', 'polling'],
  upgradeTimeout: 10000,
  maxHttpBufferSize: 1e6,
  // 认证中间件
  allowRequest: (req, callback) => {
    const token = req._query.token || (req.headers.authorization?.replace('Bearer ', ''));
    // 不需要认证，允许所有连接
    callback(null, true);
  }
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Token认证中间件
function authenticateToken(req, res, next) {
  // 从请求头获取token
  const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, message: '缺少认证Token' });
  }

  // 验证token是否与配置中的adminToken匹配
  if (token !== config.adminToken) {
    return res.status(401).json({ success: false, message: '无效的认证Token' });
  }

  next();
}

// 静态文件服务
app.use(express.static(path.join(__dirname, '..')));

// API路由
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'docs.html'));
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    uptime: Date.now() - serverStartTime
  });
});

// 系统状态API
app.get('/api/status', (req, res) => {
  res.json({
    onlineUsers: userManager.getOnlineCount(),
    waitingUsers: userManager.getWaitingCount(),
    playingUsers: userManager.getPlayingCount(),
    totalConnections: userManager.getSystemStats().totalConnections,
    peakOnline: userManager.getSystemStats().peakOnline,
    timestamp: Date.now()
  });
});

// 版本信息API
app.get('/version', (req, res) => {
  const versionStr = versionManager.getServerVersion();
  const parts = versionStr.split('.').map(Number);
  res.json({
    version: `${parts[0]}.${parts[1]}.${parts[2]}`,
    build: parts[3],
    timestamp: Date.now()
  });
});

// 认证验证API
app.post('/api/auth/verify', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.json({ success: false, message: '缺少Token' });
  }

  // 验证token是否与配置中的adminToken匹配
  if (token === config.adminToken) {
    res.json({ success: true, message: 'Token有效' });
  } else {
    res.json({ success: false, message: 'Token无效' });
  }
});

// 排行榜API
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const gameType = req.query.gameType || null;
    const leaderboard = await userManager.getLeaderboard(limit, gameType);
    res.json({ success: true, data: leaderboard });
  } catch (err) {
    logger.error('获取排行榜API错误', { error: err.message });
    res.status(500).json({ success: false, message: '获取排行榜失败' });
  }
});

// 可观战游戏列表API
app.get('/api/spectate/games', (req, res) => {
  res.json({
    success: true,
    data: gameManager.getSpectatableGames()
  });
});

// ========== 主题相关API ==========

// 获取所有主题
app.get('/api/themes', (req, res) => {
  try {
    const themes = themeManager.getAllThemes();
    res.json({
      success: true,
      data: themes
    });
  } catch (err) {
    logger.error('获取主题列表失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取主题列表失败'
    });
  }
});

// 获取单个主题
app.get('/api/themes/:id', (req, res) => {
  try {
    const theme = themeManager.getTheme(req.params.id);
    if (!theme) {
      return res.status(404).json({
        success: false,
        message: '主题不存在'
      });
    }
    res.json({
      success: true,
      data: theme
    });
  } catch (err) {
    logger.error('获取主题失败', { id: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      message: '获取主题失败'
    });
  }
});

// 添加主题（仅管理员）
app.post('/api/themes', authenticateToken, async (req, res) => {
  try {
    const result = await themeManager.addTheme(req.body);
    res.json(result);
  } catch (err) {
    logger.error('添加主题失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '添加主题失败'
    });
  }
});

// 更新主题（仅管理员）
app.put('/api/themes/:id', authenticateToken, async (req, res) => {
  try {
    const result = await themeManager.updateTheme(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    logger.error('更新主题失败', { id: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      message: '更新主题失败'
    });
  }
});

// 删除主题（仅管理员）
app.delete('/api/themes/:id', authenticateToken, async (req, res) => {
  try {
    const result = await themeManager.deleteTheme(req.params.id);
    res.json(result);
  } catch (err) {
    logger.error('删除主题失败', { id: req.params.id, error: err.message });
    res.status(500).json({
      success: false,
      message: '删除主题失败'
    });
  }
});

// 重新加载主题（仅管理员）
app.post('/api/themes/reload', authenticateToken, async (req, res) => {
  try {
    const result = await themeManager.reloadThemes();
    res.json(result);
  } catch (err) {
    logger.error('重新加载主题失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '重新加载主题失败'
    });
  }
});

// ========== 账号管理API ==========

// 获取所有账号列表（需要认证）
app.get('/api/accounts', authenticateToken, async (req, res) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const accounts = await accountManager.getAllAccounts(parseInt(limit), parseInt(offset));
    res.json({
      success: true,
      data: accounts,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (err) {
    logger.error('获取账号列表失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取账号列表失败'
    });
  }
});

// 搜索账号（需要认证）
app.get('/api/accounts/search', authenticateToken, async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.status(400).json({
        success: false,
        message: '请提供搜索关键词'
      });
    }
    const accounts = await accountManager.getAllAccounts(100, 0);
    const filtered = accounts.filter(a => 
      a.username?.toLowerCase().includes(keyword.toLowerCase()) ||
      a.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
      a.id?.toLowerCase().includes(keyword.toLowerCase())
    );
    res.json({
      success: true,
      data: filtered,
      count: filtered.length
    });
  } catch (err) {
    logger.error('搜索账号失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '搜索账号失败'
    });
  }
});

// 获取单个账号详情（需要认证）
app.get('/api/accounts/:id', authenticateToken, async (req, res) => {
  try {
    const account = await accountManager.getAccount(req.params.id);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: '账号不存在'
      });
    }
    res.json({
      success: true,
      data: account
    });
  } catch (err) {
    logger.error('获取账号详情失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取账号详情失败'
    });
  }
});

// 修改用户经验值（需要认证）
app.put('/api/accounts/:id/exp', authenticateToken, async (req, res) => {
  try {
    const { operation, amount } = req.body;
    if (!operation || amount === undefined) {
      return res.status(400).json({
        success: false,
        message: '请提供操作类型和数量'
      });
    }
    const result = await accountManager.modifyUserExp(req.params.id, operation, parseInt(amount));
    res.json(result);
  } catch (err) {
    logger.error('修改用户经验失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '修改用户经验失败'
    });
  }
});

// ========== 游戏相关API ==========

// 获取游戏历史记录
app.get('/api/games/history', async (req, res) => {
  try {
    const { userId, limit = 20, offset = 0 } = req.query;
    const history = await gameManager.getGameHistory(userId, parseInt(limit));
    res.json({
      success: true,
      data: history,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });
  } catch (err) {
    logger.error('获取游戏历史失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取游戏历史失败'
    });
  }
});

// 获取游戏回放
app.get('/api/games/replay/:id', async (req, res) => {
  try {
    const replay = await gameManager.getGameReplay(req.params.id);
    if (!replay) {
      return res.status(404).json({
        success: false,
        message: '游戏回放不存在'
      });
    }
    res.json({
      success: true,
      data: replay
    });
  } catch (err) {
    logger.error('获取游戏回放失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取游戏回放失败'
    });
  }
});

// 获取游戏统计数据
app.get('/api/games/stats', async (req, res) => {
  try {
    const stats = {
      activeGames: gameManager.getActiveGameCount?.() || 0,
      onlineUsers: userManager.getOnlineCount?.() || 0,
      timestamp: Date.now()
    };
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    logger.error('获取游戏统计失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取游戏统计失败'
    });
  }
});

// ========== 用户相关API ==========

// 获取当前在线用户列表
app.get('/api/users/online', async (req, res) => {
  try {
    const users = userManager.getOnlineUsers?.() || [];
    const onlineUsers = users.map(u => ({
      userId: u.userId,
      nickname: u.nickname,
      loginType: u.loginType,
      gameType: u.gameType,
      status: u.status
    }));
    res.json({
      success: true,
      data: onlineUsers,
      count: onlineUsers.length
    });
  } catch (err) {
    logger.error('获取在线用户失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取在线用户失败'
    });
  }
});

// 搜索用户
app.get('/api/users/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.status(400).json({
        success: false,
        message: '请提供搜索关键词'
      });
    }
    const accounts = await accountManager.getAllAccounts(100, 0);
    const filtered = accounts.filter(a => 
      a.username?.toLowerCase().includes(keyword.toLowerCase()) ||
      a.nickname?.toLowerCase().includes(keyword.toLowerCase()) ||
      a.id?.toLowerCase().includes(keyword.toLowerCase())
    );
    res.json({
      success: true,
      data: filtered,
      count: filtered.length
    });
  } catch (err) {
    logger.error('搜索用户失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '搜索用户失败'
    });
  }
});

// ========== 聊天相关API ==========

// 获取聊天历史
app.get('/api/chat/history', async (req, res) => {
  try {
    const { scope = 'global', gameId } = req.query;
    const history = chatManager.getChatHistory?.(scope, gameId) || [];
    res.json({
      success: true,
      data: history,
      scope: scope,
      gameId: gameId
    });
  } catch (err) {
    logger.error('获取聊天历史失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取聊天历史失败'
    });
  }
});

// 广播系统消息（需要认证）
app.post('/api/chat/broadcast', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({
        success: false,
        message: '请提供广播消息内容'
      });
    }
    io.emit('broadcast', {
      type: 'system',
      message: message,
      timestamp: Date.now()
    });
    res.json({
      success: true,
      message: '广播发送成功'
    });
  } catch (err) {
    logger.error('广播消息失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '广播消息失败'
    });
  }
});

// ========== 系统管理API ==========

// 获取系统日志（需要认证）
app.get('/api/system/logs', authenticateToken, async (req, res) => {
  try {
    const { type, limit = 100 } = req.query;
    const logs = logger.getLogs?.(type, parseInt(limit)) || [];
    res.json({
      success: true,
      data: logs,
      count: logs.length
    });
  } catch (err) {
    logger.error('获取系统日志失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取系统日志失败'
    });
  }
});

// 设置维护模式（需要认证）
app.post('/api/system/maintenance', authenticateToken, async (req, res) => {
  try {
    const { enabled, message } = req.body;
    io.emit('maintenance_mode', {
      enabled: enabled,
      message: message || '服务器正在维护中',
      timestamp: Date.now()
    });
    res.json({
      success: true,
      message: enabled ? '服务器已进入维护模式' : '服务器已退出维护模式'
    });
  } catch (err) {
    logger.error('设置维护模式失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '设置维护模式失败'
    });
  }
});

// 获取详细系统统计（需要认证）
app.get('/api/system/stats', authenticateToken, async (req, res) => {
  try {
    const stats = {
      onlineUsers: userManager.getOnlineCount?.() || 0,
      waitingUsers: userManager.getWaitingCount?.() || 0,
      playingUsers: userManager.getPlayingCount?.() || 0,
      totalAccounts: (await accountManager.getAllAccounts(1, 0)).length,
      system: userManager.getSystemStats?.() || {},
      timestamp: Date.now()
    };
    res.json({
      success: true,
      data: stats
    });
  } catch (err) {
    logger.error('获取系统统计失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取系统统计失败'
    });
  }
});

// ========== 成就相关API ==========

// 获取所有成就列表
app.get('/api/achievements', async (req, res) => {
  try {
    const achievements = achievementManager?.getAllAchievements?.() || [];
    res.json({
      success: true,
      data: achievements,
      count: achievements.length
    });
  } catch (err) {
    logger.error('获取成就列表失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取成就列表失败'
    });
  }
});

// 获取单个成就详情
app.get('/api/achievements/:id', async (req, res) => {
  try {
    const achievement = achievementManager?.getAchievement?.(req.params.id) || null;
    if (!achievement) {
      return res.status(404).json({
        success: false,
        message: '成就不存在'
      });
    }
    res.json({
      success: true,
      data: achievement
    });
  } catch (err) {
    logger.error('获取成就详情失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取成就详情失败'
    });
  }
});

// 添加用户成就（需要认证）
app.post('/api/achievements/:id/award', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: '请提供用户ID'
      });
    }
    const result = await accountManager.addUserAchievement(userId, req.params.id);
    res.json(result);
  } catch (err) {
    logger.error('添加用户成就失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '添加用户成就失败'
    });
  }
});

// ========== 排行榜API扩展 ==========

// 按游戏类型获取排行榜
app.get('/api/leaderboard/games', async (req, res) => {
  try {
    const { type = 'all', limit = 20 } = req.query;
    const leaderboard = await userManager.getLeaderboard(parseInt(limit), type);
    res.json({
      success: true,
      data: leaderboard,
      gameType: type
    });
  } catch (err) {
    logger.error('获取游戏排行榜失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取游戏排行榜失败'
    });
  }
});

// 获取每日排行榜
app.get('/api/leaderboard/daily', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const leaderboard = await userManager.getLeaderboard(parseInt(limit), 'all');
    res.json({
      success: true,
      data: leaderboard,
      period: 'daily'
    });
  } catch (err) {
    logger.error('获取每日排行榜失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取每日排行榜失败'
    });
  }
});

// 获取周排行榜
app.get('/api/leaderboard/weekly', async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const leaderboard = await userManager.getLeaderboard(parseInt(limit), 'all');
    res.json({
      success: true,
      data: leaderboard,
      period: 'weekly'
    });
  } catch (err) {
    logger.error('获取周排行榜失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取周排行榜失败'
    });
  }
});

// 初始化管理器
const versionManager = new VersionManager();
const accountManager = new AccountManager();
const achievementManager = new AchievementManager(accountManager);
const aiManager = new AIManager();
const userManager = new UserManager(accountManager);
const gameManager = new GameManager(userManager, accountManager, achievementManager, aiManager);
const chatManager = new ChatManager(userManager, gameManager, accountManager);
const adminManager = new AdminManager(userManager, gameManager, chatManager, accountManager);

// 服务器启动时增加构建版本号
const newVersion = versionManager.incrementBuild();
logger.info(`服务器版本更新: ${newVersion}`);
const themeManager = new ThemeManager();

const serverStartTime = Date.now();

// ========== Socket.IO 连接处理 ==========

// 主命名空间
io.on('connection', (socket) => {
  logger.connectEvent(socket.id, { ip: socket.handshake.address });

  // 处理客户端连接事件（包含版本号和savedUserId）
  socket.on('client_connect', async (data) => {
    logger.info('收到客户端连接请求', {
      socketId: socket.id,
      clientVersion: data?.clientVersion,
      id: data?.id
    });

    // 检查版本兼容性
    const versionCheck = versionManager.checkCompatibility(data?.clientVersion || '1.0.0');
    socket.emit('version_check', versionCheck);

    // 处理用户连接
    await userManager.handleUserConnection(socket, data, io).catch(err => {
      logger.error('用户连接处理错误', { socketId: socket.id, error: err.message });
    });

    // 如果有账号ID，关联用户和账号
    if (data?.id) {
      const user = userManager.getUserBySocketId(socket.id);
      if (user) {
        userManager.setUserAccount(user.userId, data.id);
        logger.info('自动关联账号成功', {
          socketId: socket.id,
          userId: user.userId,
          id: data.id
        });
      }
    }
  });

  // ========== 账号相关事件 ==========

  // 注册账号
  socket.on('account_register', async (data) => {
    const { username, password, nickname } = data;
    // 获取当前用户（可能是游客）
    const user = userManager.getUserBySocketId(socket.id);
    const guestUserId = user?.userId;
    const result = await accountManager.register(username, password, nickname, guestUserId);

    // 如果注册成功且是游客升级，更新 userManager 中的用户信息
    if (result.success && guestUserId && user) {
      userManager.setUserAccount(user.userId, result.id);
      user.loginType = 'account';
    }

    socket.emit('account_action_result', {
      action: 'register',
      ...result
    });
  });

  // 游客登录
  socket.on('guest_login', async () => {
    const user = userManager.getUserBySocketId(socket.id);

    // 检查用户是否已经有账号关联
    const accountId = user ? userManager.getAccountIdByUserId(user.userId) : null;

    if (accountId) {
      // 已经有账号，返回已有的账号信息
      const account = await accountManager.getAccount(accountId);
      if (account) {
        const permissions = config.permissions[account.type] || config.permissions.guest;

        const result = {
          success: true,
          message: '游客登录成功',
          data: {
            account: account,
            permissions: permissions,
            token: userManager.generateToken(),
            loginType: 'guest'
          }
        };

        socket.emit('login_result', result);
        return;
      }
    }

    // 创建游客用户
    const userData = await userManager.createGuestUser(socket);

    if (userData) {
      // 获取权限配置
      const permissions = config.permissions.guest;

      const result = {
        success: true,
        message: '游客登录成功',
        data: {
          account: userData,
          permissions: permissions,
          token: userManager.generateToken(),
          loginType: 'guest'
        }
      };

      if (user) {
        // 设置用户账号信息
        userManager.setUserAccount(user.userId, userData.id);

        // 设置用户权限
        user.permissions = permissions;
        user.loginType = 'guest';
      }

      socket.emit('login_result', result);
    } else {
      socket.emit('login_result', {
        success: false,
        message: '创建游客账号失败'
      });
    }
  });

  // 账号密码登录
  socket.on('account_login', async (data) => {
    const { username, password } = data;
    const result = await accountManager.accountLogin(username, password);

    if (result.success && result.data) {
      const user = userManager.getUserBySocketId(socket.id);
      if (user) {
        // 设置用户账号信息
        userManager.setUserAccount(user.userId, result.data.account.id);

        // 设置用户权限
        user.permissions = result.data.permissions;
        user.loginType = result.data.loginType;
        user.token = result.data.token;

        // 检查回归玩家成就
        const account = await accountManager.getAccount(result.data.account.id);
        if (account && achievementManager) {
          let level = 1;
          if (account.profile && account.profile.exp) {
            const totalExp = account.profile.exp;
            let exp = totalExp;
            while (exp >= accountManager.getExpForLevel(level + 1)) {
              exp -= accountManager.getExpForLevel(level + 1);
              level++;
            }
          }

          const stats = {
            ...account.stats,
            level: level
          };
          const unlockedAchievements = await achievementManager.checkAchievements(result.data.account.id, stats);
          if (unlockedAchievements.length > 0) {
            socket.emit('achievements_unlocked', { achievements: unlockedAchievements });
          }
        }
      }
    }

    socket.emit('login_result', result);
  });

  // 更新账号资料
  socket.on('account_update_profile', async (data) => {
    const { id, nickname, profile } = data;
    const result = await accountManager.updateProfile(id, { nickname, profile });
    if (result.success) {
      const account = await accountManager.getAccount(id);
      result.account = account;
    }
    socket.emit('account_action_result', {
      action: 'update_profile',
      ...result
    });
  });

  // 修改密码
  socket.on('account_change_password', async (data) => {
    const { id, oldPassword, newPassword } = data;
    const result = await accountManager.changePassword(id, oldPassword, newPassword);
    socket.emit('account_action_result', {
      action: 'change_password',
      ...result
    });
  });

  // 重置密码（找回密码）
  socket.on('account_reset_password', async (data) => {
    const { username, password } = data;
    const result = await accountManager.resetPassword(username, password);
    socket.emit('account_action_result', {
      action: 'reset_password',
      ...result
    });
  });

  // 通过token获取账号信息
  socket.on('get_account_by_token', async (data) => {
    const { token } = data;
    const result = await accountManager.getAccountByToken(token);
    socket.emit('account_info', result);
  });

  // ========== 用户相关事件 ==========

  // 用户登录/更新昵称
  socket.on('user_login', (data) => {
    userManager.handleUserLogin(socket, data, io).catch(err => {
      logger.error('用户登录处理错误', { socketId: socket.id, error: err.message });
    });
  });

  // 更新用户状态
  socket.on('user_status', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (user && data.status === 'online') {
      user.status = 'online';
      user.gameType = data.game || user.gameType;
      user.lastActivity = Date.now();
      userManager.broadcastUserStatus(user.userId, 'online', io);
    }
  });

  // 获取排行榜
  socket.on('get_leaderboard', async (data) => {
    const limit = data?.limit || 10;
    const gameType = data?.gameType || null;
    const leaderboard = await userManager.getLeaderboard(limit, gameType);
    socket.emit('leaderboard', { leaderboard });
  });

  // 获取成就列表
  socket.on('get_achievements', async (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (user) {
      const accountId = userManager.userIdToAccountId.get(user.userId);
      if (accountId) {
        const account = await accountManager.getAccount(accountId);
        const stats = account?.stats || {};
        const level = account?.profile?.level || 1;
        const categories = achievementManager.getAchievementsByCategory({ ...stats, level });
        const userAchievementIds = account?.achievements || [];

        // 为每个成就添加解锁状态
        Object.values(categories).forEach(category => {
          category.achievements.forEach(achievement => {
            achievement.isUnlocked = userAchievementIds.includes(achievement.id);
          });
        });

        const totalAchievements = achievementManager.achievements.length;
        socket.emit('achievements_list', { categories, userAchievements: userAchievementIds, totalAchievements });
      }
    }
  });

  // 获取游戏历史
  socket.on('get_game_history', async (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (user) {
      const limit = data?.limit || 10;
      const history = await gameManager.getGameHistory(user.userId, limit);
      socket.emit('game_history', { history });
    }
  });

  // 获取游戏回放
  socket.on('get_game_replay', async (data) => {
    const { gameId } = data;
    if (!gameId) {
      socket.emit('error', { message: '缺少游戏ID' });
      return;
    }

    const replay = await gameManager.getGameReplay(gameId);
    if (replay) {
      socket.emit('game_replay', { replay });
    } else {
      socket.emit('error', { message: '未找到该游戏记录' });
    }
  });

  // ========== 匹配相关事件 ==========

  // 匹配请求
  socket.on('match_request', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const gameType = data?.game;
    if (!gameType) {
      socket.emit('error', { message: '请选择游戏类型' });
      return;
    }

    const success = gameManager.handleMatchRequest(socket.id, gameType, io);
    if (!success) {
      socket.emit('error', { message: '无法开始匹配' });
    }
  });

  // 挑战请求
  socket.on('challenge_request', (data) => {
    gameManager.handleChallengeRequest(socket.id, data, io);
  });

  // 挑战响应
  socket.on('challenge_response', (data) => {
    gameManager.handleChallengeResponse(socket.id, data, io);
  });

  // 取消匹配
  socket.on('cancel_match', () => {
    gameManager.handleCancelMatch(socket.id, io);
  });

  // ========== 游戏相关事件 ==========

  // 游戏移动
  socket.on('move', (data) => {
    const success = gameManager.handleMove(socket.id, data, io);
    if (!success) {
      socket.emit('error', { message: '无效的移动' });
    }
  });

  // 游戏重置请求
  socket.on('reset', (data) => {
    gameManager.handleReset(socket.id, data, io);
  });

  // 游戏重置确认
  socket.on('reset_confirm', (data) => {
    const requestId = data ? data.requestId : null;
    gameManager.handleResetConfirm(socket.id, io, requestId);
  });

  // 游戏重置拒绝
  socket.on('reset_reject', (data) => {
    const requestId = data ? data.requestId : null;
    gameManager.handleResetReject(socket.id, io, requestId);
  });

  // 游戏结果
  socket.on('game_result', (data) => {
    const success = gameManager.handleGameResult(socket.id, data, io);
    if (!success) {
      socket.emit('error', { message: '无法结束游戏' });
    }
  });

  // ========== AI对战相关事件 ==========

  // 开始AI对战
  socket.on('ai_game_start', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const { gameType, difficulty } = data;

    const success = gameManager.createAIGame(user.userId, gameType, difficulty, io);
    if (!success) {
      socket.emit('error', { message: '创建AI对战失败' });
    }
  });

  // AI对战移动
  socket.on('ai_move', async (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const { position } = data;

    const success = await gameManager.handleAIMove(user.userId, position, io);
    if (!success) {
      socket.emit('error', { message: 'AI对战移动失败' });
    }
  });

  // AI游戏结果
  socket.on('ai_game_result', async (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const { result, gameType, difficulty, duration } = data;
    const isWin = result === 'win';
    const isAI = true;

    try {
      // 结束AI游戏并保存记录（如果游戏还在进行中）
      await gameManager.endAIGame(user.userId, result, io);

      // 注意：endAIGame内部已经处理了用户统计更新

      logger.info('AI游戏结束', {
        userId: user.userId,
        result,
        gameType,
        difficulty
      });

    } catch (err) {
      logger.error('处理AI游戏结果失败', { error: err.message });
    }
  });

  // 返回大厅
  socket.on('return_lobby', () => {
    gameManager.handleReturnLobby(socket.id, io);
  });

  // ========== 贪吃蛇游戏相关事件 ==========

  // 贪吃蛇游戏开始
  socket.on('snake_game_start', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const accountId = userManager.getAccountIdByUserId(user.userId);
    const { gameType } = data;

    try {
      logger.info('贪吃蛇游戏开始', {
        userId: user.userId,
        accountId: accountId,
        gameType
      });

      // 可以在这里添加游戏开始时的统计或其他逻辑

    } catch (err) {
      logger.error('处理贪吃蛇游戏开始失败', { error: err.message });
    }
  });

  // 贪吃蛇游戏结束
  socket.on('snake_game_end', async (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const accountId = userManager.getAccountIdByUserId(user.userId);
    const { score, gameType, moveHistory } = data;

    try {
      // 记录游戏结束日志（无论用户是否登录）
      logger.info('贪吃蛇游戏结束', {
        userId: user.userId,
        accountId: accountId,
        score,
        moveCount: moveHistory ? moveHistory.length : 0
      });

      // 保存游戏记录
      if (gameManager && gameManager.saveSnakeGameRecord) {
        await gameManager.saveSnakeGameRecord({
          userId: user.userId,
          accountId: accountId,
          score: score,
          gameType: gameType,
          moveHistory: moveHistory,
          startTime: moveHistory && moveHistory.length > 0 ? moveHistory[0].timestamp : Date.now(),
          endTime: Date.now()
        });
      }

      // 更新用户统计（如果用户已登录）
      if (accountId && gameManager.accountManager) {
        const account = await gameManager.accountManager.getAccount(accountId);
        if (account) {
          // 更新贪吃蛇游戏统计
          if (!account.stats.snakeGames) {
            account.stats.snakeGames = {
              totalGames: 0,
              highScore: 0,
              totalScore: 0
            };
          }

          account.stats.snakeGames.totalGames++;
          account.stats.totalScore = (account.stats.totalScore || 0) + score;
          account.stats.snakeGames.totalScore += score;

          if (score > account.stats.snakeGames.highScore) {
            account.stats.snakeGames.highScore = score;

            // 记录新高分
            logger.info('贪吃蛇游戏新高分', {
              userId: user.userId,
              accountId: accountId,
              score: account.stats.snakeGames.highScore
            });
          }

          // 更新游戏统计数据（用于排行榜）
          // 贪吃蛇游戏：如果分数大于100，则认为是获胜
          const result = score > 100 ? 'win' : 'loss';
          await gameManager.accountManager.updateGameStats(accountId, result, 'snake', false, null, null);

          await gameManager.accountManager.updateUser(accountId, account);
        }
      }

      // 检查成就（如果用户已登录）
      if (accountId && gameManager.achievementManager) {
        await gameManager.achievementManager.checkAchievements(accountId, {
          gameType: 'snake',
          score: score,
          timestamp: Date.now()
        });
      }

    } catch (err) {
      logger.error('处理贪吃蛇游戏结果失败', { error: err.message });
    }
  });

  // ========== 观战相关事件 ==========

  // 开始观战
  socket.on('spectate_join', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const { gameId } = data;
    const result = gameManager.addSpectator(gameId, user.userId, io);

    if (result.success) {
      socket.emit('spectate_joined', result.game);
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // 结束观战
  socket.on('spectate_leave', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (user && user.game) {
      gameManager.removeSpectator(user.game, user.userId, io);
    }
  });

  // 获取可观战列表
  socket.on('get_spectate_list', () => {
    const games = gameManager.getSpectatableGames();
    socket.emit('spectate_list', { games });
  });

  // ========== 聊天相关事件 ==========

  // 全局聊天
  socket.on('chat_global', (data) => {
    const result = chatManager.handleGlobalChat(socket.id, data, io);
    if (!result.success) {
      socket.emit('chat_error', { message: result.message });
      // 如果是被禁言，发送广播通知
      if (result.message && result.message.includes('禁言')) {
        socket.emit('system_broadcast', {
          message: result.message,
          timestamp: Date.now(),
          from: '系统'
        });
      }
    }
  });

  // 游戏内聊天
  socket.on('chat_game', (data) => {
    const result = chatManager.handleGameChat(socket.id, data, io);
    if (!result.success) {
      socket.emit('chat_error', { message: result.message });
      // 如果是被禁言，发送广播通知
      if (result.message && result.message.includes('禁言')) {
        socket.emit('system_broadcast', {
          message: result.message,
          timestamp: Date.now(),
          from: '系统'
        });
      }
    }
  });

  // 私聊
  socket.on('chat_private', (data) => {
    const result = chatManager.handlePrivateChat(socket.id, data, io);
    if (!result.success) {
      socket.emit('chat_error', { message: result.message });
    }
  });

  // 获取聊天历史
  socket.on('get_chat_history', (data) => {
    const { scope, gameId } = data;
    let history = [];

    if (scope === 'global') {
      history = chatManager.getGlobalChatHistory();
    } else if (scope === 'game' && gameId) {
      history = chatManager.getGameChatHistory(gameId);
    }

    socket.emit('chat_history', { scope, gameId, history });
  });

  // ========== 错误处理 ==========

  socket.on('error', (err) => {
    logger.error('Socket错误', { socketId: socket.id, error: err.message });
  });

  // ========== 断开连接 ==========

  socket.on('disconnect', (reason) => {
    logger.disconnectEvent(socket.id, { reason });

    // 处理游戏断开
    gameManager.handleUserDisconnect(socket.id, io);

    // 处理用户断开
    userManager.handleUserDisconnect(socket.id, io);
  });
});

// ========== 管理员命名空间 ==========

const adminNamespace = io.of('/admin');

adminNamespace.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  if (adminManager.verifyToken(token)) {
    next();
  } else {
    next(new Error('认证失败'));
  }
});

adminNamespace.on('connection', (socket) => {
  logger.info('管理员连接', { socketId: socket.id });

  const token = socket.handshake.auth.token || socket.handshake.query.token;
  adminManager.handleAdminConnection(socket, token, io);

  // 踢出用户
  socket.on('kick_user', (data) => {
    const { userId, reason } = data;
    adminManager.kickUser(socket, userId, reason);
  });

  // 结束游戏
  socket.on('end_game', (data) => {
    const { gameId } = data;
    adminManager.endGame(socket, gameId);
  });

  // 广播消息
  socket.on('broadcast', (data) => {
    const { message } = data;
    adminManager.broadcastMessage(socket, message, io);
  });

  // 获取排行榜
  socket.on('get_leaderboard', (data) => {
    adminManager.getLeaderboard(socket, data?.limit || 10);
  });

  // 获取游戏历史
  socket.on('get_game_history', (data) => {
    adminManager.getGameHistory(socket, data);
  });

  // 获取系统配置
  socket.on('get_config', () => {
    adminManager.getSystemConfig(socket);
  });

  // 更新配置
  socket.on('update_config', (data) => {
    adminManager.updateSystemConfig(socket, data);
  });

  // 维护模式
  socket.on('maintenance_mode', (data) => {
    const { enabled, message } = data;
    adminManager.setMaintenanceMode(socket, enabled, message, io);
  });

  // 清理数据
  socket.on('cleanup_data', (data) => {
    adminManager.cleanupData(socket, data);
  });

  // 获取系统统计
  socket.on('get_system_stats', () => {
    adminManager.getSystemStats(socket);
  });

  // 禁言用户
  socket.on('mute_user', (data) => {
    const { userId, duration, reason } = data;
    adminManager.muteUser(socket, userId, duration, reason);
  });

  // 解除禁言
  socket.on('unmute_user', (data) => {
    const { userId } = data;
    adminManager.unmuteUser(socket, userId);
  });

  // 获取用户详情
  socket.on('get_user_detail', (data) => {
    const { userId } = data;
    adminManager.getUserDetail(socket, userId);
  });

  // 获取用户游戏历史
  socket.on('get_user_game_history', (data) => {
    const { userId, limit } = data;
    adminManager.getUserGameHistory(socket, userId, limit);
  });

  // 获取聊天记录
  socket.on('get_chat_history_admin', (data) => {
    adminManager.getChatHistory(socket, data);
  });

  // 给特定用户发送消息
  socket.on('send_user_message', (data) => {
    const { userId, message } = data;
    adminManager.sendUserMessage(socket, userId, message);
  });

  // 重置游戏
  socket.on('reset_game', (data) => {
    const { gameId } = data;
    adminManager.resetGame(socket, gameId);
  });

  // ========== 账号管理 ==========

  // 获取所有账号
  socket.on('get_all_accounts', () => {
    adminManager.getAllAccounts(socket);
  });

  // 获取等级经验配置
  socket.on('get_level_exp_config', () => {
    try {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(__dirname, 'config/levelExp.json');
      const configData = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configData);
      socket.emit('level_exp_config', config);
    } catch (err) {
      logger.error('获取等级经验配置失败', { error: err.message });
      socket.emit('level_exp_config', { levelExp: {} });
    }
  });

  // 获取账号详情
  socket.on('get_account_detail', (data) => {
    const { id } = data;
    adminManager.getAccountDetail(socket, id);
  });

  // 删除账号
  socket.on('delete_account', (data) => {
    const { id } = data;
    adminManager.deleteAccount(socket, id);
  });

  // 修改用户经验值
  socket.on('modify_user_exp', (data) => {
    const { id, operation, amount } = data;
    adminManager.modifyUserExp(socket, id, operation, amount);
  });

  // 添加用户成就
  socket.on('add_user_achievement', (data) => {
    const { id, achievementId } = data;
    adminManager.addUserAchievement(socket, id, achievementId);
  });

  // 移除用户成就
  socket.on('remove_user_achievement', (data) => {
    const { id, achievementId } = data;
    adminManager.removeUserAchievement(socket, id, achievementId);
  });

  // 重置用户成就
  socket.on('reset_user_achievements', (data) => {
    const { id } = data;
    adminManager.resetUserAchievements(socket, id);
  });

  // 断开连接
  socket.on('disconnect', () => {
    adminManager.handleAdminDisconnect(socket);
  });

  // 错误处理
  socket.on('error', (err) => {
    logger.error('管理员Socket错误', { socketId: socket.id, error: err.message });
  });
});

// ========== 定时任务 ==========

// 检查不活跃用户（每5分钟）
setInterval(() => {
  const result = userManager.checkInactiveUsers(io);
  if (result.inactiveCount > 0 || result.warningCount > 0) {
    logger.info('检查不活跃用户', {
      inactiveCount: result.inactiveCount,
      warningCount: result.warningCount
    });
  }
}, 300000);

// 保存统计数据（每10分钟）
setInterval(() => {
  userManager.saveStats().catch(err => {
    logger.error('保存统计数据失败', { error: err.message });
  });
}, 600000);

// ========== 启动服务器 ==========

const PORT = config.server.port;
const HOST = config.server.host;

server.listen(PORT, HOST, () => {
  logger.info('服务器启动成功', {
    port: PORT,
    host: HOST,
    env: config.server.env,
    adminToken: config.admin.token.substring(0, 8) + '...'
  });

  console.log(`=================================`);
  console.log(`🎮 游戏服务器已启动`);
  console.log(`📍 地址: http://${HOST}:${PORT}`);
  console.log(`🔧 管理后台: http://${HOST}:${PORT}/admin`);
  console.log(`🔑 管理员Token: ${config.admin.token}`);
  console.log(`=================================`);
});

// 优雅关闭
process.on('SIGTERM', async () => {
  logger.info('收到SIGTERM信号，开始优雅关闭...');

  // 通知所有用户
  io.emit('server_shutdown', { message: '服务器即将维护，请保存游戏进度' });

  // 保存数据
  await userManager.saveStats();

  // 关闭服务器
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('收到SIGINT信号，开始优雅关闭...');

  io.emit('server_shutdown', { message: '服务器即将维护，请保存游戏进度' });
  await userManager.saveStats();

  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

// 未捕获异常处理
process.on('uncaughtException', (err) => {
  logger.error('未捕获的异常', { error: err.message, stack: err.stack });
  // 不立即退出，给日志写入时间
  setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝', { reason, promise });
});
