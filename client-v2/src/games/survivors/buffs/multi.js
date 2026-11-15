/** 多重射击：增加每次攻击的弹丸数量 */
export default {
  id: 'multi',
  icon: '🎯',
  name: '多重射击',
  desc: '弹丸 +1',
  detail: '每层增加 1 发弹丸，并以扇形散射，最多叠加 6 层。',
  max: 6,
  order: 30,
  aoe: false,
  effect(lv) {
    return `每次射出 ${1 + lv} 发弹丸`;
  },
  apply(p) {
    p.projectiles += 1;
  },
};
