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

// 获取当前时间字符串
function getTimestamp() {
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
    timestamp: getTimestamp(),
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

// 控制台输出
function consoleOutput(level, message, meta = {}) {
  const timestamp = getTimestamp();
  const colors = {
    error: '\x1b[31m', // 红色
    warn: '\x1b[33m',  // 黄色
    info: '\x1b[36m',  // 青色
    debug: '\x1b[90m', // 灰色
    reset: '\x1b[0m'
  };

  const color = colors[level] || colors.reset;
  const prefix = `${color}[${timestamp}] [${level.toUpperCase()}]${colors.reset}`;
  
  if (Object.keys(meta).length > 0) {
    console.log(prefix, message, meta);
  } else {
    console.log(prefix, message);
  }
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
    this.info(`用户操作: ${action}`, { userId, ...details });
  },

  // 记录游戏事件
  gameEvent(gameId, event, details = {}) {
    this.info(`游戏事件: ${event}`, { gameId, ...details });
  },

  // 记录系统事件
  systemEvent(event, details = {}) {
    this.info(`系统事件: ${event}`, details);
  }
};

module.exports = logger;
