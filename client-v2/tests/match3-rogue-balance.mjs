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
import { createBonus, floorOptions, goalOf, rollPerks } from '../src/games/match3/perks.js';

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

function playFloor({ colors, moves, scoreMult, cascadeMax, specials, seed }) {
  const rng = createRng(seed);
  const grid = createInitialBoard({ rows: 8, cols: 8, colors, seed }).grid;
  injectSpecials(grid, rng, specials);
  if (!hasValidMove(grid)) shuffleBoard(grid, rng);

  let score = 0;
  for (let m = 0; m < moves; m += 1) {
    const list = allValidMoves(grid);
    if (list.length === 0) {
      if (hasMatch(grid)) {
        score += resolve(grid, { rng, colors, colorMult: scoreMult, cascadeMax }).gained;
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
      ? resolve(grid, { rng, colors, focus: b, colorMult: scoreMult, cascadeMax })
      : resolveRainbowSwap(grid, {
        rng, colors, rainbowIndex, targetIndex: rainbowIndex === a ? b : a, colorMult: scoreMult, cascadeMax,
      });
    score += result.gained;
    if (!result.resolvable) shuffleBoard(grid, rng);
  }
  return score;
}

const base = { colors: 6, moves: 10, scoreMult: 1, cascadeMax: SCORE.cascadeMax, specials: [] };

function median(values) {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(opts, n = 21, tag = 1) {
  const scores = [];
  for (let s = 0; s < n; s += 1) scores.push(playFloor({ ...base, ...opts, seed: tag * 100003 + s * 7919 }));
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
};
const COLOR_GAIN = { 6: 1.37, 5: 3.0 };

function perkValue(perk, bonus) {
  if (perk.id !== 'minimal') return CHOICE_VALUE[perk.id] || 0;
  const next = Math.max(ROGUE.minColors, ROGUE.colors - bonus.colorCut - 1);
  return COLOR_GAIN[next] || 1;
}

function simulateRun(cfg, runSeed) {
  const bonus = createBonus();
  const picks = {};
  let floor = 1;
  const rng = createRng(runSeed);
  for (; ;) {
    const goal = goalOf(floor, bonus);
    const opts = floorOptions(bonus, floor);
    // 每层 3 次采样取中位，降低单次随机噪声对「能打到几层」的干扰
    const scores = [0, 1, 2].map((k) => playFloor({ ...opts, seed: runSeed + floor * 977 + k * 31 }));
    const score = median(scores);
    if (cfg.trace) {
      cfg.trace({
        floor, goal, score, ratio: score / goal, moves: opts.moves,
        colors: opts.colors, scoreMult: opts.scoreMult,
      });
    }
    if (score < goal) {
      if (bonus.shields > 0) {
        bonus.shields -= 1;
        continue; // 免死：本层重来（近似「补步继续」）
      }
      return { floor, cleared: floor - 1 };
    }
    const offered = rollPerks(rng, picks);
    if (offered.length === 0) return { floor, cleared: floor };
    let pick = offered[0];
    let best = -1;
    for (const perk of offered) {
      const v = perkValue(perk, bonus);
      if (v > best) { best = v; pick = perk; }
    }
    picks[pick.id] = (picks[pick.id] || 0) + 1;
    pick.apply(bonus);
    floor += 1;
    if (floor > cfg.maxFloor) return { floor, cleared: floor - 1 };
  }
}

function scan(cfg, runs = 12) {
  const floors = [];
  let firstFloorFails = 0;
  for (let r = 0; r < runs; r += 1) {
    const res = simulateRun({ ...cfg, maxFloor: 35 }, 20260920 + r * 1013);
    floors.push(res.cleared);
    if (res.cleared === 0) firstFloorFails += 1;
  }
  const sorted = [...floors].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    min: sorted[0],
    max: sorted[sorted.length - 1],
    firstFloorFails,
  };
}

console.log('\n=== 出货配置的层数分布（16 次 run，上限 35 层）===');
console.log(`ROGUE: baseGoal=${ROGUE.baseGoal} growth=${ROGUE.goalGrowth} weight=${ROGUE.perkGoalWeight} ` +
  `colors=${ROGUE.colors}/${ROGUE.minColors} moves=${ROGUE.movesPerFloor}+1/${ROGUE.movesPerFloorStep}层 ` +
  `friendlyPicks=${ROGUE.friendlyPicks}`);
try {
  const st = scan({}, 16);
  console.log(`中位 ${st.median} 层 · p25 ${st.p25} · 最低 ${st.min} · 最高 ${st.max} · 首层翻车 ${st.firstFloorFails}/16`);
} catch (err) {
  console.log('模拟出错：' + err.message);
  console.log(err.stack);
}

// 单次 run 的逐层曲线：看「可达分」是否随层数上涨（横盘 = 深层没有成长来源）
function traceRun(cfg, runSeed) {
  const rows = [];
  const res = simulateRun({ ...cfg, trace: (row) => rows.push(row) }, runSeed);
  console.log(`\n=== 单次 run 逐层曲线（结束于第 ${res.floor} 层）===`);
  console.log('层 | 目标分  | 可达中位 | 达成率 | 步数 颜色 倍率');
  for (const r of rows) {
    console.log(
      `${String(r.floor).padStart(2)} | ${String(r.goal).padStart(7)} | ${String(r.score).padStart(8)} | `
      + `${r.ratio.toFixed(2)} | ${r.moves} 步 ${r.colors} 色 ×${r.scoreMult.toFixed(2)}`,
    );
  }
}
try {
  traceRun({ maxFloor: 40 }, 20260920 + 5 * 1013);
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
