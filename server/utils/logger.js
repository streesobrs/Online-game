// 日志工具模块
const fs = require('fs');
const path = require('path');
const config = require('../config');

// 确保日志目录存在
const logDir = config.paths.logs;
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 日志级别
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLevel = LOG_LEVELS[config.log.level] || LOG_LEVELS.info;

// 获取格式化的时间字符串
function getTimestamp() {
  const date = new Date();
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

// 获取ISO格式的时间（用于文件存储）
function getFileTimestamp() {
  return new Date().toISOString();
}

// 获取今天的日志文件名
function getLogFileName() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}.log`;
}

// 写入日志文件
function writeToFile(level, message, meta = {}) {
  const logFile = path.join(logDir, getLogFileName());
  const logEntry = {
    timestamp: getFileTimestamp(),
    level,
    message,
    ...meta
  };
  const logLine = JSON.stringify(logEntry) + '\n';

  fs.appendFile(logFile, logLine, (err) => {
    if (err) {
      console.error('写入日志失败:', err);
    }
  });
}

// 格式化元数据展示
function formatMeta(meta) {
  if (Object.keys(meta).length === 0) return '';

  const parts = [];
  for (const [key, value] of Object.entries(meta)) {
    if (typeof value === 'object') {
      parts.push(`\x1b[90m${key}=\x1b[0m${JSON.stringify(value)}`);
    } else {
      parts.push(`\x1b[90m${key}=\x1b[32m${value}\x1b[0m`);
    }
  }
  return ' ' + parts.join(' ');
}

// 控制台输出
function consoleOutput(level, message, meta = {}) {
  const timestamp = getTimestamp();
  const colors = {
    error: '\x1b[31m',    // 红色
    warn: '\x1b[33m',     // 黄色
    info: '\x1b[36m',     // 青色
    debug: '\x1b[90m',    // 灰色
    reset: '\x1b[0m',
    white: '\x1b[37m',
    bgError: '\x1b[41m',  // 红底
    bgWarn: '\x1b[43m',   // 黄底
    bgInfo: '\x1b[46m'    // 青底
  };

  const icons = {
    error: '❌',
    warn: '⚠️',
    info: 'ℹ️',
    debug: '🔍'
  };

  const levelNames = {
    error: 'ERROR',
    warn: 'WARN ',
    info: 'INFO ',
    debug: 'DEBUG'
  };

  const color = colors[level] || colors.reset;
  const icon = icons[level] || '';
  const levelName = levelNames[level] || level.toUpperCase();

  const timePart = `\x1b[90m[${timestamp}]\x1b[0m`;
  const levelPart = `${color}${icon} ${levelName}${colors.reset}`;

  const metaStr = formatMeta(meta);

  console.log(`${timePart} ${levelPart} ${colors.white}${message}${colors.reset}${metaStr}`);
}

// 日志对象
const logger = {
  error(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.error) {
      consoleOutput('error', message, meta);
      writeToFile('error', message, meta);
    }
  },

  warn(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.warn) {
      consoleOutput('warn', message, meta);
      writeToFile('warn', message, meta);
    }
  },

  info(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.info) {
      consoleOutput('info', message, meta);
      writeToFile('info', message, meta);
    }
  },

  debug(message, meta = {}) {
    if (currentLevel >= LOG_LEVELS.debug) {
      consoleOutput('debug', message, meta);
      writeToFile('debug', message, meta);
    }
  },

  // 记录用户操作
  userAction(userId, action, details = {}) {
    this.info(`👤 ${action}`, { userId, ...details });
  },

  // 记录游戏事件
  gameEvent(gameId, event, details = {}) {
    this.info(`🎮 ${event}`, { gameId, ...details });
  },

  // 记录系统事件
  systemEvent(event, details = {}) {
    this.info(`⚙️ ${event}`, details);
  },

  // 记录匹配事件
  matchEvent(userId, event, details = {}) {
    this.info(`🎯 ${event}`, { userId, ...details });
  },

  // 记录聊天事件
  chatEvent(userId, channel, details = {}) {
    this.info(`💬 ${channel}`, { userId, ...details });
  },

  // 记录连接事件
  connectEvent(userId, details = {}) {
    this.info(`🔌 用户连接`, { userId, ...details });
  },

  // 记录断开事件
  disconnectEvent(userId, details = {}) {
    this.info(`✂️ 用户断开`, { userId, ...details });
  }
};

module.exports = logger;
