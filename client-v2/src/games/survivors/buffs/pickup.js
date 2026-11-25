/** 磁力：扩大经验拾取范围 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const PICKUP_MULT = BUFF_SCALING.pickupMult;
const MAX_LEVEL = 3;
const PICKUP_BONUS = Math.round((PICKUP_MULT - 1) * 100);

export default {
  id: 'pickup',
  icon: '🧲',
  name: '磁力',
  desc: `拾取范围 +${PICKUP_BONUS}%`,
  detail: `每层使经验拾取范围乘以 ${PICKUP_MULT}，最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 100,
  aoe: false,
  effect(lv) {
    return `拾取范围 ×${(PICKUP_MULT ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.pickupLevel += 1;
    deriveStats(p);
  },
};
