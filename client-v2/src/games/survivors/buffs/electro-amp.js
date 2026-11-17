/** 感电·增幅：提升感电反应伤害 */
export default {
  id: 'electroamp',
  icon: '⚡',
  name: '感电·增幅',
  desc: '提升感电反应的伤害',
  detail: '水与雷元素接触触发感电时，反应伤害提高 25%；每层再 +25%。',
  max: 5,
  order: 54,
  reaction: 'electro',
  reactionName: '感电',
  color: '#facc15',
  requireText: '需同时拥有水与雷元素弹',
  requires(p) {
    return p.waterLevel > 0 && p.thunderLevel > 0;
  },
  effect(lv) {
    return `感电伤害 +${lv * 25}%`;
  },
  apply(p) {
    p.electroAmpLevel += 1;
  },
};
