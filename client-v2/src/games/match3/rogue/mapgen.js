/**
 * 肉鸽随机地图（开发方案 3.1）
 *
 * 一轮 run 不再是「第 N 层」一条直线，而是一张纵向节点图：
 * - 深度 0 为单一起点；深度 10 / 20 / 30 为单一 Boss，把一轮切成三个区域
 * - 每个普通节点向下一排的 1~3 个邻近节点连边，玩家在分叉处选一个，其余永久关闭
 * - 节点类型按配额生成（战斗 / 精英 / 事件 / 商店 / 宝藏 / 篝火 / Boss）
 *
 * 本文件是**纯数据 + 纯逻辑**，不碰 DOM：标定脚本与未来的地图存档迁移都直接复用。
 * 随机一律走外部传入的 rng（rng.js），同 seed + 同参数必出同一张图——
 * 所以局内续存只存 mapSeed + 生成参数 + 各节点状态，不整张图存（见 mode-rogue）。
 */

/** 节点类型 */
export const NODE = {
  START: 'start',       // 起点（深度 0，唯一，不产生对局）
  BATTLE: 'battle',     // 普通战斗
  ELITE: 'elite',       // 精英：高目标 + 障碍，奖励更厚（P1 接奖励差异）
  BOSS: 'boss',         // 区域 Boss（深度 10 / 20 / 30）
  EVENT: 'event',       // 随机事件（P2）
  SHOP: 'shop',         // 商店（P4）
  TREASURE: 'treasure', // 宝藏：白拿遗物（P2）
  REST: 'rest',         // 篝火：恢复 or 强化（P2）
};

/** 各类型的界面素材（view 层共用，保持数据驱动；P0 未实装的节点不会生成） */
export const NODE_META = {
  [NODE.START]: { icon: '🚩', name: '起点' },
  [NODE.BATTLE]: { icon: '👾', name: '战斗' },
  [NODE.ELITE]: { icon: '⚔️', name: '精英', danger: true },
  [NODE.BOSS]: { icon: '👑', name: 'Boss', danger: true },
  [NODE.EVENT]: { icon: '❓', name: '事件' },
  [NODE.SHOP]: { icon: '🛒', name: '商店' },
  [NODE.TREASURE]: { icon: '💎', name: '宝藏' },
  [NODE.REST]: { icon: '🔥', name: '篝火' },
};

/** 一轮总深度（最终 Boss 在最后） */
export const MAP_DEPTH = 30;
/** Boss 所在深度（区域分界） */
export const BOSS_DEPTHS = [10, 20, 30];
/** 每一排（非 Boss）的列数范围 */
const ROW_WIDTH_MIN = 2;
const ROW_WIDTH_MAX = 4;
/** 一个节点最多连几个下游 */
const MAX_LINKS = 3;

/**
 * 已实装的节点类型集合
 *
 * 地图规则一次按完整版写好，但 P0 只实装了战斗类节点；事件 / 商店 / 篝火 / 宝藏
 * 分别在 P2 / P4 接线。未启用类型的配额槽位自动让给战斗（见 fillRooms），
 * 于是后续阶段只需把类型加进这个集合，mapgen 本身不用改。
 */
export const P0_ENABLED = new Set([NODE.BATTLE, NODE.ELITE, NODE.BOSS]);
/** 完整版启用集合（标定 / 后续阶段用） */
export const ALL_ENABLED = new Set([
  NODE.BATTLE, NODE.ELITE, NODE.BOSS, NODE.EVENT, NODE.SHOP, NODE.TREASURE, NODE.REST,
]);

/** 深度 → 区域 id（与 config.js 的 ROGUE_BIOMES 同口径：1-10 / 11-20 / 21-30） */
export function biomeAt(depth) {
  if (depth >= 21) return 'core';
  if (depth >= 11) return 'frost';
  return 'plain';
}

function makeNode(depth, col, type, id) {
  return {
    id,
    depth,
    col,
    type,
    biome: depth >= 1 && depth <= MAP_DEPTH ? biomeAt(depth) : null,
    next: [],
    state: 'locked', // locked（未到达）| open（可选）| done（已通过）
  };
}

/**
 * 生成一张 run 地图
 * @param {object} rng - rng.js 的随机数发生器（同 seed 复现同图）
 * @param {object} [opts]
 * @param {boolean} [opts.newPlayer=false] - 新手保护：不生成精英
 * @param {number} [opts.eliteBonus=0] - 每区域精英额外数量（进阶难度用，上限 1）
 * @param {number} [opts.eventPerBiome=2] - 每区域事件数（2~3）
 * @param {number} [opts.treasureChance=0.5] - 每区域出宝藏的概率（文档：每区域 ≤1）
 * @param {Set<string>} [opts.enabled] - 已实装的节点类型（默认 P0_ENABLED）
 * @param {number} [opts.depth=MAP_DEPTH]
 * @param {number[]} [opts.bossDepths=BOSS_DEPTHS]
 * @returns {{nodes:object[], byId:Map<string,object>, start:string[], bosses:string[],
 *            depth:number, seed:number, params:object}}
 */
export function generateMap(rng, opts = {}) {
  const depth = opts.depth || MAP_DEPTH;
  const bossDepths = opts.bossDepths || BOSS_DEPTHS;
  const enabled = opts.enabled || P0_ENABLED;
  const params = {
    newPlayer: !!opts.newPlayer,
    eliteBonus: Math.max(0, Math.floor(opts.eliteBonus || 0)),
    eventPerBiome: Math.max(0, Math.floor(opts.eventPerBiome ?? 2)),
    treasureChance: opts.treasureChance == null ? 0.5 : opts.treasureChance,
  };

  // ---- 1. 骨架：每排若干节点（起点与 Boss 排单列）----
  const rows = [];
  rows[0] = [makeNode(0, 1, NODE.START, 'n0')];
  rows[0][0].state = 'open';
  for (let d = 1; d <= depth; d += 1) {
    if (bossDepths.includes(d)) {
      rows[d] = [makeNode(d, 1, NODE.BOSS, `b${d}`)];
    } else {
      // 上一排是单节点排（起点 / Boss）时，本排最多 MAX_LINKS 列：
      // 单节点最多扇出 MAX_LINKS 条边，4 列必有一列连不到（反向补边也补不出来）
      const widthMax = rows[d - 1].length === 1 ? Math.min(ROW_WIDTH_MAX, MAX_LINKS) : ROW_WIDTH_MAX;
      const width = ROW_WIDTH_MIN + rng.int(widthMax - ROW_WIDTH_MIN + 1);
      rows[d] = [];
      for (let c = 0; c < width; c += 1) {
        rows[d].push(makeNode(d, c, NODE.BATTLE, `n${d}_${c}`));
      }
    }
  }

  // ---- 2. 连边：每个节点向下一排的邻近列连 1~3 个；Boss 前排全连 Boss ----
  for (let d = 0; d < depth; d += 1) {
    const cur = rows[d];
    const nextRow = rows[d + 1];

    if (bossDepths.includes(d + 1)) {
      const boss = nextRow[0];
      for (const n of cur) n.next = [boss.id];
      continue;
    }

    for (const n of cur) {
      let candidates = nextRow.filter((m) => Math.abs(m.col - n.col) <= 1);
      if (candidates.length === 0) {
        // 排间宽度错位（起点单列遇宽排时可能发生）：退化为列距最近的至多 2 个
        candidates = [...nextRow]
          .sort((a, b) => Math.abs(a.col - n.col) - Math.abs(b.col - n.col))
          .slice(0, Math.min(2, nextRow.length));
      }
      const maxLinks = Math.min(MAX_LINKS, candidates.length);
      const linkCount = 1 + (maxLinks > 1 ? rng.int(maxLinks) : 0);
      n.next = rng.shuffle([...candidates]).slice(0, linkCount).map((m) => m.id);
    }

    // 反向补边：下一排每个节点至少有一个前驱，杜绝死节点。
    // 只能补在还没连满 MAX_LINKS 的前驱上（否则会造出第 4 条边，违反下游数约束）：
    // 排宽都在 2~4，上排总槽位 3w 恒 ≥ 下排节点数 w'，未满的前驱一定存在
    const linked = new Set(cur.flatMap((n) => n.next));
    for (const m of nextRow) {
      if (linked.has(m.id)) continue;
      let best = null;
      for (const n of cur) {
        if (n.next.length >= MAX_LINKS) continue;
        if (!best || Math.abs(n.col - m.col) < Math.abs(best.col - m.col)) best = n;
      }
      if (!best) {
        // 理论不可达（容量恒够）的防御分支：交给边数最少的前驱，validateMap 会兜底
        best = cur.reduce((a, b) => (a.next.length <= b.next.length ? a : b));
      }
      if (!best.next.includes(m.id)) best.next.push(m.id);
      linked.add(m.id);
    }
  }

  // ---- 3. 分配特殊房间（先占刚性最强的位置，其余保持战斗）----
  fillRooms(rows, rng, { ...params, enabled, bossDepths });

  const nodes = rows.flat();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes,
    byId,
    rows,
    start: ['n0'],
    bosses: bossDepths.map((d) => rows[d][0].id),
    depth,
    seed: rng.seed,
    params: { ...params, enabled: [...enabled] },
  };
}

/**
 * 按区域配额填房间类型
 *
 * 每个 Boss 前的 9 个深度是一个区域：
 * - 篝火固定在 Boss 前一层；商店在 Boss 前 1~2 层（可规划是否绕路）
 * - 宝藏在区域前部（稀有，按概率出）；精英在区域中部；事件散布
 * 未启用的类型直接跳过（槽位留给战斗）。
 */
function fillRooms(rows, rng, p) {
  const occupied = new Set();
  const takeNode = (d, type) => {
    const pool = rows[d].filter((n) => n.type === NODE.BATTLE && !occupied.has(n.id));
    if (pool.length === 0) return null;
    const node = pool[rng.int(pool.length)];
    node.type = type;
    occupied.add(node.id);
    return node;
  };
  /** 在给定深度区间里随机挑深度放置（打乱深度顺序，避开已占满的排） */
  const takeInRanges = (ranges, type) => {
    const depths = [];
    for (const [a, b] of ranges) for (let d = a; d <= b; d += 1) depths.push(d);
    rng.shuffle(depths);
    for (const d of depths) {
      if (takeNode(d, type)) return true;
    }
    return false;
  };

  for (const bossDepth of p.bossDepths) {
    const a = bossDepth - 9; // 本区域首个深度（1 / 11 / 21）
    const b = bossDepth - 1; // Boss 前一层（9 / 19 / 29）

    if (p.enabled.has(NODE.REST)) takeNode(b, NODE.REST);
    if (p.enabled.has(NODE.SHOP)) takeInRanges([[b - 1, b]], NODE.SHOP);
    if (p.enabled.has(NODE.TREASURE) && rng.next() < p.treasureChance) {
      takeInRanges([[a + 1, a + 3]], NODE.TREASURE);
    }
    const eventCount = p.enabled.has(NODE.EVENT) ? Math.min(p.eventPerBiome, 2) : 0;
    for (let i = 0; i < eventCount; i += 1) takeInRanges([[a + 1, b - 1]], NODE.EVENT);
    if (p.enabled.has(NODE.ELITE) && !p.newPlayer) {
      const eliteCount = Math.min(2, 1 + p.eliteBonus);
      for (let i = 0; i < eliteCount; i += 1) takeInRanges([[a + 3, b - 3]], NODE.ELITE);
    }
  }
}

// ---- 查询与状态变更（模式层用）----

/** 节点的下游节点对象 */
export function nextNodes(map, nodeId) {
  const node = map.byId.get(nodeId);
  if (!node) return [];
  return node.next.map((id) => map.byId.get(id)).filter(Boolean);
}

/** 选择进入某节点后：标记当前完成、打开其下游、关闭同层其它可选节点 */
export function advanceTo(map, fromId, toId) {
  const from = map.byId.get(fromId);
  const to = map.byId.get(toId);
  if (!from || !to || !from.next.includes(toId)) return false;
  from.state = 'done';
  // 同一深度的其它 open 节点永久关闭（玩家在分叉上做了选择）
  for (const n of map.rows[to.depth]) {
    if (n.id === toId) n.state = 'open';
    else if (n.state === 'open') n.state = 'locked';
  }
  return true;
}

/**
 * 完成当前节点并打开其全部下游（层间流程用：三选一结束 → 回地图选路）
 *
 * 与 advanceTo 的分工：advanceTo 是「玩家在地图上点了某个下游」的瞬间
 * （要锁同层的其它分叉）；本函数只负责把刚打完的节点置 done、把下游解锁为可选。
 */
export function completeNode(map, nodeId) {
  const node = map.byId.get(nodeId);
  if (!node) return false;
  node.state = 'done';
  for (const id of node.next) {
    const next = map.byId.get(id);
    if (next && next.state === 'locked') next.state = 'open';
  }
  return true;
}

/** 地图上是否还有可前进的节点（最终 Boss 打完后为 false，run 自然结束） */
export function hasOpenNode(map) {
  return map.nodes.some((n) => n.state === 'open');
}

/**
 * 由旧版「线性第 N 层」存档合成一张等价的单链地图（开发方案 4.7：v1 → v2 迁移）
 *
 * 旧 session 没有分叉图，只有「正在打第 floor 层」。合成图每排单节点：
 * 深度 < currentDepth 的为 done、currentDepth 为 open、其余 locked；
 * 10 / 20 / 30 仍是 Boss。这样旧档续玩直接复用同一套地图状态机，不写分叉特例。
 * @param {number} [currentDepth=1] 旧档里正在进行的层号（1..30）
 */
export function synthLinearMap(currentDepth = 1) {
  const depth = Math.max(1, Math.min(MAP_DEPTH, Math.floor(currentDepth) || 1));
  const rows = [];
  rows[0] = [makeNode(0, 1, NODE.START, 'n0')];
  for (let d = 1; d <= MAP_DEPTH; d += 1) {
    const isBoss = BOSS_DEPTHS.includes(d);
    rows[d] = [makeNode(d, 1, isBoss ? NODE.BOSS : NODE.BATTLE, isBoss ? `b${d}` : `l${d}`)];
  }
  for (let d = 0; d < MAP_DEPTH; d += 1) rows[d][0].next = [rows[d + 1][0].id];
  rows[0][0].state = 'done';
  for (let d = 1; d <= MAP_DEPTH; d += 1) {
    rows[d][0].state = d < depth ? 'done' : d === depth ? 'open' : 'locked';
  }
  const nodes = rows.flat();
  return {
    nodes,
    byId: new Map(nodes.map((n) => [n.id, n])),
    rows,
    start: ['n0'],
    bosses: BOSS_DEPTHS.map((d) => rows[d][0].id),
    depth: MAP_DEPTH,
    seed: 0,
    params: { synthetic: true },
  };
}

/** 从某节点出发前向 DFS 能到达的全部节点 id（连通性自检用） */
export function reachableFrom(map, nodeId) {
  const seen = new Set();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id) || !map.byId.has(id)) continue;
    seen.add(id);
    for (const next of map.byId.get(id).next) stack.push(next);
  }
  return seen;
}

/** 各类型节点计数与战斗类占比（标定脚本用） */
export function mapSummary(map) {
  const byType = {};
  for (const n of map.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
  // 战斗类 = 普通战斗 + 精英 + Boss（文档配额：占比 ≥ 55%）
  const battleLike = (byType[NODE.BATTLE] || 0) + (byType[NODE.ELITE] || 0) + (byType[NODE.BOSS] || 0);
  return {
    total: map.nodes.length,
    byType,
    battleRatio: map.nodes.length ? battleLike / map.nodes.length : 0,
  };
}

/**
 * 地图自检（生成后与从存档重建后都跑一遍）
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateMap(map) {
  const errors = [];
  const assert = (cond, msg) => { if (!cond) errors.push(msg); };

  assert(map && map.byId instanceof Map, '地图结构非法');
  if (errors.length) return { ok: false, errors };

  // v1→v2 迁移合成的线性图（synthLinearMap）：每排单节点单链，排宽 / 分叉规则单独校验
  const synthetic = !!map.params?.synthetic;

  // 1. 起点与 Boss
  const starts = map.nodes.filter((n) => n.type === NODE.START);
  assert(starts.length === 1 && starts[0].depth === 0, '起点必须唯一且在深度 0');
  for (const d of BOSS_DEPTHS) {
    const row = map.rows[d] || [];
    assert(row.length === 1 && row[0].type === NODE.BOSS, `深度 ${d} 必须是唯一 Boss`);
  }

  // 2. 连边合法：只连下一排、1~3 个、目标存在；每排宽度 1(Boss)~4
  for (const n of map.nodes) {
    if (n.depth === map.depth) {
      assert(n.next.length === 0, `终点 Boss(${n.id}) 不应有下游`);
      continue;
    }
    assert(n.next.length >= 1 && n.next.length <= MAX_LINKS,
      `节点 ${n.id} 的下游数 ${n.next.length} 不在 1~3`);
    for (const id of n.next) {
      const to = map.byId.get(id);
      assert(!!to, `节点 ${n.id} 连向不存在的节点 ${id}`);
      if (to) assert(to.depth === n.depth + 1, `节点 ${n.id} 只能连下一排，实际连到深度 ${to.depth}`);
    }
    // 深度 0 是单一起点排（单列合法）；Boss 排单列；其余普通排宽度 2~4
    if (n.depth > 0 && !BOSS_DEPTHS.includes(n.depth)) {
      if (synthetic) {
        assert(map.rows[n.depth].length === 1, `线性合成图深度 ${n.depth} 必须单列`);
        assert(n.next.length === 1, `线性合成图节点 ${n.id} 必须只有一条下游`);
      } else {
        assert(map.rows[n.depth].length >= ROW_WIDTH_MIN && map.rows[n.depth].length <= ROW_WIDTH_MAX,
          `深度 ${n.depth} 排宽越界`);
        // 上一排单节点（起点 / Boss）时，本排不能超过其扇出上限，否则必有不可达节点
        if (map.rows[n.depth - 1].length === 1) {
          assert(map.rows[n.depth].length <= MAX_LINKS,
            `深度 ${n.depth} 紧接单节点排，宽度不能超过 ${MAX_LINKS}`);
        }
      }
    }
  }

  // 3. 反向：每个非起点节点至少一个前驱
  const hasPred = new Set();
  for (const n of map.nodes) for (const id of n.next) hasPred.add(id);
  for (const n of map.nodes) {
    if (n.depth > 0) assert(hasPred.has(n.id), `节点 ${n.id} 没有任何前驱（不可达）`);
  }

  // 4. 前向：任意节点都能到达最终 Boss（无死胡同、不会绕过 Boss）
  const finalBoss = map.rows[map.depth][0];
  for (const n of map.nodes) {
    if (!reachableFrom(map, n.id).has(finalBoss.id)) {
      errors.push(`节点 ${n.id} 无法到达最终 Boss`);
      break;
    }
  }

  // 5. 区域配额（篝火 / 商店 Boss 前必有；精英每区域 ≤2；事件每区域 ≤3）
  const regions = [
    [1, BOSS_DEPTHS[0]], [BOSS_DEPTHS[0] + 1, BOSS_DEPTHS[1]], [BOSS_DEPTHS[1] + 1, BOSS_DEPTHS[2]],
  ];
  for (const [a, b] of regions) {
    const inRegion = map.nodes.filter((n) => n.depth >= a && n.depth <= b);
    const count = (type) => inRegion.filter((n) => n.type === type).length;
    if (inRegion.some((n) => n.type === NODE.REST)) {
      assert(count(NODE.REST) >= 1, `区域 ${a}-${b} 缺篝火（生成了该类型时）`);
    }
    assert(count(NODE.ELITE) <= 2, `区域 ${a}-${b} 精英超过 2 个`);
    assert(count(NODE.EVENT) <= 3, `区域 ${a}-${b} 事件超过 3 个`);
    assert(count(NODE.TREASURE) <= 1, `区域 ${a}-${b} 宝藏超过 1 个`);
  }

  return { ok: errors.length === 0, errors };
}
