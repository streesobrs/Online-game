/** 雷光弹：每轮额外发射雷属性弹 */
export default {
  id: 'thunder',
  icon: '⚡',
  name: '雷光弹',
  desc: '每轮额外发射 1 枚雷属性弹',
  detail: '每层让每轮射击多出 1 枚雷光弹，造成 50% 伤害。命中时对周围 42 半径范围挂雷元素（每层 +12 半径），持续 3.5 秒；与水元素接触触发「感电」，连接附近头顶带水/雷的敌人一同受到伤害。',
  max: 5,
  order: 51,
  aoe: false,
  element: 'thunder',
  color: '#facc15',
  effect(lv) {
    return `额外 ${lv} 枚雷光弹 · 50% 伤害 · 挂雷半径 ${30 + 12 * lv}`;
  },
  apply(p) {
    p.thunderLevel += 1;
  },
  buildShots(v, p) {
    const lv = p.thunderLevel;
    for (let i = 0; i < lv; i += 1) {
      const angle = v.base + (lv === 1 ? 0 : (i - (lv - 1) / 2) * 0.2);
      v.shots.push({
        x: p.x + Math.cos(angle) * (p.r + 6),
        y: p.y + Math.sin(angle) * (p.r + 6),
        angle,
        speed: p.projectileSpeed * 1.05,
        damage: p.damage * v.damageScale * 0.5,
        r: 4,
        life: 1.3,
        element: 'thunder',
        elementRadius: 30 + 12 * lv,
        elementDuration: 3.5,
        color: '#facc15',
      });
    }
  },
};
