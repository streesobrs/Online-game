// 服务器配置文件
const path = require('path');

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
    updateInterval: 2000 // 管理后台数据更新间隔(ms)
  },

  // 游戏配置
  game: {
    types: {
      GOBANG: 'gobang',
      GO: 'go',
      CHESS: 'chess'
    },
    maxWaitTime: 300000, // 最大等待时间 5分钟
    maxGameTime: 3600000, // 最大游戏时间 1小时
    inactivityTimeout: 60000 // 不活动超时 1分钟
  },

  // 数据存储路径
  paths: {
    data: path.join(__dirname, 'data'),
    logs: path.join(__dirname, 'logs'),
    users: path.join(__dirname, 'data', 'users.json'),
    games: path.join(__dirname, 'data', 'games.json'),
    stats: path.join(__dirname, 'data', 'stats.json')
  },

  // 日志配置
  log: {
    level: process.env.LOG_LEVEL || 'info',
    maxFiles: 7,
    maxSize: '10m'
  },

  // 限流配置
  rateLimit: {
    windowMs: 60000, // 1分钟
    maxRequests: 100 // 最大请求数
  }
};
