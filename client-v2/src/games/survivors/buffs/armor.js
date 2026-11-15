/** 铁壁：降低受到的伤害 */
export default {
  id: 'armor',
  icon: '🛡️',
  name: '铁壁',
  desc: '受到的伤害 -7%',
  detail: '每层使受到的所有伤害降低 7%，最多叠加到 60%。对接触、弹幕和爆炸伤害都生效。',
  max: 8,
  order: 60,
  aoe: false,
  effect(lv) {
    return `减伤 ${Math.round(Math.min(0.6, lv * 0.075) * 100)}%`;
  },
  apply(p) {
    p.damageReduction = Math.min(0.6, p.damageReduction + 0.075);
  },
};
