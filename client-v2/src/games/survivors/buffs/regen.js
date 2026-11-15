/** 回复：持续恢复生命 */
export default {
  id: 'regen',
  icon: '🌿',
  name: '回复',
  desc: '每秒回血 +1',
  detail: '每层每秒恢复 1 点生命，最多叠加 8 层。',
  max: 8,
  order: 80,
  aoe: false,
  effect(lv) {
    return `每秒回血 ${lv}`;
  },
  apply(p) {
    p.regen += 1;
  },
};
