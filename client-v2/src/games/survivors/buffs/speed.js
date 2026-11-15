/** 疾行：提高移动速度 */
export default {
  id: 'speed',
  icon: '👟',
  name: '疾行',
  desc: '移速 +12%',
  detail: '每层使移动速度乘以 1.12，最多叠加 6 层。',
  max: 6,
  order: 60,
  aoe: false,
  effect(lv) {
    return `移速 ×${(1.12 ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.speed *= 1.12;
  },
};
