/**
 * 肉鸽角色 / 职业（开发方案 3.8，P5）
 *
 * 解决「每轮起手完全相同」的问题：给 run 一个「入口身份」。
 * 首发 3 个角色，差异全部是**数据 + 复用既有系统**，不新增引擎：
 * 1. `startBonus`：起步加成（步数 / 颜色数 / 得分倍率 / 目标系数），
 *    在 `applyMetaBuffs` **之后**注入——角色是「起点差异」，meta 是「长期养成」，两者叠加
 * 2. `startPerks`：开局就送的祝福 id（走 mode-rogue 的 `grantPerk` 同一入口，进三选池与 picks）
 * 3. `startRelics`：开局就带的遗物 id（复用遗物系统 3.5；角色被动就是「自带且不可移除」的遗物）
 *
 * 解锁条件是**资格**而非付费：默认开放 1 个，其余靠战绩解锁
 * （如「最深抵达第 15 层」「通关 1 次」），服务端权威校验，**不能用精华买强度**。
 * 角色只是玩法入口，强度大头仍在局内 build。
 *
 * 纯数据 + 纯函数，可被标定脚本与单测直接 import。
 */

export const CHARACTERS = [
  {
    id: 'sorcerer',
    icon: '🔥',
    name: '连锁术士',
    style: '连锁滚雪球',
    unlock: null,
    // 起手与默认一致（6 色 10 步）
    startBonus: {},
    startPerks: ['focus'],
    // 角色被动 = 自带遗物：无尽锁链（连锁 ≥4 返 1 步，每层最多 3 次）
    startRelics: ['infinite_chain'],
    desc: '起手自带「专注」与遗物「⛓️无尽锁链」：用长连锁换取额外步数。',
  },
  {
    id: 'guardian',
    icon: '🛡️',
    name: '壁垒守卫',
    style: '稳健生存',
    // 资格解锁：不花精华，靠战绩
    unlock: { stat: 'bestFloor', value: 15, label: '最深抵达第 15 层' },
    // 起手 12 步（基准 10 + 2）、得分倍率 ×0.9（用慢一点换更稳）
    startBonus: { moves: 2, scoreMult: 0.9 },
    startPerks: [],
    // 被动遗物：每层第 1 次步数耗尽必定免死（且不消耗护盾）
    startRelics: ['guardian_ward'],
    desc: '起手步数更多、得分倍率略低；每层第一次步数耗尽必定免死（不耗护盾）。',
  },
  {
    id: 'palette',
    icon: '🧲',
    name: '调色术士',
    style: '色彩操控',
    // 资格解锁：通关 1 次
    unlock: { win: 1, label: '通关 1 次' },
    // 5 色起手（colorCut 1）、目标分 +10%（goalMult 1.1）
    startBonus: { colorCut: 1, goalMult: 1.1 },
    startPerks: ['magnet'],
    // 被动遗物：每个区域可重锁一次磁石颜色
    startRelics: ['recolor_pact'],
    desc: '5 色起手、目标分 +10%，自带「同色磁石」；每个区域可重锁一次磁石颜色。',
  },
];

/** 默认（永远开放）的角色 id：新号一进来就能玩 */
export const DEFAULT_CHARACTER = 'sorcerer';

/** 按 id 取角色定义；未知 id 回落到默认角色，不抛错 */
export function characterById(id) {
  return CHARACTERS.find((c) => c.id === id)
    || CHARACTERS.find((c) => c.id === DEFAULT_CHARACTER)
    || CHARACTERS[0];
}

/** 无需解锁（unlock 为 null）的角色 id 集合 */
export function defaultCharacters() {
  return CHARACTERS.filter((c) => !c.unlock).map((c) => c.id);
}

/**
 * 某角色是否已解锁
 * @param {object} char - 角色定义
 * @param {object} stats - 养成存档的 stats（服务端权威：bestFloor / wins）
 * @returns {boolean}
 */
export function characterUnlocked(char, stats = {}) {
  if (!char || !char.unlock) return true;
  const { stat, value, win } = char.unlock;
  if (Number.isFinite(win)) return (stats.wins || 0) >= win;
  if (stat) return (stats[stat] || 0) >= (value || 0);
  return false;
}

/** 已解锁角色 id 集合（选择 UI 用；服务端也有一份权威校验） */
export function unlockedCharacters(stats = {}) {
  return CHARACTERS.filter((c) => characterUnlocked(c, stats)).map((c) => c.id);
}

/**
 * 解锁条件文案 + 当前进度（选择 UI 上「置灰 + 为什么不能选」用）
 * @returns {{ label:string, have:number, need:number, done:boolean }|null} 无需解锁返回 null
 */
export function unlockProgress(char, stats = {}) {
  if (!char?.unlock) return null;
  const { stat, value, win } = char.unlock;
  const need = Number.isFinite(win) ? win : (value || 0);
  const have = Number.isFinite(win) ? (stats.wins || 0) : (stats[stat] || 0);
  return {
    label: char.unlock.label || `达成 ${need}`,
    have: Math.min(have, need),
    need,
    done: have >= need,
  };
}
