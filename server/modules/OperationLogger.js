const fs = require('fs');
const path = require('path');
const config = require('../config');
const dataStore = require('../utils/dataStore');
const logger = require('../utils/logger');

const MAX_RECORDS_PER_USER = 200000;
const MAX_DAYS = 90;
const TRACE_RETENTION_DAYS = 7;

class OperationLogger {
  constructor() {
    this.logDir = path.join(config.paths.data, 'operation_logs');
    this._initDir();
  }

  _initDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  _dateStr(timestamp = Date.now()) {
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  _dateFile(dateStr, category = 'default') {
    const dir = path.join(this.logDir, category);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, `${dateStr}.jsonl`);
  }

  _userIndexFile(userId) {
    const dir = path.join(this.logDir, 'index');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return path.join(dir, `${userId}.json`);
  }

  async _appendToJsonl(filePath, entry) {
    const line = JSON.stringify(entry) + '\n';
    await fs.promises.appendFile(filePath, line, 'utf8');
  }

  async _readJsonl(filePath) {
    try {
      const data = await fs.promises.readFile(filePath, 'utf8');
      return data.trim().split('\n').filter(Boolean).map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      }).filter(Boolean);
    } catch (e) {
      if (e.code === 'ENOENT') return [];
      logger.warn('读取日志文件失败', { file: filePath, error: e.message });
      return [];
    }
  }

  async _updateUserIndex(userId, entry, filePath) {
    const indexFile = this._userIndexFile(userId);
    let index = { userId, positions: [] };
    try {
      const data = await fs.promises.readFile(indexFile, 'utf8');
      index = JSON.parse(data);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        logger.warn('读取用户日志索引失败', { userId, error: e.message });
      }
    }

    index.positions.push({
      date: this._dateStr(entry.timestamp),
      category: entry.category === 'trace' ? 'trace' : 'default',
      file: path.basename(filePath),
      timestamp: entry.timestamp,
      id: entry.id
    });

    // 限制索引长度
    if (index.positions.length > MAX_RECORDS_PER_USER) {
      index.positions = index.positions.slice(index.positions.length - MAX_RECORDS_PER_USER);
    }

    await fs.promises.writeFile(indexFile, JSON.stringify(index), 'utf8');
  }

  _sanitizeValue(value, maxDepth = 3, currentDepth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') {
      if (typeof value === 'string' && value.length > 500) {
        return value.substring(0, 500) + '...';
      }
      return value;
    }
    if (currentDepth >= maxDepth) {
      if (Array.isArray(value)) return `[Array(${value.length})]`;
      return '[Object]';
    }
    if (Array.isArray(value)) {
      return value.slice(0, 50).map(v => this._sanitizeValue(v, maxDepth, currentDepth + 1));
    }
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = this._sanitizeValue(v, maxDepth, currentDepth + 1);
    }
    return result;
  }

  async log(op) {
    const logEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 8),
      action: op.action || 'unknown',
      category: op.category || 'other',
      timestamp: Date.now()
    };

    if (op.userId) logEntry.userId = op.userId;
    if (op.username) logEntry.username = op.username;
    if (op.targetId) logEntry.targetId = op.targetId;
    if (op.targetName) logEntry.targetName = op.targetName;
    if (op.amount !== undefined && op.amount !== null && op.amount !== 0) logEntry.amount = op.amount;
    if (op.before !== undefined && op.before !== null) logEntry.before = this._sanitizeValue(op.before);
    if (op.after !== undefined && op.after !== null) logEntry.after = this._sanitizeValue(op.after);
    if (op.details !== undefined && op.details !== null && Object.keys(op.details).length > 0) logEntry.details = this._sanitizeValue(op.details);
    if (op.ip) logEntry.ip = op.ip;

    const userId = op.userId || 'anonymous';
    const isTrace = logEntry.category === 'trace';
    const category = isTrace ? 'trace' : 'default';
    const dateStr = this._dateStr(logEntry.timestamp);
    const filePath = this._dateFile(dateStr, category);

    await this._appendToJsonl(filePath, logEntry);
    await this._updateUserIndex(userId, logEntry, filePath);

    // 兼容旧格式：同时写入 dataStore 便于迁移期过渡
    try {
      await this._legacyBackup(userId, logEntry);
    } catch (e) {
      // 兼容失败不影响主流程
    }

    return logEntry;
  }

  async _legacyBackup(userId, logEntry) {
    const cutoffTime = Date.now() - 30 * 24 * 60 * 60 * 1000; // 只保留30天旧数据
    try {
      const data = await dataStore.readOne('operationLogs', userId);
      if (!data || !Array.isArray(data.logs)) {
        await dataStore.writeOne('operationLogs', userId, { userId, logs: [logEntry] });
        return;
      }
      data.logs.push(logEntry);
      data.logs = data.logs.filter(l => l.timestamp >= cutoffTime);
      if (data.logs.length > 5000) {
        data.logs.splice(0, data.logs.length - 5000);
      }
      await dataStore.writeOne('operationLogs', userId, data);
    } catch (e) {
      logger.warn('操作日志兼容备份失败', { userId, error: e.message });
    }
  }

  async logSocketEvent(userId, username, event, data, details = {}) {
    const sanitized = this._sanitizeValue(data, 2, 0);
    return this.log({
      userId,
      username,
      action: 'socket_' + event,
      category: 'trace',
      details: { event, data: sanitized, ...details }
    });
  }

  async _readLegacyLogs(startTime, endTime) {
    // 从旧 dataStore 格式读取（兼容迁移期数据）
    const userIds = await this._listLegacyUserIds();
    const allLogs = [];
    for (const id of userIds.slice(0, 500)) {
      try {
        const data = await dataStore.readOne('operationLogs', id);
        if (data && Array.isArray(data.logs)) {
          for (const log of data.logs) {
            if (log.timestamp >= startTime && log.timestamp <= endTime) {
              allLogs.push(log);
            }
          }
        }
      } catch (e) {
        // 静默跳过
      }
    }
    return allLogs;
  }

  async _listLegacyUserIds() {
    try {
      const dir = this.logDir;
      if (!fs.existsSync(dir)) return [];
      const files = await fs.promises.readdir(dir);
      return files.filter(f => f.endsWith('.json') && !f.startsWith('index'))
        .map(f => f.replace('.json', ''));
    } catch (e) {
      return [];
    }
  }

  async queryLogs(params) {
    const { userId, username, action, category, targetId, startDate, endDate, page = 1, pageSize = 50, includeTrace = false } = params;

    const parsedPage = Math.max(1, parseInt(page) || 1);
    const parsedPageSize = Math.min(200, Math.max(1, parseInt(pageSize) || 50));

    const startTime = startDate ? new Date(startDate).getTime() : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const endTime = endDate ? new Date(endDate).getTime() + 24 * 60 * 60 * 1000 : Date.now();

    let allLogs = [];

    if (userId) {
      // 使用用户索引快速定位
      const indexFile = this._userIndexFile(userId);
      let index = { userId, positions: [] };
      try {
        const data = await fs.promises.readFile(indexFile, 'utf8');
        index = JSON.parse(data);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          logger.warn('读取用户日志索引失败', { userId, error: e.message });
        }
      }

      const relevantPositions = (index.positions || []).filter(pos => {
        if (pos.timestamp < startTime || pos.timestamp > endTime) return false;
        if (!includeTrace && pos.category === 'trace') return false;
        return true;
      });

      const fileCache = new Map();
      for (const pos of relevantPositions) {
        const filePath = path.join(this.logDir, pos.category || 'default', pos.file);
        if (!fileCache.has(filePath)) {
          fileCache.set(filePath, await this._readJsonl(filePath));
        }
      }

      const validIds = new Set(relevantPositions.map(p => p.id));
      for (const logs of fileCache.values()) {
        for (const log of logs) {
          if (log.userId === userId && validIds.has(log.id)) {
            allLogs.push(log);
          }
        }
      }

      // 补充旧 dataStore 格式数据（兼容迁移期）
      const legacyLogs = await this._readLegacyLogs(startTime, endTime);
      for (const log of legacyLogs) {
        if (log.userId === userId) {
          allLogs.push(log);
        }
      }
    } else {
      // 全局查询：按日期范围读取
      const dateList = [];
      for (let t = startTime; t <= endTime; t += 24 * 60 * 60 * 1000) {
        dateList.push(this._dateStr(t));
      }

      for (const dateStr of dateList) {
        const categories = includeTrace ? ['default', 'trace'] : ['default'];
        for (const cat of categories) {
          const filePath = this._dateFile(dateStr, cat);
          const logs = await this._readJsonl(filePath);
          allLogs = allLogs.concat(logs);
        }
      }

      // 补充旧 dataStore 格式数据（兼容迁移期）
      const legacyLogs = await this._readLegacyLogs(startTime, endTime);
      allLogs = allLogs.concat(legacyLogs);
    }

    // 过滤
    let logs = allLogs;
    if (username) logs = logs.filter(l => l.username && l.username.toLowerCase().includes(username.toLowerCase()));
    if (action) logs = logs.filter(l => l.action === action);
    if (category) logs = logs.filter(l => l.category === category);
    if (targetId) logs = logs.filter(l => l.targetId === targetId);

    logs.sort((a, b) => b.timestamp - a.timestamp);

    const total = logs.length;
    const totalPages = Math.max(1, Math.ceil(total / parsedPageSize));
    const startIdx = (parsedPage - 1) * parsedPageSize;
    const pageData = logs.slice(startIdx, startIdx + parsedPageSize);

    return {
      data: pageData,
      pagination: { page: parsedPage, pageSize: parsedPageSize, total, totalPages },
      stats: {
        total,
        today: logs.filter(l => {
          const d = new Date(l.timestamp);
          const today = new Date();
          return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();
        }).length
      }
    };
  }

  async cleanup() {
    const cutoffTime = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    const traceCutoffTime = Date.now() - TRACE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    try {
      const dirs = ['default', 'trace'];
      for (const dir of dirs) {
        const fullDir = path.join(this.logDir, dir);
        if (!fs.existsSync(fullDir)) continue;
        const files = await fs.promises.readdir(fullDir);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const dateStr = file.replace('.jsonl', '');
          const fileTime = new Date(dateStr).getTime();
          const limit = dir === 'trace' ? traceCutoffTime : cutoffTime;
          if (fileTime < limit) {
            await fs.promises.unlink(path.join(fullDir, file));
          }
        }
      }
    } catch (e) {
      logger.warn('操作日志清理失败', { error: e.message });
    }
  }

  // ===== 便捷方法 =====

  async getItemUse(userId, username, itemId, itemName, count, details = {}) {
    return this.log({
      userId,
      username,
      action: 'item_use',
      category: 'item',
      targetId: itemId,
      targetName: itemName,
      amount: -count,
      details
    });
  }

  async getItemPurchase(userId, username, itemId, itemName, count, price, details = {}) {
    return this.log({
      userId,
      username,
      action: 'item_purchase',
      category: 'item',
      targetId: itemId,
      targetName: itemName,
      amount: count,
      details: { price, ...details }
    });
  }

  async getPackOpen(userId, username, packId, packName, rewards, details = {}) {
    return this.log({
      userId,
      username,
      action: 'pack_open',
      category: 'pack',
      targetId: packId,
      targetName: packName,
      amount: rewards.length,
      details: { rewards, ...details }
    });
  }

  async getCurrencyAdd(userId, username, amount, reason, details = {}) {
    return this.log({
      userId,
      username,
      action: 'currency_add',
      category: 'currency',
      targetName: reason,
      amount: amount,
      details
    });
  }

  async getCurrencySpend(userId, username, amount, reason, details = {}) {
    return this.log({
      userId,
      username,
      action: 'currency_spend',
      category: 'currency',
      targetName: reason,
      amount: -amount,
      details
    });
  }

  async getCosmeticEquip(userId, username, category, itemId, itemName, details = {}) {
    return this.log({
      userId,
      username,
      action: 'cosmetic_equip',
      category: 'cosmetic',
      targetId: itemId,
      targetName: `${category}: ${itemName}`,
      details
    });
  }

  async getCosmeticUnequip(userId, username, category, details = {}) {
    return this.log({
      userId,
      username,
      action: 'cosmetic_unequip',
      category: 'cosmetic',
      targetName: category,
      details
    });
  }

  async getVipPurchase(userId, username, vipName, days, details = {}) {
    return this.log({
      userId,
      username,
      action: 'vip_purchase',
      category: 'vip',
      targetName: vipName,
      amount: days,
      details
    });
  }

  async getVipRenew(userId, username, vipName, days, details = {}) {
    return this.log({
      userId,
      username,
      action: 'vip_renew',
      category: 'vip',
      targetName: vipName,
      amount: days,
      details
    });
  }

  async getExpChange(userId, username, amount, source, details = {}) {
    return this.log({
      userId,
      username,
      action: 'exp_change',
      category: 'exp',
      targetName: source,
      amount: amount,
      details
    });
  }

  async getLevelUp(userId, username, oldLevel, newLevel, details = {}) {
    return this.log({
      userId,
      username,
      action: 'level_up',
      category: 'exp',
      targetName: `等级提升 ${oldLevel} -> ${newLevel}`,
      amount: newLevel - oldLevel,
      details: { oldLevel, newLevel, ...details }
    });
  }

  async getLogin(userId, username, ip = '') {
    return this.log({
      userId,
      username,
      action: 'login',
      category: 'account',
      ip
    });
  }

  async getLogout(userId, username, details = {}) {
    return this.log({
      userId,
      username,
      action: 'logout',
      category: 'account',
      details
    });
  }

  async getRegister(userId, username, details = {}) {
    return this.log({
      userId,
      username,
      action: 'register',
      category: 'account',
      details
    });
  }

  async getAchievementUnlock(userId, username, achievementId, achievementName, details = {}) {
    return this.log({
      userId,
      username,
      action: 'achievement_unlock',
      category: 'achievement',
      targetId: achievementId,
      targetName: achievementName,
      details
    });
  }

  async getChat(userId, username, channel, message, details = {}) {
    return this.log({
      userId,
      username,
      action: 'chat',
      category: 'chat',
      targetName: channel,
      details: { message, ...details }
    });
  }

  async getReport(userId, username, targetUserId, reason, details = {}) {
    return this.log({
      userId,
      username,
      action: 'report',
      category: 'moderation',
      targetId: targetUserId,
      targetName: reason,
      details
    });
  }

  async getAdminAction(adminId, adminName, action, targetId, targetName, details = {}) {
    return this.log({
      userId: adminId,
      username: adminName,
      action: 'admin_' + action,
      category: 'admin',
      targetId: targetId,
      targetName: targetName,
      details
    });
  }
}

module.exports = OperationLogger;
