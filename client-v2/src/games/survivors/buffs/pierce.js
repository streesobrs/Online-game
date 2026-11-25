/** 穿透：弹丸可以继续命中下一个目标 */
import { deriveStats } from '../base.js';

const PIERCE_PER_LEVEL = 1;
const MAX_LEVEL = 4;

export default {
  id: 'pierce',
  icon: '🏹',
  name: '穿透',
  desc: `弹丸穿透 +${PIERCE_PER_LEVEL}`,
  detail: `每层使弹丸额外穿透 ${PIERCE_PER_LEVEL} 个敌人，最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 40,
  aoe: false,
  effect(lv) {
    return `穿透 ${PIERCE_PER_LEVEL * lv} 个敌人`;
  },
  apply(p) {
    p.pierceLevel += 1;
    deriveStats(p);
  },
};
