/** 自爆虫：靠近或死亡时爆炸 */
const TRIGGER_DIST = 110;
const FUSE_TIME = 0.9;
const BLAST_RADIUS = 120;
const VISUAL_RADIUS = 110;
const BLAST_DAMAGE_MULT = 2.2;

function explode(e, api) {
  api.addExplosionVisual(e.x, e.y, VISUAL_RADIUS);
  api.spawnParticles(e.x, e.y, '#fb923c', 16, 260);
  api.shake(0.35);
  const p = api.state.player;
  if ((p.x - e.x) ** 2 + (p.y - e.y) ** 2 <= BLAST_RADIUS * BLAST_RADIUS) {
    api.hurtPlayer(e.dmg * BLAST_DAMAGE_MULT);
  }
}

export default {
  id: 'bomber',
  name: '自爆虫',
  desc: `进入 ${TRIGGER_DIST} 距离后开始点火，${FUSE_TIME} 秒后爆炸；被击杀时也会爆炸，需要保持距离处理。`,
  order: 70,
  spawnable: true,
  unlockAt: 300,
  weight: 6,
  stats: { shape: 'bomber', color: '#fb923c', r: 13, hp: 48, speed: 100, dmg: 7, xp: 3 },

  // 靠近后点火，倒计时结束爆炸
  update(e, dx, dy, dist, dt, api) {
    if (e.fuse > 0) {
      e.fuse -= dt;
      if (e.fuse <= 0) {
        explode(e, api);
        e.dead = true;
      }
      return;
    }
    api.moveEnemy(e, dx, dy, dist, dt, 1);
    if (dist < TRIGGER_DIST) {
      e.fuse = FUSE_TIME;
      api.spawnParticles(e.x, e.y, '#fb923c', 6, 120);
    }
  },

  // 被击杀时同样爆炸
  onDeath(e, api) {
    explode(e, api);
  },
};
