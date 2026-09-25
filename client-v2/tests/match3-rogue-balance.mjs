/**
 * 肉鸽试炼数值标定脚本（长期保留，改 `ROGUE` 那组数值前先重跑）
 *
 * 直接 import 产品代码的公式与祝福池（`perks.js` / `config.js`），保证标定口径不漂。
 * 走子策略：枚举全部可行步后随机选一个（比 findValidMove 的首个可行步更接近人类水平）；
 * run 模拟按「每层 3 次采样取中位 + 理性三选一」推进，用来回答「这套数值能打到几层」。
 */
import { createInitialBoard, resolve, resolveRainbowSwap } from '../src/games/match3/cascade.js';
import { hasValidMove, swapCells, shuffleBoard } from '../src/games/match3/deadlock.js';
import { colOf, index, isPlayable, rowOf } from '../src/games/match3/grid.js';
import { hasMatch } from '../src/games/match3/match.js';
import { makeSpecial } from '../src/games/match3/special.js';
import { createRng } from '../src/games/match3/rng.js';
import { SCORE, SPECIAL, ROGUE, ROGUE_META } from '../src/games/match3/config.js';
import {
  META_BUFFS, PERKS, QUEST_REWARDS, createBonus, floorOptions, goalOf, questFor, rollPerks, valueAt,
} from '../src/games/match3/perks.js';
// 局外养成（共鸣树）的推导也直接 import：等级上限、机制节点生效判定、本轮起手的加成注入
// 都只有一份实现，标定口径跟产品完全一致
import { applyMetaBuffs, maxLevelOf, mechanicCfg, mechanicOn } from '../src/games/match3/meta.js';

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
  return { version: 1, essence: 0, perks: {}, buffs, claimed: {}, stats: {} };
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
 *   colorWeights 为各颜色出现权重（肉鸽「同色磁石」），null 表示等概率；
 *   quest 为 { color, need, rewardId }，null 表示本层无任务
 * @returns {{score:number, questDone:boolean, questLeft:number}}
 */
function playFloor({ colors, moves, scoreMult, cascadeMax, specials, seed, colorWeights = null, quest = null }) {
  const rng = createRng(seed);
  const grid = createInitialBoard({ rows: 8, cols: 8, colors, seed, weights: colorWeights }).grid;
  injectSpecials(grid, rng, specials);
  if (!hasValidMove(grid)) shuffleBoard(grid, rng);

  let score = 0;
  let left = moves;
  const collected = {};
  const q = quest ? { ...quest, done: false } : null;
  const ctx = { grid, rng, left, scoreMult };

  /** 任务进度判定：本层累计消除数达到 need 即当场发奖励（不设失败惩罚，见开发方案 5.6） */
  function checkQuest() {
    if (!q || q.done) return;
    if ((collected[q.color] || 0) < q.need) return;
    q.done = true;
    QUEST_SIM[q.rewardId](ctx);
    left = ctx.left;
    scoreMult = ctx.scoreMult;
  }

  for (let m = 0; m < left; m += 1) {
    const list = allValidMoves(grid);
    if (list.length === 0) {
      if (hasMatch(grid)) {
        const res = resolve(grid, { rng, colors, colorMult: scoreMult, cascadeMax, weights: colorWeights });
        score += res.gained;
        addCollected(collected, res.colors);
        checkQuest();
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
      ? resolve(grid, { rng, colors, focus: b, colorMult: scoreMult, cascadeMax, weights: colorWeights })
      : resolveRainbowSwap(grid, {
        rng, colors, rainbowIndex, targetIndex: rainbowIndex === a ? b : a, colorMult: scoreMult, cascadeMax,
        weights: colorWeights,
      });
    score += result.gained;
    addCollected(collected, result.colors);
    checkQuest();
    if (!result.resolvable) shuffleBoard(grid, rng);
  }
  return { score, questDone: Boolean(q && q.done), questLeft: left, questGot: q ? (collected[q.color] || 0) : 0 };
}

function addCollected(acc, colors) {
  for (const [color, count] of Object.entries(colors || {})) {
    acc[color] = (acc[color] || 0) + count;
  }
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

function simulateRun(cfg, runSeed) {
  const levelOf = cfg.levelOf || (() => 1);
  // 局外共鸣树：只有 `metaAllOn` 档才注入（等价产品的 startRun → applyMetaBuffs）
  const meta = cfg.metaAllOn ? metaAllOn() : { buffs: {} };
  const bonus = createBonus();
  applyMetaBuffs(bonus, meta);
  // 「时光倒流」：每轮限 1 次本层重打，与产品同源（见 config.js 的 mechanics.rewind）
  let rewindsLeft = mechanicOn(meta, 'rewind') ? mechanicCfg().rewind.retriesPerRun : 0;
  const picks = {};
  let floor = 1;
  let sumScore = 0;
  let sumMoves = 0;
  let quests = 0;        // 本层发出的任务数
  let questsDone = 0;    // 达成的任务数
  const rng = createRng(runSeed);
  for (; ;) {
    const goal = goalOf(floor, bonus);
    const opts = floorOptions(bonus, floor);
    // 局内任务：与产品同源（同一 runRng 掷颜色与奖励，见 perks.js 的 questFor）
    const quest = cfg.quest === false ? null : questFor(floor, bonus, rng);
    const questCfg = quest ? { color: quest.color, need: quest.need, rewardId: quest.reward.id } : null;
    if (questCfg) quests += 1;

    // 每层 3 次采样取中位，降低单次随机噪声对「能打到几层」的干扰
    const plays = [0, 1, 2].map((k) => playFloor({ ...opts, quest: questCfg, seed: runSeed + floor * 977 + k * 31 }));
    const score = median(plays.map((p) => p.score));
    if (plays.filter((p) => p.questDone).length >= 2) questsDone += 1;
    sumScore += score;
    sumMoves += opts.moves;
    if (cfg.trace) {
      cfg.trace({
        floor, goal, score, ratio: score / goal, moves: opts.moves,
        colors: opts.colors, scoreMult: opts.scoreMult,
        magnet: opts.colorWeights ? opts.colorWeights.findIndex((w) => w > 1) + 1 : 0,
        quest: questCfg
          ? `${questCfg.rewardId} 收 ${median(plays.map((p) => p.questGot))}/${questCfg.need}`
          + ` 达成 ${plays.filter((p) => p.questDone).length}/3`
          : '—',
      });
    }
    if (score < goal) {
      if (bonus.shields > 0) {
        bonus.shields -= 1;
        continue; // 免死：本层重来（近似「补步继续」）
      }
      if (rewindsLeft > 0) {
        rewindsLeft -= 1;
        continue; // 时光倒流：本层重打（每轮限 1 次，用完才判本轮结束）
      }
      return {
        floor,
        cleared: floor - 1,
        perMove: sumMoves > 0 ? sumScore / sumMoves : 0,
        totalScore: sumScore,
        totalMoves: sumMoves,
        quests,
        questsDone,
      };
    }
    // 三选一：理性挑一张。第 1 层若点亮了「先手规划」，本层连抽 2 次（多拿一张，层数只推进 1）
    const draws = floor === 1 && mechanicOn(meta, 'planning')
      ? Math.max(1, mechanicCfg().planning.firstFloorPicks)
      : 1;
    for (let d = 0; d < draws; d += 1) {
      const offered = rollPerks(rng, picks);
      if (offered.length === 0) {
        return {
          floor,
          cleared: floor,
          perMove: sumMoves > 0 ? sumScore / sumMoves : 0,
          totalScore: sumScore,
          totalMoves: sumMoves,
          quests,
          questsDone,
        };
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
    floor += 1;
    if (floor > cfg.maxFloor) {
      return {
        floor,
        cleared: floor - 1,
        perMove: sumMoves > 0 ? sumScore / sumMoves : 0,
        totalScore: sumScore,
        totalMoves: sumMoves,
        quests,
        questsDone,
      };
    }
  }
}

function scan(cfg, runs = 12) {
  const floors = [];
  const perMoves = [];
  const totals = [];
  let firstFloorFails = 0;
  let quests = 0;
  let questsDone = 0;
  for (let r = 0; r < runs; r += 1) {
    const res = simulateRun({ ...cfg, maxFloor: 50 }, 20260920 + r * 1013);
    floors.push(res.cleared);
    perMoves.push(res.perMove);
    totals.push(res.totalScore);
    quests += res.quests;
    questsDone += res.questsDone;
    if (res.cleared === 0) firstFloorFails += 1;
  }
  const sorted = [...floors].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    firstFloorFails,
    maxPerMove: Math.max(...perMoves),
    medianTotal: median(totals),
    questRate: quests > 0 ? questsDone / quests : 0,
  };
}

console.log('\n=== 出货配置的层数分布（16 次 run，上限 50 层）===');
console.log(`ROGUE: baseGoal=${ROGUE.baseGoal} growth=${ROGUE.goalGrowth} weight=${ROGUE.perkGoalWeight} ` +
  `colors=${ROGUE.colors}/${ROGUE.minColors} moves=${ROGUE.movesPerFloor}+1/${ROGUE.movesPerFloorStep}层 ` +
  `friendlyPicks=${ROGUE.friendlyPicks}`);
try {
  const st = scan({}, 16);
  console.log(`中位 ${st.median} 层 · p25 ${st.p25} · 最低 ${st.min} · 最高 ${st.max} · 首层翻车 ${st.firstFloorFails}/16`);
  console.log(`局内任务达成率 ${(st.questRate * 100).toFixed(0)}%（need 曲线 ${ROGUE.quest.baseNeed}×${ROGUE.quest.needGrowth}^层）`);
  console.log(`整轮总分中位 ${Math.round(st.medianTotal)}（总分只用于展示与反刷分：经验与精华都按层数结算）`);
  // 反刷分上限是 rogueMaxScorePerMove（肉鸽已放开到 300000，见 server/config.js），这里看整轮均步得分还有多少余量
  console.log(`整轮均步得分最高 ${Math.round(st.maxPerMove)}（反刷分上限 ${MAX_SCORE_PER_MOVE}，余量 ${(MAX_SCORE_PER_MOVE / st.maxPerMove).toFixed(1)} 倍）`);
  // 结算尺度：精华 ⌊层数²/divisor⌋、经验 ⌊层数²×factor⌋，两者都再乘对应的局外增益
  console.log(`按中位层数结算：精华 +${essenceAt(st.median)}（÷${ROGUE_META.essenceDivisor}）`
    + ` · 经验 +${expAt(st.median)}（×${EXP_FLOOR_FACTOR}）`);

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
  console.log(`\n=== 单次 run 逐层曲线（结束于第 ${res.floor} 层）===`);
  console.log('层 | 目标分  | 可达中位 | 达成率 | 步数 颜色 倍率 磁石 任务');
  for (const r of rows) {
    console.log(
      `${String(r.floor).padStart(2)} | ${String(r.goal).padStart(7)} | ${String(r.score).padStart(8)} | `
      + `${r.ratio.toFixed(2)} | ${r.moves} 步 ${r.colors} 色 ×${r.scoreMult.toFixed(2)} `
      + `${r.magnet ? `${r.magnet} 号色` : '—'} ${r.quest}`,
    );
  }
}
try {
  traceRun({ maxFloor: 50 }, 20260920 + 5 * 1013);
} catch (err) {
  console.log('逐层曲线出错：' + err.message);
  console.log(err.stack);
}

console.log('\n=== 各层目标分对照（无祝福 / 满 4 张侦察报告）===');
for (const floor of [1, 3, 5, 8, 10, 13, 16, 20, 25]) {
  const empty = createBonus();
  const scout = createBonus();
  scout.goalCut = 0.72;
  console.log(`第 ${String(floor).padStart(2)} 层：目标 ${String(goalOf(floor, empty)).padStart(9)}   减免后 ${String(goalOf(floor, scout)).padStart(9)}`);
}
