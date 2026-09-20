/**
 * 消消乐引擎用例（开发方案 6.5）
 *
 * 运行：node client-v2/tests/match3-engine.test.js
 * 引擎为纯逻辑、不碰 DOM，因此直接由 Node 执行，不依赖浏览器。
 */
import assert from 'node:assert/strict';

import {
  COLOR_SCORE_MULTIPLIER,
  ENDLESS_TIERS,
  SCORE,
  SHAPE,
  SPECIAL,
  SPECIAL_RULES,
  colorScoreMultiplier,
} from '../src/games/match3/config.js';
import {
  columnSegments,
  createGrid,
  getAt,
  hasBlocker,
  index,
  isPlayable,
  regions,
  setAt,
} from '../src/games/match3/grid.js';
import { countBlockers, damageBlockers, placeBlockers } from '../src/games/match3/blockers.js';
import { findMatches, findRuns, hasMatch } from '../src/games/match3/match.js';
import { effectCells, expandSpecials } from '../src/games/match3/special.js';
import { findValidMove, isResolvable, shuffleRegion } from '../src/games/match3/deadlock.js';
import {
  applyGravity,
  createInitialBoard,
  emptyBreakdown,
  mergeBreakdown,
  refill,
  resolve,
  resolveRainbowSwap,
} from '../src/games/match3/cascade.js';
import { createRng } from '../src/games/match3/rng.js';
import { validateLevel } from '../src/games/match3/validate.js';
import { CHAPTERS, LEVELS, levelsOfChapter } from '../src/games/match3/levels.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  \u2717 ${name}\n      ${error.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** 用颜色矩阵构造棋盘，0 表示洞 */
function makeGrid(matrix) {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const mask = matrix.map((row) => row.map((v) => (v === 0 ? '0' : '1')).join(''));
  const grid = createGrid({ rows, cols, mask });
  matrix.forEach((row, r) => {
    row.forEach((v, c) => {
      if (v === 0) return;
      setAt(grid, index(grid, r, c), { color: v, special: null });
    });
  });
  return grid;
}

function clone(matrix) {
  return matrix.map((row) => row.slice());
}

/** 5×5 底图：棋盘格，天然无三连，便于改出目标形态 */
const BASE = [
  [2, 3, 2, 3, 2],
  [3, 2, 3, 2, 3],
  [2, 3, 2, 3, 2],
  [3, 2, 3, 2, 3],
  [2, 3, 2, 3, 2],
];

/**
 * 死局底图：2×2 周期、四色互异
 * 任一相邻交换都无法凑出三连（两色棋盘格不算死局，竖直交换会形成两条三连）
 */
const DEAD = [
  [1, 2, 1, 2, 1],
  [3, 4, 3, 4, 3],
  [1, 2, 1, 2, 1],
  [3, 4, 3, 4, 3],
  [1, 2, 1, 2, 1],
];

// ========== 棋盘结构（异形 / 分仓） ==========
section('棋盘结构');

test('矩形棋盘：默认全部可玩', () => {
  const grid = createGrid({ rows: 8, cols: 8 });
  assert.equal(grid.cellIndex.length, 64);
  assert.equal(isPlayable(grid, 0, 0), true);
  assert.equal(isPlayable(grid, 7, 7), true);
});

test('异形棋盘：洞不可玩，且把该列切成两段', () => {
  const grid = makeGrid([
    [1, 1, 1],
    [1, 1, 1],
    [1, 1, 0],
    [1, 1, 1],
    [1, 1, 1],
  ]);
  assert.equal(isPlayable(grid, 2, 2), false);
  assert.deepEqual(columnSegments(grid, 2), [{ from: 0, to: 1 }, { from: 3, to: 4 }]);
  assert.deepEqual(columnSegments(grid, 0), [{ from: 0, to: 4 }]);
});

test('分仓棋盘：十字洞把棋盘切成 4 个互不相连的区域', () => {
  const grid = makeGrid([
    [1, 1, 0, 1, 1],
    [1, 1, 0, 1, 1],
    [0, 0, 0, 0, 0],
    [1, 1, 0, 1, 1],
    [1, 1, 0, 1, 1],
  ]);
  const parts = regions(grid);
  assert.equal(parts.length, 4);
  parts.forEach((cells) => assert.equal(cells.length, 4));
});

test('下落按列分段：洞阻断跨段下落', () => {
  const grid = makeGrid([[1], [2], [0], [3], [4]]);
  assert.deepEqual(columnSegments(grid, 0), [{ from: 0, to: 1 }, { from: 3, to: 4 }]);

  setAt(grid, index(grid, 1, 0), null);
  applyGravity(grid);

  assert.equal(getAt(grid, index(grid, 0, 0)), null);
  assert.equal(getAt(grid, index(grid, 1, 0)).color, 1);
  // 洞下方的段不受影响
  assert.equal(getAt(grid, index(grid, 3, 0)).color, 3);
  assert.equal(getAt(grid, index(grid, 4, 0)).color, 4);
});

test('下落：段内方块向段底压实并记录位移', () => {
  const grid = makeGrid(BASE);
  setAt(grid, index(grid, 2, 0), null);
  const moves = applyGravity(grid);

  assert.equal(getAt(grid, index(grid, 0, 0)), null);
  assert.equal(getAt(grid, index(grid, 1, 0)).color, 2);
  assert.equal(getAt(grid, index(grid, 2, 0)).color, 3);
  assert.equal(getAt(grid, index(grid, 3, 0)).color, 3);
  assert.equal(getAt(grid, index(grid, 4, 0)).color, 2);
  assert.equal(moves.length > 0, true);
});

test('补充：只填空格，且新方块颜色在合法范围内', () => {
  const grid = makeGrid(BASE);
  setAt(grid, index(grid, 4, 4), null);
  const added = refill(grid, createRng(3), 6);
  assert.equal(added.length, 1);
  const cell = getAt(grid, index(grid, 4, 4));
  assert.equal(cell.special, null);
  assert.equal(cell.color >= 1 && cell.color <= 6, true);
});

// ========== 形态识别 ==========
section('形态识别');

test('横向 3 连 → 普通形态，不生成特殊元素', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 3, 2];
  const grid = makeGrid(matrix);
  const groups = findMatches(grid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shape, SHAPE.NORMAL);
  assert.deepEqual(groups[0].cells, [10, 11, 12]);
});

test('竖向 3 连 → 普通形态', () => {
  const matrix = clone(BASE);
  matrix[1][0] = 1;
  matrix[2][0] = 1;
  matrix[3][0] = 1;
  const grid = makeGrid(matrix);
  const groups = findMatches(grid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shape, SHAPE.NORMAL);
  assert.deepEqual(groups[0].cells, [5, 10, 15]);
});

test('直线 4 连 → 条状（横向为 row）', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 1, 2];
  const grid = makeGrid(matrix);
  const groups = findMatches(grid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shape, SHAPE.ROW);
  assert.equal(groups[0].spawnIndex, 12);
});

test('直线 5 连 → 彩球', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 1, 1];
  const grid = makeGrid(matrix);
  const groups = findMatches(grid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shape, SHAPE.RAINBOW);
});

test('L 形（横竖各 3 连共用一格）→ 炸弹', () => {
  const grid = makeGrid([
    [2, 3, 2, 3, 2],
    [3, 2, 1, 2, 3],
    [1, 1, 1, 3, 2],
    [3, 2, 1, 2, 3],
    [2, 3, 2, 3, 2],
  ]);
  const groups = findMatches(grid);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].shape, SHAPE.BOMB);
  assert.deepEqual(groups[0].cells, [7, 10, 11, 12, 17]);
  assert.equal(groups[0].spawnIndex, 12);
});

test('focus 指定玩家交换格作为特殊元素生成位置', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 1, 2];
  const grid = makeGrid(matrix);
  const groups = findMatches(grid, { focus: 13 });
  assert.equal(groups[0].spawnIndex, 13);
});

// ========== 特殊元素 ==========
section('特殊元素');

test('条状：清除整行', () => {
  const matrix = clone(BASE);
  const grid = makeGrid(matrix);
  setAt(grid, 12, { color: 3, special: 'row' });
  const cells = effectCells(grid, 12);
  assert.deepEqual(cells.sort((a, b) => a - b), [10, 11, 12, 13, 14]);
});

test('炸弹：清除 3×3（边界内自动裁剪）', () => {
  const grid = makeGrid(BASE);
  setAt(grid, 12, { color: 3, special: 'bomb' });
  assert.equal(effectCells(grid, 12).length, 9);

  setAt(grid, 0, { color: 2, special: 'bomb' });
  assert.equal(effectCells(grid, 0).length, 4);
});

test('级联触发：条状打到炸弹，两个特殊元素都触发', () => {
  const grid = makeGrid(BASE);
  setAt(grid, 10, { color: 2, special: 'row' });
  setAt(grid, 13, { color: 3, special: 'bomb' });

  const { cleared, triggered } = expandSpecials(grid, [10]);
  assert.equal(triggered.length, 2);
  assert.deepEqual(
    triggered.map((item) => item.special).sort(),
    ['bomb', 'row'],
  );
  // 整行 5 格 + 炸弹额外波及的 6 格
  assert.equal(cleared.size, 11);
  assert.equal(cleared.has(7), true);
  assert.equal(cleared.has(19), true);
});

test('级联触发能穿透整盘：满盘炸弹逐个引爆', () => {
  const grid = createGrid({ rows: 5, cols: 5 });
  for (const i of grid.cellIndex) setAt(grid, i, { color: 1, special: 'bomb' });
  const { cleared, triggered } = expandSpecials(grid, [0]);
  assert.equal(triggered.length, 25);
  assert.equal(cleared.size, 25);
});

test('级联触发有上限保护：触发数不会超过 maxTriggerChain', () => {
  const grid = createGrid({ rows: 12, cols: 10 });
  for (const i of grid.cellIndex) setAt(grid, i, { color: 1, special: 'bomb' });
  const { triggered } = expandSpecials(grid, [0]);
  // 全盘 120 个炸弹，级联必然超过上限，最终被截断在上限处
  assert.equal(triggered.length, SPECIAL_RULES.maxTriggerChain);
  assert.equal(grid.cellIndex.length > SPECIAL_RULES.maxTriggerChain, true);
});

test('彩球：清除全盘同色方块', () => {
  const grid = makeGrid(BASE);
  setAt(grid, 12, { color: null, special: 'rainbow' });
  const cells = effectCells(grid, 12);
  // 底图中颜色 2 共 13 个，其中 (2,2) 已被彩球覆盖，剩 12 个
  assert.equal(cells.length, 12);
  cells.forEach((i) => assert.equal(getAt(grid, i).color, 2));
});

// ========== 连锁与计分 ==========
section('连锁与计分');

test('resolve：消除连线、计分、并收敛结束', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 3, 2];
  const grid = makeGrid(matrix);

  const result = resolve(grid, { rng: createRng(99), colors: 6 });
  assert.equal(result.steps.length >= 1, true);
  assert.equal(result.steps[0].cascade, 1);
  assert.equal(result.steps[0].cleared.length >= 3, true);
  assert.equal(result.steps[0].gained > 0, true);
  assert.equal(result.gained >= result.steps[0].gained, true);
  assert.equal(result.maxCascade, result.steps.length);
  // 结束后棋盘上不应残留连得起来的线
  assert.equal(findMatches(grid).length, 0);
});

test('resolve：4 连会在消除位置生成条状特殊元素', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 1, 2];
  const grid = makeGrid(matrix);

  const result = resolve(grid, { rng: createRng(5), colors: 6 });
  assert.equal(result.steps[0].spawned.length, 1);
  assert.equal(result.steps[0].spawned[0].shape, SHAPE.ROW);
});

test('连锁倍率：逐级提升且有上限', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 3, 2];
  const grid = makeGrid(matrix);
  const result = resolve(grid, { rng: createRng(11), colors: 6 });
  result.steps.forEach((step) => {
    assert.equal(step.multiplier >= 1, true);
    assert.equal(step.multiplier <= 5, true);
  });
});

test('彩球交换：清除目标颜色全部方块并作为第 1 连锁', () => {
  const grid = makeGrid(BASE);
  setAt(grid, 0, { color: null, special: 'rainbow' });
  // 底图颜色 3 共 12 个，(0,1) 在其中；彩球自身也计入
  const result = resolveRainbowSwap(grid, {
    rng: createRng(7),
    colors: 6,
    rainbowIndex: 0,
    targetIndex: 1,
  });

  assert.equal(result.steps[0].cascade, 1);
  assert.equal(result.steps[0].multiplier, 1);
  assert.equal(result.steps[0].cleared.length, 13);
  assert.equal(result.steps[0].triggered[0].special, 'rainbow');
  // 后续连锁从第 2 连锁开始接续计分
  result.steps.slice(1).forEach((step, k) => assert.equal(step.cascade, k + 2));
  assert.equal(result.maxCascade >= 1, true);
  assert.equal(findMatches(grid).length, 0);
});

test('彩球 + 彩球：清空全盘', () => {
  const grid = makeGrid(BASE);
  setAt(grid, 0, { color: null, special: 'rainbow' });
  setAt(grid, 1, { color: null, special: 'rainbow' });
  const result = resolveRainbowSwap(grid, {
    rng: createRng(3),
    colors: 6,
    rainbowIndex: 0,
    targetIndex: 1,
  });
  assert.equal(result.steps[0].cleared.length, grid.cellIndex.length);
});

test('cascadeStart：接在已有连锁之后时序号与倍率延续', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 3, 2];
  const grid = makeGrid(matrix);
  const result = resolve(grid, { rng: createRng(21), colors: 6, cascadeStart: 3 });
  assert.equal(result.steps[0].cascade, 3);
  assert.equal(result.steps[0].multiplier, 2);
});

// ========== 初始生成与可重复加载 ==========
section('初始生成');

test('初始棋盘：无现成三连，且至少存在一个可行交换', () => {
  const { grid, ok } = createInitialBoard({ rows: 8, cols: 8, colors: 6, seed: 42 });
  assert.equal(ok, true);
  assert.equal(findMatches(grid).length, 0);
  assert.equal(findValidMove(grid) != null, true);
});

test('可重复加载：同一 seed 生成完全一致的棋盘', () => {
  const a = createInitialBoard({ rows: 8, cols: 8, colors: 6, seed: 7 }).grid;
  const b = createInitialBoard({ rows: 8, cols: 8, colors: 6, seed: 7 }).grid;
  assert.deepEqual(a.cells, b.cells);

  const c = createInitialBoard({ rows: 8, cols: 8, colors: 6, seed: 8 }).grid;
  assert.notDeepEqual(a.cells, c.cells);
});

test('异形棋盘初始生成：洞上无方块，且满足两条约束', () => {
  const mask = ['00100', '01110', '11111', '01110', '00100'];
  const { grid, ok } = createInitialBoard({ rows: 5, cols: 5, mask, colors: 6, seed: 21 });
  assert.equal(ok, true);
  assert.equal(findMatches(grid).length, 0);
  assert.equal(findValidMove(grid) != null, true);
  assert.equal(getAt(grid, index(grid, 0, 0)), null);
  assert.equal(getAt(grid, index(grid, 4, 4)), null);
  assert.equal(getAt(grid, index(grid, 2, 2)).color >= 1, true);
});

test('分仓棋盘初始生成：每个区域都有方块', () => {
  const mask = ['11011', '11011', '00000', '11011', '11011'];
  const { grid } = createInitialBoard({ rows: 5, cols: 5, mask, colors: 6, seed: 33 });
  regions(grid).forEach((cells) => {
    cells.forEach((i) => assert.equal(getAt(grid, i) != null, true));
  });
  assert.equal(getAt(grid, index(grid, 2, 2)), null);
});

// ========== 死局与洗牌 ==========
section('死局与洗牌');

test('死局识别：2×2 周期四色棋盘既无连线也无可行交换', () => {
  const grid = makeGrid(DEAD);
  assert.equal(hasMatch(grid), false);
  assert.equal(findValidMove(grid), null);
  assert.equal(isResolvable(grid), false);
});

test('区域洗牌：死局重排后恢复可玩', () => {
  const grid = makeGrid(DEAD);
  const result = shuffleRegion(grid, grid.cellIndex, createRng(2024));
  assert.equal(result.ok, true);
  assert.equal(isResolvable(grid), true);
});

// ========== 关卡校验 ==========
section('关卡校验');

const VALID_LEVEL = {
  schemaVersion: 1,
  rows: 8,
  cols: 8,
  mask: [
    '11111111',
    '11111111',
    '11001111',
    '11001111',
    '11111111',
    '11111111',
    '11111111',
    '11111111',
  ],
  colors: 5,
  moves: 20,
  goals: [
    { type: 'score', target: 3000 },
    { type: 'collect', color: 3, target: 15 },
    { type: 'clearBlockers', target: 8 },
  ],
  blockers: [{ r: 3, c: 4, kind: 'ice', hp: 2 }],
  starScore: 3000,
  gravity: 'down',
};

test('合法关卡通过校验', () => {
  const result = validateLevel(VALID_LEVEL);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('非法关卡逐项报错', () => {
  assert.equal(validateLevel(null).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, rows: 3 }).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, rows: 20 }).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, colors: 2 }).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, goals: [] }).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, moves: 0 }).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, gravity: 'up' }).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, schemaVersion: 99 }).ok, false);
});

test('mask 形状错误被拦下', () => {
  const bad = { ...VALID_LEVEL, mask: ['11111111', '11111111'] };
  assert.equal(validateLevel(bad).ok, false);
  assert.equal(validateLevel({ ...VALID_LEVEL, mask: ['1111111X', '11111111', '11001111', '11001111', '11111111', '11111111', '11111111', '11111111'] }).ok, false);
});

test('障碍落在洞上被拦下', () => {
  const bad = { ...VALID_LEVEL, blockers: [{ r: 2, c: 2, kind: 'ice', hp: 1 }] };
  const result = validateLevel(bad);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((msg) => msg.includes('落在洞上')), true);
});

// ========== 障碍物 ==========
section('障碍物');

/**
 * 障碍用例底图：2×2 周期四色（本身无连线、无可行步），
 * 中间格 (2,2) 留给用例放障碍或对照糖果
 */
const BLOCKER_BASE = [
  [1, 2, 1, 2, 1],
  [3, 4, 3, 4, 3],
  [5, 5, 5, 5, 1],
  [3, 4, 3, 4, 3],
  [1, 2, 1, 2, 1],
];

/** 用 BLOCKER_BASE 造盘，center 为 (2,2) 要放的内容 */
function blockerGrid(center) {
  const grid = makeGrid(BLOCKER_BASE);
  setAt(grid, index(grid, 2, 2), center);
  return grid;
}

const STONE = { color: null, special: null, blocker: { kind: 'stone', hp: 1 } };
const ICE2 = { color: null, special: null, blocker: { kind: 'ice', hp: 2 } };

test('障碍铺在指定格，且该格不承载糖果', () => {
  const grid = makeGrid(BASE);
  const placed = placeBlockers(grid, [{ r: 1, c: 1, kind: 'ice' }, { r: 3, c: 3, kind: 'stone', hp: 5 }]);
  assert.equal(placed.length, 2);
  const ice = getAt(grid, index(grid, 1, 1));
  assert.equal(ice.color, null);
  assert.equal(ice.special, null);
  assert.equal(ice.blocker.kind, 'ice');
  assert.equal(ice.blocker.hp, 2); // 缺省取 config.BLOCKERS.ice.hp
  assert.equal(getAt(grid, index(grid, 3, 3)).blocker.hp, 5); // 关卡可逐格覆盖
  assert.equal(countBlockers(grid), 2);
});

test('障碍是列内的墙：糖果不会落进障碍格', () => {
  const grid = makeGrid(BASE);
  placeBlockers(grid, [{ r: 2, c: 0, kind: 'stone' }]);
  const above = getAt(grid, index(grid, 1, 0));
  setAt(grid, index(grid, 3, 0), null); // 障碍下方空出两格
  setAt(grid, index(grid, 4, 0), null);

  applyGravity(grid);

  assert.equal(hasBlocker(grid, index(grid, 2, 0)), true, '障碍应留在原格');
  assert.equal(getAt(grid, index(grid, 1, 0)), above, '障碍上方的糖果不应穿过障碍下落');
  assert.equal(getAt(grid, index(grid, 3, 0)), null, '障碍下方不会由上方补位');
});

test('相邻消除击伤障碍：hp 递减但不消失', () => {
  const grid = blockerGrid(ICE2);
  const target = index(grid, 2, 2);

  const first = damageBlockers(grid, [index(grid, 2, 3)]); // 命中相邻格
  assert.deepEqual(first.damaged, [target]);
  assert.deepEqual(first.removed, []);
  assert.equal(getAt(grid, target).blocker.hp, 1);

  const second = damageBlockers(grid, [target]); // 特殊元素直接波及障碍格
  assert.deepEqual(second.removed, [target]);
  assert.equal(getAt(grid, target), null, 'hp 归零后该格变为空格');
});

test('hp 归零后障碍碎裂，该格随后被下落补充', () => {
  const grid = makeGrid(BLOCKER_BASE);
  setAt(grid, index(grid, 2, 2), STONE);
  // 在障碍正下方造一条三连，消除时会击中障碍
  setAt(grid, index(grid, 3, 1), { color: 5, special: null });
  setAt(grid, index(grid, 3, 2), { color: 5, special: null });
  setAt(grid, index(grid, 3, 3), { color: 5, special: null });

  const result = resolve(grid, { rng: createRng(11), colors: 5 });
  assert.equal(result.blockersCleared, 1);
  assert.equal(countBlockers(grid), 0, '障碍应已碎裂');
  assert.ok(getAt(grid, index(grid, 2, 2)), '碎裂后的格子会被下落 / 补充填上糖果');
});

test('障碍不参与连线', () => {
  const grid = blockerGrid(STONE);
  // 同行其余格都是颜色 5，唯独障碍格没有颜色，连线在此断开
  assert.equal(hasMatch(grid), false);
  assert.equal(findRuns(grid).length, 0);
});

test('涉及障碍的交换不算可行步', () => {
  // 障碍格换成普通糖果时，(2,2) 与 (2,3) 交换会凑出三连 → 是可行步
  const control = blockerGrid({ color: 4, special: null });
  assert.notEqual(findValidMove(control), null);

  // 同一局面把该格换成障碍：这个交换必须被跳过，且此盘没有其他可行步
  const blocked = blockerGrid(STONE);
  assert.equal(findValidMove(blocked), null);
});

test('区域洗牌不会移动障碍', () => {
  const grid = makeGrid(BASE);
  const placed = placeBlockers(grid, [{ r: 1, c: 1, kind: 'ice' }, { r: 3, c: 2, kind: 'lock' }]);
  shuffleRegion(grid, grid.cellIndex, createRng(5));
  for (const i of placed) {
    assert.equal(hasBlocker(grid, i), true, '障碍在洗牌后必须留在原格');
  }
});

test('初始生成含障碍：障碍格无糖果，仍满足两条约束', () => {
  const blockers = [
    { r: 1, c: 1, kind: 'ice' },
    { r: 2, c: 3, kind: 'stone' },
    { r: 5, c: 6, kind: 'lock' },
  ];
  const board = createInitialBoard({ rows: 8, cols: 8, colors: 6, seed: 21, blockers });
  assert.equal(board.ok, true);
  assert.equal(hasMatch(board.grid), false, '不应存在现成三连');
  assert.notEqual(findValidMove(board.grid), null, '应至少存在一个可行交换');
  assert.equal(countBlockers(board.grid), blockers.length);
  for (const blocker of blockers) {
    const cell = getAt(board.grid, index(board.grid, blocker.r, blocker.c));
    assert.equal(cell.color, null, '障碍格不应有糖果');
    assert.ok(cell.blocker, '障碍格应持有障碍');
  }
});

test('resolve 统计：返回各颜色消除数与击碎障碍数', () => {
  const grid = makeGrid(BLOCKER_BASE);
  setAt(grid, index(grid, 2, 2), STONE);
  setAt(grid, index(grid, 3, 1), { color: 5, special: null });
  setAt(grid, index(grid, 3, 2), { color: 5, special: null });
  setAt(grid, index(grid, 3, 3), { color: 5, special: null });

  const result = resolve(grid, { rng: createRng(3), colors: 5 });
  assert.ok(result.colors['5'] >= 3, '三连的 3 个颜色 5 应被计入');
  assert.equal(result.blockersCleared, 1);
});

// ========== 分数构成（积分详情用） ==========
section('分数构成');

test('breakdown：三项之和恒等于本局得分', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 3, 2];
  const grid = makeGrid(matrix);

  const result = resolve(grid, { rng: createRng(99), colors: 6 });
  const { tile, special, blocker } = result.breakdown;
  assert.equal(tile + special + blocker, result.gained);
  assert.equal(tile > 0, true);
});

test('breakdown：连锁分布与 specials 计数与 steps 对齐', () => {
  const matrix = clone(BASE);
  matrix[2] = [1, 1, 1, 1, 2]; // 4 连 → 生成条状，后续可能级联触发
  const grid = makeGrid(matrix);

  const result = resolve(grid, { rng: createRng(5), colors: 6 });
  const cascadeTotal = Object.values(result.breakdown.cascades).reduce((a, b) => a + b, 0);
  assert.equal(cascadeTotal, result.steps.length);

  const specialTotal = Object.values(result.breakdown.specials).reduce((a, b) => a + b, 0);
  const triggeredTotal = result.steps.reduce((sum, step) => sum + step.triggered.length, 0);
  assert.equal(specialTotal, triggeredTotal);
});

test('breakdown：击碎障碍计入 blocker 项', () => {
  const grid = makeGrid(BLOCKER_BASE);
  setAt(grid, index(grid, 2, 2), STONE);
  setAt(grid, index(grid, 3, 1), { color: 5, special: null });
  setAt(grid, index(grid, 3, 2), { color: 5, special: null });
  setAt(grid, index(grid, 3, 3), { color: 5, special: null });

  const result = resolve(grid, { rng: createRng(3), colors: 5 });
  assert.equal(result.breakdown.blocker, SCORE.blockerBonus);
  const { tile, special, blocker } = result.breakdown;
  assert.equal(tile + special + blocker, result.gained);
});

test('breakdown：彩球交换的构成之和等于总得分，且记一次彩球触发', () => {
  const grid = makeGrid(BASE);
  setAt(grid, 0, { color: null, special: 'rainbow' });

  const result = resolveRainbowSwap(grid, {
    rng: createRng(7),
    colors: 6,
    rainbowIndex: 0,
    targetIndex: 1,
  });
  const { tile, special, blocker } = result.breakdown;
  assert.equal(tile + special + blocker, result.gained);
  assert.equal(result.breakdown.specials[SPECIAL.RAINBOW], 1);
});

test('mergeBreakdown：多步累计不丢项，且不改动入参', () => {
  const a = { tile: 100, special: 20, blocker: 0, specials: { bomb: 1 }, cascades: { 1: 2 } };
  const b = { tile: 50, special: 0, blocker: 30, specials: { bomb: 2, row: 1 }, cascades: { 1: 1, 2: 1 } };

  const out = mergeBreakdown(a, b);
  assert.equal(out.tile, 150);
  assert.equal(out.special, 20);
  assert.equal(out.blocker, 30);
  assert.equal(out.specials.bomb, 3);
  assert.equal(out.specials.row, 1);
  assert.equal(out.cascades[1], 3);
  assert.equal(out.cascades[2], 1);
  // 入参不被修改
  assert.equal(a.tile, 100);
  assert.equal(a.specials.bomb, 1);
  assert.equal(a.cascades[1], 2);
  // 空值安全
  assert.deepEqual(mergeBreakdown(null, null), emptyBreakdown());
});

// ========== 颜色数得分倍率（无尽模式） ==========
section('颜色数得分倍率');

test('倍率表覆盖 4~8 色，且颜色越多倍率越高', () => {
  const tiers = [4, 5, 6, 7, 8];
  for (const colors of tiers) {
    assert.equal(typeof COLOR_SCORE_MULTIPLIER[colors], 'number');
    assert.ok(colorScoreMultiplier(colors) > 0);
  }
  for (let i = 1; i < tiers.length; i += 1) {
    assert.ok(
      colorScoreMultiplier(tiers[i]) > colorScoreMultiplier(tiers[i - 1]),
      `${tiers[i]} 色的倍率应高于 ${tiers[i - 1]} 色`,
    );
  }
  // 表外颜色数按 1 处理（不缩放），保证闯关的非常规配色不会被误缩放
  assert.equal(colorScoreMultiplier(3), 1);
  assert.equal(colorScoreMultiplier(9), 1);
  assert.equal(colorScoreMultiplier(undefined), 1);
});

test('难度分档：4 色起步、门槛与颜色数同步递增、上限 8 色', () => {
  assert.equal(ENDLESS_TIERS[0].colors, 4);
  assert.equal(ENDLESS_TIERS[0].minScore, 0);
  assert.equal(ENDLESS_TIERS[ENDLESS_TIERS.length - 1].colors, 8);
  for (let i = 1; i < ENDLESS_TIERS.length; i += 1) {
    assert.ok(ENDLESS_TIERS[i].minScore > ENDLESS_TIERS[i - 1].minScore, '门槛必须递增');
    assert.ok(ENDLESS_TIERS[i].colors > ENDLESS_TIERS[i - 1].colors, '颜色数必须递增');
  }
});

test('colorMult：按倍率缩放得分，breakdown 三项之和仍等于 gained', () => {
  const build = () => {
    const matrix = clone(BASE);
    matrix[2] = [1, 1, 1, 3, 2];
    return makeGrid(matrix);
  };
  const full = resolve(build(), { rng: createRng(99), colors: 6, colorMult: 1 });
  const quarter = resolve(build(), { rng: createRng(99), colors: 4, colorMult: 0.25 });

  assert.ok(quarter.gained < full.gained);
  // 每步各自取整，允许一个步数量级的误差
  assert.ok(Math.abs(quarter.gained - full.gained * 0.25) <= full.steps.length + 1);

  const { tile, special, blocker } = quarter.breakdown;
  assert.equal(tile + special + blocker, quarter.gained);
});

test('colorMult：默认 1，引擎不会依据 colors 自行缩放（闯关模式依赖这一点）', () => {
  const build = () => {
    const matrix = clone(BASE);
    matrix[2] = [1, 1, 1, 3, 2];
    return makeGrid(matrix);
  };
  const plain = resolve(build(), { rng: createRng(99), colors: 4 });
  const explicit = resolve(build(), { rng: createRng(99), colors: 4, colorMult: 1 });
  assert.equal(plain.gained, explicit.gained);
});

test('colorMult：彩球交换及其后续连锁同样按倍率缩放', () => {
  const build = () => {
    const grid = makeGrid(BASE);
    setAt(grid, 0, { color: null, special: 'rainbow' });
    return grid;
  };
  // 每次都要新建 rng：同一个 rng 对象被两次调用共享会消耗掉随机序列，局面就不可比了
  const mkOpts = () => ({ rng: createRng(7), colors: 6, rainbowIndex: 0, targetIndex: 1 });
  const full = resolveRainbowSwap(build(), { ...mkOpts(), colorMult: 1 });
  const half = resolveRainbowSwap(build(), { ...mkOpts(), colorMult: 0.5 });

  const { tile, special, blocker } = half.breakdown;
  assert.equal(tile + special + blocker, half.gained);
  // 每步三项各自取整，误差随步数累积，容差取步数的两倍
  assert.ok(
    Math.abs(half.gained - full.gained * 0.5) <= full.steps.length * 2 + 2,
    `full=${full.gained} half=${half.gained} steps=${full.steps.length}`,
  );
});

// ========== 关卡配置 ==========
section('关卡配置');

test('30 关全部通过结构校验，且分章各 10 关', () => {
  assert.equal(LEVELS.length, 30);
  for (const chapter of CHAPTERS) {
    assert.equal(levelsOfChapter(chapter.id).length, 10);
  }
  for (const level of LEVELS) {
    const result = validateLevel(level);
    assert.deepEqual(result.errors, [], `第 ${level.id} 关校验失败`);
  }
});

test('每关 clearBlockers 目标不超过实际障碍数', () => {
  for (const level of LEVELS) {
    const target = (level.goals.find((goal) => goal.type === 'clearBlockers') || {}).target || 0;
    const placed = (level.blockers || []).length;
    assert.ok(target <= placed, `第 ${level.id} 关目标 ${target} 超过障碍数 ${placed}`);
  }
});

test('每关都能生成合法初始棋盘', () => {
  for (const level of LEVELS) {
    const board = createInitialBoard({
      rows: level.rows,
      cols: level.cols,
      mask: level.mask,
      colors: level.colors,
      seed: level.id,
      blockers: level.blockers || null,
    });
    assert.equal(board.ok, true, `第 ${level.id} 关初始生成失败`);
    assert.equal(hasMatch(board.grid), false, `第 ${level.id} 关存在现成三连`);
  }
});

// ========== 汇总 ==========
console.log(`\n${passed} 通过 / ${failures.length} 失败`);
if (failures.length > 0) {
  console.log('\n失败项：');
  failures.forEach((item) => console.log(`  - ${item.name}: ${item.message}`));
  process.exitCode = 1;
}
