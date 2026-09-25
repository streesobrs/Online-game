/**
 * 可播种随机数（mulberry32）
 *
 * 引擎内禁止使用 Math.random：同一关卡 payload 必须能复现完全相同的局面，
 * 否则将来接入关卡平台后无法复现与校验（开发方案 4.5 可重复加载）。
 */

/**
 * 创建随机数发生器
 * @param {number} seed 种子，同一 seed 产生同一序列
 */
export function createRng(seed = 1) {
  const initialSeed = seed >>> 0;
  let state = initialSeed;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  return {
    seed: initialSeed,
    next,

    /** 当前内部状态（局内续存用，见开发方案 5.4） */
    getState() {
      return state;
    },

    /** 恢复内部状态：续玩后随机序列接着走，不重掷 */
    setState(value) {
      state = value >>> 0;
    },

    /** 返回 [0, max) 的整数 */
    int(max) {
      return Math.floor(next() * max);
    },

    /** 返回 [min, max] 的整数 */
    range(min, max) {
      return min + Math.floor(next() * (max - min + 1));
    },

    /** 从数组中随机取一项 */
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },

    /** 原地洗牌（Fisher-Yates） */
    shuffle(list) {
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        const tmp = list[i];
        list[i] = list[j];
        list[j] = tmp;
      }
      return list;
    },
  };
}
