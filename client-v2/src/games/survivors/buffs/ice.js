/** 寒冰弹：每轮额外发射冰属性弹 */
export default {
  id: 'ice',
  icon: '❄️',
  name: '寒冰弹',
  desc: '每轮额外发射 1 枚冰属性弹',
  detail: '每层让每轮射击多出 1 枚寒冰弹，造成 50% 伤害。元素机制（减速/冻结等）后续加入。',
  max: 5,
  order: 52,
  aoe: false,
  element: 'ice',
  color: '#7dd3fc',
  effect(lv) {
    return `额外 ${lv} 枚寒冰弹 · 50% 伤害`;
  },
  apply(p) {
    p.iceLevel += 1;
  },
  buildShots(v, p) {
    const lv = p.iceLevel;
    for (let i = 0; i < lv; i += 1) {
      const angle = v.base + (lv === 1 ? 0 : (i - (lv - 1) / 2) * 0.2);
      v.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed * 0.85,
        damage: p.damage * v.damageScale * 0.5,
        r: 4,
        life: 1.5,
        element: 'ice',
        color: '#7dd3fc',
      });
    }
  },
};
