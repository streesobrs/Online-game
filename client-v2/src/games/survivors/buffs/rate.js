/** 连射：缩短攻击间隔 */
export default {
  id: 'rate',
  icon: '⚡',
  name: '连射',
  desc: '攻速 +20%',
  detail: '每层使攻击间隔乘以 0.8，最多叠加 8 层。',
  max: 8,
  order: 20,
  aoe: false,
  effect(lv) {
    return `攻速 ×${(1.25 ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.attackInterval *= 0.8;
  },
};
