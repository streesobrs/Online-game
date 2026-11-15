/** 歼灭者：每 90 秒出现的 Boss，周期性发射环形弹幕 */
export default {
  id: 'boss',
  name: '歼灭者',
  desc: '每 90 秒出现一次，血量会随时间和 Boss 数量成长；每 2.8 秒发射一圈紫色弹幕，弹幕数量和伤害会随 Boss 次数提高。',
  order: 90,
  spawnable: false,
  boss: true,
  stats: { shape: 'boss', color: '#ff4d6d', r: 34, hp: 520, speed: 55, dmg: 24, xp: 0 },

  // 追击玩家并周期性释放环形弹幕
  update(e, dx, dy, dist, dt, api) {
    api.moveEnemy(e, dx, dy, dist, dt, 1);
    e.shootCd -= dt;
    if (e.shootCd > 0) return;
    e.shootCd = 2.8;
    const { bossCount, time } = api.state;
    const n = 10 + Math.min(10, bossCount * 2);
    const base = Math.random() * Math.PI * 2;
    const speed = 160 + Math.min(120, time * 0.08);
    // 弹幕伤害随时间成长，后期靠爆发伤害而不是接触伤害制造威胁
    const dmg = (8 + bossCount * 2) * (1 + time / 600);
    for (let i = 0; i < n; i += 1) {
      api.spawnEnemyShot(e.x, e.y, base + (i / n) * Math.PI * 2, speed, dmg, '#c084fc');
    }
    api.shake(0.2);
  },
};
