const fs = require('fs');
const path = require('path');
const config = require('../config');
const dataStore = require('../utils/dataStore');
const logger = require('../utils/logger');

const MAX_RECORDS_PER_USER = 1000;
const MAX_DAYS = 90;

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

  async _getUserLogs(userId) {
    try {
      const data = await dataStore.readOne('operationLogs', userId);
      return data && Array.isArray(data.logs) ? data : { userId, logs: [] };
    } catch (e) {
      return { userId, logs: [] };
    }
  }

  async _saveUserLogs(userId, userData) {
    await dataStore.writeOne('operationLogs', userId, userData);
  }

  _sanitizeValue(value, maxDepth = 2, currentDepth = 0) {
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return value;
    if (currentDepth >= maxDepth) {
      if (Array.isArray(value)) return `[Array(${value.length})]`;
      return '[Object]';
    }
    if (Array.isArray(value)) {
      return value.map(v => this._sanitizeValue(v, maxDepth, currentDepth + 1));
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
    const userData = await this._getUserLogs(userId);
    userData.logs.push(logEntry);

    if (userData.logs.length > MAX_RECORDS_PER_USER) {
      userData.logs.splice(0, userData.logs.length - MAX_RECORDS_PER_USER);
    }

    const cutoffTime = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    userData.logs = userData.logs.filter(l => l.timestamp >= cutoffTime);

    await this._saveUserLogs(userId, userData);

    return logEntry;
  }

  async getItemUse(userId, username, itemId, itemName, count, details = {}) {
    return this.log({
      userId,
      username,
      action: 'item_use',
      category: 'item',
      targetId: itemId,
      targetName: itemName,
      amount: count,
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

  async queryLogs(params) {
    const { userId, username, action, category, targetId, startDate, endDate, page = 1, pageSize = 50 } = params;

    let allLogs = [];

    if (userId) {
      const userData = await this._getUserLogs(userId);
      allLogs = userData.logs || [];
    } else {
      try {
        const files = await fs.promises.readdir(this.logDir);
        const jsonFiles = files.filter(f => f.endsWith('.json') && !f.endsWith('.tmp') && !f.endsWith('.backup'));

        for (const file of jsonFiles) {
          try {
            const filePath = path.join(this.logDir, file);
            const data = await fs.promises.readFile(filePath, 'utf8');
            const userData = JSON.parse(data);
            if (userData.logs && Array.isArray(userData.logs)) {
              allLogs = allLogs.concat(userData.logs);
            }
          } catch (err) {
            logger.warn('读取操作日志文件失败', { file, error: err.message });
          }
        }
      } catch (err) {
        logger.error('遍历操作日志目录失败', { error: err.message });
      }
    }

    let logs = allLogs;

    if (username) logs = logs.filter(l => l.username && l.username.toLowerCase().includes(username.toLowerCase()));
    if (action) logs = logs.filter(l => l.action === action);
    if (category) logs = logs.filter(l => l.category === category);
    if (targetId) logs = logs.filter(l => l.targetId === targetId);

    if (startDate) {
      const start = new Date(startDate).getTime();
      logs = logs.filter(l => l.timestamp >= start);
    }
    if (endDate) {
      const end = new Date(endDate).getTime() + 24 * 60 * 60 * 1000;
      logs = logs.filter(l => l.timestamp <= end);
    }

    logs.sort((a, b) => b.timestamp - a.timestamp);

    const total = logs.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const startIdx = (page - 1) * pageSize;
    const pageData = logs.slice(startIdx, startIdx + pageSize);

    return {
      data: pageData,
      pagination: { page: parseInt(page), pageSize: parseInt(pageSize), total, totalPages },
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
}

module.exports = OperationLogger;
