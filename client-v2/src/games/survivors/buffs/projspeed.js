/** 弹速：提高弹丸飞行速度 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const SPEED_MULT = BUFF_SCALING.projSpeedMult;
const MAX_LEVEL = 4;
const SPEED_BONUS = Math.round((SPEED_MULT - 1) * 100);

export default {
  id: 'projspeed',
  icon: '💨',
  name: '弹速',
  desc: `弹丸速度 +${SPEED_BONUS}%`,
  detail: `每层使弹丸速度乘以 ${SPEED_MULT}，最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 50,
  aoe: false,
  effect(lv) {
    return `弹速 ×${(SPEED_MULT ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.projSpeedLevel += 1;
    deriveStats(p);
  },
};
