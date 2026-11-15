/** 穿透：弹丸可以继续命中下一个目标 */
export default {
  id: 'pierce',
  icon: '🏹',
  name: '穿透',
  desc: '弹丸穿透 +1',
  detail: '每层使弹丸额外穿透 1 个敌人，最多叠加 4 层。',
  max: 4,
  order: 40,
  aoe: false,
  effect(lv) {
    return `穿透 ${lv} 个敌人`;
  },
  apply(p) {
    p.pierce += 1;
  },
};
