/** 护盾：优先吸收伤害，脱战后自动回复 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const SHIELD_PCT_PER_LEVEL = BUFF_SCALING.shieldPctPerLevel;
const REGEN_PCT_PER_LEVEL = BUFF_SCALING.shieldRegenPctPerLevel;
/** 受击后停止回复护盾的秒数，index.js 受击结算时同样使用该值 */
export const SHIELD_HIT_CD = 2;
const MAX_LEVEL = 5;
const pct = (v) => `${Number((v * 100).toFixed(1))}%`;

export default {
  id: 'shield',
  icon: '🔵',
  name: '护盾',
  desc: '获得可自动回复的护盾',
  detail: `每层提供 ${pct(SHIELD_PCT_PER_LEVEL)} 最大生命的护盾上限与每秒 ${pct(REGEN_PCT_PER_LEVEL)} 最大生命的回复；受到伤害后停止回复 ${SHIELD_HIT_CD} 秒。护盾耗尽后才会扣血。`,
  max: MAX_LEVEL,
  order: 61,
  aoe: false,
  effect(lv) {
    return `护盾 ${pct(SHIELD_PCT_PER_LEVEL * lv)} 生命 · 回复 ${pct(REGEN_PCT_PER_LEVEL * lv)}/s`;
  },
  apply(p) {
    p.shieldLevel += 1;
    deriveStats(p);
    p.shield = Math.min(p.shieldMax, p.shield + p.maxHp * SHIELD_PCT_PER_LEVEL);
  },
  update(dt, p) {
    if (p.shieldCd > 0) {
      p.shieldCd = Math.max(0, p.shieldCd - dt);
      return;
    }
    if (p.shield < p.shieldMax) {
      p.shield = Math.min(p.shieldMax, p.shield + p.shieldRegen * dt);
    }
  },
};
