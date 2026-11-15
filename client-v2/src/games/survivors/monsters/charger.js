/** 冲锋者：蓄力后向玩家高速冲刺 */
export default {
  id: 'charger',
  name: '冲锋者',
  desc: '靠近后会停顿蓄力（白色脉冲圈），随后以 3.4 倍速度直线冲刺，注意横向走位。',
  order: 40,
  spawnable: true,
  unlockAt: 120,
  weight: 10,
  stats: { shape: 'charger', color: '#ff9f43', r: 12, hp: 42, speed: 86, dmg: 10, xp: 3 },

  // 追击 → 停顿蓄力 → 高速冲刺
  update(e, dx, dy, dist, dt, api) {
    if (e.mode === 'dash') {
      e.timer -= dt;
      e.x += e.dashVx * dt;
      e.y += e.dashVy * dt;
      if (Math.random() < 0.4) api.spawnParticles(e.x, e.y, '#ff9f43', 1, 40);
      if (e.timer <= 0) {
        e.mode = 'chase';
        e.timer = 1.3;
      }
      return;
    }
    if (e.mode === 'windup') {
      e.timer -= dt;
      if (e.timer <= 0) {
        const d = dist || 1;
        e.dashVx = (dx / d) * e.speed * 3.4;
        e.dashVy = (dy / d) * e.speed * 3.4;
        e.mode = 'dash';
        e.timer = 0.5;
      }
      return;
    }
    if (e.timer > 0) e.timer -= dt;
    if (dist < 300 && e.timer <= 0) {
      e.mode = 'windup';
      e.timer = 0.6;
      return;
    }
    api.moveEnemy(e, dx, dy, dist, dt, 0.85);
  },
};
