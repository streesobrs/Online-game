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

// 初始化Express应用
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 60000,
  pingInterval: 25000
});

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use(express.static(path.join(__dirname, '..')));

// API路由
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
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

// 排行榜API
app.get('/api/leaderboard', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const leaderboard = await userManager.getLeaderboard(limit);
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

// 初始化管理器
const accountManager = new AccountManager();
const achievementManager = new AchievementManager(accountManager);
const aiManager = new AIManager();
const userManager = new UserManager(accountManager);
const gameManager = new GameManager(userManager, accountManager, achievementManager, aiManager);
const chatManager = new ChatManager(userManager, gameManager, accountManager);
const adminManager = new AdminManager(userManager, gameManager, chatManager, accountManager);
const versionManager = new VersionManager();

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
    const result = await accountManager.guestLogin();

    if (result.success && result.data) {
      const user = userManager.getUserBySocketId(socket.id);
      if (user) {
        // 设置用户账号信息
        userManager.setUserAccount(user.userId, result.data.account.id);

        // 设置用户权限
        user.permissions = result.data.permissions;
        user.loginType = result.data.loginType;
        user.token = result.data.token;
      }
    }

    socket.emit('login_result', result);
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
    const leaderboard = await userManager.getLeaderboard(limit);
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
  socket.on('reset_confirm', () => {
    gameManager.handleResetConfirm(socket.id, io);
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
      // 更新用户统计
      const statsResult = await userManager.updateUserStats(user.userId, isWin ? 'win' : 'loss', gameType, isAI, difficulty, duration);

      // 检查成就
      const accountId = userManager.userIdToAccountId.get(user.userId);
      if (accountId && accountManager && achievementManager) {
        const account = await accountManager.getAccount(accountId);
        if (account) {
          const stats = {
            ...account.stats,
            level: account.profile ? account.profile.level : 1,
            result: isWin ? 'win' : 'loss'
          };
          const unlockedAchievements = await achievementManager.checkAchievements(accountId, stats);
          if (unlockedAchievements.length > 0) {
            socket.emit('achievements_unlocked', { achievements: unlockedAchievements });
          }
        }
      }

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

  // 删除账号
  socket.on('delete_account', (data) => {
    const { id } = data;
    adminManager.deleteAccount(socket, id);
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
