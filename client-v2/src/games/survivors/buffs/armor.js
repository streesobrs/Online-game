/** 铁壁：提高防御力 */
import { PLAYER_BASE, BUFF_SCALING, deriveStats } from '../base.js';
import { DEF_CONSTANT } from '../combat.js';

const DEF_PER_LEVEL = BUFF_SCALING.defPerLevel;
const MAX_LEVEL = 8;
const pct = (v) => `${Number((v * 100).toFixed(1))}%`;

/** 按基础防御与层数换算实际减伤比例 */
function mitigationAt(lv) {
  const def = PLAYER_BASE.def * (1 + DEF_PER_LEVEL * lv);
  return def / (def + DEF_CONSTANT);
}

export default {
  id: 'armor',
  icon: '🛡️',
  name: '铁壁',
  desc: `防御力 +${pct(DEF_PER_LEVEL)}`,
  detail: `每层提高 ${pct(DEF_PER_LEVEL)} 防御力，最多叠加 ${MAX_LEVEL} 层。实际减伤 = 防御 / (防御 + ${DEF_CONSTANT})，对接触、弹幕和爆炸伤害都生效。`,
  max: MAX_LEVEL,
  order: 60,
  aoe: false,
  effect(lv) {
    const shield = Math.min(0.999, mitigationAt(lv));
    return `防御力 ×${(1 + DEF_PER_LEVEL * lv).toFixed(2)} · 减伤 ${pct(shield)}`;
  },
  apply(p) {
    p.defLevel += 1;
    deriveStats(p);
  },
};
