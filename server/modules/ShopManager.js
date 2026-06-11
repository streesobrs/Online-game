const fs = require('fs');
const path = require('path');

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
    const checkInterval = this.config?.hotUpdate?.checkInterval || 30000;

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

  // 获取商店数据（支持灰度）
  getShopData(userId = null) {
    this.checkUpdate();

    const result = {
      version: this.config.version,
      items: {},
      frames: {},
      skins: {},
      backgrounds: {},
      titles: {},
      packs: {},
      vip: {}
    };

    // 处理道具
    Object.values(this.items || {}).forEach(item => {
      if (this.filterItem(item, userId)) {
        result.items[item.id] = item;
      }
    });

    // 处理外观
    ['frames', 'skins', 'backgrounds', 'titles'].forEach(category => {
      Object.values(this.cosmetics[category] || {}).forEach(item => {
        if (this.filterItem(item, userId)) {
          result[category][item.id] = item;
        }
      });
    });

    // 处理礼包
    Object.values(this.packs || {}).forEach(item => {
      if (this.filterItem(item, userId)) {
        result.packs[item.id] = item;
      }
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

  // 查找商品
  findItem(itemId) {
    const allItems = [
      ...Object.values(this.items || {}),
      ...Object.values(this.cosmetics.frames || {}),
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
    return this.config?.vipDiscount || 10; // 默认9折
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

    // 检查VIP折扣
    let discount = 0;
    try {
      const vipInfo = await accountManager.getVip(userId);
      if (vipInfo?.vip?.expireAt > Date.now()) {
        discount = this.getVipDiscountPercent();
      }
    } catch (e) {
      // VIP查询失败不影响购买
    }

    const unitPrice = item.price;
    const discountedPrice = Math.floor(unitPrice * (100 - discount) / 100);
    const totalPrice = discountedPrice * quantity;
    const savedAmount = (unitPrice - discountedPrice) * quantity;

    const currencyResult = await accountManager.getCurrency(userId);
    const balance = currencyResult?.balance ?? 0;
    if (balance < totalPrice) {
      return { success: false, message: `星钻不足，需要${totalPrice}💎，当前${balance}💎` };
    }

    await accountManager.useCurrency(userId, totalPrice, `购买${item.name}×${quantity}`);
    for (let i = 0; i < quantity; i++) {
      await this.deliverItem(userId, item, accountManager);
    }

    return {
      success: true,
      message: discount > 0
        ? `购买成功！VIP折扣(${discount}%OFF) 省${savedAmount}💎，实付${totalPrice}💎`
        : `购买成功 ×${quantity}，共${totalPrice}💎`,
      item,
      quantity,
      totalPrice,
      discount
    };
  }

  // 发放商品
  async deliverItem(userId, item, accountManager) {
    switch (item.category) {
      case 'item':
        await accountManager.addItem(userId, item.id, 1);
        break;
      case 'frame':
      case 'skin':
      case 'background':
      case 'title':
        await accountManager.addCosmetic(userId, item.category, item.id);
        break;
      case 'pack':
        for (const [contentId, count] of Object.entries(item.content)) {
          const contentItem = this.findItem(contentId);
          if (contentItem) {
            for (let i = 0; i < count; i++) {
              await this.deliverItem(userId, contentItem, accountManager);
            }
          }
        }
        break;
      case 'vip':
        await accountManager.addVip(userId, item.days, item.expBonus);
        break;
    }
  }

  // 用户灰度哈希
  getUserHash(userId) {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = ((hash << 5) - hash) + userId.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash % 100) + 1;
  }

  // 默认配置
  getDefaultConfig() {
    return {
      version: '1.0.0',
      hotUpdate: { enabled: true, checkInterval: 30000 }
    };
  }
}

module.exports = ShopManager;
