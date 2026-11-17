/**
 * 刷怪肉鸽元素系统：范围挂元素 + 水/雷反应「感电」。
 *
 * 元素弹命中时不再只给直接命中的怪挂元素，而是以命中点为中心给周围敌人挂上元素；
 * 水元素与雷元素接触时触发「感电」：以触发怪为起点，连锁连接周围头顶带水/雷的怪，
 * 让它们一同受到反应伤害，同时记录闪电特效供渲染层绘制。
 */

export const ELEMENT_INFO = {
  fire: { icon: '🔥', color: '#ff6b3d', name: '火' },
  thunder: { icon: '⚡', color: '#facc15', name: '雷' },
  ice: { icon: '❄️', color: '#7dd3fc', name: '冰' },
  water: { icon: '💧', color: '#3b82f6', name: '水' },
};

/** 元素默认附着时长（秒） */
export const ELEMENT_DURATION = 3.5;

/**
 * 元素反应表：baseMultiplier 为反应基础倍率，反应伤害 = 角色伤害 × 基础倍率 × 等级成长 × 增幅。
 * 目前只有水 + 雷的「感电」，基础倍率为 2。
 */
export const REACTIONS = {
  electro: {
    id: 'electro',
    name: '感电',
    baseMultiplier: 2,
    elements: ['water', 'thunder'],
  },
};

/** 感电连锁：单次搜索半径、最多连接目标数、同一只怪的触发冷却 */
const CHAIN_RADIUS = 130;
const REACT_CD = 0.5;
/** 全局反应冷却，避免同一帧大量元素弹同时触发感电导致特效与伤害爆炸 */
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

/**
 * 感电：以触发怪为起点 BFS，连接周围头顶带水/雷的怪，一起结算反应伤害。
 * 触发怪自身的元素会被消耗，周围被连接的怪保留元素，方便后续继续连锁。
 */
function electroCharged(trigger, state, player, api) {
  const reaction = REACTIONS.electro;
  const totalLv = Math.max(2, (player.waterLevel || 0) + (player.thunderLevel || 0));
  const chainBonus = player.electroChainLevel || 0;
  const chainRadius = CHAIN_RADIUS + 25 * chainBonus;
  const maxLinks = Math.min(28, 4 + totalLv * 2 + chainBonus * 2);
  const amp = 1 + 0.25 * (player.electroAmpLevel || 0);
  // 水/雷总层数每多 1 级，反应伤害 +10%（最低按 1 级水 + 1 级雷计算）
  const levelScale = 1 + 0.1 * (totalLv - 2);
  const damage = player.damage * reaction.baseMultiplier * levelScale * amp;

  state.reactionCd = GLOBAL_REACT_CD;
  trigger.reactCd = REACT_CD;
  trigger.element = '';
  trigger.elementTimer = 0;

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
    const radius = 80 + 15 * stormLv;
    api.addNova(trigger.x, trigger.y, 24, radius);
    api.damageInRadius(trigger.x, trigger.y, radius, player.damage * (0.35 + 0.15 * stormLv));
  }
}

/**
 * 对单个怪物结算一次元素命中：能反应就触发反应，否则挂上元素。
 * 反应冷却期间保留原有元素，等待下一次命中，避免被高频元素弹覆盖掉反应机会。
 */
export function applyElementHit(enemy, element, state, player, api, duration = ELEMENT_DURATION) {
  if (!enemy || enemy.dead || !ELEMENT_INFO[element]) return;
  if (enemy.element === element) {
    attachElement(enemy, element, duration);
    return;
  }
  const reacts = (element === 'thunder' && enemy.element === 'water')
    || (element === 'water' && enemy.element === 'thunder');
  if (reacts) {
    if ((enemy.reactCd || 0) > 0 || (state.reactionCd || 0) > 0) return;
    electroCharged(enemy, state, player, api);
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
