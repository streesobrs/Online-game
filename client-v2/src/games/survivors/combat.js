/**
 * 伤害乘区公式：所有技能与反应伤害都从这里结算。
 *
 * 技能伤害 = 基础伤害区 × 暴击区 × 增伤区 × 防御区 × 抗性区
 * 基础伤害区 = 攻击力×攻击倍率 + 生命上限×生命倍率 + 防御力×防御倍率 + 元素精通×精通倍率 + 附加
 * 剧变伤害 = 等级系数 × 反应倍率 × (1 + 元素精通加成 + 反应伤害加成) × 抗性区
 */

/** 防御区常数：减伤 = 防御 / (防御 + 200) */
export const DEF_CONSTANT = 200;
/** 每 1 点元素精通提供的反应伤害加成 */
export const EM_REACTION_BONUS = 0.004;

const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const positive = (v) => Math.max(0, Number(v) || 0);

/** 防御减伤比例（0~1） */
export function defenseMitigation(def) {
  const d = positive(def);
  return d / (d + DEF_CONSTANT);
}

/** 防御区系数：受到该防御值保护后剩余的比例 */
export function damageTakenZone(def) {
  return 1 - defenseMitigation(def);
}

/** 元素精通提供的反应伤害加成 */
export function emReactionBonus(em) {
  return positive(em) * EM_REACTION_BONUS;
}

/** 等级系数：用于剧变反应的基础伤害 */
export function levelCoefficient(level) {
  return 16 + (Math.max(1, Math.floor(Number(level) || 1)) - 1) * 6;
}

/** 暴击区（期望值，不做随机判定） */
export function critZone(player) {
  return 1 + clamp01(player.critRate) * positive(player.critDmg);
}

/** 增伤区 */
export function bonusZone(player) {
  return 1 + positive(player.dmgBonus);
}

/**
 * 技能伤害
 * @param {object} player - 玩家最终属性
 * @param {object} scaling - { atkPct, hpPct, defPct, emPct, flat, skillPct }
 * @param {object} opts - { enemyDef, enemyRes, reactionMult, reactionBonus }
 * @returns {number}
 */
export function skillDamage(player, scaling = {}, opts = {}) {
  const baseZone = positive(player.atk) * (scaling.atkPct || 0)
    + positive(player.maxHp) * (scaling.hpPct || 0)
    + positive(player.def) * (scaling.defPct || 0)
    + positive(player.em) * (scaling.emPct || 0)
    + (scaling.flat || 0);
  const base = baseZone * (1 + (scaling.skillPct || 0));
  const defense = damageTakenZone(opts.enemyDef || 0);
  const resistance = 1 - clamp01(opts.enemyRes || 0);
  const reactionMult = opts.reactionMult || 1;
  // 增幅反应：反应倍率与元素精通/反应加成同乘，普通攻击不传这两个参数
  const reactionAmp = reactionMult > 1
    ? reactionMult
      * (1 + emReactionBonus(player.em)
        + positive(player.reactionBonus)
        + positive(opts.reactionBonus))
    : 1;
  return base * critZone(player) * bonusZone(player) * defense * resistance * reactionAmp;
}

/**
 * 剧变反应伤害
 * @param {object} player - 玩家最终属性
 * @param {number} level - 当前局等级（决定等级系数）
 * @param {number} reactionMult - 反应倍率
 * @param {object} opts - { enemyRes, reactionBonus }
 * @returns {number}
 */
export function reactionDamage(player, level, reactionMult, opts = {}) {
  const resistance = 1 - clamp01(opts.enemyRes || 0);
  const amp = 1 + emReactionBonus(player.em)
    + positive(player.reactionBonus)
    + positive(opts.reactionBonus);
  return levelCoefficient(level) * positive(reactionMult) * amp * resistance;
}
