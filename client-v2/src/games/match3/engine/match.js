/**
 * 消除形态识别（开发方案 3.3）
 *
 * 形态优先级：L/T 形（交叉）→ 直线 5 连 → 直线 4 连 → 普通 3 连
 * 洞会自然切断连线：扫描时跳过不可玩格子，异形棋盘无需特判
 *
 * 返回的 spawnIndex 是特殊元素的生成位置：优先玩家交换的那一格（手感最好），
 * 否则取交叉点 / 最长连线的中点（开发方案 3.5）
 */
import { MATCH_RULES, SHAPE } from '../config/config.js';
import { getAt, index, isPlayable } from './grid.js';

/** 取该格颜色：洞、空格、彩球一律返回 null（不参与同色连线） */
function colorAt(grid, r, c) {
  if (!isPlayable(grid, r, c)) return null;
  const cell = getAt(grid, index(grid, r, c));
  return cell ? cell.color : null;
}

/** 扫描所有横向与纵向的同色连线（长度 ≥ minRunLength） */
export function findRuns(grid) {
  const runs = [];
  const min = MATCH_RULES.minRunLength;

  // 横向
  for (let r = 0; r < grid.rows; r += 1) {
    let c = 0;
    while (c < grid.cols) {
      const color = colorAt(grid, r, c);
      if (color == null) {
        c += 1;
        continue;
      }
      let end = c;
      while (end + 1 < grid.cols && colorAt(grid, r, end + 1) === color) end += 1;
      if (end - c + 1 >= min) {
        const cells = [];
        for (let i = c; i <= end; i += 1) cells.push(index(grid, r, i));
        runs.push({ dir: 'h', color, len: end - c + 1, cells });
      }
      c = end + 1;
    }
  }

  // 纵向
  for (let c = 0; c < grid.cols; c += 1) {
    let r = 0;
    while (r < grid.rows) {
      const color = colorAt(grid, r, c);
      if (color == null) {
        r += 1;
        continue;
      }
      let end = r;
      while (end + 1 < grid.rows && colorAt(grid, end + 1, c) === color) end += 1;
      if (end - r + 1 >= min) {
        const cells = [];
        for (let i = r; i <= end; i += 1) cells.push(index(grid, i, c));
        runs.push({ dir: 'v', color, len: end - r + 1, cells });
      }
      r = end + 1;
    }
  }

  return runs;
}

/** 是否存在可消除的连线（只判断有无，比 findMatches 省） */
export function hasMatch(grid) {
  return findRuns(grid).length > 0;
}

/** 把共享格子的连线合并成形态组 */
function groupRuns(runs) {
  const groups = [];
  const owner = new Map();

  for (const run of runs) {
    const touched = new Set();
    for (const i of run.cells) {
      if (owner.has(i)) touched.add(owner.get(i));
    }

    if (touched.size === 0) {
      const gi = groups.length;
      groups.push({ runs: [run], cells: new Set(run.cells) });
      run.cells.forEach((i) => owner.set(i, gi));
      continue;
    }

    const target = Math.min(...touched);
    const group = groups[target];
    group.runs.push(run);
    run.cells.forEach((i) => {
      group.cells.add(i);
      owner.set(i, target);
    });

    for (const gi of touched) {
      if (gi === target) continue;
      const other = groups[gi];
      for (const otherRun of other.runs) {
        group.runs.push(otherRun);
        otherRun.cells.forEach((i) => {
          group.cells.add(i);
          owner.set(i, target);
        });
      }
      other.dead = true;
    }
  }

  return groups.filter((g) => !g.dead);
}

/** 形态判定：按开发方案 3.3 的优先级 */
function shapeOf(group) {
  const hasH = group.runs.some((run) => run.dir === 'h');
  const hasV = group.runs.some((run) => run.dir === 'v');
  const maxLen = group.runs.reduce((best, run) => Math.max(best, run.len), 0);

  if (hasH && hasV) return SHAPE.BOMB;
  if (maxLen >= MATCH_RULES.rainbowRunLength) return SHAPE.RAINBOW;
  if (maxLen >= MATCH_RULES.stripedRunLength) {
    return group.runs[0].dir === 'h' ? SHAPE.ROW : SHAPE.COL;
  }
  return SHAPE.NORMAL;
}

/** L/T 形的横竖交叉点 */
function intersectionIndex(group) {
  const horizontal = new Set();
  for (const run of group.runs) {
    if (run.dir !== 'h') continue;
    for (const i of run.cells) horizontal.add(i);
  }
  for (const run of group.runs) {
    if (run.dir !== 'v') continue;
    for (const i of run.cells) {
      if (horizontal.has(i)) return i;
    }
  }
  return null;
}

function pickSpawnIndex(group, shape, focus) {
  if (focus != null && group.cells.has(focus)) return focus;
  if (shape === SHAPE.BOMB) {
    const cross = intersectionIndex(group);
    if (cross != null) return cross;
  }
  const longest = group.runs.reduce((best, run) => (run.len > best.len ? run : best), group.runs[0]);
  return longest.cells[Math.floor(longest.cells.length / 2)];
}

/**
 * 找出全部可消除的形态组
 * @param {object} grid 棋盘
 * @param {{ focus?: number }} options focus 为玩家刚交换的格子下标，用于决定特殊元素生成位置
 * @returns {Array<{shape:string, color:number, cells:number[], runs:Array, spawnIndex:number}>}
 */
export function findMatches(grid, options = {}) {
  const runs = findRuns(grid);
  if (runs.length === 0) return [];
  const focus = options.focus == null ? null : options.focus;

  return groupRuns(runs).map((group) => {
    const shape = shapeOf(group);
    return {
      shape,
      color: group.runs[0].color,
      cells: [...group.cells].sort((a, b) => a - b),
      runs: group.runs.map((run) => ({ dir: run.dir, len: run.len, cells: run.cells.slice() })),
      spawnIndex: pickSpawnIndex(group, shape, focus),
    };
  });
}
