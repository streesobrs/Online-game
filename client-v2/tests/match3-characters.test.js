/**
 * 角色 / 熟练度纯函数断言（开发方案 3.8，P5 扩展）
 *
 * - 数据表：7 个角色、id 唯一、默认角色在表、字段完整（图标/名称/描述/起手数据）
 * - 起手数据指向真实存在的祝福 / 遗物 id；解锁条件只落在 stats 已有项或 win
 * - 角色专属被动（characterOnly）：被某角色携带，且指向存在的角色
 * - characterUnlocked / unlockProgress：默认开放恒真、新角色按战绩判定
 * - characterMastery：门槛升序、分级正确、进度夹取、满级 done
 */
import assert from 'node:assert/strict';
import { PERKS } from '../src/games/match3/rogue/perks.js';
import { RELICS } from '../src/games/match3/rogue/relics.js';
import {
  CHARACTERS, DEFAULT_CHARACTER, MASTERY_TIERS, characterById, characterMastery,
  characterUnlocked, defaultCharacters, unlockProgress, unlockedCharacters,
} from '../src/games/match3/rogue/characters.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

const STAT_KEYS = new Set(['runs', 'bestFloor', 'totalCleared', 'questsDone', 'wins', 'bossKills']);

test('CHARACTERS：共 7 个、id 唯一、默认角色在表、至少 1 个默认开放', () => {
  assert.equal(CHARACTERS.length, 7);
  const ids = CHARACTERS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'id 重复');
  assert.ok(ids.includes(DEFAULT_CHARACTER), `默认角色 ${DEFAULT_CHARACTER} 不在表里`);
  assert.ok(CHARACTERS.some((c) => !c.unlock), '至少要有一个默认开放角色');
});

test('CHARACTERS：字段完整（图标 / 名称 / 流派 / 描述 / 起手数据）', () => {
  for (const c of CHARACTERS) {
    assert.ok(c.icon && c.name && c.style, `${c.id} 缺图标/名称/流派`);
    assert.ok(typeof c.desc === 'string' && c.desc.length > 0, `${c.id} 缺 desc`);
    assert.ok(c.startBonus && typeof c.startBonus === 'object', `${c.id} startBonus 必须是对象`);
    assert.ok(Array.isArray(c.startPerks), `${c.id} startPerks 必须是数组`);
    assert.ok(Array.isArray(c.startRelics), `${c.id} startRelics 必须是数组`);
  }
});

test('起手祝福 / 遗物必须指向真实存在的 id', () => {
  const perkIds = new Set(PERKS.map((p) => p.id));
  const relicIds = new Set(RELICS.map((r) => r.id));
  for (const c of CHARACTERS) {
    for (const pid of c.startPerks) assert.ok(perkIds.has(pid), `${c.id} 的起手祝福 ${pid} 不存在`);
    for (const rid of c.startRelics) assert.ok(relicIds.has(rid), `${c.id} 的起手遗物 ${rid} 不存在`);
  }
});

test('解锁条件只落在 stats 已有项或 win', () => {
  for (const c of CHARACTERS) {
    if (!c.unlock) continue;
    const u = c.unlock;
    assert.ok(u.label, `${c.id} 解锁条件缺 label`);
    if (Number.isFinite(u.win)) continue;
    assert.ok(STAT_KEYS.has(u.stat), `${c.id} 的解锁条件写了未知统计项 ${u.stat}`);
    assert.ok(u.value > 0, `${c.id} 的解锁门槛必须为正`);
  }
});

test('角色专属被动（characterOnly）：被某角色携带且指向存在的角色', () => {
  const charIds = new Set(CHARACTERS.map((c) => c.id));
  const carried = new Set(CHARACTERS.flatMap((c) => c.startRelics));
  for (const r of RELICS.filter((x) => x.characterOnly)) {
    assert.ok(charIds.has(r.characterOnly), `${r.id} 指向不存在的角色 ${r.characterOnly}`);
    assert.ok(carried.has(r.id), `角色专属遗物 ${r.id} 没被任何角色携带`);
  }
});

test('4 个新角色各自携带对应的专属被动遗物', () => {
  const expect = {
    bounty: 'bounty_pact', bomber: 'bomb_primer', gambler: 'loaded_dice', prism: 'prism_pact',
  };
  for (const [charId, relicId] of Object.entries(expect)) {
    const c = characterById(charId);
    assert.equal(c.id, charId, `${charId} 不存在`);
    assert.ok(c.startRelics.includes(relicId), `${charId} 未携带 ${relicId}`);
    const r = RELICS.find((x) => x.id === relicId);
    assert.equal(r.characterOnly, charId, `${relicId} 的 characterOnly 不是 ${charId}`);
  }
});

test('defaultCharacters / unlockedCharacters：默认开放不计战绩', () => {
  assert.deepEqual(defaultCharacters(), [DEFAULT_CHARACTER]);
  assert.ok(unlockedCharacters({}).includes(DEFAULT_CHARACTER));
  // 空战绩时除默认角色外都锁着
  assert.equal(unlockedCharacters({}).length, 1);
});

test('characterUnlocked：默认角色恒真，新角色按战绩判定', () => {
  const sorc = characterById('sorcerer');
  assert.equal(characterUnlocked(sorc, {}), true);

  const bounty = characterById('bounty');   // bestFloor 8
  assert.equal(characterUnlocked(bounty, { bestFloor: 7 }), false);
  assert.equal(characterUnlocked(bounty, { bestFloor: 8 }), true);

  const bomber = characterById('bomber');   // bossKills 1
  assert.equal(characterUnlocked(bomber, { bossKills: 0 }), false);
  assert.equal(characterUnlocked(bomber, { bossKills: 1 }), true);

  const gambler = characterById('gambler'); // runs 5
  assert.equal(characterUnlocked(gambler, { runs: 4 }), false);
  assert.equal(characterUnlocked(gambler, { runs: 5 }), true);

  const prism = characterById('prism');     // questsDone 5
  assert.equal(characterUnlocked(prism, { questsDone: 4 }), false);
  assert.equal(characterUnlocked(prism, { questsDone: 5 }), true);

  const palette = characterById('palette'); // win 1
  assert.equal(characterUnlocked(palette, { wins: 0 }), false);
  assert.equal(characterUnlocked(palette, { wins: 1 }), true);
});

test('characterUnlocked：未提供 stats 时不抛错，未知角色回落默认', () => {
  assert.equal(characterUnlocked(null, {}), true);
  assert.equal(characterById('no_such_char').id, DEFAULT_CHARACTER);
});

test('unlockProgress：默认开放返回 null，新角色返回夹取后的进度', () => {
  assert.equal(unlockProgress(characterById('sorcerer'), {}), null);

  const bounty = characterById('bounty');
  const p0 = unlockProgress(bounty, { bestFloor: 3 });
  assert.deepEqual(p0, { label: '最深抵达第 8 层', have: 3, need: 8, done: false });
  // have 夹到 need 以内
  const pDone = unlockProgress(bounty, { bestFloor: 99 });
  assert.equal(pDone.have, 8);
  assert.equal(pDone.done, true);

  const palette = characterById('palette');
  assert.equal(unlockProgress(palette, { wins: 0 }).need, 1);
  assert.equal(unlockProgress(palette, { wins: 2 }).done, true);
});

test('MASTERY_TIERS：升序正整数，最高档与成就门槛一致', () => {
  assert.deepEqual(MASTERY_TIERS, [3, 8, 15]);
  for (let i = 0; i < MASTERY_TIERS.length; i += 1) {
    assert.ok(Number.isInteger(MASTERY_TIERS[i]) && MASTERY_TIERS[i] > 0, '门槛必须为正整数');
    if (i > 0) assert.ok(MASTERY_TIERS[i] > MASTERY_TIERS[i - 1], '门槛必须递增');
  }
});

test('characterMastery：分级正确、进度夹取、满级 done', () => {
  assert.deepEqual(characterMastery({ runs: 0 }), { level: 0, runs: 0, next: 3, progress: 0, done: false });
  assert.deepEqual(characterMastery({ runs: 3 }), { level: 1, runs: 3, next: 8, progress: 0, done: false });
  assert.equal(characterMastery({ runs: 7 }).level, 1);
  assert.equal(characterMastery({ runs: 8 }).level, 2);
  assert.equal(characterMastery({ runs: 14 }).level, 2);
  assert.equal(characterMastery({ runs: 15 }).level, 3);

  const mid = characterMastery({ runs: 5 });   // 档 3..8 之间
  assert.equal(mid.level, 1);
  assert.equal(mid.next, 8);
  assert.ok(Math.abs(mid.progress - 2 / 5) < 1e-9);

  const full = characterMastery({ runs: 15 });
  assert.equal(full.level, MASTERY_TIERS.length);
  assert.equal(full.next, null);
  assert.equal(full.progress, 1);
  assert.equal(full.done, true);
});

test('characterMastery：脏输入（null / 负数 / 小数）不抛错且归零', () => {
  assert.equal(characterMastery(null).level, 0);
  assert.equal(characterMastery(undefined).runs, 0);
  assert.equal(characterMastery({ runs: -5 }).runs, 0);
  assert.equal(characterMastery({ runs: 2.9 }).runs, 2);
  assert.equal(characterMastery({ runs: 2.9 }).level, 0);
});

console.log(`\n全部通过：${passed} 个用例`);
