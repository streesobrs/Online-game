/** 巢母：保持中远距离并周期性召唤碎片 */
const KEEP_MIN = 240;
const SUMMON_INTERVAL = 5;
const SUMMON_COUNT = 2;
const SUMMON_CAP = 380; // 场上怪物过多时暂停召唤，避免无限堆积

export default {
  id: 'summoner',
  name: '巢母',
  desc: `不会贴身追击，而是保持距离每 ${SUMMON_INTERVAL} 秒召唤 ${SUMMON_COUNT} 个碎片；场上怪物过多时会暂时停止召唤。`,
  order: 75,
  spawnable: true,
  unlockAt: 330,
  weight: 5,
  stats: { shape: 'splitter', color: '#2dd4bf', r: 20, hp: 170, speed: 42, dmg: 12, xp: 6 },

  // 与玩家保持距离，定期召唤碎片
  update(e, dx, dy, dist, dt, api) {
    if (dist < KEEP_MIN) api.moveEnemy(e, dx, dy, dist, dt, -0.7);
    else api.moveEnemy(e, dx, dy, dist, dt, 0.8);

    if (e.summonCd == null) e.summonCd = SUMMON_INTERVAL * 0.7;
    e.summonCd -= dt;
    if (e.summonCd > 0) return;
    if (api.state.enemies.length >= SUMMON_CAP) {
      e.summonCd = 1;
      return;
    }
    e.summonCd = SUMMON_INTERVAL;
    for (let i = 0; i < SUMMON_COUNT; i += 1) {
      api.spawnEnemy('shard', e.x + api.rand(-18, 18), e.y + api.rand(-18, 18));
    }
    api.spawnParticles(e.x, e.y, '#2dd4bf', 10, 170);
  },
};
