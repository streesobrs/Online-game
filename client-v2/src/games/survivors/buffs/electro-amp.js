/** 感电·增幅：提高元素精通，放大感电反应伤害 */
import { BUFF_SCALING, deriveStats } from '../base.js';
import { EM_REACTION_BONUS } from '../combat.js';

const EM_PER_LEVEL = BUFF_SCALING.emPerLevel;
const MAX_LEVEL = 5;

export default {
  id: 'electroamp',
  icon: '⚡',
  name: '感电·增幅',
  desc: '提高元素精通，放大感电伤害',
  detail: `每层 +${EM_PER_LEVEL} 元素精通；每点元素精通使剧变反应伤害提高 ${Number((EM_REACTION_BONUS * 100).toFixed(1))}%。`,
  max: MAX_LEVEL,
  order: 54,
  reaction: 'electro',
  reactionName: '感电',
  color: '#facc15',
  requireText: '需同时拥有水与雷元素弹',
  requires(p) {
    return p.waterLevel > 0 && p.thunderLevel > 0;
  },
  effect(lv) {
    const bonus = lv * EM_PER_LEVEL * EM_REACTION_BONUS;
    return `元素精通 +${lv * EM_PER_LEVEL} · 反应伤害 +${Number((bonus * 100).toFixed(1))}%`;
  },
  apply(p) {
    p.electroAmpLevel += 1;
    deriveStats(p);
  },
};
