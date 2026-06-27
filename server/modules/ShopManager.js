const fs = require('fs');
const path = require('path');
const appConfig = require('../config');

class ShopManager {
  constructor() {
    this.dataDir = path.join(__dirname, '../config/shop');
    this.config = null;
    this.items = {};
    this.cosmetics = {};
    this.packs = {};
    this.vip = {};
    this.lastModified = {};
    this.lastCheck = 0;
    this.init();
  }

  // 初始化
  init() {
    this.loadAllConfig();
    console.log('[商店] 初始化完成，版本:', this.config.version);
  }

  // 加载所有配置
  loadAllConfig() {
    try {
      const files = ['config.json', 'items.json', 'cosmetics.json', 'packs.json', 'vip.json'];
      files.forEach(file => {
        const filePath = path.join(this.dataDir, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (file === 'config.json') {
          this.config = data;
        } else if (file === 'items.json') {
          this.items = data;
        } else if (file === 'cosmetics.json') {
          this.cosmetics = data;
        } else if (file === 'packs.json') {
          this.packs = data;
        } else if (file === 'vip.json') {
          this.vip = data;
        }

        this.lastModified[file] = fs.statSync(filePath).mtimeMs;
      });
    } catch (e) {
      console.error('[商店] 加载配置失败:', e);
      this.config = this.getDefaultConfig();
    }
  }

  // 检查更新（热更新）
  checkUpdate() {
    const now = Date.now();
    const checkInterval = this.config?.hotUpdate?.checkInterval || appConfig.shop.configCheckInterval;

    if (now - this.lastCheck < checkInterval) {
      return false;
    }
    this.lastCheck = now;

    try {
      const files = ['config.json', 'items.json', 'cosmetics.json', 'packs.json', 'vip.json'];
      let hasUpdate = false;

      files.forEach(file => {
        const filePath = path.join(this.dataDir, file);
        const stat = fs.statSync(filePath);

        if (stat.mtimeMs > (this.lastModified[file] || 0)) {
          hasUpdate = true;
        }
      });

      if (hasUpdate) {
        console.log('[商店] 检测到更新，重新加载...');
        const oldVersion = this.config.version;
        this.loadAllConfig();
        console.log(`[商店] 更新完成: ${oldVersion} -> ${this.config.version}`);
        return true;
      }
    } catch (e) {
      console.error('[商店] 检查更新失败:', e);
    }
    return false;
  }

  // 获取商店数据（支持灰度，支持动态价格）
  async getShopData(userId = null, accountManager = null) {
    this.checkUpdate();

    const result = {
      version: this.config.version,
      items: {},
      avatars: {},
      frames: {},
      skins: {},
      backgrounds: {},
      titles: {},
      packs: {},
      vip: {}
    };

    // 查询用户等级，用于动态价格商品的算价
    let userLevel = 1;
    if (userId && accountManager) {
      try {
        const acc = await accountManager._getAccount(userId);
        userLevel = acc?.account?.profile?.level || 1;
      } catch (e) { /* 取默认值 */ }
    }

    // 处理道具（动态价格商品：用当前等级算实时价格）
    // 注意：所有道具（包括 enabled:false 的）都返回基础信息，以便背包中展示已下架但玩家持有的道具
    Object.values(this.items || {}).forEach(item => {
      const canBuy = this.filterItem(item, userId);
      if (canBuy) {
        if (item.dynamic && accountManager) {
          const unitPrice = accountManager.getDynamicPrice(item, userLevel);
          const nextLvExp = accountManager.getExpForLevel(userLevel + 1);
          const maxLevel = accountManager.getMaxLevel();
          const priceTable = [];
          const showLevels = [];
          for (let l = 1; l <= maxLevel; l++) showLevels.push(l);
          for (const l of showLevels) {
            const p = accountManager.getDynamicPrice(item, l);
            const e = accountManager.getExpForLevel(l + 1);
            priceTable.push({ level: l, exp: e, price: p });
          }
          result.items[item.id] = { ...item, price: unitPrice, currentLevel: userLevel, lockedExp: nextLvExp, priceTable, maxLevel };
        } else {
          result.items[item.id] = item;
        }
      } else {
        result.items[item.id] = item;
      }
    });

    // 处理外观
    ['avatars', 'frames', 'skins', 'backgrounds', 'titles'].forEach(category => {
      Object.values(this.cosmetics[category] || {}).forEach(item => {
        if (this.filterItem(item, userId)) {
          result[category][item.id] = item;
        }
      });
    });

    // 处理礼包（包括 enabled:false 的，以便背包显示）
    Object.values(this.packs || {}).forEach(item => {
      result.packs[item.id] = item;
    });

    // 处理会员
    Object.values(this.vip || {}).forEach(item => {
      if (this.filterItem(item, userId)) {
        result.vip[item.id] = item;
      }
    });

    return result;
  }

  // 过滤商品（灰度发布）
  filterItem(item, userId) {
    // 对于enabled: false但名称包含"开发中"或"敬请期待"的占位商品，仍然返回（用于UI显示）
    if (!item.enabled) {
      if (item.name && (item.name.includes('开发中') || item.name.includes('敬请期待'))) {
        return true;
      }
      return false;
    }
    if (!userId) return true;

    if (item.rollout < 100) {
      const userHash = this.getUserHash(userId);
      if (userHash > item.rollout) return false;
    }
    return true;
  }

  // 检查限购
  async checkPurchaseLimit(userId, item, accountManager) {
    const limit = item.purchaseLimit;
    if (!limit || !limit.period || !limit.max) {
      return { allowed: true };
    }

    try {
      const records = await accountManager.getTransactionRecords(userId);
      const transactions = records.transactions || [];

      // 确定周期起始时间
      const now = Date.now();
      let periodStart;
      switch (limit.period) {
        case 'monthly':
          const d = new Date();
          periodStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
          break;
        case 'weekly':
          const w = new Date();
          const dayOfWeek = w.getDay();
          const diff = w.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
          periodStart = new Date(w.getFullYear(), w.getMonth(), diff).getTime();
          break;
        case 'daily':
          const today = new Date();
          periodStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
          break;
        case 'total':
          periodStart = 0;
          break;
        default:
          return { allowed: true };
      }

      // 统计周期内购买次数
      const purchaseCount = transactions.filter(tx => {
        return tx.type === 'spend'
          && tx.timestamp >= periodStart
          && tx.reason && tx.reason.includes(`购买${item.name}`);
      }).length;

      if (purchaseCount >= limit.max) {
        const periodMap = { monthly: '本月', weekly: '本周', daily: '今日', total: '累计' };
        const periodLabel = periodMap[limit.period] || limit.period;
        return {
          allowed: false,
          message: `${item.name}${periodLabel}限购${limit.max}个，已达到购买上限`
        };
      }

      return { allowed: true };
    } catch (e) {
      console.error('[商店] 限购检查失败:', e.message);
      return { allowed: true };
    }
  }

  // 查找商品
  findItem(itemId) {
    const allItems = [
      ...Object.values(this.items || {}),
      ...Object.values(this.cosmetics.frames || {}),
      ...Object.values(this.cosmetics.avatars || {}),
      ...Object.values(this.cosmetics.skins || {}),
      ...Object.values(this.cosmetics.backgrounds || {}),
      ...Object.values(this.cosmetics.titles || {}),
      ...Object.values(this.packs || {}),
      ...Object.values(this.vip || {})
    ];
    return allItems.find(item => item.id === itemId);
  }

  // VIP折扣（百分比）
  getVipDiscountPercent() {
    return this.config?.vipDiscount || appConfig.shop.vipDiscountPercent; // 默认9折
  }

  // 购买商品（支持批量数量）
  async purchaseItem(userId, itemId, quantity = 1, accountManager) {
    this.checkUpdate();

    const item = this.findItem(itemId);
    if (!item) {
      return { success: false, message: '商品不存在' };
    }
    if (!item.enabled) {
      return { success: false, message: '该商品暂未上线' };
    }

    // 动态价格商品：根据用户当前等级算价
    let lockedExp = 0;
    let currentLv = 1;
    let unitPrice = item.price || 0;
    if (item.dynamic) {
      const acc = await accountManager._getAccount(userId);
      currentLv = acc?.account?.profile?.level || 1;
      unitPrice = accountManager.getDynamicPrice(item, currentLv);
      // 锁定的经验 = 当前升到下一级所需经验
      lockedExp = accountManager.getExpForLevel(currentLv + 1);
    }

    // 检查VIP折扣 - 根据VIP类型（周卡/月卡/季卡/年卡）取对应的折扣率
    let discount = 0;
    try {
      const vipInfo = await accountManager.getVip(userId);
      if (vipInfo?.vip?.expireAt > Date.now()) {
        discount = vipInfo.vip.discountPercent || 0;
      }
    } catch (e) {
      // VIP查询失败不影响购买
    }

    const discountedPrice = Math.floor(unitPrice * (100 - discount) / appConfig.shop.discountDenominator);
    const totalPrice = discountedPrice * quantity;
    const savedAmount = (unitPrice - discountedPrice) * quantity;

    // 检查限购
    if (item.purchaseLimit) {
      const limitCheck = await this.checkPurchaseLimit(userId, item, accountManager);
      if (!limitCheck.allowed) {
        return { success: false, message: limitCheck.message };
      }
    }

    const currencyResult = await accountManager.getCurrency(userId);
    const balance = currencyResult?.balance ?? 0;
    if (balance < totalPrice) {
      return { success: false, message: `星钻不足，需要${totalPrice}💎，当前${balance}💎` };
    }

    await accountManager.useCurrency(userId, totalPrice, `购买${item.name}×${quantity}`);

    // 给动态价格商品准备 meta（锁定的经验 + 购买时等级）
    const itemMeta = item.dynamic ? { lockedExp, purchasedLevel: currentLv, purchasedAt: Date.now() } : null;
    for (let i = 0; i < quantity; i++) {
      await this.deliverItem(userId, item, accountManager, itemMeta);
    }

    return {
      success: true,
      message: discount > 0
        ? `购买成功！VIP折扣(${discount}%OFF) 省${savedAmount}💎，实付${totalPrice}💎`
        : `购买成功 ×${quantity}，共${totalPrice}💎`,
      item,
      quantity,
      totalPrice,
      discount,
      unitPrice
    };
  }

  // 发放商品
  async deliverItem(userId, item, accountManager, meta = null) {
    switch (item.category) {
      case 'item':
        await accountManager.addItem(userId, item.id, 1, meta, this);
        break;
      case 'frame':
      case 'avatar':
      case 'skin':
      case 'background':
      case 'title':
        await accountManager.addCosmetic(userId, item.category, item.id);
        break;
      case 'pack':
        await accountManager.addItem(userId, item.id, 1);
        break;
      case 'vip':
        await accountManager.addVip(userId, item.days, item.expBonus);
        break;
      case 'slot':
        await accountManager.addAvatarSlots(userId, item.slots || 1);
        break;
    }
  }

  // 开启礼包
  async openPack(userId, packId, accountManager) {
    const pack = this.findItem(packId);
    if (!pack || pack.category !== 'pack') {
      return { success: false, message: '礼包不存在' };
    }

    const rewards = [];
    for (const [contentId, count] of Object.entries(pack.content || {})) {
      const contentItem = this.findItem(contentId);
      if (contentItem) {
        for (let i = 0; i < count; i++) {
          await this.deliverItem(userId, contentItem, accountManager);
        }
        rewards.push({ id: contentId, name: contentItem.name, icon: contentItem.icon, count });
      }
    }

    return { success: true, rewards, message: `开启${pack.name}成功！` };
  }

  // 用户灰度哈希
  getUserHash(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % appConfig.shop.userGrayMod) + 1;
  }

  // 默认配置
  getDefaultConfig() {
    return {
      version: '1.0.0',
      hotUpdate: { enabled: true, checkInterval: appConfig.shop.defaultHotUpdateInterval }
    };
  }
}

module.exports = ShopManager;
