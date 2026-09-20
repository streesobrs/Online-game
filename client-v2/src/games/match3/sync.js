/**
 * 消消乐服务端同步（开发方案 9.2 / 5.4）
 *
 * - 上报：match3_game_start / match3_game_end（服务端做反刷分校验后发经验、记榜）
 * - 拉取：match3_sync_progress → match3_progress
 * - 合并：服务端为准，本地参与 max 合并，避免离线游玩丢进度
 *
 * 未登录或未连接时静默跳过：消消乐离线可玩，服务端只负责存档、经验与榜单。
 */
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { STORAGE_KEYS } from './config.js';
import { LEVEL_COUNT } from './levels.js';
import { toast } from '../../components/toast.js';

function readStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 容量满：同步失败不影响本局
  }
}

/**
 * 把服务端进度合并进本地存档
 *
 * 注意语义差异：本地 maxLevel 是「已解锁的最高关」（从 1 起），
 * 服务端 maxLevel 是「已通关的最高关」（从 0 起）。
 */
export function mergeRemoteProgress(remote) {
  if (!remote) return;

  const local = readStore(STORAGE_KEYS.progress) || {};
  const localCleared = Math.max(0, (local.maxLevel || 1) - 1);
  const cleared = Math.max(localCleared, Math.max(0, remote.maxLevel || 0));

  const stars = { ...(local.stars || {}) };
  for (const [levelId, count] of Object.entries(remote.stars || {})) {
    stars[levelId] = Math.max(stars[levelId] || 0, count || 0);
  }

  writeStore(STORAGE_KEYS.progress, {
    maxLevel: Math.min(cleared + 1, LEVEL_COUNT),
    stars,
  });

  const best = readStore(STORAGE_KEYS.best) || {};
  const endless = remote.endless || {};
  writeStore(STORAGE_KEYS.best, {
    highScore: Math.max(best.highScore || 0, endless.highScore || 0),
    bestCombo: Math.max(best.bestCombo || 0, endless.bestCombo || 0),
  });

  // 三色爽局的成绩独立于标准无尽
  const best3 = readStore(STORAGE_KEYS.bestEndless3) || {};
  const endless3 = remote.endless3 || {};
  writeStore(STORAGE_KEYS.bestEndless3, {
    highScore: Math.max(best3.highScore || 0, endless3.highScore || 0),
    bestCombo: Math.max(best3.bestCombo || 0, endless3.bestCombo || 0),
  });
}

/** 拉取服务端进度（进入消消乐时调用一次） */
export function requestProgress() {
  emit('match3_sync_progress');
}

/** 订阅服务端进度：先合并到本地，再回调（用于刷新界面） */
export function onProgress(handler) {
  return eventBus.on('match3:progress', (data) => {
    mergeRemoteProgress(data);
    if (handler) handler(data);
  });
}

/** 订阅结算回执：合并服务端进度，被拦截时给出提示 */
export function onResult(handler) {
  return eventBus.on('match3:result', (data) => {
    if (data?.progress) mergeRemoteProgress(data.progress);
    if (data?.rejected) toast.info(data.message || '成绩未通过校验');
    if (handler) handler(data);
  });
}

/** 上报开局 */
export function reportStart({ mode, level = null }) {
  emit('match3_game_start', { mode, level });
}

/** 上报结算 */
export function reportEnd({ mode, level = null, score, maxCombo, moves, durationMs, cleared, stars = 0 }) {
  emit('match3_game_end', { mode, level, score, maxCombo, moves, durationMs, cleared, stars });
}
