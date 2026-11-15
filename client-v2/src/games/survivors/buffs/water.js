/** 水流弹：每轮额外发射水属性弹 */
export default {
  id: 'water',
  icon: '💧',
  name: '水流弹',
  desc: '每轮额外发射 1 枚水属性弹',
  detail: '每层让每轮射击多出 1 枚水流弹，造成 50% 伤害。元素机制（潮湿/击退等）后续加入。',
  max: 5,
  order: 53,
  aoe: false,
  element: 'water',
  color: '#3b82f6',
  effect(lv) {
    return `额外 ${lv} 枚水流弹 · 50% 伤害`;
  },
  apply(p) {
    p.waterLevel += 1;
  },
  buildShots(v, p) {
    const lv = p.waterLevel;
    for (let i = 0; i < lv; i += 1) {
      const angle = v.base + (lv === 1 ? 0 : (i - (lv - 1) / 2) * 0.2);
      v.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed * 0.9,
        damage: p.damage * v.damageScale * 0.5,
        r: 4,
        life: 1.5,
        element: 'water',
        color: '#3b82f6',
      });
    }
  },
};
