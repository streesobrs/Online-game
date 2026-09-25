/**
 * run 容器重置断言（开发方案 4.7.3 事故②-4）
 *
 * 防的事故：一轮结束后立刻 startRun()，run 级字段没复位，
 * 上一轮的地图 / 加成 / Boss 状态 / 以后的金币遗物事件残留进下一轮。
 *
 * mode-rogue 是 DOM 集成、无法在 node 里整包挂载，所以分两层断言：
 * 1. 纯工厂 createRunState：脏 fixture 之后新容器逐项回到初始值、引用不共享；
 * 2. 静态守卫：startRun 函数体对 RUN_STATE_KEYS 的每一个字段都从工厂结果赋值
 *    （新增 run 字段却忘了在 startRun 复位时，本测试直接红）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { createRunState, RUN_STATE_KEYS } from '../src/games/match3/rogue/run-state.js';

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

/** 把一份容器打成「打过一轮」的脏状态（每个字段都与初始值不同） */
function makeDirty() {
  const s = createRunState();
  s.finished = true;
  s.victory = true;
  s.bonus.scoreMult = 9.9;
  s.bonus.specials.rainbow = 5;
  s.picks = { magnet: 4, storm: 2 };
  s.pickedPerks = [{ id: 'magnet' }, { id: 'storm' }];
  s.floor = 37;
  mapAssign(s);
  s.nodeId = 'e37';
  s.terrain = { rows: 8, cols: 8, biome: 'abyss', blockers: [{}] };
  s.goals = [{ type: 'score', target: 99999 }];
  s.quest = { color: 3, need: 50 };
  s.baseScore = 1234567;
  s.maxCombo = 88;
  s.totalMoves = 420;
  s.totalCleared = 9001;
  s.questsDone = 22;
  s.shufflesLeft = 3;
  s.rewindsLeft = 1;
  s.extraPicks = 2;
  s.rewinding = true;
  s.floorCleared = true;
  s.startedAt = 111;
  s.elapsedMs = 999999;
  s.runRng = { fake: true };
  s.bossKills = 3;
  s.boss = { id: 'core_tyrant', hp: 5000, target: 5600, fired: ['a1'] };
  s.endless = true;
  return s;
}
function mapAssign(s) {
  s.map = { depth: 60, nodes: [{ id: 'e60' }] };
}

test('RUN_STATE_KEYS 与工厂返回的键完全一致', () => {
  const keys = Object.keys(createRunState());
  assert.deepEqual([...keys].sort(), [...RUN_STATE_KEYS].sort());
});

test('工厂两次调用的结果逐项相等（初始值确定）', () => {
  assert.deepEqual(createRunState(), createRunState());
});

test('嵌套对象 / 数组每次都是新引用，不跨容器共享', () => {
  const a = createRunState();
  const b = createRunState();
  assert.notEqual(a.bonus, b.bonus);
  assert.notEqual(a.bonus.specials, b.bonus.specials);
  assert.notEqual(a.picks, b.picks);
  assert.notEqual(a.pickedPerks, b.pickedPerks);
  assert.notEqual(a.goals, b.goals);
  // 改脏一份，另一份原封不动
  a.picks.magnet = 9;
  a.pickedPerks.push({});
  a.bonus.specials.rainbow = 3;
  assert.equal(b.picks.magnet, undefined);
  assert.equal(b.pickedPerks.length, 0);
  assert.equal(b.bonus.specials.rainbow, 0);
});

test('脏 fixture（打完整轮）后新容器逐项回到初始值', () => {
  const dirty = makeDirty();
  // 模拟「上一轮闭包」对脏容器的引用仍然存在
  const staleMap = dirty.map;
  const fresh = createRunState();
  assert.deepEqual(fresh, createRunState());
  assert.equal(fresh.floor, 1);
  assert.equal(fresh.bossKills, 0);
  assert.equal(fresh.boss, null);
  assert.equal(fresh.endless, false);
  assert.equal(fresh.finished, false);
  assert.deepEqual(fresh.picks, {});
  assert.notEqual(fresh.map, staleMap);
});

test('静态守卫：mode-rogue.startRun 对每个 run 字段都从工厂结果赋值', () => {
  const source = readFileSync(join(here, '..', 'src', 'games', 'match3', 'modes', 'mode-rogue.js'), 'utf8');
  const start = source.indexOf('function startRun()');
  const end = source.indexOf('\n  }', start);
  assert.ok(start > 0 && end > start, '找不到 startRun 函数体');
  const body = source.slice(start, end);
  assert.ok(/createRunState\(\)/.test(body), 'startRun 必须调用 createRunState()');
  const missing = RUN_STATE_KEYS.filter((key) => !new RegExp(`\\b${key}\\s*=\\s*f\\.${key}\\b`).test(body));
  assert.deepEqual(missing, [], `startRun 漏复位的 run 字段：${missing.join(', ')}`);
});

console.log(`\n全部通过：${passed} 个用例`);
