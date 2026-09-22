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
import { SCORE, SPECIAL, ROGUE } from '../src/games/match3/config.js';
import { QUEST_REWARDS, createBonus, floorOptions, goalOf, questFor, rollPerks } from '../src/games/match3/perks.js';

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

function perkValue(perk, bonus, floor) {
  // 两条层数成长轴的价值随层数上涨：理性玩家越深越愿意补这两张
  if (perk.id === 'abyss') return ABYSS_PER_FLOOR * (floor - 1);
  if (perk.id === 'deepsteps') {
    return VALUE_PER_STEP * Math.floor((floor - 1) / ROGUE.movesPerFloorStep);
  }
  if (perk.id !== 'minimal') return CHOICE_VALUE[perk.id] || 0;
  const next = Math.max(ROGUE.minColors, ROGUE.colors - bonus.colorCut - 1);
  return COLOR_GAIN[next] || 1;
}

function simulateRun(cfg, runSeed) {
  const bonus = createBonus();
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
      const v = perkValue(perk, bonus, floor);
      if (v > best) { best = v; pick = perk; }
    }
    picks[pick.id] = (picks[pick.id] || 0) + 1;
    // 传 rng：产品代码在选牌时把 runRng 交给 apply（「同色磁石」靠它锁色）
    pick.apply(bonus, rng);
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
  console.log(`整轮总分中位 ${Math.round(st.medianTotal)}（经验除数按此标定：exp ≈ 总分 ÷ rogueExpPerScoreDivisor）`);
  // 反刷分上限是 rogueMaxScorePerMove（肉鸽已放开到 200000，见 server/config.js），这里看整轮均步得分还有多少余量
  console.log(`整轮均步得分最高 ${Math.round(st.maxPerMove)}（反刷分上限 200000，余量 ${(200000 / st.maxPerMove).toFixed(1)} 倍）`);

  // 关掉局内任务再跑一遍：差值就是「任务机制」整体的强度贡献
  const off = scan({ quest: false }, 16);
  console.log(`关掉局内任务对照：中位 ${off.median} 层 · 整轮总分中位 ${Math.round(off.medianTotal)}`
    + `（任务带来的层数增益 ${st.median - off.median} 层、总分 ${((st.medianTotal / off.medianTotal - 1) * 100).toFixed(0)}%）`);
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
