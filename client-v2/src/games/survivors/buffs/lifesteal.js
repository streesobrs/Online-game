/** 吸血：击杀怪物时回血 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const LIFESTEAL_PCT_PER_LEVEL = BUFF_SCALING.lifestealPctPerLevel;
const MAX_LEVEL = 8;
const pct = (v) => `${Number((v * 100).toFixed(1))}%`;

export default {
  id: 'lifesteal',
  icon: '🩸',
  name: '吸血',
  desc: `击杀回复 +${pct(LIFESTEAL_PCT_PER_LEVEL)} 最大生命`,
  detail: `每层在击杀怪物时恢复 ${pct(LIFESTEAL_PCT_PER_LEVEL)} 最大生命，最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 90,
  aoe: false,
  effect(lv) {
    return `击杀回复 ${pct(LIFESTEAL_PCT_PER_LEVEL * lv)} 最大生命`;
  },
  apply(p) {
    p.lifestealLevel += 1;
    deriveStats(p);
  },
};
