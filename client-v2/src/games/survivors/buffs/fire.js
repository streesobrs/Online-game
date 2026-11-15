/** 火焰弹：每轮额外发射火属性弹 */
export default {
  id: 'fire',
  icon: '🔥',
  name: '火焰弹',
  desc: '每轮额外发射 1 枚火属性弹',
  detail: '每层让每轮射击多出 1 枚火焰弹，造成 50% 伤害。元素机制（灼烧等）后续加入。',
  max: 5,
  order: 50,
  aoe: false,
  element: 'fire',
  color: '#ff6b3d',
  effect(lv) {
    return `额外 ${lv} 枚火焰弹 · 50% 伤害`;
  },
  apply(p) {
    p.fireLevel += 1;
  },
  buildShots(v, p) {
    const lv = p.fireLevel;
    for (let i = 0; i < lv; i += 1) {
      const angle = v.base + (lv === 1 ? 0 : (i - (lv - 1) / 2) * 0.2);
      v.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed * 0.9,
        damage: p.damage * v.damageScale * 0.5,
        r: 4,
        life: 1.4,
        element: 'fire',
        color: '#ff6b3d',
      });
    }
  },
};
