/** 多重射击：增加每次攻击的弹丸数量 */
import { deriveStats } from '../base.js';

const BASE_SHOTS = 1;
const SHOTS_PER_LEVEL = 1;
const MAX_LEVEL = 6;

export default {
  id: 'multi',
  icon: '🎯',
  name: '多重射击',
  desc: `弹丸 +${SHOTS_PER_LEVEL}`,
  detail: `每层增加 ${SHOTS_PER_LEVEL} 发弹丸，并以扇形散射，最多叠加 ${MAX_LEVEL} 层。`,
  max: MAX_LEVEL,
  order: 30,
  aoe: false,
  effect(lv) {
    return `每次射出 ${BASE_SHOTS + SHOTS_PER_LEVEL * lv} 发弹丸`;
  },
  apply(p) {
    p.multiLevel += 1;
    deriveStats(p);
  },
};
