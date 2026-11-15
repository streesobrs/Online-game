/** 脉冲核心：周期性释放范围冲击波 */
export default {
  id: 'nova',
  icon: '🌀',
  name: '脉冲核心',
  desc: '周期性释放冲击波，范围伤害',
  detail: '每 3.4 秒释放一次半径 110 的冲击波；每层 +30 半径、+45% 伤害，并缩短 0.5 秒冷却（最低 1.4 秒）。',
  max: 6,
  order: 120,
  aoe: true,
  effect(lv) {
    const radius = 110 + 30 * (lv - 1);
    const ratio = Math.round((0.9 + 0.45 * (lv - 1)) * 100);
    const cd = Math.max(1.4, 3.4 - 0.5 * (lv - 1)).toFixed(1);
    return `半径 ${radius} · ${ratio}% 伤害 · ${cd}s 一次`;
  },
  apply(p, s) {
    p.novaLevel += 1;
    s.novaTimer = Math.min(s.novaTimer, 1.2);
  },
  // 周期释放冲击波：伤害/范围/冷却都按层数计算
  update(dt, p, s, api) {
    if (p.novaLevel <= 0) return;
    s.novaTimer -= dt;
    if (s.novaTimer > 0) return;
    const lv = p.novaLevel;
    const radius = 110 + 30 * (lv - 1);
    s.novaTimer = Math.max(1.4, 3.4 - 0.5 * (lv - 1));
    api.addNova(p.x, p.y, 26, radius);
    api.damageInRadius(p.x, p.y, radius, p.damage * (0.9 + 0.45 * (lv - 1)));
  },
};
