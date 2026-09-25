/**
 * 死局检测与洗牌（开发方案 3.6）
 *
 * - 洗牌与复检都只在可玩格子内进行
 * - 分仓棋盘以「区域」为粒度：某个区域死局时只重排该区域，
 *   不能整盘一起洗，否则会破坏其他区域的局面
 */
import { SHUFFLE, SPECIAL } from '../config/config.js';
import { colOf, getAt, hasBlocker, index, isPlayable, regions, rowOf, setAt } from './grid.js';
import { findMatches, hasMatch } from './match.js';

/** 交换两格内容（就地，供可行步试算使用） */
export function swapCells(grid, a, b) {
  const tmp = grid.cells[a];
  grid.cells[a] = grid.cells[b];
  grid.cells[b] = tmp;
}

/**
 * 找一个可行交换：相邻两格交换后能形成消除
 * 障碍格不承载糖果、玩家也无法交换，因此涉及障碍的组合一律跳过
 * @param {object} grid 棋盘
 * @param {number[]} scope 只在给定格子里查找（区域粒度的洗牌复检用），默认全盘
 * @returns {{a:number, b:number}|null}
 */
export function findValidMove(grid, scope = grid.cellIndex) {
  for (const i of scope) {
    const a = getAt(grid, i);
    if (!a || a.blocker) continue;
    const r = rowOf(grid, i);
    const c = colOf(grid, i);

    for (const [nr, nc] of [[r, c + 1], [r + 1, c]]) {
      if (!isPlayable(grid, nr, nc)) continue;
      const j = index(grid, nr, nc);
      if (hasBlocker(grid, j)) continue;
      const b = getAt(grid, j);
      if (!b) continue;

      // 彩球可与任意相邻方块交换，无需试算
      if (a.special === SPECIAL.RAINBOW || b.special === SPECIAL.RAINBOW) return { a: i, b: j };

      swapCells(grid, i, j);
      const ok = hasMatch(grid);
      swapCells(grid, i, j);
      if (ok) return { a: i, b: j };
    }
  }
  return null;
}

/** 是否存在可行交换 */
export function hasValidMove(grid) {
  return findValidMove(grid) != null;
}

/** 整盘是否还能继续玩：有可行交换，或存在待自动消除的连线 */
export function isResolvable(grid) {
  return hasMatch(grid) || hasValidMove(grid);
}

/** 区域内是否还能继续玩 */
export function isRegionResolvable(grid, regionCells) {
  const scope = new Set(regionCells);
  const matched = findMatches(grid).some((group) => group.cells.some((i) => scope.has(i)));
  return matched || findValidMove(grid, regionCells) != null;
}

/**
 * 区域洗牌：只重排该区域已有内容，洞与障碍的位置都不变
 * @returns {{ok:boolean, attempts:number}}
 */
export function shuffleRegion(grid, regionCells, rng) {
  const free = regionCells.filter((i) => !hasBlocker(grid, i));
  for (let attempt = 1; attempt <= SHUFFLE.maxAttempts; attempt += 1) {
    const pool = free.map((i) => getAt(grid, i));
    rng.shuffle(pool);
    free.forEach((i, k) => setAt(grid, i, pool[k]));

    if (isRegionResolvable(grid, regionCells)) {
      return { ok: true, attempts: attempt };
    }
  }
  return { ok: false, attempts: SHUFFLE.maxAttempts };
}

/**
 * 整盘洗牌：逐个区域分别洗
 * 单区域棋盘（普通矩形）等价于整盘洗牌
 */
export function shuffleBoard(grid, rng) {
  const result = regions(grid).map((cells) => shuffleRegion(grid, cells, rng));
  return { ok: result.every((item) => item.ok), regions: result };
}
