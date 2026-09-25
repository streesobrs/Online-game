/**
 * 肉鸽试炼数值标定脚本（长期保留，改 `ROGUE` 那组数值前先重跑）
 *
 * 直接 import 产品代码的公式与祝福池（`perks.js` / `config.js`），保证标定口径不漂。
 * 走子策略：枚举全部可行步后随机选一个（比 findValidMove 的首个可行步更接近人类水平）；
 * run 模拟按「每层 3 次采样取中位 + 理性三选一」推进，用来回答「这套数值能打到几层」。
 */
import { createInitialBoard, resolve, resolveRainbowSwap } from '../src/games/match3/engine/cascade.js';
import { hasValidMove, swapCells, shuffleBoard } from '../src/games/match3/engine/deadlock.js';
import { colOf, index, isPlayable, rowOf } from '../src/games/match3/engine/grid.js';
import { hasMatch } from '../src/games/match3/engine/match.js';
import { makeSpecial } from '../src/games/match3/engine/special.js';
import { createRng } from '../src/games/match3/engine/rng.js';
import {
  ROGUE, ROGUE_BOSSES, ROGUE_BOSS_ORDER, ROGUE_GOLD, ROGUE_META, ROGUE_RELIC, SCORE, SPECIAL,
} from '../src/games/match3/config/config.js';
import {
  META_BUFFS, PERKS, QUEST_REWARDS, createBonus, floorOptions, goalOf, questFor, rollPerks, valueAt,
} from '../src/games/match3/rogue/perks.js';
// 局外养成（共鸣树）的推导也直接 import：等级上限、机制节点生效判定、本轮起手的加成注入
// 都只有一份实现，标定口径跟产品完全一致
import { applyMetaBuffs, essenceForRun, maxLevelOf, mechanicCfg, mechanicOn } from '../src/games/match3/rogue/meta.js';
// 3.1/3.2：节点地图、地形与多目标——run 模拟走与 mode-rogue 完全相同的生成管线
import { ALL_ENABLED, NODE, P0_ENABLED, advanceTo, completeNode, generateMap } from '../src/games/match3/rogue/mapgen.js';
import { floorGoals, terrainFor } from '../src/games/match3/rogue/floor-types.js';
import { allGoalsDone, goalShort } from '../src/games/match3/engine/goals.js';
// 3.3：Boss 固定机关盘 / 血量 / 保底稀有度——run 模拟与发奖口径与 mode-rogue 同源
import { bossAt, bossHpTarget, bossTerrain } from '../src/games/match3/rogue/boss.js';
// 3.4 / 3.5 / 3.6：事件 / 遗物 / 商店——标定与产品 import 同一份纯函数，口径不漂
import { applyChoice, availableChoices, isLeaveChoice, rollEvent } from '../src/games/match3/rogue/events.js';
import { buildRelicHooks, grantOnAcquire, relicById, rollRelic, rollRelicChoices } from '../src/games/match3/rogue/relics.js';
import { buyItem, priceOf, rollShelf, shelfWithPrices } from '../src/games/match3/rogue/shop.js';

/**
 * 服务端**结算口径**（server/config.js 的 match3Rogue / match3Rewards，手工同步的两项）
 *
 * 精华与**经验**都只按到达层数换算（不按分结算），标定时需要把「中位层数」折成实际收益看一下尺度，
 * 所以这里各留一个常量。刻意不 import 服务端配置：它是 CommonJS 且会拉起一串依赖，
 * 标定脚本要保持能单独 `node tests/match3-rogue-balance.mjs` 跑。改了服务端就得同步改这里
 */
const EXP_FLOOR_FACTOR = 1.16;   // 经验 = ⌊层数² × 本值⌋ × 局外「经验共鸣」
const MAX_SCORE_PER_MOVE = 300000; // 反刷分单步上限（server/config.js 的 rogueMaxScorePerMove）
/**
 * 局外**数值**增益按 id 取（算「买到满级能乘多少」用）
 * 机制节点（共鸣树末端）没有数值曲线，按 valueAt 求值会得到 NaN，所以先滤掉
 */
const BUFFS_REF = Object.fromEntries(
  META_BUFFS.filter((buff) => buff.kind !== 'mechanic').map((buff) => [buff.id, buff]),
);
/** 某条数值增益买到满级的倍率（上限由稀有度决定，见 ROGUE_META.rarities） */
const buffMaxFactor = (id) => valueAt(BUFFS_REF[id], maxLevelOf(BUFFS_REF[id]));
/** 中位层数 → 基础精华（未乘「精华共鸣」） */
const essenceAt = (floor) => Math.floor((floor * floor) / ROGUE_META.essenceDivisor);
/** 中位层数 → 基础经验（未乘「经验共鸣」） */
const expAt = (floor) => Math.floor(floor * floor * EXP_FLOOR_FACTOR);

/** 「共鸣树全点亮」档的养成存档：数值节点按稀有度上限、机制节点固定 1 级（见 meta.js 的 maxLevelOf） */
function metaAllOn() {
  const buffs = {};
  for (const buff of META_BUFFS) buffs[buff.id] = { lv: maxLevelOf(buff) };
  return { saveVer: ROGUE_META.saveVer, essence: 0, perks: {}, buffs, claimed: {}, stats: {} };
}

function allValidMoves(grid) {
  const out = [];
  for (const i of grid.cellIndex) {
    const a = grid.cells[i];
    if (!a || a.blocker) continue;
    const r = rowOf(grid, i);
    const c = colOf(grid, i);
    for (const [nr, nc] of [[r, c + 1], [r + 1, c]]) {
      if (!isPlayable(grid, nr, nc)) continue;
      const j = index(grid, nr, nc);
      const b = grid.cells[j];
      if (!b || b.blocker) continue;
      if (a.special === SPECIAL.RAINBOW || b.special === SPECIAL.RAINBOW) {
        out.push({ a: i, b: j });
        continue;
      }
      swapCells(grid, i, j);
      const ok = hasMatch(grid);
      swapCells(grid, i, j);
      if (ok) out.push({ a: i, b: j });
    }
  }
  return out;
}

function injectSpecials(grid, rng, specials) {
  const kinds = [];
  for (const item of specials) {
    for (let n = 0; n < item.count; n += 1) kinds.push(item.kind);
  }
  const candidates = grid.cellIndex.filter((i) => {
    const cell = grid.cells[i];
    return cell && !cell.blocker && cell.special == null;
  });
  for (const kind of kinds) {
    if (candidates.length === 0) break;
    const [i] = candidates.splice(rng.int(candidates.length), 1);
    grid.cells[i] = makeSpecial(kind, grid.cells[i].color);
  }
}

/**
 * 局内任务奖励在本脚本里的等价实现（针对「脱离 DOM 的纯 grid + 局部变量」重写一遍）
 *
 * 产品代码是 `QUEST_REWARDS[].apply(board, opts)`；脚本没有 board，只能按 id 分派。
 * 下面的 QUEST_SIM 与 QUEST_REWARDS 的 id 集合会做一致性校验，防止两边漂掉。
 */
const QUEST_SIM = {
  moves: (ctx) => { ctx.left += ROGUE.quest.movesReward; },
  frenzy: (ctx) => { ctx.scoreMult *= ROGUE.quest.frenzyMult; },
  boom: (ctx) => injectSpecials(ctx.grid, ctx.rng, [{ kind: SPECIAL.ROW, count: ROGUE.quest.specialsReward }]),
  rainbow: (ctx) => injectSpecials(ctx.grid, ctx.rng, [{ kind: SPECIAL.RAINBOW, count: 1 }]),
};

function assertQuestRewardsCovered() {
  const simIds = Object.keys(QUEST_SIM).sort().join(',');
  const prodIds = QUEST_REWARDS.map((r) => r.id).sort().join(',');
  if (simIds !== prodIds) {
    throw new Error(`局内任务奖励与标定脚本不同步：产品 ${prodIds} / 脚本 ${simIds}`);
  }
}
assertQuestRewardsCovered();

/**
 * 一致性与覆盖度检查：每条养成项（祝福 / 局外增益）声明的稀有度都必须在数值表里存在
 *
 * 等级上限 / 解锁费 / 升级费全靠 ROGUE_META.rarities 查表得来（见 meta.js 的 rarityOf），
 * 若某条写了个不存在的稀有度，界面会静默退回 common 档——数值与预期不符还查不出原因，
 * 所以在标定时先把它拦下来。顺便查 id 唯一性：服务端靠 id 落在 perks 表还是 buffs 表判断
 * 该写哪一边，两边撞 id 会写错地方。
 */
function assertRarityCovered() {
  const entries = [...PERKS, ...META_BUFFS];
  const missing = entries.filter((entry) => !ROGUE_META.rarities[entry.rarity]).map((entry) => entry.id);
  if (missing.length > 0) {
    throw new Error(`稀有度不在 ROGUE_META.rarities 里：${missing.join(', ')}`);
  }
  const ids = entries.map((entry) => entry.id);
  const dup = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dup.length > 0) {
    throw new Error(`祝福与局外增益的 id 撞了：${dup.join(', ')}`);
  }
}
assertRarityCovered();

/**
 * 共鸣树的结构检查（开发方案 5.7）
 *
 * 树是「数据驱动」的：连线由 `requires` 推、坐标由 `tree` 落格（见 codex.js）。
 * 写错一个字（前置 id 拼错 / 两个节点挤在同一格）界面只会画歪或静默少一条线，排查很费劲，
 * 所以在这里把所有约束一次查完：前置存在且在同一条流派、坐标不重复、机制节点没有数值曲线。
 */
function assertTreeCovered() {
  const byId = Object.fromEntries(META_BUFFS.map((buff) => [buff.id, buff]));
  const seen = new Set();
  for (const buff of META_BUFFS) {
    const key = `${buff.tree?.col},${buff.tree?.row}`;
    if (seen.has(key)) throw new Error(`共鸣树坐标重复：${key}（${buff.id}）`);
    seen.add(key);
    for (const need of buff.requires || []) {
      const prev = byId[need];
      if (!prev) throw new Error(`${buff.id} 的前置 ${need} 不存在`);
      if (prev.tree.col !== buff.tree.col) throw new Error(`${buff.id} 的前置 ${need} 不在同一条流派上`);
      if (prev.tree.row >= buff.tree.row) throw new Error(`${buff.id} 的前置 ${need} 必须在它上一层`);
    }
    const limited = buff.kind === 'mechanic';
    if (limited && buff.scales) throw new Error(`机制节点 ${buff.id} 不该有数值曲线（上限固定 1 级）`);
    if (limited && (buff.requires || []).length === 0) throw new Error(`机制节点 ${buff.id} 必须有前置`);
  }
  // 每条流派必须刚好收在一个机制节点上：否则玩家点满一条线的钱花得没有意义
  const cols = [...new Set(META_BUFFS.map((buff) => buff.tree.col))];
  for (const col of cols) {
    const line = META_BUFFS.filter((buff) => buff.tree.col === col);
    if (line.filter((buff) => buff.kind === 'mechanic').length !== 1) {
      throw new Error(`第 ${col} 条流派的机制节点不是恰好 1 个`);
    }
  }
}
assertTreeCovered();

/**
 * 打一层
 * @param {object} cfg
 *   colors / moves / scoreMult / cascadeMax / specials 同旧版；
 *   rows / cols / mask / blockers 为 3.2 地形（floorOptions 已带，展开即透传）；
 *   goals 为硬目标数组（floorGoals 产物）：多目标全部达成才算过；不传则只返回 info 由调用方判分；
 *   colorWeights 为各颜色出现权重（肉鸽「同色磁石」），null 表示等概率；
 *   quest 为 { color, need, rewardId }，null 表示本层无任务；
 *   hooks 为 buildRelicHooks 产物（P3）：本层分发 onStep / onUpdate，null = 无遗物（零开销）；
 *   relicUsed 为遗物每层触发计数（调用方每层重置后传入）；floor / bonus 供遗物 ctx 读
 * @returns {{score:number, questDone:boolean, questLeft:number, questGot:number,
 *            info:{score:number, collected:object, blockersCleared:number}}}
 */
function playFloor({
  colors, moves, scoreMult, cascadeMax, specials, seed, colorWeights = null, quest = null,
  rows = ROGUE.rows, cols = ROGUE.cols, mask = null, blockers = null, goals = null,
  hooks = null, relicUsed = null, floor = 0, bonus = null,
}) {
  const rng = createRng(seed);
  const grid = createInitialBoard({ rows, cols, mask, blockers, colors, seed, weights: colorWeights }).grid;
  injectSpecials(grid, rng, specials);
  if (!hasValidMove(grid)) shuffleBoard(grid, rng);

  let score = 0;
  let clearedTiles = 0;
  const collected = {};
  let blockersCleared = 0;
  const q = quest ? { ...quest, done: false } : null;
  // ctx 是本层的**可写现场**：局内任务奖励与遗物 hook 都通过它改步数 / 倍率 / 特殊元素。
  // ctx.left / ctx.scoreMult 是唯一真源（循环每步都重新读），这样遗物「返还步数」才会真的多走
  const ctx = { grid, rng, left: moves, scoreMult, used: relicUsed || {}, board: null };
  // 遗物 hook 只要 board 的既有四个方法，这里用最薄的适配层把 grid 现场包成 board 接口
  ctx.board = {
    addMoves(n) { const k = Math.max(0, Math.floor(n || 0)); if (k > 0) ctx.left += k; },
    addSpecials(list) { if (Array.isArray(list) && list.length > 0) injectSpecials(grid, ctx.rng, list); },
    setScoreMult(x) { if (Number.isFinite(x) && x > 0) ctx.scoreMult = x; },
    getState() { return { movesLeft: ctx.left, scoreMult: ctx.scoreMult }; },
    getSnapshot() { return { movesLeft: ctx.left, scoreMult: ctx.scoreMult }; },
  };
  const hookCtx = { board: ctx.board, bonus, floor, used: ctx.used, rng };

  /** 任务进度判定：本层累计消除数达到 need 即当场发奖励（不设失败惩罚，见开发方案 5.6） */
  function checkQuest() {
    if (!q || q.done) return;
    if ((collected[q.color] || 0) < q.need) return;
    q.done = true;
    QUEST_SIM[q.rewardId](ctx);
  }

  /** 每次结算后跑遗物的 onStep（走子）与 onUpdate（盘面）；无遗物时零开销 */
  function afterResolve(result) {
    if (!hooks) return;
    hooks.onStep(hookCtx, { cascade: result.maxCascade, gained: result.gained });
    hooks.onUpdate(hookCtx, {
      score: result.gained,
      maxCascade: result.maxCascade,
      collected: result.colors,
      movesLeft: ctx.left,
      cleared: tilesOf(result.colors),
    });
  }

  for (let m = 0; m < ctx.left; m += 1) {
    const list = allValidMoves(grid);
    if (list.length === 0) {
      if (hasMatch(grid)) {
        const res = resolve(grid, { rng, colors, colorMult: ctx.scoreMult, cascadeMax, weights: colorWeights });
        score += res.gained;
        clearedTiles += tilesOf(res.colors);
        blockersCleared += res.blockersCleared || 0;
        addCollected(collected, res.colors);
        checkQuest();
        afterResolve(res);
        continue;
      }
      shuffleBoard(grid, rng);
      m -= 1;
      continue;
    }
    const { a, b } = list[rng.int(list.length)];
    swapCells(grid, a, b);
    const rainbowIndex = [a, b].find((i) => grid.cells[i]?.special === SPECIAL.RAINBOW);
    const result = rainbowIndex == null
      ? resolve(grid, { rng, colors, focus: b, colorMult: ctx.scoreMult, cascadeMax, weights: colorWeights })
      : resolveRainbowSwap(grid, {
        rng, colors, rainbowIndex, targetIndex: rainbowIndex === a ? b : a, colorMult: ctx.scoreMult, cascadeMax,
        weights: colorWeights,
      });
    score += result.gained;
    clearedTiles += tilesOf(result.colors);
    blockersCleared += result.blockersCleared || 0;
    addCollected(collected, result.colors);
    checkQuest();
    afterResolve(result);
    if (!result.resolvable) shuffleBoard(grid, rng);
  }
  const info = { score, collected, blockersCleared, cleared: clearedTiles };
  return {
    score,
    questDone: Boolean(q && q.done),
    questLeft: ctx.left,
    questGot: q ? (collected[q.color] || 0) : 0,
    goalsAllDone: goals ? allGoalsDone(goals, info) : null,
    info,
  };
}

function addCollected(acc, colors) {
  for (const [color, count] of Object.entries(colors || {})) {
    acc[color] = (acc[color] || 0) + count;
  }
}

/** 「颜色 → 个数」字典求和（遗物 onUpdate 的 info.cleared 用） */
function tilesOf(colors) {
  let sum = 0;
  for (const v of Object.values(colors || {})) {
    if (Number.isFinite(v)) sum += v;
  }
  return sum;
}

const base = { colors: 6, moves: 10, scoreMult: 1, cascadeMax: SCORE.cascadeMax, specials: [] };

function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(opts, n = 21, tag = 1) {
  const scores = [];
  for (let s = 0; s < n; s += 1) {
    scores.push(playFloor({ ...base, ...opts, seed: tag * 100003 + s * 7919 }).score);
  }
  return median(scores);
}

console.log('=== 连锁上限在不同颜色数下的收益（10 步，中位分）===');
for (const colors of [6, 4, 3]) {
  const row = [5, 11].map((cap) => measure({ colors, cascadeMax: cap }));
  console.log(`${colors} 色：` + row.map((v, k) => `上限${[5, 11][k]}=${v}`).join('  '));
}

console.log('\n=== 步数增长收益（6 色）===');
for (const moves of [10, 12, 14, 16]) console.log(`${moves} 步 = ${measure({ moves })}`);

console.log('\n=== 注入特殊元素的收益（6 色 10 步）===');
console.log(`无          = ${measure({})}`);
console.log(`2 条状      = ${measure({ specials: [{ kind: 'row', count: 2 }] })}`);
console.log(`2条+2炸     = ${measure({ specials: [{ kind: 'row', count: 2 }, { kind: 'bomb', count: 2 }] })}`);
console.log(`2条+2炸+2球 = ${measure({ specials: [{ kind: 'row', count: 2 }, { kind: 'bomb', count: 2 }, { kind: 'rainbow', count: 2 }] })}`);

// ---- 改机制祝福：颜色权重（「同色磁石」只给 1 号色加权，其余为 1）----
// 关注曲线形状而不是单点值：低色数下权重会把盘面推向「一色独大」，
// 越过某个倍率后连锁密度突变，收益会非线性起飞（这正是叠满上限要卡住的地方）
console.log('\n=== 同色磁石的收益（颜色权重，10 步）===');
for (const colors of [6, 4]) {
  const weight = (mult) => (mult > 1
    ? Array.from({ length: colors }, (_, k) => (k === 0 ? mult : 1))
    : null);
  const line = [1, 1.7, 2.9, 4]
    .map((mult) => `×${mult}=${measure({ colors, colorWeights: weight(mult) }, 61)}`)
    .join('  ');
  console.log(`${colors} 色：${line}`);
}

// ---- 局内任务：把 need 压到必达，量出每个奖励单独值多少分 ----
console.log('\n=== 局内任务三档奖励的收益（6 色 10 步，need 压到必达）===');
const questAll = (rewardId) => measure({ quest: { color: 1, need: 1, rewardId } });
for (const reward of QUEST_REWARDS) {
  console.log(`${reward.icon} ${reward.name} = ${questAll(reward.id)}（对照 无任务 ${measure({ quest: { color: 1, need: 99, rewardId: 'moves' } })}）`);
}

// ---- run 模拟：祝福三选一 + 目标分曲线（直接复用产品代码的祝福池与公式）----

/** 模拟玩家的理性估值：颜色收益由上面的实测中位分折算 */
const CHOICE_VALUE = {
  supply: 0.17,
  focus: 0.25,
  arsenal: 0.12,
  bomber: 0.15,
  rainbow: 0.25,
  scout: 0.2,
  shield: 0.05,
  shuffle: 0.03,
  storm: 0.37,
  barrage: 0.27,
  bloodpact: 0.68,
  magnet: 0.3,
};
const COLOR_GAIN = { 6: 1.37, 5: 3.0 };
/** 每多 1 步的相对收益（由上面「步数增长收益」实测折算：10→16 步 +74%，取保守值） */
const VALUE_PER_STEP = 0.08;
/** 每深 1 层的相对收益折算：深渊回响每张 +8%/层，与其它牌同一口径 */
const ABYSS_PER_FLOOR = 0.08;

function perkValue(perk, bonus, floor, lv = 1) {
  // 等级只放大「单次效果」，所以统一按 valueAt 的比例折算（lv1 为 1 倍，满级约 1.4~1.9 倍）。
  // 不做逐张重测的原因：这里只需要「理性玩家会挑哪张」的相对排序，绝对值由下面的 run 模拟给出
  const scale = valueAt(perk, lv) / valueAt(perk, 1);
  // 两条层数成长轴的价值随层数上涨：理性玩家越深越愿意补这两张
  if (perk.id === 'abyss') return ABYSS_PER_FLOOR * (floor - 1) * scale;
  if (perk.id === 'deepsteps') {
    return VALUE_PER_STEP * Math.floor((floor - 1) / ROGUE.movesPerFloorStep) * scale;
  }
  if (perk.id !== 'minimal') return (CHOICE_VALUE[perk.id] || 0) * scale;
  // 「极简主义」每级多降 1 档颜色，各档收益是相乘关系（见 COLOR_GAIN）
  let v = 1;
  let colors = ROGUE.colors - bonus.colorCut;
  for (let k = 0; k < valueAt(perk, lv); k += 1) {
    colors = Math.max(ROGUE.minColors, colors - 1);
    v *= COLOR_GAIN[colors] || 1;
  }
  return v;
}

/** 战斗层过关金币（开发方案 3.6；与 mode-rogue.rollBattleGold 同源）：普通区间 + 精英 / Boss 加档 */
function battleGold(rng, type) {
  let gold = rng.range(ROGUE_GOLD.perBattle[0], ROGUE_GOLD.perBattle[1]);
  if (type === NODE.ELITE) gold += ROGUE_GOLD.perElite;
  if (type === NODE.BOSS) gold += ROGUE_GOLD.perBoss;
  return gold;
}

function simulateRun(cfg, runSeed) {
  const levelOf = cfg.levelOf || (() => 1);
  // 局外共鸣树：只有 `metaAllOn` 档才注入（等价产品的 startRun → applyMetaBuffs）
  const meta = cfg.metaAllOn ? metaAllOn() : { buffs: {} };
  const bonus = createBonus();
  applyMetaBuffs(bonus, meta);
  // 「时光倒流」：每轮限 1 次本层重打，与产品同源（见 config.js 的 mechanics.rewind）
  let rewindsLeft = mechanicOn(meta, 'rewind') ? mechanicCfg().rewind.retriesPerRun : 0;
  const picks = {};
  const rng = createRng(runSeed);
  let nodeId = null;
  let node = null;
  let floor = 0;
  let sumScore = 0;
  let sumMoves = 0;
  let quests = 0;        // 本层发出的任务数
  let questsDone = 0;    // 达成的任务数
  let eliteFloors = 0;
  let bossFloors = 0;
  let bossKills = 0;     // 已击败的 Boss 数（10/20/30 通过即 +1，上限 3）
  let shapedFloors = 0;  // 抽到异形盘（mask）的层数
  let blockerFloors = 0; // 场上带障碍的层数
  // 精英 / Boss 三选一保底校验采样：实际抽到的最低稀有度（保底违约时记 -1）
  const rarityRank = { common: 0, rare: 1, epic: 2 };
  const rarityBreaches = [];
  let rarityFallbacks = 0; // 门槛池抽满、按设计回退全池的次数（非违约，仅观测供给紧张度）

  // ---- P4 局内金币 + P3 遗物（开发方案 3.5 / 3.6）----
  // cfg.coins === false 关掉整条金币经济（掉落 / 事件收支 / 商店）；cfg.relics === false 关掉遗物产出。
  // 两个开关只服务对照，默认全开 = 产品口径
  const coinsOn = cfg.coins !== false;
  const relicsOn = cfg.relics !== false;
  let coins = ROGUE_GOLD.start;
  const relics = [];
  let hooks = buildRelicHooks(relics);
  let pendingMoves = 0;  // 商店「下一层 +N 步」：只吃下一层，不落进 bonus（mode-rogue.nextFloorMoves 同义）
  let eventsVisited = 0;
  let treasureVisited = 0;
  let restVisited = 0;
  let shopVisited = 0;
  let shopBuys = 0;
  let goldEarned = 0;    // 本轮到手金币（含遗物倍率，不含返还）
  let goldSpent = 0;     // 本轮花掉金币（商店）
  let relicsFound = 0;
  let chestOpens = 0;    // Boss 遗物宝箱次数
  let forgeCount = 0;    // 篝火锻造次数
  let restShields = 0;   // 篝火休整（免死 +1）次数

  function refreshHooks() { hooks = buildRelicHooks(relics); }

  /** 加金币的唯一入口（与 mode-rogue.addCoins 同口径：goldMult 只放大正向获取，下限夹 0） */
  function addCoins(n) {
    if (!coinsOn) return coins;
    const delta = Math.round(n || 0);
    const scaled = delta > 0 ? Math.round(delta * hooks.mods.goldMult) : delta;
    const before = coins;
    coins = Math.max(0, coins + scaled);
    if (delta > 0) goldEarned += coins - before;
    else if (delta < 0) goldSpent += before - coins;
    return coins;
  }

  function gainGold(n) {
    if (!(n > 0)) return 0;
    const before = coins;
    addCoins(n);
    return coins - before;
  }

  /** 授予一件遗物（与 mode-rogue.grantRelic 同源）；池空 / 已拥有返回 null */
  function grantRelic(spec) {
    if (!relicsOn) return null;
    let relic = null;
    if (typeof spec === 'string' && spec !== 'random') relic = relicById(spec);
    else if (spec && typeof spec === 'object' && spec.id) relic = relicById(spec.id);
    else relic = rollRelic(rng, relics, spec && typeof spec === 'object' && spec.rarity ? { rarity: spec.rarity } : {});
    if (!relic || relics.includes(relic.id)) return null;
    relics.push(relic.id);
    refreshHooks();
    grantOnAcquire(relic.id, { bonus }); // once 类效果获得时立即结算；perFloor 类等下一层 onFloorStart
    relicsFound += 1;
    return relic.id;
  }

  /** 立即授予一张祝福（事件 / 宝藏 / 商店买祝福的出口；与 mode-rogue.grantPerk 同源） */
  function grantPerk(opts = {}) {
    const rank = { common: 0, rare: 1, epic: 2 };
    const eligible = (p) => (!opts.rarity || p.rarity === opts.rarity)
      && (!opts.minRarity || (rank[p.rarity] ?? 0) >= (rank[opts.minRarity] ?? 0))
      && (picks[p.id] || 0) < p.max;
    let perk = null;
    if (opts.id) {
      perk = PERKS.find((p) => p.id === opts.id) || null;
      if (perk && !eligible(perk)) perk = null;
    } else {
      const pool = PERKS.filter(eligible);
      perk = pool.length > 0 ? pool[rng.int(pool.length)] : null;
    }
    if (!perk) return null;
    picks[perk.id] = (picks[perk.id] || 0) + 1;
    perk.apply(bonus, { lv: levelOf(perk), rng });
    return perk;
  }

  /** 事件 / 商店的 ctx（与 mode-rogue.runCtx 同形，事件表的 when / apply 可直接跑） */
  function runCtx() {
    return {
      rng,
      floor,
      depth: floor,
      bonus,
      picks,
      getCoins: () => coins,
      addCoins,
      getRelics: () => [...relics],
      hasRelic: (id) => relics.includes(id),
      grantRelic,
      grantPerk,
      addMoves: (n) => { bonus.moves += Math.round(n || 0); },
      addMovesNextFloor: (n) => { pendingMoves += Math.max(0, Math.round(n || 0)); },
      addShield: (n) => { bonus.shields = Math.max(0, bonus.shields + Math.round(n || 0)); },
      addReroll: () => {},
      banPerk: () => {},
      removePerk: () => {},
      removeRelic: (id) => {
        const at = relics.indexOf(id);
        if (at < 0) return false;
        relics.splice(at, 1);
        refreshHooks();
        return true;
      },
    };
  }

  /**
   * 理性选路：Boss 必经；其余按「宝藏 > 精英 > 商店（买得起一件遗物）> 篝火 > 事件 > 普通战斗」取最高分。
   * 这是个偏贪心的策略——刻意偏向能滚雪球的经济 / 机制节点，用来暴露「新系统是否把层数抬飞」
   */
  function chooseNode(open) {
    const boss = open.find((n) => n.type === NODE.BOSS);
    if (boss) return boss;
    const cheapRelic = priceOf({ kind: 'relic', rarity: 'common' }, { shopDiscount: hooks.mods.shopDiscount });
    const value = (n) => {
      if (n.type === NODE.TREASURE) return 5;
      if (n.type === NODE.ELITE) return 4;
      if (n.type === NODE.SHOP) return coins >= cheapRelic ? 3 : 0;
      if (n.type === NODE.REST) return Object.keys(picks).length > 0 ? 2.5 : 1.5;
      if (n.type === NODE.EVENT) return 2;
      return 1; // 普通战斗
    };
    let best = open[0];
    let bestV = -1;
    for (const n of open) {
      const v = value(n);
      if (v > bestV) { bestV = v; best = n; }
    }
    return best;
  }

  /**
   * 事件（3.4）：取「首个可得且非离开」的选项。事件表把主要收益项排在第一，不做逐条估值——
   * 那会让标定脚本自己长成第二套平衡口径。取收益项也偏乐观，正好用来暴露失控
   */
  function visitEvent() {
    eventsVisited += 1;
    const state = { depth: floor, coins, relics: [...relics], picks };
    const event = rollEvent(rng, state);
    if (!event) return;
    const choices = availableChoices(event, state);
    const use = choices.find((c) => !isLeaveChoice(c)) || choices[0];
    applyChoice(event, choices.indexOf(use), runCtx());
  }

  /** 宝藏（3.7）：白拿一件随机遗物；遗物集齐回落祝福，再落空给金币 */
  function visitTreasure() {
    treasureVisited += 1;
    const relic = relicsOn ? rollRelic(rng, relics) : null;
    if (relic) { grantRelic({ id: relic.id }); return; }
    if (grantPerk({})) return;
    gainGold(ROGUE_GOLD.perBattle[1]);
  }

  /** 篝火（3.7）：锻造（把估值最高的已获祝福再叠一层）优先，否则休整免死 +1 */
  function visitRest() {
    restVisited += 1;
    let best = null;
    let bestV = -1;
    for (const id of Object.keys(picks)) {
      const perk = PERKS.find((p) => p.id === id);
      if (!perk) continue;
      const v = perkValue(perk, bonus, floor, levelOf(perk));
      if (v > bestV) { bestV = v; best = perk; }
    }
    if (best) {
      best.apply(bonus, { lv: levelOf(best), rng }); // 与 mode-rogue 的锻造同源：重跑一次 apply
      forgeCount += 1;
    } else {
      bonus.shields += 1;
      restShields += 1;
    }
  }

  /** 商店（3.6）：贪心买——遗物（机制引擎）> 免死 > 步数；买不起就停。不模拟刷新 / 封禁 */
  function visitShop() {
    shopVisited += 1;
    const mods = { shopDiscount: hooks.mods.shopDiscount };
    const shelf = shelfWithPrices(rollShelf(rng, {
      depth: floor, coins, picks, relics: [...relics], bannedPerkIds: [], removedThisRun: 0,
    }, {}), mods);
    const buy = (item) => {
      if (!item || item.sold === true) return false;
      const res = buyItem(runCtx(), item, mods);
      if (res.ok) shopBuys += 1;
      return res.ok;
    };
    const relicItems = shelf.filter((it) => it.kind === 'relic' && !it.sold).sort((a, b) => a.price - b.price);
    for (const it of relicItems) {
      if (relics.length >= ROGUE_RELIC.slotMax) break;
      buy(it);
    }
    for (const service of ['shield', 'moves']) {
      const item = shelf.find((it) => it.kind === 'service' && it.service === service && !it.sold);
      if (item) buy(item);
    }
  }

  // 地图在一切消耗随机序列的操作之前生成，与 mode-rogue.startRun 同序（同 seed 可复现）。
  // P2/P4 上线后放行全部节点类型（事件 / 商店 / 宝藏 / 篝火）；cfg.nodes === false 回到旧世界只跑战斗节点
  const map = generateMap(rng, { newPlayer: false, enabled: cfg.nodes === false ? P0_ENABLED : ALL_ENABLED });
  nodeId = map.start[0];
  completeNode(map, nodeId);

  /** 结束本轮并汇总（cleared = 已通过的最深层数；通关 30） */
  function finish(cleared, won = false) {
    return {
      floor, cleared, won,
      perMove: sumMoves > 0 ? sumScore / sumMoves : 0,
      totalScore: sumScore,
      totalMoves: sumMoves,
      quests,
      questsDone,
      eliteFloors,
      bossFloors,
      bossKills,
      rarityBreaches,
      rarityFallbacks,
      shapedFloors,
      blockerFloors,
      // P3 / P4：金币与遗物的产出 / 消耗，以及新节点被踩到的次数
      coins,
      goldEarned,
      goldSpent,
      relics: relics.length,
      relicsFound,
      chestOpens,
      forgeCount,
      restShields,
      eventsVisited,
      treasureVisited,
      restVisited,
      shopVisited,
      shopBuys,
    };
  }

  for (; ;) {
    // ---- 地图选路：Boss 必经，其余走 chooseNode 的理性优先级 ----
    const open = map.nodes.filter((n) => n.state === 'open');
    if (open.length === 0) return finish(map.depth, true); // 最终 Boss 已过：通关
    node = chooseNode(open);
    advanceTo(map, nodeId, node.id);
    nodeId = node.id;
    floor = node.depth;
    if (floor > cfg.maxFloor) return finish(cfg.maxFloor);
    if (node.type === NODE.ELITE) eliteFloors += 1;
    if (node.type === NODE.BOSS) bossFloors += 1;

    // ---- 非战斗节点（3.4 / 3.6 / 3.7）：不掷盘面，办完即开下游 ----
    if (node.type === NODE.EVENT || node.type === NODE.SHOP
      || node.type === NODE.TREASURE || node.type === NODE.REST) {
      if (node.type === NODE.EVENT) visitEvent();
      else if (node.type === NODE.SHOP) visitShop();
      else if (node.type === NODE.TREASURE) visitTreasure();
      else visitRest();
      if (cfg.trace) cfg.trace({ floor, node: node.type, nodeVisit: true, relics: relics.length, coins });
      completeNode(map, nodeId);
      continue;
    }

    // ---- 战斗类节点：遗物每层开局（重放 perFloor grant，幂等；used 计数只在层内用）----
    if (relicsOn) hooks.onFloorStart({ board: null, bonus, floor, used: {}, rng });
    // ---- 本层地形 / 目标 / 任务（与 mountFloor 完全相同的生成顺序）----
    const useTerrain = cfg.terrain !== false;
    const terrain = useTerrain ? terrainFor(node, rng) : null;
    const probe = floorOptions(bonus, floor, terrain);
    const goals = useTerrain
      ? floorGoals(node, bonus, rng, { colors: probe.colors, terrain })
      : [{ type: 'score', target: goalOf(floor, bonus) }]; // 对照基线：旧版满盘 + 单一分数目标
    const opts = floorOptions(bonus, floor, terrain);
    // 商店买来的「下一层 +N 步」只吃这一层（mode-rogue.nextFloorMoves 同义）
    const extraMoves = pendingMoves;
    pendingMoves = 0;
    const floorMoves = opts.moves + extraMoves;
    if (terrain?.mask) shapedFloors += 1;
    if ((terrain?.blockers || []).length > 0) blockerFloors += 1;
    // 局内任务：与产品同源（同一 runRng 掷颜色与奖励，见 perks.js 的 questFor）
    const quest = cfg.quest === false ? null : questFor(floor, bonus, rng);
    const questCfg = quest ? { color: quest.color, need: quest.need, rewardId: quest.reward.id } : null;
    if (questCfg) quests += 1;

    // 每层 3 次采样取中位，降低单次随机噪声对「能打到几层」的干扰；
    // 每样本一份独立的遗物触发计数（一个样本 = 一次独立尝试）。
    // 免死 / 时光倒流都**不重掷盘面**：免死按产品口径给本层补 ROGUE.shieldMoves 步后重打
    // （盘面与随机序列不变，只是多走几步），时光倒流才换一条随机序列重打。
    // 两者都只消耗有限资源（护盾只在每层开局由遗物补足），循环必然收敛
    let finalMoves = floorMoves;
    let seedShift = 0;
    let plays;
    for (; ;) {
      plays = [0, 1, 2].map((k) => playFloor({
        ...opts, moves: finalMoves, goals, quest: questCfg,
        seed: runSeed + floor * 977 + k * 31 + seedShift,
        hooks: relicsOn ? hooks : null, relicUsed: {}, floor, bonus,
      }));
      if (plays.filter((p) => p.goalsAllDone === true).length >= 2) break;
      if (bonus.shields > 0) {
        bonus.shields -= 1;
        finalMoves += ROGUE.shieldMoves; // 免死：本层补步继续
        continue;
      }
      if (rewindsLeft > 0) {
        rewindsLeft -= 1;
        seedShift += 7919; // 时光倒流：换一条随机序列重打本层
        continue;
      }
      return finish(floor - 1);
    }
    const score = median(plays.map((p) => p.score));
    if (plays.filter((p) => p.questDone).length >= 2) questsDone += 1;
    sumScore += score;
    sumMoves += finalMoves;
    if (cfg.trace) {
      const scoreGoal = goals.find((g) => g.type === 'score');
      cfg.trace({
        floor, node: node.type,
        score,
        ratio: scoreGoal ? score / scoreGoal.target : null,
        moves: finalMoves,
        colors: opts.colors, scoreMult: opts.scoreMult,
        shape: terrain?.shapeName || '满盘',
        blockers: (terrain?.blockers || []).length,
        goals: goals.map(goalShort).join(' / '),
        magnet: opts.colorWeights ? opts.colorWeights.findIndex((w) => w > 1) + 1 : 0,
        quest: questCfg
          ? `${questCfg.rewardId} 收 ${median(plays.map((p) => p.questGot))}/${questCfg.need}`
          + ` 达成 ${plays.filter((p) => p.questDone).length}/3`
          : '—',
        relics: relics.length,
        coins,
      });
    }
    // 过关金币掉落（3.6）：战斗区间 + 精英 / Boss 加档 + 余步折算（有上限）。金币只在本轮有效
    const leftMoves = median(plays.map((p) => p.questLeft));
    const drop = battleGold(rng, node.type);
    const refund = leftMoves > 0
      ? Math.min(ROGUE_GOLD.moveRefundMax, Math.round(leftMoves * ROGUE_GOLD.moveRefund * hooks.mods.moveRefundMult))
      : 0;
    gainGold(drop + refund);

    // 三选一：理性挑一张。第 1 层若点亮了「先手规划」，本层连抽 2 次（多拿一张，层数只推进 1）
    // 精英层保底 rare、Boss 层保底 epic（mode-rogue.onFloorCleared 同口径的 minRarity）
    const bossDef = node.type === NODE.BOSS ? bossAt(floor) : null;
    const minRarity = node.type === NODE.ELITE
      ? 'rare'
      : bossDef ? bossDef.rewardRarity : null;
    if (bossDef) bossKills = Math.min(3, bossKills + 1);
    const draws = floor === 1 && mechanicOn(meta, 'planning')
      ? Math.max(1, mechanicCfg().planning.firstFloorPicks)
      : 1;
    // 遗物「宽幅选择」给三选一多加选项（mode-rogue.rollChoicesFor 同源）
    const choices = ROGUE.perkChoices + (relicsOn ? hooks.mods.extraChoices : 0);
    for (let d = 0; d < draws; d += 1) {
      const offered = rollPerks(rng, picks, undefined, { minRarity, choices });
      if (offered.length === 0) {
        completeNode(map, nodeId);
        return finish(floor);
      }
      // 保底校验：精英 / Boss 层三张牌都不得低于门槛；
      // 但门槛池被本轮 picks 抽满（全部达 perk.max）时产品按设计回退全池，不算违约
      if (minRarity) {
        const floorRank = rarityRank[minRarity];
        const worst = Math.min(...offered.map((p) => rarityRank[p.rarity] ?? 0));
        const pickedTotal = Object.values(picks).reduce((s, n) => s + (n || 0), 0);
        const guaranteedLeft = PERKS.filter((p) =>
          (picks[p.id] || 0) < p.max
          && !(pickedTotal < ROGUE.friendlyPicks && !p.growth)
          && (rarityRank[p.rarity] ?? 0) >= floorRank,
        );
        if (guaranteedLeft.length > 0 && worst < floorRank) {
          rarityBreaches.push({ floor, node: node.type, minRarity, got: offered.map((p) => p.rarity) });
        } else if (guaranteedLeft.length === 0) {
          rarityFallbacks += 1;
        }
      }
      let pick = offered[0];
      let best = -1;
      for (const perk of offered) {
        const v = perkValue(perk, bonus, floor, levelOf(perk));
        if (v > best) { best = v; pick = perk; }
      }
      picks[pick.id] = (picks[pick.id] || 0) + 1;
      // 与产品同源：选牌时把局外等级与 runRng 一起交给 apply
      // （等级决定这张牌这一轮有多强、「同色磁石」靠 rng 锁色）
      pick.apply(bonus, { lv: levelOf(pick), rng });
    }
    // Boss 遗物宝箱（3.5）：祝福选完再开，三选一取稀有度最高的一件（与 mode-rogue 同序）
    if (bossDef) {
      const chest = rollRelicChoices(rng, relics, ROGUE_RELIC.choices);
      if (chest.length > 0) {
        chestOpens += 1;
        const best = chest.reduce((a, b) => (rarityRank[b.rarity] > rarityRank[a.rarity] ? b : a));
        grantRelic({ id: best.id });
      }
    }
    // 本层结算完成 → 打开下游（等价 mode-rogue.gotoMapAfterNode → completeNode）
    completeNode(map, nodeId);
  }
}

function scan(cfg, runs = 12) {
  const floors = [];
  const perMoves = [];
  const totals = [];
  let firstFloorFails = 0;
  let quests = 0;
  let questsDone = 0;
  let wins = 0;
  let shapedSum = 0;
  let blockerSum = 0;
  let eliteSum = 0;
  let bossSum = 0;
  let bossKillSum = 0;
  let fallbackSum = 0;
  // P3 / P4：金币与遗物产出 / 消耗、新节点踩点次数
  let goldEarned = 0;
  let goldSpent = 0;
  let relicSum = 0;
  let relicFoundSum = 0;
  let chestSum = 0;
  let forgeSum = 0;
  let eventsSum = 0;
  let treasureSum = 0;
  let restSum = 0;
  let shopSum = 0;
  let shopBuySum = 0;
  const breaches = [];
  for (let r = 0; r < runs; r += 1) {
    const res = simulateRun({ ...cfg, maxFloor: 50 }, 20260920 + r * 1013);
    floors.push(res.cleared);
    perMoves.push(res.perMove);
    totals.push(res.totalScore);
    quests += res.quests;
    questsDone += res.questsDone;
    if (res.cleared === 0) firstFloorFails += 1;
    if (res.won) wins += 1;
    shapedSum += res.shapedFloors || 0;
    blockerSum += res.blockerFloors || 0;
    eliteSum += res.eliteFloors || 0;
    bossSum += res.bossFloors || 0;
    bossKillSum += res.bossKills || 0;
    fallbackSum += res.rarityFallbacks || 0;
    goldEarned += res.goldEarned || 0;
    goldSpent += res.goldSpent || 0;
    relicSum += res.relics || 0;
    relicFoundSum += res.relicsFound || 0;
    chestSum += res.chestOpens || 0;
    forgeSum += res.forgeCount || 0;
    eventsSum += res.eventsVisited || 0;
    treasureSum += res.treasureVisited || 0;
    restSum += res.restVisited || 0;
    shopSum += res.shopVisited || 0;
    shopBuySum += res.shopBuys || 0;
    for (const b of res.rarityBreaches || []) breaches.push({ run: r, ...b });
  }
  const sorted = [...floors].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    firstFloorFails,
    wins,
    avgShaped: shapedSum / runs,
    avgBlockerFloors: blockerSum / runs,
    avgElite: eliteSum / runs,
    avgBoss: bossSum / runs,
    avgBossKills: bossKillSum / runs,
    rarityFallbacks: fallbackSum,
    breaches,
    maxPerMove: Math.max(...perMoves),
    medianTotal: median(totals),
    questRate: quests > 0 ? questsDone / quests : 0,
    avgGoldEarned: goldEarned / runs,
    avgGoldSpent: goldSpent / runs,
    avgRelics: relicSum / runs,
    avgRelicsFound: relicFoundSum / runs,
    avgChests: chestSum / runs,
    avgForges: forgeSum / runs,
    avgEvents: eventsSum / runs,
    avgTreasure: treasureSum / runs,
    avgRest: restSum / runs,
    avgShop: shopSum / runs,
    avgShopBuys: shopBuySum / runs,
  };
}

console.log('\n=== 出货配置的层数分布（16 次 run，节点地图 + 区域地形 + 多目标）===');
console.log(`ROGUE: baseGoal=${ROGUE.baseGoal} growth=${ROGUE.goalGrowth} weight=${ROGUE.perkGoalWeight} `
  + `colors=${ROGUE.colors}/${ROGUE.minColors} moves=${ROGUE.movesPerFloor}+1/${ROGUE.movesPerFloorStep}层 `
  + `friendlyPicks=${ROGUE.friendlyPicks}`);
try {
  const st = scan({}, 16);
  console.log(`中位 ${st.median} 层 · p25 ${st.p25} · 最低 ${st.min} · 最高 ${st.max} · 首层翻车 ${st.firstFloorFails}/16 · 通关 ${st.wins}/16`);
  console.log(`地形采样：异形盘均 ${st.avgShaped.toFixed(1)} 层/run · 带障碍层均 ${st.avgBlockerFloors.toFixed(1)} `
    + `· 精英均 ${st.avgElite.toFixed(1)} · Boss 均 ${st.avgBoss.toFixed(1)}`);
  console.log(`Boss：平均击败 ${st.avgBossKills.toFixed(2)}/3 · 通关率 ${(st.wins / 16 * 100).toFixed(0)}%`
    + ` · 保底违约 ${st.breaches.length} 次 · 保底池抽满回退 ${st.rarityFallbacks} 次`
    + `${st.breaches.length > 0 ? `（${JSON.stringify(st.breaches.slice(0, 3))}）` : ''}`);
  console.log(`局内任务达成率 ${(st.questRate * 100).toFixed(0)}%（need 曲线 ${ROGUE.quest.baseNeed}×${ROGUE.quest.needGrowth}^层）`);
  console.log(`整轮总分中位 ${Math.round(st.medianTotal)}（总分只用于展示与反刷分：经验与精华都按层数结算）`);
  // 反刷分上限是 rogueMaxScorePerMove（肉鸽已放开到 300000，见 server/config.js），这里看整轮均步得分还有多少余量
  console.log(`整轮均步得分最高 ${Math.round(st.maxPerMove)}（反刷分上限 ${MAX_SCORE_PER_MOVE}，余量 ${(MAX_SCORE_PER_MOVE / st.maxPerMove).toFixed(1)} 倍）`);
  // 结算尺度：精华 ⌊层数²/divisor⌋、经验 ⌊层数²×factor⌋，两者都再乘对应的局外增益
  console.log(`按中位层数结算：精华 +${essenceAt(st.median)}（÷${ROGUE_META.essenceDivisor}）`
    + ` · 经验 +${expAt(st.median)}（×${EXP_FLOOR_FACTOR}）`);

  // P3 / P4（开发方案 3.5 / 3.6）：金币与遗物的产出 / 消耗、新节点踩点次数
  console.log(`经济与遗物：到手金币均 ${Math.round(st.avgGoldEarned)} · 花掉均 ${Math.round(st.avgGoldSpent)} `
    + `· 遗物均 ${st.avgRelics.toFixed(1)} 件（本轮共获得 ${st.avgRelicsFound.toFixed(1)}）`);
  console.log(`新节点踩点：事件均 ${st.avgEvents.toFixed(1)} · 宝藏均 ${st.avgTreasure.toFixed(1)} `
    + `· 篝火均 ${st.avgRest.toFixed(1)}（锻造 ${st.avgForges.toFixed(1)}）`
    + ` · 商店均 ${st.avgShop.toFixed(1)}（买 ${st.avgShopBuys.toFixed(1)} 件） · Boss 宝箱均 ${st.avgChests.toFixed(1)}`);

  // 旧世界对照（3.4 / 3.5 / 3.6 / 3.7 全关）：mapgen 只放行战斗 / 精英 / Boss。
  // 这是「P2/P3/P4 之前」的真实基线，差值即三个新系统整体的强度贡献
  const oldWorld = scan({ nodes: false }, 16);
  console.log(`旧世界对照（只跑战斗节点）：中位 ${oldWorld.median} 层 · 通关 ${oldWorld.wins}/16`
    + ` · 整轮总分中位 ${Math.round(oldWorld.medianTotal)}`
    + `（新系统带来的层数 ${st.median - oldWorld.median} 层、总分 ${((st.medianTotal / oldWorld.medianTotal - 1) * 100).toFixed(0)}%）`);

  // 只关遗物：事件 / 宝藏 / 商店 / 篝火仍在，但它们退化成金币 / 祝福 / 免死收益。
  // 差值即「机制引擎（流派）这一层」单独的强度贡献
  const noRelic = scan({ relics: false }, 16);
  console.log(`关掉遗物对照：中位 ${noRelic.median} 层 · 整轮总分中位 ${Math.round(noRelic.medianTotal)}`
    + `（遗物 / 流派带来的层数 ${st.median - noRelic.median} 层、总分 ${((st.medianTotal / noRelic.medianTotal - 1) * 100).toFixed(0)}%）`);

  // 只关金币：战斗掉落与事件收支全断，商店买不了东西（事件里带金币成本的选项也随之失效）
  const noGold = scan({ coins: false }, 16);
  console.log(`关掉金币对照：中位 ${noGold.median} 层 · 整轮总分中位 ${Math.round(noGold.medianTotal)}`
    + `（金币经济带来的层数 ${st.median - noGold.median} 层、总分 ${((st.medianTotal / noGold.medianTotal - 1) * 100).toFixed(0)}%）`);

  // 3.2 对照：关掉地形与多目标（旧版 8×8 满盘 + 单一分数目标，其余完全一致），
  // 差值即「区域地形 + 多目标」整体的难度贡献；同时用精英/Boss 计数确认两条管线跑到的节点构成
  const flat = scan({ terrain: false }, 16);
  console.log(`旧版满盘单目标对照：中位 ${flat.median} 层 · 通关 ${flat.wins}/16 · 整轮总分中位 ${Math.round(flat.medianTotal)}`
    + `（地形/多目标带来的层数变化 ${st.median - flat.median} 层、总分 ${((st.medianTotal / flat.medianTotal - 1) * 100).toFixed(0)}%）`);

  // 关掉局内任务再跑一遍：差值就是「任务机制」整体的强度贡献
  const off = scan({ quest: false }, 16);
  console.log(`关掉局内任务对照：中位 ${off.median} 层 · 整轮总分中位 ${Math.round(off.medianTotal)}`
    + `（任务带来的层数增益 ${st.median - off.median} 层、总分 ${((st.medianTotal / off.medianTotal - 1) * 100).toFixed(0)}%）`);

  // 局外养成的两档对照：全 lv1（未养成的基线）vs 全满级。
  // 这里的差值就是「把图鉴点亮/升满」能换来的强度，是精华定价（unlockCost / upgradeCost）的标定依据：
  // 差值太大 → 不养成的人寸步难行；太小 → 养成没有意义
  const maxed = scan({ levelOf: maxLevelOf }, 16);
  console.log(`全满级对照：中位 ${maxed.median} 层 · 整轮总分中位 ${Math.round(maxed.medianTotal)}`
    + `（相对全 lv1：层数 +${maxed.median - st.median}、总分 ${((maxed.medianTotal / st.medianTotal - 1) * 100).toFixed(0)}%）`);

  // 共鸣树（v1.19）单独一档：局外增益跨轮常驻，与祝福等级是两个独立的成长轴。
  // 树里唯一会往上抬层数的是「先手规划」（第 1 层步数 ×2 + 多一张祝福）与「时光倒流」（每轮多 1 次重打），
  // 两者都是一次性机制、不可升级，所以这一档的作用是确认「全点亮也不会把层数抬飞」
  const tree = scan({ metaAllOn: true }, 16);
  console.log(`共鸣树全点亮：中位 ${tree.median} 层 · 整轮总分中位 ${Math.round(tree.medianTotal)}`
    + `（相对全 lv1：层数 +${tree.median - st.median}、总分 ${((tree.medianTotal / st.medianTotal - 1) * 100).toFixed(0)}%）`);
  const full = scan({ metaAllOn: true, levelOf: maxLevelOf }, 16);
  console.log(`树 + 祝福全满：中位 ${full.median} 层 · 整轮总分中位 ${Math.round(full.medianTotal)}`
    + `（相对全 lv1：层数 +${full.median - st.median}、总分 ${((full.medianTotal / st.medianTotal - 1) * 100).toFixed(0)}%）`);

  // 经验改按层数结算后，满级的收益放大只体现在「多打的那几层」上，
  // 不再被总分放大（否则 72 倍总分 = 72 倍经验，见开发方案 5.7 的遗留风险）
  console.log(`经验尺度对照：全 lv1 +${expAt(st.median)} → 全满级 +${expAt(maxed.median)}`
    + `（${(expAt(maxed.median) / expAt(st.median)).toFixed(2)} 倍；再乘「经验共鸣」最多 ×${buffMaxFactor('expboost')}，合计约 `
    + `${((expAt(maxed.median) / expAt(st.median)) * buffMaxFactor('expboost')).toFixed(2)} 倍）`);
  // 精华同理：`丰收闭环` 是按层数的定额（⌊层数 × 2⌋），层数不失控它就不会失控
  console.log(`精华尺度对照：中位层基础 +${essenceAt(st.median)} → 「精华共鸣」满级 ×${buffMaxFactor('essenceboost')}`
    + ` 即 +${Math.floor(essenceAt(maxed.median) * buffMaxFactor('essenceboost'))}`
    + `，再叠加「丰收闭环」定额 +⌊${maxed.median} × 2⌋ = +${maxed.median * 2}`);
} catch (err) {
  console.log('模拟出错：' + err.message);
  console.log(err.stack);
}

// 单次 run 的逐层曲线：看「可达分」是否随层数上涨（横盘 = 深层没有成长来源）
function traceRun(cfg, runSeed) {
  const rows = [];
  const res = simulateRun({ ...cfg, trace: (row) => rows.push(row) }, runSeed);
  console.log(`\n=== 单次 run 逐层曲线（结束于第 ${res.floor} 层${res.won ? ' · 通关' : ''}）===`);
  console.log('层 | 节点 | 地形     | 障碍 | 目标                      | 可达中位 | 分数率 | 步数 颜色 倍率 磁石 任务 | 遗物 🪙');
  const NODE_TAG = {
    battle: '战', elite: '精', boss: 'Boss',
    event: '事件', shop: '商店', treasure: '宝藏', rest: '篝火',
  };
  for (const r of rows) {
    // 非战斗节点没有盘面数据，单独一行（只报遗物 / 金币存量）
    if (r.nodeVisit) {
      console.log(
        `${String(r.floor).padStart(2)} | ${(NODE_TAG[r.node] || r.node).padEnd(4)} | `
        + `${'—'.padEnd(8)} |  — | ${'（非战斗节点）'.padEnd(25)} | ${'—'.padStart(8)} |   —   | `
        + `${'—'} | ${String(r.relics).padStart(2)} 件 ${r.coins} 🪙`,
      );
      continue;
    }
    console.log(
      `${String(r.floor).padStart(2)} | ${(NODE_TAG[r.node] || r.node).padEnd(4)} | `
      + `${r.shape.padEnd(8)} | ${String(r.blockers).padStart(2)} | ${r.goals.padEnd(25)} | `
      + `${String(r.score).padStart(8)} | ${r.ratio == null ? '  — ' : r.ratio.toFixed(2).padStart(5)} | `
      + `${r.moves} 步 ${r.colors} 色 ×${r.scoreMult.toFixed(2)} `
      + `${r.magnet ? `${r.magnet} 号色` : '—'} ${r.quest} | ${String(r.relics).padStart(2)} 件 ${r.coins} 🪙`,
    );
  }
}
try {
  traceRun({ maxFloor: 50 }, 20260920 + 5 * 1013);
} catch (err) {
  console.log('逐层曲线出错：' + err.message);
  console.log(err.stack);
}

console.log('\n=== 3.3 精英/Boss 胜利闭环标定 ===');
try {
  // 三个 Boss：血量目标（相对同层普通目标的倍率）+ 固定机关盘的障碍构成
  const emptyBonus = createBonus();
  for (const id of ROGUE_BOSS_ORDER) {
    const def = ROGUE_BOSSES[id];
    const hp = bossHpTarget(def, emptyBonus);
    const ordinary = goalOf(def.depth, emptyBonus);
    const terrain = bossTerrain(def, createRng(20260920));
    const kinds = {};
    for (const b of terrain.blockers) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
    console.log(`${def.name}（${def.depth}层）：HP ${hp} = 同层目标 ${ordinary} ×${def.hpMult}`
      + ` · 机关 ${terrain.blockers.length} 个 ${JSON.stringify(kinds)} · 保底 ${def.rewardRarity}`);
  }

  // 保底稀有度大样本：空 picks（全池可抽）下，精英的三张牌必 ≥rare、Boss 必 ≥epic
  const RANK = { common: 0, rare: 1, epic: 2 };
  for (const [tag, minRarity] of [['精英', 'rare'], ['Boss', 'epic']]) {
    let bad = 0;
    const N = 500;
    for (let s = 0; s < N; s += 1) {
      const offered = rollPerks(createRng(77000 + s), {}, undefined, { minRarity });
      if (offered.length === 0 || Math.min(...offered.map((p) => RANK[p.rarity])) < RANK[minRarity]) bad += 1;
    }
    console.log(`${tag}层保底 ${minRarity}：${N} 次三选一违约 ${bad} 次（应为 0；池抽空时产品回退全池，属预期）`);
  }

  // 胜利 / 深渊精华尺度：通关 30 层 = 基础 180 + winBonus；深渊基础封 30，增量调和收敛
  const e30 = essenceForRun(30, null, { win: true });
  const e35 = essenceForRun(35, null, { win: true });
  const e50 = essenceForRun(50, null, { win: true });
  console.log(`精华：30层通关 +${e30} · 35层撤离 +${e35} · 50层撤离 +${e50}`
    + `（winBonus=${ROGUE_META.winBonus}，深渊增量调和收敛；未通关不发这两笔）`);
  console.log(`未通关对照：31 层（异常路径）仍只按封顶基础 +${essenceForRun(31)} 计，与 30 层一致`);
} catch (err) {
  console.log('胜利闭环标定时出错：' + err.message);
  console.log(err.stack);
}

console.log('\n=== 各层目标分对照（无祝福 / 满 4 张侦察报告）===');
for (const floor of [1, 3, 5, 8, 10, 13, 16, 20, 25]) {
  const empty = createBonus();
  const scout = createBonus();
  scout.goalCut = 0.72;
  console.log(`第 ${String(floor).padStart(2)} 层：目标 ${String(goalOf(floor, empty)).padStart(9)}   减免后 ${String(goalOf(floor, scout)).padStart(9)}`);
}
