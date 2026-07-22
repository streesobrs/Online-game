const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// 加载配置
const config = require('./config');
const logger = require('./utils/logger');
const dataStore = require('./utils/dataStore');
const runtimeConfig = require('./modules/runtimeConfig');

// 初始化运行时配置（从磁盘加载覆盖值，必须在使用config之前调用）
runtimeConfig.init(config);

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
const FeedbackManager = require('./modules/FeedbackManager');
const ShopManager = require('./modules/ShopManager');
const OperationLogger = require('./modules/OperationLogger');
const UpdateManager = require('./modules/UpdateManager');

// 初始化Express应用
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: config.server.socket.pingTimeout,
  pingInterval: config.server.socket.pingInterval,
  transports: ['websocket', 'polling'],
  upgradeTimeout: config.server.socket.upgradeTimeout,
  maxHttpBufferSize: config.server.socket.maxHttpBufferSize,
  // 认证中间件
  allowRequest: (req, callback) => {
    const token = req._query.token || (req.headers.authorization?.replace('Bearer ', ''));
    // 不需要认证，允许所有连接
    callback(null, true);
  }
});

// 中间件
app.use(cors());
app.use(express.json({ limit: config.server.http.bodyLimit }));
app.use(express.urlencoded({ extended: true, limit: config.server.http.bodyLimit }));

// Token认证中间件
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.body.token || req.query.token;

  if (!token) {
    return res.status(401).json({ success: false, message: '缺少认证Token' });
  }

  if (adminManager && adminManager.verifyToken(token)) {
    return next();
  }

  if (token === config.admin.token) {
    return next();
  }

  return res.status(401).json({ success: false, message: '无效的认证Token' });
}

// 静态文件服务 - 优先 client 目录，fallback 到根目录
app.use(express.static(path.join(__dirname, '..', 'client')));
app.use(express.static(path.join(__dirname, '..')));

// 静态资源服务 - 勋章图标等
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// 自定义头像静态服务
app.use('/data/cosmetics/avatars', express.static(path.join(__dirname, '..', 'data', 'cosmetics', 'avatars')));

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
    uptime: Date.now() - serverStartTime,
    version: versionManager.getServerVersion()
  });
});

// ========== 更新系统API ==========
app.get('/api/update/status', authenticateToken, (req, res) => {
  try {
    const status = updateManager.getPublicStatus();
    res.json({
      success: true,
      status: {
        state: status.status === 'in_progress' ? 'updating' :
          status.status === 'restarting' ? 'updating' :
            status.status === 'failed' ? 'failed' :
              status.status === 'rolled_back' ? 'failed' :
                status.status === 'rollback_failed' ? 'failed' :
                  status.status === 'success' ? 'success' :
                    (updateManager.currentZipPath ? 'uploaded' : 'idle'),
        currentVersion: status.serverVersion || config.version,
        packageInfo: updateManager.currentZipPath ? {
          path: updateManager.currentZipPath,
          size: require('fs').existsSync(updateManager.currentZipPath) ? require('fs').statSync(updateManager.currentZipPath).size : 0,
          fileCount: status.phases && status.phases.extract ? (status.phases.extract.fileCount || 0) : 0,
          version: status.version && status.version.to ? status.version.to : null
        } : null,
        lastError: status.error,
        lastBackup: status.availableBackups && status.availableBackups.length > 0 ? (() => {
          const b = status.availableBackups[status.availableBackups.length - 1];
          return { id: b.name, version: b.manifest ? b.manifest.fromVersion : 'unknown', timestamp: new Date(b.mtime).toLocaleString('zh-CN') };
        })() : null
      }
    });
  } catch (err) {
    logger.error('获取更新状态失败', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/api/update/backups', authenticateToken, (req, res) => {
  try {
    const backups = updateManager._listBackups();
    const list = backups.map(b => {
      const m = b.manifest || {};
      const sizeMB = (b.size / 1024 / 1024).toFixed(2);
      // 按操作类型分组文件
      const filesByOp = {};
      if (m.files) {
        for (const f of m.files) {
          const op = f.operation || 'update';
          if (!filesByOp[op]) filesByOp[op] = [];
          filesByOp[op].push({
            path: f.path,
            operation: f.operation,
            size: f.size,
            sizeFormatted: f.size > 1024 ? (f.size / 1024).toFixed(1) + ' KB' : f.size + ' B',
            hash: f.hash ? f.hash.substring(0, 12) + '...' : null,
            hashFull: f.hash || null
          });
        }
      }
      return {
        id: b.name,
        fromVersion: m.fromVersion || 'unknown',
        toVersion: m.toVersion || null,
        version: m.fromVersion || 'unknown',
        timestamp: new Date(b.mtime).toLocaleString('zh-CN'),
        timestampISO: new Date(b.mtime).toISOString(),
        backupTime: m.backupTime ? new Date(m.backupTime).toLocaleString('zh-CN') : null,
        updateId: m.updateId || null,
        fileCount: m.files ? m.files.length : 0,
        sizeRaw: b.size,
        sizeFormatted: sizeMB > 1 ? sizeMB + ' MB' : ((b.size / 1024).toFixed(1) + ' KB'),
        reason: m.toVersion ? `更新到 ${m.toVersion}` : '手动备份',
        filesByOp: filesByOp,
        files: m.files || []
      };
    }).reverse();
    res.json({ success: true, backups: list });
  } catch (err) {
    logger.error('获取备份列表失败', { error: err.message });
    res.status(500).json({ success: false, message: err.message, backups: [] });
  }
});

// 获取文件行级 diff
app.get('/api/update/diff', authenticateToken, (req, res) => {
  try {
    const backup = req.query.backup;
    const file = req.query.file;
    if (!backup || !file) {
      return res.status(400).json({ success: false, message: '缺少参数 backup 或 file' });
    }
    const result = updateManager.getFileDiff(backup, file);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('获取文件 diff 失败', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/update/upload', authenticateToken, express.raw({
  limit: config.update.maxUploadSize,
  type: ['application/zip', 'application/octet-stream', 'application/x-zip-compressed']
}), async (req, res) => {
  try {
    if (!config.update.enabled) {
      return res.status(403).json({ success: false, message: '更新功能未启用' });
    }
    if (updateManager.status && updateManager.status.status === 'in_progress') {
      return res.status(409).json({ success: false, message: '已有更新正在进行中' });
    }
    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, message: '未收到文件数据' });
    }
    const result = await updateManager.saveUploadedFile(req.body, 'update.zip');
    res.json({
      success: true,
      message: '上传成功',
      packageInfo: {
        size: result.size,
        sizeFormatted: (result.size / 1024 / 1024).toFixed(2) + ' MB',
        hash: result.hash,
        fileCount: 0,
        version: null
      }
    });
  } catch (err) {
    logger.error('更新包上传失败', { error: err.message });
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/update/start', authenticateToken, async (req, res) => {
  try {
    if (!config.update.enabled) {
      return res.status(403).json({ success: false, message: '更新功能未启用' });
    }
    if (updateManager.status && updateManager.status.status === 'in_progress') {
      return res.status(409).json({ success: false, message: '已有更新正在进行中' });
    }
    res.json({ success: true, message: '更新开始执行' });
    updateManager.startUpdate().catch(err => {
      logger.error('更新执行失败', { error: err.message });
    });
  } catch (err) {
    logger.error('启动更新失败', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/update/cancel', authenticateToken, (req, res) => {
  try {
    updateManager.cancelUpdate();
    res.json({ success: true, message: '更新已取消' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

app.post('/api/update/rollback', authenticateToken, async (req, res) => {
  try {
    const backupName = req.body.backupName || req.body.backupId;
    if (!backupName) {
      return res.status(400).json({ success: false, message: '请指定要回滚的备份' });
    }
    res.json({ success: true, message: '开始回滚，服务将重启' });
    updateManager.manualRollback(backupName).catch(err => {
      logger.error('回滚失败', { error: err.message });
    });
  } catch (err) {
    logger.error('回滚失败', { error: err.message });
    res.status(500).json({ success: false, message: err.message });
  }
});

app.delete('/api/update/backup/:name', authenticateToken, (req, res) => {
  try {
    updateManager.deleteBackup(req.params.name);
    res.json({ success: true, message: '备份已删除' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// 获取等级经验配置
app.get('/api/config/levelExp', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'config', 'levelExp.json');
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    res.json({ success: true, data: data.levelExp || {} });
  } catch (err) {
    logger.error('获取等级配置失败', { error: err.message });
    res.status(500).json({ success: false, data: {} });
  }
});

// ========== 商店API ==========

// 获取商店数据
app.get('/api/shop/data', async (req, res) => {
  try {
    const userId = req.query.userId;
    const data = await shopManager.getShopData(userId, accountManager);
    res.json({ success: true, data });
  } catch (err) {
    logger.error('获取商店数据失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// 购买商品
app.post('/api/shop/buy', async (req, res) => {
  try {
    const { userId, itemId, quantity = 1 } = req.body;
    if (!userId || !itemId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    if (quantity < 1 || quantity > config.shop.maxPurchaseQuantity) {
      return res.status(400).json({ success: false, message: '数量不合法' });
    }
    const result = await shopManager.purchaseItem(userId, itemId, quantity, accountManager);
    res.json(result);
  } catch (err) {
    logger.error('购买失败', { error: err.message });
    res.status(500).json({ success: false, message: '购买失败' });
  }
});

// 获取用户背包
app.get('/api/shop/inventory', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.getInventory(userId);
    res.json(result);
  } catch (err) {
    logger.error('获取背包失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// 获取用户外观
app.get('/api/shop/cosmetics', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.getCosmetics(userId);
    res.json(result);
  } catch (err) {
    logger.error('获取外观失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// 装备外观
app.post('/api/shop/cosmetics/equip', async (req, res) => {
  try {
    const { userId, category, cosmeticId } = req.body;
    if (!userId || !category) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.equipCosmetic(userId, category, cosmeticId);
    res.json(result);
  } catch (err) {
    logger.error('装备失败', { error: err.message });
    res.status(500).json({ success: false, message: '装备失败' });
  }
});

// 获取所有外观配置
app.get('/api/shop/cosmetics/config', async (req, res) => {
  try {
    const result = accountManager.getAllCosmeticsConfig();
    res.json(result);
  } catch (err) {
    logger.error('获取外观配置失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// 上传自定义头像
app.post('/api/avatar/upload', async (req, res) => {
  try {
    const { userId, avatar, replaceIndex, name } = req.body;
    if (!userId || !avatar) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.saveCustomAvatar(userId, avatar, replaceIndex, name);
    res.json(result);
  } catch (err) {
    logger.error('上传头像失败', { error: err.message });
    res.status(500).json({ success: false, message: '上传失败' });
  }
});

// 删除自定义头像
app.post('/api/avatar/delete', async (req, res) => {
  try {
    const { userId, avatarFile } = req.body;
    if (!userId || !avatarFile) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.deleteCustomAvatar(userId, avatarFile);
    res.json(result);
  } catch (err) {
    logger.error('删除头像失败', { error: err.message });
    res.status(500).json({ success: false, message: '删除失败' });
  }
});

// 重命名自定义头像
app.post('/api/avatar/rename', async (req, res) => {
  try {
    const { userId, avatarFile, name } = req.body;
    if (!userId || !avatarFile || !name) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.renameCustomAvatar(userId, avatarFile, name);
    res.json(result);
  } catch (err) {
    logger.error('改名失败', { error: err.message });
    res.status(500).json({ success: false, message: '改名失败' });
  }
});

// 获取用户会员信息
app.get('/api/shop/vip', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.getVip(userId);
    res.json(result);
  } catch (err) {
    logger.error('获取会员信息失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// 获取星钻余额
app.get('/api/currency/balance', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.getCurrency(userId);
    res.json(result);
  } catch (err) {
    logger.error('获取星钻余额失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取失败' });
  }
});

// 使用道具
app.post('/api/shop/use-item', async (req, res) => {
  try {
    const { userId, itemId } = req.body;
    if (!userId || !itemId) {
      return res.status(400).json({ success: false, message: '参数错误' });
    }
    const result = await accountManager.useItem(userId, itemId, 1, shopManager);
    if (result.success) {
      const [invResult, currencyResult] = await Promise.all([
        accountManager.getInventory(userId),
        accountManager.getCurrency(userId)
      ]);
      result.account = {
        inventory: invResult.inventory || {},
        starCoins: currencyResult?.balance ?? 0
      };
    }
    res.json(result);
  } catch (err) {
    logger.error('使用道具失败', { error: err.message });
    res.status(500).json({ success: false, message: '使用失败' });
  }
});

// 获取活跃buff
app.get('/api/buffs/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const account = await accountManager._getAccount(userId);
    const buffs = account?.activeBuffs || {};
    res.json({ success: true, buffs });
  } catch (err) {
    logger.error('获取活跃buff失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取失败' });
  }
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

  // 验证token是否与配置中的管理员Token匹配
  if (token === config.admin.token || (adminManager && adminManager.verifyToken(token))) {
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
    const accounts = await accountManager.getAllAccounts(config.validation.accountSearchLimit, 0);
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
    const { accountId, limit = 20, offset = 0 } = req.query;
    const history = await gameManager.getGameHistory(accountId, parseInt(limit));
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

// 管理员：获取所有对局记录（分页+筛选）
app.get('/api/admin/games', authenticateToken, async (req, res) => {
  try {
    const { gameType, result, page = 1, pageSize = 20, keyword } = req.query;
    const p = parseInt(page) || 1;
    const ps = parseInt(pageSize) || 20;
    const allGames = await dataStore.read('games');
    let games = Array.isArray(allGames) ? allGames : [];

    if (gameType && gameType !== 'all') {
      games = games.filter(g => g.gameType === gameType);
    }
    if (result && result !== 'all') {
      games = games.filter(g => g.result === result);
    }
    if (keyword) {
      const kw = keyword.toLowerCase();
      games = games.filter(g =>
        (g.player1Nickname && g.player1Nickname.toLowerCase().includes(kw)) ||
        (g.player2Nickname && g.player2Nickname.toLowerCase().includes(kw)) ||
        (g.gameId && g.gameId.toLowerCase().includes(kw))
      );
    }

    games.sort((a, b) => (b.endTime || b.savedAt || 0) - (a.endTime || a.savedAt || 0));

    const total = games.length;
    const totalPages = Math.max(1, Math.ceil(total / ps));
    const start = (p - 1) * ps;
    const pageData = games.slice(start, start + ps).map(g => ({
      gameId: g.gameId,
      gameType: g.gameType,
      player1: g.player1Nickname || g.player1 || '-',
      player2: g.player2Nickname || g.player2 || '-',
      winner: g.winner,
      winnerNickname: g.winner === g.player1 ? (g.player1Nickname || g.player1)
        : g.winner === g.player2 ? (g.player2Nickname || g.player2)
          : g.winner === 'ai' ? 'AI' : (g.winner || '-'),
      result: g.result,
      moveCount: Array.isArray(g.moves) ? g.moves.length : 0,
      duration: g.duration || 0,
      startTime: g.startTime,
      endTime: g.endTime,
      gameMode: g.gameMode || 'pvp',
      difficulty: g.difficulty,
      score: g.score,
      winReason: g.winReason
    }));

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();
    const stats = {
      total: allGames.length,
      todayGames: allGames.filter(g => (g.endTime || g.savedAt || 0) >= todayTime).length,
      pvpGames: allGames.filter(g => !g.gameMode || g.gameMode === 'pvp').length,
      aiGames: allGames.filter(g => g.gameMode === 'ai').length,
      activeGames: gameManager.games.size,
      aiActiveGames: gameManager.aiGames.size
    };

    res.json({ success: true, data: pageData, pagination: { page: p, pageSize: ps, total, totalPages }, stats });
  } catch (err) {
    logger.error('获取对局列表失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取对局列表失败' });
  }
});

// 管理员：获取操作日志列表（分页+筛选）
app.get('/api/admin/operation-logs', authenticateToken, async (req, res) => {
  try {
    const { userId, username, action, category, targetId, startDate, endDate, page = 1, pageSize = 50, includeTrace = 'false' } = req.query;
    const result = await operationLogger.queryLogs({
      userId, username, action, category, targetId, startDate, endDate, page, pageSize,
      includeTrace: includeTrace === 'true'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('获取操作日志失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取操作日志失败' });
  }
});

// ========== 反馈相关API ==========

// 获取反馈列表
app.get('/api/feedbacks', async (req, res) => {
  try {
    const feedbacks = await feedbackManager.getFeedbackList();
    res.json({
      success: true,
      data: feedbacks
    });
  } catch (err) {
    logger.error('获取反馈列表失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '获取反馈列表失败'
    });
  }
});

// 提交反馈
app.post('/api/feedbacks', async (req, res) => {
  try {
    const { accountId, nickname, type, title, content } = req.body;
    if (!accountId || !nickname || !title || !content) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    const result = await feedbackManager.submitFeedback(accountId, nickname, type, title, content);
    res.json(result);
  } catch (err) {
    logger.error('提交反馈失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '提交反馈失败'
    });
  }
});

// 投票
app.post('/api/feedbacks/:id/vote', async (req, res) => {
  try {
    const { id } = req.params;
    const { accountId, voteType = 'up' } = req.body;
    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    const result = await feedbackManager.voteFeedback(id, accountId, voteType);
    // 广播实时更新
    if (result.success) {
      feedbackManager.getFeedbackList().then(all => io.emit('feedbacks_list', { feedbacks: all }));
    }
    res.json(result);
  } catch (err) {
    logger.error('投票失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '投票失败'
    });
  }
});

// 添加评论
app.post('/api/feedbacks/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { accountId, content } = req.body;
    if (!accountId || !content) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数'
      });
    }

    const result = await feedbackManager.addComment(id, accountId, content);
    // 广播实时更新
    if (result.success) {
      feedbackManager.getFeedbackList().then(all => io.emit('feedbacks_list', { feedbacks: all }));
    }
    res.json(result);
  } catch (err) {
    logger.error('添加评论失败', { error: err.message });
    res.status(500).json({
      success: false,
      message: '添加评论失败'
    });
  }
});

// 更新反馈状态（管理员）
app.put('/api/feedbacks/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const validStatus = ['pending', 'processing', 'resolved', 'closed'];
    if (!validStatus.includes(status)) {
      return res.status(400).json({ success: false, message: '无效的状态值' });
    }
    const result = await feedbackManager.updateFeedbackStatus(id, status);
    // 广播实时更新
    if (result.success) {
      feedbackManager.getFeedbackList().then(all => io.emit('feedbacks_list', { feedbacks: all }));
    }
    res.json(result);
  } catch (err) {
    logger.error('更新反馈状态失败', { error: err.message });
    res.status(500).json({ success: false, message: '更新失败' });
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
      userId: u.accountId,
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
    const accounts = await accountManager.getAllAccounts(config.validation.accountSearchLimit, 0);
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
    const { accountId } = req.body;
    if (!accountId) {
      return res.status(400).json({
        success: false,
        message: '请提供用户ID'
      });
    }
    const result = await accountManager.addUserAchievement(accountId, req.params.id);
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

// ========== 星钻货币系统 API ==========

// 获取用户星钻余额
app.get('/api/currency/:accountId', async (req, res) => {
  try {
    const result = await accountManager.getCurrency(req.params.accountId);
    res.json(result);
  } catch (err) {
    logger.error('获取星钻余额失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取星钻余额失败' });
  }
});

// 获取星钻交易记录
app.get('/api/currency/:accountId/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await accountManager.getCurrencyTransactions(req.params.accountId, limit);
    res.json(result);
  } catch (err) {
    logger.error('获取星钻交易记录失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取星钻交易记录失败' });
  }
});

// 获取经验记录
app.get('/api/currency/:accountId/exp-transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const result = await accountManager.getExpTransactions(req.params.accountId, limit);
    res.json(result);
  } catch (err) {
    logger.error('获取经验记录失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取经验记录失败' });
  }
});

// ========== 老玩家星钻补偿 API ==========

// 触发补偿（只执行一次，已补偿的账号自动跳过）
app.post('/api/currency/compensate', async (req, res) => {
  try {
    const result = await accountManager.compensateOldPlayers();
    res.json(result);
  } catch (err) {
    logger.error('星钻补偿失败', { error: err.message });
    res.status(500).json({ success: false, message: '补偿失败' });
  }
});

// 查询单个账号是否已补偿
app.get('/api/currency/:accountId/compensation', async (req, res) => {
  try {
    const { accountId } = req.params;
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      return res.json({ success: false, message: '账号不存在' });
    }
    res.json({
      success: true,
      compensated: !!account.compensatedAt,
      compensatedAt: account.compensatedAt || null,
      summary: account.compensationSummary || null
    });
  } catch (err) {
    logger.error('查询补偿状态失败', { error: err.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

// ========== 等级奖励系统 API ==========

// 获取可领取的等级奖励列表
app.get('/api/level-rewards/:accountId', async (req, res) => {
  try {
    const result = await accountManager.getAvailableLevelRewards(req.params.accountId);
    res.json(result);
  } catch (err) {
    logger.error('获取等级奖励列表失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取等级奖励列表失败' });
  }
});

// 获取当前经验倍率信息
app.get('/api/event-multiplier', (req, res) => {
  try {
    const eventMult = accountManager.getEventMultiplier();
    const multipliers = {
      level: {
        '1~10': 1.0,
        '11~20': 1.5,
        '21~30': 2.0,
        '31~40': 2.5,
        '41+': 3.0,
      },
      event: eventMult,
      today: new Date().toLocaleDateString('zh-CN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    };
    res.json(multipliers);
  } catch (err) {
    logger.error('获取经验倍率信息失败', { error: err.message });
    res.json({ event: { multiplier: 1.0, label: '' } });
  }
});

// 领取所有可领取的等级奖励
app.post('/api/level-rewards/:accountId/claim', async (req, res) => {
  try {
    const result = await accountManager.checkLevelRewards(req.params.accountId);
    res.json(result);
  } catch (err) {
    logger.error('领取等级奖励失败', { error: err.message });
    res.status(500).json({ success: false, message: '领取等级奖励失败' });
  }
});

// ========== 个人资料 API ==========

// 获取完整的个人资料信息（含等级、成就、货币）
app.get('/api/profile/:accountId', async (req, res) => {
  try {
    const accountId = req.params.accountId;
    const account = await accountManager.getAccount(accountId);
    if (!account) {
      return res.status(404).json({ success: false, message: '账号不存在' });
    }

    // 获取货币信息
    const currency = await accountManager.getCurrency(accountId);

    // 获取等级奖励信息
    const levelRewards = await accountManager.getAvailableLevelRewards(accountId);

    // 获取成就信息
    const achievements = achievementManager?.getAllAchievements?.() || [];
    const userAchievements = accountManager._normalizeAchievements
      ? accountManager._normalizeAchievements(account.achievements || [])
      : (account.achievements || []);

    // 计算已解锁成就
    const unlockedAchievements = achievements.filter(a => userAchievements.includes(a.id));
    const achievementProgress = {
      total: achievements.length,
      unlocked: unlockedAchievements.length,
      percentage: achievements.length > 0 ? Math.round((unlockedAchievements.length / achievements.length) * 100) : 0
    };

    // 获取游戏统计数据
    const games = account.games || {};

    let totalGames = 0;
    let totalWins = 0;
    let totalDraws = 0;
    let totalLosses = 0;
    let bestStreak = 0;
    for (const g of Object.values(games)) {
      totalGames += (g.played || g.totalGames || 0);
      totalWins += (g.wins || 0);
      totalDraws += (g.draws || 0);
      totalLosses += (g.losses || 0);
      const streak = (g.bestStreak || g.maxStreak || 0);
      if (streak > bestStreak) bestStreak = streak;
    }

    res.json({
      success: true,
      data: {
        account: {
          id: account.account?.id,
          username: account.account?.username,
          nickname: account.account?.nickname,
          type: account.account?.type,
          createdAt: account.account?.createdAt,
          loginCount: account.account?.loginCount || 0,
          hasPassword: account.hasPassword || false,
          isAdmin: account.account?.isAdmin === true
        },
        profile: account.account?.profile || { level: 1, exp: 0 },
        currency: currency.balance || 0,
        levelRewards: levelRewards.success ? {
          available: levelRewards.available || [],
          future: levelRewards.future || [],
          claimedLevels: levelRewards.claimedLevels || [],
          totalClaimed: levelRewards.totalClaimed || 0
        } : { available: [], future: [], claimedLevels: [], totalClaimed: 0 },
        achievements: {
          unlocked: unlockedAchievements,
          progress: achievementProgress,
          badges: account.badges || [],
          badgeDefinitions: achievementManager.getBadgeDefinitions()
        },
        stats: {
          totalGames,
          totalWins,
          totalDraws,
          totalLosses,
          bestStreak,
          winRate: totalGames > 0 ? Math.round((totalWins / totalGames) * 100) : 0
        },
        games,
        activeBuffs: account.activeBuffs || {},
        inventory: {
          undoCount: account.inventory?.undoCount || 0,
          hintCount: account.inventory?.hintCount || 0
        }
      }
    });
  } catch (err) {
    logger.error('获取个人资料失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取个人资料失败' });
  }
});

// ========== 邮件系统 API ==========

// 获取用户邮件列表
app.get('/api/mails/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const result = await accountManager.getMails(accountId);
    res.json(result);
  } catch (err) {
    logger.error('获取邮件列表失败', { error: err.message });
    res.status(500).json({ success: false, message: '获取邮件列表失败' });
  }
});

// 领取单封邮件
app.post('/api/mails/:accountId/claim/:mailId', async (req, res) => {
  try {
    const { accountId, mailId } = req.params;
    const result = await accountManager.claimMail(accountId, mailId);
    res.json(result);
  } catch (err) {
    logger.error('领取邮件失败', { error: err.message });
    res.status(500).json({ success: false, message: '领取邮件失败' });
  }
});

// 一键领取所有邮件
app.post('/api/mails/:accountId/claim-all', async (req, res) => {
  try {
    const { accountId } = req.params;
    const result = await accountManager.claimAllMails(accountId);
    res.json(result);
  } catch (err) {
    logger.error('批量领取邮件失败', { error: err.message });
    res.status(500).json({ success: false, message: '批量领取邮件失败' });
  }
});

// 标记所有邮件为已读
app.post('/api/mails/:accountId/read-all', async (req, res) => {
  try {
    const { accountId } = req.params;
    const result = await accountManager.readAllMails(accountId);
    res.json(result);
  } catch (err) {
    logger.error('标记已读失败', { error: err.message });
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

// 标记单封邮件为已读
app.post('/api/mails/:accountId/read/:mailId', async (req, res) => {
  try {
    const { accountId, mailId } = req.params;
    const result = await accountManager.readMail(accountId, mailId);
    res.json(result);
  } catch (err) {
    logger.error('标记邮件已读失败', { error: err.message });
    res.status(500).json({ success: false, message: '操作失败' });
  }
});

// 删除单封邮件
app.delete('/api/mails/:accountId/:mailId', async (req, res) => {
  try {
    const { accountId, mailId } = req.params;
    const result = await accountManager.deleteMail(accountId, mailId);
    res.json(result);
  } catch (err) {
    logger.error('删除邮件失败', { error: err.message });
    res.status(500).json({ success: false, message: '删除邮件失败' });
  }
});

// 清理所有已领取的邮件
app.post('/api/mails/:accountId/cleanup', async (req, res) => {
  try {
    const { accountId } = req.params;
    const result = await accountManager.deleteClaimedMails(accountId);
    res.json(result);
  } catch (err) {
    logger.error('清理邮件失败', { error: err.message });
    res.status(500).json({ success: false, message: '清理邮件失败' });
  }
});

// 初始化管理器
const versionManager = new VersionManager();
const operationLogger = new OperationLogger();
const accountManager = new AccountManager(io);
accountManager.operationLogger = operationLogger;
// 后台加载节假日数据
AccountManager.initHolidays().catch(err => logger.warn('节假日初始化失败', { error: err.message }));
// 启动时迁移邮件和背包数据到独立存储
AccountManager.migrateAll().then(result => {
  if (result.migratedAccounts > 0) {
    logger.info('邮件和背包数据迁移完成', { migratedAccounts: result.migratedAccounts, mailCount: result.mailCount, inventoryItemCount: result.inventoryItemCount });
  }
}).catch(err => {
  logger.warn('邮件和背包数据迁移失败', { error: err.message });
});
const userManager = new UserManager(accountManager);
userManager.operationLogger = operationLogger;
logger.info('用户管理器初始化完成');

const achievementManager = new AchievementManager(accountManager, userManager);
achievementManager.operationLogger = operationLogger;
// 启动时同步勋章数据
achievementManager.syncAllBadges().catch(err => logger.warn('勋章数据同步失败', { error: err.message }));
logger.info('勋章系统初始化完成');

const aiManager = new AIManager();
logger.info('AI引擎初始化完成');

const gameManager = new GameManager(userManager, accountManager, achievementManager, aiManager);
gameManager.operationLogger = operationLogger;
logger.info('游戏管理器初始化完成');

const chatManager = new ChatManager(userManager, gameManager, accountManager);
chatManager.operationLogger = operationLogger;
logger.info('聊天系统初始化完成');

const adminManager = new AdminManager(userManager, gameManager, chatManager, accountManager, io);
adminManager.operationLogger = operationLogger;
logger.info('后台管理系统初始化完成');

const feedbackManager = FeedbackManager;
logger.info('反馈系统初始化完成');
const shopManager = new ShopManager();
shopManager.operationLogger = operationLogger;
// 注入accountManager到FeedbackManager用于实时查询昵称
feedbackManager.accountManager = accountManager;

// 服务器启动时增加构建版本号
const newVersion = versionManager.incrementBuild();
logger.info(`服务器版本更新: ${newVersion}`);
const themeManager = new ThemeManager();
const updateManager = new UpdateManager(io);

// ========== FFmpeg 自动检测（用于 GIF 头像压缩） ==========
(function initFfmpeg() {
  try {
    if (config.ffmpeg && config.ffmpeg.path && fs.existsSync(config.ffmpeg.path)) {
      process.env.FFMPEG_PATH = config.ffmpeg.path;
      logger.info('使用配置的 FFmpeg 路径', { path: config.ffmpeg.path });
      return;
    }

    if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
      logger.info('使用环境变量指定的 FFmpeg 路径', { path: process.env.FFMPEG_PATH });
      return;
    }

    const { execFileSync, execSync } = require('child_process');
    const isWin = process.platform === 'win32';

    // 先测试当前进程的 PATH 里有没有（最理想情况）
    try {
      execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 2000 });
      logger.info('FFmpeg 已在 PATH 中可用');
      return;
    } catch (e) { /* 继续 */ }

    function injectFfmpeg(foundPath) {
      if (!foundPath || !fs.existsSync(foundPath)) return false;
      process.env.FFMPEG_PATH = foundPath;
      const ffmpegDir = path.dirname(foundPath);
      if (process.env.PATH) {
        if (!process.env.PATH.includes(ffmpegDir)) {
          process.env.PATH = ffmpegDir + path.delimiter + process.env.PATH;
        }
      } else {
        process.env.PATH = ffmpegDir;
      }
      return true;
    }

    if (isWin) {
      // 关键: 从注册表读取系统最新的 PATH（绕过进程启动时缓存的 PATH）
      let freshPathDirs = [];
      try {
        // 读取系统级 PATH (HKLM)
        const sysOut = execSync('reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path', { encoding: 'utf8', timeout: 3000 });
        const sysMatch = sysOut.match(/Path\s+(?:REG_SZ|REG_EXPAND_SZ|REG_MULTI_SZ)\s+([\s\S]+?)(?:\r?\n\r?\n|$)/i);
        if (sysMatch) {
          freshPathDirs.push(...sysMatch[1].trim().split(';').filter(Boolean));
        }
      } catch (e) { /* 读取 HKLM 失败，继续 */ }
      try {
        // 读取用户级 PATH (HKCU)
        const userOut = execSync('reg query "HKCU\\Environment" /v Path', { encoding: 'utf8', timeout: 3000 });
        const userMatch = userOut.match(/Path\s+(?:REG_SZ|REG_EXPAND_SZ|REG_MULTI_SZ)\s+([\s\S]+?)(?:\r?\n\r?\n|$)/i);
        if (userMatch) {
          freshPathDirs.push(...userMatch[1].trim().split(';').filter(Boolean));
        }
      } catch (e) { /* 读取 HKCU 失败，继续 */ }

      // 展开环境变量（如 %SystemRoot%），然后在每个目录中查找 ffmpeg.exe
      for (let dir of freshPathDirs) {
        dir = dir.replace(/%([^%]+)%/g, (match, name) => process.env[name] || match);
        const candidate = path.join(dir, 'ffmpeg.exe');
        try {
          if (fs.existsSync(candidate)) {
            if (injectFfmpeg(candidate)) {
              logger.info('从系统注册表 PATH 中找到 FFmpeg 并已注入', { path: candidate });
              return;
            }
          }
        } catch (e) { /* 路径可能无效，跳过 */ }
      }

      // 常见安装位置兜底（扫描常见盘符 C:\ D:\ E:\ 等）
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
      const winCandidates = commonDirs.map(dir => path.join(dir, 'ffmpeg.exe'));
      for (const candidate of winCandidates) {
        if (fs.existsSync(candidate)) {
          if (injectFfmpeg(candidate)) {
            logger.info('在系统目录找到 FFmpeg 并已注入', { path: candidate });
            return;
          }
        }
      }
    }

    // Linux/macOS
    const nixCandidates = ['/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg', '/opt/bin/ffmpeg'];
    for (const candidate of nixCandidates) {
      if (fs.existsSync(candidate)) {
        if (injectFfmpeg(candidate)) {
          logger.info('自动检测到 FFmpeg', { path: candidate });
          return;
        }
      }
    }

    logger.warn('未找到 FFmpeg，GIF 头像将不被压缩。可通过以下方式解决：');
    logger.warn('  1. 在 config.js 中设置 config.ffmpeg.path = "你的ffmpeg完整路径"（最稳妥）');
    logger.warn('  2. 设置环境变量 FFMPEG_PATH 后启动服务器');
    logger.warn('  3. 安装 ffmpeg 到系统 PATH 后重启服务器（如 scoop install ffmpeg）');
  } catch (err) {
    logger.warn('FFmpeg 自动检测出错，跳过 GIF 压缩', { error: err.message });
  }
})();

const serverStartTime = Date.now();

// ========== Socket.IO 连接处理 ==========

// 初始化贪吃蛇游戏存储（在连接回调外部，全局共享）
io.snakeGames = new Map(); // 存储进行中的游戏

// 主命名空间
io.on('connection', (socket) => {
  logger.connectEvent(socket.id, { ip: socket.handshake.address });
  const snakeGames = io.snakeGames;

  // 维护模式检查（返回true表示被拦截）
  function checkMaintenance(actionType = 'game') {
    if (!config.system.maintenanceEnabled) return false;
    // 管理员不受限制
    if (adminManager.isAdmin(socket)) return false;

    // 根据actionType检查是否该操作被阻止
    let isBlocked = false;
    switch (actionType) {
      case 'game':
      case 'match':
      case 'challenge':
      case 'ai_game':
      case 'spectate':
        isBlocked = config.system.maintenanceBlockNewGames !== false;
        break;
      case 'chat':
        isBlocked = config.system.maintenanceBlockChat === true;
        break;
      case 'shop':
      case 'purchase':
        isBlocked = config.system.maintenanceBlockShop !== false;
        break;
      case 'mail':
      case 'email':
        isBlocked = config.system.maintenanceBlockMail !== false;
        break;
      case 'register':
      case 'signup':
        isBlocked = config.system.maintenanceBlockRegister !== false;
        break;
      case 'profile':
      case 'update_profile':
        isBlocked = config.system.maintenanceBlockProfile === true;
        break;
      default:
        isBlocked = true;
    }

    if (!isBlocked) return false;

    socket.emit('maintenance_blocked', {
      message: config.system.maintenanceMessage || '系统维护中，请稍后再试',
      blockedAction: actionType,
      endTime: config.system.maintenanceEndTime || 0
    });
    return true;
  }

  // 获取当前登录用户信息的辅助函数
  function getSocketUser() {
    const session = userManager.getUserBySocketId(socket.id);
    if (!session || !session.accountId) return null;
    return {
      userId: session.accountId,
      username: session.nickname || session.accountData?.account?.nickname || session.accountData?.account?.username || ''
    };
  }

  // Socket 事件全量追踪日志（排除高频噪音事件）
  const TRACE_EXCLUDE_EVENTS = new Set([
    'snake_update', 'snake_food_update', 'user_status',
    'disconnect', 'error'
  ]);

  async function logSocketEvent(eventName, data, extraDetails = {}) {
    if (TRACE_EXCLUDE_EVENTS.has(eventName)) return;
    const user = getSocketUser();
    if (!user) return;
    try {
      await operationLogger.logSocketEvent(user.userId, user.username, eventName, data, extraDetails);
    } catch (err) {
      // 静默失败，不影响主流程
    }
  }

  // 处理客户端连接事件（包含版本号和token）
  socket.on('client_connect', async (data) => {
    logger.info('收到客户端连接请求', {
      socketId: socket.id,
      clientVersion: data?.clientVersion,
      token: data?.token ? 'exists' : 'none'
    });

    // 检查版本兼容性
    const versionCheck = versionManager.checkCompatibility(data?.clientVersion || '1.0.0');
    socket.emit('version_check', versionCheck);

    // 处理用户连接（新的统一连接逻辑）
    const userSession = await userManager.handleUserConnection(socket, data, io);

    if (!userSession) {
      logger.error('用户连接处理失败', { socketId: socket.id });
      return;
    }

    // 如果是已登录的账号，发送登录结果
    if (userSession.accountId && userSession.accountData && userSession.accountData.account?.type !== 'anonymous') {
      const account = userSession.accountData;
      const permissions = config.permissions[account.account?.type] || config.permissions.registered;

      const result = {
        success: true,
        message: '自动登录成功',
        data: {
          account: account,
          permissions: permissions,
          token: userSession.token,
          loginType: 'account'
        }
      };

      socket.emit('login_result', result);
      logger.info('自动登录成功', {
        socketId: socket.id,
        accountId: userSession.accountId
      });
    }

    // 重连时恢复游戏状态
    if (userSession.accountId && userSession.status === 'playing' && userSession.game) {
      try {
        if (userSession.game === 'ai') {
          // 恢复AI对战
          const aiGame = gameManager.aiGames.get(userSession.accountId);
          if (aiGame && aiGame.status === 'playing') {
            socket.emit('ai_game_start', {
              gameType: aiGame.gameType,
              difficulty: aiGame.difficulty,
              board: aiGame.board,
              currentPlayer: aiGame.currentPlayer,
              moves: aiGame.moves,
              reconnected: true
            });
            logger.info('重连恢复AI对战', { accountId: userSession.accountId, gameType: aiGame.gameType });
          } else {
            // AI游戏已不存在，重置用户状态
            userSession.status = 'online';
            userSession.game = null;
            userSession.gameType = null;
          }
        } else {
          // 恢复PvP游戏
          const game = gameManager.games.get(userSession.game);
          if (game && game.status === 'playing') {
            socket.emit('game_reconnected', {
              gameId: game.gameId,
              gameType: game.gameType,
              board: game.board,
              currentPlayer: game.currentPlayer,
              player1: game.player1,
              player2: game.player2,
              player1Nickname: game.player1Nickname,
              player2Nickname: game.player2Nickname,
              moves: game.moves,
              yourTurn: game.currentPlayer === (game.player1 === userSession.accountId ? 1 : 2)
            });
            logger.info('重连恢复PvP游戏', { accountId: userSession.accountId, gameId: game.gameId });
          } else {
            userSession.status = 'online';
            userSession.game = null;
            userSession.gameType = null;
          }
        }
      } catch (err) {
        logger.error('重连恢复游戏状态失败', { accountId: userSession.accountId, error: err.message });
      }
    }

    // 发送当前维护状态（如果在维护中）
    if (config.system.maintenanceEnabled) {
      socket.emit('maintenance_notice', {
        enabled: true,
        message: config.system.maintenanceMessage,
        timestamp: Date.now(),
        endTime: config.system.maintenanceEndTime || 0,
        startTime: config.system.maintenanceStartTime,
        durationMinutes: config.system.maintenanceCountdownMinutes,
        blockNewGames: config.system.maintenanceBlockNewGames,
        blockChat: config.system.maintenanceBlockChat,
        blockShop: config.system.maintenanceBlockShop,
        blockMail: config.system.maintenanceBlockMail,
        blockRegister: config.system.maintenanceBlockRegister,
        blockProfile: config.system.maintenanceBlockProfile
      });
    }
  });

  // ========== 登录相关事件 ==========

  // 游客登录
  socket.on('guest_login', async (data) => {
    logger.info('收到游客登录请求', { socketId: socket.id });

    const result = await userManager.handleGuestLogin(socket);

    if (result.success) {
      const account = result.data.account;
      const permissions = config.permissions.guest;
      const accountId = result.data.account.account.id;

      socket.emit('login_result', {
        success: true,
        message: '游客登录成功',
        data: {
          account: account,
          permissions: permissions,
          token: result.data.token,
          loginType: 'guest'
        }
      });

      // 记录操作日志
      if (operationLogger) {
        operationLogger.getLogin(accountId, account.account?.nickname || account.account?.username || '', socket.handshake?.address || '');
      }

      // 广播用户上线
      userManager.broadcastUserStatus(accountId, 'online', io);
    } else {
      socket.emit('login_result', result);
    }
  });

  // 账号登录
  socket.on('account_login', async (data) => {
    const { username, password } = data;

    logger.info('收到账号登录请求', {
      socketId: socket.id,
      username
    });

    const result = await userManager.handleAccountLogin(socket, username, password);

    if (result.success) {
      const account = result.data.account;
      const permissions = config.permissions[account.account?.type] || config.permissions.registered;
      const accountId = result.data.account.account.id;

      socket.emit('login_result', {
        success: true,
        message: '账号登录成功',
        data: {
          account: account,
          permissions: permissions,
          token: result.data.token,
          loginType: 'account'
        }
      });

      // 记录操作日志
      if (operationLogger) {
        operationLogger.getLogin(accountId, account.account?.nickname || account.account?.username || '', socket.handshake?.address || '');
      }

      // 广播用户上线
      userManager.broadcastUserStatus(accountId, 'online', io);
    } else {
      socket.emit('login_result', result);
    }
  });

  // ========== 账号相关事件 ==========

  // 注册账号
  socket.on('account_register', async (data) => {
    const { username, password, nickname } = data;

    // 获取当前用户会话
    const userSession = userManager.getUserBySocketId(socket.id);
    const guestAccountId = userSession?.accountId;

    logger.info('收到账号注册请求', {
      socketId: socket.id,
      guestAccountId,
      username
    });

    const result = await accountManager.register(username, password, nickname, guestAccountId);

    // 如果注册成功且是游客升级，更新用户会话
    if (result.success && guestAccountId && userSession) {
      // 获取更新后的账号信息
      const updatedAccount = await accountManager.getAccount(guestAccountId);
      if (updatedAccount) {
        userSession.accountData = updatedAccount;
        userSession.nickname = updatedAccount.account?.nickname || userSession.nickname;

        // 发送更新后的用户信息
        socket.emit('user_updated', {
          accountId: guestAccountId,
          nickname: userSession.nickname,
          accountType: 'registered'
        });
      }
    } else if (result.success && !guestAccountId) {
      // 匿名用户直接注册，需要更新会话
      const newAccountId = result.id;
      const sessionToken = accountManager.generateSessionToken(newAccountId);

      // 更新用户会话
      if (userSession) {
        // 删除旧的匿名会话
        userManager.onlineUsers.delete(socket.id);

        // 创建新的账号会话
        userSession.accountId = newAccountId;
        userSession.token = sessionToken;
        userSession.nickname = result.nickname;
        userSession.accountType = 'registered';

        // 获取完整账号数据
        const newAccount = await accountManager.getAccount(newAccountId);
        if (newAccount) {
          userSession.accountData = newAccount;
        }

        // 存储新的会话
        userManager.socketToAccount.set(socket.id, newAccountId);
        userManager.onlineUsers.set(newAccountId, userSession);
        try { socket.join(newAccountId); } catch (e) { /* 忽略房间加入错误 */ }
      }

      // 广播用户上线
      userManager.broadcastUserStatus(newAccountId, 'online', io);
    }

    // 记录操作日志（注册成功时）
    if (result.success && operationLogger) {
      const registeredId = guestAccountId || result.id;
      const nickname = result.nickname || userSession?.nickname || '';
      operationLogger.log({
        userId: registeredId,
        username: nickname,
        action: 'register',
        category: 'account',
        targetName: username,
        details: { upgraded: !!guestAccountId }
      });
    }

    socket.emit('account_action_result', {
      action: 'register',
      ...result
    });
  });

  // 账号密码登录
  socket.on('account_login', async (data) => {
    const { username, password } = data;
    logger.info('收到账号登录请求', { socketId: socket.id, username });

    const result = await accountManager.accountLogin(username, password);

    if (result.success && result.data) {
      // 获取当前用户会话
      const userSession = userManager.getUserBySocketId(socket.id);
      if (userSession) {
        // 更新用户会话为登录账号
        userSession.accountData = result.data.account;
        userSession.token = result.data.token;
        userSession.nickname = result.data.account.account?.nickname || userSession.nickname;

        // 更新会话映射
        const oldAccountId = userSession.accountId;
        const newAccountId = result.data.account.account.id;

        if (oldAccountId !== newAccountId) {
          userManager.socketToAccount.set(socket.id, newAccountId);
          // 删除匿名会话条目（key 为 socket.id）和旧账号条目
          userManager.onlineUsers.delete(socket.id);
          userManager.onlineUsers.delete(oldAccountId);
          userManager.onlineUsers.set(newAccountId, userSession);
          userSession.accountId = newAccountId;
          try { socket.join(newAccountId); } catch (e) { /* 忽略房间加入错误 */ }
        }

        // 刷新在线用户列表给此客户端（清除旧的匿名条目）
        userManager.sendOnlineUsers(socket, io);

        // 广播用户上线
        userManager.broadcastUserStatus(newAccountId, 'online', io);

        // 检查回归玩家成就
        if (achievementManager) {
          const account = result.data.account;
          const returnPlayer = account.account?.activity?.returnPlayer;
          const longReturnPlayer = account.account?.activity?.longReturnPlayer;

          if (returnPlayer) {
            await achievementManager.checkAndAwardAchievement(newAccountId, 'return_player');
          }
          if (longReturnPlayer) {
            await achievementManager.checkAndAwardAchievement(newAccountId, 'long_return_player');
          }
        }

        // 记录操作日志
        if (operationLogger) {
          operationLogger.getLogin(newAccountId, userSession?.nickname || username, socket.handshake?.address || '');
        }

        logger.info('账号登录成功', {
          socketId: socket.id,
          accountId: newAccountId,
          username
        });
      }
    }

    socket.emit('login_result', result);
  });

  // 游客登录（已弃用，现在自动处理）
  socket.on('guest_login', async () => {
    logger.warn('收到已弃用的guest_login事件', { socketId: socket.id });

    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountData) {
      const account = userSession.accountData;
      const permissions = config.permissions[account.account?.type] || config.permissions.guest;

      // 记录操作日志
      if (operationLogger) {
        operationLogger.getLogin(userSession.accountId, userSession.nickname || '', socket.handshake?.address || '');
      }

      const result = {
        success: true,
        message: '游客登录成功',
        data: {
          account: account,
          permissions: permissions,
          token: userSession.token,
          loginType: 'guest'
        }
      };

      socket.emit('login_result', result);
    } else {
      socket.emit('login_result', {
        success: false,
        message: '游客登录失败，请重新连接'
      });
    }
  });

  // 更新账号资料
  socket.on('account_update_profile', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession) {
      socket.emit('account_action_result', {
        action: 'update_profile',
        success: false,
        message: '用户未登录'
      });
      return;
    }

    const { nickname, profile } = data;
    const result = await accountManager.updateProfile(userSession.accountId, { nickname, profile });

    if (result.success) {
      const account = await accountManager.getAccount(userSession.accountId);
      result.account = account;

      // 更新用户会话
      if (account) {
        userSession.accountData = account;
        userSession.nickname = account.account?.nickname || userSession.nickname;
      }
    }

    socket.emit('account_action_result', {
      action: 'update_profile',
      ...result
    });
  });

  // 修改密码
  socket.on('account_change_password', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession) {
      socket.emit('account_action_result', {
        action: 'change_password',
        success: false,
        message: '用户未登录'
      });
      return;
    }

    const { oldPassword, newPassword } = data;
    const result = await accountManager.changePassword(userSession.accountId, oldPassword, newPassword);
    socket.emit('account_action_result', {
      action: 'change_password',
      ...result
    });
  });

  // 设置密码（用于没有密码的账号首次设置密码）
  socket.on('account_set_password', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession) {
      socket.emit('account_action_result', {
        action: 'set_password',
        success: false,
        message: '用户未登录'
      });
      return;
    }

    const { password } = data;
    const result = await accountManager.setPassword(userSession.accountId, password);
    socket.emit('account_action_result', {
      action: 'set_password',
      ...result
    });
  });

  // 升级为管理员
  socket.on('admin_upgrade_account', async (data) => {
    const { accountId, upgradeKey } = data;

    logger.info('收到升级为管理员请求', {
      socketId: socket.id,
      accountId
    });

    const result = await adminManager.upgradeToAdmin(accountId, upgradeKey);

    socket.emit('admin_upgrade_result', result);
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

    // 创建用户会话，确保后续操作（如转正）能拿到 accountId
    if (result.success && result.data) {
      const accountId = result.data.account?.account?.id || result.data.account?.id;
      if (accountId) {
        let userSession = userManager.getUserBySocketId(socket.id);
        if (!userSession) {
          userSession = {
            socket: socket,
            socketId: socket.id,
            accountId: accountId,
            token: token,
            nickname: result.data.account?.account?.nickname || result.data.account?.nickname || '玩家',
            accountType: result.data.account?.account?.type || 'guest',
            accountData: result.data,
            loginTime: Date.now()
          };
          userManager.socketToAccount.set(socket.id, accountId);
          userManager.onlineUsers.set(accountId, userSession);
          try { socket.join(accountId); } catch (e) { /* 忽略房间加入错误 */ }
        } else {
          userSession.accountData = result.data;
          userSession.token = token;
          userSession.accountId = accountId;
          userManager.socketToAccount.set(socket.id, accountId);
          userManager.onlineUsers.set(accountId, userSession);
          try { socket.join(accountId); } catch (e) { /* 忽略房间加入错误 */ }
        }
      }
    }

    socket.emit('account_info', result);
  });

  // ========== 星钻货币系统 Socket 事件 ==========

  // 获取星钻信息
  socket.on('get_currency', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountId) {
      const result = await accountManager.getCurrency(userSession.accountId);
      socket.emit('currency_info', result);
    }
  });

  // 获取星钻交易记录
  socket.on('get_currency_transactions', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountId) {
      const limit = data?.limit || 50;
      const result = await accountManager.getCurrencyTransactions(userSession.accountId, limit);
      socket.emit('currency_transactions', result);
    }
  });

  // 获取等级奖励
  socket.on('get_level_rewards', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountId) {
      const result = await accountManager.getAvailableLevelRewards(userSession.accountId);
      socket.emit('level_rewards', result);
    }
  });

  // 领取等级奖励
  socket.on('claim_level_rewards', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountId) {
      const result = await accountManager.checkLevelRewards(userSession.accountId);
      socket.emit('level_rewards_claimed', result);
      // 通知客户端账号信息已更新
      if (result.success && result.rewards.length > 0) {
        const updatedAccount = await accountManager.getAccount(userSession.accountId);
        socket.emit('account_updated', { account: updatedAccount });
      }
    }
  });

  // ========== 用户相关事件 ==========

  // 更新用户状态
  socket.on('user_status', (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountId && data.status === 'online') {
      userManager.updateUserStatus(userSession.accountId, 'online', data.game);
      userManager.broadcastUserStatus(userSession.accountId, 'online', io);
    }
  });

  // 获取排行榜
  socket.on('get_leaderboard', async (data) => {
    const limit = data?.limit || 20;
    const gameType = data?.gameType || null;
    const leaderboard = await userManager.getLeaderboard(limit, gameType);
    socket.emit('leaderboard', { leaderboard });
  });

  // 获取当前玩家自己的排名（不在前20时显示）
  socket.on('get_my_rank', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('my_rank', { inTopList: true });
      return;
    }
    const gameType = data?.gameType || 'all';
    // 获取完整榜单（不限量）来判断排名
    const fullLeaderboard = await userManager.getLeaderboard(1000, gameType);
    const myIdx = fullLeaderboard.findIndex(p => p.id === userSession.accountId);
    if (myIdx === -1) {
      socket.emit('my_rank', { inTopList: true });
      return;
    }
    const myRank = myIdx + 1;
    const inTopList = myRank <= 20;
    if (inTopList) {
      socket.emit('my_rank', { inTopList: true });
    } else {
      socket.emit('my_rank', {
        inTopList: false,
        player: fullLeaderboard[myIdx]
      });
    }
  });

  // ========== 反馈相关事件 ==========

  // 获取反馈列表
  socket.on('get_feedbacks', async () => {
    const feedbacks = await feedbackManager.getFeedbackList();
    socket.emit('feedbacks_list', { feedbacks });
  });

  // 提交反馈
  socket.on('submit_feedback', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
      return;
    }

    const result = await feedbackManager.submitFeedback(
      userSession.accountId,
      userSession.nickname,
      data.type,
      data.title,
      data.content
    );

    if (result.success) {
      socket.emit('feedback_submitted', { feedback: result.feedback });
      // 广播给所有用户更新反馈列表
      const allFeedbacks = await feedbackManager.getFeedbackList();
      io.emit('feedbacks_list', { feedbacks: allFeedbacks });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // 投票
  socket.on('vote_feedback', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
      return;
    }

    const result = await feedbackManager.voteFeedback(
      data.feedbackId,
      userSession.accountId,
      data.voteType || 'up'
    );

    if (result.success) {
      socket.emit('feedback_voted', { feedback: result.feedback });
      // 广播给所有用户更新反馈列表
      const allFeedbacks = await feedbackManager.getFeedbackList();
      io.emit('feedbacks_list', { feedbacks: allFeedbacks });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // 添加评论
  socket.on('add_comment', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
      return;
    }

    const result = await feedbackManager.addComment(
      data.feedbackId,
      userSession.accountId,
      data.content
    );

    if (result.success) {
      socket.emit('comment_added', { feedback: result.feedback });
      // 广播给所有用户更新反馈列表
      const allFeedbacks = await feedbackManager.getFeedbackList();
      io.emit('feedbacks_list', { feedbacks: allFeedbacks });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // 楼中楼回复
  socket.on('reply_comment', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
      return;
    }
    const result = await feedbackManager.replyComment(data.feedbackId, data.commentId, userSession.accountId, data.content);
    if (result.success) {
      const allFeedbacks = await feedbackManager.getFeedbackList();
      io.emit('feedbacks_list', { feedbacks: allFeedbacks });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // 评论点赞
  socket.on('like_comment', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
      return;
    }
    const result = await feedbackManager.likeComment(data.feedbackId, data.commentId, userSession.accountId);
    if (result.success) {
      const allFeedbacks = await feedbackManager.getFeedbackList();
      io.emit('feedbacks_list', { feedbacks: allFeedbacks });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // 删除评论
  socket.on('delete_comment', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
      return;
    }
    const result = await feedbackManager.deleteComment(data.feedbackId, data.commentId, userSession.accountId);
    if (result.success) {
      const allFeedbacks = await feedbackManager.getFeedbackList();
      io.emit('feedbacks_list', { feedbacks: allFeedbacks });
    } else {
      socket.emit('error', { message: result.message });
    }
  });

  // 获取成就列表
  socket.on('get_achievements', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountId) {
      const account = await accountManager.getAccount(userSession.accountId);
      if (!account) return;

      const stats = account?.stats || {};
      const activity = account?.account?.activity || {};
      const level = account?.account?.profile?.level || 1;

      // 聚合所有游戏类型的胜利数据和最高分数据
      let bestStreak = 0;
      let bestMaxStreak = 0;
      const gameTypeWins = {};
      const gameTypeHighScores = {};
      if (account?.games) {
        Object.values(account.games).forEach(g => {
          bestStreak = Math.max(bestStreak, g.streak || 0);
          bestMaxStreak = Math.max(bestMaxStreak, g.maxStreak || 0);
        });
        for (const [gameKey, gameData] of Object.entries(account.games)) {
          gameTypeWins[gameKey] = gameData.wins || 0;
          gameTypeHighScores[gameKey] = gameData.highScore || 0;
        }
      }

      // 兼容新旧成就格式：统一转为纯ID数组
      const rawAchievements = account?.achievements || [];
      const userAchievementIds = Array.isArray(rawAchievements)
        ? (rawAchievements.length > 0 && typeof rawAchievements[0] === 'object'
          ? rawAchievements.map(a => a.id)
          : rawAchievements.slice())
        : [];

      const categories = achievementManager.getAchievementsByCategory({
        ...stats,
        ...(stats.flags || {}),       // 展开 flags：firstGame, nightGame 等
        ...activity,                   // activity 字段：chatMessages, dailyGames, weeklyGames, monthlyGames
        level,
        streak: bestStreak,            // 当前连胜
        maxStreak: bestMaxStreak,      // 历史最大连胜
        achievementCount: userAchievementIds.length,
        badges: stats.badges || 0,
        wins: stats.totalWins || 0,
        losses: stats.totalLosses || 0,
        draws: stats.totalDraws || 0,
        gameTypeWins,
        gameTypeHighScores,
      });

      // 为每个成就添加解锁状态
      Object.values(categories).forEach(category => {
        category.achievements.forEach(achievement => {
          achievement.isUnlocked = userAchievementIds.includes(achievement.id);
        });
      });

      const totalAchievements = achievementManager.achievements.length;
      socket.emit('achievements_list', { categories, userAchievements: userAchievementIds, totalAchievements });
    }
  });

  // 获取游戏历史
  socket.on('get_game_history', async (data) => {
    const userSession = userManager.getUserBySocketId(socket.id);
    if (userSession && userSession.accountId) {
      const limit = data?.limit || 10;
      const history = await gameManager.getGameHistory(userSession.accountId, limit);
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
    if (checkMaintenance()) return;
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
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
    if (checkMaintenance()) return;
    const userSession = userManager.getUserBySocketId(socket.id);
    if (!userSession || !userSession.accountId) {
      socket.emit('error', { message: '请先登录' });
      return;
    }
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
  socket.on('move', async (data) => {
    const success = await gameManager.handleMove(socket.id, data, io);
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
  socket.on('game_result', async (data) => {
    const success = await gameManager.handleGameResult(socket.id, data, io);
    if (!success) {
      socket.emit('error', { message: '无效的游戏结果' });
    }
  });

  // ========== 游戏内道具使用事件 ==========

  // 游戏内使用道具（悔棋卡/提示卡）
  socket.on('game_use_item', async (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user || !user.accountId) {
      socket.emit('error', { message: '用户未登录' });
      return;
    }
    const { itemId } = data;
    if (!itemId) {
      socket.emit('error', { message: '参数错误' });
      return;
    }
    const result = await accountManager.useItem(user.accountId, itemId, 1);
    if (result.success) {
      const invResult = await accountManager.getInventory(user.accountId);
      const inv = invResult?.inventory || {};
      socket.emit('game_item_used', {
        success: true,
        itemId,
        undoCount: inv.undoCount || 0,
        hintCount: inv.hintCount || 0,
        items: inv.items || {}
      });
    } else {
      socket.emit('game_item_used', {
        success: false,
        itemId,
        message: result.message || '使用道具失败'
      });
    }
  });

  // ========== 悔棋相关事件 ==========

  // 请求悔棋
  socket.on('undo_request', () => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }
    gameManager.handleUndoRequest(socket.id, io);
  });

  // 回应悔棋请求（同意或拒绝）
  socket.on('undo_response', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }
    const { accepted } = data;
    gameManager.handleUndoResponse(socket.id, accepted, io);
  });

  // ========== 提示卡相关事件 ==========

  // 请求提示
  socket.on('request_hint', async () => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }
    await gameManager.handleHintRequest(socket.id, io);
  });

  // ========== AI对战相关事件 ==========

  // 开始AI对战
  socket.on('ai_game_start', (data) => {
    if (checkMaintenance()) return;
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const { gameType, difficulty } = data;

    const success = gameManager.createAIGame(user.accountId, gameType, difficulty, io);
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

    const success = await gameManager.handleAIMove(user.accountId, position, io);
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
      await gameManager.endAIGame(user.accountId, result, io);

      // 注意：endAIGame内部已经处理了用户统计更新

      logger.info('AI游戏结束', {
        accountId: user.accountId,
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

  // 贪吃蛇游戏更新
  socket.on('snake_update', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) return;

    const { matchId, playerId, snake, direction, score } = data;

    try {
      // 获取游戏
      let game = snakeGames.get(matchId);
      if (!game) {
        game = {
          matchId,
          player1: null,
          player2: null,
          player1Snake: null,
          player2Snake: null,
          player1Score: 0,
          player2Score: 0,
          foods: data.foods || [],
          gameTimeLeft: 120,
          startTime: Date.now()
        };
        snakeGames.set(matchId, game);
      }

      // 更新玩家数据
      let isNewPlayer = false;

      // 确保playerId是字符串类型
      const stringPlayerId = String(playerId);
      const gamePlayer1 = game.player1 !== null ? String(game.player1) : null;
      const gamePlayer2 = game.player2 !== null ? String(game.player2) : null;

      if (gamePlayer1 === null) {
        game.player1 = stringPlayerId;
        game.player1Snake = snake;
        game.player1Score = score;
        game.foods = data.foods || game.foods;
        game.gameTimeLeft = data.gameTimeLeft !== undefined ? data.gameTimeLeft : game.gameTimeLeft;
        isNewPlayer = true;
      } else if (gamePlayer1 === stringPlayerId) {
        game.player1Snake = snake;
        game.player1Score = score;
        game.foods = data.foods || game.foods;
        game.gameTimeLeft = data.gameTimeLeft !== undefined ? data.gameTimeLeft : game.gameTimeLeft;
      }

      if (gamePlayer2 === null && stringPlayerId !== gamePlayer1) {
        game.player2 = stringPlayerId;
        game.player2Snake = snake;
        game.player2Score = score;
        game.foods = data.foods || game.foods;
        game.gameTimeLeft = data.gameTimeLeft !== undefined ? data.gameTimeLeft : game.gameTimeLeft;
        isNewPlayer = true;
      } else if (gamePlayer2 === stringPlayerId) {
        game.player2Snake = snake;
        game.player2Score = score;
        game.foods = data.foods || game.foods;
        game.gameTimeLeft = data.gameTimeLeft !== undefined ? data.gameTimeLeft : game.gameTimeLeft;
      }

      // 如果是新玩家加入，同步双方状态
      if (isNewPlayer && game.player1 && game.player2) {
        // 通知玩家1关于玩家2的状态
        const player1User = userManager.getUserByAccountId(game.player1);
        if (player1User && player1User.socketId) {
          const player1Socket = io.sockets.sockets.get(player1User.socketId);
          if (player1Socket) {
            player1Socket.emit('snake_opponent_update', {
              snake: game.player2Snake,
              score: game.player2Score,
              foods: game.foods,
              gameTimeLeft: game.gameTimeLeft
            });
          }
        }

        // 通知玩家2关于玩家1的状态
        const player2User = userManager.getUserByAccountId(game.player2);
        if (player2User && player2User.socketId) {
          const player2Socket = io.sockets.sockets.get(player2User.socketId);
          if (player2Socket) {
            player2Socket.emit('snake_opponent_update', {
              snake: game.player1Snake,
              score: game.player1Score,
              foods: game.foods,
              gameTimeLeft: game.gameTimeLeft
            });
          }
        }
      }

      // 转发更新给对手
      const opponentId = String(game.player1) === String(playerId) ? game.player2 : game.player1;

      if (opponentId) {
        try {
          // 直接通过userManager查找对手socket并发送更新
          const opponentUser = userManager.getUserByAccountId(opponentId);
          if (opponentUser && opponentUser.socketId) {
            const opponentSocket = io.sockets.sockets.get(opponentUser.socketId);
            if (opponentSocket) {
              const opponentSnake = String(game.player1) === String(opponentId) ? game.player1Snake : game.player2Snake;
              const opponentScore = String(game.player1) === String(opponentId) ? game.player1Score : game.player2Score;

              opponentSocket.emit('snake_opponent_update', {
                snake: snake,
                score: score,
                foods: game.foods,
                gameTimeLeft: game.gameTimeLeft,
                opponentSnake: opponentSnake,
                opponentScore: opponentScore
              });
            }
          }
        } catch (err) {
          logger.error('转发贪吃蛇更新失败', { error: err.message });
        }
      }

    } catch (err) {
      logger.error('处理贪吃蛇更新失败', { error: err.message });
    }
  });

  // 贪吃蛇食物更新
  socket.on('snake_food_update', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) return;

    const { matchId, playerId, foods } = data;

    try {
      // 获取游戏
      const game = snakeGames.get(matchId);
      if (!game) return;

      // 验证玩家身份
      if (game.player1 !== playerId && game.player2 !== playerId) return;

      // 更新食物状态
      game.foods = foods;

      // 转发食物更新给对手
      const opponentId = game.player1 === playerId ? game.player2 : game.player1;
      if (opponentId) {
        const opponentUser = userManager.getUserByAccountId(opponentId);
        if (opponentUser && opponentUser.socketId) {
          const opponentSocket = io.sockets.sockets.get(opponentUser.socketId);
          if (opponentSocket) {
            opponentSocket.emit('snake_food_sync', {
              foods: game.foods
            });
          }
        }
      }

    } catch (err) {
      logger.error('处理贪吃蛇食物更新失败', { error: err.message });
    }
  });

  // 贪吃蛇全量状态请求
  socket.on('snake_request_full_state', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) return;

    const { matchId } = data;

    try {
      // 获取游戏
      const game = snakeGames.get(matchId);
      if (!game) return;

      // 确定玩家身份
      const isPlayer1 = game.player1 === user.accountId;
      const isPlayer2 = game.player2 === user.accountId;

      if (!isPlayer1 && !isPlayer2) return;

      // 发送全量状态
      socket.emit('snake_full_state_sync', {
        isPlayer1: isPlayer1,
        player1Snake: game.player1Snake,
        player1Score: game.player1Score,
        player2Snake: game.player2Snake,
        player2Score: game.player2Score,
        foods: game.foods,
        gameTimeLeft: game.gameTimeLeft
      });

    } catch (err) {
      logger.error('处理贪吃蛇全量状态请求失败', { error: err.message });
    }
  });

  // 贪吃蛇游戏开始
  socket.on('snake_game_start', (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user) {
      socket.emit('error', { message: '用户不存在' });
      return;
    }

    const accountId = user.accountId;
    const { gameType } = data;

    try {
      logger.info('贪吃蛇游戏开始', {
        accountId: user.accountId,
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

    const accountId = user.accountId;
    const { score, highScore: clientHighScore, gameType, moveHistory } = data;

    try {
      // 记录游戏结束日志（无论用户是否登录）
      logger.info('贪吃蛇游戏结束', {
        accountId: user.accountId,
        score,
        moveCount: moveHistory ? moveHistory.length : 0
      });

      // 保存游戏记录
      if (gameManager && gameManager.saveSnakeGameRecord) {
        await gameManager.saveSnakeGameRecord({
          accountId: user.accountId,
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
          // 读取当前值，计算新值
          const currentSnake = account.games.snake || {};
          const currentScore = currentSnake.totalScore || 0;
          const currentGames = currentSnake.totalGames || 0;
          const currentHigh = currentSnake.highScore || 0;
          const currentSnakeStats = account.stats?.snakeGames || {};

          const newHighScore = Math.max(
            score || 0,
            clientHighScore || 0,
            currentHigh
          );

          // 只更新具体字段，避免覆盖 security 等敏感字段
          const snakeUpdates = {
            'games.snake.totalGames': currentGames + 1,
            'games.snake.totalScore': currentScore + score,
            'games.snake.highScore': newHighScore,
            'games.snake.lastPlayedAt': Date.now(),
            'stats.totalScore': (account.stats?.totalScore || 0) + score
          };

          if (newHighScore > currentHigh) {
            snakeUpdates['stats.snakeGames.totalGames'] = (currentSnakeStats.totalGames || 0) + 1;
            snakeUpdates['stats.snakeGames.totalScore'] = (currentSnakeStats.totalScore || 0) + score;
            snakeUpdates['stats.snakeGames.highScore'] = newHighScore;

            // 记录新高分
            logger.info('贪吃蛇游戏新高分', {
              accountId: user.accountId,
              score: newHighScore
            });
          }

          await gameManager.accountManager.updateUser(accountId, snakeUpdates);

          // 更新游戏统计数据（用于排行榜）
          // 贪吃蛇游戏：如果分数大于100，则认为是获胜
          const result = score > config.snakeRewards.winScoreThreshold ? 'win' : 'loss';
          await gameManager.accountManager.updateGameStats(accountId, result, 'snake', false, null, null);

          // 给予经验值奖励（基于分数）
          if (gameManager.accountManager) {
            const expReward = config.snakeRewards.baseExp + Math.floor((score || 0) / config.snakeRewards.expPerScoreDivisor);
            if (expReward > 0) {
              const expResult = await gameManager.accountManager.addExp(accountId, expReward);
              if (expResult.success) {
                socket.emit('exp_gained', { expResult });
              }
            }
          }

          // 通知客户端账号数据已更新（使用 getAccount 重新读取，自动剥离 security）
          const updatedAccount = await gameManager.accountManager.getAccount(accountId);
          socket.emit('account_updated', { account: updatedAccount });
        }
      }

      // 检查成就（如果用户已登录）
      if (accountId && gameManager.achievementManager) {
        // 读取更新后的账号数据，构建完整 stats 供成就检查
        const postAccount = await gameManager.accountManager.getAccount(accountId);
        if (postAccount) {
          const snakeLevel = postAccount.account?.profile?.level || 1;
          const isWinner = score > config.snakeRewards.winScoreThreshold;
          const playedGameTypes = postAccount.games ? Object.keys(postAccount.games).filter(k => postAccount.games[k].totalGames > 0).length : 0;

          // 聚合所有游戏类型的连胜数据和最高分
          let snakeBestStreak = 0;
          let snakeBestMaxStreak = 0;
          const gameTypeWins = {};
          const gameTypeHighScores = {};
          if (postAccount.games) {
            Object.values(postAccount.games).forEach(g => {
              snakeBestStreak = Math.max(snakeBestStreak, g.streak || 0);
              snakeBestMaxStreak = Math.max(snakeBestMaxStreak, g.maxStreak || 0);
            });
            for (const [gk, gd] of Object.entries(postAccount.games)) {
              gameTypeWins[gk] = gd.wins || 0;
              gameTypeHighScores[gk] = gd.highScore || 0;
            }
          }
        }

        await gameManager.achievementManager.checkAchievements(accountId, {
          ...postAccount.stats,
          ...(postAccount.stats?.flags || {}),
          // 用当前游戏时间覆盖持久标志位
          nightGame: (() => { const h = new Date().getHours(); return h >= 2 && h <= 6; })(),
          weekendGame: (() => { const d = new Date().getDay(); return d === 0 || d === 6; })(),
          ...(postAccount.account?.activity || {}),
          gameType: 'snake',
          score: score,
          level: snakeLevel,
          streak: snakeBestStreak,
          maxStreak: snakeBestMaxStreak,
          result: isWinner ? 'win' : 'loss',
          silentWin: true,
          lonerWin: true,
          allGameTypes: playedGameTypes >= 3,
          singleGameType: playedGameTypes === 1 && (postAccount.stats?.totalGames || 0) > 1,
          quickGame: score < 50,
          slowGame: score > 300,
          maxMoves: moveHistory ? moveHistory.length : 0,
          wins: postAccount.stats?.totalWins || 0,
          losses: postAccount.stats?.totalLosses || 0,
          draws: postAccount.stats?.totalDraws || 0,
          gameTypeWins,
          gameTypeHighScores,
          timestamp: Date.now()
        });
      }


    } catch (err) {
      logger.error('处理贪吃蛇游戏结果失败', { error: err.message });
    }
  });

  // 同步贪吃蛇最高分（客户端进入贪吃蛇页面时触发）
  socket.on('snake_sync_highscore', async (data) => {
    const user = userManager.getUserBySocketId(socket.id);
    if (!user || !user.accountId) {
      return; // 未登录用户不处理
    }

    const clientHighScore = data?.highScore || 0;
    if (clientHighScore <= 0) return;

    try {
      const account = await gameManager.accountManager.getAccount(user.accountId);
      if (account) {
        const currentHighScore = account.games.snake?.highScore || 0;

        if (clientHighScore > currentHighScore) {
          // 只更新具体字段，避免覆盖 security
          const updates = {
            'games.snake.highScore': clientHighScore,
            'stats.snakeGames.highScore': clientHighScore
          };
          await gameManager.accountManager.updateUser(user.accountId, updates);

          logger.info('贪吃蛇高分已同步', {
            accountId: user.accountId,
            highScore: clientHighScore,
            previousHighScore: currentHighScore
          });

          // 通知客户端账号数据已更新
          const updatedAccount = await gameManager.accountManager.getAccount(user.accountId);
          socket.emit('account_updated', { account: updatedAccount });
        }
      }
    } catch (err) {
      logger.error('同步贪吃蛇高分失败', { error: err.message });
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
    const result = gameManager.addSpectator(gameId, user.accountId, io);

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
      gameManager.removeSpectator(user.game, user.accountId, io);
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
    if (config.system.maintenanceEnabled && config.system.maintenanceBlockChat && !adminManager.isAdmin(socket)) {
      socket.emit('chat_error', { message: config.system.maintenanceMessage || '系统维护中' });
      return;
    }
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
    if (config.system.maintenanceEnabled && config.system.maintenanceBlockChat && !adminManager.isAdmin(socket)) {
      socket.emit('chat_error', { message: config.system.maintenanceMessage || '系统维护中' });
      return;
    }
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
    if (config.system.maintenanceEnabled && config.system.maintenanceBlockChat && !adminManager.isAdmin(socket)) {
      socket.emit('chat_error', { message: config.system.maintenanceMessage || '系统维护中' });
      return;
    }
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

  // ========== 全量操作追踪中间件 ==========
  // 自动记录所有 Socket 事件（排除高频噪音），用于异常排查和路径回放
  const TRACE_ACTIONS = new Set([
    // 游戏操作
    'move', 'ai_move', 'game_result', 'ai_game_result', 'reset', 'reset_confirm', 'reset_reject',
    'match_request', 'cancel_match', 'challenge_request', 'challenge_response',
    'return_lobby', 'undo_request', 'undo_response', 'request_hint', 'game_use_item',
    'ai_game_start',
    // 观战
    'spectate_join', 'spectate_leave', 'get_spectate_list',
    // 账号
    'client_connect', 'account_login', 'guest_login', 'account_register',
    'account_update_profile', 'account_change_password', 'account_set_password',
    'account_reset_password',
    // 贪吃蛇
    'snake_game_start', 'snake_game_end', 'snake_sync_highscore', 'snake_request_full_state',
    // 聊天
    'chat_global', 'chat_game', 'chat_private',
    // 反馈
    'submit_feedback', 'vote_feedback', 'add_comment', 'reply_comment', 'like_comment', 'delete_comment'
  ]);

  socket.use(([event, ...args], next) => {
    if (TRACE_ACTIONS.has(event)) {
      const user = getSocketUser();
      if (user) {
        const data = args[0] || {};
        operationLogger.logSocketEvent(user.userId, user.username, event, data).catch(() => { });
      }
    }
    next();
  });

  // ========== 断开连接 ==========

  socket.on('disconnect', (reason) => {
    logger.disconnectEvent(socket.id, { reason });

    // 处理游戏断开（包含等待队列清理）
    gameManager.handleUserDisconnect(socket.id, io);

    // 处理用户断开
    userManager.handleUserDisconnect(socket.id, io);
  });
});

// ========== 管理员命名空间 ==========

const adminNamespace = io.of('/admin');

adminNamespace.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.query.token;
  // 允许不带 token 的连接（用于账号登录）
  if (!token) {
    return next();
  }
  if (adminManager.verifyToken(token)) {
    next();
  } else {
    next(new Error('认证失败'));
  }
});

adminNamespace.on('connection', (socket) => {
  logger.info('管理员连接', { socketId: socket.id });

  const token = socket.handshake.auth.token || socket.handshake.query.token;

  // 如果有 token，直接使用 token 登录
  if (token) {
    adminManager.handleAdminConnection(socket, token, io);
  }

  // 处理账号登录请求
  socket.on('admin_account_login', async (data) => {
    const { username, password } = data;

    logger.info('收到后台账号登录请求', {
      socketId: socket.id,
      username
    });

    const result = await adminManager.verifyAccountLogin(username, password);

    if (result.success) {
      // 登录成功，发送结果和 token
      socket.emit('admin_login_result', {
        success: true,
        token: result.token,
        account: result.account
      });

      // 使用新 token 建立管理员连接
      adminManager.handleAdminConnection(socket, result.token, io);
    } else {
      // 登录失败
      socket.emit('admin_login_result', {
        success: false,
        message: result.message
      });
    }
  });

  // 通过普通用户的 userToken 自动登录（从游戏大厅/个人资料页跳转的管理员）
  socket.on('admin_user_token_login', async (data) => {
    const { userToken } = data;

    logger.info('收到通过用户Token自动登录请求', {
      socketId: socket.id,
      hasToken: !!userToken
    });

    if (!userToken) {
      socket.emit('admin_login_result', {
        success: false,
        message: '缺少用户Token'
      });
      return;
    }

    // 验证用户Token并获取账号信息
    const accountResult = await adminManager.verifyUserTokenAndGetAdminAccount(userToken);

    if (accountResult.success) {
      // 登录成功，发送结果和 token
      socket.emit('admin_login_result', {
        success: true,
        token: accountResult.token,
        account: accountResult.account,
        isAutoLogin: true
      });

      // 使用新 token 建立管理员连接
      adminManager.handleAdminConnection(socket, accountResult.token, io);
      logger.info('通过用户Token自动登录成功', {
        socketId: socket.id,
        username: accountResult.account?.account?.username || accountResult.account?.username
      });
    } else {
      // 登录失败
      socket.emit('admin_login_result', {
        success: false,
        message: accountResult.message
      });
    }
  });

  // 踢出用户
  socket.on('kick_user', (data) => {
    const { accountId, reason } = data;
    adminManager.kickUser(socket, accountId, reason);
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

  // 获取最近游戏（仪表盘用，仅最近8条）
  socket.on('get_recent_games', () => {
    adminManager.getRecentGames(socket);
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
    const { enabled, message, durationMinutes = 0, blockChat = false, kick = true } = data || {};
    adminManager.setMaintenanceMode(socket, enabled, { message, durationMinutes, blockChat, kick }, io);
  });

  // 调度维护（预告模式）
  socket.on('maintenance_schedule', (data) => {
    adminManager.scheduleMaintenance(socket, data || {}, io);
  });

  // 获取维护历史
  socket.on('get_maintenance_history', () => {
    adminManager.getMaintenanceHistory(socket);
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
    const { accountId, duration, reason } = data;
    adminManager.muteUser(socket, accountId, duration, reason);
  });

  // 解除禁言
  socket.on('unmute_user', (data) => {
    const { accountId } = data;
    adminManager.unmuteUser(socket, accountId);
  });

  // 获取用户详情
  socket.on('get_user_detail', (data) => {
    const { accountId } = data;
    adminManager.getUserDetail(socket, accountId);
  });

  // 获取用户游戏历史
  socket.on('get_user_game_history', (data) => {
    const { accountId, limit } = data;
    adminManager.getUserGameHistory(socket, accountId, limit);
  });

  // 获取聊天记录
  socket.on('get_chat_history_admin', (data) => {
    adminManager.getChatHistory(socket, data);
  });

  // 给特定用户发送消息
  socket.on('send_user_message', (data) => {
    const { accountId, message } = data;
    adminManager.sendUserMessage(socket, accountId, message);
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

  // 升级为管理员
  socket.on('upgrade_to_admin', (data) => {
    const { accountId } = data;
    adminManager.upgradeToAdmin(socket, accountId);
  });

  // 降级管理员
  socket.on('downgrade_from_admin', (data) => {
    const { accountId } = data;
    adminManager.downgradeFromAdmin(socket, accountId);
  });

  // 封禁账号
  socket.on('ban_account', (data) => {
    const { accountId, reason } = data;
    adminManager.banAccount(socket, accountId, reason);
  });

  // 解封账号
  socket.on('unban_account', (data) => {
    const { accountId } = data;
    adminManager.unbanAccount(socket, accountId);
  });

  // 重置密码
  socket.on('reset_password', (data) => {
    const { accountId, password } = data;
    adminManager.resetPassword(socket, accountId, password);
  });

  // 创建账号
  socket.on('create_account', (data) => {
    const { username, password, nickname, isAdmin } = data;
    adminManager.createAccount(socket, username, password, nickname, isAdmin);
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

  // ========== 邮件系统 & 物品发放 ==========

  // 给用户发送邮件（带物品/星钻/经验）
  socket.on('send_mail_to_user', (data) => {
    adminManager.sendMailToUser(socket, data);
  });

  // 批量发送邮件给多个用户
  socket.on('send_mail_batch', (data) => {
    adminManager.sendMailToMultiple(socket, data);
  });

  // 发送全站邮件
  socket.on('send_mail_all', (data) => {
    adminManager.sendMailToAllUsers(socket, data);
  });

  // 直接发放星钻（立即到账）
  socket.on('grant_starcoins', (data) => {
    const { id, amount, reason } = data;
    adminManager.grantStarCoinsToUser(socket, id, Number(amount), reason || '管理员发放');
  });

  // 直接发放经验
  socket.on('grant_exp', (data) => {
    const { id, amount, reason } = data;
    adminManager.grantExpToUser(socket, id, Number(amount), reason || '管理员发放');
  });

  // 直接发放物品
  socket.on('grant_items', (data) => {
    const { id, items } = data;
    adminManager.grantItemsToUser(socket, id, items);
  });

  // 获取用户邮件列表（管理员查看）
  socket.on('get_user_mails', (data) => {
    const { id } = data;
    adminManager.getUserMails(socket, id);
  });

  // 获取物品列表
  socket.on('get_items_list', () => {
    adminManager.getItemsList(socket);
  });

  // 获取用户选择列表
  socket.on('get_users_select_list', (data) => {
    adminManager.getUsersForSelect(socket, data.keyword);
  });

  // 获取经验值获取记录
  socket.on('get_exp_records', (data) => {
    adminManager.getExpRecords(socket, data || {});
  });

  // 获取星钻获取/消费记录
  socket.on('get_coin_records', (data) => {
    adminManager.getCoinRecords(socket, data || {});
  });

  // 获取邮件发送/领取记录
  socket.on('get_mail_records', (data) => {
    adminManager.getMailRecords(socket, data || {});
  });

  // ========== 系统设置管理 ==========
  // 获取所有可编辑的系统设置
  socket.on('get_system_settings', () => {
    try {
      if (!adminManager.checkAdminAuth(socket)) return;
      const settings = runtimeConfig.getAllSettings();
      const categories = runtimeConfig.getCategories();
      socket.emit('system_settings', { success: true, settings, categories });
    } catch (err) {
      logger.error('获取系统设置失败', { error: err.message });
      socket.emit('system_settings', { success: false, error: err.message });
    }
  });

  // 更新单个系统设置
  socket.on('update_system_setting', (data) => {
    try {
      if (!adminManager.checkAdminAuth(socket)) return;
      const { key, value } = data || {};
      if (!key) {
        socket.emit('setting_updated', { success: false, error: '缺少配置项key' });
        return;
      }
      const result = runtimeConfig.updateSetting(key, value);
      socket.emit('setting_updated', result);
    } catch (err) {
      logger.error('更新系统设置失败', { error: err.message });
      socket.emit('setting_updated', { success: false, error: err.message });
    }
  });

  // 重置单个设置为默认值
  socket.on('reset_system_setting', (data) => {
    try {
      if (!adminManager.checkAdminAuth(socket)) return;
      const { key } = data || {};
      if (!key) {
        socket.emit('setting_reset', { success: false, error: '缺少配置项key' });
        return;
      }
      const result = runtimeConfig.resetSetting(key);
      socket.emit('setting_reset', result);
    } catch (err) {
      logger.error('重置系统设置失败', { error: err.message });
      socket.emit('setting_reset', { success: false, error: err.message });
    }
  });

  // 重置所有设置为默认值
  socket.on('reset_all_settings', () => {
    try {
      if (!adminManager.checkAdminAuth(socket)) return;
      const result = runtimeConfig.resetAllSettings();
      socket.emit('all_settings_reset', result);
    } catch (err) {
      logger.error('重置所有系统设置失败', { error: err.message });
      socket.emit('all_settings_reset', { success: false, error: err.message });
    }
  });

  // ========== 实时日志 ==========
  socket.on('subscribe_logs', () => {
    if (!adminManager.checkAdminAuth(socket)) return;
    adminManager.subscribeLogs(socket);
  });

  socket.on('unsubscribe_logs', () => {
    adminManager.unsubscribeLogs(socket);
  });

  socket.on('get_log_files', () => {
    if (!adminManager.checkAdminAuth(socket)) return;
    adminManager.getLogFiles(socket);
  });

  socket.on('read_log_file', (data) => {
    if (!adminManager.checkAdminAuth(socket)) return;
    adminManager.readLogFile(socket, data?.filename, data?.lines || 200);
  });

  // ========== 系统更新 ==========
  socket.on('get_update_status', () => {
    if (!adminManager.checkAdminAuth(socket)) return;
    socket.emit('update_status', updateManager.getPublicStatus());
  });

  socket.on('update_upload_chunk', async (data) => {
    if (!adminManager.checkAdminAuth(socket)) return;
    try {
      const result = await updateManager.saveUploadedChunk(
        Buffer.from(data.chunk), data.index, data.total, data.uploadId
      );
      socket.emit('update_upload_progress', result);
    } catch (err) {
      socket.emit('update_upload_error', { message: err.message });
    }
  });

  socket.on('update_start_upload', async (data) => {
    if (!adminManager.checkAdminAuth(socket)) return;
    try {
      if (!config.update.enabled) {
        return socket.emit('update_error', { message: '更新功能未启用' });
      }
      if (updateManager.status && updateManager.status.status === 'in_progress') {
        return socket.emit('update_error', { message: '已有更新正在进行中' });
      }
      const result = await updateManager.assembleUpload(
        data.uploadId, data.filename, data.size, data.hash
      );
      socket.emit('update_upload_ready', { size: result.size });
    } catch (err) {
      socket.emit('update_error', { message: err.message });
    }
  });

  socket.on('update_start', () => {
    if (!adminManager.checkAdminAuth(socket)) return;
    try {
      if (!config.update.enabled) {
        return socket.emit('update_error', { message: '更新功能未启用' });
      }
      if (updateManager.status && updateManager.status.status === 'in_progress') {
        return socket.emit('update_error', { message: '已有更新正在进行中' });
      }
      socket.emit('update_started', { message: '更新开始执行' });
      updateManager.startUpdate().catch(err => {
        logger.error('更新执行失败', { error: err.message });
      });
    } catch (err) {
      socket.emit('update_error', { message: err.message });
    }
  });

  socket.on('update_cancel', () => {
    if (!adminManager.checkAdminAuth(socket)) return;
    try {
      updateManager.cancelUpdate();
      socket.emit('update_cancelled', { message: '更新已取消' });
    } catch (err) {
      socket.emit('update_error', { message: err.message });
    }
  });

  socket.on('update_rollback', (data) => {
    if (!adminManager.checkAdminAuth(socket)) return;
    try {
      if (!data || !data.backupName) {
        return socket.emit('update_error', { message: '请指定要回滚的备份' });
      }
      socket.emit('update_rollback_started', { message: '开始回滚，服务将重启' });
      updateManager.manualRollback(data.backupName).catch(err => {
        logger.error('回滚失败', { error: err.message });
      });
    } catch (err) {
      socket.emit('update_error', { message: err.message });
    }
  });

  socket.on('update_delete_backup', (data) => {
    if (!adminManager.checkAdminAuth(socket)) return;
    try {
      if (!data || !data.backupName) return;
      updateManager.deleteBackup(data.backupName);
      socket.emit('update_backup_deleted', { backupName: data.backupName });
      socket.emit('update_status', updateManager.getPublicStatus());
    } catch (err) {
      socket.emit('update_error', { message: err.message });
    }
  });

  // ========== 管理员操作追踪中间件 ==========
  const TRACE_ADMIN_EVENTS = new Set([
    'admin_account_login', 'admin_user_token_login',
    'kick_user', 'end_game', 'broadcast', 'reset_game',
    'update_config', 'maintenance_mode', 'maintenance_schedule',
    'mute_user', 'unmute_user', 'delete_account',
    'modify_user_exp', 'grant_starcoins', 'grant_exp', 'grant_items',
    'send_mail_to_user', 'send_mail_batch', 'send_mail_all',
    'add_user_achievement', 'remove_user_achievement', 'reset_user_achievements',
    'cleanup_data',
    'update_backup_db', 'update_restore_backup', 'update_apply_update',
    'update_upload_package', 'update_set_channel', 'update_delete_backup'
  ]);

  socket.use(([event, ...args], next) => {
    if (TRACE_ADMIN_EVENTS.has(event)) {
      const adminInfo = adminManager.adminSockets.get(socket.id);
      if (adminInfo) {
        const data = args[0] || {};
        operationLogger.logSocketEvent(adminInfo.accountId || '', adminInfo.username || '管理员', event, data, { category: 'admin' }).catch(() => { });
      }
    }
    next();
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

// 每天0点检查邮件触发器（VIP每日礼包等）
// 计算到下一个0点的时间，用 setTimeout 递归，避免 setInterval 频繁检查
function scheduleDailyMailTrigger() {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0); // 下一个0点
  const delay = nextMidnight.getTime() - now.getTime();

  logger.info('邮件触发器-每日任务已计划', {
    nextRunAt: nextMidnight.toLocaleString('zh-CN', { hour12: false }),
    delayMinutes: Math.round(delay / 60000)
  });

  setTimeout(async () => {
    if (!accountManager || !accountManager.checkAndSendAllTriggers) return;
    try {
      const results = await accountManager.checkAndSendAllTriggers();
      logger.info('邮件触发器-每日任务执行完成', {
        vipDailySent: results.vipDaily?.sent || 0,
        vipDailyTotal: results.vipDaily?.total || 0
      });
    } catch (err) {
      logger.error('邮件触发器-每日任务执行失败', { error: err.message });
    }
    // 递归调用，计划下一天的0点
    scheduleDailyMailTrigger();
  }, delay);
}
scheduleDailyMailTrigger();

// ========== 启动服务器 ==========

const PORT = config.server.port;
const HOST = config.server.host;

server.listen(PORT, HOST, async () => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }

  const displayHost = addresses.length > 0 ? addresses[0] : 'localhost';

  let accountCount = 0;
  let gameCount = 0;
  let chatCount = 0;
  let mailCount = 0;
  let inventoryCount = 0;
  try {
    const accounts = await dataStore.read('accounts');
    accountCount = accounts.length;
    const games = await dataStore.read('games');
    gameCount = games.length;
    const chats = await dataStore.read('chats');
    chatCount = chats.length;
    const mails = await dataStore.read('mails');
    mailCount = mails.length;
    const inventory = await dataStore.read('inventory');
    inventoryCount = inventory.length;
  } catch (e) {
    // 数据文件可能不存在
  }

  const memoryUsage = process.memoryUsage();
  const memoryMB = Math.round(memoryUsage.rss / 1024 / 1024);
  const heapMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

  logger.info('服务器启动成功', {
    port: PORT,
    host: HOST,
    env: config.server.env,
    version: versionManager.getServerVersion(),
    accounts: accountCount,
    games: gameCount,
    chats: chatCount,
    mails: mailCount,
    inventory: inventoryCount,
    memoryMB: memoryMB,
    heapMB: heapMB,
    nodeVersion: process.version,
    platform: process.platform
  });

  console.log(`=================================`);
  console.log(`🎮 游戏服务器已启动`);
  console.log(`📍 地址: http://${displayHost}:${PORT}`);
  console.log(`🔧 管理后台: http://${displayHost}:${PORT}/admin`);
  console.log(`=================================`);
  console.log(`📊 数据统计: ${accountCount} 账号 | ${gameCount} 对局 | ${chatCount} 聊天 | ${mailCount} 邮件`);
  console.log(`💾 内存占用: ${memoryMB}MB (Heap: ${heapMB}MB)`);
  console.log(`=================================`);

  if (addresses.length > 1) {
    console.log(`📶 其他可用地址:`);
    addresses.slice(1).forEach(addr => {
      console.log(`   - http://${addr}:${PORT}`);
    });
  }

  // 服务器启动后立即检查一次邮件触发器（VIP每日礼包等）
  setTimeout(async () => {
    if (!accountManager || !accountManager.checkAndSendAllTriggers) return;
    try {
      const results = await accountManager.checkAndSendAllTriggers();
      logger.info('服务器启动-邮件触发器执行完成', {
        vipDailySent: results.vipDaily?.sent || 0,
        vipDailyTotal: results.vipDaily?.total || 0
      });
    } catch (err) {
      logger.error('服务器启动-邮件触发器执行失败', { error: err.message });
    }
  }, 3000);

  // 启动后检查更新状态（重启后验证更新是否成功）
  setTimeout(() => {
    updateManager.verifyStartup().catch(err => {
      logger.error('更新状态验证失败', { error: err.message });
    });
  }, 5000);
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
  // 不退出进程，让服务端继续运行。只记录详细错误日志便于排查。
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('未处理的Promise拒绝', { reason, promise });
});
