/**
 * 遗物：机制性被动（开发方案 3.5，P3）
 *
 * 与祝福（perks.js）的分工（见开发方案 3.5 / 4.2 的三层 build 边界）：
 * - 祝福 PERKS：**数值底盘**——可反复叠加、进三选一池，靠 apply 往同一个 bonus 上累加；
 * - 遗物 RELICS：**玩法引擎**——每件最多 1 个（max:1，不可叠加）、一轮通常持有 3–6 件、
 *   **不进三选一池**，只从宝藏 / Boss / 事件 / 商店获得（来源见 config.ROGUE_RELIC）。
 * 两者最终都汇总到同一个 bonus + board 上，所以遗物不需要另造一套数值尺度。
 *
 * 零引擎改动：本文件**只用既有钩子**，不新增任何引擎回调——
 * - `grant(bonus, ctx)`：改 bonus。`once:true` 在获得时跑一次；`perFloor:true` 每层开局重放
 *   （perFloor 的 grant 必须**幂等**：重复调用不能叠数值，见每股注释）；
 * - `onStep(ctx, step)`：每次走子后（step = { cascade, gained }），走 board.addMoves / setScoreMult / addSpecials；
 * - `onUpdate(ctx, info)`：每次盘面更新（info = { score, maxCascade, collected, movesLeft, cleared }）；
 * - `mods`：静态修正（商店折扣 / 金币倍率 / 三选一选项数…），由 buildRelicHooks 聚合。
 * 需要改「棋盘生成 / 特殊元素命中」的遗物（如彩球同时清两色、爆炸半径 +1）属于文档里的**第二期**
 * （引擎 hook 档），不在本文件——本文件只收「零引擎档」，覆盖文档里约七成的有趣遗物。
 *
 * 纯数据 + 纯逻辑，不碰 DOM、不用 Math.random：需要随机一律走传入的 rng，
 * 同 seed 必出同结果（与 perks.js / boss.js / rng.js 同一条约定），便于标定与续存复现。
 *
 * 被谁消费：
 * - mode-rogue.js：持有本轮 relics[]，按 buildRelicHooks 在 onStep / onUpdate / 每层开局分发；
 * - 标定脚本（tests/match3-rogue-balance.mjs）与 tests/match3-relics.test.js：复用 rollRelic / buildRelicHooks；
 * - 商店与三选一接线：relicPriceMult / relicRollExtras；
 * - 图鉴（codex）：relicsByRarity。
 */
import { ROGUE, ROGUE_GOLD, ROGUE_RELIC, SPECIAL } from '../config/config.js';

/**
 * 遗物池（开发方案 3.5，首发 20 件）
 *
 * 按四组流派组织（`group`），每组至少 4 件，可拼出文档要求的「≥4 种流派」：
 * - `chain`    连锁流：把长连锁变成步数 / 倍率 / 特殊元素的循环；
 * - `special`  特殊元素流：条状 / 炸弹 / 彩球的产出与滚雪球；
 * - `economy`  经济流：商店折扣、金币、三选一资源；
 * - `survival` 生存流：护盾、洗牌、层数成长与翻盘窗口。
 *
 * 字段：
 * - `rarity`：common / rare / epic；**epic 才是「改规则」级**（下调连锁阈值、每层白送彩球、
 *   翻转经济规则、低步数翻倍），common / rare 只做数值或轻度机制；
 * - `once` / `perFloor`：见文件头的 grant 语义，每条**必须显式标注其中一个**（纯 hook 件两者皆无）；
 * - `max`：恒为 1（遗物不可叠加，这条是开发方案 4.2 表里的硬边界，写出来供图鉴/校验读）。
 *
 * 协同设计（制造「组 build」的乐趣，至少两条在 desc 里点名）：
 * - 「无尽锁链 + 同色磁石 + 极简主义 = 连锁永动」；
 * - 「棱镜种子 + 彩球礼物 = 彩球清屏流」。
 */
export const RELICS = [
  // ===================== 连锁流：奖励长连锁，把「一步多爆」变成资源 =====================
  {
    id: 'infinite_chain',
    icon: '⛓️',
    name: '无尽锁链',
    rarity: 'rare',
    group: 'chain',
    max: 1,
    desc: '连锁达到 4 时返还 1 步（每层最多 3 次）。无尽锁链 + 同色磁石 + 极简主义 = 连锁永动',
    // 用 ctx.used[本遗物 id] 记本层已触发次数（mode-rogue 每层开局把 used 清空）
    onStep(ctx, step) {
      if (!step || step.cascade < 4) return;
      if (usedCount(ctx, this.id) >= 3) return;
      if (addMoves(ctx, 1)) bumpUsed(ctx, this.id);
    },
  },
  {
    id: 'chain_master',
    icon: '🧮',
    name: '连锁大师',
    rarity: 'epic',
    group: 'chain',
    max: 1,
    desc: '改规则：连锁达到 3 即返还 1 步（每层最多 5 次，把常规阈值 4 下调一级）',
    onStep(ctx, step) {
      if (!step || step.cascade < 3) return;
      if (usedCount(ctx, this.id) >= 5) return;
      if (addMoves(ctx, 1)) bumpUsed(ctx, this.id);
    },
  },
  {
    id: 'chain_surge',
    icon: '⚡',
    name: '连锁涌流',
    rarity: 'rare',
    group: 'chain',
    max: 1,
    desc: '连锁达到 5 时本层得分倍率 ×1.5（每层最多 2 次）',
    onStep(ctx, step) {
      if (!step || step.cascade < 5) return;
      if (usedCount(ctx, this.id) >= 2) return;
      // 只在能读到当前倍率时才改：宁可不动，也不能把已有倍率覆盖成 1×1.5
      if (mulScoreMult(ctx, 1.5)) bumpUsed(ctx, this.id);
    },
  },
  {
    id: 'echo_bomb',
    icon: '💥',
    name: '回响爆破',
    rarity: 'common',
    group: 'chain',
    max: 1,
    desc: '连锁达到 4 时立即造 1 个炸弹（每层最多 2 次）。回响爆破 + 爆破税 = 连锁爆破',
    onStep(ctx, step) {
      if (!step || step.cascade < 4) return;
      if (usedCount(ctx, this.id) >= 2) return;
      if (addSpecial(ctx, SPECIAL.BOMB, 1)) bumpUsed(ctx, this.id);
    },
  },
  {
    id: 'momentum',
    icon: '🚀',
    name: '惯性冲刺',
    rarity: 'common',
    group: 'chain',
    max: 1,
    once: true,
    desc: '每层起手步数 +2，代价是本局目标分 +8%（抢节奏换难度）',
    // once 类：gain 只在获得时跑一次；bonus 的字段是常驻的，所以之后每层都吃得到
    grant(bonus) {
      bonus.moves += 2;
      bonus.goalCut -= 0.08;
    },
  },

  // ===================== 特殊元素流：条状 / 炸弹 / 彩球的产出 =====================
  {
    id: 'prism_seed',
    icon: '🌈',
    name: '棱镜种子',
    rarity: 'epic',
    group: 'special',
    max: 1,
    perFloor: true,
    desc: '改规则：每层开局至少 1 个彩球（与彩球礼物 / 彩虹风暴叠加时取较大值，不重复）。棱镜种子 + 彩球礼物 = 彩球清屏流',
    // perFloor 重放，必须幂等：取 max 而不是 +=，避免每层开局越叠越多
    grant(bonus) {
      bonus.specials.rainbow = Math.max(bonus.specials.rainbow || 0, 1);
    },
  },
  {
    id: 'special_feast',
    icon: '🎆',
    name: '特殊盛宴',
    rarity: 'rare',
    group: 'special',
    max: 1,
    once: true,
    desc: '每层开局各送 1 个条状与 1 个炸弹（军火库 + 爆破专家的机制版）',
    grant(bonus) {
      bonus.specials.row += 1;
      bonus.specials.bomb += 1;
    },
  },
  {
    id: 'row_artisan',
    icon: '🪚',
    name: '条状工匠',
    rarity: 'common',
    group: 'special',
    max: 1,
    once: true,
    desc: '每层开局多 2 个条状（与军火库 / 火力覆盖叠加）',
    grant(bonus) {
      bonus.specials.row += 2;
    },
  },
  {
    id: 'prism_charge',
    icon: '🔮',
    name: '棱镜充能',
    rarity: 'rare',
    group: 'special',
    max: 1,
    desc: '本层首次连锁达到 5 时，额外获得 1 个彩球（每层 1 次）',
    onUpdate(ctx, info) {
      if (!info || !(info.maxCascade >= 5)) return;
      if (usedCount(ctx, this.id) >= 1) return;
      if (addSpecial(ctx, SPECIAL.RAINBOW, 1)) bumpUsed(ctx, this.id);
    },
  },
  {
    id: 'bomb_tithe',
    icon: '🧨',
    name: '爆破税',
    rarity: 'common',
    group: 'special',
    max: 1,
    desc: '每累计消除 20 个方块，立即造 1 个炸弹（回响爆破的另一半，凑连锁爆破）',
    onUpdate(ctx, info) {
      // info.collected 是「各颜色累计数」的字典（见 board.js 的 snapshotInfo），先求和
      const earned = Math.floor(sumCollected(info && info.collected) / 20);
      if (earned <= usedCount(ctx, this.id)) return;
      if (addSpecial(ctx, SPECIAL.BOMB, 1)) bumpUsed(ctx, this.id);
    },
  },

  // ===================== 经济流：商店折扣 / 金币 / 三选一资源 =====================
  {
    id: 'coupon',
    icon: '🎟️',
    name: '优惠券',
    rarity: 'common',
    group: 'economy',
    max: 1,
    desc: `商店价格 ×${ROGUE_GOLD.discountMult}（与砍价高手叠乘，最低 5 折）`,
    mods: { shopDiscount: ROGUE_GOLD.discountMult },
  },
  {
    id: 'gold_vein',
    icon: '🪙',
    name: '金矿脉',
    rarity: 'common',
    group: 'economy',
    max: 1,
    desc: '本局金币获取 ×1.3（金币只在本轮有效，终局清零、不上报）',
    mods: { goldMult: 1.3 },
  },
  {
    id: 'haggler',
    icon: '🤝',
    name: '砍价高手',
    rarity: 'rare',
    group: 'economy',
    max: 1,
    desc: '商店价格再 ×0.6（与优惠券叠乘 = 4.8 折，触及 5 折下限）',
    mods: { shopDiscount: 0.6 },
  },
  {
    id: 'miser',
    icon: '💰',
    name: '守财奴',
    rarity: 'epic',
    group: 'economy',
    max: 1,
    desc: '改规则：金币获取 ×1.6，但商店价格 +20%（只捡不买的经济流）',
    // shopDiscount > 1 = 涨价：这是刻意的拮抗设计，聚合时只对折扣设「下限」、不设上限
    mods: { goldMult: 1.6, shopDiscount: 1.2 },
  },
  {
    id: 'wide_choice',
    icon: '🃏',
    name: '宽幅选择',
    rarity: 'common',
    group: 'economy',
    max: 1,
    desc: '每次三选一额外 +1 个选项',
    mods: { extraChoices: 1 },
  },
  {
    id: 'reroll_token',
    icon: '🎲',
    name: '重随代币',
    rarity: 'rare',
    group: 'economy',
    max: 1,
    desc: '每次三选一额外 1 次重随',
    mods: { rerolls: 1 },
  },

  // ===================== 生存流：护盾 / 层数成长 / 翻盘窗口 =====================
  {
    id: 'floor_ward',
    icon: '🕯️',
    name: '层守庇护',
    rarity: 'common',
    group: 'survival',
    max: 1,
    perFloor: true,
    desc: '每层开局把免死次数补到至少 1 次（幂等不叠加；与免死金牌 / 生命线同用）',
    // perFloor 重放、幂等：护盾会被消耗，所以每层开局「补足到 1」，而不是每层 +1
    grant(bonus) {
      bonus.shields = Math.max(bonus.shields || 0, 1);
    },
  },
  {
    id: 'life_line',
    icon: '🛡',
    name: '生命线',
    rarity: 'rare',
    group: 'survival',
    max: 1,
    once: true,
    desc: `每轮免死次数 +2（步数耗尽时补 ${ROGUE.shieldMoves} 步继续本层）`,
    grant(bonus) {
      bonus.shields += 2;
    },
  },
  {
    id: 'last_stand',
    icon: '⏳',
    name: '背水一战',
    rarity: 'epic',
    group: 'survival',
    max: 1,
    desc: '改规则：本层步数仅剩 ≤3 时，得分倍率 ×1.5（每层 1 次，翻盘窗口）',
    onUpdate(ctx, info) {
      if (!info || !(info.movesLeft > 0) || info.movesLeft > 3) return;
      if (usedCount(ctx, this.id) >= 1) return;
      if (mulScoreMult(ctx, 1.5)) bumpUsed(ctx, this.id);
    },
  },
  {
    id: 'iron_will',
    icon: '🪨',
    name: '铁意志',
    rarity: 'common',
    group: 'survival',
    max: 1,
    once: true,
    desc: `层数成长提速：每 ${ROGUE.movesPerFloorStep} 层多发的步数 +20%，并每层免费洗牌 +1 次`,
    grant(bonus) {
      bonus.moveGrowth += 0.2;
      bonus.shuffles += 1;
    },
  },
];

/** 商店折扣下限：再多件折扣也不低于 5 折，防「免费商店」把金币闭环打穿 */
const SHOP_DISCOUNT_MIN = 0.5;
/** 剩余步数折算金币的倍率上限：防高倍率 build 靠「一步一层」刷钱（见 config.ROGUE_GOLD.moveRefund） */
const MOVE_REFUND_MULT_MAX = 3;
/** 金币倍率上限：同上 */
const GOLD_MULT_MAX = 3;

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** 静默执行：hook 内任何异常（数据写错 / board 缺方法）都只跳过这一条，绝不打断本层 */
function safe(fn) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

/** 本层已触发次数（ctx.used[遗物 id]，缺字段按 0 计） */
function usedCount(ctx, id) {
  const n = ctx && ctx.used && ctx.used[id];
  return Number.isFinite(n) ? n : 0;
}

/** 记一次本层触发（ctx.used 缺字段时按约定静默跳过，不新建结构） */
function bumpUsed(ctx, id) {
  if (!ctx || !ctx.used || typeof ctx.used !== 'object') return;
  ctx.used[id] = usedCount(ctx, id) + 1;
}

/** 追加步数（board 的既有钩子）；成功返回 true */
function addMoves(ctx, n) {
  const board = ctx && ctx.board;
  if (!(n > 0) || !board || typeof board.addMoves !== 'function') return false;
  return safe(() => board.addMoves(n));
}

/**
 * 就地注入特殊元素；成功返回 true
 * board.js 的既有钩子 `addSpecials` 收的是**列表**（见 perks.js 的 QUEST_REWARDS），这里统一包一层
 */
function addSpecial(ctx, kind, count) {
  const board = ctx && ctx.board;
  if (!(count > 0) || !board || typeof board.addSpecials !== 'function') return false;
  return safe(() => board.addSpecials([{ kind, count }]));
}

/**
 * 读当前层得分倍率：读不到就返回 null
 * 注意 board.getState()（`{...state}`）当前**不含** scoreMult，真实倍率在 board.getSnapshot().scoreMult；
 * 两处都探一遍，都取不到就不改——绝不能拿 1×factor 覆盖掉已有的高倍率（那等于把祝福加成清零）
 */
function currentScoreMult(board) {
  const pick = (src) => {
    const v = src && src.scoreMult;
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  for (const getter of ['getState', 'getSnapshot']) {
    if (!board || typeof board[getter] !== 'function') continue;
    let snap = null;
    try {
      snap = board[getter]();
    } catch {
      snap = null;
    }
    const v = pick(snap);
    if (v !== null) return v;
  }
  return null;
}

/** 层中把得分倍率乘以 factor（只影响之后的结算）；成功返回 true */
function mulScoreMult(ctx, factor) {
  const board = ctx && ctx.board;
  if (!board || typeof board.setScoreMult !== 'function') return false;
  const cur = currentScoreMult(board);
  if (cur === null) return false;
  return safe(() => board.setScoreMult(cur * factor));
}

/** 累计消除数：info.collected 可能是数字（标定脚本）或「颜色 → 个数」字典（真实 board） */
function sumCollected(collected) {
  if (Number.isFinite(collected)) return collected;
  if (!collected || typeof collected !== 'object') return 0;
  let sum = 0;
  for (const v of Object.values(collected)) {
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

function ownedSet(owned) {
  return new Set(Array.isArray(owned) ? owned : []);
}

// ---------------------------------------------------------------------------
// 掉落（纯函数）
// ---------------------------------------------------------------------------

/** 按稀有度权重取一件的权重值（缺权重按 0 计，即不会抽到） */
function relicWeight(relic) {
  const w = ROGUE_RELIC.dropWeights[relic.rarity];
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** 加权抽 1 件（rng.next() 决定落点，同 seed 必出同一件） */
function weightedPick(rng, pool) {
  let total = 0;
  for (const r of pool) total += relicWeight(r);
  if (total <= 0) return null;
  let t = rng.next() * total;
  for (const r of pool) {
    t -= relicWeight(r);
    if (t < 0) return r;
  }
  return pool[pool.length - 1];
}

/**
 * 随机掉落 1 件未拥有的遗物
 * @param {object} rng - 随机数发生器（createRng 的返回值）
 * @param {string[]} owned - 本轮已持有的遗物 id（只读，不会被修改）
 * @param {object} [opts]
 * @param {'common'|'rare'|'epic'} [opts.rarity] - 只在该稀有度里抽（不传 = 全池按 dropWeights 加权）
 * @returns {object|null} 遗物定义；池子为空（全抽完 / 该稀有度没有）时返回 null，**绝不抛错**
 */
export function rollRelic(rng, owned = [], opts = {}) {
  if (!rng || typeof rng.next !== 'function') return null;
  const have = ownedSet(owned);
  const pool = RELICS.filter(
    (r) => !have.has(r.id) && (!opts.rarity || r.rarity === opts.rarity),
  );
  if (pool.length === 0) return null;
  return weightedPick(rng, pool);
}

/**
 * 抽 count 件**互不重复**的候选（Boss 遗物宝箱三选一 / 宝藏用）
 * 逐个加权抽且不回填：同一件不会出现两次；池子不够时返回少于 count 个（不报错、不重复）。
 * @param {object} rng
 * @param {string[]} owned - 已持有（只读）
 * @param {number} [count] - 候选数量，默认 config.ROGUE_RELIC.choices
 * @param {object} [opts] - 同 rollRelic（支持 opts.rarity 限定稀有度）
 * @returns {Array} 遗物定义数组
 */
export function rollRelicChoices(rng, owned = [], count = ROGUE_RELIC.choices, opts = {}) {
  const n = Math.max(0, Math.floor(count || 0));
  if (n === 0) return [];
  const taken = Array.isArray(owned) ? owned.slice() : [];
  const out = [];
  while (out.length < n) {
    const relic = rollRelic(rng, taken, opts);
    if (!relic) break;
    out.push(relic);
    taken.push(relic.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 查询 / 图鉴（纯函数）
// ---------------------------------------------------------------------------

/** 按 id 取遗物定义，没有返回 null */
export function relicById(id) {
  return RELICS.find((r) => r.id === id) || null;
}

/** 尚未拥有的遗物（图鉴的「未发现」列表 / 掉落池）；不修改入参 */
export function missingRelics(owned = []) {
  const have = ownedSet(owned);
  return RELICS.filter((r) => !have.has(r.id));
}

/** 图鉴分组：按稀有度归档，固定返回 { common, rare, epic } 三个桶 */
export function relicsByRarity() {
  const out = { common: [], rare: [], epic: [] };
  for (const r of RELICS) {
    (out[r.rarity] || (out[r.rarity] = [])).push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// hook 分发（纯函数，mode-rogue 与标定脚本共用同一份逻辑）
// ---------------------------------------------------------------------------

/**
 * 把本轮持有的遗物 id 编译成一组 hook + 聚合后的静态修正
 *
 * ctx 由调用方提供，本模块只读不造。约定字段：
 * `{ board, bonus, floor, used, rng, toast }`；board 只需有
 * `addMoves(n)` / `addSpecials(list)` / `setScoreMult(x)` / `getState()`。
 * 任何字段缺失都静默跳过（不抛错）。
 *
 * @param {string[]} ownedIds - 本轮持有的遗物 id（只读；重复 id 会被去重，避免 hook 跑两遍）
 * @returns {{
 *   mods: {shopDiscount:number, moveRefundMult:number, goldMult:number,
 *          extraChoices:number, rerolls:number, shieldBonus:number},
 *   onStep: (ctx:object, step:{cascade:number, gained:number}) => void,
 *   onUpdate: (ctx:object, info:object) => void,
 *   onFloorStart: (ctx:object) => void
 * }}
 */
export function buildRelicHooks(ownedIds = []) {
  const owned = [...new Set((Array.isArray(ownedIds) ? ownedIds : []).filter((id) => typeof id === 'string'))];
  const items = owned.map((id) => relicById(id)).filter(Boolean);

  // ---- 静态修正聚合 ----
  // 乘性字段相乘（shopDiscount 夹下限，moveRefundMult / goldMult 夹上限防刷钱）；
  // 加性字段相加。
  const mods = {
    shopDiscount: 1,
    moveRefundMult: 1,
    goldMult: 1,
    extraChoices: 0,
    rerolls: 0,
    shieldBonus: 0,
  };
  for (const item of items) {
    const m = item.mods;
    if (!m) continue;
    if (Number.isFinite(m.shopDiscount)) mods.shopDiscount *= m.shopDiscount;
    if (Number.isFinite(m.moveRefundMult)) mods.moveRefundMult *= m.moveRefundMult;
    if (Number.isFinite(m.goldMult)) mods.goldMult *= m.goldMult;
    if (Number.isFinite(m.extraChoices)) mods.extraChoices += m.extraChoices;
    if (Number.isFinite(m.rerolls)) mods.rerolls += m.rerolls;
    if (Number.isFinite(m.shieldBonus)) mods.shieldBonus += m.shieldBonus;
  }
  mods.shopDiscount = Math.max(SHOP_DISCOUNT_MIN, mods.shopDiscount);
  mods.moveRefundMult = clamp(mods.moveRefundMult, 1, MOVE_REFUND_MULT_MAX);
  mods.goldMult = clamp(mods.goldMult, 1, GOLD_MULT_MAX);

  return {
    mods,
    /** 每次走子后：遍历持有遗物各自的 onStep（step = { cascade, gained }） */
    onStep(ctx, step) {
      for (const item of items) {
        if (typeof item.onStep === 'function') safe(() => item.onStep(ctx, step));
      }
    },
    /** 每次盘面更新：info = { score, maxCascade, collected, movesLeft, cleared } */
    onUpdate(ctx, info) {
      for (const item of items) {
        if (typeof item.onUpdate === 'function') safe(() => item.onUpdate(ctx, info));
      }
    },
    /**
     * 每层开局：只重放 `perFloor` 类 grant（`once` 类已在获得时改过 bonus，不在这里重复叠加）
     * 各 perFloor 遗物的 grant 必须幂等，见池内注释。
     */
    onFloorStart(ctx) {
      for (const item of items) {
        if (item.perFloor && typeof item.grant === 'function') {
          safe(() => item.grant(ctx && ctx.bonus, ctx));
        }
      }
    },
  };
}

/**
 * 获得一件遗物时结算它的 `once` 类效果
 * mode-rogue 在把 id 推进 relics[] 之后调用一次即可；perFloor 类不在这里跑
 * （它交给每层的 onFloorStart 重放，避免刚拿到就多吃一次）。
 * @param {string} id - 刚获得的遗物 id
 * @param {object} ctx - 同上（只需 ctx.bonus，建议一并带 ctx.toast 做获得提示）
 */
export function grantOnAcquire(id, ctx) {
  const item = relicById(id);
  if (!item || !item.once || typeof item.grant !== 'function') return;
  safe(() => item.grant(ctx && ctx.bonus, ctx));
}

// ---------------------------------------------------------------------------
// 商店 / 三选一便捷导出（读 buildRelicHooks 的 mods）
// ---------------------------------------------------------------------------

/** 商店价格系数（≤1 表示打折，>1 表示涨价；已夹到 5 折下限） */
export function relicPriceMult(ownedIds = []) {
  return buildRelicHooks(ownedIds).mods.shopDiscount;
}

/**
 * 三选一的额外资源：`extraChoices`（加选项）与 `rerolls`（加重随按钮）**分开返回**——
 * 两者用法不同，接线时一个改 rollPerks 的取数、一个改重随次数上限。
 */
export function relicRollExtras(ownedIds = []) {
  const mods = buildRelicHooks(ownedIds).mods;
  return { extraChoices: mods.extraChoices, rerolls: mods.rerolls };
}
