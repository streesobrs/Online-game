/** 吸血：击杀怪物时回血 */
export default {
  id: 'lifesteal',
  icon: '🩸',
  name: '吸血',
  desc: '击杀回血 +1',
  detail: '每层在击杀怪物时恢复 1 点生命，最多叠加 8 层。',
  max: 8,
  order: 90,
  aoe: false,
  effect(lv) {
    return `击杀回血 ${lv}`;
  },
  apply(p) {
    p.lifesteal += 1;
  },
};
