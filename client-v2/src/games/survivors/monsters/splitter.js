/** 分裂体：死亡后分裂出两个碎片 */
export default {
  id: 'splitter',
  name: '分裂体',
  desc: '死亡后会裂成两个高速碎片，如果输出不足容易被碎片近身。',
  order: 60,
  spawnable: true,
  unlockAt: 240,
  weight: 8,
  stats: { shape: 'splitter', color: '#f472b6', r: 15, hp: 55, speed: 72, dmg: 8, xp: 3 },

  // 死亡后裂成两个碎片
  onDeath(e, api) {
    for (let i = 0; i < 2; i += 1) {
      api.spawnEnemy('shard', e.x + api.rand(-12, 12), e.y + api.rand(-12, 12));
    }
  },
};
