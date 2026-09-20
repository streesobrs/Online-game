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
 * 经验奖励配置：由服务端随 match3_progress 下发（server.js 的 match3_game_end 是唯一权威）
 *
 * 刻意不在客户端镜像数值：改了服务端配置客户端跟着变，不会漂移。
 * 未登录 / 离线拿不到配置时保持 null，界面据此隐藏「预计经验」。
 */
let rewardConfig = null;

/**
 * 预计经验：与服务端 match3_game_end 的算法保持一致（基础 + 分数换算 + 闯关星级加成）
 * 服务端还有反刷分校验，未通过时不发经验，因此这里只是「预计」值。
 * @param {{mode:string, score:number, stars?:number}} options mode 为 level / endless / endless3 / rogue
 * @returns {number|null} 配置未下发时返回 null
 */
export function estimateExp({ mode, score = 0, stars = 0 }) {
  const rewards = rewardConfig;
  if (!rewards) return null;

  const divisorByMode = {
    level: rewards.expPerScoreDivisor,
    endless: rewards.endlessExpPerScoreDivisor || rewards.expPerScoreDivisor,
    endless3:
      rewards.endless3ExpPerScoreDivisor
      || rewards.endlessExpPerScoreDivisor
      || rewards.expPerScoreDivisor,
    // 肉鸽试炼一轮累计总分约 120 万（标定中位 22 层），尺度与标准无尽的 30 万接近，独立除数并逐级回退
    rogue:
      rewards.rogueExpPerScoreDivisor
      || rewards.endlessExpPerScoreDivisor
      || rewards.expPerScoreDivisor,
  };
  const divisor = divisorByMode[mode] || rewards.expPerScoreDivisor;
  // 星级加成只有闯关模式有；无尽模式服务端固定按 0 星发
  const starCount = mode === 'level' ? Math.max(0, Math.min(3, Math.floor(stars || 0))) : 0;

  return (
    (rewards.baseExp || 0)
    + Math.floor(Math.max(0, score) / divisor)
    + starCount * (rewards.starBonus || 0)
  );
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

  // 肉鸽试炼的成绩独立于其它模式（层数与分数都取最大，避免离线游玩丢进度）
  const bestRogue = readStore(STORAGE_KEYS.rogueBest) || {};
  const rogue = remote.rogue || {};
  writeStore(STORAGE_KEYS.rogueBest, {
    maxFloor: Math.max(bestRogue.maxFloor || 0, rogue.maxFloor || 0),
    highScore: Math.max(bestRogue.highScore || 0, rogue.highScore || 0),
  });
}

/** 拉取服务端进度（进入消消乐时调用一次） */
export function requestProgress() {
  emit('match3_sync_progress');
}

/** 订阅服务端进度：先合并到本地，再回调（用于刷新界面） */
export function onProgress(handler) {
  return eventBus.on('match3:progress', (data) => {
    if (data?.rewards) rewardConfig = data.rewards; // 预计经验用的奖励配置，随进度一起下发
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

/** 上报结算；floor 仅肉鸽试炼使用（本轮到达的层数） */
export function reportEnd({ mode, level = null, floor = null, score, maxCombo, moves, durationMs, cleared, stars = 0 }) {
  emit('match3_game_end', { mode, level, floor, score, maxCombo, moves, durationMs, cleared, stars });
}
