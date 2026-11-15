/** 反伤冲击波：受击时向周围释放冲击波，需先获得护盾 */
export default {
  id: 'thorns',
  icon: '💥',
  name: '反伤冲击波',
  desc: '受击时释放冲击波反击',
  detail: '护盾解锁后才会出现在强化池。受到伤害时向周围释放冲击波，对范围内怪物造成伤害，冷却 1 秒。',
  max: 5,
  order: 62,
  aoe: true,
  requireText: '需先获得护盾',
  requires(p) {
    return p.shieldMax > 0;
  },
  effect(lv) {
    return `半径 ${90 + 20 * lv} · ${Math.round((0.6 + 0.15 * lv) * 100)}% 伤害`;
  },
  apply(p) {
    p.thornsLevel += 1;
  },
  update(dt, p, s) {
    if (s.thornsCd > 0) s.thornsCd = Math.max(0, s.thornsCd - dt);
  },
  onHurt(p, s, info, api) {
    const lv = p.thornsLevel;
    if (lv <= 0 || s.thornsCd > 0) return;
    s.thornsCd = 1;
    const radius = 90 + 20 * lv;
    api.addNova(p.x, p.y, 50, radius);
    api.damageInRadius(p.x, p.y, radius, p.damage * (0.6 + 0.15 * lv));
  },
};
