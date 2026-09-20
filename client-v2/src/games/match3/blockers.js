/**
 * 障碍物（开发方案 4.1 目标类型 ③）
 *
 * 三种障碍（冰块 / 锁链 / 石头）共用一套规则，只有 hp 与表现不同：
 * - 占据一个可玩格，不承载糖果，不参与连线、不能被交换
 * - 是「列内的墙」：下落与补充都绕过它（由 grid.js 的 columnSegments 统一处理）
 * - 受击：本格被特殊元素波及时，或相邻格被消除时，扣 BLOCKER_RULES.damagePerHit
 * - hp 归零即移除，该格随后按正常下落补充
 *
 * 纯逻辑，不访问 DOM；随机数一律外部传入
 */
import { BLOCKERS, BLOCKER_KINDS, BLOCKER_RULES } from './config.js';
import { colOf, getAt, index, isPlayable, neighbors, rowOf, setAt } from './grid.js';

/** 取障碍的初始 hp：关卡可逐格覆盖，缺省用种类默认值 */
export function blockerHp(kind, hp) {
  if (Number.isFinite(hp) && hp > 0) return Math.floor(hp);
  return BLOCKERS[kind].hp;
}

/**
 * 按关卡配置铺设障碍（顺带清空该格：障碍格不承载糖果）
 * @param {object} grid 棋盘
 * @param {Array<{r:number,c:number,kind:string,hp?:number}>} list 关卡 payload 的 blockers
 * @returns {number[]} 实际落位的格子下标
 */
export function placeBlockers(grid, list) {
  if (!Array.isArray(list)) return [];
  const placed = [];
  for (const item of list) {
    if (!item || !isPlayable(grid, item.r, item.c)) continue;
    const kind = BLOCKER_KINDS.includes(item.kind) ? item.kind : BLOCKER_KINDS[0];
    const i = index(grid, item.r, item.c);
    setAt(grid, i, {
      color: null,
      special: null,
      blocker: { kind, hp: blockerHp(kind, item.hp) },
    });
    placed.push(i);
  }
  return placed;
}

/** 棋盘上剩余障碍数量 */
export function countBlockers(grid) {
  let total = 0;
  for (const i of grid.cellIndex) {
    if (getAt(grid, i)?.blocker) total += 1;
  }
  return total;
}

/**
 * 对命中集合造成伤害：命中格本身 +（可配置）相邻格
 * @param {object} grid 棋盘（就地修改）
 * @param {Iterable<number>} hitSet 本轮被波及的格子
 * @returns {{removed:number[], damaged:number[]}}
 */
export function damageBlockers(grid, hitSet) {
  const targets = new Set();
  for (const i of hitSet) {
    targets.add(i);
    if (!BLOCKER_RULES.damageAdjacent) continue;
    for (const n of neighbors(grid, rowOf(grid, i), colOf(grid, i))) targets.add(n.index);
  }

  const removed = [];
  const damaged = [];
  for (const i of targets) {
    const cell = getAt(grid, i);
    if (!cell || !cell.blocker) continue;
    cell.blocker.hp -= BLOCKER_RULES.damagePerHit;
    if (cell.blocker.hp <= 0) {
      setAt(grid, i, null); // 障碍碎裂：该格变为空格，随后被下落补充
      removed.push(i);
    } else {
      damaged.push(i);
    }
  }
  return { removed, damaged };
}
