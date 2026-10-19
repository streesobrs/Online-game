/**
 * 遗物纯函数断言（开发方案 3.5，P3）
 * - 数据表：20 件、四组各 ≥4、稀有度分布、epic 才是改规则、协同描述点名
 * - 掉落：同 seed 复现、排除已拥有、池空返回 null、三选一不重复且不足时短路
 * - hook 分发：mods 聚合（含 shopDiscount 下限夹取）、onStep 每层上限、onFloorStart 只跑 perFloor、
 *   grant 改 bonus、缺字段静默跳过
 */
import assert from 'node:assert/strict';
import { ROGUE, ROGUE_RELIC } from '../src/games/match3/config/config.js';
import { createRng } from '../src/games/match3/engine/rng.js';
import { createBonus } from '../src/games/match3/rogue/perks.js';
import {
  RELICS, buildRelicHooks, grantOnAcquire, missingRelics, relicById, relicPriceMult,
  relicRollExtras, relicsByRarity, rollRelic, rollRelicChoices,
} from '../src/games/match3/rogue/relics.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

/** 假 board：只实现遗物用到的既有钩子，并记账供断言 */
function fakeBoard(mult = 2) {
  const calls = { moves: 0, specials: [], mults: [] };
  let cur = mult;
  return {
    calls,
    addMoves(n) { calls.moves += n; },
    addSpecials(list) { calls.specials.push(...list); },
    setScoreMult(x) { cur = x; calls.mults.push(x); },
    getState() { return { scoreMult: cur }; },
  };
}

const GROUP_IDS = ['chain', 'special', 'economy', 'survival'];

test('RELICS：id 唯一、字段完整、rarity/group 合法、max 恒为 1', () => {
  const ids = new Set();
  for (const r of RELICS) {
    assert.ok(!ids.has(r.id), `id 重复：${r.id}`);
    ids.add(r.id);
    assert.ok(r.icon && r.name, `${r.id} 缺图标/名称`);
    assert.ok(typeof r.desc === 'string' && r.desc.length > 0, `${r.id} 缺 desc`);
    assert.ok(['common', 'rare', 'epic'].includes(r.rarity), `${r.id} 稀有度非法`);
    assert.ok(GROUP_IDS.includes(r.group), `${r.id} 分组非法`);
    assert.equal(r.max, 1, `${r.id} 遗物不可叠加`);
    // grant / hook / mods 至少有一种，否则这件遗物没有任何效果
    assert.ok(
      r.grant || r.onStep || r.onUpdate || r.onGameOver || r.mods,
      `${r.id} 没有任何效果`,
    );
  }
  assert.ok(RELICS.length >= 18, '首发应 ≥18 件');
});

test('稀有度分布：common 9 / rare 7 / epic 4（可掉落池），图鉴分桶固定', () => {
  const by = relicsByRarity();
  assert.deepEqual(Object.keys(by), ['common', 'rare', 'epic']);
  assert.equal(by.common.length, 9);
  assert.equal(by.rare.length, 7);
  assert.equal(by.epic.length, 4);
  // 图鉴分桶 = 可掉落池（去掉角色专属被动，那两件只挂在角色身上，不进任何随机池）
  const rollable = RELICS.filter((r) => !r.characterOnly).length;
  assert.equal(by.common.length + by.rare.length + by.epic.length, rollable);
});

test('四组各 ≥4 件（可拼出 ≥4 种流派）', () => {
  for (const g of GROUP_IDS) {
    const n = RELICS.filter((r) => r.group === g).length;
    assert.ok(n >= 4, `${g} 只有 ${n} 件`);
  }
});

test('epic 才是改规则级：可掉落池里的 epic 都有机制，且至少一件 perFloor / 一件 onStep', () => {
  const epics = RELICS.filter((r) => r.rarity === 'epic' && !r.characterOnly);
  for (const r of epics) {
    assert.ok(r.grant || r.onStep || r.onUpdate || r.mods, `${r.id} 应有改规则效果`);
  }
  // 「每层开局白送 1 个彩球」类（perFloor）与「连锁阈值下调」类（onStep）各至少一件
  assert.ok(epics.some((r) => r.perFloor), 'epic 应含 perFloor 改规则件');
  assert.ok(epics.some((r) => typeof r.onStep === 'function'), 'epic 应含 onStep 改规则件');
});

test('角色专属被动（characterOnly）：不进任何随机池，只由 startRelics 注入', () => {
  const own = RELICS.filter((r) => r.characterOnly).map((r) => r.id);
  assert.ok(own.length >= 2, '首发至少 2 件角色被动遗物');
  for (const id of own) {
    // 单抽绝不能掷到它
    for (let seed = 0; seed < 50; seed += 1) {
      const r = rollRelic(createRng(seed), []);
      assert.ok(!r || r.id !== id, `random 抽到了角色专属：${id}`);
    }
    // 缺失池与图鉴也不含它（它不是「可收集」的遗物）
    assert.ok(!missingRelics([]).some((r) => r.id === id), `${id} 出现在缺失池`);
    assert.ok(!Object.values(relicsByRarity()).flat().some((r) => r.id === id), `${id} 出现在图鉴`);
  }
  // 显式指定 id 时仍能编译出 hook（grantRelic 走的是这条）
  assert.equal(relicById(own[0]).id, own[0]);
});

test('协同组合：至少 2 处 desc 点名流派（连锁永动 / 彩球清屏）', () => {
  assert.ok(RELICS.filter((r) => r.desc.includes('=')).length >= 2);
  assert.ok(RELICS.some((r) => r.desc.includes('连锁永动')));
  assert.ok(RELICS.some((r) => r.desc.includes('彩球清屏')));
  // 点名要引用到真实存在的祝福 / 遗物名，避免写错名导致引导失效
  const known = new Set(RELICS.map((r) => r.name));
  assert.ok(RELICS.some((r) => r.desc.includes('同色磁石') || r.desc.includes('极简主义')));
  assert.ok(known.has('无尽锁链') && known.has('棱镜种子'));
});

test('relicById / missingRelics / relicsByRarity 不修改入参', () => {
  assert.equal(relicById('coupon').name, '优惠券');
  assert.equal(relicById('no_such_relic'), null);

  const owned = ['coupon', 'haggler'];
  const snapshot = [...owned];
  const missing = missingRelics(owned);
  // 缺失池只统计可掉落遗物（角色专属被动不进随机池）
  assert.equal(missing.length, RELICS.filter((r) => !r.characterOnly).length - 2);
  assert.ok(!missing.some((r) => owned.includes(r.id)));
  assert.deepEqual(owned, snapshot, 'missingRelics 不应改入参');
});

test('rollRelic：同 seed 可复现（1 件与三选一都稳定）', () => {
  assert.equal(rollRelic(createRng(7), []).id, rollRelic(createRng(7), []).id);
  const a = rollRelicChoices(createRng(99), []).map((r) => r.id);
  const b = rollRelicChoices(createRng(99), []).map((r) => r.id);
  assert.deepEqual(a, b);
});

test('rollRelic：排除已拥有，且不改入参', () => {
  const owned = ['coupon', 'haggler', 'miser'];
  const snapshot = [...owned];
  for (let seed = 0; seed < 30; seed += 1) {
    const r = rollRelic(createRng(seed), owned);
    assert.ok(r && !owned.includes(r.id), `抽到已拥有：${r && r.id}`);
  }
  assert.deepEqual(owned, snapshot);
});

test('rollRelic：按 dropWeights 加权（common 明显多于 epic）', () => {
  let common = 0;
  let epic = 0;
  for (let seed = 0; seed < 400; seed += 1) {
    const r = rollRelic(createRng(seed), []);
    if (r.rarity === 'common') common += 1;
    if (r.rarity === 'epic') epic += 1;
  }
  assert.ok(common > epic, `common=${common} epic=${epic}`);
});

test('rollRelic：opts.rarity 只出该稀有度', () => {
  for (let seed = 0; seed < 30; seed += 1) {
    assert.equal(rollRelic(createRng(seed), [], { rarity: 'epic' }).rarity, 'epic');
  }
});

test('rollRelic：池空返回 null（全抽完 / 稀有度不存在），绝不抛错', () => {
  assert.equal(rollRelic(createRng(1), RELICS.map((r) => r.id)), null);
  assert.equal(rollRelic(createRng(1), [], { rarity: 'legendary' }), null);
});

test('rollRelicChoices：不重复、长度 = count，且不改入参', () => {
  const owned = [];
  const picks = rollRelicChoices(createRng(3), owned);
  assert.equal(picks.length, ROGUE_RELIC.choices);
  assert.equal(new Set(picks.map((r) => r.id)).size, picks.length);
  assert.deepEqual(owned, []);
});

test('rollRelicChoices：池子不足时返回少于 count 且不重复、不报错', () => {
  const all = RELICS.map((r) => r.id);
  const ownAllBut2 = all.filter((id) => id !== 'coupon' && id !== 'haggler');
  const short = rollRelicChoices(createRng(5), ownAllBut2, 3);
  assert.equal(short.length, 2);
  assert.deepEqual(short.map((r) => r.id).sort(), ['coupon', 'haggler']);
});

test('buildRelicHooks：mods 聚合（乘性相乘、加性相加）', () => {
  const base = buildRelicHooks([]).mods;
  assert.deepEqual(base, {
    shopDiscount: 1, moveRefundMult: 1, goldMult: 1, extraChoices: 0, rerolls: 0, shieldBonus: 0,
  });

  const gold = buildRelicHooks(['gold_vein', 'miser']).mods;
  assert.ok(Math.abs(gold.goldMult - 1.3 * 1.6) < 1e-9);

  const extra = buildRelicHooks(['wide_choice', 'reroll_token']).mods;
  assert.equal(extra.extraChoices, 1);
  assert.equal(extra.rerolls, 1);
});

test('buildRelicHooks：shopDiscount 下限夹到 0.5（优惠券 ×0.8 × 砍价 0.6 = 0.48 → 0.5）', () => {
  assert.equal(buildRelicHooks(['coupon']).mods.shopDiscount, 0.8);
  assert.equal(buildRelicHooks(['coupon', 'haggler']).mods.shopDiscount, 0.5);
  // 守财奴是刻意的涨价件（>1），不受「下限」影响
  assert.ok(buildRelicHooks(['miser']).mods.shopDiscount > 1);
});

test('onStep：每层触发次数受 ctx.used 上限约束（无尽锁链最多 3 次）', () => {
  const ctx = { board: fakeBoard(), bonus: createBonus(), used: {} };
  const hooks = buildRelicHooks(['infinite_chain']);
  for (let i = 0; i < 6; i += 1) hooks.onStep(ctx, { cascade: 4, gained: 100 });
  assert.equal(ctx.board.calls.moves, 3);
  assert.equal(ctx.used.infinite_chain, 3);
});

test('onStep：连锁涌流改倍率（×1.5，每层 2 次）与回响爆破造炸弹', () => {
  const ctx = { board: fakeBoard(2), bonus: createBonus(), used: {} };
  const hooks = buildRelicHooks(['chain_surge']);
  for (let i = 0; i < 3; i += 1) hooks.onStep(ctx, { cascade: 5, gained: 100 });
  assert.deepEqual(ctx.board.calls.mults, [3, 4.5]); // 2→3→4.5，第 3 次被上限挡住

  const boom = { board: fakeBoard(), bonus: createBonus(), used: {} };
  const bh = buildRelicHooks(['echo_bomb']);
  for (let i = 0; i < 3; i += 1) bh.onStep(boom, { cascade: 4, gained: 0 });
  assert.equal(boom.board.calls.specials.length, 2);
  assert.ok(boom.board.calls.specials.every((s) => s.kind === 'bomb' && s.count === 1));
});

test('onUpdate：累计消除跨阈值造炸弹（爆破税，每 20 个 1 颗）', () => {
  const ctx = { board: fakeBoard(), bonus: createBonus(), used: {} };
  const hooks = buildRelicHooks(['bomb_tithe']);
  hooks.onUpdate(ctx, { collected: { 1: 15 } });
  assert.equal(ctx.board.calls.specials.length, 0);
  hooks.onUpdate(ctx, { collected: { 1: 25 } }); // 累计 25 → 跨过 20
  assert.equal(ctx.board.calls.specials.length, 1);
  assert.equal(ctx.board.calls.specials[0].kind, 'bomb');
});

test('onFloorStart：只重放 perFloor 类（once 类不在这里叠加）且幂等', () => {
  const ctx = { bonus: createBonus() };
  const hooks = buildRelicHooks(['prism_seed', 'floor_ward', 'coupon', 'momentum']);
  hooks.onFloorStart(ctx);
  assert.equal(ctx.bonus.specials.rainbow, 1);   // prism_seed（perFloor）
  assert.equal(ctx.bonus.shields, 1);            // floor_ward（perFloor）
  assert.equal(ctx.bonus.moves, 0);              // momentum 是 once，不在这里跑
  assert.equal(ctx.bonus.goalCut, 0);
  hooks.onFloorStart(ctx);                       // 重放不叠加
  assert.equal(ctx.bonus.specials.rainbow, 1);
  assert.equal(ctx.bonus.shields, 1);
});

test('grantOnAcquire：只结算 once 类，perFloor 类不触发', () => {
  const ctx = { bonus: createBonus() };
  grantOnAcquire('momentum', ctx);
  assert.equal(ctx.bonus.moves, 2);
  assert.ok(Math.abs(ctx.bonus.goalCut + 0.08) < 1e-9);

  const before = ctx.bonus.specials.rainbow;
  grantOnAcquire('prism_seed', ctx); // perFloor 件：获得时不该结算
  assert.equal(ctx.bonus.specials.rainbow, before);
});

test('onGameOver：壁垒之盾每层首次补步，且每层仅 1 次；缺 board 时安全返回 false', () => {
  const ctx = { board: fakeBoard(), bonus: createBonus(), used: {} };
  const hooks = buildRelicHooks(['guardian_ward']);
  assert.equal(hooks.onGameOver(ctx), true);
  assert.equal(ctx.board.calls.moves, ROGUE.shieldMoves);
  assert.equal(ctx.used.guardian_ward, 1);
  assert.equal(hooks.onGameOver(ctx), false); // 每层一次，再来就不兜底了
  // 没有 board（层间 / 空 ctx）：不能误判为已处理，交给护盾 / 时光倒流
  assert.equal(buildRelicHooks(['guardian_ward']).onGameOver({ used: {} }), false);
  // 没带这件遗物时永远 false
  assert.equal(buildRelicHooks(['coupon']).onGameOver({ board: fakeBoard(), used: {} }), false);
});

test('缺字段静默跳过：ctx/step/info 为空对象时不抛错', () => {
  const hooks = buildRelicHooks(RELICS.map((r) => r.id));
  assert.doesNotThrow(() => hooks.onStep({}, {}));
  assert.doesNotThrow(() => hooks.onUpdate({}, { maxCascade: 6, movesLeft: 1, collected: {} }));
  assert.doesNotThrow(() => hooks.onUpdate({}, null));
  assert.doesNotThrow(() => hooks.onFloorStart({}));
  assert.doesNotThrow(() => grantOnAcquire('momentum', {}));
  assert.equal(rollRelic(null, []), null); // 没有 rng 也不抛，直接返回 null
});

test('便捷导出：relicPriceMult 读 shopDiscount，relicRollExtras 读选项与重随', () => {
  assert.equal(relicPriceMult(['coupon']), 0.8);
  assert.equal(relicPriceMult([]), 1);
  assert.deepEqual(relicRollExtras(['wide_choice', 'reroll_token']), { extraChoices: 1, rerolls: 1 });
  assert.deepEqual(relicRollExtras([]), { extraChoices: 0, rerolls: 0 });
});

console.log(`\n全部通过：${passed} 个用例`);
