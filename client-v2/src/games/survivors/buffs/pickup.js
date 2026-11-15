/** 磁力：扩大经验拾取范围 */
export default {
  id: 'pickup',
  icon: '🧲',
  name: '磁力',
  desc: '拾取范围 +45%',
  detail: '每层使经验拾取范围乘以 1.45，最多叠加 3 层。',
  max: 3,
  order: 100,
  aoe: false,
  effect(lv) {
    return `拾取范围 ×${(1.45 ** lv).toFixed(2)}`;
  },
  apply(p) {
    p.pickup *= 1.45;
  },
};
