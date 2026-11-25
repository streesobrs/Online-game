/** 疾行：提高移动速度 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const SPEED_PER_LEVEL = BUFF_SCALING.speedPerLevel;
const MAX_LEVEL = 6;
const pct = (v) => `${Number((v * 100).toFixed(1))}%`;

export default {
  id: 'speed',
  icon: '👟',
  name: '疾行',
  desc: `移速 +${pct(SPEED_PER_LEVEL)}`,
  detail: `每层使移动速度提高 ${pct(SPEED_PER_LEVEL)}，最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 60,
  aoe: false,
  effect(lv) {
    return `移速 ×${(1 + SPEED_PER_LEVEL * lv).toFixed(2)}`;
  },
  apply(p) {
    p.speedLevel += 1;
    deriveStats(p);
  },
};
