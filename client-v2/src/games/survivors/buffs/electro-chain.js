/** 感电·连锁：扩大感电的连接范围与目标数 */
import { CHAIN_RADIUS_PER_LEVEL, CHAIN_LINKS_PER_LEVEL } from '../elements.js';

const MAX_LEVEL = 4;

export default {
  id: 'electrochain',
  icon: '🔗',
  name: '感电·连锁',
  desc: '扩大感电连锁范围与连接数',
  detail: `感电的连锁搜索半径 +${CHAIN_RADIUS_PER_LEVEL}、最多连接目标 +${CHAIN_LINKS_PER_LEVEL}；每层再叠加一次。`,
  max: MAX_LEVEL,
  order: 55,
  reaction: 'electro',
  reactionName: '感电',
  color: '#facc15',
  requireText: '需同时拥有水与雷元素弹',
  requires(p) {
    return p.waterLevel > 0 && p.thunderLevel > 0;
  },
  effect(lv) {
    return `连锁半径 +${lv * CHAIN_RADIUS_PER_LEVEL} · 连接上限 +${lv * CHAIN_LINKS_PER_LEVEL}`;
  },
  apply(p) {
    p.electroChainLevel += 1;
  },
};
