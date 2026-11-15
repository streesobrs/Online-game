/** 碎片：分裂体死亡后的产物，不会自然刷新 */
export default {
  id: 'shard',
  name: '碎片',
  desc: '分裂体死亡后裂出的高速小怪，不会自然刷新，只会由分裂体召唤。',
  order: 80,
  spawnable: false,
  stats: { shape: 'circle', color: '#f9a8d4', r: 7, hp: 14, speed: 150, dmg: 5, xp: 1 },
};
