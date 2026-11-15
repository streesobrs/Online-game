/** 游荡者：最常见的直线追击怪 */
export default {
  id: 'basic',
  name: '游荡者',
  desc: '只会直线追击玩家，数量和出现频率最高，是怪潮的基础单位。',
  order: 10,
  spawnable: true,
  unlockAt: 0,
  weight: 30,
  stats: { shape: 'circle', color: '#ff7b7b', r: 11, hp: 20, speed: 78, dmg: 8, xp: 2 },
};
