/** 回复：持续恢复生命 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const REGEN_PCT_PER_LEVEL = BUFF_SCALING.regenPctPerLevel;
const MAX_LEVEL = 8;
const pct = (v) => `${Number((v * 100).toFixed(1))}%`;

export default {
  id: 'regen',
  icon: '🌿',
  name: '回复',
  desc: `每秒回复 +${pct(REGEN_PCT_PER_LEVEL)} 最大生命`,
  detail: `每层每秒恢复 ${pct(REGEN_PCT_PER_LEVEL)} 最大生命，最大生命越高回复越多，最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 80,
  aoe: false,
  effect(lv) {
    return `每秒回复 ${pct(REGEN_PCT_PER_LEVEL * lv)} 最大生命`;
  },
  apply(p) {
    p.regenLevel += 1;
    deriveStats(p);
  },
};
