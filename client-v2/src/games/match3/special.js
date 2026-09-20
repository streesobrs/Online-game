/**
 * 特殊元素的生成与级联触发（开发方案 3.5）
 *
 * 三条定死的规则：
 * - 生成位置：优先玩家交换的那一格（由 match.js 的 spawnIndex 决定），否则交叉点 / 连线中点
 * - 触发：被消除时立即生效；效果波及到的特殊元素继续触发
 * - 级联用队列处理并设上限，防止递归失控
 *
 * 形态效果：row 整行 / col 整列 / bomb 半径内的方形区域（默认 3×3）/ rainbow 同色全部
 */
import { SPECIAL, SPECIAL_RULES, SHAPE } from './config.js';
import { colOf, getAt, index, isPlayable, rowOf } from './grid.js';

/** 按形态创建特殊元素（彩球不持有颜色） */
export function makeSpecial(shape, color) {
  if (shape === SHAPE.RAINBOW || shape === SPECIAL.RAINBOW) {
    return { color: null, special: SPECIAL.RAINBOW };
  }
  return { color: color == null ? null : color, special: shape };
}

/** 棋盘上出现次数最多的颜色（彩球自动触发时使用） */
export function pickRainbowColor(grid) {
  const counts = new Map();
  for (const i of grid.cellIndex) {
    const cell = getAt(grid, i);
    if (!cell || cell.color == null) continue;
    counts.set(cell.color, (counts.get(cell.color) || 0) + 1);
  }
  let best = null;
  let bestCount = 0;
  for (const [color, count] of counts) {
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

/** 单个特殊元素的效果范围（不含连锁） */
export function effectCells(grid, cellIndex) {
  const cell = getAt(grid, cellIndex);
  if (!cell || !cell.special) return [];

  const r = rowOf(grid, cellIndex);
  const c = colOf(grid, cellIndex);
  const out = [];

  if (cell.special === SPECIAL.ROW) {
    for (let cc = 0; cc < grid.cols; cc += 1) {
      if (isPlayable(grid, r, cc)) out.push(index(grid, r, cc));
    }
    return out;
  }

  if (cell.special === SPECIAL.COL) {
    for (let rr = 0; rr < grid.rows; rr += 1) {
      if (isPlayable(grid, rr, c)) out.push(index(grid, rr, c));
    }
    return out;
  }

  if (cell.special === SPECIAL.BOMB) {
    const rad = SPECIAL_RULES.bombRadius;
    for (let rr = r - rad; rr <= r + rad; rr += 1) {
      for (let cc = c - rad; cc <= c + rad; cc += 1) {
        if (isPlayable(grid, rr, cc)) out.push(index(grid, rr, cc));
      }
    }
    return out;
  }

  if (cell.special === SPECIAL.RAINBOW) {
    const color = pickRainbowColor(grid);
    if (color == null) return [cellIndex];
    for (const i of grid.cellIndex) {
      const other = getAt(grid, i);
      if (other && other.color === color) out.push(i);
    }
    return out;
  }

  return [];
}

/**
 * 彩球 + 任意方块交换：清除目标颜色的全部方块
 * 彩球 + 彩球是唯一例外（清空全盘），开发方案 1.3 的"不做两两组合"针对的是条状 / 炸弹
 * @returns {number[]} 去重后的待清除格子
 */
export function rainbowSwapTargets(grid, rainbowIndex, targetIndex) {
  const target = getAt(grid, targetIndex);
  const out = new Set([rainbowIndex, targetIndex]);
  if (!target) return [...out];
  if (target.special === SPECIAL.RAINBOW) return grid.cellIndex.slice();

  const color = target.color;
  if (color == null) return [...out];
  for (const i of grid.cellIndex) {
    const cell = getAt(grid, i);
    if (cell && cell.color === color) out.add(i);
  }
  return [...out];
}

/**
 * 把初始消除集合展开为「含特殊元素级联」的完整消除集合
 * @param {object} grid 棋盘
 * @param {number[]} seeds 本轮因连线而被消除的格子
 * @returns {{ cleared: Set<number>, triggered: Array<{index:number, special:string, cells:number[]}> }}
 */
export function expandSpecials(grid, seeds) {
  const cleared = new Set();
  const fired = new Set();
  const triggered = [];
  const queue = seeds.slice();

  while (queue.length) {
    if (triggered.length >= SPECIAL_RULES.maxTriggerChain) break;

    const i = queue.shift();
    if (cleared.has(i) && fired.has(i)) continue;
    cleared.add(i);

    const cell = getAt(grid, i);
    if (!cell || !cell.special || fired.has(i)) continue;

    fired.add(i);
    const effect = effectCells(grid, i);
    triggered.push({ index: i, special: cell.special, cells: effect.slice() });

    for (const j of effect) {
      if (!cleared.has(j) || !fired.has(j)) queue.push(j);
    }
  }

  return { cleared, triggered };
}
