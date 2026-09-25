/**
 * 消消乐棋盘数据结构（开发方案 3.2 / 3.7）
 *
 * 支持高自由度棋盘：
 * - L0 任意矩形
 * - L1 异形（挖洞）
 * - L2 分仓多区域
 *
 * 关键实现结论：洞由 mask 决定、永不承载单元格，下落按「同一列内的连续可玩段」处理，
 * 因此 L1 / L2 不需要额外逻辑——洞把列切断成多段，每段独立下落即可。
 *
 * 单元格结构：
 *   { color: 1..8 | null, special: null | 'row' | 'col' | 'bomb' | 'rainbow',
 *     blocker: null | { kind: 'ice' | 'lock' | 'stone', hp: number } }
 * - color 为 null 且无 special → 空格（消除后待补充）
 * - 彩球颜色为 null，不参与同色匹配
 * - 障碍格不承载糖果（color / special 均为 null），不参与连线与交换，
 *   并且是「列内的墙」：下落与补充都绕过它（见 columnSegments）
 */

/**
 * 解析 mask
 * 支持字符串数组（['11011', ...]）、二维数组（[[1,1,0], ...]）、null（全可玩）
 */
export function parseMask(rows, cols, mask) {
  const playable = new Uint8Array(rows * cols);
  if (!mask) {
    playable.fill(1);
    return playable;
  }
  for (let r = 0; r < rows; r += 1) {
    const line = mask[r];
    for (let c = 0; c < cols; c += 1) {
      let value;
      if (typeof line === 'string') value = line[c];
      else if (Array.isArray(line)) value = line[c];
      else value = 1;
      playable[r * cols + c] = value === 1 || value === '1' || value === true ? 1 : 0;
    }
  }
  return playable;
}

/** 创建棋盘（cells 初始全空，需由生成逻辑填充） */
export function createGrid({ rows, cols, mask = null }) {
  const playable = parseMask(rows, cols, mask);
  const cells = new Array(rows * cols).fill(null);
  const cellIndex = [];
  for (let i = 0; i < playable.length; i += 1) {
    if (playable[i]) cellIndex.push(i);
  }
  return { rows, cols, mask: playable, cells, cellIndex };
}

/** 行列 → 一维下标 */
export function index(grid, r, c) {
  return r * grid.cols + c;
}

/** 一维下标 → 行 */
export function rowOf(grid, i) {
  return Math.floor(i / grid.cols);
}

/** 一维下标 → 列 */
export function colOf(grid, i) {
  return i % grid.cols;
}

export function inBounds(grid, r, c) {
  return r >= 0 && r < grid.rows && c >= 0 && c < grid.cols;
}

/** 该行列是否可玩（在界内且 mask 为 1；洞返回 false） */
export function isPlayable(grid, r, c) {
  return inBounds(grid, r, c) && grid.mask[index(grid, r, c)] === 1;
}

export function isPlayableIndex(grid, i) {
  return i >= 0 && i < grid.mask.length && grid.mask[i] === 1;
}

export function getAt(grid, i) {
  return grid.cells[i] || null;
}

export function setAt(grid, i, cell) {
  grid.cells[i] = cell || null;
}

export function get(grid, r, c) {
  return isPlayable(grid, r, c) ? getAt(grid, index(grid, r, c)) : null;
}

export function set(grid, r, c, cell) {
  if (isPlayable(grid, r, c)) setAt(grid, index(grid, r, c), cell);
}

/** 该格是否需要补充（可玩且为空） */
export function isEmptyAt(grid, i) {
  return isPlayableIndex(grid, i) && !grid.cells[i];
}

/** 该格是否被障碍占据（障碍固定不动，视作列内的墙） */
export function hasBlocker(grid, i) {
  const cell = grid.cells[i];
  return !!(cell && cell.blocker);
}

/** 该格是否参与下落与补充（可玩、且没有障碍挡着） */
export function isFreeIndex(grid, i) {
  return isPlayableIndex(grid, i) && !hasBlocker(grid, i);
}

/**
 * 按列拆成若干连续「可自由下落」段（from 为上端、to 为下端，重力方向固定 down）
 * 洞与障碍都会把一列切断成多段，各段独立下落——异形与分仓由此自然成立，
 * 障碍也因此不需要单独的下落逻辑
 */
export function columnSegments(grid, c) {
  const segments = [];
  let start = -1;
  for (let r = 0; r < grid.rows; r += 1) {
    const free = isPlayable(grid, r, c) && !hasBlocker(grid, index(grid, r, c));
    if (free && start === -1) start = r;
    if (!free && start !== -1) {
      segments.push({ from: start, to: r - 1 });
      start = -1;
    }
  }
  if (start !== -1) segments.push({ from: start, to: grid.rows - 1 });
  return segments;
}

/**
 * 连通区域划分（四邻接），返回每个区域的可玩格子下标数组
 * 分仓棋盘的洗牌与死局判定以「区域」为粒度（开发方案 3.6）
 */
export function regions(grid) {
  const seen = new Uint8Array(grid.mask.length);
  const result = [];
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (const start of grid.cellIndex) {
    if (seen[start]) continue;
    const cells = [];
    const queue = [start];
    seen[start] = 1;
    while (queue.length) {
      const i = queue.shift();
      cells.push(i);
      const r = rowOf(grid, i);
      const c = colOf(grid, i);
      for (const [dr, dc] of offsets) {
        const nr = r + dr;
        const nc = c + dc;
        if (!isPlayable(grid, nr, nc)) continue;
        const j = index(grid, nr, nc);
        if (seen[j]) continue;
        seen[j] = 1;
        queue.push(j);
      }
    }
    result.push(cells);
  }
  return result;
}

/** 四个方向上的可玩邻居 */
export function neighbors(grid, r, c) {
  const out = [];
  const offsets = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (const [dr, dc] of offsets) {
    const nr = r + dr;
    const nc = c + dc;
    if (isPlayable(grid, nr, nc)) out.push({ r: nr, c: nc, index: index(grid, nr, nc) });
  }
  return out;
}

/** 行列 → 像素坐标（异形棋盘用绝对定位渲染） */
export function toPixel(grid, r, c, cellSize) {
  return { x: c * cellSize, y: r * cellSize };
}

/** 深拷贝棋盘（用例与模拟用，不影响原棋盘） */
export function cloneGrid(grid) {
  return {
    rows: grid.rows,
    cols: grid.cols,
    mask: grid.mask.slice(),
    cellIndex: grid.cellIndex.slice(),
    cells: grid.cells.map((cell) =>
      cell ? { ...cell, blocker: cell.blocker ? { ...cell.blocker } : null } : null,
    ),
  };
}
