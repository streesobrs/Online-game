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
    scoreMult: 1,       // 得分倍率（累乘）
    cascadeBonus: 0,    // 连锁倍率上限加成
    specials: { row: 0, bomb: 0, rainbow: 0 }, // 每层开局注入的特殊元素数量
    goalCut: 0,         // 目标分减免（累加）
    shields: 0,         // 剩余免死次数
    shuffles: 0,        // 每层免费洗牌次数
  };
}

/**
 * 祝福池
 * - `max`：一轮内最多叠加几次（叠满后不再出现在三选一里）
 * - `growth`：是否属于「成长类」。前 ROGUE.friendlyPicks 次三选一只出成长类，
 *   避免开局连出保命 / 工具牌，导致第 2~3 层就因强度不足翻车（模拟标定时观察到的失败模式）
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
 * @param {object} bonus - 本轮加成
 * @param {number} [floor] - 层号（层数成长：越深每层步数越多）
 */
export function floorOptions(bonus, floor = 1) {
  const specials = [];
  if (bonus.specials.row) specials.push({ kind: SPECIAL.ROW, count: bonus.specials.row });
  if (bonus.specials.bomb) specials.push({ kind: SPECIAL.BOMB, count: bonus.specials.bomb });
  if (bonus.specials.rainbow) specials.push({ kind: SPECIAL.RAINBOW, count: bonus.specials.rainbow });

  return {
    rows: ROGUE.rows,
    cols: ROGUE.cols,
    colors: Math.max(ROGUE.minColors, ROGUE.colors - bonus.colorCut),
    moves: ROGUE.movesPerFloor + bonus.moves + Math.floor((floor - 1) / ROGUE.movesPerFloorStep),
    scoreMult: bonus.scoreMult,
    cascadeMax: SCORE.cascadeMax + bonus.cascadeBonus,
    specials,
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
