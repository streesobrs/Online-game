/** 锋利：提高武器伤害 */
export default {
  id: 'damage',
  icon: '🗡',
  name: '锋利',
  desc: '伤害 +30%',
  detail: '每层使武器伤害乘以 1.3，最多叠加 10 层。',
  max: 10,
  order: 10,
  aoe: false,
  effect(lv) {
    return `伤害 ×${(1.3 ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.damage *= 1.3;
  },
};
