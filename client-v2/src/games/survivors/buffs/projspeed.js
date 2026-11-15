/** 弹速：提高弹丸飞行速度 */
export default {
  id: 'projspeed',
  icon: '💨',
  name: '弹速',
  desc: '弹丸速度 +25%',
  detail: '每层使弹丸速度乘以 1.25，最多叠加 4 层。',
  max: 4,
  order: 50,
  aoe: false,
  effect(lv) {
    return `弹速 ×${(1.25 ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.projectileSpeed *= 1.25;
  },
};
