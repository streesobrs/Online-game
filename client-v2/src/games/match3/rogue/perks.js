/**
 * 肉鸽试炼的祝福池与「本轮加成」推导（开发方案 5.6）
 *
 * 本文件是纯数据 + 纯逻辑，不碰 DOM：模式层（mode-rogue.js）只负责渲染与接线，
 * 标定脚本（tests）也直接复用这里的公式，保证「文档里的数值」与「跑起来的数值」不会漂。
 *
 * 一轮 run 的强度全部汇总在 `bonus` 这一个普通对象里：
 * 祝福的 apply 只做累加，每层开局参数与目标分由 floorOptions / goalOf 从 bonus 推导得出。
 * 这样加新祝福只要加一条数据，不用动模式层的任何分支。
 *
 * 等级（局外养成，开发方案 5.7）：
 * - 每条祝福只声明 `rarity`（稀有度）与 `scales`（等级 → 单次效果的曲线），
 *   等级上限与解锁 / 升级费用由 config.js 的 ROGUE_META.rarities 按稀有度给出
 * - `scales.base` 就是 **lv1 的数值**，即标定基线；升级只是让它变大（见 valueAt）
 * - lv0 = 未解锁，不进三选一池（由 meta.js 决定池子）
 */
import { ROGUE, ROGUE_SHAPE, SCORE, SPECIAL } from '../config/config.js';

/** 本轮加成的初始值（每开一轮 run 都要新建一个） */
export function createBonus() {
  return {
    moves: 0,           // 每层起手步数加成
    colorCut: 0,        // 元素种类下调档数
    scoreMult: 1,       // 得分倍率（累乘，与层数无关的那部分）
    cascadeBonus: 0,    // 连锁倍率上限加成（实测无效，未进祝福池，见开发方案 5.6）
    specials: { row: 0, bomb: 0, rainbow: 0 }, // 每层开局注入的特殊元素数量
    goalCut: 0,         // 目标分减免（累加）
    shields: 0,         // 剩余免死次数
    shuffles: 0,        // 每层免费洗牌次数
    floorMult: 0,       // 层数成长：每深 1 层，得分倍率额外增加的比率（线性叠加）
    moveGrowth: 0,      // 层数成长：每 movesPerFloorStep 层多发步数的倍率加成
    weightColor: 0,     // 「同色磁石」选定的颜色（0 = 未选），见 floorOptions 的 colorWeights
    weightMult: 1,      // 该颜色的出现权重倍率（每叠一层 ×ROGUE.magnetMult）
    firstFloorMult: 1,  // 「先手规划」机制：第 1 层起手步数的额外倍率（未解锁 = 1，不等于没生效）
  };
}

/** 从 apply 的上下文里取本次生效的等级（缺省 1 = 未升级） */
function lvOf(ctx) {
  return Math.max(1, Math.floor((ctx && ctx.lv) || 1));
}

/**
 * 祝福在某个等级下的「单次效果值」
 * - add：base + per × (lv − 1)         —— 加量类（步数、个数、档数）
 * - mult：base × (1 + per × (lv − 1))  —— 比例类（得分倍率、目标减免、出现权重）
 * 结果保留两位小数：比例类的中间等级多半不是整数（如 ×1.43），四舍五入到两位即可，
 * 引擎算分时用的就是这个值本身，展示与结算不会分歧。
 * @param {object} perk - 祝福
 * @param {number} [lv] - 局外等级（≤0 或省略按 1 计，便于未解锁时展示 lv1 数值）
 */
export function valueAt(perk, lv = 1) {
  const { kind = 'add', base, per = 0 } = perk.scales || {};
  const n = Math.max(1, Math.floor(lv || 1));
  const raw = kind === 'mult' ? base * (1 + per * (n - 1)) : base + per * (n - 1);
  return Math.round(raw * 100) / 100;
}

/**
 * 取一条祝福（或任务奖励）的说明文字
 * 祝福的 desc 是「按等级生成」的函数（用 this 读自己的 scales，必须 perk.desc(lv) 这样调用）；
 * 任务奖励没有等级概念，desc 仍是普通字符串。
 */
export function descOf(entry, lv = 1) {
  return typeof entry.desc === 'function' ? entry.desc(lv) : entry.desc;
}

/** 百分比展示：0.234 → 23.4 */
function pct(v) {
  return Math.round(v * 1000) / 10;
}

/**
 * 祝福池
 * - `rarity`：稀有度（common / rare / epic），决定等级上限与解锁 / 升级费用（见 ROGUE_META.rarities）
 * - `scales`：等级 → 单次效果值的曲线（见 valueAt）
 * - `max`：一轮内最多叠加几次（叠满后不再出现在三选一里）
 * - `growth`：是否属于「成长类」。前 ROGUE.friendlyPicks 次三选一只出成长类，
 *   避免开局连出保命 / 工具牌，导致第 2~3 层就因强度不足翻车（模拟标定时观察到的失败模式）。
 *   新号初始解锁的三张也刻意都选成长类，保证开局三选一有牌可选
 * - `apply(bonus, ctx)`：只做累加；ctx = { lv, rng }，需要入局随机时用 ctx.rng
 */
export const PERKS = [
  {
    id: 'supply',
    icon: '🎒',
    name: '补给包',
    rarity: 'common',
    scales: { kind: 'add', base: 2, per: 1 },
    desc(lv) { return `每层起手步数 +${valueAt(this, lv)}`; },
    max: 3,
    growth: true,
    apply(bonus, ctx) { bonus.moves += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'minimal',
    icon: '🎨',
    name: '极简主义',
    rarity: 'common',
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) { return `本局元素种类 −${valueAt(this, lv)}（最低 ${ROGUE.minColors} 色）`; },
    max: 2,
    growth: true,
    apply(bonus, ctx) { bonus.colorCut += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'focus',
    icon: '💎',
    name: '熟练手法',
    rarity: 'rare',
    scales: { kind: 'mult', base: 1.25, per: 0.14 },
    desc(lv) { return `本局得分 ×${valueAt(this, lv)}`; },
    max: 6,
    growth: true,
    apply(bonus, ctx) { bonus.scoreMult *= valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'arsenal',
    icon: '🧨',
    name: '军火库',
    rarity: 'common',
    scales: { kind: 'add', base: 3, per: 1 },
    desc(lv) { return `每层开局送 ${valueAt(this, lv)} 个条状`; },
    max: 3,
    growth: true,
    apply(bonus, ctx) { bonus.specials.row += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'bomber',
    icon: '💣',
    name: '爆破专家',
    rarity: 'common',
    scales: { kind: 'add', base: 2, per: 1 },
    desc(lv) { return `每层开局送 ${valueAt(this, lv)} 个炸弹`; },
    max: 3,
    growth: true,
    apply(bonus, ctx) { bonus.specials.bomb += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'rainbow',
    icon: '🌈',
    name: '彩球礼物',
    rarity: 'rare',
    scales: { kind: 'add', base: 2, per: 1 },
    desc(lv) { return `每层开局送 ${valueAt(this, lv)} 个彩球`; },
    max: 2,
    growth: true,
    apply(bonus, ctx) { bonus.specials.rainbow += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'scout',
    icon: '🧭',
    name: '侦察报告',
    rarity: 'common',
    scales: { kind: 'mult', base: 0.18, per: 0.3 },
    desc(lv) { return `本局目标分 −${pct(valueAt(this, lv))}%`; },
    max: 4,
    growth: true,
    apply(bonus, ctx) { bonus.goalCut += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'magnet',
    icon: '🧲',
    name: '同色磁石',
    rarity: 'epic',
    scales: { kind: 'mult', base: ROGUE.magnetMult, per: 0.07 },
    desc(lv) {
      return `随机锁定一种颜色，其出现概率 ×${valueAt(this, lv)}（此时盘面会越来越「同色」，连带爆炸）`;
    },
    max: 2,
    growth: true,
    // 需要 rng 来锁定颜色：这是唯一一个「带副作用」的祝福字段，
    // 选中后整轮固定，后续每层补充新方块都按这个权重来（见 floorOptions 的 colorWeights）。
    // 不传 rng（如三选一卡片上的「下一层」预览）时只累加倍率、不锁色，预览显示为「随机一色」
    apply(bonus, ctx) {
      const rng = ctx && ctx.rng;
      // 只在前 minColors 种颜色里挑：「极简主义」会把颜色数压到 minColors，
      // 若锁定的是更靠后的颜色，降色后它就不存在了，这张祝福等于白选
      if (!bonus.weightColor && rng) bonus.weightColor = 1 + rng.int(ROGUE.minColors);
      // scales.base 就是 ROGUE.magnetMult，所以 lv1 与旧版逐位一致，升级只是把这个权重推得更高
      bonus.weightMult *= valueAt(this, lvOf(ctx));
    },
  },
  {
    id: 'abyss',
    icon: '🕳',
    name: '深渊回响',
    rarity: 'epic',
    scales: { kind: 'add', base: 0.08, per: 0.03 },
    desc(lv) { return `每深 1 层，得分倍率额外 +${pct(valueAt(this, lv))}%（越深越猛）`; },
    max: 2,
    growth: true,
    apply(bonus, ctx) { bonus.floorMult += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'deepsteps',
    icon: '🥾',
    name: '深入脚步',
    rarity: 'rare',
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) {
      return `层数成长翻倍：每 ${ROGUE.movesPerFloorStep} 层多发的步数 +${valueAt(this, lv)}`;
    },
    max: 1,
    growth: true,
    apply(bonus, ctx) { bonus.moveGrowth += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'storm',
    icon: '🌪',
    name: '彩虹风暴',
    rarity: 'epic',
    scales: { kind: 'add', base: 3, per: 1 },
    desc(lv) { return `每层开局送 ${valueAt(this, lv)} 个彩球`; },
    max: 2,
    growth: true,
    apply(bonus, ctx) { bonus.specials.rainbow += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'barrage',
    icon: '🎆',
    name: '火力覆盖',
    rarity: 'epic',
    // 条状按 scales 成长，炸弹跟着同一档增量（+1/级）
    scales: { kind: 'add', base: 3, per: 1 },
    desc(lv) {
      return `每层开局送 ${valueAt(this, lv)} 个条状 + ${valueAt(this, lv) - 1} 个炸弹`;
    },
    max: 2,
    growth: true,
    apply(bonus, ctx) {
      const v = valueAt(this, lvOf(ctx));
      bonus.specials.row += v;
      bonus.specials.bomb += v - 1;
    },
  },
  {
    id: 'bloodpact',
    icon: '🔥',
    name: '血祭',
    rarity: 'epic',
    scales: { kind: 'mult', base: 2, per: 0.125 },
    desc(lv) { return `本局得分 ×${valueAt(this, lv)}，代价是每层起手步数 −2`; },
    max: 1,
    growth: false,
    // 升级只增强收益，代价固定 −2（否则高等级会让这张牌直接不可用）
    apply(bonus, ctx) { bonus.scoreMult *= valueAt(this, lvOf(ctx)); bonus.moves -= 2; },
  },
  {
    id: 'shield',
    icon: '🛡',
    name: '免死金牌',
    rarity: 'common',
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) {
      return `步数耗尽时补 ${ROGUE.shieldMoves} 步继续本层（每张一次性，可叠 ${valueAt(this, lv)} 次）`;
    },
    max: 2,
    growth: false,
    apply(bonus, ctx) { bonus.shields += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'shuffle',
    icon: '🔄',
    name: '备用洗牌',
    rarity: 'common',
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) { return `每层免费洗牌 +${valueAt(this, lv)} 次`; },
    max: 3,
    growth: false,
    apply(bonus, ctx) { bonus.shuffles += valueAt(this, lvOf(ctx)); },
  },
];

/**
 * 局外增益 =「共鸣树」（跨轮常驻，开发方案 5.7）
 *
 * 与 PERKS 的分工：祝福是**局内**的（三选一抽取、一轮结束清空），共鸣树是**跨轮**的——
 * 不进三选一池，等级与费用和祝福同源（同一张稀有度表、同一种精华）。
 * `scope: 'buff'` 是它与祝福的唯一标记：meta.js / codex.js 靠它决定等级去哪个表里读。
 *
 * 结构：3 条流派 × 3 层，共 9 个节点（根「精华 ✦」是画布原点，不是可买的节点）
 *
 * | 流派 | 第 1 层 | 第 2 层 | 第 3 层（机制） |
 * |------|---------|---------|-----------------|
 * | 经济流 | 📘 经验共鸣 | 🔷 精华共鸣 | 💰 丰收闭环 |
 * | 开局流 | 🎒 起始补给 | 🌈 开箱彩球 | 🎁 先手规划 |
 * | 保命流 | 🛡 常驻护盾 | 🔄 常驻洗牌 | ⏳ 时光倒流 |
 *
 * 两种节点（`kind`）：
 * - `value` 数值节点：可逐级升级，效果由 `scales` 给出（见 valueAt），要带上 `apply` 才能真正生效
 * - `mechanic` 机制节点：**改规则**而不是加数值，一次性解锁、上限固定 Lv.1、费用更高；
 *   效果参数在 config.js 的 ROGUE_META.mechanics 里逐条声明，落点在 mode-rogue / meta / 服务端
 *
 * 连线（`requires` = 前置节点 id 列表，`tree` = 画布坐标）：节点只能沿自己那条流派往下买，
 * 前置没解锁时客户端置灰、服务端拒绝。加节点只改这张数据 + 服务端同名表，不用动渲染代码。
 *
 * 注意 `lv0`（未解锁）**按 ×1 / +0 计**，而不是像祝福那样按 lv1——它是纯增益，没买就没有；
 * 这一点由 meta.js 的 buffFactor / applyMetaBuffs 处理，别直接拿 valueAt(buff, 0) 用。
 */
export const META_BUFFS = [
  // ---- 经济流：把每轮结算放大；末端「丰收闭环」把两条回流一起翻倍 ----
  {
    id: 'expboost',
    icon: '📘',
    name: '经验共鸣',
    rarity: 'epic',
    scope: 'buff',
    kind: 'value',
    tree: { col: 0, row: 0 },
    requires: [],
    scales: { kind: 'mult', base: 1.2, per: 0.15 },
    desc(lv) { return `每轮结算的经验 ×${valueAt(this, lv)}`; },
  },
  {
    id: 'essenceboost',
    icon: '🔷',
    name: '精华共鸣',
    rarity: 'rare',
    scope: 'buff',
    kind: 'value',
    tree: { col: 0, row: 1 },
    requires: ['expboost'],
    scales: { kind: 'mult', base: 1.1, per: 0.1 },
    desc(lv) { return `每轮结算的精华 ×${valueAt(this, lv)}`; },
  },
  {
    id: 'harvest',
    icon: '💰',
    name: '丰收闭环',
    rarity: 'epic',
    scope: 'buff',
    kind: 'mechanic',
    tree: { col: 0, row: 2 },
    requires: ['essenceboost'],
    desc: '图鉴里程碑奖励 ×2；每轮结算额外 +⌊到达层数 × 2⌋ 精华',
  },

  // ---- 开局流：堆每层的起手盘面；末端「先手规划」把第 1 层变成抢跑层 ----
  {
    id: 'opening',
    icon: '🎒',
    name: '起始补给',
    rarity: 'common',
    scope: 'buff',
    kind: 'value',
    tree: { col: 1, row: 0 },
    requires: [],
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) { return `每层起手步数 +${valueAt(this, lv)}`; },
    apply(bonus, ctx) { bonus.moves += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'rainbowgift',
    icon: '🌈',
    name: '开箱彩球',
    rarity: 'rare',
    scope: 'buff',
    kind: 'value',
    tree: { col: 1, row: 1 },
    requires: ['opening'],
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) { return `每层开局附赠 ${valueAt(this, lv)} 个彩球`; },
    apply(bonus, ctx) { bonus.specials.rainbow += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'planning',
    icon: '🎁',
    name: '先手规划',
    rarity: 'epic',
    scope: 'buff',
    kind: 'mechanic',
    tree: { col: 1, row: 2 },
    requires: ['rainbowgift'],
    desc: '每轮第 1 层起手步数 ×2；第 1 层过关后三选一连抽 2 次（多拿一张祝福）',
  },

  // ---- 保命流：把「翻车」这条线兜住；末端「时光倒流」直接把这层重打一次 ----
  {
    id: 'shieldwall',
    icon: '🛡',
    name: '常驻护盾',
    rarity: 'common',
    scope: 'buff',
    kind: 'value',
    tree: { col: 2, row: 0 },
    requires: [],
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) { return `每轮免死 ${valueAt(this, lv)} 次（补 ${ROGUE.shieldMoves} 步继续本层）`; },
    apply(bonus, ctx) { bonus.shields += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'reshuffle',
    icon: '🔄',
    name: '常驻洗牌',
    rarity: 'common',
    scope: 'buff',
    kind: 'value',
    tree: { col: 2, row: 1 },
    requires: ['shieldwall'],
    scales: { kind: 'add', base: 1, per: 1 },
    desc(lv) { return `每层免费洗牌 +${valueAt(this, lv)} 次`; },
    apply(bonus, ctx) { bonus.shuffles += valueAt(this, lvOf(ctx)); },
  },
  {
    id: 'rewind',
    icon: '⏳',
    name: '时光倒流',
    rarity: 'epic',
    scope: 'buff',
    kind: 'mechanic',
    tree: { col: 2, row: 2 },
    requires: ['reshuffle'],
    desc: '每轮 1 次：本层步数耗尽仍未达标时重置该层重打（不判本轮结束）',
  },
];

/**
 * 本层目标分
 * @param {number} floor - 层号（从 1 起）
 * @param {object} bonus - 本轮加成
 */
export function goalOf(floor, bonus) {
  const base =
    ROGUE.baseGoal
    * ROGUE.goalGrowth ** (floor - 1)
    * (1 + ROGUE.perkGoalWeight * (floor - 1));
  return Math.round(base * (1 - bonus.goalCut));
}

/**
 * 本层开局参数：直接喂给 board 的 payload
 *
 * 两条**层数成长轴**（见开发方案 5.6 的「层数成长来源」）：
 * - 步数：每 movesPerFloorStep 层多发 (1 + moveGrowth) 步
 * - 倍率：得分倍率再乘 (1 + floorMult × (层数-1))，线性上涨
 * 只有「深渊回响」「深入脚步」两张祝福吃这两条，其它祝福都是与层数无关的固定加成，
 * 因此不加这两张牌时，行为与旧版完全一致。
 * @param {object} bonus - 本轮加成
 * @param {number} [floor] - 层号（层数成长来源）
 * @param {object} [terrain] - 本层地形（floor-types.js 的 terrainFor 结果，开发方案 3.2）：
 *   带 mask 时切到 9×9 异形盘并降色、透传 blockers；不传 = 旧版 8×8 满盘（标定脚本兼容）
 */
export function floorOptions(bonus, floor = 1, terrain = null) {
  const specials = [];
  if (bonus.specials.row) specials.push({ kind: SPECIAL.ROW, count: bonus.specials.row });
  if (bonus.specials.bomb) specials.push({ kind: SPECIAL.BOMB, count: bonus.specials.bomb });
  if (bonus.specials.rainbow) specials.push({ kind: SPECIAL.RAINBOW, count: bonus.specials.rainbow });

  const baseColors = Math.max(ROGUE.minColors, ROGUE.colors - bonus.colorCut);
  // 异形盘（挖洞 / 分仓）行列不贯通，6 色会频繁无解，强制降一档（见 levels.js 标定注释）
  const colors = terrain?.mask ? Math.min(baseColors, ROGUE_SHAPE.maxColors) : baseColors;
  // 颜色权重：只有「同色磁石」会给出非均匀权重；其余情况保持 null（等概率），
  // 与旧版逐位一致——这一点在引擎侧同样是硬约束（见 cascade.js 的 pickColor）
  const colorWeights =
    bonus.weightColor > 0 && bonus.weightMult > 1 && bonus.weightColor <= colors
      ? Array.from({ length: colors }, (_, k) => (k === bonus.weightColor - 1 ? bonus.weightMult : 1))
      : null;

  const baseMoves = ROGUE.movesPerFloor
    + bonus.moves
    + Math.floor((floor - 1) / ROGUE.movesPerFloorStep) * (1 + bonus.moveGrowth);

  return {
    rows: terrain?.mask ? ROGUE_SHAPE.size : ROGUE.rows,
    cols: terrain?.mask ? ROGUE_SHAPE.size : ROGUE.cols,
    mask: terrain?.mask || null,
    blockers: terrain?.blockers || null,
    colors,
    // 「先手规划」机制只放大第 1 层的起手步数（后面几层按原曲线走，否则等于白送一层成长）
    moves: floor === 1 ? Math.round(baseMoves * (bonus.firstFloorMult || 1)) : baseMoves,
    scoreMult: bonus.scoreMult * (1 + bonus.floorMult * (floor - 1)),
    cascadeMax: SCORE.cascadeMax + bonus.cascadeBonus,
    specials,
    colorWeights,
  };
}

/**
 * 三选一抽取：从未叠满的**已解锁**祝福里随机取，前几次只出成长类
 * @param {object} rng - 引擎的随机数发生器
 * @param {Record<string, number>} picks - 已选祝福 { 祝福id: 次数 }
 * @param {Set<string>|null} [allowed] - 已解锁的祝福 id；传 null / 不传表示不过滤（标定脚本用）
 * @param {object} [opts]
 * @param {'common'|'rare'|'epic'} [opts.minRarity] - 稀有度保底（精英层 rare / Boss 层 epic，开发方案 3.3）；
 *   保底档池子为空（对应稀有度一张都没解锁）时自动回退到全池，保证三选一不空
 * @param {number} [opts.choices] - 备选张数，缺省走 ROGUE.perkChoices；
 *   遗物「宽幅选择」会把它调大（开发方案 3.5）
 * @param {string[]|Set<string>} [opts.banned] - 被封禁的祝福 id（商店「移除服务」写入，
 *   开发方案 3.6）：这些牌永不进池，即使已解锁 / 未叠满
 * @returns {Array} 备选祝福（池子不够 choices 张时会少于该数）
 */
export function rollPerks(rng, picks = {}, allowed = null, opts = {}) {
  const pickedTotal = Object.values(picks).reduce((sum, n) => sum + (n || 0), 0);
  const grownOnly = pickedTotal < ROGUE.friendlyPicks;
  const rank = { common: 0, rare: 1, epic: 2 };
  const minRank = opts.minRarity ? rank[opts.minRarity] ?? 0 : 0;
  const banned = opts.banned instanceof Set
    ? opts.banned
    : new Set(Array.isArray(opts.banned) ? opts.banned : []);
  const want = Number.isFinite(opts.choices) && opts.choices > 0
    ? Math.floor(opts.choices)
    : ROGUE.perkChoices;
  const eligible = (perk) => {
    if (banned.has(perk.id)) return false;
    if (allowed && !allowed.has(perk.id)) return false;
    if ((picks[perk.id] || 0) >= perk.max) return false;
    return !(grownOnly && !perk.growth);
  };
  const all = PERKS.filter(eligible);
  // 保底池：达到稀有度档位的候选；不够凑一张就回退全池（新号也可能走到精英层）
  const guaranteed = minRank > 0 ? all.filter((p) => rank[p.rarity] >= minRank) : all;
  const rest = guaranteed.length > 0 ? guaranteed.slice() : all.slice();

  const out = [];
  while (out.length < want && rest.length > 0) {
    out.push(rest.splice(rng.int(rest.length), 1)[0]);
  }
  return out;
}

/**
 * 局内任务的奖励池（开发方案 5.6 的「局内随机任务」）
 *
 * 全部是**当场生效的机制改变**，而不是又一条数值累加——这是它与层间祝福的分工：
 * 祝福负责「本轮越滚越强」，任务奖励负责「这一层立刻爽一下」。
 * `apply(board, opts)` 由 mode-rogue 在任务达成时调用，opts 是本层 floorOptions 的结果。
 */
export const QUEST_REWARDS = [
  {
    id: 'moves',
    icon: '🥾',
    name: '补给',
    desc: `立即 +${ROGUE.quest.movesReward} 步`,
    apply(board) { board.addMoves(ROGUE.quest.movesReward); },
  },
  {
    id: 'frenzy',
    icon: '🔥',
    name: '狂暴',
    desc: `本层剩余步数内得分 ×${ROGUE.quest.frenzyMult}`,
    apply(board, opts) { board.setScoreMult(opts.scoreMult * ROGUE.quest.frenzyMult); },
  },
  {
    id: 'boom',
    icon: '🎆',
    name: '爆破',
    desc: `场上随机 ${ROGUE.quest.specialsReward} 颗变成条状`,
    apply(board) { board.addSpecials([{ kind: SPECIAL.ROW, count: ROGUE.quest.specialsReward }]); },
  },
  {
    id: 'rainbow',
    icon: '🌈',
    name: '彩球',
    desc: '立即获得 1 个彩球（换到哪一色就清哪一色）',
    apply(board) { board.addSpecials([{ kind: SPECIAL.RAINBOW, count: 1 }]); },
  },
];

/**
 * 本层局内任务：随机指定一种颜色 + 需要收集的个数 + 达成奖励
 *
 * 不设失败惩罚——它的作用是给层内制造一个额外决策焦点（要不要为了它换一种消法），
 * 而不是加难度。目标数随层数缓涨（`needGrowth` 只有 1.09，远低于目标分的 1.33），
 * 保证深层依然做得到，只是需要玩家主动偏向这个颜色。
 * @param {number} floor - 层号
 * @param {object} bonus - 本轮加成（决定当前颜色数，任务颜色必须落在现有颜色里）
 * @param {object} rng - 随机数发生器
 * @returns {object|null} 任务对象；`fromFloor` 之前返回 null
 */
export function questFor(floor, bonus, rng) {
  const cfg = ROGUE.quest;
  if (floor < cfg.fromFloor) return null;
  const colors = Math.max(ROGUE.minColors, ROGUE.colors - bonus.colorCut);
  return {
    color: 1 + rng.int(colors),
    need: Math.round(cfg.baseNeed * cfg.needGrowth ** (floor - 1)),
    reward: QUEST_REWARDS[rng.int(QUEST_REWARDS.length)],
    progress: 0,
    done: false,
  };
}
