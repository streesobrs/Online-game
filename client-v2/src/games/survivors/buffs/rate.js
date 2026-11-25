/** 连射：缩短攻击间隔 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const INTERVAL_MULT = BUFF_SCALING.intervalMult;
const RATE_BONUS = Math.round((1 / INTERVAL_MULT - 1) * 100);
const MAX_LEVEL = 8;

export default {
  id: 'rate',
  icon: '⚡',
  name: '连射',
  desc: `攻速 +${RATE_BONUS}%`,
  detail: `每层使攻击间隔乘以 ${INTERVAL_MULT}（攻速 +${RATE_BONUS}%），最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 20,
  aoe: false,
  effect(lv) {
    return `攻速 ×${((1 / INTERVAL_MULT) ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.rateLevel += 1;
    deriveStats(p);
  },
};
