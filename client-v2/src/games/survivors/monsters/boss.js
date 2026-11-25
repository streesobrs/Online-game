/** 歼灭者：周期性出现的 Boss，会发射环形弹幕 */
export const BOSS_INTERVAL = 90; // 秒，index.js 的 Boss 计时与图鉴文案共用

const SHOT_INTERVAL = 2.8;
const SHOT_COUNT_BASE = 10;
const SHOT_COUNT_MAX_BONUS = 10;
const SHOT_SPEED_BASE = 160;
const SHOT_SPEED_MAX_BONUS = 120;
const SHOT_DAMAGE_BASE = 8;
const SHOT_DAMAGE_PER_BOSS = 2;

export default {
  id: 'boss',
  name: '歼灭者',
  desc: `每 ${BOSS_INTERVAL} 秒出现一次，血量会随时间和 Boss 数量成长；每 ${SHOT_INTERVAL} 秒发射一圈紫色弹幕，弹幕数量和伤害会随 Boss 次数提高。`,
  order: 90,
  spawnable: false,
  boss: true,
  spawnInterval: BOSS_INTERVAL,
  stats: { shape: 'boss', color: '#ff4d6d', r: 34, hp: 520, speed: 55, dmg: 24, xp: 0 },

  // 追击玩家并周期性释放环形弹幕
  update(e, dx, dy, dist, dt, api) {
    api.moveEnemy(e, dx, dy, dist, dt, 1);
    e.shootCd -= dt;
    if (e.shootCd > 0) return;
    e.shootCd = SHOT_INTERVAL;
    const { bossCount, time } = api.state;
    const n = SHOT_COUNT_BASE + Math.min(SHOT_COUNT_MAX_BONUS, bossCount * 2);
    const base = Math.random() * Math.PI * 2;
    const speed = SHOT_SPEED_BASE + Math.min(SHOT_SPEED_MAX_BONUS, time * 0.08);
    // 弹幕伤害随时间成长，后期靠爆发伤害而不是接触伤害制造威胁
    const dmg = (SHOT_DAMAGE_BASE + bossCount * SHOT_DAMAGE_PER_BOSS) * (1 + time / 600);
    for (let i = 0; i < n; i += 1) {
      api.spawnEnemyShot(e.x, e.y, base + (i / n) * Math.PI * 2, speed, dmg, '#c084fc');
    }
    api.shake(0.2);
  },
};
