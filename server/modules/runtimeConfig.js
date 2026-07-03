const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

const RUNTIME_CONFIG_PATH = path.join(config.paths.data, 'runtime-settings.json');

let baseConfig = null;
let originalValues = {};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getNestedValue(obj, keyPath) {
  return keyPath.split('.').reduce((cur, key) => (cur != null ? cur[key] : undefined), obj);
}

function setNestedValue(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function deleteNestedValue(obj, keyPath) {
  const keys = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) return;
    cur = cur[keys[i]];
  }
  delete cur[keys[keys.length - 1]];
}

function saveOverridesToDisk(overrides) {
  try {
    const dir = path.dirname(RUNTIME_CONFIG_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(RUNTIME_CONFIG_PATH, JSON.stringify(overrides, null, 2), 'utf-8');
    return true;
  } catch (err) {
    logger.error('保存运行时配置失败', { error: err.message });
    return false;
  }
}

function loadOverridesFromDisk() {
  try {
    if (fs.existsSync(RUNTIME_CONFIG_PATH)) {
      const data = fs.readFileSync(RUNTIME_CONFIG_PATH, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    logger.error('加载运行时配置失败', { error: err.message });
  }
  return {};
}

function init(config) {
  baseConfig = config;

  function snapshotOriginal(keyPath) {
    const val = getNestedValue(baseConfig, keyPath);
    if (val != null && typeof val !== 'object') {
      originalValues[keyPath] = deepClone(val);
    }
  }

  const categories = getSettingCategories();
  for (const keys of Object.values(categories)) {
    for (const key of keys) {
      snapshotOriginal(key);
    }
  }

  const overrides = loadOverridesFromDisk();
  const overridePaths = [];

  function collectPaths(obj, prefix) {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const full = prefix ? `${prefix}.${k}` : k;
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        collectPaths(v, full);
      } else {
        overridePaths.push({ path: full, value: v });
      }
    }
  }
  collectPaths(overrides, '');

  for (const { path: keyPath, value } of overridePaths) {
    try {
      setNestedValue(baseConfig, keyPath, value);
      originalValues[keyPath] = getNestedValue(baseConfig, keyPath);
    } catch (err) {
      logger.warn('应用运行时配置项失败', { key: keyPath, error: err.message });
    }
  }

  if (overridePaths.length > 0) {
    logger.info(`运行时配置已加载，共 ${overridePaths.length} 项覆盖`, { path: RUNTIME_CONFIG_PATH });
  }
}

function getAllSettings() {
  if (!baseConfig) return [];
  const settings = [];
  const categories = getSettingCategories();
  const overrides = loadOverridesFromDisk();

  for (const [category, keys] of Object.entries(categories)) {
    for (const key of keys) {
      const value = getNestedValue(baseConfig, key);
      const baseValue = originalValues[key];
      const isOverridden = getNestedValue(overrides, key) !== undefined;
      if (value !== undefined) {
        settings.push({
          key,
          category,
          value,
          baseValue: baseValue !== undefined ? baseValue : value,
          isOverridden,
          type: typeof value
        });
      }
    }
  }
  return settings;
}

function getCategories() {
  return getSettingCategories();
}

function updateSetting(keyPath, value) {
  if (!baseConfig) return { success: false, error: '运行时配置未初始化' };

  const baseVal = originalValues[keyPath];
  if (baseVal === undefined) {
    return { success: false, error: `配置项不在可编辑列表中: ${keyPath}` };
  }

  let typedValue = value;
  if (typeof baseVal === 'number') {
    typedValue = Number(value);
    if (isNaN(typedValue)) return { success: false, error: '值必须是数字' };
    if (keyPath.includes('Duration') || keyPath.includes('Timeout') ||
      keyPath.includes('Interval') || keyPath.includes('Threshold') ||
      keyPath.includes('Expiry') || keyPath.includes('Window') ||
      keyPath === 'items.durations.doubleExp' || keyPath === 'items.durations.luckyCharm' ||
      keyPath === 'items.durations.tripleExp' || keyPath === 'chat.defaultMuteDuration' ||
      keyPath === 'session.reconnectGracePeriod' || keyPath === 'session.inactiveWarningTime' ||
      keyPath === 'session.inactiveKickDelay' || keyPath === 'session.aiGameCleanupDelay' ||
      keyPath === 'gameTimeouts.matchTimeout' || keyPath === 'gameTimeouts.inactivityWarn' ||
      keyPath === 'gameTimeouts.timerCheckInterval' || keyPath === 'gameTimeouts.resetRequestTimeout' ||
      keyPath === 'gameTimeouts.earlyGameAbortTime' || keyPath === 'gameTimeouts.quickDrawTime' ||
      keyPath === 'gameTimeouts.snakeSyncDelay' || keyPath === 'rateLimit.windowMs' ||
      keyPath === 'game.maxWaitTime' || keyPath === 'game.maxGameTime' ||
      keyPath === 'game.inactivityTimeout' || keyPath === 'game.challengeTimeout') {
      if (typedValue < 0) return { success: false, error: '时间值不能为负数' };
    }
  } else if (typeof baseVal === 'boolean') {
    typedValue = value === true || value === 'true' || value === 1;
  } else if (typeof baseVal === 'string') {
    typedValue = String(value);
  }

  setNestedValue(baseConfig, keyPath, typedValue);

  const overrides = loadOverridesFromDisk();
  const isSameAsOriginal = typedValue === baseVal;

  if (isSameAsOriginal) {
    deleteNestedValue(overrides, keyPath);
  } else {
    setNestedValue(overrides, keyPath, typedValue);
  }

  saveOverridesToDisk(overrides);
  logger.info('管理员更新系统设置', { key: keyPath, value: typedValue, reset: isSameAsOriginal });
  return { success: true, value: typedValue, isDefault: isSameAsOriginal };
}

function resetAllSettings() {
  if (!baseConfig) return { success: false, error: '运行时配置未初始化' };

  for (const [key, originalVal] of Object.entries(originalValues)) {
    setNestedValue(baseConfig, key, deepClone(originalVal));
  }
  saveOverridesToDisk({});
  logger.info('管理员重置所有系统设置为默认值');
  return { success: true };
}

function resetSetting(keyPath) {
  if (!baseConfig) return { success: false, error: '运行时配置未初始化' };

  const originalVal = originalValues[keyPath];
  if (originalVal === undefined) {
    return { success: false, error: `配置项不在可编辑列表中: ${keyPath}` };
  }

  setNestedValue(baseConfig, keyPath, deepClone(originalVal));

  const overrides = loadOverridesFromDisk();
  deleteNestedValue(overrides, keyPath);
  saveOverridesToDisk(overrides);

  logger.info('管理员重置设置为默认值', { key: keyPath });
  return { success: true, value: deepClone(originalVal) };
}

function getSettingCategories() {
  return {
    '经验系统': [
      'exp.baseExpPerLevel', 'exp.weekendMultiplier', 'exp.defaultHolidayMultiplier',
      'exp.expToCoinRatio', 'exp.levelUpCoinReward',
      'exp.itemMultipliers.doubleExp', 'exp.itemMultipliers.tripleExp',
      'exp.vipDefaultMultiplier'
    ],
    '等级经验倍率': [
      'exp.levelMultipliers.low.multiplier', 'exp.levelMultipliers.mid.multiplier',
      'exp.levelMultipliers.high.multiplier', 'exp.levelMultipliers.veryHigh.multiplier',
      'exp.levelMultipliers.max.multiplier'
    ],
    'AI对战奖励': [
      'gameRewards.ai.win', 'gameRewards.ai.draw', 'gameRewards.ai.lose',
      'gameRewards.aiDifficultyMultiplier.easy', 'gameRewards.aiDifficultyMultiplier.medium',
      'gameRewards.aiDifficultyMultiplier.hard'
    ],
    'PvP对战奖励': [
      'gameRewards.pvp.win', 'gameRewards.pvp.draw', 'gameRewards.pvp.lose',
      'gameRewards.quickGameThreshold', 'gameRewards.slowGameThreshold'
    ],
    '贪吃蛇奖励': [
      'snakeRewards.winScoreThreshold', 'snakeRewards.baseExp',
      'snakeRewards.expPerScoreDivisor'
    ],
    '道具效果': [
      'items.effects.expPotion', 'items.effects.expPackage',
      'items.effects.undoCard', 'items.effects.hintCard',
      'items.durations.doubleExp', 'items.durations.luckyCharm',
      'items.durations.tripleExp'
    ],
    '会话与超时': [
      'session.reconnectGracePeriod', 'session.inactiveWarningTime',
      'session.inactiveKickDelay', 'session.aiGameCleanupDelay',
      'gameTimeouts.matchTimeout', 'gameTimeouts.inactivityWarn',
      'gameTimeouts.timerCheckInterval', 'gameTimeouts.resetRequestTimeout',
      'gameTimeouts.earlyGameAbortTime', 'gameTimeouts.quickDrawTime'
    ],
    '聊天设置': [
      'chat.maxHistoryMessages', 'chat.defaultMuteDuration',
      'chat.maxMessagesPerMinute', 'chat.maxMessageLength',
      'chat.permanentMuteThresholdMinutes'
    ],
    '商店与限流': [
      'shop.vipDiscountPercent', 'shop.maxPurchaseQuantity',
      'rateLimit.windowMs', 'rateLimit.maxRequests'
    ],
    '系统维护': [
      'system.maintenanceEnabled', 'system.maintenanceMessage',
      'system.maintenanceBlockNewGames', 'system.maintenanceBlockChat',
      'system.maintenanceBlockShop', 'system.maintenanceBlockMail',
      'system.maintenanceBlockRegister', 'system.maintenanceBlockProfile',
      'system.maintenanceKickOnEnable', 'system.maintenanceCountdownMinutes',
      'system.maintenanceNoticeMinutes'
    ],
    '日志管理': [
      'log.adminBufferSize', 'log.adminMaxDisplay',
      'log.adminFileReadLines', 'log.adminFileReadMaxLines'
    ],
    '更新设置': [
      'update.enabled', 'update.maxUploadSize', 'update.maxExtractSize',
      'update.maxFileCount', 'update.maxBackups',
      'update.staleStateTimeout', 'update.staleLockTimeout',
      'update.logTailMaxLength', 'update.historyMaxEntries',
      'update.shutdownDelayMs', 'update.processExitDelayMs',
      'update.restartPollIntervalMs',
      'update.gracePeriodSeconds', 'update.restartTimeoutSeconds',
      'update.healthCheckRetries', 'update.healthCheckIntervalMs',
      'update.rollbackOnStartupFailure',
      'update.autoRollbackCrashThreshold', 'update.autoRollbackCrashWindowMs',
      'update.requireSignature', 'update.chunkSize'
    ]
  };
}

module.exports = {
  init,
  getAllSettings,
  getCategories,
  updateSetting,
  resetSetting,
  resetAllSettings
};
