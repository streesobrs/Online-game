/**
 * Boss 纯函数断言（开发方案 3.3，P1 数值 Boss）
 * - 定义表：三个 Boss 在 10/20/30，系数 / 布阵 / 阶段齐全
 * - 血量：沿 goalOf 曲线放大，与 bonus.goalCut 联动
 * - 机关盘：8×8 满盘、坐标合法不重复、阵型数量稳定、同 seed 复现
 * - 阶段：按剩余血量百分比一次性触发，越过多个阈值时按顺序全触发
 */
import assert from 'node:assert/strict';
import { ROGUE, ROGUE_BOSSES, ROGUE_BOSS_ORDER } from '../src/games/match3/config/config.js';
import { createRng } from '../src/games/match3/engine/rng.js';
import { goalOf } from '../src/games/match3/rogue/perks.js';
import {
  bossAt, bossHpTarget, createBossState, bossTerrain, crossedPhases, isBossDefeated,
} from '../src/games/match3/rogue/boss.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const emptyBonus = { goalCut: 0 };

test('三个 Boss 分别在 10/20/30 层，其余深度没有 Boss', () => {
  assert.deepEqual(ROGUE_BOSS_ORDER.map((id) => ROGUE_BOSSES[id].depth), [10, 20, 30]);
  for (const d of [10, 20, 30]) assert.ok(bossAt(d), `深度 ${d} 应有 Boss`);
  for (const d of [1, 9, 11, 19, 21, 29, 31]) assert.equal(bossAt(d), null);
});

test('每个 Boss 定义字段完整（名称/图标/系数/两阶段/保底奖励）', () => {
  for (const id of ROGUE_BOSS_ORDER) {
    const def = ROGUE_BOSSES[id];
    assert.ok(def.icon && def.name);
    assert.ok(def.hpMult >= 1);
    assert.equal(def.phases.length, 2);
    assert.ok(def.phases[0].at > def.phases[1].at);
    assert.equal(def.rewardRarity, 'epic');
    assert.ok(['chains', 'icefield', 'pillars'].includes(def.layout.kind));
  }
});

test('Boss 血量 = goalOf × hpMult（整数、不小于普通目标分）', () => {
  for (const id of ROGUE_BOSS_ORDER) {
    const def = ROGUE_BOSSES[id];
    const hp = bossHpTarget(def, emptyBonus);
    assert.equal(hp, Math.round(goalOf(def.depth, emptyBonus) * def.hpMult));
    assert.ok(hp >= goalOf(def.depth, emptyBonus));
  }
});

test('血量随 goalCut 降低（祝福降目标对 Boss 同样生效）', () => {
  const def = ROGUE_BOSSES.chain_warden;
  assert.ok(bossHpTarget(def, { goalCut: 0.3 }) < bossHpTarget(def, emptyBonus));
});

test('createBossState 含目标血量与空阶段记录', () => {
  const def = ROGUE_BOSSES.chain_warden;
  const s = createBossState(def, emptyBonus);
  assert.equal(s.id, 'chain_warden');
  assert.equal(s.target, bossHpTarget(def, emptyBonus));
  assert.deepEqual(s.fired, []);
});

function assertTerrain(def) {
  const t = bossTerrain(def, createRng(42));
  assert.equal(t.rows, ROGUE.rows);
  assert.equal(t.cols, ROGUE.cols);
  assert.equal(t.mask, null);
  assert.equal(t.biome, def.biome);
  const keys = new Set();
  for (const b of t.blockers) {
    assert.ok(b.r >= 0 && b.r < t.rows && b.c >= 0 && b.c < t.cols, `坐标越界 ${JSON.stringify(b)}`);
    assert.ok(['lock', 'ice', 'stone'].includes(b.kind));
    const k = `${b.r},${b.c}`;
    assert.ok(!keys.has(k), `障碍格重复 ${k}`);
    keys.add(k);
  }
  return t;
}

test('锁链阵：8 个锁、四角双链、无越界无重复', () => {
  const t = assertTerrain(ROGUE_BOSSES.chain_warden);
  assert.equal(t.blockers.length, 8);
  assert.ok(t.blockers.every((b) => b.kind === 'lock'));
  // 双链落在 (1,2)/(5,6) 行 × (1,6) 列四个角区，中腹两行全空
  const pos = new Set(t.blockers.map((b) => `${b.r},${b.c}`));
  for (const r of [1, 2, 5, 6]) for (const c of [1, 6]) assert.ok(pos.has(`${r},${c}`));
  for (const r of [3, 4]) assert.ok(t.blockers.every((b) => b.r !== r));
});

test('全图冰：冰块约半盘且只铺前 7 行，最底行全空', () => {
  const t = assertTerrain(ROGUE_BOSSES.frost_reverent);
  assert.ok(t.blockers.length >= 24 && t.blockers.length <= 28);
  assert.ok(t.blockers.every((b) => b.kind === 'ice' && b.r <= 6));
  for (let c = 0; c < 8; c += 1) assert.ok(!t.blockers.some((b) => b.r === 7 && b.c === c));
});

test('分仓石头阵：两道石墙（含缺口）+ 6 块散冰', () => {
  const t = assertTerrain(ROGUE_BOSSES.core_titan);
  const stones = t.blockers.filter((b) => b.kind === 'stone');
  const ices = t.blockers.filter((b) => b.kind === 'ice');
  assert.equal(stones.length, 12); // 两列 × (8 行 - 2 缺口)
  assert.equal(ices.length, 6);
  for (const c of [2, 5]) {
    for (const r of [2, 5]) assert.ok(!stones.some((b) => b.r === r && b.c === c), `墙在 ${r},${c} 应有缺口`);
  }
});

test('布阵确定：同 seed 两次结果完全一致，换 seed 散冰位置可不同', () => {
  const def = ROGUE_BOSSES.core_titan;
  const a = bossTerrain(def, createRng(7));
  const b = bossTerrain(def, createRng(7));
  assert.deepEqual(a.blockers, b.blockers);
});

test('阶段：血量首次降到阈值以下触发，且只触发一次', () => {
  const def = ROGUE_BOSSES.chain_warden;
  const state = createBossState(def, emptyBonus);
  const t = state.target;
  // 直接从满血打到 30%：两个阶段都应跨到
  const both = crossedPhases(def, state, 0, Math.round(t * 0.70) + 1);
  assert.equal(both.length, 2);
  // 停在同一血量不再触发
  assert.deepEqual(crossedPhases(def, state, Math.round(t * 0.70) + 1, Math.round(t * 0.70) + 1), []);
  // 继续打到 0 也不重复
  assert.deepEqual(crossedPhases(def, state, Math.round(t * 0.70) + 1, t), []);
});

test('阶段：小幅掉血不跨阈值时不触发；向上波动不触发', () => {
  const def = ROGUE_BOSSES.frost_reverent;
  const state = createBossState(def, emptyBonus);
  const t = state.target;
  assert.deepEqual(crossedPhases(def, state, 0, Math.floor(t * 0.1)), []); // 掉 10%，还在 66% 以上
  assert.deepEqual(crossedPhases(def, state, Math.floor(t * 0.5), Math.floor(t * 0.4)), []);
});

test('击败判定：伤害达到目标血量', () => {
  const def = ROGUE_BOSSES.core_titan;
  const state = createBossState(def, emptyBonus);
  assert.equal(isBossDefeated(state, state.target - 1), false);
  assert.equal(isBossDefeated(state, state.target), true);
  assert.equal(isBossDefeated(state, state.target + 999), true);
});

test('rollPerks 稀有度保底：精英必出 rare+，Boss 必出 epic，无保底池时回退不空', async () => {
  const { rollPerks, PERKS } = await import('../src/games/match3/rogue/perks.js');
  const rank = { common: 0, rare: 1, epic: 2 };
  for (const seed of [1, 2, 3, 4, 5]) {
    const rng = createRng(seed);
    const rarePick = rollPerks(rng, {}, null, { minRarity: 'rare' });
    assert.ok(rarePick.length > 0);
    assert.ok(rarePick.every((p) => rank[p.rarity] >= 1));
    const epicPick = rollPerks(createRng(seed + 100), {}, null, { minRarity: 'epic' });
    assert.ok(epicPick.every((p) => rank[p.rarity] >= 2));
  }
  // 只解锁一张 common：epic 保底池为空，回退全池仍给牌
  const onlyCommon = new Set(PERKS.filter((p) => p.rarity === 'common').slice(0, 1).map((p) => p.id));
  const fallback = rollPerks(createRng(9), {}, onlyCommon, { minRarity: 'epic' });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].rarity, 'common');
});

console.log(`\n全部通过：${passed} 个用例`);
