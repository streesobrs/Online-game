/**
 * 存档迁移与签名用例（开发方案 4.7.3）
 *
 * 运行：node client-v2/tests/match3-save-migration.test.js
 * migrate.js / meta.js 均为纯逻辑（不碰 DOM），直接由 Node 执行。
 *
 * 覆盖文档 fixture 矩阵：
 * v1 meta / v2 幂等 / 未来版含未知 key / 废弃字段 / 缺嵌套字段 /
 * v1 线性 session / 高版本 session / 坏档 / 坏签名。
 */
import assert from 'node:assert/strict';

import { ROGUE_META, DEPRECATED } from '../src/games/match3/config/config.js';
import {
  CURRENT_META_VER,
  CURRENT_SESSION_VER,
  META_MIGRATIONS,
  SESSION_MIGRATIONS,
  canonicalStringify,
  checkSignature,
  deepClone,
  fnv1a,
  migrateMeta,
  migrateSave,
  migrateSession,
  sealMeta,
  sealSession,
  signFields,
} from '../src/games/match3/save/migrate.js';
import { normalizeMeta } from '../src/games/match3/rogue/meta.js';
import { SIGNED_FIELDS, SESSION_SCHEMA_VER } from '../src/games/match3/config/config.js';

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

/** v1 时代的 meta 快照（version 字段、形状齐全） */
function v1MetaFixture() {
  return {
    version: 1,
    essence: 120,
    essenceEarned: 340,
    perks: { supply: { lv: 2, unlockedAt: 11, upgradedAt: 22, picks: 5 } },
    buffs: {},
    claimed: { unlock3: 1700000000000 },
    stats: { runs: 9, bestFloor: 14, totalCleared: 500, questsDone: 12 },
  };
}

/** v1 时代的局内 session 快照（线性层数，无地图字段） */
function v1SessionFixture(floor = 7, phase = 'floor') {
  return {
    mode: 'rogue',
    phase,
    floor,
    bonus: { moves: 2, colors: 0, goalWeight: 0, goalCut: 0, shields: 1, shuffles: 0, scoreMult: 1, specials: {} },
    picks: { supply: 1 },
    baseScore: 4321,
    maxCombo: 3,
    totalMoves: 66,
    totalCleared: 410,
    questsDone: 2,
    runRngState: 1234567,
    elapsedMs: 90000,
    shufflesLeft: 0,
    rewindsLeft: 0,
    extraPicks: 0,
    board: { rows: 8, cols: 8, cells: [] },
    ts: 1700000000000,
  };
}

// ---------------- 1. 版本常量与迁移表 ----------------

section('版本与迁移表');

test('当前版本：meta 与客户端镜像一致、session 常量为 4；迁移步首尾相接', () => {
  assert.equal(CURRENT_META_VER, ROGUE_META.saveVer);
  assert.equal(CURRENT_SESSION_VER, SESSION_SCHEMA_VER);
  assert.equal(CURRENT_META_VER, 2);
  assert.equal(CURRENT_SESSION_VER, 4);
  assert.equal(META_MIGRATIONS[0].from, 1);
  assert.equal(META_MIGRATIONS[0].to, 2);
  assert.equal(SESSION_MIGRATIONS[0].from, 1);
  assert.equal(SESSION_MIGRATIONS[0].to, 2);
  assert.equal(SESSION_MIGRATIONS[1].from, 2);
  assert.equal(SESSION_MIGRATIONS[1].to, 3);
  assert.equal(SESSION_MIGRATIONS[2].from, 3);
  assert.equal(SESSION_MIGRATIONS[2].to, 4);
  // 链式相接：每一步的 to 必须等于下一步的 from，版本号不留空档
  for (let i = 1; i < SESSION_MIGRATIONS.length; i += 1) {
    assert.equal(SESSION_MIGRATIONS[i].from, SESSION_MIGRATIONS[i - 1].to);
  }
});

test('DEPRECATED：version 登记自 v2、readShim 按 saveVer ?? version ?? 1 读取', () => {
  assert.equal(DEPRECATED.version.since, 2);
  assert.equal(DEPRECATED.version.readShim({ saveVer: 2 }), 2);
  assert.equal(DEPRECATED.version.readShim({ version: 1 }), 1);
  assert.equal(DEPRECATED.version.readShim({}), 1);
});

// ---------------- 2. meta 三向判定 ----------------

section('meta 迁移（三向判定）');

test('v1 meta：盖 saveVer=2，旧字段与全部数据原样保留', () => {
  const raw = v1MetaFixture();
  const result = migrateMeta(raw);
  assert.equal(result.future, false);
  assert.equal(result.fresh, false);
  assert.equal(result.ver, 2);
  assert.equal(result.data.saveVer, 2);
  // 只增不删：v1 字段一个都不能丢
  assert.equal(result.data.version, 1);
  assert.equal(result.data.essence, 120);
  assert.equal(result.data.perks.supply.lv, 2);
  assert.equal(result.data.stats.bestFloor, 14);
  assert.equal(result.data.claimed.unlock3, 1700000000000);
  // 不改原档（纯函数）
  assert.equal(raw.saveVer, undefined);
});

test('v2 meta：直用且幂等（连续迁移结果字段一致）', () => {
  const raw = { ...v1MetaFixture(), saveVer: 2 };
  delete raw.version;
  const once = migrateMeta(raw).data;
  const twice = migrateMeta(once).data;
  assert.equal(once.saveVer, 2);
  assert.deepEqual(twice, once);
});

test('未来版 meta（v99）：不迁移、不报错，future=true 且版本号原样', () => {
  const raw = { saveVer: 99, essence: 5, futureFeature: { x: 1 } };
  const result = migrateMeta(raw);
  assert.equal(result.future, true);
  assert.equal(result.ver, 99);
  assert.strictEqual(result.data, raw);
  assert.equal(result.data.futureFeature.x, 1);
});

test('坏档（null / 字符串 / 数组）：返回当前版本的全新默认形态', () => {
  for (const bad of [null, undefined, 'oops', 42, []]) {
    const result = migrateMeta(bad);
    assert.equal(result.fresh, true);
    assert.equal(result.future, false);
    assert.equal(result.data.saveVer, 2);
  }
});

test('迁移步幂等：对同一 v1 档连跑两次 up，地图 / 版本字段不再变化', () => {
  const first = migrateSession(v1SessionFixture()).data;
  const second = migrateSession(first).data;
  assert.equal(second.sessionVer, CURRENT_SESSION_VER);
  assert.equal(second.mapSeed, null);
  assert.equal(second.nodeId, first.nodeId);
  assert.deepEqual(second.mapStates, first.mapStates);
  assert.deepEqual(second, first);
});

// ---------------- 3. normalizeMeta（白名单 + _ext 透传 + 裁剪） ----------------

section('normalizeMeta');

test('v1 meta 归一化：saveVer=2、初始祝福补齐、stats 缺字段补默认', () => {
  const m = normalizeMeta(v1MetaFixture());
  assert.equal(m.saveVer, 2);
  assert.equal(m.essence, 120);
  // 初始解锁的三张成长祝福（supply 本就 2 级，minimal / focus 补 lv1）
  assert.equal(m.perks.supply.lv, 2);
  assert.equal(m.perks.minimal.lv, 1);
  assert.equal(m.perks.focus.lv, 1);
  assert.deepEqual(m.stats, {
    runs: 9, bestFloor: 14, totalCleared: 500, questsDone: 12, wins: 0, bossKills: 0,
  });
  assert.equal(m.version, undefined); // 弃用字段不再写出
});

test('缺嵌套字段 / 脏值：全部回落到安全默认，不抛错', () => {
  const m = normalizeMeta({ saveVer: 2, essence: 'abc', perks: null, buffs: 'x', claimed: null, stats: null });
  assert.equal(m.essence, 0);
  assert.deepEqual(m.perks, { supply: { lv: 1 }, minimal: { lv: 1 }, focus: { lv: 1 } });
  assert.deepEqual(m.buffs, {});
  assert.deepEqual(m.claimed, {});
  assert.deepEqual(m.stats, { runs: 0, bestFloor: 0, totalCleared: 0, questsDone: 0, wins: 0, bossKills: 0 });
});

test('超上限等级被裁；不存在的祝福 id 被丢', () => {
  const m = normalizeMeta({
    saveVer: 2,
    perks: { supply: { lv: 99 }, ghost: { lv: 3 } },
    buffs: { expboost: { lv: 99 } },
  });
  // common 上限 2（server / client 同表）；epic 经验共鸣上限 4
  assert.equal(m.perks.supply.lv, 2);
  assert.equal(m.perks.ghost, undefined);
  assert.equal(m.buffs.expboost.lv, 4);
});

test('未知 key 收进 _ext；二次归一化不重复嵌套、不丢失', () => {
  const once = normalizeMeta({ saveVer: 2, essence: 10, relicsFound: ['a', 'b'], unlockedCharacters: ['sorcerer'] });
  assert.deepEqual(once._ext, { relicsFound: ['a', 'b'], unlockedCharacters: ['sorcerer'] });
  // 模拟「回滚期间老版本服务端写回、再升级回来」：_ext 里的东西必须原样活着
  const twice = normalizeMeta(once);
  assert.deepEqual(twice._ext, once._ext);
  assert.equal(twice._ext._ext, undefined);
});

test('未来版 meta：已知字段照读，未知字段进 _ext，saveVer 保留高版本号（不盖成 2）', () => {
  const m = normalizeMeta({ saveVer: 99, essence: 77, relicsFound: ['r1'], perks: { supply: { lv: 1 } } });
  assert.equal(m.saveVer, 99);
  assert.equal(m.essence, 77);
  assert.deepEqual(m._ext, { relicsFound: ['r1'] });
});

test('空输入：空存档形态带当前 saveVer，且每次返回独立对象（不共享引用）', () => {
  const a = normalizeMeta(null);
  const b = normalizeMeta(undefined);
  assert.equal(a.saveVer, 2);
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(a.perks, b.perks);
  a.essence = 999;
  assert.equal(b.essence, 0);
});

// ---------------- 4. session 迁移 ----------------

section('session 迁移');

test('v1 session：迁移到 v4，按 floor 合成线性图（当前层 open、前后状态正确），并补齐胜利闭环与局内经济字段', () => {
  const result = migrateSession(v1SessionFixture(7));
  assert.equal(result.future, false);
  assert.equal(result.data.sessionVer, 4);
  assert.equal(result.data.mapSeed, null);
  assert.equal(result.data.mapParams, null);
  assert.equal(result.data.nodeId, 'l7');
  assert.equal(result.data.terrain, null);
  assert.equal(result.data.goals, null);
  // 非 locked 才落盘：起点与前 6 层 done、第 7 层 open，更深的（含 b30）不进 mapStates
  assert.equal(result.data.mapStates.n0, 'done');
  assert.equal(result.data.mapStates.l6, 'done');
  assert.equal(result.data.mapStates.l7, 'open');
  assert.equal(result.data.mapStates.l8, undefined);
  assert.equal(result.data.mapStates.b30, undefined);
  // 对局数据原样保留
  assert.equal(result.data.baseScore, 4321);
  assert.equal(result.data.runRngState, 1234567);
  // v3 追加字段的默认值
  assert.equal(result.data.victory, false);
  assert.equal(result.data.bossKills, 0);
  assert.equal(result.data.endless, false);
  assert.equal(result.data.boss, null);
  // v4 追加字段的默认值（局内金币 / 遗物 / 锻造 / 封禁）
  assert.equal(result.data.coins, 0);
  assert.deepEqual(result.data.relics, []);
  assert.deepEqual(result.data.upgradedPerkIds, []);
  assert.deepEqual(result.data.bannedPerkIds, []);
});

test('v2 → v4：四字段缺省补齐；已有值一律不覆盖，重封签名通过', () => {
  // 先手工造一份已签名的 v2（走 1→2 的 up 得到地图字段）
  const v2 = { ...SESSION_MIGRATIONS[0].up(v1SessionFixture(20)), sig: undefined };
  assert.equal(v2.sessionVer, 2);
  const { data, ver, future } = migrateSession(v2);
  assert.equal(ver, 4);
  assert.equal(future, false);
  assert.equal(data.sessionVer, 4);
  assert.equal(data.victory, false);
  assert.equal(data.bossKills, 0);
  assert.equal(data.endless, false);
  assert.equal(data.boss, null);
  // 2→4 步只补不改：带上胜利进度的 v2 档，值原样保留
  const midBoss = {
    ...v2,
    victory: true,
    bossKills: 2,
    endless: false,
    boss: { id: 'frost_reverent', target: 800, fired: ['frost_reverent:p0'] },
  };
  delete midBoss.sig;
  const kept = migrateSession(midBoss).data;
  assert.equal(kept.victory, true);
  assert.equal(kept.bossKills, 2);
  assert.deepEqual(kept.boss, { id: 'frost_reverent', target: 800, fired: ['frost_reverent:p0'] });
  // 迁移后重封：按 v4 白名单验签 ok
  const resealed = sealSession(kept);
  assert.equal(resealed.sessionVer, 4);
  assert.equal(checkSignature(resealed, SIGNED_FIELDS.session, 'sig'), 'ok');
});

test('v3 → v4：局内经济四字段缺省补齐；已有值一律不覆盖', () => {
  // 从 v1 走到 v3（前两步 up 全跑），再手工挂上「已在事件 / 商店里动过经济」的 v3 档
  const v3 = { ...migrateSession({ ...v1SessionFixture(12), sessionVer: 3, coins: 45, relics: ['golden_vein'], upgradedPerkIds: ['supply'], bannedPerkIds: ['focus'] }).data };
  assert.equal(v3.sessionVer, 4, 'migrateSession 会一路补到当前版本');
  // 只补空：老档缺 key 时补默认，绝不覆盖已有值
  const legacyV3 = { ...SESSION_MIGRATIONS[1].up(v1SessionFixture(12)), sessionVer: 3 };
  delete legacyV3.sig;
  const out = migrateSession(legacyV3).data;
  assert.equal(out.sessionVer, 4);
  assert.equal(out.coins, 0);
  assert.deepEqual(out.relics, []);
  assert.deepEqual(out.upgradedPerkIds, []);
  assert.deepEqual(out.bannedPerkIds, []);
  // 幂等：对已是 v4 的档再跑一次，逐字段不变
  assert.deepEqual(migrateSession(out).data, out);
});

test('v4 签名：篡改 victory / bossKills / endless / boss / coins / relics 任一即 bad', () => {
  const sealed = sealSession({
    ...v1SessionFixture(30),
    victory: true, bossKills: 3, endless: false, boss: { id: 'core_titan', target: 900, fired: [] },
    coins: 88, relics: ['golden_vein'], upgradedPerkIds: ['supply'], bannedPerkIds: ['focus'],
  });
  assert.equal(checkSignature(sealed, SIGNED_FIELDS.session, 'sig'), 'ok');
  assert.equal(checkSignature({ ...sealed, victory: false }, SIGNED_FIELDS.session, 'sig'), 'bad');
  assert.equal(checkSignature({ ...sealed, bossKills: 0 }, SIGNED_FIELDS.session, 'sig'), 'bad');
  assert.equal(checkSignature({ ...sealed, endless: true }, SIGNED_FIELDS.session, 'sig'), 'bad');
  assert.equal(checkSignature(
    { ...sealed, boss: { ...sealed.boss, target: 1 } }, SIGNED_FIELDS.session, 'sig'), 'bad');
  // 局内经济同样进签名：不发奖 ≠ 允许改档刷 build（开发方案 4.3）
  assert.equal(checkSignature({ ...sealed, coins: 9999 }, SIGNED_FIELDS.session, 'sig'), 'bad');
  assert.equal(checkSignature({ ...sealed, relics: [] }, SIGNED_FIELDS.session, 'sig'), 'bad');
  assert.equal(checkSignature({ ...sealed, upgradedPerkIds: [] }, SIGNED_FIELDS.session, 'sig'), 'bad');
  assert.equal(checkSignature({ ...sealed, bannedPerkIds: [] }, SIGNED_FIELDS.session, 'sig'), 'bad');
  // 老版本验签不受影响：v3 白名单不含新字段，补上 v4 字段不改变 v3 签名
  const v3Base = { ...v1SessionFixture(8), sessionVer: 3 };
  const withV4 = {
    ...v3Base, coins: 50, relics: ['x'], upgradedPerkIds: ['y'], bannedPerkIds: ['z'],
  };
  assert.equal(signFields(v3Base, SIGNED_FIELDS.session[3]), signFields(withV4, SIGNED_FIELDS.session[3]));
});

test('v1 session 停在 Boss 层（10/20/30）：nodeId 指向 b{d}', () => {
  for (const d of [10, 20, 30]) {
    const { data } = migrateSession(v1SessionFixture(d, 'map'));
    assert.equal(data.nodeId, `b${d}`);
    assert.equal(data.mapStates[`b${d}`], 'open');
    assert.equal(data.phase, 'map');
  }
});

test('高版本 session：future=true 原样返回（上层负责写墓碑，不在这里续玩）', () => {
  const raw = { ...v1SessionFixture(3), sessionVer: 77, mapSeed: 5, mapParams: {} };
  const result = migrateSession(raw);
  assert.equal(result.future, true);
  assert.equal(result.ver, 77);
  assert.strictEqual(result.data, raw);
});

test('坏 session（null / 字符串）：fresh 默认，不抛错', () => {
  for (const bad of [null, '', 42, {}]) {
    const result = migrateSession(bad);
    assert.equal(result.data.sessionVer, CURRENT_SESSION_VER);
  }
});

test('migrateSession 不修改入参（深拷贝隔离）', () => {
  const raw = v1SessionFixture(5);
  migrateSession(raw);
  assert.equal(raw.sessionVer, undefined);
  assert.equal(raw.mapSeed, undefined);
  assert.equal(raw.nodeId, undefined);
});

// ---------------- 5. 签名与验签 ----------------

section('签名（canonical JSON + FNV-1a）');

test('FNV-1a 与 canonical JSON 的快照值稳定（换算法 / 改序列化顺序会挂）', () => {
  assert.equal(fnv1a(''), '811c9dc5');
  assert.equal(fnv1a('a'), 'e40c292c');
  // 对象 key 按字典序：解析后重排不影响签名字节
  assert.equal(canonicalStringify({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(canonicalStringify({ a: 1, b: 2 }), canonicalStringify({ b: 2, a: 1 }));
  // 嵌套对象同样排序；数组保序；undefined 字段跳过
  assert.equal(canonicalStringify({ a: { z: 1, y: 2 }, b: [3, 1, 2], c: undefined }),
    '{"a":{"y":2,"z":1},"b":[3,1,2]}');
});

test('sealSession / 验签：当前版本往返 ok；篡改任一签名字段（含嵌套）即 bad', () => {
  const sealed = sealSession(v1SessionFixture(8));
  assert.equal(sealed.sessionVer, CURRENT_SESSION_VER);
  assert.equal(typeof sealed.sig, 'string');
  assert.equal(checkSignature(sealed, SIGNED_FIELDS.session, 'sig'), 'ok');

  const tampered = { ...sealed, floor: 9 };
  assert.equal(checkSignature(tampered, SIGNED_FIELDS.session, 'sig'), 'bad');
  const tamperedNested = { ...sealed, bonus: { ...sealed.bonus, moves: 99 } };
  assert.equal(checkSignature(tamperedNested, SIGNED_FIELDS.session, 'sig'), 'bad');
  const tamperedBoard = { ...sealed, board: { ...sealed.board, rows: 9 } };
  assert.equal(checkSignature(tamperedBoard, SIGNED_FIELDS.session, 'sig'), 'bad');
});

test('签名字段集外的改动不判坏（ts 在白名单内，sig 自身不在）', () => {
  const sealed = sealSession(v1SessionFixture(8));
  // sig 字段不参与签名计算（否则永远验不过）
  assert.equal(signFields(sealed, SIGNED_FIELDS.session[2]), signFields({ ...sealed, sig: 'ffff' }, SIGNED_FIELDS.session[2]));
});

test('v1 无签名档：unsigned（灰度期零误伤，不判损坏）；有签名但版本未知：unsigned', () => {
  assert.equal(checkSignature(v1SessionFixture(8), SIGNED_FIELDS.session, 'sig'), 'unsigned');
  assert.equal(checkSignature(null, SIGNED_FIELDS.session, 'sig'), 'unsigned');
  const future = { ...sealSession(v1SessionFixture(8)), sessionVer: 50 };
  assert.equal(checkSignature(future, SIGNED_FIELDS.session, 'sig'), 'unsigned');
});

test('meta 签名往返（_ck）：篡改 essence / 等级 / stats 即 bad', () => {
  const sealed = sealMeta(normalizeMeta(v1MetaFixture()));
  assert.equal(checkSignature(sealed, SIGNED_FIELDS.meta, '_ck'), 'ok');
  assert.equal(checkSignature({ ...sealed, essence: 999 }, SIGNED_FIELDS.meta, '_ck'), 'bad');
  assert.equal(
    checkSignature({ ...sealed, stats: { ...sealed.stats, runs: 1 } }, SIGNED_FIELDS.meta, '_ck'),
    'bad',
  );
  // _ext 不参与签名：透传袋被老版本增删不影响 meta 本体验签
  assert.equal(
    checkSignature({ ...sealed, _ext: { whatever: [1, 2] } }, SIGNED_FIELDS.meta, '_ck'),
    'ok',
  );
});

test('v1 meta（无 _ck）验签为 unsigned，迁移后可重新盖签', () => {
  const v1 = v1MetaFixture();
  assert.equal(checkSignature(v1, SIGNED_FIELDS.meta, '_ck'), 'unsigned');
  const sealed = sealMeta(normalizeMeta(v1));
  assert.equal(checkSignature(sealed, SIGNED_FIELDS.meta, '_ck'), 'ok');
});

// ---------------- 6. 深拷贝与通用迁移 ----------------

section('深拷贝 / 通用入口');

test('deepClone：嵌套数组 / 对象互不共享；非 JSON 值安全处理', () => {
  const src = { a: [1, { b: 2 }], c: { d: 3 } };
  const dst = deepClone(src);
  dst.a[1].b = 99;
  assert.equal(src.a[1].b, 2);
  assert.notStrictEqual(src.a, dst.a);
  assert.equal(deepClone(undefined), undefined);
});

test('migrateSave 补默认值用深拷贝：多份新档不共享嵌套引用', () => {
  const defaults = { stats: { runs: 0 }, list: [] };
  const a = migrateSave(null, { current: 1, migrations: [], defaults }).data;
  const b = migrateSave(null, { current: 1, migrations: [], defaults }).data;
  a.stats.runs = 5;
  a.list.push(1);
  assert.equal(b.stats.runs, 0);
  assert.equal(b.list.length, 0);
});

test('migrateSave 旧别名：sessionVer 缺失时不认 version（两类存档版本字段互不串味）', () => {
  // session 不设 legacyVersionKey：带 version:1 的对象也按无版本 → 1 处理（结果相同，但语义隔离）
  const r1 = migrateSave({ floor: 3 }, { current: 2, migrations: SESSION_MIGRATIONS, versionKey: 'sessionVer' });
  assert.equal(r1.data.sessionVer, 2);
  assert.equal(r1.data.nodeId, 'l3');
  // meta 认 version 别名
  const r2 = migrateSave({ version: 1, essence: 1 }, {
    current: 2, migrations: META_MIGRATIONS, versionKey: 'saveVer', legacyVersionKey: 'version',
  });
  assert.equal(r2.data.saveVer, 2);
});

// ---------------- 汇总 ----------------

section('汇总');
if (failures.length > 0) {
  console.error(`\n${failures.length} 个用例失败：`);
  for (const f of failures) console.error(`  ✗ ${f.name}\n      ${f.message}`);
  process.exit(1);
}
console.log(`\n全部通过：${passed} 个用例`);
