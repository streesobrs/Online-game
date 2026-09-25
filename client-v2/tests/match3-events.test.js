/**
 * 随机事件（问号房）纯函数断言（开发方案 3.4，P2）
 *
 * 覆盖：
 * - 事件数据完整性：id 唯一、条数、2–3 个选项、恒有「离开」项、when 类型、文案非空
 * - 深度加权抽取：浅层抽不到深层事件、11 层后赌博类重事件才进池、maxDepth 退场
 * - 复现性：同 seed 的抽取序列逐次一致
 * - availableChoices：金币/遗物前置过滤、全过滤回退「离开」、when 抛错不崩
 * - applyChoice：正常结算 + resultText 兜底 + 非法 index 不抛错
 * - 硬规则「坏结果不判死」：重复扣步被夹在安全范围，无删档类选项
 * - 源码禁用 Math.random（赌博一律走注入的 rng）
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROGUE } from '../src/games/match3/config/config.js';
import { createRng } from '../src/games/match3/engine/rng.js';
import {
  EVENTS, EVENT_DEPTH_MAX, rollEvent, availableChoices, applyChoice, isLeaveChoice,
} from '../src/games/match3/rogue/events.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const SRC = readFileSync(fileURLToPath(new URL('../src/games/match3/rogue/events.js', import.meta.url)), 'utf8');
/** bonus.moves 的安全下限：与 events.js 内部一致（基准 10 步，扣到 −4 时下一层仍有 6 步） */
const SAFE_MOVE_FLOOR = 6 - ROGUE.movesPerFloor;

/**
 * 事件 ctx 的测试替身（对齐冻结的 ctx 接口）
 * removeRelic 是遗物模块（P3）才有的可选方法，这里提供以覆盖 cracked_idol 的正常分支
 */
function makeCtx(over = {}) {
  const rng = over.rng || createRng(over.seed ?? 1);
  const bonus = { moves: over.moves ?? 0, shields: over.shields ?? 0 };
  const s = { coins: over.coins ?? 0, relics: (over.relics || []).slice(), picks: {} };
  const ctx = {
    rng,
    floor: over.depth ?? 1,
    depth: over.depth ?? 1,
    bonus,
    picks: s.picks,
    getCoins: () => s.coins,
    addCoins: (n) => { s.coins = Math.max(0, s.coins + n); return s.coins; },
    getRelics: () => s.relics.slice(),
    hasRelic: (id) => s.relics.includes(id),
    grantRelic: (spec) => {
      const id = spec === 'random'
        ? `relic_random_${s.relics.length}`
        : (spec.id || `relic_${spec.rarity || 'common'}`);
      s.relics.push(id);
      return id;
    },
    addMoves: (n) => { bonus.moves += n; return bonus.moves; },
    addShield: (n) => { bonus.shields = Math.max(0, bonus.shields + n); return bonus.shields; },
    grantPerk: (opts = {}) => {
      const id = `perk_${opts.rarity || opts.minRarity || 'common'}`;
      s.picks[id] = (s.picks[id] || 0) + 1;
      return { id };
    },
    banPerk: (id) => { delete s.picks[id]; },
    toast: () => {},
    removeRelic: (id) => {
      const i = s.relics.indexOf(id);
      if (i >= 0) s.relics.splice(i, 1);
    },
  };
  return { ctx, bonus, state: s };
}

/** 计数用 rng：统计一次选项执行里 ctx.rng.next() 被调用了几次 */
function probeRng(seed) {
  const base = createRng(seed);
  const box = { calls: 0 };
  const rng = { ...base, next() { box.calls += 1; return base.next(); } };
  return { rng, box };
}

// ---------------------------------------------------------------- 数据完整性

test('事件表：id 唯一、条数在 12–14', () => {
  assert.ok(EVENTS.length >= 12 && EVENTS.length <= 14, `事件条数 ${EVENTS.length}`);
  const ids = new Set(EVENTS.map((e) => e.id));
  assert.equal(ids.size, EVENTS.length, 'id 必须唯一');
});

test('每个事件字段完整：图标/权重/文案/深度合法', () => {
  for (const e of EVENTS) {
    assert.ok(typeof e.id === 'string' && e.id, '缺 id');
    assert.ok(typeof e.icon === 'string' && e.icon.length > 0, `${e.id} 缺 icon`);
    assert.ok(e.weight > 0, `${e.id} weight 非法`);
    assert.ok(Number.isInteger(e.minDepth) && e.minDepth >= 1, `${e.id} minDepth 非法`);
    assert.ok(e.minDepth <= EVENT_DEPTH_MAX, `${e.id} minDepth 超出事件深度上限`);
    assert.ok(e.maxDepth == null || e.maxDepth >= e.minDepth, `${e.id} maxDepth 非法`);
    assert.ok(typeof e.text === 'string' && e.text.length >= 10, `${e.id} 情境文案过短`);
  }
  assert.ok(EVENT_DEPTH_MAX >= 30, '事件系统需覆盖无尽深渊段');
});

test('每个事件 2–3 个选项，文案非空、apply 是函数、when 为函数或缺省', () => {
  for (const e of EVENTS) {
    assert.ok(e.choices.length >= 2 && e.choices.length <= 3, `${e.id} 选项数 ${e.choices.length}`);
    for (const c of e.choices) {
      assert.ok(typeof c.text === 'string' && c.text.length > 0, `${e.id} 选项文案为空`);
      assert.equal(typeof c.apply, 'function', `${e.id} 选项缺 apply`);
      assert.ok(c.when == null || typeof c.when === 'function', `${e.id} when 类型非法`);
    }
  }
});

test('每条事件都有「离开」选项，且四类选项（增益/赌博/零和/离开）齐备', () => {
  let gamble = 0;
  let coinCost = 0;
  let moveOrShieldCost = 0;
  let leave = 0;
  for (const e of EVENTS) {
    assert.ok(e.choices.some(isLeaveChoice), `${e.id} 缺「离开」选项`);
    for (const c of e.choices) {
      if (isLeaveChoice(c)) { leave += 1; continue; }
      const probe = makeCtx({ coins: 500, shields: 1, relics: ['r1'], depth: e.minDepth, rng: probeRng(3).rng });
      const before = { coins: probe.state.coins, moves: probe.bonus.moves, shields: probe.bonus.shields };
      c.apply(probe.ctx);
      if (probe.bonus.moves < before.moves || probe.bonus.shields < before.shields) moveOrShieldCost += 1;
      if (probe.state.coins < before.coins) coinCost += 1;
    }
    // 赌博类：单独用计数 rng 跑一遍，看是否消耗随机数
    for (const c of e.choices) {
      if (isLeaveChoice(c)) continue;
      const { rng, box } = probeRng(5);
      c.apply(makeCtx({ coins: 500, shields: 1, relics: ['r1'], depth: e.minDepth, rng }).ctx);
      if (box.calls > 0) gamble += 1;
    }
  }
  assert.equal(leave, EVENTS.length, '每个事件恰有一条离开选项');
  assert.ok(gamble >= 4, `赌博类选项偏少：${gamble}`);
  assert.ok(coinCost >= 3, `金币代价选项偏少：${coinCost}`);
  assert.ok(moveOrShieldCost >= 3, `步数/护盾代价选项偏少：${moveOrShieldCost}`);
});

// ---------------------------------------------------------------- 抽取

test('rollEvent 深度过滤：第 1 层只出温和的 quiet_camp', () => {
  const rng = createRng(2024);
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) {
    const e = rollEvent(rng, { depth: 1, coins: 0, relics: [], picks: {} });
    assert.ok(e, '第 1 层应能抽到事件');
    assert.ok(e.minDepth <= 1, `第 1 层抽到了 minDepth=${e.minDepth} 的事件`);
    assert.notEqual(e.id, 'cursed_altar');
    seen.add(e.id);
  }
  assert.deepEqual([...seen], ['quiet_camp']);
});

test('rollEvent：11 层后赌博重事件进池，浅层事件按 maxDepth 退场', () => {
  const rng = createRng(99);
  const hits = {};
  for (let i = 0; i < 2000; i += 1) {
    const e = rollEvent(rng, { depth: 12 });
    assert.ok(e.minDepth <= 12, `12 层抽到 minDepth=${e.minDepth}`);
    assert.ok(e.maxDepth == null || e.maxDepth >= 12, `${e.id} 不该在 12 层出现`);
    hits[e.id] = (hits[e.id] || 0) + 1;
  }
  assert.ok(hits.cursed_altar > 0, '12 层应能抽到 cursed_altar（minDepth=11）');
  assert.equal(hits.quiet_camp, undefined, 'quiet_camp 的 maxDepth=8，12 层不应出现');
  assert.equal(hits.whispering_obelisk, undefined, 'minDepth=13 的事件不该在 12 层出现');
});

test('rollEvent 无可用事件时返回 null（不抛错）', () => {
  assert.equal(rollEvent(createRng(1), { depth: 0 }), null);
  assert.equal(rollEvent(createRng(1), {}), null);
  assert.equal(rollEvent(createRng(1), { depth: -5 }), null);
});

test('rollEvent 同 seed 可复现：200 次抽取逐次一致', () => {
  const a = createRng(7);
  const b = createRng(7);
  const st = { depth: 14, coins: 50, relics: [], picks: {} };
  for (let i = 0; i < 200; i += 1) {
    assert.equal(rollEvent(a, st).id, rollEvent(b, st).id);
  }
});

// ---------------------------------------------------------------- 选项过滤

test('availableChoices 按金币阈值过滤（买不起的选项不出现在事件卡上）', () => {
  const ev = EVENTS.find((e) => e.id === 'lost_caravan');
  const poor = availableChoices(ev, { depth: 5, coins: 0, relics: [], picks: {} });
  assert.equal(poor.length, 2);
  assert.ok(poor.every((c) => c.when == null));
  assert.equal(availableChoices(ev, { coins: 100 }).length, 3);
  // 金币正好等于阈值即视为买得起
  assert.equal(availableChoices(ev, { coins: 40 }).length, 3);
  assert.equal(availableChoices(ev, { coins: 39 }).length, 2);
});

test('availableChoices：金币/遗物前置条件都生效（cracked_idol）', () => {
  const ev = EVENTS.find((e) => e.id === 'cracked_idol');
  assert.equal(availableChoices(ev, { coins: 0, relics: [] }).length, 1); // 全被过滤 → 只剩离开
  assert.equal(availableChoices(ev, { coins: 20, relics: [] }).length, 2);
  assert.equal(availableChoices(ev, { coins: 0, relics: ['r1'] }).length, 2);
  assert.equal(availableChoices(ev, { coins: 20, relics: ['r1'] }).length, 3);
});

test('availableChoices 全部被过滤时回退「离开」，无 leave 项时回退第一项', () => {
  const allFiltered = {
    id: 'syn_filtered',
    choices: [
      { text: '买不起的东西', when: () => false, apply: () => {} },
      { text: '离开', apply: () => '' },
    ],
  };
  const fallback = availableChoices(allFiltered, { coins: 0 });
  assert.equal(fallback.length, 1);
  assert.ok(isLeaveChoice(fallback[0]));

  const noLeave = {
    id: 'syn_no_leave',
    choices: [
      { text: '甲', when: () => false, apply: () => {} },
      { text: '乙', when: () => false, apply: () => {} },
    ],
  };
  assert.deepEqual(availableChoices(noLeave, {}), [noLeave.choices[0]]);
});

test('availableChoices：when 抛错按不可用处理，不拖垮整张事件卡', () => {
  const ev = {
    id: 'syn_throw',
    choices: [
      { text: '坏 when', when: () => { throw new Error('boom'); }, apply: () => {} },
      { text: '好 when', when: () => true, apply: () => {} },
      { text: '离开', apply: () => {} },
    ],
  };
  const av = availableChoices(ev, {});
  assert.equal(av.length, 2);
  assert.ok(!av.includes(ev.choices[0]));
});

// ---------------------------------------------------------------- 结算

test('applyChoice 执行选项并返回结果文案；无返回值时用 resultText 兜底', () => {
  const ev = EVENTS.find((e) => e.id === 'mossy_spring');
  const { ctx, bonus } = makeCtx({ coins: 100, depth: 3 });
  const r = applyChoice(ev, 0, ctx);
  assert.equal(r.ok, true);
  assert.ok(r.text.length > 0);
  assert.equal(bonus.moves, 3); // mossy_spring 选项 0：下一层起手 +3 步

  const synth = {
    id: 'syn_text',
    choices: [{ text: '结果由 resultText 提供', apply() { return undefined; }, resultText: '兜底文案' }],
  };
  assert.deepEqual(applyChoice(synth, 0, ctx), { ok: true, text: '兜底文案' });
});

test('applyChoice 非法 index 不抛错，返回 { ok:false, text:"" }', () => {
  const ev = EVENTS[0];
  const { ctx } = makeCtx();
  for (const bad of [-1, 99, 1.5, NaN, undefined, '0', null]) {
    assert.deepEqual(applyChoice(ev, bad, ctx), { ok: false, text: '' });
  }
});

// ---------------------------------------------------------------- 硬规则：坏结果不判死

test('坏结果不判死：重复扣步被夹在安全范围，bonus.moves 不会压垮下一层', () => {
  const ev = EVENTS.find((e) => e.id === 'carrion_pit'); // 选项 0：+35 金币，下一层 −4 步
  const { ctx, bonus } = makeCtx({ coins: 0, depth: 12 });
  for (let i = 0; i < 30; i += 1) {
    const before = bonus.moves;
    assert.equal(applyChoice(ev, 0, ctx).ok, true);
    assert.ok(before - bonus.moves <= 4, '单次事件扣步超过 4 步');
    assert.ok(bonus.moves >= SAFE_MOVE_FLOOR, `bonus.moves 被压到 ${bonus.moves}，低于安全下限`);
  }
  assert.ok(ROGUE.movesPerFloor + bonus.moves >= 6, '下一层起手步数不足以进行');
});

test('无删档/清空 build 类选项，且所有选项在完整 ctx 下都能安全执行', () => {
  for (const e of EVENTS) {
    for (let i = 0; i < e.choices.length; i += 1) {
      const c = e.choices[i];
      assert.ok(!/删档|清空|重置整轮|抹除|删除存档|清空 build/i.test(c.text), `${e.id} 出现删档类文案`);
      const probe = makeCtx({ coins: 500, shields: 1, relics: ['r1'], depth: e.minDepth, seed: 11 });
      const r = applyChoice(e, i, probe.ctx);
      assert.equal(r.ok, true, `${e.id} 选项 ${i} 执行失败`);
      assert.ok(probe.bonus.moves >= SAFE_MOVE_FLOOR, `${e.id} 选项 ${i} 把步数压破下限`);
      assert.ok(probe.bonus.shields >= 0, `${e.id} 选项 ${i} 把护盾压成负数`);
      assert.ok(probe.state.coins >= 0, `${e.id} 选项 ${i} 把金币压成负数`);
    }
  }
});

test('源码禁用 Math.random：赌博一律走注入的 ctx.rng', () => {
  assert.ok(!/Math\.random/.test(SRC), 'events.js 不得出现 Math.random');
  assert.ok(/ctx\.rng\.next\(\)/.test(SRC), '赌博类选项必须走 ctx.rng.next()');
});

console.log(`\n全部通过：${passed} 个用例`);
