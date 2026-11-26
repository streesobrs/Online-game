/**
 * 刷怪肉鸽元素系统：范围挂元素 + 元素反应。
 *
 * 元素弹命中时不再只给直接命中的怪挂元素，而是以命中点为中心给周围敌人挂上元素；
 * 两种不同元素接触时触发反应：
 * - 水 + 雷 = 感电：连锁连接周围带水/雷的怪，一起结算反应伤害
 * - 火 + 雷 = 超载：在触发点爆炸，对范围内敌人造成范围伤害
 * - 火 + 冰 = 融化：按触发这一击的伤害追加增幅伤害
 * - 雷 + 冰 = 超导：对范围内敌人造成伤害并附加易伤
 * - 冰 + 水 = 冻结：把触发怪与附近带水/冰的敌人短暂冰封
 * 闪电、爆炸等特效记录在 state 上供渲染层绘制。
 */
import { reactionDamage } from './combat.js';

export const ELEMENT_INFO = {
  fire: { icon: '🔥', color: '#ff6b3d', name: '火' },
  thunder: { icon: '⚡', color: '#facc15', name: '雷' },
  ice: { icon: '❄️', color: '#7dd3fc', name: '冰' },
  water: { icon: '💧', color: '#3b82f6', name: '水' },
};

/** 元素默认附着时长（秒） */
export const ELEMENT_DURATION = 3.5;

/** 元素弹命中时挂元素的基础半径与每层成长，元素 buff 的文案与射击逻辑共用 */
export const ELEMENT_RADIUS_BASE = 30;
export const ELEMENT_RADIUS_PER_LEVEL = 12;
/** 元素弹相对主武器伤害的倍率 */
export const ELEMENT_SHOT_RATIO = 0.5;

/** 感电连锁：每层增加的搜索半径与连接目标数 */
export const CHAIN_RADIUS_PER_LEVEL = 25;
export const CHAIN_LINKS_PER_LEVEL = 2;

/** 感电·雷暴：半径与反应倍率（剧变反应） */
export const STORM_RADIUS_BASE = 80;
export const STORM_RADIUS_PER_LEVEL = 15;
export const STORM_REACTION_BASE = 1.2;
export const STORM_REACTION_PER_LEVEL = 0.3;

/** 超载：火 + 雷 的爆炸半径与反应倍率 */
export const OVERLOAD_RADIUS = 95;
export const OVERLOAD_MULT = 1.8;
/** 融化：火 + 冰 的增幅倍率（火打冰 ×2，冰打火 ×1.5；无命中伤害时用剧变兜底） */
export const MELT_FIRE_MULT = 2;
export const MELT_ICE_MULT = 1.5;
export const MELT_FALLBACK_MULT = 1.6;
/** 超导：雷 + 冰 的范围与易伤效果 */
export const SUPERCONDUCT_RADIUS = 85;
export const SUPERCONDUCT_MULT = 1.4;
export const SUPERCONDUCT_VULN = 0.3;
export const SUPERCONDUCT_VULN_DURATION = 3;
/** 冻结：冰 + 水 的冰封时长与波及半径 */
export const FREEZE_DURATION = 1.4;
export const FREEZE_RADIUS = 60;
/** 头顶带冰元素的怪物移速倍率（减速 40%） */
export const ICE_SLOW_FACTOR = 0.6;
/** 碎冰：冻结中的怪物被物理子弹命中时的反应倍率 */
export const SHATTER_MULT = 2;

/**
 * 元素反应表：baseMultiplier 为剧变反应的基础倍率，
 * 反应伤害 = 等级系数 × 反应倍率 × (1 + 元素精通加成 + 反应伤害加成)。
 */
export const REACTIONS = {
  electro: {
    id: 'electro',
    name: '感电',
    icon: '⚡',
    baseMultiplier: 2,
    elements: ['water', 'thunder'],
  },
  overload: {
    id: 'overload',
    name: '超载',
    icon: '💥',
    baseMultiplier: OVERLOAD_MULT,
    elements: ['fire', 'thunder'],
  },
  melt: {
    id: 'melt',
    name: '融化',
    icon: '♨️',
    baseMultiplier: MELT_FIRE_MULT,
    elements: ['fire', 'ice'],
  },
  superconduct: {
    id: 'superconduct',
    name: '超导',
    icon: '🧊',
    baseMultiplier: SUPERCONDUCT_MULT,
    elements: ['thunder', 'ice'],
  },
  frozen: {
    id: 'frozen',
    name: '冻结',
    icon: '❄️',
    baseMultiplier: 0,
    elements: ['ice', 'water'],
  },
  shatter: {
    id: 'shatter',
    name: '碎冰',
    icon: '🧊',
    baseMultiplier: SHATTER_MULT,
    elements: ['ice', 'physical'],
  },
};

/** 元素对 → 反应 的索引：顺序无关，newElement + 已有元素 任意顺序都能命中 */
const PAIR_INDEX = new Map();
for (const reaction of Object.values(REACTIONS)) {
  const key = [...reaction.elements].sort().join('+');
  PAIR_INDEX.set(key, reaction);
}

/** 查找两种元素能触发的反应，没有则返回 null */
export function findReaction(elementA, elementB) {
  if (!elementA || !elementB) return null;
  return PAIR_INDEX.get([elementA, elementB].sort().join('+')) || null;
}

/** 感电连锁：单次搜索半径、最多连接目标数、同一只怪的触发冷却 */
const CHAIN_RADIUS = 130;
const REACT_CD = 0.5;
/** 全局反应冷却，避免同一帧大量元素弹同时触发反应导致特效与伤害爆炸 */
const GLOBAL_REACT_CD = 0.14;

function isReactiveElement(element) {
  return element === 'water' || element === 'thunder';
}

/** 给怪物挂上元素；同元素命中时刷新持续时间 */
export function attachElement(enemy, element, duration = ELEMENT_DURATION) {
  if (!enemy || enemy.dead || !ELEMENT_INFO[element]) return;
  enemy.element = element;
  enemy.elementTimer = Math.max(enemy.elementTimer || 0, duration);
}

/** 在触发点周围生成一条带随机抖动的闪电折线 */
function addArc(state, x1, y1, x2, y2) {
  if (!state.lightningArcs) state.lightningArcs = [];
  if (state.lightningArcs.length >= 24) return;
  const dist = Math.hypot(x2 - x1, y2 - y1) || 1;
  const segments = Math.max(2, Math.min(8, Math.round(dist / 26)));
  const nx = -(y2 - y1) / dist;
  const ny = (x2 - x1) / dist;
  const points = [{ x: x1, y: y1 }];
  for (let i = 1; i < segments; i += 1) {
    const t = i / segments;
    const offset = (Math.random() - 0.5) * Math.min(20, dist * 0.3);
    points.push({
      x: x1 + (x2 - x1) * t + nx * offset,
      y: y1 + (y2 - y1) * t + ny * offset,
    });
  }
  points.push({ x: x2, y: y2 });
  state.lightningArcs.push({ points, life: 0.24, maxLife: 0.24 });
}

/** 反应结算的公共部分：消耗触发怪身上的元素并进入冷却 */
function consumeTrigger(trigger, state) {
  state.reactionCd = GLOBAL_REACT_CD;
  trigger.reactCd = REACT_CD;
  trigger.element = '';
  trigger.elementTimer = 0;
}

/**
 * 感电：以触发怪为起点 BFS，连接周围头顶带水/雷的怪，一起结算反应伤害。
 * 触发怪自身的元素会被消耗，周围被连接的怪保留元素，方便后续继续连锁。
 */
function electroCharged(trigger, state, player, api) {
  const reaction = REACTIONS.electro;
  const totalLv = Math.max(2, (player.waterLevel || 0) + (player.thunderLevel || 0));
  const chainBonus = player.electroChainLevel || 0;
  const chainRadius = CHAIN_RADIUS + CHAIN_RADIUS_PER_LEVEL * chainBonus;
  const maxLinks = Math.min(28, 4 + totalLv * 2 + chainBonus * CHAIN_LINKS_PER_LEVEL);
  // 剧变反应：伤害由等级系数、反应倍率和元素精通决定，与攻击力无关
  const damage = reactionDamage(player, state.level || 1, reaction.baseMultiplier);

  consumeTrigger(trigger, state);

  const visited = new Set([trigger.id]);
  const queue = [trigger];
  const targets = [trigger];

  while (queue.length && targets.length < maxLinks) {
    const cur = queue.shift();
    for (const e of state.enemies) {
      if (e.dead || visited.has(e.id) || !isReactiveElement(e.element)) continue;
      const rr = chainRadius + e.r;
      if ((e.x - cur.x) ** 2 + (e.y - cur.y) ** 2 > rr * rr) continue;
      visited.add(e.id);
      targets.push(e);
      queue.push(e);
      addArc(state, cur.x, cur.y, e.x, e.y);
      if (targets.length >= maxLinks) break;
    }
  }

  state.shake = Math.max(state.shake, 0.08);
  for (const e of targets) {
    e.reactCd = Math.max(e.reactCd || 0, REACT_CD);
    api.damageEnemy(e, damage);
  }

  // 感电·雷暴：触发点额外释放一圈范围雷电
  const stormLv = player.electroStormLevel || 0;
  if (stormLv > 0) {
    const radius = STORM_RADIUS_BASE + STORM_RADIUS_PER_LEVEL * stormLv;
    api.addNova(trigger.x, trigger.y, 24, radius);
    api.damageInRadius(
      trigger.x,
      trigger.y,
      radius,
      reactionDamage(player, state.level || 1, STORM_REACTION_BASE + STORM_REACTION_PER_LEVEL * stormLv),
    );
  }
}

/** 超载：火 + 雷，触发点爆炸，对范围内敌人造成火元素范围伤害 */
function overload(trigger, state, player, api) {
  consumeTrigger(trigger, state);
  const damage = reactionDamage(player, state.level || 1, OVERLOAD_MULT);
  api.explodeAt(trigger.x, trigger.y, OVERLOAD_RADIUS, damage);
  api.addNova(trigger.x, trigger.y, 18, OVERLOAD_RADIUS, '#ff6b3d');
  state.shake = Math.max(state.shake, 0.22);
}

/**
 * 融化：火 + 冰，对触发怪追加单体积变伤害。
 * 若这一击的增幅伤害更高（火打冰 ×2 / 冰打火 ×1.5），则改用增幅值，保证强力元素弹也有收益。
 */
function melt(trigger, incomingElement, state, player, api, hitDamage) {
  consumeTrigger(trigger, state);
  const mult = incomingElement === 'fire' ? MELT_FIRE_MULT : MELT_ICE_MULT;
  const bonus = Math.max(
    hitDamage > 0 ? hitDamage * (mult - 1) : 0,
    reactionDamage(player, state.level || 1, MELT_FALLBACK_MULT),
  );
  api.damageEnemy(trigger, bonus);
  api.addNova(trigger.x, trigger.y, 12, 52, '#fbbf24');
  api.spawnParticles(trigger.x, trigger.y, '#fde68a', 8, 180);
  state.shake = Math.max(state.shake, 0.1);
}

/** 超导：雷 + 冰，对范围内敌人造成伤害，并短暂降低其抗性（易伤） */
function superconduct(trigger, state, player, api) {
  consumeTrigger(trigger, state);
  const damage = reactionDamage(player, state.level || 1, SUPERCONDUCT_MULT);
  for (const e of state.enemies) {
    if (e.dead) continue;
    const rr = SUPERCONDUCT_RADIUS + e.r;
    if ((e.x - trigger.x) ** 2 + (e.y - trigger.y) ** 2 > rr * rr) continue;
    e.vulnTimer = SUPERCONDUCT_VULN_DURATION;
    e.vulnBonus = SUPERCONDUCT_VULN;
    api.damageEnemy(e, damage);
  }
  api.addNova(trigger.x, trigger.y, 16, SUPERCONDUCT_RADIUS, '#a78bfa');
  api.spawnParticles(trigger.x, trigger.y, '#c4b5fd', 10, 200);
  state.shake = Math.max(state.shake, 0.1);
}

/** 冻结：冰 + 水，冰封触发怪与附近带水/冰元素的敌人 */
function frozen(trigger, state, player, api) {
  consumeTrigger(trigger, state);
  for (const e of state.enemies) {
    if (e.dead) continue;
    if (e !== trigger && e.element !== 'water' && e.element !== 'ice') continue;
    const rr = FREEZE_RADIUS + e.r;
    if ((e.x - trigger.x) ** 2 + (e.y - trigger.y) ** 2 > rr * rr) continue;
    e.freezeTimer = Math.max(e.freezeTimer || 0, FREEZE_DURATION);
    // 记录冰封瞬间的朝向，渲染层用它冻结旋转动画，避免看起来还在动
    e.freezeAngle = Math.atan2(player.y - e.y, player.x - e.x);
    e.reactCd = Math.max(e.reactCd || 0, REACT_CD);
    // 被冻结的邻居同样消耗掉身上的水/冰，避免同一批怪被反复冻结锁死
    if (e !== trigger) {
      e.element = '';
      e.elementTimer = 0;
    }
  }
  api.addNova(trigger.x, trigger.y, 12, FREEZE_RADIUS, '#7dd3fc');
  api.spawnParticles(trigger.x, trigger.y, '#bae6fd', 8, 150);
}

/**
 * 碎冰：冻结中的怪物被物理子弹命中时，解除冻结并追加一次剧变伤害。
 * @returns {boolean} 是否触发了碎冰
 */
export function applyShatter(enemy, state, player, api) {
  if (!enemy || enemy.dead || !(enemy.freezeTimer > 0)) return false;
  enemy.freezeTimer = 0;
  enemy.freezeAngle = 0;
  const damage = reactionDamage(player, state.level || 1, SHATTER_MULT);
  api.damageEnemy(enemy, damage);
  api.addNova(enemy.x, enemy.y, 10, 46, '#e0f2fe');
  api.spawnParticles(enemy.x, enemy.y, '#bae6fd', 10, 220);
  state.shake = Math.max(state.shake, 0.12);
  return true;
}

/**
 * 对单个怪物结算一次元素命中：能反应就触发反应，否则挂上元素。
 * 反应冷却期间保留原有元素，等待下一次命中，避免被高频元素弹覆盖掉反应机会。
 * @param {number} [hitDamage] - 触发这次附着的元素弹伤害，融化等增幅反应会用到
 */
export function applyElementHit(enemy, element, state, player, api, duration = ELEMENT_DURATION, hitDamage = 0) {
  if (!enemy || enemy.dead || !ELEMENT_INFO[element]) return;
  if (enemy.element === element) {
    attachElement(enemy, element, duration);
    return;
  }
  const reaction = findReaction(element, enemy.element);
  if (reaction) {
    if ((enemy.reactCd || 0) > 0 || (state.reactionCd || 0) > 0) return;
    switch (reaction.id) {
      case 'overload': overload(enemy, state, player, api); break;
      case 'melt': melt(enemy, element, state, player, api, hitDamage); break;
      case 'superconduct': superconduct(enemy, state, player, api); break;
      case 'frozen': frozen(enemy, state, player, api); break;
      default: electroCharged(enemy, state, player, api); break;
    }
    return;
  }
  attachElement(enemy, element, duration);
}

/** 范围挂元素：以命中点为中心给范围内敌人挂元素，不额外造成伤害 */
export function applyElementAoe(state, player, api, x, y, radius, element, duration = ELEMENT_DURATION, excludeId) {
  if (!(radius > 0) || !ELEMENT_INFO[element]) return;
  for (const e of state.enemies) {
    if (e.dead || e.id === excludeId) continue;
    const rr = radius + e.r;
    if ((e.x - x) ** 2 + (e.y - y) ** 2 > rr * rr) continue;
    applyElementHit(e, element, state, player, api, duration);
  }
}
