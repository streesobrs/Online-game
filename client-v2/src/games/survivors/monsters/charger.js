/** 冲锋者：蓄力后向玩家高速冲刺 */
const DASH_SPEED_MULT = 3.4;
const DASH_TRIGGER_RANGE = 300;
const WINDUP_TIME = 0.6;
const DASH_TIME = 0.5;
const CHASE_SPEED_MULT = 0.85;
const COOLDOWN = 1.3;

export default {
  id: 'charger',
  name: '冲锋者',
  desc: `靠近后会停顿蓄力（白色脉冲圈），随后以 ${DASH_SPEED_MULT} 倍速度直线冲刺，注意横向走位。`,
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
        e.timer = COOLDOWN;
      }
      return;
    }
    if (e.mode === 'windup') {
      e.timer -= dt;
      if (e.timer <= 0) {
        const d = dist || 1;
        e.dashVx = (dx / d) * e.speed * DASH_SPEED_MULT;
        e.dashVy = (dy / d) * e.speed * DASH_SPEED_MULT;
        e.mode = 'dash';
        e.timer = DASH_TIME;
      }
      return;
    }
    if (e.timer > 0) e.timer -= dt;
    if (dist < DASH_TRIGGER_RANGE && e.timer <= 0) {
      e.mode = 'windup';
      e.timer = WINDUP_TIME;
      return;
    }
    api.moveEnemy(e, dx, dy, dist, dt, CHASE_SPEED_MULT);
  },
};
