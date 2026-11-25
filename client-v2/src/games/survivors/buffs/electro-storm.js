/** 感电·雷暴：感电触发时在触发点释放雷暴 */
import {
  STORM_RADIUS_BASE, STORM_RADIUS_PER_LEVEL, STORM_REACTION_BASE, STORM_REACTION_PER_LEVEL,
} from '../elements.js';

const MAX_LEVEL = 4;
const BASE_MULT = STORM_REACTION_BASE;
const MULT_PER_LEVEL = STORM_REACTION_PER_LEVEL;

export default {
  id: 'electrostorm',
  icon: '🌩️',
  name: '感电·雷暴',
  desc: '感电触发时在触发点释放雷暴',
  detail: `感电触发时，以触发怪为中心释放半径 ${STORM_RADIUS_BASE} 的雷暴，反应倍率 ×${BASE_MULT}；每层 +${STORM_RADIUS_PER_LEVEL} 半径、+${MULT_PER_LEVEL} 反应倍率。`,
  max: MAX_LEVEL,
  order: 56,
  reaction: 'electro',
  reactionName: '感电',
  color: '#facc15',
  requireText: '需同时拥有水与雷元素弹',
  requires(p) {
    return p.waterLevel > 0 && p.thunderLevel > 0;
  },
  effect(lv) {
    const radius = STORM_RADIUS_BASE + STORM_RADIUS_PER_LEVEL * lv;
    const mult = (BASE_MULT + MULT_PER_LEVEL * lv).toFixed(1);
    return `雷暴半径 ${radius} · 反应倍率 ×${mult}`;
  },
  apply(p) {
    p.electroStormLevel += 1;
  },
};
