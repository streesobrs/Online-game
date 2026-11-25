/** 锋利：提高攻击力 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const ATK_PER_LEVEL = BUFF_SCALING.atkPerLevel;
const MAX_LEVEL = 10;
const pct = (v) => `${Number((v * 100).toFixed(1))}%`;

export default {
  id: 'damage',
  icon: '🗡',
  name: '锋利',
  desc: `攻击力 +${pct(ATK_PER_LEVEL)}`,
  detail: `每层使攻击力提高 ${pct(ATK_PER_LEVEL)}，最多叠加 ${MAX_LEVEL} 层。所有攻击都按攻击力结算伤害。`,
  max: MAX_LEVEL,
  order: 10,
  aoe: false,
  effect(lv) {
    return `攻击力 ×${(1 + ATK_PER_LEVEL * lv).toFixed(2)}`;
  },
  apply(p) {
    p.atkLevel += 1;
    deriveStats(p);
  },
};
