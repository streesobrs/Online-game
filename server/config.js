// 服务器配置文件
const path = require('path');

// 获取数据存储的根目录（兼容开发和打包环境）
function getStorageRoot() {
  // 优先使用环境变量
  if (process.env.STORAGE_ROOT) {
    return process.env.STORAGE_ROOT;
  }

  // 检测是否是 pkg 打包环境
  const isPkg = typeof process.pkg !== 'undefined';

  if (isPkg) {
    // pkg 打包环境：使用程序所在目录
    return path.dirname(process.execPath);
  } else {
    // 开发环境：使用项目根目录
    return path.join(__dirname, '..');
  }
}

const storageRoot = getStorageRoot();

module.exports = {
  // 版本号 (语义化版本：MAJOR.MINOR.PATCH)
  version: '1.2.0',

  // 服务器配置
  server: {
    port: process.env.PORT || 8080,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  // 管理员配置
  admin: {
    token: process.env.ADMIN_TOKEN || 'admin-secret-token',
    updateInterval: 2000, // 管理后台数据更新间隔(ms)
    tokenExpiry: 24 * 60 * 60 * 1000, // Token有效期24小时
    maxActiveSessions: 3, // 最大活跃会话数
    enableDynamicTokens: true, // 启用动态Token生成
    // 管理员账号列表（用户名），只有这些账号可以登录后台
    allowedUsernames: process.env.ADMIN_USERNAMES ? process.env.ADMIN_USERNAMES.split(',') : ['admin'],
    // 管理员升级密钥（用于普通账号升级为管理员）
    upgradeKey: process.env.ADMIN_UPGRADE_KEY || 'ADMIN-UPGRADE-2026-SECRET'
  },

  // 游戏配置
  game: {
    types: {
      GOBANG: 'gobang',
      GO: 'go',
      CHINESE_CHESS: 'chinese-chess',
      SNAKE: 'snake'
    },
    maxWaitTime: 300000, // 最大等待时间 5分钟
    maxGameTime: 3600000, // 最大游戏时间 1小时
    inactivityTimeout: 30 * 60 * 1000 // 不活动超时 30分钟
  },

  // 数据存储路径
  paths: {
    data: path.join(storageRoot, 'data'),
    logs: path.join(storageRoot, 'logs'),
    accounts: path.join(storageRoot, 'data', 'accounts'),
    games: path.join(storageRoot, 'data', 'games'),
    stats: path.join(storageRoot, 'data', 'stats.json')
  },

  // 日志配置
  log: {
    level: process.env.LOG_LEVEL || 'info',
    maxFiles: 7,
    maxSize: '10m'
  },

  // 用户权限配置
  permissions: {
    // 游客权限
    guest: {
      canPlayGames: true,
      canChat: true,
      canViewLeaderboard: true,
      canViewProfiles: false,
      canEditProfile: false,
      canChangePassword: false,
      canSaveStats: false,
      canCreateRooms: false,
      canInviteFriends: false,
      maxGamesPerDay: 10,
      maxChatMessages: 50
    },

    // 注册用户权限
    registered: {
      canPlayGames: true,
      canChat: true,
      canViewLeaderboard: true,
      canViewProfiles: true,
      canEditProfile: true,
      canChangePassword: true,
      canSaveStats: true,
      canCreateRooms: true,
      canInviteFriends: true,
      maxGamesPerDay: 100,
      maxChatMessages: 500
    },

    // 管理员权限
    admin: {
      canPlayGames: true,
      canChat: true,
      canViewLeaderboard: true,
      canViewProfiles: true,
      canEditProfile: true,
      canChangePassword: true,
      canSaveStats: true,
      canCreateRooms: true,
      canInviteFriends: true,
      canManageUsers: true,
      canManageGames: true,
      canViewSystemStats: true,
      maxGamesPerDay: 1000,
      maxChatMessages: 1000
    }
  },

  // 限流配置
  rateLimit: {
    windowMs: 60000, // 1分钟
    maxRequests: 100 // 最大请求数
  }
};
