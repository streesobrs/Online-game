/**
 * 肉鸽局外养成（开发方案 5.7）
 *
 * 精华（✦）、祝福等级、里程碑都**以服务端为权威**——解锁与升级要花精华，
 * 只能在服务端扣费校验，客户端改本地存档改不动。本文件只负责两件事：
 * 1. 把服务端下发的存档归一化成一定能用的形状（缺字段补默认、等级裁剪上下界）
 * 2. 算「解锁 / 升级要花多少」「这一轮能拿多少精华」「里程碑达成没有」这类纯推导，
 *    供图鉴、娱乐菜单、模式层复用；标定脚本也用同一份公式，保证数值不漂
 *
 * 数值表（稀有度上限 / 费用 / 里程碑）跟着 `match3_progress` 由服务端下发，
 * 客户端 config.js 的 ROGUE_META 只在**离线 / 游客**时兜底——这样服务端改一处数值就即时生效，
 * 不会出现「界面按旧价显示、点下去被服务端拒绝」的分歧。
 */
import { ROGUE_META } from './config.js';
import { META_BUFFS, PERKS, valueAt } from './perks.js';

/** 服务端下发的数值表（未连接时为空，退回本地镜像） */
let remoteCfg = null;

/**
 * 记录服务端下发的养成数值表
 * @param {object|null} cfg - server/config.js 的 match3Rogue（含 rarities / milestones / essenceDivisor）
 */
export function setRogueConfig(cfg) {
  remoteCfg = cfg && typeof cfg === 'object' ? cfg : null;
}

/** 当前生效的数值表：服务端的优先，其次本地镜像 */
export function rogueCfg() {
  return {
    rarities: remoteCfg?.rarities || ROGUE_META.rarities,
    milestones: remoteCfg?.milestones || ROGUE_META.milestones,
    essenceDivisor: remoteCfg?.essenceDivisor || ROGUE_META.essenceDivisor,
    // 单轮层数上限（防刷分用的天花板，正常打不到）：精华与经验的预览都要按它截断，
    // 否则界面上会显示出一个服务端根本不会发的数
    maxFloor: remoteCfg?.maxFloor || ROGUE_META.maxFloor,
    // 机制节点参数：服务端也有一份（「丰收闭环」是两端同口径结算的），优先用它
    mechanics: remoteCfg?.mechanics || ROGUE_META.mechanics,
    startingPerks: ROGUE_META.startingPerks,
  };
}

/** 某条祝福的稀有度配置（等级上限 / 费用）。稀有度不存在时按 common 兜底 */
export function rarityOf(perk) {
  const table = rogueCfg().rarities;
  return table[perk.rarity] || table.common;
}

/**
 * 养成项的等级上限
 * - 机制节点（共鸣树末端，`kind: 'mechanic'`）一次性解锁：上限固定 1，稀有度只决定它多贵
 * - 数值节点与祝福：由稀有度决定
 */
export function maxLevelOf(entry) {
  if (entry?.kind === 'mechanic') return 1;
  return rarityOf(entry).maxLevel;
}

/**
 * 新建一份空存档
 *
 * 两个地方会用到：未登录（游客）时的本地临时存档，以及服务端还没下发时的兜底。
 * 初始解锁 ROGUE_META.startingPerks（刻意都是成长类，保证开局三选一有牌可选）。
 */
export function emptyMeta() {
  const perks = {};
  for (const id of ROGUE_META.startingPerks) perks[id] = { lv: 1 };
  return {
    version: 1,
    essence: 0,
    essenceEarned: 0,
    perks,
    buffs: {},
    claimed: {},
    stats: { runs: 0, bestFloor: 0, totalCleared: 0, questsDone: 0 },
  };
}

/**
 * 归一化服务端下发的存档
 *
 * 服务端存得比较全（每张祝福的解锁时间、累计选取次数、局数统计等），
 * 这里只保留客户端要用的部分，并把等级裁到 [0, 稀有度上限]：
 * 万一数值被改坏、或将来调低了上限，界面也不会画出「9/4 级」这种条。
 * 初始解锁的三张若不在存档里（老档 / 首次下发）就地补上。
 */
export function normalizeMeta(raw) {
  const base = emptyMeta();
  if (!raw || typeof raw !== 'object') return base;

  const perks = { ...base.perks };
  for (const perk of PERKS) {
    const saved = raw.perks && raw.perks[perk.id];
    const lv = Math.max(0, Math.min(maxLevelOf(perk), Math.floor(Number(saved?.lv) || 0)));
    if (lv > 0) perks[perk.id] = { ...saved, lv };
    else delete perks[perk.id];
  }
  // 局外增益同理，只是没有「开局赠送」这一说（全部从 0 起）
  const buffs = {};
  for (const buff of META_BUFFS) {
    const saved = raw.buffs && raw.buffs[buff.id];
    const lv = Math.max(0, Math.min(maxLevelOf(buff), Math.floor(Number(saved?.lv) || 0)));
    if (lv > 0) buffs[buff.id] = { ...saved, lv };
  }

  return {
    version: Math.max(1, Math.floor(Number(raw.version) || 1)),
    essence: Math.max(0, Math.floor(Number(raw.essence) || 0)),
    essenceEarned: Math.max(0, Math.floor(Number(raw.essenceEarned) || 0)),
    perks,
    buffs,
    claimed: raw.claimed && typeof raw.claimed === 'object' ? { ...raw.claimed } : {},
    stats: { ...base.stats, ...(raw.stats || {}) },
  };
}

/** 某条祝福当前的局外等级（0 = 未解锁） */
export function perkLevel(meta, perkId) {
  return meta?.perks?.[perkId]?.lv || 0;
}

/** 某个局外增益的等级（0 = 未解锁） */
export function buffLevel(meta, buffId) {
  return meta?.buffs?.[buffId]?.lv || 0;
}

/**
 * 某条养成项的等级——祝福在 `perks` 里、局外增益在 `buffs` 里，
 * 靠 `scope: 'buff'` 分辨（见 perks.js 的 META_BUFFS）。界面只关心「这项现在几级」。
 */
export function itemLevel(meta, entry) {
  return entry?.scope === 'buff' ? buffLevel(meta, entry.id) : perkLevel(meta, entry.id);
}

/**
 * 局外增益在某份存档下实际生效的倍率
 *
 * 未解锁按 **1**（不变），不是按 lv1——它是纯增益，没买就没有；解锁那一刻才拿到 base。
 * 取整口径与祝福的 valueAt 一致（两位小数），保证服务端与客户端算出来是同一个数。
 */
export function buffFactor(meta, buffId) {
  const buff = META_BUFFS.find((b) => b.id === buffId);
  const lv = buffLevel(meta, buffId);
  if (!buff || lv <= 0) return 1;
  return valueAt(buff, lv);
}

/** 机制节点参数表（见 config.js 的 ROGUE_META.mechanics） */
export function mechanicCfg() {
  return rogueCfg().mechanics;
}

/** 某个机制节点（共鸣树末端的大节点）是否已解锁 */
export function mechanicOn(meta, id) {
  return buffLevel(meta, id) > 0;
}

/**
 * 前置节点是否都已解锁（共鸣树的连线：只能沿自己那条流派往下买）
 * 数值节点与机制节点同一套判定——前置没解锁时客户端置灰，服务端也会拒绝。
 */
export function requiresMet(meta, entry) {
  const needs = entry?.requires || [];
  return needs.every((id) => buffLevel(meta, id) > 0);
}

/**
 * 把共鸣树里「局内生效」的数值节点加成写进本轮 bonus
 *
 * 只有带 `apply` 的数值节点走这条路：经验 / 精华共鸣是**结算侧**的倍率（由 buffFactor 处理），
 * 机制节点改的是规则、也不在这里（见 mode-rogue 与 config.js 的 mechanics）。
 * 每轮开局调一次即可——局外增益是跨轮常驻的，等级在一轮中间不会变。
 * @param {object} bonus - createBonus() 的结果（就地修改）
 * @param {object} meta - 养成存档
 */
export function applyMetaBuffs(bonus, meta) {
  for (const buff of META_BUFFS) {
    if (buff.kind === 'mechanic' || typeof buff.apply !== 'function') continue;
    const lv = buffLevel(meta, buff.id);
    if (lv <= 0) continue;
    buff.apply(bonus, { lv });
  }
  // 「先手规划」：只改第 1 层的起手步数倍率，写进 bonus 由 floorOptions 在第 1 层用掉
  if (mechanicOn(meta, 'planning')) {
    bonus.firstFloorMult = mechanicCfg().planning.firstFloorMovesMult;
  }
}

/**
 * 一条里程碑实际能领多少精华
 * 「丰收闭环」会把里程碑奖励整体翻倍——服务端 claimRogueMilestone 用同一份参数，
 * 两处必须一致，否则界面显示的数会与真正到账的对不上。
 */
export function milestoneReward(ms, meta) {
  const mult = mechanicOn(meta, 'harvest') ? mechanicCfg().harvest.milestoneMult : 1;
  return Math.floor(ms.reward * mult);
}

/** 已解锁的祝福 id 集合（三选一抽取时用来过滤池子） */
export function unlockedSet(meta) {
  const set = new Set();
  for (const perk of PERKS) {
    if (perkLevel(meta, perk.id) > 0) set.add(perk.id);
  }
  return set;
}

/**
 * 把某条祝福从当前等级往上推一级的花费
 * - 未解锁（lv0）→ 解锁费
 * - 已解锁 → 升级费 × 递增系数^(lv-1)：费用随等级上涨，避免精华全砸在一张牌上
 * @returns {number} 精华数
 */
export function costToUpgrade(perk, lv) {
  const cfg = rarityOf(perk);
  if (lv <= 0) return cfg.unlockCost;
  return Math.round(cfg.upgradeCost * cfg.costGrowth ** (lv - 1));
}

/**
 * 某条养成项（祝福或局外增益）的「下一步」：解锁还是升级、要花多少、升完是几级
 * @returns {{kind:'unlock'|'upgrade', lv:number, nextLv:number, cost:number}|null} 已满级返回 null
 */
export function nextStep(meta, entry) {
  const lv = itemLevel(meta, entry);
  if (lv >= maxLevelOf(entry)) return null;
  return {
    kind: lv <= 0 ? 'unlock' : 'upgrade',
    lv,
    nextLv: lv + 1,
    cost: costToUpgrade(entry, lv),
  };
}

/**
 * 本轮能拿多少精华：只按到达层数，与分数无关
 * 平方增长（第 10 层 20 / 20 层 80 / 30 层 180）——越深收益越高，
 * 而深层又得靠祝福堆起来，正好形成「打深 → 解锁 → 打更深」的正循环。
 * 局外增益「精华共鸣」在这里乘上去（未解锁 ×1，与不买时逐位一致），
 * 「丰收闭环」再加一笔按层数的定额（未解锁 +0）；
 * 层数上限与服务端同源，避免预览显示一个服务端不会发的数。
 * @param {number} floor - 本轮到达的层数
 * @param {object} [meta] - 养成存档（不传则只算基础值）
 */
export function essenceForRun(floor, meta = null) {
  const cfg = rogueCfg();
  const n = Math.min(cfg.maxFloor, Math.max(0, Math.floor(floor) || 0));
  const base = Math.floor((n * n) / cfg.essenceDivisor);
  let gain = Math.floor(base * buffFactor(meta, 'essenceboost'));
  if (mechanicOn(meta, 'harvest')) gain += Math.floor(n * cfg.mechanics.harvest.essencePerFloor);
  return gain;
}

/** 已解锁 / 已满级的张数（图鉴顶部与里程碑判定用） */
export function poolProgress(meta) {
  let unlocked = 0;
  let maxed = 0;
  for (const perk of PERKS) {
    const lv = perkLevel(meta, perk.id);
    if (lv > 0) unlocked += 1;
    if (lv >= maxLevelOf(perk)) maxed += 1;
  }
  return { unlocked, maxed, total: PERKS.length };
}

/**
 * 里程碑状态（含达成与已领取标记），顺序与数值表一致
 * @returns {Array<object>} 每条 = 定义项 + { need, have, done, claimed }
 */
export function milestoneState(meta) {
  const { unlocked, maxed } = poolProgress(meta);
  return rogueCfg().milestones.map((def) => {
    const have = def.kind === 'maxed' ? maxed : unlocked;
    const need = def.kind === 'all' ? PERKS.length : def.need;
    return { ...def, need, have, done: have >= need, claimed: !!meta?.claimed?.[def.id] };
  });
}

/** 有几条里程碑是「已达成但还没领」的（菜单上挂小红点用） */
export function claimableCount(meta) {
  return milestoneState(meta).filter((m) => m.done && !m.claimed).length;
}
