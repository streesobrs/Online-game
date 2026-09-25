/**
 * 肉鸽节点 → 本层地形 / 目标推导（开发方案 3.2「区域地形与多目标」）
 *
 * 与既有模块的分工：
 * - config.js：ROGUE_BIOMES（区域池）、ROGUE_NODES（精英 / Boss 修正）、ROGUE_SHAPE（异形盘修正）
 * - mapgen.js：节点图本身（type / depth / biome），不知道每层打什么
 * - perks.js：floorOptions 把「地形 + 祝福」翻译成 board payload（步数 / 倍率 / 特殊块）
 * - 本文件：terrainFor 决定棋盘形态与障碍，floorGoals 决定硬目标，均为纯函数、可标定
 *
 * 目标分的层数曲线仍是 perks.goalOf（baseGoal × goalGrowth^层数），
 * 这里只乘「节点系数」与「异形盘可玩格折算」，不改既有曲线，精华 / 经验 / 服务端校验均不动。
 */
import { ROGUE, ROGUE_BIOMES, ROGUE_NODES, ROGUE_SHAPE } from '../config/config.js';
import { goalOf } from './perks.js';
import { MASKS } from '../config/levels.js';
import { createGrid } from '../engine/grid.js';
import { NODE } from './mapgen.js';
import { bossAt, bossHpTarget, bossTerrain } from './boss.js';

/** 按深度取区域配置（1-10 plain / 11-20 frost / 21-30 core，与 mapgen.biomeAt 同口径） */
export function rogueBiome(depth) {
  return ROGUE_BIOMES.find((b) => depth >= b.from && depth <= b.to) || ROGUE_BIOMES[0];
}

/** 按权重抽一个池内元素（weights 与 items 等长） */
function weightedPick(rng, items, weights) {
  const total = weights.reduce((sum, w) => sum + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < items.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * 推导某节点对应层的棋盘地形（纯函数）
 * @param {{depth:number,type:string}} node - mapgen 节点
 * @param {{next:Function,int:Function,pick:Function,shuffle:Function}} rng
 * @returns {{rows,cols,mask,shapeName,blockers:Array<{r,c,kind}>,playableRatio,biome}}
 */
export function terrainFor(node, rng) {
  // Boss：固定机关盘（8×8 满盘 + boss.js 布阵），不走区域随机异形 / 随机障碍
  const bossDef = node.type === NODE.BOSS ? bossAt(node.depth) : null;
  if (bossDef) return bossTerrain(bossDef, rng);

  const biome = rogueBiome(node.depth);
  const nodeCfg = ROGUE_NODES[node.type] || ROGUE_NODES.battle;

  // Boss 已在上面提前返回；其余节点按区域概率抽异形
  const useShape = biome.masks.length > 0 && rng.next() < biome.maskChance;
  const shapeName = useShape ? biome.masks[rng.int(biome.masks.length)] : null;
  const mask = shapeName ? MASKS[shapeName] : null;
  const rows = mask ? ROGUE_SHAPE.size : ROGUE.rows;
  const cols = mask ? ROGUE_SHAPE.size : ROGUE.cols;

  // 临时 grid 只用于拿可玩格坐标（障碍不能铺在 mask 洞里）
  const grid = createGrid({ rows, cols, mask });
  const cells = rng.shuffle(grid.cellIndex.slice());
  const playableRatio = grid.cellIndex.length / (rows * cols);

  const blockers = [];
  let cursor = 0;
  const place = (kind, count) => {
    for (let i = 0; i < count && cursor < cells.length; i += 1) {
      const idx = cells[cursor];
      cursor += 1;
      blockers.push({ r: Math.floor(idx / cols), c: idx % cols, kind });
    }
  };

  // 区域基准障碍；平原没有区域障碍时，精英 / Boss 的额外量用最弱的锁（hp 1）兜底
  const kindPool = Object.keys(biome.blockers);
  const fallbackKinds = kindPool.length ? kindPool : ['lock'];
  for (const kind of fallbackKinds) place(kind, biome.blockers[kind] || 0);
  for (let i = 0; i < nodeCfg.extraBlockers; i += 1) place(rng.pick(fallbackKinds), 1);

  return { rows, cols, mask, shapeName, blockers, playableRatio, biome: biome.id };
}

/** collect 目标数：复用局内任务的需求曲线；异形盘按可玩格比例折算 */
function collectTarget(depth, colors, terrain) {
  const base = ROGUE.quest.baseNeed * ROGUE.quest.needGrowth ** (depth - 1);
  // 颜色越少，单色可收集量越多；6 色基线为 1，其余按 6/colors 放大
  const colorScale = ROGUE.colors / colors;
  const shapeScale = terrain.mask ? terrain.playableRatio : 1;
  return Math.max(3, Math.round(base * colorScale * shapeScale));
}

/**
 * 推导某节点对应层的硬目标（纯函数，管线支持数组，P0 普通层 1 个 / 精英与 Boss 2 个）
 * @param {{depth:number,type:string}} node
 * @param {object} bonus - 本轮祝福（影响分数目标曲线）
 * @param {object} rng
 * @param {{colors:number,terrain:object}} ctx - colors 取自 floorOptions（异形盘会降色）
 * @returns {Array<{type:string,target?:number,color?:number}>}
 */
export function floorGoals(node, bonus, rng, ctx) {
  const { colors, terrain } = ctx;
  const biome = rogueBiome(node.depth);
  const nodeCfg = ROGUE_NODES[node.type] || ROGUE_NODES.battle;

  // Boss：唯一目标 = 打空血条（target 即 boss.js 算出的 HP），侧栏渲染成 Boss 血条；
  // 不再配条件目标——固定机关盘本身就是第二个压力源
  if (node.type === NODE.BOSS) {
    const def = bossAt(node.depth);
    if (def) return [{ type: 'score', target: bossHpTarget(def, bonus) }];
  }

  // 分数目标：旧曲线 × 节点系数 × 异形盘折算
  const shapeScale = terrain.mask ? terrain.playableRatio * ROGUE_SHAPE.scoreComp : 1;
  const scoreTarget = Math.max(
    1,
    Math.round(goalOf(node.depth, bonus) * nodeCfg.goalMult * shapeScale),
  );

  const canClear = terrain.blockers.length > 0;
  const makeGoal = (kind) => {
    if (kind === 'clearBlockers') {
      return {
        type: 'clearBlockers',
        target: Math.max(1, Math.round(terrain.blockers.length * ROGUE_SHAPE.clearRatio)),
      };
    }
    if (kind === 'collect') {
      return { type: 'collect', color: 1 + rng.int(colors), target: collectTarget(node.depth, colors, terrain) };
    }
    return { type: 'score', target: scoreTarget };
  };

  if (nodeCfg.goals >= 2) {
    // 精英 / Boss（文档 3.3）：score 必在，另配一个条件目标；场上有障碍时偏向清障
    const cond = canClear
      ? weightedPick(rng, ['clearBlockers', 'collect'], [0.6, 0.4])
      : 'collect';
    return [makeGoal('score'), makeGoal(cond)];
  }

  // 普通战斗层：按区域权重抽一种（平原以 score 为主，深窟多清障）。
  // 教学保护（文档 3.2 风险对策「条件目标 11 层后渐进、避免前期翻车」）：
  // 前 tutorialDepth 层无条件硬目标，让玩家先攒到降色 / 磁石 / 彩球等手段
  let kind = node.depth <= ROGUE_SHAPE.tutorialDepth
    ? 'score'
    : weightedPick(rng, biome.goalKinds, biome.goalWeights);
  if (kind === 'clearBlockers' && !canClear) kind = 'collect';
  return [makeGoal(kind)];
}
