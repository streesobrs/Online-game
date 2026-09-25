/**
 * 局内商店（开发方案 3.6，P4）纯函数断言
 *
 * 覆盖：
 * - rollShelf：格数恒为 config.ROGUE_GOLD.shopSlots、同 seed 可复现、只读 state
 * - 上架过滤：bannedPerkIds 不上架、已持有遗物不上架（random 位除外）、叠满祝福不上架、
 *   allowedPerkIds 白名单外的未解锁祝福不上架
 * - 移除格：默认恒有 1 格、removedThisRun >= 2 时消失
 * - 价格：priceOf 缺省等于 config 基准价、折扣按 Math.round、shelfWithPrices 不改入参
 * - 购买：sold / poor 拒绝；成功扣费正确；随机遗物掷空半价返还；服务钩子与降级
 * - 封禁：正常（扣费 + banPerk + removePerk + 返还）、nope / poor 拒绝
 * - 刷新：limit / poor / 成功三条路径（含折扣）
 * - 空 ctx（{}）调 buyItem / removePerk 不抛错
 * - 源码禁用 Math.random（随机一律走注入的 rng）
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ROGUE_GOLD } from '../src/games/match3/config/config.js';
import { createRng } from '../src/games/match3/engine/rng.js';
import { PERKS } from '../src/games/match3/rogue/perks.js';
import { RELICS } from '../src/games/match3/rogue/relics.js';
import {
  rollShelf, priceOf, shelfWithPrices, buyItem, removePerk, refreshShelf, SERVICE_KINDS,
} from '../src/games/match3/rogue/shop.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const SRC = readFileSync(fileURLToPath(new URL('../src/games/match3/rogue/shop.js', import.meta.url)), 'utf8');

/** 基础 run 快照 */
function baseState(over = {}) {
  return {
    depth: 5,
    coins: 0,
    picks: {},
    relics: [],
    bannedPerkIds: [],
    removedThisRun: 0,
    ...over,
  };
}

/**
 * 商店 ctx 的测试替身（对齐冻结的 ctx 接口）
 * 用 bal 记录余额、log 记录钩子调用，便于断言扣费与副作用
 */
function makeCtx(over = {}) {
  const bal = { coins: over.coins ?? 0 };
  const relics = (over.relics || []).slice();
  const picks = { ...(over.picks || {}) };
  const log = { grants: [], shields: 0, moves: 0, movesNext: 0, rerolls: [], banned: [], removed: [] };
  const ctx = {
    rng: over.rng || createRng(over.seed ?? 1),
    floor: 1,
    depth: 1,
    picks,
    getCoins: () => bal.coins,
    addCoins: (n) => { bal.coins = Math.max(0, bal.coins + n); return bal.coins; },
    getRelics: () => relics.slice(),
    hasRelic: (id) => relics.includes(id),
    grantRelic: (spec) => {
      const id = spec && spec.id ? spec.id : 'relic_random';
      relics.push(id);
      log.grants.push(id);
      return id;
    },
    grantPerk: (opts = {}) => {
      const id = opts.id || `perk_${opts.rarity || 'common'}`;
      picks[id] = (picks[id] || 0) + 1;
      return { id };
    },
    addMoves: (n) => { log.moves += n; return n; },
    addMovesNextFloor: (n) => { log.movesNext += n; return n; },
    addShield: (n) => { log.shields += n; return log.shields; },
    // addReroll 故意不提供：覆盖「缺钩子也照样标记已售出」的分支
    banPerk: (id) => { log.banned.push(id); delete picks[id]; },
    removePerk: (id) => { log.removed.push(id); },
    toast: () => {},
  };
  return { ctx, bal, log, picks, relics };
}

// ---------------------------------------------------------------- 货架生成

test('rollShelf 格数 = config.ROGUE_GOLD.shopSlots，且同 seed 完全可复现', () => {
  const state = baseState();
  const a = rollShelf(createRng(1234), state);
  const b = rollShelf(createRng(1234), state);
  assert.equal(a.length, ROGUE_GOLD.shopSlots);
  assert.deepEqual(a, b, '同 seed 必须逐格一致');
  // 组合合理：至少 1 个祝福、1 个遗物、1 个服务、1 个移除
  for (const kind of ['perk', 'relic', 'service', 'remove']) {
    assert.ok(a.some((it) => it.kind === kind), `缺少 ${kind} 格`);
  }
});

test('rollShelf 只读入参 state，不修改它', () => {
  const state = baseState({ picks: { focus: 1 }, relics: [RELICS[0].id] });
  const snapshot = JSON.parse(JSON.stringify(state));
  rollShelf(createRng(77), state);
  assert.deepEqual(state, snapshot, 'rollShelf 不得改动 state');
});

test('货架恒含 1 个移除格，价格取 config.ROGUE_GOLD.removeCost', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const shelf = rollShelf(createRng(seed), baseState());
    const removes = shelf.filter((it) => it.kind === 'remove');
    assert.equal(removes.length, 1);
    assert.equal(removes[0].price, ROGUE_GOLD.removeCost);
    assert.equal(removes[0].sold, false);
  }
});

test('bannedPerkIds 里的祝福绝不上架', () => {
  const banned = ['supply', 'focus'];
  for (let seed = 1; seed <= 40; seed += 1) {
    const shelf = rollShelf(createRng(seed), baseState({ bannedPerkIds: banned }));
    assert.ok(shelf.every((it) => it.kind !== 'perk' || !banned.includes(it.perkId)),
      `seed=${seed} 上架了被封禁的祝福`);
  }
});

test('已持有遗物不上架（random 高价位除外）', () => {
  const owned = RELICS.slice(0, 5).map((r) => r.id);
  for (let seed = 1; seed <= 40; seed += 1) {
    const shelf = rollShelf(createRng(seed), baseState({ relics: owned }));
    const specific = shelf.filter((it) => it.kind === 'relic' && it.random !== true);
    assert.ok(specific.every((it) => !owned.includes(it.relicId)),
      `seed=${seed} 上架了已持有的遗物`);
  }
});

test('叠满的祝福不上架，且货架仍补齐到 5 格', () => {
  const maxed = {};
  for (const p of PERKS) maxed[p.id] = p.max;
  const shelf = rollShelf(createRng(66), baseState({ picks: maxed }));
  assert.ok(shelf.every((it) => it.kind !== 'perk'), '叠满的祝福不该上架');
  assert.equal(shelf.length, ROGUE_GOLD.shopSlots);
});

test('allowedPerkIds 白名单外的祝福不上架（与三选一池同口径）', () => {
  // 只解锁前两条：无论怎么掷，货架上的祝福都只能落在这两条里
  const allowed = PERKS.slice(0, 2).map((p) => p.id);
  for (let seed = 1; seed <= 40; seed += 1) {
    const shelf = rollShelf(createRng(seed), baseState({ allowedPerkIds: allowed }));
    assert.ok(shelf.every((it) => it.kind !== 'perk' || allowed.includes(it.perkId)),
      `seed=${seed} 上架了未解锁的祝福`);
    assert.equal(shelf.length, ROGUE_GOLD.shopSlots, '白名单过滤后仍要补齐格数');
  }
  // 空白名单（一个祝福都没解锁）→ 一格祝福都不上架，依然补满
  const empty = rollShelf(createRng(5), baseState({ allowedPerkIds: [] }));
  assert.ok(empty.every((it) => it.kind !== 'perk'));
  assert.equal(empty.length, ROGUE_GOLD.shopSlots);
});

test('removedThisRun >= 2 时不再出现移除格，格数依然为 5', () => {
  const shelf = rollShelf(createRng(9), baseState({ removedThisRun: 2 }));
  assert.equal(shelf.filter((it) => it.kind === 'remove').length, 0);
  assert.equal(shelf.length, ROGUE_GOLD.shopSlots);
});

// ---------------------------------------------------------------- 价格

test('priceOf 缺省时与 config 基准价逐位一致', () => {
  assert.equal(priceOf({ kind: 'perk', rarity: 'common' }), ROGUE_GOLD.priceByRarity.common);
  assert.equal(priceOf({ kind: 'perk', rarity: 'epic' }), ROGUE_GOLD.priceByRarity.epic);
  assert.equal(priceOf({ kind: 'relic', rarity: 'rare' }), ROGUE_GOLD.relicPrice.rare);
  assert.equal(priceOf({ kind: 'service', service: 'moves' }), ROGUE_GOLD.movesPrice);
  assert.equal(priceOf({ kind: 'service', service: 'shield' }), ROGUE_GOLD.shieldPrice);
  assert.equal(priceOf({ kind: 'service', service: 'reroll' }), ROGUE_GOLD.rerollPrice);
  assert.equal(priceOf({ kind: 'remove' }), ROGUE_GOLD.removeCost);
  // 货架上每一格的 price 就是基准价（mods 缺省时两者逐位一致）
  for (const it of rollShelf(createRng(21), baseState())) {
    assert.equal(priceOf(it), it.price, `${it.kind} 的基准价应与 config 一致`);
  }
});

test('priceOf 折扣按 Math.round 计算，并保底 1 金币', () => {
  const mods = { shopDiscount: ROGUE_GOLD.discountMult }; // 0.8
  assert.equal(priceOf({ kind: 'perk', rarity: 'epic' }, mods),
    Math.round(ROGUE_GOLD.priceByRarity.epic * ROGUE_GOLD.discountMult));
  assert.equal(priceOf({ kind: 'remove' }, mods),
    Math.round(ROGUE_GOLD.removeCost * ROGUE_GOLD.discountMult));
  assert.equal(priceOf({ kind: 'service', service: 'moves' }, { shopDiscount: 0 }), 1);
});

test('shelfWithPrices 返回带最终价的副本，且不改入参', () => {
  const items = rollShelf(createRng(31), baseState());
  const snapshot = JSON.parse(JSON.stringify(items));
  const priced = shelfWithPrices(items, { shopDiscount: 0.8 });
  assert.deepEqual(items, snapshot, 'shelfWithPrices 不得改动入参');
  assert.notEqual(priced, items);
  assert.deepEqual(priced.map((p) => p.price), snapshot.map((c) => Math.max(1, Math.round(c.price * 0.8))));
  assert.ok(priced.every((p) => p.sold === false));
});

// ---------------------------------------------------------------- 购买

test('buyItem：已售出的格位优先拒绝（sold），且优先级高于 poor', () => {
  const item = { kind: 'perk', perkId: 'focus', rarity: 'rare', price: 80, sold: true };
  const { ctx, bal } = makeCtx({ coins: 0 });
  const r = buyItem(ctx, item);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'sold');
  assert.equal(bal.coins, 0);
});

test('buyItem：金币不足拒绝（poor），不扣钱、不卖出', () => {
  const item = { kind: 'perk', perkId: 'focus', rarity: 'rare', price: 80, sold: false };
  const { ctx, bal, picks } = makeCtx({ coins: 79 });
  const r = buyItem(ctx, item);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'poor');
  assert.equal(bal.coins, 79);
  assert.equal(item.sold, false);
  assert.deepEqual(picks, {});
});

test('buyItem：买祝福成功，扣费正确并调用 grantPerk', () => {
  const item = { kind: 'perk', perkId: 'focus', rarity: 'rare', price: 80, sold: false };
  const { ctx, bal, picks } = makeCtx({ coins: 200 });
  const r = buyItem(ctx, item);
  assert.equal(r.ok, true);
  assert.equal(r.spent, 80);
  assert.equal(bal.coins, 120);
  assert.equal(item.sold, true);
  assert.equal(picks.focus, 1);
});

test('buyItem：买「+N 步」优先走 addMovesNextFloor（仅下一层）', () => {
  const item = { kind: 'service', service: 'moves', price: ROGUE_GOLD.movesPrice, sold: false };
  const { ctx, bal, log } = makeCtx({ coins: 100 });
  const r = buyItem(ctx, item);
  assert.equal(r.ok, true);
  assert.equal(log.movesNext, ROGUE_GOLD.movesAmount);
  assert.equal(log.moves, 0, '有 addMovesNextFloor 时不应落到即时 addMoves');
  assert.equal(bal.coins, 100 - ROGUE_GOLD.movesPrice);
  assert.equal(item.sold, true);
});

test('buyItem：缺少 addReroll 钩子时仍标记已售出（重随文案照给）', () => {
  const item = { kind: 'service', service: 'reroll', price: ROGUE_GOLD.rerollPrice, sold: false };
  const { ctx, bal } = makeCtx({ coins: 100 }); // 替身故意不提供 addReroll
  const r = buyItem(ctx, item);
  assert.equal(r.ok, true);
  assert.equal(item.sold, true);
  assert.ok(r.text.includes('重随'));
  assert.equal(bal.coins, 100 - ROGUE_GOLD.rerollPrice);
});

test('buyItem：随机遗物掷空（池子抽完）时半价返还并说明', () => {
  const allOwned = RELICS.map((r) => r.id);
  const item = { kind: 'relic', random: true, rarity: 'epic', price: ROGUE_GOLD.relicPrice.epic, sold: false };
  const { ctx, bal } = makeCtx({ coins: 500, relics: allOwned, seed: 8 });
  const r = buyItem(ctx, item);
  const price = ROGUE_GOLD.relicPrice.epic;
  assert.equal(r.ok, true);
  assert.equal(r.refund, Math.round(price / 2));
  assert.equal(bal.coins, 500 - price + Math.round(price / 2));
  assert.equal(item.sold, true);
  assert.ok(r.text.includes('返还'));
});

test('buyItem：随机遗物正常掷出并入遗物槽，全额扣费', () => {
  const item = { kind: 'relic', random: true, rarity: 'epic', price: ROGUE_GOLD.relicPrice.epic, sold: false };
  const { ctx, bal, relics } = makeCtx({ coins: 500, relics: [], seed: 8 });
  const r = buyItem(ctx, item);
  assert.equal(r.ok, true);
  assert.equal(r.refund, undefined);
  assert.equal(bal.coins, 500 - ROGUE_GOLD.relicPrice.epic);
  assert.equal(relics.length, 1);
  assert.ok(RELICS.some((x) => x.id === relics[0]));
  assert.equal(item.sold, true);
});

test('buyItem：移除格不走购买，返回 use-remove', () => {
  const { ctx } = makeCtx({ coins: 1000 });
  const r = buyItem(ctx, { kind: 'remove', price: ROGUE_GOLD.removeCost, sold: false });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'use-remove');
});

// ---------------------------------------------------------------- 封禁（删牌）

test('removePerk：正常封禁——扣 removeCost、banPerk、removePerk、返还 removeRefund', () => {
  const { ctx, bal, log, picks } = makeCtx({ coins: 200, picks: { focus: 1 } });
  const r = removePerk(ctx, 'focus');
  assert.equal(r.ok, true);
  assert.equal(r.spent, ROGUE_GOLD.removeCost);
  assert.equal(r.refund, ROGUE_GOLD.removeRefund);
  assert.equal(bal.coins, 200 - ROGUE_GOLD.removeCost + ROGUE_GOLD.removeRefund);
  assert.deepEqual(log.banned, ['focus']);
  assert.deepEqual(log.removed, ['focus']);
  assert.equal(picks.focus, undefined, 'removePerk 钩子应清掉 picks 计数');
});

test('removePerk：不存在的祝福返回 nope，金币不足返回 poor，两者都不扣钱', () => {
  const nope = makeCtx({ coins: 500, picks: {} });
  const r1 = removePerk(nope.ctx, 'focus');
  assert.equal(r1.ok, false);
  assert.equal(r1.reason, 'nope');
  assert.equal(nope.bal.coins, 500);

  const poor = makeCtx({ coins: 10, picks: { focus: 1 } });
  const r2 = removePerk(poor.ctx, 'focus');
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'poor');
  assert.equal(poor.bal.coins, 10);
  assert.equal(poor.picks.focus, 1, '失败不该改动 picks');
});

// ---------------------------------------------------------------- 刷新

test('refreshShelf：limit / poor / 成功三条路径', () => {
  // limit：次数用尽
  const limitState = baseState({ coins: 999 });
  const limitRs = { used: ROGUE_GOLD.refreshMax };
  const limit = refreshShelf(createRng(1), limitState, limitRs);
  assert.equal(limit.ok, false);
  assert.equal(limit.reason, 'limit');
  assert.equal(limitState.coins, 999);

  // poor：金币不足
  const poorState = baseState({ coins: ROGUE_GOLD.refreshCost - 1 });
  const poorRs = { used: 0 };
  const poor = refreshShelf(createRng(1), poorState, poorRs);
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'poor');
  assert.equal(poorRs.used, 0);
  assert.equal(poorState.coins, ROGUE_GOLD.refreshCost - 1);

  // 成功：扣费、used++、返回新货架
  const okState = baseState({ coins: ROGUE_GOLD.refreshCost * 2 });
  const okRs = { used: 0 };
  const ok = refreshShelf(createRng(1), okState, okRs);
  assert.equal(ok.ok, true);
  assert.equal(ok.spent, ROGUE_GOLD.refreshCost);
  assert.equal(okState.coins, ROGUE_GOLD.refreshCost);
  assert.equal(okRs.used, 1);
  assert.equal(ok.items.length, ROGUE_GOLD.shopSlots);
});

test('refreshShelf：刷新费同样吃商店折扣', () => {
  const state = baseState({ coins: 100 });
  const rs = { used: 0 };
  const r = refreshShelf(createRng(2), state, rs, { shopDiscount: ROGUE_GOLD.discountMult });
  assert.equal(r.ok, true);
  assert.equal(r.spent, Math.round(ROGUE_GOLD.refreshCost * ROGUE_GOLD.discountMult));
  assert.equal(state.coins, 100 - r.spent);
});

// ---------------------------------------------------------------- 健壮性

test('空 ctx（{}）调 buyItem / removePerk 不抛错', () => {
  let buy;
  let remove;
  assert.doesNotThrow(() => {
    buy = buyItem({}, { kind: 'perk', perkId: 'focus', rarity: 'common', price: 45, sold: false });
    remove = removePerk({}, 'focus');
  });
  assert.equal(buy.ok, false);
  assert.equal(remove.ok, false);
  // 非法入参同样不抛错
  assert.equal(buyItem({}, null).ok, false);
  assert.equal(buyItem({}, undefined).reason, 'bad');
  assert.equal(removePerk({}, undefined).ok, false);
});

test('SERVICE_KINDS 覆盖 config 的三个服务价目，且源码禁用 Math.random', () => {
  assert.deepEqual([...SERVICE_KINDS].sort(), ['moves', 'reroll', 'shield']);
  assert.ok(!/Math\.random/.test(SRC), 'shop.js 不得出现 Math.random');
});

console.log(`\n全部通过：${passed} 个用例`);
