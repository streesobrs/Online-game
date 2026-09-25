/**
 * 消消乐服务端同步（开发方案 9.2 / 5.4）
 *
 * - 上报：match3_game_start / match3_game_end（服务端做反刷分校验后发经验、记榜）
 * - 拉取：match3_sync_progress → match3_progress
 * - 合并：闯关进度以服务端为唯一真相，本地存档只是服务端进度的缓存
 *   （本地自行推进会让服务端判「跳关」且无法自愈，见 9.4）
 *
 * 未登录或未连接时不上报：消消乐离线可玩，但进度与经验都以服务端记录为准。
 */
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { SESSION, SESSION_KEYS, STORAGE_KEYS } from './config.js';
import { LEVEL_COUNT } from './levels.js';
import { buffFactor, normalizeMeta, rogueCfg, setRogueConfig } from './meta.js';
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

// ========== 局内暂存（开发方案 5.4 / 8）==========

/** 暂存是否还在有效期内（过期的既不提示续玩，也不参与与云端比新旧） */
function isFreshSession(session) {
  return Boolean(session)
    && typeof session === 'object'
    && Number.isFinite(session.ts)
    && Date.now() - session.ts <= SESSION.maxAgeMs;
}

/**
 * 本轮结束的「墓碑」
 *
 * 结束时不能只把本地暂存删掉：云端那份还在。若此时网络不通、清除没推上去，
 * 下次进来就会把一份已经打完的局又同步回来。故改为写一个带新 ts 的墓碑占住同一个键，
 * 并把它（而不是 null）推到云端：
 * - 它不会被 loadLocalSession 当成可续玩的局（finished 标记）；
 * - 换设备进来时，云端这份新墓碑能压掉对方本地那份旧的暂存，
 *   否则「A 设备打完了、B 设备还在提示继续上一轮」，B 一点就把打完的局又救活。
 */
export function finishedSession(mode) {
  return { mode, finished: true, ts: Date.now() };
}

/** 读本地暂存；没有 / 已过期 / 已结束都返回 null */
export function loadLocalSession(variant) {
  const key = SESSION_KEYS[variant];
  if (!key) return null;
  const session = readStore(key);
  if (!isFreshSession(session) || session.finished) return null;
  return session;
}

/** 写本地暂存（每次状态变化覆盖写，刷新即续） */
export function saveLocalSession(variant, session) {
  const key = SESSION_KEYS[variant];
  if (key) writeStore(key, session);
}

/** 各玩法上次推送云端的时间，用于节流（局内状态变化极频繁） */
const lastPushAt = {};

/**
 * 把暂存推到云端
 *
 * 局内每次连锁都会回调 persist，跟着推会把 socket 打满，故按 SESSION.cloudPushMs 节流；
 * 换层 / 结算这类关键节点用 force 立即推，保证换设备时拿到的是最新一局。
 * 结束时不推 null 而是推墓碑，理由见 finishedSession。
 * @returns {boolean} 是否真的发出（被节流或被跳过时为 false）
 */
export function pushSession(variant, session, { force = false } = {}) {
  if (!SESSION_KEYS[variant]) return false;
  const now = Date.now();
  if (!force && now - (lastPushAt[variant] || 0) < SESSION.cloudPushMs) return false;
  lastPushAt[variant] = now;
  return emit('match3_save_session', { variant, session });
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
 * @param {{mode:string, score:number, stars?:number, floor?:number}} options
 *   mode 为 level / endless / endless3 / rogue；floor 只有肉鸽用（经验按层数换算）
 * @returns {number|null} 配置未下发时返回 null
 */
export function estimateExp({ mode, score = 0, stars = 0, floor = 0 }) {
  const rewards = rewardConfig;
  if (!rewards) return null;

  // 肉鸽：经验按**到达层数**换算（与精华同口径），再乘局外增益「经验共鸣」。
  // 不能按总分算——后期得分倍率能堆到 ×45，标定实测满级玩家整轮总分是未养成者的 72 倍，
  // 按分发等于把「堆分」白送成账号等级（见开发方案 5.7 的遗留风险）
  if (mode === 'rogue') {
    const n = Math.min(rogueCfg().maxFloor, Math.max(0, Math.floor(floor) || 0));
    const base = Math.floor(n * n * (rewards.rogueExpFloorFactor || 0));
    return (rewards.baseExp || 0) + Math.floor(base * buffFactor(rogueMeta, 'expboost'));
  }

  const divisorByMode = {
    level: rewards.expPerScoreDivisor,
    endless: rewards.endlessExpPerScoreDivisor || rewards.expPerScoreDivisor,
    endless3:
      rewards.endless3ExpPerScoreDivisor
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
 * 用服务端进度刷新本地缓存
 *
 * 闯关进度以服务端为唯一真相：本地不做 max 合并——本地一旦领先（换账号、未登录时打的关卡），
 * 服务端会一直判「跳关」，而合并取 max 又让本地永远领先，玩家就再也拿不到经验、也进不了榜。
 *
 * 注意语义差异：本地 maxLevel 是「已解锁的最高关」（从 1 起），
 * 服务端 maxLevel 是「已通关的最高关」（从 0 起）。
 */
export function mergeRemoteProgress(remote) {
  if (!remote) return;

  writeStore(STORAGE_KEYS.progress, {
    maxLevel: Math.min(Math.max(0, remote.maxLevel || 0) + 1, LEVEL_COUNT),
    stars: { ...(remote.stars || {}) },
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

  // 肉鸽局外养成（精华 / 祝福等级 / 里程碑）：服务端是唯一权威，本地那份只是离线缓存。
  // 数值表（等级上限 / 费用 / 里程碑定义）也随进度下发，客户端改了服务端配置即时生效
  if (rogue.cfg) setRogueConfig(rogue.cfg);
  if (rogue.meta) applyRogueMeta(rogue.meta);

  mergeRemoteSessions(remote.sessions);
}

/**
 * 合并云端局内暂存
 *
 * 最高分取 max，但暂存**不能**取 max——它是一份「当前进度」，同一局只可能在一个设备上往前推，
 * 所以只认 ts 更新的那份。本地更新时反过来把本地推回云端（含「本轮已结束」的墓碑：
 * 本地可能离线打完了、清除没推上去，这时把墓碑推上去才能让别的设备一起收敛，见 finishedSession）。
 */
function mergeRemoteSessions(remoteSessions) {
  if (!remoteSessions) return;
  for (const variant of Object.keys(SESSION_KEYS)) {
    const incoming = remoteSessions[variant];
    if (!isFreshSession(incoming)) continue;

    const local = readStore(SESSION_KEYS[variant]);
    // 用严格大于：相等说明本地就是这份（同一事件会被多个订阅者各合并一次），
    // 再推一遍只会白发一次上传
    if (isFreshSession(local) && local.ts > incoming.ts) {
      pushSession(variant, local, { force: true });
      continue;
    }
    writeStore(SESSION_KEYS[variant], incoming);
  }
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

// ========== 肉鸽局外养成（开发方案 5.7）==========

/**
 * 养成存档的本地副本
 *
 * 服务端是权威，这份只是它最近一次下发的样子，写 localStorage 只为「离线 / 未登录也能看图鉴、
 * 局内也能抽牌」——所以它只是一份**临时缓存**：一联网就被 match3_progress 覆盖。
 * 缓存为空时用空存档的形态（初始解锁三张、0 精华）。
 */
let rogueMeta = normalizeMeta(readStore(STORAGE_KEYS.rogueMeta));

/** 当前生效的养成存档（图鉴、娱乐菜单、局内抽牌都用它） */
export function getRogueMeta() {
  return rogueMeta;
}

/** 订阅养成存档变化（服务端每次下发、解锁 / 升级 / 领奖成功后都会触发） */
export function onRogueMeta(handler) {
  return eventBus.on('match3:rogueMeta', handler);
}

/**
 * 收下一份养成存档：归一化 → 覆盖本地临时缓存 → 广播
 *
 * 这是**唯一**的写入点，两条来源都走这里：
 * - match3_progress（进入消消乐 / 结算后下发）
 * - match3_rogue_meta（解锁、升级、领里程碑的回执）
 */
function applyRogueMeta(raw) {
  rogueMeta = normalizeMeta(raw);
  writeStore(STORAGE_KEYS.rogueMeta, rogueMeta);
  // 通知已打开的图鉴 / 娱乐菜单重画（余额、等级条、里程碑状态都会变）
  eventBus.emit('match3:rogueMeta', rogueMeta);
}

// 解锁 / 升级 / 领里程碑的回执：服务端把扣费后的最新存档带回来，落到本地并给个提示。
// 与合并进度那条路径的区别：这里带的是 { ok, message, meta }，而进度下发直接给存档本身
eventBus.on('match3:rogueMeta', (data) => {
  if (!data || !data.meta) return;
  if (data.message) {
    if (data.ok) toast.success(data.message);
    else toast.info(data.message);
  }
  applyRogueMeta(data.meta);
});

/**
 * 解锁 / 升级一条祝福：服务端扣精华并校验等级上限，回执走 onRogueMeta
 * @returns {boolean} 是否已发出（未连接时为 false，调用方据此提示玩家）
 */
export function upgradeRoguePerk(perkId) {
  return emit('match3_rogue_upgrade', { perkId });
}

/**
 * 领取图鉴收集里程碑（一次性，达成条件由服务端按存档校验）
 * @returns {boolean} 是否已发出（未连接时为 false）
 */
export function claimRogueMilestone(milestoneId) {
  return emit('match3_rogue_claim', { milestoneId });
}

/**
 * 上报结算；floor 仅肉鸽试炼使用（本轮到达的层数）
 * 肉鸽还会带上本轮选到的祝福次数与达成的局内任务数：它们不进发放，只作养成存档的统计字段
 * @returns {boolean} 是否已上报（未连接时为 false，本局不计进度与经验）
 */
export function reportEnd({
  mode, level = null, floor = null, score, maxCombo, moves, durationMs, cleared, stars = 0,
  picks = null, questsDone = 0,
}) {
  return emit('match3_game_end', {
    mode, level, floor, score, maxCombo, moves, durationMs, cleared, stars, picks, questsDone,
  });
}
