/**
 * 棋盘状态变化：初始生成、下落、补充、连锁循环（开发方案 3.4 / 4.2）
 *
 * 纯逻辑，不访问 DOM；随机数一律由外部传入的 rng 提供，
 * 引擎内不出现 Math.random，保证同一 payload 可复现（开发方案 4.5）
 */
import { MATCH_RULES, SCORE, SHAPE, SHUFFLE, SPECIAL } from './config.js';
import { columnSegments, createGrid, getAt, hasBlocker, index, setAt } from './grid.js';
import { damageBlockers, placeBlockers } from './blockers.js';
import { findMatches } from './match.js';
import { expandSpecials, makeSpecial, rainbowCopyTargets, rainbowSwapTargets } from './special.js';
import { findValidMove, isResolvable, shuffleBoard } from './deadlock.js';
import { createRng } from './rng.js';

/**
 * 掷一个颜色（开发方案 3.2 的「颜色权重」：肉鸽的「同色磁石」祝福用）
 *
 * weights 为按颜色下标（color - 1）排列的权重数组，缺省项按 1 计。
 * 不传 weights 时退化为等概率的 `1 + rng.int(colors)`，与旧行为逐位一致——
 * 这一点是硬约束：所有非肉鸽模式与历史关卡的复现性都依赖它。
 * @param {object} rng - 随机数发生器
 * @param {number} colors - 元素种类数
 * @param {Array<number>} [weights] - 各颜色权重
 */
export function pickColor(rng, colors, weights) {
  if (!weights) return 1 + rng.int(colors);
  let total = 0;
  // 缺省项按 1 计（只有显式写 0 才是「永不出现」），短数组不会静默吞掉后面的颜色
  for (let c = 1; c <= colors; c += 1) total += weights[c - 1] ?? 1;
  if (!(total > 0)) return 1 + rng.int(colors);
  let roll = rng.next() * total;
  for (let c = 1; c <= colors; c += 1) {
    roll -= weights[c - 1] ?? 1;
    if (roll < 0) return c;
  }
  return colors;
}

/** 随机铺满可自由下落的格子（洞与障碍格不铺） */
function fillRandom(grid, rng, colors, weights) {
  for (const i of grid.cellIndex) {
    if (hasBlocker(grid, i)) continue;
    setAt(grid, i, { color: pickColor(rng, colors, weights), special: null });
  }
}

/** 消除现成三连：重掷被匹配格子的颜色，直到棋盘上没有现成连线 */
function clearInitialMatches(grid, rng, colors, weights) {
  for (let round = 0; round < MATCH_RULES.maxInitialFixRounds; round += 1) {
    const groups = findMatches(grid);
    if (groups.length === 0) return true;
    for (const group of groups) {
      for (const i of group.cells) {
        const cell = getAt(grid, i);
        if (cell) cell.color = pickColor(rng, colors, weights);
      }
    }
  }
  return false;
}

/**
 * 生成初始棋盘（开发方案 4.2 初始化规则）
 * 必须满足两个约束：棋盘上不存在现成的三连、至少存在一个可行交换
 * @param {{rows:number, cols:number, mask?:any, colors:number, seed?:number,
 *          blockers?:Array, weights?:Array<number>}} options
 *   weights 为各颜色的出现权重（缺省等概率），见 pickColor
 * @returns {{grid:object, ok:boolean, attempts:number}}
 */
export function createInitialBoard({ rows, cols, mask = null, colors, seed = 1, blockers = null, weights = null }) {
  const grid = createGrid({ rows, cols, mask });
  const rng = createRng(seed);

  for (let attempt = 1; attempt <= SHUFFLE.maxAttempts; attempt += 1) {
    fillRandom(grid, rng, colors, weights);
    placeBlockers(grid, blockers); // 障碍铺在糖果之后：覆盖掉的格子交给下一次填充
    fillRandom(grid, rng, colors, weights);
    clearInitialMatches(grid, rng, colors, weights);
    if (findValidMove(grid)) {
      return { grid, ok: true, attempts: attempt };
    }
  }

  // 兜底：随机重铺仍无可行步（概率极低），改用洗牌强制重排
  shuffleBoard(grid, rng);
  return { grid, ok: false, attempts: SHUFFLE.maxAttempts };
}

/**
 * 下落：按列分段压实，段内方块落向该段底部（gravity 固定 down）
 * 洞把一列切成多段，各段独立下落——异形与分仓由此自然成立
 * @returns {Array<{from:number, to:number}>} 位移记录，供动画使用
 */
export function applyGravity(grid) {
  const moves = [];

  for (let c = 0; c < grid.cols; c += 1) {
    for (const seg of columnSegments(grid, c)) {
      const stack = [];
      for (let r = seg.to; r >= seg.from; r -= 1) {
        const i = index(grid, r, c);
        const cell = getAt(grid, i);
        if (cell) stack.push({ cell, from: r });
      }

      stack.forEach((entry, k) => {
        const targetRow = seg.to - k;
        setAt(grid, index(grid, targetRow, c), entry.cell);
        if (entry.from !== targetRow) {
          moves.push({ from: index(grid, entry.from, c), to: index(grid, targetRow, c) });
        }
      });

      // 段内剩余的上部清空，等待补充
      for (let r = seg.to - stack.length; r >= seg.from; r -= 1) {
        setAt(grid, index(grid, r, c), null);
      }
    }
  }

  return moves;
}

/** 补充：把每段顶部的空格填满新方块（weights 见 pickColor） */
export function refill(grid, rng, colors, weights) {
  const added = [];

  for (let c = 0; c < grid.cols; c += 1) {
    for (const seg of columnSegments(grid, c)) {
      for (let r = seg.from; r <= seg.to; r += 1) {
        const i = index(grid, r, c);
        if (getAt(grid, i)) continue;
        const cell = { color: pickColor(rng, colors, weights), special: null };
        setAt(grid, i, cell);
        added.push({ index: i, cell });
      }
    }
  }

  return added;
}

/**
 * 连锁倍率：第 n 次连锁 = 1 + step × (n - 1)，上限 cascadeMax
 * @param {number} cascade - 第几次连锁（从 1 起）
 * @param {number} [cascadeMax] - 倍率上限，默认取 SCORE.cascadeMax（肉鸽模式的祝福可抬高它）
 */
export function cascadeMultiplier(cascade, cascadeMax = SCORE.cascadeMax) {
  return Math.min(1 + SCORE.cascadeStep * (cascade - 1), cascadeMax);
}

/**
 * 分数构成（积分详情用）：把「得分」拆成可解释的三部分，并记录触发次数
 * - tile     基础消除分（消除格数 × perTile × 连锁倍率）
 * - special  特殊元素触发加分（按 specialBonus 累计）
 * - blocker  击碎障碍加分（按 blockerBonus 累计）
 * - specials 各特殊元素触发次数 { row, col, bomb, rainbow }
 * - cascades 连锁层数分布 { 连锁层数: 出现次数 }
 * 三者之和恒等于 resolve 的 gained，是纯展示数据，不参与玩法计算
 */
export function emptyBreakdown() {
  return { tile: 0, special: 0, blocker: 0, specials: {}, cascades: {} };
}

/** 合并两份构成（累计多步用）。始终返回新对象，可直接当克隆用 */
export function mergeBreakdown(a, b) {
  const base = a || emptyBreakdown();
  const out = {
    tile: base.tile || 0,
    special: base.special || 0,
    blocker: base.blocker || 0,
    specials: { ...base.specials },
    cascades: { ...base.cascades },
  };
  if (!b) return out;
  out.tile += b.tile || 0;
  out.special += b.special || 0;
  out.blocker += b.blocker || 0;
  for (const [kind, count] of Object.entries(b.specials || {})) {
    out.specials[kind] = (out.specials[kind] || 0) + count;
  }
  for (const [level, count] of Object.entries(b.cascades || {})) {
    out.cascades[level] = (out.cascades[level] || 0) + count;
  }
  return out;
}

/**
 * 连锁循环：反复 消除 → 触发特殊元素 → 下落 → 补充，直到没有可消除的连线
 * @param {object} grid 棋盘（就地修改）
 * @param {{rng:object, colors:number, focus?:number, cascadeStart?:number, colorMult?:number,
 *          cascadeMax?:number, weights?:Array<number>}} options
 *   focus 为玩家刚交换的格子；cascadeStart 用于接在已有的连锁之后（彩球交换先算一次）；
 *   colorMult 为按颜色数给的得分倍率（仅无尽模式传，见 config.js 的 COLOR_SCORE_MULTIPLIER），默认 1；
 *   cascadeMax 为连锁倍率上限，默认 SCORE.cascadeMax（肉鸽模式的祝福可抬高它）；
 *   weights 为补充新方块时的颜色权重，缺省等概率（见 pickColor）
 * @returns {{steps:Array, gained:number, maxCascade:number, resolvable:boolean,
 *            colors:Object, blockersCleared:number, breakdown:Object}}
 */
export function resolve(grid, { rng, colors, focus = null, cascadeStart = 1, colorMult = 1, cascadeMax = SCORE.cascadeMax, weights = null }) {
  const steps = [];
  let cascade = cascadeStart - 1;
  let gained = 0;
  let focusIndex = focus == null ? null : focus;
  const colorTotals = {};
  let blockersCleared = 0;
  const breakdown = emptyBreakdown();

  for (; ;) {
    const groups = findMatches(grid, { focus: focusIndex });
    if (groups.length === 0) break;
    cascade += 1;

    const seeds = [];
    for (const group of groups) {
      for (const i of group.cells) seeds.push(i);
    }
    const { cleared, triggered } = expandSpecials(grid, seeds);
    const blockerDamage = damageBlockers(grid, cleared);

    // 命中集合里既可能有糖果格，也可能有障碍格：障碍只受击、不参与消除
    const candyCleared = [];
    const colorCounts = {};
    for (const i of cleared) {
      const cell = getAt(grid, i);
      if (!cell || cell.blocker) continue;
      candyCleared.push(i);
      if (cell.color != null) colorCounts[cell.color] = (colorCounts[cell.color] || 0) + 1;
    }

    const spawned = [];
    for (const group of groups) {
      if (group.shape === SHAPE.NORMAL) continue;
      spawned.push({ index: group.spawnIndex, shape: group.shape, color: group.color });
    }

    const multiplier = cascadeMultiplier(cascade, cascadeMax);
    const tileScore = Math.round(candyCleared.length * SCORE.perTile * multiplier * colorMult);
    const specialScore = Math.round(
      triggered.reduce((sum, item) => sum + (SCORE.specialBonus[item.special] || 0), 0) * colorMult,
    );
    const blockerScore = Math.round(blockerDamage.removed.length * SCORE.blockerBonus * colorMult);
    const stepGained = tileScore + specialScore + blockerScore;

    for (const i of candyCleared) setAt(grid, i, null);
    for (const item of spawned) setAt(grid, item.index, makeSpecial(item.shape, item.color));

    const moves = applyGravity(grid);
    const added = refill(grid, rng, colors, weights);

    gained += stepGained;
    breakdown.tile += tileScore;
    breakdown.special += specialScore;
    breakdown.blocker += blockerScore;
    for (const item of triggered) {
      breakdown.specials[item.special] = (breakdown.specials[item.special] || 0) + 1;
    }
    breakdown.cascades[cascade] = (breakdown.cascades[cascade] || 0) + 1;
    for (const [color, count] of Object.entries(colorCounts)) {
      colorTotals[color] = (colorTotals[color] || 0) + count;
    }
    blockersCleared += blockerDamage.removed.length;
    steps.push({
      cascade,
      multiplier,
      cleared: candyCleared,
      triggered,
      spawned,
      removedBlockers: blockerDamage.removed.slice(),
      damagedBlockers: blockerDamage.damaged.slice(),
      gained: stepGained,
      moves,
      added,
    });

    // 只有第一轮认玩家交换的那一格，后续连锁的生成位置按形态自然决定
    focusIndex = null;
  }

  return {
    steps,
    gained,
    maxCascade: cascade,
    resolvable: isResolvable(grid),
    colors: colorTotals,
    blockersCleared,
    breakdown,
  };
}

/**
 * 彩球 + 任意方块交换：把交换本身当作第 1 次连锁结算，后续连锁接在其后
 * 这是唯一允许「两颗特殊元素直接交换」的组合（开发方案 3.5）
 *
 * 两种结算方式：
 * - 目标是条状 / 炸弹：把该特殊效果复制给全部同色棋子，再逐颗触发
 * - 目标是普通方块 / 彩球：清除全场同色；被波及到的特殊元素（含同色条状 / 炸弹）立即触发
 * @param {{rng:object, colors:number, rainbowIndex:number, targetIndex:number,
 *          colorMult?:number, cascadeMax?:number, weights?:Array<number>}} options
 *   weights 为后续补充新方块的颜色权重，缺省等概率（见 pickColor）
 * @returns {{steps:Array, gained:number, maxCascade:number, resolvable:boolean,
 *            colors:Object, blockersCleared:number, breakdown:Object}}
 */
export function resolveRainbowSwap(grid, { rng, colors, rainbowIndex, targetIndex, colorMult = 1, cascadeMax = SCORE.cascadeMax, weights = null }) {
  const copy = rainbowCopyTargets(grid, targetIndex);
  const cleared = new Set([rainbowIndex]);
  const triggered = [];
  const rainbowCell = getAt(grid, rainbowIndex);

  // 彩球是这次交换的发起方：它的效果已经转化为下面的结算方式，
  // 摘掉标记以免被其他特殊元素的波及范围扫到后二次触发（该格必定被消除）
  if (rainbowCell) rainbowCell.special = null;

  if (copy) {
    // 先复制再触发：复制出来的每颗特殊元素各自生效，效果继续级联（由 expandSpecials 负责）
    for (const i of copy.cells) {
      const cell = getAt(grid, i);
      if (cell.special !== copy.shape) cell.special = copy.shape;
    }
    const expanded = expandSpecials(grid, copy.cells);
    expanded.cleared.forEach((i) => cleared.add(i));
    triggered.push({ index: rainbowIndex, special: SPECIAL.RAINBOW, cells: copy.cells.slice() });
    triggered.push(...expanded.triggered);
  } else {
    // 普通方块 / 彩球：清除全场同色，被波及的特殊元素一并触发
    const targets = rainbowSwapTargets(grid, rainbowIndex, targetIndex);
    const expanded = expandSpecials(grid, targets.filter((i) => i !== rainbowIndex));
    expanded.cleared.forEach((i) => cleared.add(i));
    triggered.push({ index: rainbowIndex, special: SPECIAL.RAINBOW, cells: [...cleared] });
    triggered.push(...expanded.triggered);
  }

  const blockerDamage = damageBlockers(grid, cleared);

  // 彩球命中集合里也可能带障碍格：障碍只受击、不参与消除
  const candyCleared = [];
  const colorTotals = {};
  for (const i of cleared) {
    const cell = getAt(grid, i);
    if (!cell || cell.blocker) continue;
    candyCleared.push(i);
    if (cell.color != null) colorTotals[cell.color] = (colorTotals[cell.color] || 0) + 1;
  }

  const multiplier = cascadeMultiplier(1, cascadeMax);
  const tileScore = Math.round(candyCleared.length * SCORE.perTile * multiplier * colorMult);
  const specialScore = Math.round(
    triggered.reduce((sum, item) => sum + (SCORE.specialBonus[item.special] || 0), 0) * colorMult,
  );
  const blockerScore = Math.round(blockerDamage.removed.length * SCORE.blockerBonus * colorMult);
  const gained = tileScore + specialScore + blockerScore;

  // 彩球首次触发算在第 1 连锁内：计一次 tile、记录每个被触发的特殊元素、记录一层连锁
  const breakdown = emptyBreakdown();
  breakdown.tile += tileScore;
  breakdown.special += specialScore;
  breakdown.blocker += blockerScore;
  for (const item of triggered) {
    breakdown.specials[item.special] = (breakdown.specials[item.special] || 0) + 1;
  }
  breakdown.cascades[1] = (breakdown.cascades[1] || 0) + 1;

  for (const i of candyCleared) setAt(grid, i, null);
  const moves = applyGravity(grid);
  const added = refill(grid, rng, colors, weights);

  const first = {
    cascade: 1,
    multiplier,
    cleared: candyCleared,
    triggered,
    spawned: [],
    removedBlockers: blockerDamage.removed.slice(),
    damagedBlockers: blockerDamage.damaged.slice(),
    gained,
    moves,
    added,
  };

  const rest = resolve(grid, { rng, colors, cascadeStart: 2, colorMult, cascadeMax, weights });
  return {
    steps: [first, ...rest.steps],
    gained: gained + rest.gained,
    maxCascade: Math.max(1, rest.maxCascade),
    resolvable: rest.resolvable,
    colors: mergeColorTotals(colorTotals, rest.colors),
    blockersCleared: blockerDamage.removed.length + rest.blockersCleared,
    breakdown: mergeBreakdown(breakdown, rest.breakdown),
  };
}

function mergeColorTotals(a, b) {
  const out = { ...a };
  for (const [color, count] of Object.entries(b || {})) {
    out[color] = (out[color] || 0) + count;
  }
  return out;
}
