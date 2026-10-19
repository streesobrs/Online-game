/**
 * 特殊元素的生成与级联触发（开发方案 3.5）
 *
 * 三条定死的规则：
 * - 生成位置：优先玩家交换的那一格（由 match.js 的 spawnIndex 决定），否则交叉点 / 连线中点
 * - 触发：被消除时立即生效；效果波及到的特殊元素继续触发
 * - 级联用队列处理并设上限，防止递归失控
 * - 彩球例外：条状 / 炸弹的爆炸不波及彩球，扫到也原地保留（不触发、不消耗）；
 *   彩球只在玩家主动拿它去交换时才结算
 *
 * 形态效果：row 整行 / col 整列 / bomb 半径内的方形区域（默认 3×3）/ rainbow 同色全部
 * 彩球组合：+ 普通方块 → 清除全场同色；+ 条状 / 炸弹 → 该效果复制给全部同色棋子并逐颗触发
 *
 * 引擎 hook（开发方案 3.5「遗物二期」，P7）：effectCells / expandSpecials / rainbowSwapTargets
 * 均可选接收一个 `opts`（遗物编译出的引擎修正，见 relics.js 的 buildRelicHooks.engine）：
 * - `opts.bombRadius`：覆盖 SPECIAL_RULES.bombRadius（肉鸽遗物「爆炸半径 +1」）；
 * - `opts.rainbowExtraColors`：彩球交换额外清除的颜色个数（肉鸽遗物「双色棱镜」）。
 * 不传时逐位等同旧行为——引擎只读参数，不含任何遗物逻辑。
 */
import { SPECIAL, SPECIAL_RULES, SHAPE } from '../config/config.js';
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

/**
 * 单个特殊元素的效果范围（不含连锁）
 * @param {object} grid
 * @param {number} cellIndex
 * @param {object} [opts] - 引擎修正：`opts.bombRadius` 覆盖炸弹半径（默认 SPECIAL_RULES.bombRadius）
 */
export function effectCells(grid, cellIndex, opts = {}) {
  const cell = getAt(grid, cellIndex);
  if (!cell || !cell.special) return [];

  const r = rowOf(grid, cellIndex);
  const c = colOf(grid, cellIndex);
  const out = [];
  // 爆炸范围内的格：彩球不被波及（扫到也原地保留，只由玩家主动交换消耗）
  const push = (i) => {
    if (getAt(grid, i)?.special === SPECIAL.RAINBOW) return;
    out.push(i);
  };

  if (cell.special === SPECIAL.ROW) {
    for (let cc = 0; cc < grid.cols; cc += 1) {
      if (isPlayable(grid, r, cc)) push(index(grid, r, cc));
    }
    return out;
  }

  if (cell.special === SPECIAL.COL) {
    for (let rr = 0; rr < grid.rows; rr += 1) {
      if (isPlayable(grid, rr, c)) push(index(grid, rr, c));
    }
    return out;
  }

  if (cell.special === SPECIAL.BOMB) {
    const rad = Number.isFinite(opts.bombRadius) && opts.bombRadius > 0
      ? Math.floor(opts.bombRadius)
      : SPECIAL_RULES.bombRadius;
    for (let rr = r - rad; rr <= r + rad; rr += 1) {
      for (let cc = c - rad; cc <= c + rad; cc += 1) {
        if (isPlayable(grid, rr, cc)) push(index(grid, rr, cc));
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
 * 彩球 + 普通方块 / 彩球交换：清除目标颜色的全部方块
 * 彩球 + 彩球是唯一例外（清空全盘，场上其他彩球除外），开发方案 1.3 的"不做两两组合"针对的是条状 / 炸弹
 * 目标是条状 / 炸弹时另走 rainbowCopyTargets（效果复制给同色），不走这里
 * @param {object} [opts] - 引擎修正：`opts.rainbowExtraColors` 额外清除的颜色个数（遗物「双色棱镜」）
 * @returns {number[]} 去重后的待清除格子
 */
export function rainbowSwapTargets(grid, rainbowIndex, targetIndex, opts = {}) {
  const target = getAt(grid, targetIndex);
  const out = new Set([rainbowIndex, targetIndex]);
  if (!target) return [...out];
  if (target.special === SPECIAL.RAINBOW) {
    // 双彩球清空全盘，但场上的其他彩球依旧「扫到也原地保留」：
    // 参与本次交换的两颗照常消耗，其余的既不消除、也不引爆（不触发、不消耗）
    return grid.cellIndex.filter(
      (i) => i === rainbowIndex || i === targetIndex || getAt(grid, i)?.special !== SPECIAL.RAINBOW,
    );
  }

  const color = target.color;
  if (color == null) return [...out];
  const clearColor = (want) => {
    for (const i of grid.cellIndex) {
      const cell = getAt(grid, i);
      if (cell && cell.color === want) out.add(i);
    }
  };
  clearColor(color);
  // 双色棱镜：再清「场上另一主色」（按出现次数降序取，确定性、可复现）
  const extra = Math.max(0, Math.floor(opts.rainbowExtraColors || 0));
  for (const c of pickExtraColors(grid, color, extra)) clearColor(c);
  return [...out];
}

/**
 * 场上出现次数最多的若干颜色（排除 excludeColor），用于「双色棱镜」额外清色
 * 同次数按颜色下标升序，保证同 seed 同盘面结果一致
 * @returns {number[]} 至多 n 个颜色（场上颜色不足时返回更少）
 */
export function pickExtraColors(grid, excludeColor, n) {
  const count = Math.max(0, Math.floor(n || 0));
  if (count === 0) return [];
  const counts = new Map();
  for (const i of grid.cellIndex) {
    const cell = getAt(grid, i);
    if (!cell || cell.color == null || cell.color === excludeColor) continue;
    counts.set(cell.color, (counts.get(cell.color) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, count)
    .map(([c]) => c);
}

/**
 * 彩球 + 条状 / 炸弹：把该特殊元素的效果复制给全部同色棋子
 * 复制后由 expandSpecials 逐颗触发，因此同色棋子各自生效并继续级联；
 * 复制只改 special，颜色保留（复制出来的仍是可参与连线的同色棋子）
 * @returns {{shape:string, color:number, cells:number[]}|null} null 表示目标不是可复制的特殊元素
 */
export function rainbowCopyTargets(grid, targetIndex) {
  const target = getAt(grid, targetIndex);
  if (!target || target.blocker || !target.special) return null;
  if (target.special === SPECIAL.RAINBOW || target.color == null) return null;

  const cells = [];
  for (const i of grid.cellIndex) {
    const cell = getAt(grid, i);
    if (!cell || cell.blocker || cell.color !== target.color) continue;
    cells.push(i);
  }
  return { shape: target.special, color: target.color, cells };
}

/**
 * 把初始消除集合展开为「含特殊元素级联」的完整消除集合
 * @param {object} grid 棋盘
 * @param {number[]} seeds 本轮因连线而被消除的格子
 * @param {object} [opts] - 引擎修正（见文件头），透传给 effectCells（如 `bombRadius`）
 * @returns {{ cleared: Set<number>, triggered: Array<{index:number, special:string, cells:number[]}> }}
 */
export function expandSpecials(grid, seeds, opts = {}) {
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
    const effect = effectCells(grid, i, opts);
    triggered.push({ index: i, special: cell.special, cells: effect.slice() });

    for (const j of effect) {
      if (!cleared.has(j) || !fired.has(j)) queue.push(j);
    }
  }

  return { cleared, triggered };
}
