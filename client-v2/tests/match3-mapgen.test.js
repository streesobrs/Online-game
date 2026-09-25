/**
 * 随机地图生成器用例（开发方案 3.1 / 4.7）
 *
 * 运行：node client-v2/tests/match3-mapgen.test.js
 * mapgen 是纯数据 + 纯逻辑（不碰 DOM），直接由 Node 执行。
 */
import assert from 'node:assert/strict';

import { createRng } from '../src/games/match3/engine/rng.js';
import {
  ALL_ENABLED,
  BOSS_DEPTHS,
  MAP_DEPTH,
  NODE,
  P0_ENABLED,
  advanceTo,
  biomeAt,
  completeNode,
  generateMap,
  hasOpenNode,
  mapSummary,
  nextNodes,
  reachableFrom,
  synthLinearMap,
  validateMap,
} from '../src/games/match3/rogue/mapgen.js';

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.log(`  ✗ ${name}\n      ${error.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** 大量随机种子下逐张图跑结构自检（生成器与从存档重建共用同一套约束） */
function assertAllMapsValid(optionSets, seeds = 120) {
  for (const opts of optionSets) {
    for (let s = 0; s < seeds; s += 1) {
      const map = generateMap(createRng(100003 + s * 7919), opts);
      const result = validateMap(map);
      assert.ok(
        result.ok,
        `seed=${map.seed} opts=${JSON.stringify({ ...opts, enabled: opts.enabled ? [...opts.enabled] : undefined })} `
          + `校验失败：${result.errors.join('；')}`,
      );
    }
  }
}

/** 沿「每层任取一个 open 节点」的策略把整张图走到头，返回经过的节点 */
function walkWholeMap(map, pick = (list) => list[0]) {
  const trace = [];
  // 起点直接完成（等价 mode-rogue.startRun），打开第一排
  completeNode(map, map.start[0]);
  trace.push(map.start[0]);
  let guard = 0;
  while (hasOpenNode(map)) {
    guard += 1;
    assert.ok(guard <= MAP_DEPTH + 1, '选路步数异常（可能在环里打转）');
    const open = map.nodes.filter((n) => n.state === 'open');
    // 同一深度最多只有一排处于 open：advanceTo 会锁掉同层其它分叉
    const depths = new Set(open.map((n) => n.depth));
    assert.equal(depths.size, 1, '同一时刻出现了多排可选节点');
    const to = pick(open);
    const from = trace[trace.length - 1];
    assert.equal(advanceTo(map, from, to.id), true, `节点 ${from} 无法进入 ${to.id}`);
    completeNode(map, to.id);
    trace.push(to.id);
  }
  return trace;
}

// ---------------- 1. 结构骨架 ----------------

section('地图结构（大量随机种子）');

test('默认（P0）/ 全类型 / 新手 / 精英加量 各 120 个种子全部通过自检', () => {
  assertAllMapsValid([
    {},
    { enabled: ALL_ENABLED },
    { newPlayer: true },
    { newPlayer: true, enabled: ALL_ENABLED },
    { eliteBonus: 1 },
    { enabled: ALL_ENABLED, eliteBonus: 1, eventPerBiome: 3, treasureChance: 1 },
    { enabled: ALL_ENABLED, treasureChance: 0 },
  ]);
});

test('深度 30：起点唯一在深度 0，Boss 固定在 10 / 20 / 30 且单列', () => {
  for (let s = 0; s < 30; s += 1) {
    const map = generateMap(createRng(701 + s));
    assert.equal(map.depth, MAP_DEPTH);
    assert.deepEqual(map.start, ['n0']);
    assert.deepEqual(map.bosses, BOSS_DEPTHS.map((d) => `b${d}`));
    assert.equal(map.rows[0].length, 1);
    assert.equal(map.rows[0][0].type, NODE.START);
    for (const d of BOSS_DEPTHS) {
      assert.equal(map.rows[d].length, 1, `深度 ${d} 排宽不是 1`);
      assert.equal(map.rows[d][0].type, NODE.BOSS);
      assert.equal(map.rows[d][0].id, `b${d}`);
    }
  }
});

test('普通排宽度在 2~4；节点 id 全局唯一；节点只连下一排', () => {
  for (let s = 0; s < 60; s += 1) {
    const map = generateMap(createRng(9001 + s * 13));
    const ids = new Set();
    for (const n of map.nodes) {
      assert.ok(!ids.has(n.id), `重复 id：${n.id}`);
      ids.add(n.id);
      if (n.depth > 0 && !BOSS_DEPTHS.includes(n.depth)) {
        assert.ok(map.rows[n.depth].length >= 2 && map.rows[n.depth].length <= 4);
        // 紧接起点 / Boss 单节点排时不能超过扇出上限
        if (map.rows[n.depth - 1].length === 1) assert.ok(map.rows[n.depth].length <= 3);
      }
      for (const id of n.next) {
        const to = map.byId.get(id);
        assert.ok(to, `${n.id} 连向不存在的 ${id}`);
        assert.equal(to.depth, n.depth + 1);
      }
    }
  }
});

test('节点 biome 与深度一致（1-10 plain / 11-20 frost / 21-30 core）', () => {
  const map = generateMap(createRng(42));
  for (const n of map.nodes) {
    if (n.depth === 0) {
      assert.equal(n.biome, null);
      continue;
    }
    assert.equal(n.biome, biomeAt(n.depth), `节点 ${n.id} 的 biome 标记错误`);
  }
  assert.equal(biomeAt(10), 'plain');
  assert.equal(biomeAt(11), 'frost');
  assert.equal(biomeAt(20), 'frost');
  assert.equal(biomeAt(21), 'core');
});

// ---------------- 2. 连通性 ----------------

section('连通性');

test('从起点前向 DFS 必能到达最终 Boss，且路径长度 = 31（每排恰好经过一个）', () => {
  for (let s = 0; s < 80; s += 1) {
    const map = generateMap(createRng(31337 + s * 101));
    const reachable = reachableFrom(map, map.start[0]);
    assert.ok(reachable.has(map.bosses[2]), '最终 Boss 从起点不可达');
    // Boss 把每排收成单列，任何通路都必须经过全部 3 个 Boss
    for (const bossId of map.bosses) assert.ok(reachable.has(bossId));
  }
});

test('每个非起点节点至少有一个前驱（无死节点）', () => {
  for (let s = 0; s < 40; s += 1) {
    const map = generateMap(createRng(555 + s * 7));
    const hasPred = new Set();
    for (const n of map.nodes) for (const id of n.next) hasPred.add(id);
    for (const n of map.nodes) {
      if (n.depth > 0) assert.ok(hasPred.has(n.id), `节点 ${n.id} 没有前驱`);
    }
  }
});

// ---------------- 3. 配额 ----------------

section('房间配额');

test('P0 档只生成战斗类节点（事件 / 商店 / 宝藏 / 篝火槽位全部让给战斗）', () => {
  for (let s = 0; s < 40; s += 1) {
    const map = generateMap(createRng(808 + s));
    const allowed = new Set([NODE.START, NODE.BATTLE, NODE.ELITE, NODE.BOSS]);
    for (const n of map.nodes) assert.ok(allowed.has(n.type), `P0 出现了未实装节点 ${n.type}`);
  }
});

test('新手保护：全图不出精英', () => {
  for (let s = 0; s < 40; s += 1) {
    const map = generateMap(createRng(808 + s), { newPlayer: true, enabled: ALL_ENABLED });
    assert.equal(map.nodes.filter((n) => n.type === NODE.ELITE).length, 0);
  }
});

test('非新手每区域恰好 1 个精英；eliteBonus=1 时 2 个；均在区域中部', () => {
  for (let s = 0; s < 40; s += 1) {
    const map = generateMap(createRng(606 + s * 3), { enabled: ALL_ENABLED });
    for (const bossDepth of BOSS_DEPTHS) {
      const elites = map.nodes.filter(
        (n) => n.type === NODE.ELITE && n.depth >= bossDepth - 9 && n.depth <= bossDepth,
      );
      assert.equal(elites.length, 1, `Boss ${bossDepth} 区域精英数不是 1`);
      assert.ok(elites[0].depth >= bossDepth - 6 && elites[0].depth <= bossDepth - 3);
    }
    const map2 = generateMap(createRng(606 + s * 3), { enabled: ALL_ENABLED, eliteBonus: 1 });
    for (const bossDepth of BOSS_DEPTHS) {
      const elites = map2.nodes.filter(
        (n) => n.type === NODE.ELITE && n.depth >= bossDepth - 9 && n.depth <= bossDepth,
      );
      assert.equal(elites.length, 2);
    }
  }
});

test('全类型档：篝火固定在 Boss 前一层；商店在 Boss 前 1~2 层；事件每区域 2 个；宝藏每区域 ≤1', () => {
  for (let s = 0; s < 60; s += 1) {
    const map = generateMap(createRng(4242 + s * 17), { enabled: ALL_ENABLED, treasureChance: 1 });
    for (const bossDepth of BOSS_DEPTHS) {
      const inRegion = (n) => n.depth >= bossDepth - 9 && n.depth <= bossDepth;
      const rests = map.nodes.filter((n) => n.type === NODE.REST && inRegion(n));
      const shops = map.nodes.filter((n) => n.type === NODE.SHOP && inRegion(n));
      const events = map.nodes.filter((n) => n.type === NODE.EVENT && inRegion(n));
      const treasures = map.nodes.filter((n) => n.type === NODE.TREASURE && inRegion(n));
      assert.equal(rests.length, 1);
      assert.equal(rests[0].depth, bossDepth - 1, '篝火不在 Boss 前一层');
      assert.equal(shops.length, 1);
      assert.ok(shops[0].depth >= bossDepth - 2 && shops[0].depth <= bossDepth - 1);
      assert.equal(events.length, 2);
      assert.ok(treasures.length <= 1);
      // 宝藏在区域前部
      for (const t of treasures) assert.ok(t.depth >= bossDepth - 8 && t.depth <= bossDepth - 6);
    }
  }
});

test('treasureChance=0 全图无宝藏；战斗类节点占比 ≥ 55%', () => {
  const map = generateMap(createRng(1), { enabled: ALL_ENABLED, treasureChance: 0 });
  assert.equal(map.nodes.filter((n) => n.type === NODE.TREASURE).length, 0);
  for (let s = 0; s < 30; s += 1) {
    const p0 = mapSummary(generateMap(createRng(5 + s)));
    const all = mapSummary(generateMap(createRng(5 + s), { enabled: ALL_ENABLED }));
    assert.ok(p0.battleRatio >= 0.55, `P0 战斗占比只有 ${p0.battleRatio}`);
    assert.ok(all.battleRatio >= 0.55, `全类型战斗占比只有 ${all.battleRatio}`);
  }
});

// ---------------- 4. 确定性与复现 ----------------

section('确定性');

test('同 seed + 同参数必出同一张图；不同 seed 会产生不同排宽序列', () => {
  const a = generateMap(createRng(12345), { enabled: ALL_ENABLED });
  const b = generateMap(createRng(12345), { enabled: ALL_ENABLED });
  assert.equal(a.seed, b.seed);
  assert.deepEqual(
    a.nodes.map((n) => `${n.id}:${n.type}:${n.next.join('>')}`),
    b.nodes.map((n) => `${n.id}:${n.type}:${n.next.join('>')}`),
  );
  const widthKinds = new Set();
  for (let s = 0; s < 50; s += 1) {
    const map = generateMap(createRng(90000 + s));
    widthKinds.add(map.rows.slice(1, MAP_DEPTH).filter((r, i) => !BOSS_DEPTHS.includes(i + 1)).map((r) => r.length).join(','));
  }
  assert.ok(widthKinds.size > 1, '50 个种子排宽完全一致，随机源可能没接进来');
});

test('params 回传 enabled 列表，可据此从存档参数重建', () => {
  const map = generateMap(createRng(77), { enabled: ALL_ENABLED, newPlayer: true, eliteBonus: 1 });
  assert.deepEqual([...map.params.enabled].sort(), [...ALL_ENABLED].sort());
  assert.equal(map.params.newPlayer, true);
  assert.equal(map.params.eliteBonus, 1);
  // 存档恢复的典型路径：数组转回 Set 后重建
  const rebuilt = generateMap(createRng(map.seed), { ...map.params, enabled: new Set(map.params.enabled) });
  assert.deepEqual(
    rebuilt.nodes.map((n) => n.type),
    map.nodes.map((n) => n.type),
  );
});

// ---------------- 5. 状态机 ----------------

section('选路状态机');

test('advanceTo：只接受当前节点的下游；进入后锁掉同层其它分叉', () => {
  const map = generateMap(createRng(2024));
  completeNode(map, map.start[0]);
  const firstRow = map.rows[1];
  const target = firstRow[0];
  assert.equal(advanceTo(map, map.start[0], 'not-exist'), false);
  // 起点不与第二排某节点相连时应拒绝
  const unreachable = firstRow.find((n) => !map.rows[0][0].next.includes(n.id));
  if (unreachable) assert.equal(advanceTo(map, map.start[0], unreachable.id), false);

  assert.equal(advanceTo(map, map.start[0], target.id), true);
  assert.equal(map.byId.get(map.start[0]).state, 'done');
  assert.equal(target.state, 'open');
  for (const n of firstRow) {
    if (n.id !== target.id && map.rows[0][0].next.includes(n.id)) {
      assert.equal(n.state, 'locked', '同层其它分叉没有被锁掉');
    }
  }
});

test('completeNode：只把直接下游从 locked 解锁为 open', () => {
  const map = generateMap(createRng(2025));
  completeNode(map, map.start[0]);
  const target = map.rows[1][0];
  advanceTo(map, map.start[0], target.id);
  const downstream = new Set(target.next);
  completeNode(map, target.id);
  assert.equal(target.state, 'done');
  for (const n of map.rows[2]) {
    assert.equal(n.state, downstream.has(n.id) ? 'open' : 'locked');
  }
});

test('nextNodes / hasOpenNode 与状态一致', () => {
  const map = generateMap(createRng(2026));
  assert.equal(hasOpenNode(map), true); // 生成时起点就是 open
  assert.deepEqual(nextNodes(map, map.start[0]).map((n) => n.id), map.rows[0][0].next);
  assert.deepEqual(nextNodes(map, 'no-such-node'), []);
});

test('完整走通一张图：每排选一个节点，最终 Boss 后没有任何 open', () => {
  const map = generateMap(createRng(31415), { enabled: ALL_ENABLED });
  const trace = walkWholeMap(map, (list) => list[list.length - 1]);
  assert.equal(trace.length, MAP_DEPTH + 1); // 起点 + 30 层
  assert.equal(trace[trace.length - 1], `b${MAP_DEPTH}`);
  assert.equal(hasOpenNode(map), false);
  // Boss 排与起点都是单节点，trace 里每个 Boss 都出现
  for (const d of BOSS_DEPTHS) assert.ok(trace.includes(`b${d}`));
  // 所有节点终态只能是 done / locked（没有残留 open）
  for (const n of map.nodes) assert.notEqual(n.state, 'open');
});

// ---------------- 6. v1 线性合成图（4.7 迁移用） ----------------

section('旧档线性合成图');

test('synthLinearMap：31 排单链，10/20/30 是 Boss，结构自检通过', () => {
  const map = synthLinearMap(1);
  assert.equal(map.rows.length, MAP_DEPTH + 1);
  assert.equal(map.seed, 0);
  assert.equal(map.params.synthetic, true);
  for (let d = 0; d <= MAP_DEPTH; d += 1) {
    assert.equal(map.rows[d].length, 1);
    const n = map.rows[d][0];
    if (d === 0) assert.equal(n.type, NODE.START);
    else if (BOSS_DEPTHS.includes(d)) assert.equal(n.type, NODE.BOSS);
    else assert.equal(n.type, NODE.BATTLE);
    if (d < MAP_DEPTH) assert.equal(n.next.length, 1);
  }
  assert.equal(validateMap(map).ok, true);
  // 也能被同一套状态机走到头
  const trace = [];
  let cur = map.start[0];
  while (hasOpenNode(map)) {
    const open = map.nodes.filter((n) => n.state === 'open');
    assert.equal(open.length, 1);
    advanceTo(map, cur, open[0].id);
    completeNode(map, open[0].id);
    trace.push(open[0].id);
    cur = open[0].id;
  }
  assert.equal(trace.length, MAP_DEPTH);
  assert.equal(cur, `b${MAP_DEPTH}`);

  // 从第 7 层中途续玩：当前 open 节点先打完（completeNode），再逐层推进到 30，共 24 个节点
  const resume = synthLinearMap(7);
  let steps = 0;
  let at = resume.nodes.find((n) => n.state === 'open');
  completeNode(resume, at.id);
  steps += 1;
  while (hasOpenNode(resume)) {
    const [open] = resume.nodes.filter((n) => n.state === 'open');
    assert.equal(advanceTo(resume, at.id, open.id), true);
    completeNode(resume, open.id);
    at = open;
    steps += 1;
  }
  assert.equal(steps, MAP_DEPTH - 7 + 1);
});

test('synthLinearMap：当前层之前 done / 当前 open / 之后 locked', () => {
  const map = synthLinearMap(7);
  assert.equal(map.rows[0][0].state, 'done');
  for (let d = 1; d <= MAP_DEPTH; d += 1) {
    assert.equal(map.rows[d][0].state, d < 7 ? 'done' : d === 7 ? 'open' : 'locked');
  }
});

test('synthLinearMap 边界：30 层是最终 Boss 本身 open；越界 / 非法入参截断回 1', () => {
  assert.equal(synthLinearMap(30).rows[30][0].state, 'open');
  assert.equal(synthLinearMap(99).rows[30][0].state, 'open');
  const fallback = synthLinearMap(0);
  assert.equal(fallback.rows[1][0].state, 'open');
  assert.equal(synthLinearMap(NaN).rows[1][0].state, 'open');
  assert.equal(synthLinearMap(-5).rows[1][0].state, 'open');
});

// ---------------- 汇总 ----------------

section('汇总');
if (failures.length > 0) {
  console.error(`\n${failures.length} 个用例失败：`);
  for (const f of failures) console.error(`  ✗ ${f.name}\n      ${f.message}`);
  process.exit(1);
}
console.log(`\n全部通过：${passed} 个用例`);
