/** 强健：提高生命上限并回满 */
export default {
  id: 'hp',
  icon: '❤️',
  name: '强健',
  desc: '生命上限 +25 并回满',
  detail: '每层增加 25 点生命上限，并立刻把生命回满，最多叠加 6 层。',
  max: 6,
  order: 70,
  aoe: false,
  effect(lv) {
    return `生命上限 +${25 * lv}`;
  },
  apply(p) {
    p.maxHp += 25;
    p.hp = p.maxHp;
  },
};
