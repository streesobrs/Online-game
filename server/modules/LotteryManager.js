const fs = require('fs');
const path = require('path');

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const RARITY_RANK = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5 };
const CATEGORY_BUCKET = {
  frame: 'frames',
  avatar: 'avatars',
  skin: 'skins',
  background: 'backgrounds',
  title: 'titles',
};
const SHARD_RARITY = { 1: 'common', 5: 'uncommon', 10: 'rare', 20: 'rare', 50: 'epic', 100: 'legendary' };

/**
 * 星钻抽奖（二期）
 * - 每次抽取产出：外观碎片 / 道具 / 称号 / 外观
 * - 扣费、权重抽取、保底、重复判定、碎片与记录全部在服务端完成
 * - 奖池只允许「可购买的普通外观」，VIP 限定 / 条件解锁 / 免费默认项不会进入奖池
 */
class LotteryManager {
  constructor() {
    this.dataDir = path.join(__dirname, '../config/shop');
    this.config = null;
    this.lastModified = 0;
    this._cosmeticsCache = null;
    this._itemsCache = null;
    this.loadConfig();
  }

  loadConfig() {
    try {
      const filePath = path.join(this.dataDir, 'lottery.json');
      this.config = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      this.lastModified = fs.statSync(filePath).mtimeMs;
      console.log('[抽奖] 初始化完成，单抽', this.config.cost.single, '张券，十连', this.config.cost.ten, '张券');
    } catch (e) {
      console.error('[抽奖] 加载配置失败:', e.message);
      this.config = {
        version: '2.1.0',
        cost: { single: 1, ten: 10 },
        ticketPrice: { single: 60, ten: 540 },
        pity: { epic: 80, tenRare: 1 },
        dailyLimit: 0,
        recordLimit: 100,
        rewards: {
          shards: { weight: 65, amounts: [{ amount: 1, weight: 25 }, { amount: 5, weight: 25 }, { amount: 10, weight: 20 }, { amount: 20, weight: 15 }, { amount: 50, weight: 10 }, { amount: 100, weight: 5 }] },
          item: { weight: 18, ids: [] },
          title: { weight: 5, ids: [] },
          cosmetic: { weight: 12 },
        },
        duplicateShards: { common: 5, uncommon: 10, rare: 20, epic: 50, legendary: 100 },
        exchangeCost: {},
        pool: [],
      };
    }
  }

  checkUpdate() {
    try {
      const stat = fs.statSync(path.join(this.dataDir, 'lottery.json'));
      if (stat.mtimeMs > this.lastModified) this.loadConfig();
    } catch (e) { /* 读取失败沿用旧配置 */ }
  }

  _getCosmeticsConfig() {
    const filePath = path.join(this.dataDir, 'cosmetics.json');
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      if (!this._cosmeticsCache || this._cosmeticsCache.mtime !== mtime) {
        this._cosmeticsCache = { mtime, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
      }
      return this._cosmeticsCache.data;
    } catch (e) {
      return { frames: {}, avatars: {}, skins: {}, backgrounds: {}, titles: {} };
    }
  }

  _getItemsConfig() {
    const filePath = path.join(this.dataDir, 'items.json');
    try {
      const mtime = fs.statSync(filePath).mtimeMs;
      if (!this._itemsCache || this._itemsCache.mtime !== mtime) {
        this._itemsCache = { mtime, data: JSON.parse(fs.readFileSync(filePath, 'utf8')) };
      }
      return this._itemsCache.data;
    } catch (e) {
      return {};
    }
  }

  /** 外观奖池（与 cosmetics.json 交叉校验，过滤 VIP / 条件解锁 / 免费 / 下架） */
  getPool() {
    this.checkUpdate();
    const cfg = this._getCosmeticsConfig();
    const pool = [];
    (this.config.pool || []).forEach((entry) => {
      const id = typeof entry === 'string' ? entry : entry.id;
      if (!id) return;
      let found = null;
      Object.values(CATEGORY_BUCKET).some((bucket) => {
        found = cfg[bucket]?.[id] || null;
        return Boolean(found);
      });
      if (!found) return;
      if (found.enabled === false || found.vipOnly || found.unlock || !(Number(found.price) > 0)) return;
      const rarity = (typeof entry === 'object' && entry.rarity) || found.rarity || 'common';
      if (!RARITIES.includes(rarity)) return;
      pool.push({
        id: found.id,
        name: found.name,
        icon: found.icon || '🎁',
        rarity,
        category: found.category,
        weight: Math.max(1, Number(entry.weight) || 1),
      });
    });
    return pool;
  }

  /** 称号奖池（仅抽奖限定称号；条件解锁 / VIP 称号一律不进入奖池） */
  _getTitlePool() {
    const cosmetics = this._getCosmeticsConfig();
    return (this.config.rewards?.title?.ids || [])
      .map((id) => cosmetics.titles?.[id])
      .filter((item) => item && !item.unlock && !item.vipOnly)
      .map((item) => ({
        id: item.id,
        name: item.name,
        icon: item.icon || '🏷',
        rarity: item.rarity || 'epic',
      }));
  }

  _getItemPool() {
    const items = this._getItemsConfig();
    return (this.config.rewards?.item?.ids || [])
      .map((id) => items[id])
      .filter((item) => item && item.enabled !== false && item.category === 'item');
  }

  _today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  _normalizeLottery(account) {
    if (!account.lottery || typeof account.lottery !== 'object') account.lottery = {};
    const l = account.lottery;
    l.pityEpic = Number(l.pityEpic) || 0;
    l.shards = Number(l.shards) || 0;
    l.tickets = Number(l.tickets) || 0;
    l.totalDraws = Number(l.totalDraws) || 0;
    l.lastDrawAt = Number(l.lastDrawAt) || 0;
    l.dailyDate = typeof l.dailyDate === 'string' ? l.dailyDate : '';
    l.dailyDraws = Number(l.dailyDraws) || 0;
    if (!Array.isArray(l.records)) l.records = [];
    if (!Array.isArray(l.exchanges)) l.exchanges = [];
    return l;
  }

  _ensureCosmetics(account) {
    if (!account.cosmetics || typeof account.cosmetics !== 'object') {
      account.cosmetics = { slots: 0, owned: {}, equipped: {} };
    }
    if (!account.cosmetics.owned) account.cosmetics.owned = {};
    ['frames', 'avatars', 'customAvatars', 'skins', 'backgrounds', 'titles'].forEach((key) => {
      if (!Array.isArray(account.cosmetics.owned[key])) account.cosmetics.owned[key] = [];
    });
    return account.cosmetics;
  }

  _weightedPick(entries) {
    const list = entries.filter(([, weight]) => Number(weight) > 0);
    if (list.length === 0) return null;
    const total = list.reduce((sum, [, weight]) => sum + Number(weight), 0);
    let roll = Math.random() * total;
    for (const [key, weight] of list) {
      roll -= Number(weight);
      if (roll <= 0) return key;
    }
    return list[list.length - 1][0];
  }

  /** 抽取奖励类别；forced=true 时只在非碎片类别中抽 */
  _pickCategory(forced, pool) {
    const rewards = this.config.rewards || {};
    const entries = [];
    if (!forced) {
      entries.push(['shards', rewards.shards?.weight]);
    }
    if (pool.length > 0) entries.push(['cosmetic', rewards.cosmetic?.weight]);
    if (this._getItemPool().length > 0) entries.push(['item', rewards.item?.weight]);
    if (this._getTitlePool().length > 0) entries.push(['title', rewards.title?.weight]);

    const picked = this._weightedPick(entries);
    if (picked) return picked;
    return pool.length > 0 ? 'cosmetic' : 'shards';
  }

  /** 碎片档位：1 / 5 / 10 / 20 / 50 / 100 */
  _pickShardAmount() {
    const amounts = this.config.rewards?.shards?.amounts || [];
    const picked = this._weightedPick(amounts.map((a) => [a.amount, a.weight]));
    return Number(picked) || 1;
  }

  /** 按权重抽取稀有度；forced 用于保底 */
  _pickRarity(forced, pool) {
    const weights = this.config.rarityWeights || {};
    let allowed = RARITIES.slice();
    if (forced === 'epic') allowed = ['epic', 'legendary'];
    else if (forced === 'rare') allowed = ['rare', 'epic', 'legendary'];

    const hasItems = (r) => pool.some((p) => p.rarity === r);
    let list = allowed.filter((r) => hasItems(r) && (Number(weights[r]) || 0) > 0);
    if (list.length === 0) list = allowed.filter(hasItems);
    if (list.length === 0) return null;

    return this._weightedPick(list.map((r) => [r, Number(weights[r]) || 1]));
  }

  /** 稀有度内按 weight 抽取具体外观 */
  _pickItem(pool, rarity) {
    const list = pool.filter((p) => p.rarity === rarity);
    if (list.length === 0) return null;
    const id = this._weightedPick(list.map((p) => [p.id, p.weight]));
    return list.find((p) => p.id === id) || list[0];
  }

  async getInfo(userId, accountManager) {
    this.checkUpdate();
    const account = await accountManager._getAccount(userId);
    if (!account) return { success: false, message: '账号不存在' };

    const l = this._normalizeLottery(account);
    const owned = account.cosmetics?.owned || {};
    const today = this._today();
    const dailyDraws = l.dailyDate === today ? l.dailyDraws : 0;
    const dailyLimit = Number(this.config.dailyLimit) || 0;
    const rewards = this.config.rewards || {};

    const pool = this.getPool().map((item) => ({
      ...item,
      owned: (owned[CATEGORY_BUCKET[item.category]] || []).includes(item.id),
    }));

    return {
      success: true,
      cost: this.config.cost,
      pity: { ...this.config.pity, current: l.pityEpic },
      categoryWeights: {
        shards: Number(rewards.shards?.weight) || 0,
        item: Number(rewards.item?.weight) || 0,
        title: Number(rewards.title?.weight) || 0,
        cosmetic: Number(rewards.cosmetic?.weight) || 0,
      },
      shardAmounts: (rewards.shards?.amounts || []).map((a) => ({ amount: a.amount, weight: a.weight })),
      duplicateShards: this.config.duplicateShards,
      exchangeCost: this.config.exchangeCost,
      dailyLimit,
      dailyDraws,
      dailyRemaining: dailyLimit > 0 ? Math.max(0, dailyLimit - dailyDraws) : null,
      tickets: l.tickets,
      ticketPrice: this.config.ticketPrice || { single: 60, ten: 540 },
      shards: l.shards,
      totalDraws: l.totalDraws,
      lastDrawAt: l.lastDrawAt,
      balance: account.currency?.starCoins || 0,
      pool,
      records: l.records,
    };
  }

  async draw(userId, count, accountManager) {
    this.checkUpdate();
    const n = Number(count);
    if (n !== 1 && n !== 10) return { success: false, message: '抽奖次数只能是 1 或 10' };

    const account = await accountManager._getAccount(userId);
    if (!account) return { success: false, message: '账号不存在' };

    const l = this._normalizeLottery(account);
    const today = this._today();
    if (l.dailyDate !== today) { l.dailyDate = today; l.dailyDraws = 0; }

    const dailyLimit = Number(this.config.dailyLimit) || 0;
    if (dailyLimit > 0 && l.dailyDraws + n > dailyLimit) {
      return { success: false, message: `今日抽奖上限 ${dailyLimit} 次，已抽 ${l.dailyDraws} 次` };
    }

    const cost = n === 10 ? this.config.cost.ten : this.config.cost.single;
    if (l.tickets < cost) {
      return { success: false, message: `抽奖券不足，需要 ${cost} 张，当前 ${l.tickets} 张` };
    }

    const pool = this.getPool();
    const titlePool = this._getTitlePool();
    const itemPool = this._getItemPool();
    if (pool.length === 0 && titlePool.length === 0 && itemPool.length === 0) {
      return { success: false, message: '奖池暂未开放' };
    }

    // 以当前拥有情况计算抽奖结果
    const cosmetics = this._ensureCosmetics(account);
    const ownedSets = {};
    Object.values(CATEGORY_BUCKET).forEach((bucket) => {
      ownedSets[bucket] = new Set(cosmetics.owned[bucket] || []);
    });

    const results = [];
    const added = { frames: [], avatars: [], skins: [], backgrounds: [], titles: [] };
    const itemRewards = {};
    let shardGain = 0;
    let nonShardCount = 0;
    let pity = l.pityEpic;
    const pityTarget = this.config.pity?.epic || 80;
    const duplicateShards = this.config.duplicateShards || {};

    for (let i = 0; i < n; i++) {
      const isLast = i === n - 1;
      let category;
      let forcedRarity = null;

      if (pity + 1 >= pityTarget && pool.length > 0) {
        category = 'cosmetic';
        forcedRarity = 'epic';
      } else if (n === 10 && isLast && nonShardCount === 0) {
        category = this._pickCategory(true, pool);
      } else {
        category = this._pickCategory(false, pool);
      }

      let result;

      if (category === 'item' && itemPool.length > 0) {
        const item = itemPool[Math.floor(Math.random() * itemPool.length)];
        itemRewards[item.id] = (itemRewards[item.id] || 0) + 1;
        result = {
          type: 'item',
          id: item.id,
          name: item.name,
          icon: item.icon || '🎁',
          quantity: 1,
          rarity: item.rarity || 'common',
        };
      } else if (category === 'title' && titlePool.length > 0) {
        const title = titlePool[Math.floor(Math.random() * titlePool.length)];
        const owned = ownedSets.titles.has(title.id);
        let shards = 0;
        if (owned) {
          shards = Number(duplicateShards[title.rarity]) || 20;
          shardGain += shards;
        } else {
          ownedSets.titles.add(title.id);
          added.titles.push(title.id);
        }
        result = {
          type: 'title',
          id: title.id,
          name: title.name,
          icon: title.icon,
          rarity: title.rarity,
          duplicate: owned,
          shards,
        };
      } else if (category === 'cosmetic' && pool.length > 0) {
        let rarity = this._pickRarity(forcedRarity, pool);
        let item = rarity ? this._pickItem(pool, rarity) : null;
        if (!item) {
          rarity = 'common';
          item = this._pickItem(pool, 'common');
        }
        if (!item) {
          const amount = this._pickShardAmount();
          shardGain += amount;
          result = { type: 'shard', name: '外观碎片', icon: '🧩', amount, rarity: SHARD_RARITY[amount] || 'common' };
        } else {
          const bucket = CATEGORY_BUCKET[item.category];
          const owned = ownedSets[bucket]?.has(item.id) || false;
          let shards = 0;
          if (owned) {
            shards = Number(duplicateShards[rarity]) || 0;
            shardGain += shards;
          } else {
            ownedSets[bucket]?.add(item.id);
            added[bucket]?.push(item.id);
          }
          result = {
            type: 'cosmetic',
            id: item.id,
            name: item.name,
            icon: item.icon,
            rarity,
            category: item.category,
            duplicate: owned,
            shards,
          };
        }
      } else {
        const amount = this._pickShardAmount();
        shardGain += amount;
        result = { type: 'shard', name: '外观碎片', icon: '🧩', amount, rarity: SHARD_RARITY[amount] || 'common' };
      }

      pity += 1;
      if (result.type === 'cosmetic' && RARITY_RANK[result.rarity] >= 4) pity = 0;
      if (result.type !== 'shard') nonShardCount += 1;
      results.push(result);
    }

    if (results.length === 0) return { success: false, message: '奖池暂未开放' };

    // 扣除抽奖券，写入结果（保底、碎片、记录全部在服务端结算）
    l.tickets -= cost;
    Object.entries(added).forEach(([bucket, ids]) => {
      ids.forEach((id) => {
        if (!cosmetics.owned[bucket].includes(id)) cosmetics.owned[bucket].push(id);
      });
    });

    l.pityEpic = pity;
    l.shards += shardGain;
    l.totalDraws += n;
    l.lastDrawAt = Date.now();
    l.dailyDate = today;
    l.dailyDraws = l.dailyDraws + n;

    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: l.lastDrawAt,
      count: n,
      cost,
      unit: 'ticket',
      results: results.map((r) => ({ ...r })),
    };
    l.records.unshift(record);
    l.records = l.records.slice(0, this.config.recordLimit || 100);

    await accountManager._saveAccount(userId, account);

    // 道具奖励写入背包（独立存储）
    for (const [itemId, quantity] of Object.entries(itemRewards)) {
      try {
        await accountManager.addItem(userId, itemId, quantity);
      } catch (err) {
        console.error('[抽奖] 发放道具失败', { userId, itemId, quantity, error: err.message });
      }
    }

    return {
      success: true,
      results,
      record,
      balance: account.currency?.starCoins || 0,
      tickets: l.tickets,
      pityEpic: l.pityEpic,
      shards: l.shards,
      totalDraws: l.totalDraws,
      dailyDraws: l.dailyDraws,
      dailyLimit,
    };
  }

  /** 星钻兑换抽奖券（1 张 / 10 张）；抽奖本身只消耗票券 */
  async buyTickets(userId, count, accountManager) {
    this.checkUpdate();
    const n = Number(count);
    if (n !== 1 && n !== 10) return { success: false, message: '兑换数量只能是 1 或 10' };

    const prices = this.config.ticketPrice || {};
    const price = n === 10 ? Number(prices.ten) : Number(prices.single);
    if (!(price > 0)) return { success: false, message: '抽奖券兑换暂未开放' };

    const account = await accountManager._getAccount(userId);
    if (!account) return { success: false, message: '账号不存在' };

    const balance = account.currency?.starCoins || 0;
    if (balance < price) {
      return { success: false, message: `星钻不足，需要 ${price}💎，当前 ${balance}💎` };
    }

    const pay = await accountManager.useCurrency(userId, price, `兑换抽奖券×${n}`);
    if (!pay.success) return pay;

    // 扣费后重新读取，避免把扣费前的余额写回
    const latest = await accountManager._getAccount(userId);
    if (!latest) return { success: false, message: '账号不存在' };
    const l = this._normalizeLottery(latest);
    l.tickets += n;
    await accountManager._saveAccount(userId, latest);

    return { success: true, tickets: l.tickets, balance: pay.balance, message: `兑换 ${n} 张抽奖券成功` };
  }

  async exchange(userId, cosmeticId, accountManager) {
    this.checkUpdate();
    const item = this.getPool().find((p) => p.id === cosmeticId);
    if (!item) return { success: false, message: '该外观不在兑换范围内' };

    const cost = Number(this.config.exchangeCost?.[item.rarity]) || 0;
    if (cost <= 0) return { success: false, message: '该外观暂不可兑换' };

    const account = await accountManager._getAccount(userId);
    if (!account) return { success: false, message: '账号不存在' };

    const l = this._normalizeLottery(account);
    if (l.shards < cost) {
      return { success: false, message: `外观碎片不足，需要 ${cost} 个，当前 ${l.shards} 个` };
    }

    const cosmetics = this._ensureCosmetics(account);
    const bucket = CATEGORY_BUCKET[item.category];
    if (cosmetics.owned[bucket].includes(item.id)) {
      return { success: false, message: '已拥有该外观' };
    }

    l.shards -= cost;
    l.exchanges.unshift({ at: Date.now(), id: item.id, name: item.name, rarity: item.rarity, cost });
    l.exchanges = l.exchanges.slice(0, 50);
    cosmetics.owned[bucket].push(item.id);

    await accountManager._saveAccount(userId, account);

    return {
      success: true,
      message: `兑换成功！获得「${item.name}」`,
      shards: l.shards,
      cosmetic: { id: item.id, name: item.name, icon: item.icon, rarity: item.rarity, category: item.category },
    };
  }

  async getRecords(userId, accountManager) {
    const account = await accountManager._getAccount(userId);
    if (!account) return { success: false, message: '账号不存在', records: [] };
    const l = this._normalizeLottery(account);
    return {
      success: true,
      shards: l.shards,
      totalDraws: l.totalDraws,
      pityEpic: l.pityEpic,
      records: l.records,
    };
  }
}

module.exports = LotteryManager;
