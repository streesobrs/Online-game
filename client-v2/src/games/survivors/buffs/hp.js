/** 强健：提高生命上限并回满 */
import { BUFF_SCALING, deriveStats } from '../base.js';

const HP_PER_LEVEL = BUFF_SCALING.hpPerLevel;
const MAX_LEVEL = 6;
const pct = (v) => `${Number((v * 100).toFixed(1))}%`;

export default {
  id: 'hp',
  icon: '❤️',
  name: '强健',
  desc: `生命上限 +${pct(HP_PER_LEVEL)} 并回满`,
  detail: `每层提高 ${pct(HP_PER_LEVEL)} 生命上限，并立刻把生命回满，最多叠加 ${MAX_LEVEL} 层。护盾、回复与吸血都按最大生命计算。`,
  max: MAX_LEVEL,
  order: 70,
  aoe: false,
  effect(lv) {
    return `生命上限 ×${(1 + HP_PER_LEVEL * lv).toFixed(2)}`;
  },
  apply(p) {
    p.hpLevel += 1;
    deriveStats(p);
    p.hp = p.maxHp;
    p.shield = Math.min(p.shieldMax, p.shield);
  },
};
