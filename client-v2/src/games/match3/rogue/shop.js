/**
 * 局内商店：货架生成 + 价格 + 购买 / 封禁 / 刷新（开发方案 3.6，P4）
 *
 * 边界（不可越线）：
 * - 金币 🪙 是**局内一次性资源**：本轮结束清零、**不上报服务端**、不兑换精华（文档 4.3）；
 *   它既不能换成精华、也不参与反刷分——这条边界是刻意的，避免「刷金币」成为刷精华的旁路。
 * - **移除服务 = 杀戮尖塔的「删牌」等价物**：花高价封禁本轮一条不想要的祝福（banPerk），
 *   让 build 更聚焦；封禁结果进 bannedPerkIds，rollPerks 抽牌时过滤。
 * - 三层 build 边界（文档 4.2）：祝福=数值底盘（进三选一池、可叠加）、遗物=机制引擎
 *   （每件最多 1 个、不进池），商店两边都卖，但不改变两者的语义。
 *
 * 纯逻辑：不碰 DOM、不使用内置随机源（随机一律走传入的 rng，
 * 同 seed 必出同货架，便于标定与续存复现），且**只读**入参 state，绝不修改它。
 *
 * 谁消费它：mode-rogue 的「商店节点」UI（货架铺格 / 价格展示 / 购买回调）
 * 与 tests/match3-shop.test.js（标定脚本复用同一套纯函数）。
 */
import { ROGUE_GOLD } from '../config/config.js';
import { PERKS } from './perks.js';
import { missingRelics, relicById, rollRelic } from './relics.js';

/** 移除服务上限：一轮最多封禁 2 次（文档 3.6「封禁」；config 未单列，故按规则声明为常量） */
const REMOVE_MAX = 2;

/** 服务类货架的种类（价格分别见 config.ROGUE_GOLD 的 movesPrice / shieldPrice / rerollPrice） */
export const SERVICE_KINDS = ['moves', 'shield', 'reroll'];

// ---------------------------------------------------------------------------
// 工具：价格基准（全部从 config 读，禁止魔法数字）
// ---------------------------------------------------------------------------

/** 稀有度 → 祝福基价（缺档回落到 common，保证任何数据都不返回 NaN） */
function perkBase(rarity) {
  const table = ROGUE_GOLD.priceByRarity;
  return Number.isFinite(table[rarity]) ? table[rarity] : table.common;
}

/** 稀有度 → 遗物基价（缺档回落到 common） */
function relicBase(rarity) {
  const table = ROGUE_GOLD.relicPrice;
  return Number.isFinite(table[rarity]) ? table[rarity] : table.common;
}

/** 服务 → 基价 */
function serviceBase(service) {
  if (service === 'moves') return ROGUE_GOLD.movesPrice;
  if (service === 'shield') return ROGUE_GOLD.shieldPrice;
  if (service === 'reroll') return ROGUE_GOLD.rerollPrice;
  return ROGUE_GOLD.movesPrice;
}

/** 取一张价目表里最贵的那一档的键（随机遗物位用它标「更高档」的价） */
function topRarity(table) {
  let best = null;
  let bestVal = -Infinity;
  for (const [key, val] of Object.entries(table)) {
    if (Number.isFinite(val) && val > bestVal) {
      best = key;
      bestVal = val;
    }
  }
  return best;
}

/** 商品基准价（不看 item.price，直接从 config 的价目表推导，避免折扣被二次叠加） */
function basePriceOf(item) {
  if (!item || typeof item !== 'object') return 1;
  if (item.kind === 'perk') return perkBase(item.rarity);
  if (item.kind === 'relic') return relicBase(item.rarity);
  if (item.kind === 'service') return serviceBase(item.service);
  if (item.kind === 'remove') return ROGUE_GOLD.removeCost;
  return Number.isFinite(item.price) ? item.price : 1;
}

/** 折扣系数：mods.shopDiscount 缺省 = 1（不打折，也不涨价） */
function discountOf(mods) {
  const v = mods && mods.shopDiscount;
  return Number.isFinite(v) ? v : 1;
}

/** 基准价 × 折扣，四舍五入并保底 1 金币 */
function roundPrice(base, mult) {
  return Math.max(1, Math.round(base * mult));
}

/**
 * 商品最终价 = config 基准价 × mods.shopDiscount（默认 1），Math.round，下限 1
 * mods 缺省时结果与基准价逐位一致。
 */
export function priceOf(item, mods = {}) {
  return roundPrice(basePriceOf(item), discountOf(mods));
}

/**
 * 给整架货位算最终价：返回**副本**（不改入参 items）；sold 等既有字段原样保留
 */
export function shelfWithPrices(items, mods = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => ({ ...item, price: priceOf(item, mods) }));
}

// ---------------------------------------------------------------------------
// 货架生成（纯函数）
// ---------------------------------------------------------------------------

/**
 * 可上架的祝福：未被封禁、尚未叠满，且（若给了 `allowedPerkIds`）在本轮可用池里
 *
 * `allowedPerkIds` 与三选一池同口径——都是局外养成已解锁（lv>0）的祝福集合。
 * 商店若卖出未解锁的祝福，`grantPerk` 会拒收（它按解锁集过滤），玩家花了金币却拿不到东西；
 * 因此这里必须用同一份白名单，把两处的口径钉在一起。不传时（标定 / 老调用）不过滤。
 */
function availablePerks(state) {
  const picks = (state && state.picks) || {};
  const banned = new Set(Array.isArray(state && state.bannedPerkIds) ? state.bannedPerkIds : []);
  const raw = state && state.allowedPerkIds;
  const allowed = raw instanceof Set ? raw : (Array.isArray(raw) ? new Set(raw) : null);
  return PERKS.filter((p) => !banned.has(p.id)
    && (picks[p.id] || 0) < p.max
    && (!allowed || allowed.has(p.id)));
}

/** 从候选里随机取一个「本架还没用过」的（池子不足时返回 null，调用方降级） */
function pickUnused(rng, pool, usedIds) {
  const rest = pool.filter((entry) => !usedIds.has(entry.id));
  if (rest.length === 0) return null;
  return rest[rng.int(rest.length)];
}

function perkSlot(perk) {
  return { kind: 'perk', perkId: perk.id, rarity: perk.rarity, price: perkBase(perk.rarity), sold: false };
}

function relicSlot(relic) {
  return { kind: 'relic', relicId: relic.id, rarity: relic.rarity, price: relicBase(relic.rarity), sold: false };
}

/** 高价随机遗物位：不指定具体遗物，购买时用 rng 掷；稀有度取价目表最高档 */
function randomRelicSlot() {
  const rarity = topRarity(ROGUE_GOLD.relicPrice);
  return { kind: 'relic', random: true, rarity, price: relicBase(rarity), sold: false };
}

function serviceSlot(service) {
  return { kind: 'service', service, price: serviceBase(service), sold: false };
}

/** 取一个服务（同类优先不重复，全用过就允许重复） */
function nextService(rng, usedServices) {
  const rest = SERVICE_KINDS.filter((s) => !usedServices.has(s));
  const pool = rest.length > 0 ? rest : SERVICE_KINDS;
  return pool[rng.int(pool.length)];
}

/**
 * 把总格数分给三组（祝福 / 遗物 / 服务）：每组至少 1 格、至多 2 格
 * 多出来的格数随机落到不同组上，于是「哪一类占 2 格」本身就是随机的
 */
function groupCounts(rng, total) {
  const counts = { perk: 1, relic: 1, service: 1 };
  let extra = Math.max(0, total - 3);
  const keys = ['perk', 'relic', 'service'];
  while (extra > 0 && keys.length > 0) {
    const idx = rng.int(keys.length);
    const key = keys.splice(idx, 1)[0];
    counts[key] += 1;
    extra -= 1;
  }
  return counts;
}

/**
 * 生成一货架商品（长度 = config.ROGUE_GOLD.shopSlots，默认 5 格）
 *
 * 组合（文档 3.6）：
 * - 祝福 1–2 格：从未叠满、未被封禁的祝福里抽（picks 里已达 perk.max 的不上架）；
 * - 遗物 1–2 格：第 2 格是高价随机位（relicPrice 的最高档定价，购买时才掷出具体遗物）；
 * - 服务 1–2 格：+N 步 / 1 次护盾 / 1 次三选一重随；
 * - 移除服务固定 1 格（removedThisRun >= 2 时不再出现）。
 *
 * @param {object} rng - rng.js 发生器（只用传入的 rng，禁止使用内置随机源）
 * @param {{depth?:number, coins?:number, picks?:object, relics?:string[],
 *          bannedPerkIds?:string[], removedThisRun?:number,
 *          allowedPerkIds?:string[]|Set<string>}} state - run 快照（只读，不修改）
 * @param {{slots?:number}} [opts] - slots 可覆盖货架格数（标定用，缺省走 config）
 * @returns {Array} 货架格位数组，恒为 slots 个；池子抽空时用服务格补齐，绝不短少
 */
export function rollShelf(rng, state = {}, opts = {}) {
  const slots = Number.isFinite(opts.slots) ? Math.max(0, Math.floor(opts.slots)) : ROGUE_GOLD.shopSlots;
  const st = state || {};
  const removed = Number(st.removedThisRun) || 0;
  const removeCount = removed < REMOVE_MAX ? 1 : 0;
  const target = Math.max(0, slots - removeCount);

  const perkPool = availablePerks(st);
  const relicPool = missingRelics(Array.isArray(st.relics) ? st.relics : []);
  const groups = groupCounts(rng, target);

  const items = [];
  const usedPerks = new Set();
  const usedRelics = new Set();
  const usedServices = new Set();

  // 祝福格
  for (let i = 0; i < groups.perk; i += 1) {
    const perk = pickUnused(rng, perkPool, usedPerks);
    if (!perk) break;
    usedPerks.add(perk.id);
    items.push(perkSlot(perk));
  }

  // 遗物格：第 1 格是标价遗物，第 2 格（若有）是高价随机位
  for (let i = 0; i < groups.relic; i += 1) {
    if (i > 0) {
      items.push(randomRelicSlot());
      continue;
    }
    const relic = pickUnused(rng, relicPool, usedRelics);
    if (!relic) continue; // 池子空 → 交给补齐阶段，货架不会空位
    usedRelics.add(relic.id);
    items.push(relicSlot(relic));
  }

  // 服务格
  for (let i = 0; i < groups.service; i += 1) {
    const service = nextService(rng, usedServices);
    usedServices.add(service);
    items.push(serviceSlot(service));
  }

  // 补齐：候选池被抽空时用服务格兜底，保证格数恒等于 slots
  while (items.length < target) {
    const perk = pickUnused(rng, perkPool, usedPerks);
    if (perk) {
      usedPerks.add(perk.id);
      items.push(perkSlot(perk));
      continue;
    }
    const relic = pickUnused(rng, relicPool, usedRelics);
    if (relic) {
      usedRelics.add(relic.id);
      items.push(relicSlot(relic));
      continue;
    }
    const service = nextService(rng, usedServices);
    usedServices.add(service);
    items.push(serviceSlot(service));
  }

  if (removeCount > 0) items.push({ kind: 'remove', price: ROGUE_GOLD.removeCost, sold: false });

  return items;
}

// ---------------------------------------------------------------------------
// 购买 / 封禁 / 刷新（返回结果对象，任何路径都不抛错）
// ---------------------------------------------------------------------------

/** 安全调用 ctx 上的可选方法：不存在或抛错都返回 undefined，绝不向外冒泡 */
function callCtx(ctx, name, ...args) {
  const fn = ctx && ctx[name];
  if (typeof fn !== 'function') return undefined;
  try {
    return fn.apply(ctx, args);
  } catch {
    return undefined;
  }
}

/** 读当前金币（getCoins 缺失 / 返回非法值时按 0 处理） */
function coinsOf(ctx) {
  const v = callCtx(ctx, 'getCoins');
  return Number.isFinite(v) ? v : 0;
}

/** 扣费（走 ctx.addCoins(-n)） */
function pay(ctx, n) {
  callCtx(ctx, 'addCoins', -n);
}

/** 返还金币 */
function refundCoins(ctx, n) {
  if (n > 0) callCtx(ctx, 'addCoins', n);
}

/** 遗物展示名（优先按 id 查定义，查不到就用 id 本身） */
function relicName(id) {
  const def = relicById(id);
  return def ? def.name : id;
}

/** 遗物类购买：随机位先掷、掷空半价返还；否则按标价授予 */
function buyRelic(ctx, item, price) {
  let relicId = item.relicId;
  if (item.random === true) {
    const owned = callCtx(ctx, 'getRelics');
    const rolled = rollRelic(ctx && ctx.rng, Array.isArray(owned) ? owned : []);
    if (!rolled) {
      pay(ctx, price);
      const refund = Math.round(price / 2);
      refundCoins(ctx, refund);
      item.sold = true;
      return {
        ok: true,
        reason: 'empty',
        refund,
        spent: price,
        text: `货箱已空（遗物都已在手），返还 ${refund} 🪙`,
      };
    }
    relicId = rolled.id;
  }
  callCtx(ctx, 'grantRelic', { id: relicId });
  pay(ctx, price);
  item.sold = true;
  const name = item.random === true ? relicName(relicId) : relicName(item.relicId);
  return { ok: true, text: `买下遗物「${name}」`, spent: price };
}

/** 服务类购买：+N 步仅下一层 / 1 次护盾 / 1 次三选一重随 */
function buyService(ctx, item, price) {
  const amount = ROGUE_GOLD.movesAmount;
  let text = '';
  if (item.service === 'moves') {
    // 文档 3.6：+N 步**仅下一层**——有专用钩子就优先用它，没有才退回即时 addMoves
    if (typeof (ctx && ctx.addMovesNextFloor) === 'function') callCtx(ctx, 'addMovesNextFloor', amount);
    else callCtx(ctx, 'addMoves', amount);
    text = `下一层起手 +${amount} 步`;
  } else if (item.service === 'shield') {
    callCtx(ctx, 'addShield', 1);
    text = '获得 1 次免死';
  } else if (item.service === 'reroll') {
    // addReroll 是可选钩子：本层没接也照样算买过（点券已发放，重随入口后续再补）
    callCtx(ctx, 'addReroll', 1);
    text = '下次三选一可重随 1 次';
  } else {
    return { ok: false, reason: 'bad', text: '未知的服务类型', spent: 0 };
  }
  pay(ctx, price);
  item.sold = true;
  return { ok: true, text, spent: price };
}

/**
 * 购买一格商品
 *
 * 校验顺序固定：已售出（sold）→ 金币不足（poor）→ 执行并扣费。
 * 执行成功后把 `item.sold = true`（item 是调用方货架的格位对象，允许就地标记）。
 * 任何路径都不抛错（ctx 缺方法 / 方法抛异常都静默降级）。
 *
 * @param {object} ctx - 见文件头 ctx 接口（调用方实现，本模块只调用）
 * @param {object} item - rollShelf 产出的格位
 * @param {{shopDiscount?:number}} [mods] - 价格修正（遗物 build 的商店折扣）
 * @returns {{ok:boolean, reason?:string, text:string, spent:number, refund?:number}}
 */
export function buyItem(ctx, item, mods = {}) {
  if (!item || typeof item !== 'object') {
    return { ok: false, reason: 'bad', text: '无效的货架格位', spent: 0 };
  }
  if (item.sold === true) {
    return { ok: false, reason: 'sold', text: '这一格已经卖掉了', spent: 0 };
  }
  // 移除服务不走购买：它是一次「选牌 → 封禁」的交互，交给 removePerk
  if (item.kind === 'remove') {
    return { ok: false, reason: 'use-remove', text: '移除服务请使用 removePerk', spent: 0 };
  }

  const price = priceOf(item, mods);
  if (coinsOf(ctx) < price) {
    return { ok: false, reason: 'poor', text: `金币不足，需要 ${price} 🪙`, spent: 0 };
  }

  if (item.kind === 'perk') {
    // 买祝福 = 加入本轮三选池并立即生效一张（文档 3.6）
    callCtx(ctx, 'grantPerk', { id: item.perkId });
    pay(ctx, price);
    item.sold = true;
    return { ok: true, text: `祝福已入本轮并生效（${item.perkId}）`, spent: price };
  }
  if (item.kind === 'relic') return buyRelic(ctx, item, price);
  if (item.kind === 'service') return buyService(ctx, item, price);
  return { ok: false, reason: 'bad', text: '未知的商品类型', spent: 0 };
}

/**
 * 封禁（移除）本轮一条祝福——消消乐版「删牌」（文档 3.6）
 *
 * 校验顺序固定：金币不足（poor）→ 该祝福不在 picks 里（nope）。
 * 成功后扣 removeCost、调 banPerk 记入 bannedPerkIds、返还 removeRefund，
 * 并（若提供了钩子）调 removePerk 清 picks 计数。
 *
 * @param {object} ctx - 需含 picks / banPerk / removePerk?；金币走 getCoins / addCoins
 * @param {string} perkId - 要封禁的祝福 id
 * @param {{shopDiscount?:number}} [mods]
 * @returns {{ok:boolean, reason?:string, text:string, spent:number, refund:number}}
 */
export function removePerk(ctx, perkId, mods = {}) {
  const price = priceOf({ kind: 'remove' }, mods);
  if (coinsOf(ctx) < price) {
    return { ok: false, reason: 'poor', text: `金币不足，封禁需要 ${price} 🪙`, spent: 0, refund: 0 };
  }
  const picks = (ctx && ctx.picks) || {};
  const count = Number(picks[perkId]);
  if (!Number.isFinite(count) || count <= 0) {
    return { ok: false, reason: 'nope', text: '本轮没有这条祝福，无法封禁', spent: 0, refund: 0 };
  }

  callCtx(ctx, 'banPerk', perkId);
  callCtx(ctx, 'removePerk', perkId);
  pay(ctx, price);
  const refund = ROGUE_GOLD.removeRefund;
  refundCoins(ctx, refund);
  return { ok: true, text: `已封禁「${perkId}」，返还 ${refund} 🪙`, spent: price, refund };
}

/**
 * 刷新货架（花金币重掷一整架）
 *
 * 校验顺序固定：刷新次数达上限（limit）→ 金币不足（poor）→ 扣费、used++、重掷货架。
 * 注意：刷新费同样吃 mods.shopDiscount；成功时才消耗 rng（失败不动随机序列）。
 *
 * @param {object} rng - rng.js 发生器
 * @param {object} state - run 快照（成功时会扣减 state.coins）
 * @param {{used?:number}} refreshState - 刷新计数（成功时 used++）
 * @param {{shopDiscount?:number}} [mods]
 * @returns {{ok:boolean, reason?:string, text?:string, items?:Array, spent?:number}}
 */
export function refreshShelf(rng, state = {}, refreshState = {}, mods = {}) {
  const used = Number(refreshState && refreshState.used) || 0;
  if (used >= ROGUE_GOLD.refreshMax) {
    return { ok: false, reason: 'limit', text: `本轮刷新次数已用尽（上限 ${ROGUE_GOLD.refreshMax} 次）` };
  }
  const price = roundPrice(ROGUE_GOLD.refreshCost, discountOf(mods));
  const coins = Number(state && state.coins) || 0;
  if (coins < price) {
    return { ok: false, reason: 'poor', text: `金币不足，刷新需要 ${price} 🪙` };
  }

  const st = state || {};
  st.coins = Math.max(0, coins - price);
  if (refreshState && typeof refreshState === 'object') refreshState.used = used + 1;
  const items = rollShelf(rng, st, {});
  return { ok: true, items, spent: price };
}
