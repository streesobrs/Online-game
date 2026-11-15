/** 射手：保持距离并发射子弹 */
export default {
  id: 'shooter',
  name: '射手',
  desc: '会与玩家保持 190~300 的距离并周期性发射青色子弹，需要主动贴近或绕后处理。',
  order: 50,
  spawnable: true,
  unlockAt: 210,
  weight: 8,
  stats: { shape: 'shooter', color: '#38bdf8', r: 12, hp: 38, speed: 64, dmg: 8, xp: 3 },

  // 维持 190~300 的距离并射击
  update(e, dx, dy, dist, dt, api) {
    if (dist > 300) {
      api.moveEnemy(e, dx, dy, dist, dt, 1);
    } else if (dist < 190) {
      api.moveEnemy(e, dx, dy, dist, dt, -0.9);
    } else {
      const px = -dy / dist;
      const py = dx / dist;
      e.x += px * e.speed * 0.4 * dt;
      e.y += py * e.speed * 0.4 * dt;
    }
    api.clampToArena(e);
    e.shootCd -= dt;
    if (e.shootCd <= 0 && dist < 460) {
      const { time } = api.state;
      e.shootCd = Math.max(1.2, 2.6 - time / 400);
      const speed = 210 + Math.min(80, time * 0.05);
      api.spawnEnemyShot(e.x, e.y, Math.atan2(dy, dx), speed, e.dmg * 1.2, '#38bdf8');
    }
  },
};
