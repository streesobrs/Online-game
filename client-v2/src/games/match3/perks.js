/**
 * 肉鸽试炼的祝福池与「本轮加成」推导（开发方案 5.6）
 *
 * 本文件是纯数据 + 纯逻辑，不碰 DOM：模式层（mode-rogue.js）只负责渲染与接线，
 * 标定脚本（tests）也直接复用这里的公式，保证「文档里的数值」与「跑起来的数值」不会漂。
 *
 * 一轮 run 的强度全部汇总在 `bonus` 这一个普通对象里：
 * 祝福的 apply 只做累加，每层开局参数与目标分由 floorOptions / goalOf 从 bonus 推导得出。
 * 这样加新祝福只要加一条数据，不用动模式层的任何分支。
 */
import { ROGUE, SCORE, SPECIAL } from './config.js';

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
  };
}

/**
 * 祝福池
 * - `max`：一轮内最多叠加几次（叠满后不再出现在三选一里）
 * - `growth`：是否属于「成长类」。前 ROGUE.friendlyPicks 次三选一只出成长类，
 *   避免开局连出保命 / 工具牌，导致第 2~3 层就因强度不足翻车（模拟标定时观察到的失败模式）
 * - `apply(bonus, rng)`：只做累加；需要入局随机时（如「同色磁石」要锁定一种颜色）可读第二个参数
 */
export const PERKS = [
  {
    id: 'supply',
    icon: '🎒',
    name: '补给包',
    desc: `每层起手步数 +2`,
    max: 3,
    growth: true,
    apply(bonus) { bonus.moves += 2; },
  },
  {
    id: 'minimal',
    icon: '🎨',
    name: '极简主义',
    desc: `本局元素种类 −1（最低 ${ROGUE.minColors} 色）`,
    max: 2,
    growth: true,
    apply(bonus) { bonus.colorCut += 1; },
  },
  {
    id: 'focus',
    icon: '💎',
    name: '熟练手法',
    desc: '本局得分 ×1.25',
    max: 6,
    growth: true,
    apply(bonus) { bonus.scoreMult *= 1.25; },
  },
  {
    id: 'arsenal',
    icon: '🧨',
    name: '军火库',
    desc: '每层开局送 3 个条状',
    max: 3,
    growth: true,
    apply(bonus) { bonus.specials.row += 3; },
  },
  {
    id: 'bomber',
    icon: '💣',
    name: '爆破专家',
    desc: '每层开局送 2 个炸弹',
    max: 3,
    growth: true,
    apply(bonus) { bonus.specials.bomb += 2; },
  },
  {
    id: 'rainbow',
    icon: '🌈',
    name: '彩球礼物',
    desc: '每层开局送 2 个彩球',
    max: 2,
    growth: true,
    apply(bonus) { bonus.specials.rainbow += 2; },
  },
  {
    id: 'scout',
    icon: '🧭',
    name: '侦察报告',
    desc: '本局目标分 −18%',
    max: 4,
    growth: true,
    apply(bonus) { bonus.goalCut += 0.18; },
  },
  {
    id: 'magnet',
    icon: '🧲',
    name: '同色磁石',
    desc: `随机锁定一种颜色，其出现概率 ×${ROGUE.magnetMult}（此时盘面会越来越「同色」，连带爆炸）`,
    max: 2,
    growth: true,
    // 需要 rng 来锁定颜色：这是唯一一个「带副作用」的祝福字段，
    // 选中后整轮固定，后续每层补充新方块都按这个权重来（见 floorOptions 的 colorWeights）。
    // 不传 rng（如三选一卡片上的「下一层」预览）时只累加倍率、不锁色，预览显示为「随机一色」
    apply(bonus, rng) {
      // 只在前 minColors 种颜色里挑：「极简主义」会把颜色数压到 minColors，
      // 若锁定的是更靠后的颜色，降色后它就不存在了，这张祝福等于白选
      if (!bonus.weightColor && rng) bonus.weightColor = 1 + rng.int(ROGUE.minColors);
      bonus.weightMult *= ROGUE.magnetMult;
    },
  },
  {
    id: 'abyss',
    icon: '🕳',
    name: '深渊回响',
    desc: '每深 1 层，得分倍率额外 +8%（越深越猛）',
    max: 2,
    growth: true,
    apply(bonus) { bonus.floorMult += 0.08; },
  },
  {
    id: 'deepsteps',
    icon: '🥾',
    name: '深入脚步',
    desc: `层数成长翻倍：每 ${ROGUE.movesPerFloorStep} 层多发的步数 +1`,
    max: 1,
    growth: true,
    apply(bonus) { bonus.moveGrowth += 1; },
  },
  {
    id: 'storm',
    icon: '🌪',
    name: '彩虹风暴',
    desc: '每层开局送 3 个彩球',
    max: 2,
    growth: true,
    apply(bonus) { bonus.specials.rainbow += 3; },
  },
  {
    id: 'barrage',
    icon: '🎆',
    name: '火力覆盖',
    desc: '每层开局送 3 个条状 + 2 个炸弹',
    max: 2,
    growth: true,
    apply(bonus) { bonus.specials.row += 3; bonus.specials.bomb += 2; },
  },
  {
    id: 'bloodpact',
    icon: '🔥',
    name: '血祭',
    desc: '本局得分 ×2，代价是每层起手步数 −2',
    max: 1,
    growth: false,
    apply(bonus) { bonus.scoreMult *= 2; bonus.moves -= 2; },
  },
  {
    id: 'shield',
    icon: '🛡',
    name: '免死金牌',
    desc: `步数耗尽时补 ${ROGUE.shieldMoves} 步继续本层（一次性）`,
    max: 2,
    growth: false,
    apply(bonus) { bonus.shields += 1; },
  },
  {
    id: 'shuffle',
    icon: '🔄',
    name: '备用洗牌',
    desc: '每层免费洗牌 +1 次',
    max: 3,
    growth: false,
    apply(bonus) { bonus.shuffles += 1; },
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
 */
export function floorOptions(bonus, floor = 1) {
  const specials = [];
  if (bonus.specials.row) specials.push({ kind: SPECIAL.ROW, count: bonus.specials.row });
  if (bonus.specials.bomb) specials.push({ kind: SPECIAL.BOMB, count: bonus.specials.bomb });
  if (bonus.specials.rainbow) specials.push({ kind: SPECIAL.RAINBOW, count: bonus.specials.rainbow });

  const colors = Math.max(ROGUE.minColors, ROGUE.colors - bonus.colorCut);
  // 颜色权重：只有「同色磁石」会给出非均匀权重；其余情况保持 null（等概率），
  // 与旧版逐位一致——这一点在引擎侧同样是硬约束（见 cascade.js 的 pickColor）
  const colorWeights =
    bonus.weightColor > 0 && bonus.weightMult > 1 && bonus.weightColor <= colors
      ? Array.from({ length: colors }, (_, k) => (k === bonus.weightColor - 1 ? bonus.weightMult : 1))
      : null;

  return {
    rows: ROGUE.rows,
    cols: ROGUE.cols,
    colors,
    moves: ROGUE.movesPerFloor
      + bonus.moves
      + Math.floor((floor - 1) / ROGUE.movesPerFloorStep) * (1 + bonus.moveGrowth),
    scoreMult: bonus.scoreMult * (1 + bonus.floorMult * (floor - 1)),
    cascadeMax: SCORE.cascadeMax + bonus.cascadeBonus,
    specials,
    colorWeights,
  };
}

/**
 * 三选一抽取：从未叠满的祝福里随机取，前几次只出成长类
 * @param {object} rng - 引擎的随机数发生器
 * @param {Record<string, number>} picks - 已选祝福 { 祝福id: 次数 }
 * @returns {Array} 备选祝福（池子不够 3 张时会少于 3 张）
 */
export function rollPerks(rng, picks = {}) {
  const pickedTotal = Object.values(picks).reduce((sum, n) => sum + (n || 0), 0);
  const grownOnly = pickedTotal < ROGUE.friendlyPicks;
  const rest = PERKS.filter((perk) => {
    if ((picks[perk.id] || 0) >= perk.max) return false;
    return grownOnly ? perk.growth : true;
  });

  const out = [];
  while (out.length < ROGUE.perkChoices && rest.length > 0) {
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
