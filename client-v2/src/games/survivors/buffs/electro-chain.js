/** 感电·连锁：扩大感电的连接范围与目标数 */
export default {
  id: 'electrochain',
  icon: '🔗',
  name: '感电·连锁',
  desc: '扩大感电连锁范围与连接数',
  detail: '感电的连锁搜索半径 +25、最多连接目标 +2；每层再叠加一次。',
  max: 4,
  order: 55,
  reaction: 'electro',
  reactionName: '感电',
  color: '#facc15',
  requireText: '需同时拥有水与雷元素弹',
  requires(p) {
    return p.waterLevel > 0 && p.thunderLevel > 0;
  },
  effect(lv) {
    return `连锁半径 +${lv * 25} · 连接上限 +${lv * 2}`;
  },
  apply(p) {
    p.electroChainLevel += 1;
  },
};
