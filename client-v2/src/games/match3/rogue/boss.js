/**
 * Boss：定义换算 + 固定机关盘 + 阶段判定（开发方案 3.3，P1 数值 Boss）
 *
 * 设计约束（文档原文）：
 * - 消除得分即伤害，HP 沿 goalOf 曲线放大，不新增经济尺度；
 * - P1 **零引擎改动**：机关全部是「开局即定的固定盘」，阶段阈值只做演出，
 *   层中注障碍（addBlockers）/ 锁色 / 收步等主动行为留给 P1.x；
 * - 遗物宝箱是 P3，P1 击败奖励退化为保底史诗祝福（见 config.rewardRarity）。
 *
 * 本文件全是纯函数：同 Boss + 同 bonus + 同 rng 序列必出同盘，便于标定与续存复现。
 */
import { ROGUE, ROGUE_BOSSES, ROGUE_BOSS_ORDER } from '../config/config.js';
import { goalOf } from './perks.js';

/** 按深度取 Boss 定义（仅 10 / 20 / 30），不是 Boss 层返回 null */
export function bossAt(depth) {
  const id = ROGUE_BOSS_ORDER.find((key) => ROGUE_BOSSES[key].depth === depth);
  return id ? ROGUE_BOSSES[id] : null;
}

/**
 * Boss 血量 = 本层目标分曲线 × Boss 系数（与精英的 goalMult 同一思路，单独列表便于逐个调）
 * @param {object} def - ROGUE_BOSSES 里的定义
 * @param {object} bonus - 本轮加成（goalCut 等会压低目标分，对 Boss 同样生效）
 */
export function bossHpTarget(def, bonus) {
  return Math.max(1, Math.round(goalOf(def.depth, bonus) * def.hpMult));
}

/**
 * 生成 Boss 层运行时状态（mode-rogue 持有，进层时建、续玩时从存档恢复）
 * @returns {{id:string,target:number,fired:string[]}}
 */
export function createBossState(def, bonus) {
  return { id: def.id, target: bossHpTarget(def, bonus), fired: [] };
}

function blocker(r, c, kind) {
  return { r, c, kind };
}

/**
 * Boss 固定机关盘（始终 8×8 满盘，不用异形 mask——文档：Boss 靠障碍布阵）
 * @returns {{rows:number,cols:number,mask:null,shapeName:null,blockers:Array,
 *            playableRatio:number,biome:string,layout:string}}
 */
export function bossTerrain(def, rng) {
  const { rows, cols } = ROGUE;
  const blockers = [];
  const occupied = new Set();
  const put = (r, c, kind) => {
    const key = r * cols + c;
    if (occupied.has(key)) return;
    occupied.add(key);
    blockers.push(blocker(r, c, kind));
  };

  if (def.layout.kind === 'chains') {
    // 锁链阵：四角各一段双链（hp1 锁），共 8 个；中腹留出操作空间
    for (const r of [1, 2, rows - 3, rows - 2]) {
      for (const c of [1, cols - 2]) put(r, c, 'lock');
    }
  } else if (def.layout.kind === 'icefield') {
    // 全图冰：前 N 行交错铺冰（每块 hp2），底部留一行全通作为周转区
    const iceRows = Math.min(rows, def.layout.rows || 7);
    for (let r = 0; r < iceRows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if ((r + c) % 2 === 0) put(r, c, 'ice');
      }
    }
  } else if (def.layout.kind === 'pillars') {
    // 分仓石头阵（hp3）：两道纵墙、固定行留缺口；墙间空格再撒冰块
    const gap = new Set(def.layout.gapRows || []);
    for (const c of def.layout.cols || []) {
      for (let r = 0; r < rows; r += 1) {
        if (!gap.has(r)) put(r, c, 'stone');
      }
    }
    const free = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (!occupied.has(r * cols + c)) free.push({ r, c });
      }
    }
    rng.shuffle(free);
    for (let i = 0; i < (def.layout.ice || 0) && i < free.length; i += 1) {
      put(free[i].r, free[i].c, 'ice');
    }
  }

  return {
    rows,
    cols,
    mask: null,
    shapeName: null,
    blockers,
    playableRatio: 1,
    biome: def.biome,
    layout: def.layout.kind,
  };
}

/**
 * 计算本次伤害刷新后新跨过的阶段（每个阶段一次性）
 *
 * 阶段按**剩余血量比例**定义：at=0.66 表示血量首次降到 66% 以下时触发。
 * P1 阶段只做横幅演出；触发结果由调用方 toast，并把 phase.id 记入 state.fired 防重入。
 * @param {object} def - Boss 定义
 * @param {object} state - createBossState 的运行时状态（会原地写入 fired）
 * @param {number} prevDamage - 刷新前累计伤害（= 刷新前本层得分）
 * @param {number} damage - 刷新后累计伤害
 * @returns {Array<{at:number,icon:string,text:string}>}
 */
export function crossedPhases(def, state, prevDamage, damage) {
  const target = state.target;
  const prevRatio = Math.max(0, (target - Math.min(prevDamage, target)) / target);
  const nextRatio = Math.max(0, (target - Math.min(damage, target)) / target);
  const out = [];
  for (let i = 0; i < def.phases.length; i += 1) {
    const phase = def.phases[i];
    const fid = `${def.id}:p${i}`;
    // 从上向下跨过阈值（含恰好在阈值上），且本 run 未触发过
    if (prevRatio > phase.at && nextRatio <= phase.at && !state.fired.includes(fid)) {
      state.fired.push(fid);
      out.push(phase);
    }
  }
  return out;
}

/** 伤害是否已打空血条（击败判定，与 floorGoals 的单 score 目标同值） */
export function isBossDefeated(state, damage) {
  return damage >= state.target;
}
