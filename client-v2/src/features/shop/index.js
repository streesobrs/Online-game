/**
 * 商城模块（任务 4.6）
 * - 4.6.1 商品列表：道具 / 头像 / 头像框 / 皮肤 / 背景 / 称号 / 礼包 / VIP 分类展示
 * - 4.6.2 购买流程：星钻余额展示，POST /api/shop/buy，购买后刷新余额/背包
 * - 4.6.3 道具使用（POST /api/shop/use-item）与外观装备（POST /api/shop/cosmetics/equip）
 *
 * 数据来源均为服务端 REST API（v1 无商城页面，本页按 API 数据结构全新实现）：
 * - GET /api/shop/data?userId= → {items, avatars, frames, skins, backgrounds, titles, packs, vip}
 * - GET /api/shop/inventory?userId= → {inventory:{items, undoCount, hintCount}}
 * - GET /api/currency/balance?userId= → {balance}
 * - GET /api/shop/vip?userId= → {vip:{isActive, remainingDays, discountPercent}}
 * - GET /api/shop/cosmetics?userId= → {cosmetics:{owned:{...}, equipped:{...}}}
 * - GET /api/shop/cosmetics/config → {cosmetics:{frames, avatars, skins, backgrounds, titles}}
 */
import { api } from '../../core/api.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { store } from '../../core/store.js';

/** 商城商品分类（对应 /api/shop/data 返回的键；delisted 为"下架"聚合分类） */
const CATEGORIES = [
  { key: 'items', label: '🧩 道具', cosmetic: false },
  { key: 'avatars', label: '😀 头像', cosmetic: true, equipCat: 'avatar' },
  { key: 'frames', label: '⭕ 头像框', cosmetic: true, equipCat: 'frame' },
  { key: 'skins', label: '🎨 皮肤', cosmetic: true, equipCat: 'skin' },
  { key: 'backgrounds', label: '🖼 背景', cosmetic: true, equipCat: 'background' },
  { key: 'titles', label: '🏷 称号', cosmetic: true, equipCat: 'title' },
  { key: 'packs', label: '🎁 礼包', cosmetic: false },
  { key: 'vip', label: '👑 VIP', cosmetic: false },
  { key: 'delisted', label: '🚫 下架', delisted: true },
];

/** 商城一级视图：购买 / 背包 */
const SHOP_VIEWS = [
  { key: 'shop', label: '🛒 商城' },
  { key: 'inventory', label: '🎒 背包' },
];

/** 稀有度 → 颜色 */
const RARITY_COLORS = {
  common: '#718096',
  uncommon: '#48bb78',
  rare: '#3182ce',
  epic: '#805ad5',
  legendary: '#d69e2e',
};

/** 当前用户 ID（与 v1 商城接口对齐：currentAccountId） */
function currentUserId() {
  return localStorage.getItem('currentAccountId') || '';
}

/**
 * 渲染商城视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderShop(container) {
  let activeView = 'shop';          // 'shop' | 'inventory'
  let activeCat = CATEGORIES[0].key;
  let shopData = null;      // /api/shop/data 返回的 data
  let inventory = {};       // {itemId: count}
  let balance = 0;          // 星钻余额
  let vipInfo = null;       // {isActive, remainingDays, ...}
  let cosmetics = null;     // {owned, equipped}
  let cosmeticConfig = null; // cosmetics.json 配置

  const balanceEl = el('span', { class: 'shop-balance' }, '💎 --');
  const vipEl = el('span', { class: 'shop-vip-badge' }, '');
  const viewTabsEl = el('div', { class: 'shop-view-tabs' });
  const gridEl = el('div', { class: 'shop-grid' });
  const vipCompareEl = el('div', { class: 'shop-vip-compare' });
  const inventoryEl = el('div', { class: 'shop-inventory' });
  const tabsEl = el('div', { class: 'shop-tabs' });
  const loadingEl = el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '⏳ 加载中...');

  // ---- 数据加载 ----
  async function loadAll() {
    const userId = currentUserId();
    try {
      const [dataRes, invRes, balRes, vipRes, cosRes, cfgRes] = await Promise.all([
        api.shop.getData(userId),
        api.shop.getInventory(userId),
        api.shop.getBalance(userId),
        api.shop.getVip(userId),
        api.shop.getCosmetics(userId),
        api.shop.getCosmeticsConfig(),
      ]);
      shopData = dataRes.data || {};
      inventory = invRes.inventory?.items || {};
      balance = balRes.balance ?? 0;
      vipInfo = vipRes.vip || null;
      cosmetics = cosRes.cosmetics || null;
      cosmeticConfig = cfgRes.cosmetics || null;
    } catch (err) {
      toast.error(err.message || '加载商城失败');
      shopData = {};
    }
    renderHeader();
    renderViewTabs();
    renderTabs();
    renderGrid();
    renderInventory();
    syncViewVisibility();
  }

  // ---- 一级视图（商城 / 背包） ----
  function renderViewTabs() {
    viewTabsEl.innerHTML = '';
    SHOP_VIEWS.forEach((v) => {
      const btn = el('button', {
        class: 'shop-view-tab' + (v.key === activeView ? ' active' : ''),
        onClick: () => {
          activeView = v.key;
          renderViewTabs();
          syncViewVisibility();
        },
      }, v.label);
      viewTabsEl.appendChild(btn);
    });
  }

  function syncViewVisibility() {
    const isShop = activeView === 'shop';
    tabsEl.style.display = isShop ? '' : 'none';
    gridEl.style.display = isShop ? '' : 'none';
    vipCompareEl.style.display = isShop ? '' : 'none';
    inventoryEl.style.display = isShop ? 'none' : '';
  }

  // ---- 头部：余额 + VIP ----
  function renderHeader() {
    balanceEl.textContent = `💎 ${balance}`;
    if (vipInfo?.isActive) {
      vipEl.textContent = `👑 VIP ${vipInfo.remainingDays}天`;
      vipEl.style.display = '';
    } else {
      vipEl.style.display = 'none';
    }
  }

  // ---- 分类 Tab ----
  function renderTabs() {
    tabsEl.innerHTML = '';
    CATEGORIES.forEach((cat) => {
      const tab = el('button', {
        class: 'shop-tab' + (cat.key === activeCat ? ' active' : ''),
        onClick: () => {
          activeCat = cat.key;
          renderTabs();
          renderGrid();
        },
      }, cat.label);
      tabsEl.appendChild(tab);
    });
  }

  // ---- 商品网格 ----
  function renderGrid() {
    gridEl.innerHTML = '';
    vipCompareEl.innerHTML = '';
    if (activeCat === 'delisted') {
      renderDelistedGrid();
      return;
    }
    // 常规分类只展示在售商品（enabled:false 的下架商品由"下架"分类承载）
    const items = Object.values((shopData && shopData[activeCat]) || {})
      .filter((it) => it.enabled !== false);
    if (!items || items.length === 0) {
      gridEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '该分类暂无商品'));
      return;
    }
    items.forEach((item) => gridEl.append(itemCard(item, currentCat())));
    // VIP 分类追加特权对比表（对齐 v1 商城）
    if (activeCat === 'vip') vipCompareEl.append(renderVipCompare());
  }

  /** 当前分类定义 */
  function currentCat() {
    return CATEGORIES.find((c) => c.key === activeCat);
  }

  /** 下架分类：展示玩家已拥有的下架商品（道具/礼包/外观），供使用与装备 */
  function renderDelistedGrid() {
    const entries = collectDelistedItems();
    if (entries.length === 0) {
      gridEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '暂无下架商品'));
      return;
    }
    entries.forEach(({ cat, item }) => gridEl.append(itemCard(item, cat)));
  }

  /** 收集玩家拥有的所有下架商品（附带其所属分类） */
  function collectDelistedItems() {
    const result = [];
    CATEGORIES.forEach((cat) => {
      if (cat.delisted || cat.key === 'vip') return;
      const list = Object.values((shopData && shopData[cat.key]) || {});
      list.forEach((item) => {
        if (item.enabled === false && isItemOwned(item, cat)) result.push({ cat, item });
      });
    });
    return result;
  }

  /** 玩家是否已拥有该商品（道具/礼包看背包数量，外观看已拥有列表） */
  function isItemOwned(item, cat) {
    if (cat.cosmetic) return (cosmetics?.owned?.[cat.key] || []).includes(item.id);
    return (inventory[item.id] || 0) > 0;
  }

  // ---- 单个商品卡片（cat 可指定所属分类，下架分类中传入原分类） ----
  function itemCard(item, cat = currentCat()) {
    const isItem = !cat.cosmetic && item.category !== 'pack' && item.category !== 'vip';
    const ownedCount = inventory[item.id] || 0;

    const priceEl = el('span', { class: 'shop-price' }, `💎 ${item.price ?? 0}`);
    const rarity = item.rarity || 'common';

    const isDisabled = item.enabled === false;

    // 购买按钮（已下架商品禁用）
    const buyBtn = isDisabled
      ? el('button', { class: 'btn shop-buy-btn', disabled: true }, '🚫 已下架')
      : el('button', {
        class: 'btn shop-buy-btn',
        onClick: () => buyItem(item),
      }, '购买');

    // 外观卡片：已拥有/已装备状态 + 装备按钮
    let statusEl = null;
    let equipBtn = null;
    if (cat.cosmetic) {
      const ownedList = cosmetics?.owned?.[cat.key] || [];
      const isOwned = ownedList.includes(item.id);
      const isEquipped = cosmetics?.equipped?.[cat.equipCat] === item.id;
      statusEl = el('span', {
        class: 'shop-owned' + (isOwned ? ' owned' : ''),
      }, isOwned ? '✅ 已拥有' : '未拥有');
      if (isOwned) {
        equipBtn = el('button', {
          class: 'btn shop-equip-btn' + (isEquipped ? ' equipped' : ''),
          onClick: () => equipItem(cat.equipCat, item.id),
        }, isEquipped ? '✔ 已装备' : '装备');
      }
    }

    // 道具卡片：显示背包数量 + 使用按钮
    let useBtn = null;
    let countEl = null;
    if (isItem) {
      countEl = el('span', { class: 'shop-count' }, ownedCount > 0 ? `背包 ×${ownedCount}` : '未拥有');
      if (ownedCount > 0 && item.usable) {
        useBtn = el('button', {
          class: 'btn shop-use-btn',
          onClick: () => useItem(item),
        }, '使用');
      }
    }

    return el('div', { class: 'shop-card', style: `border-top:3px solid ${RARITY_COLORS[rarity] || '#718096'};` }, [
      el('div', { class: 'shop-card-icon' }, [
        item.icon || '🎁',
        item.tradable === false
          ? el('span', { class: 'shop-tradable-badge', title: '该商品不可交易' }, '🔒 不可交易')
          : null,
      ]),
      el('div', { class: 'shop-card-body' }, [
        el('div', { class: 'shop-card-name' }, [
          item.name,
          el('span', { class: 'shop-rarity', style: `color:${RARITY_COLORS[rarity] || '#718096'};` }, rarity),
        ]),
        el('div', { class: 'shop-card-desc' }, item.description || ''),
        el('div', { class: 'shop-card-foot' }, [
          priceEl,
          statusEl || countEl,
        ]),
      ]),
      el('div', { class: 'shop-card-actions' }, [
        equipBtn || useBtn || null,
        buyBtn,
      ]),
    ]);
  }

  // ---- 背包视图（已拥有道具/礼包/外观，含已下架） ----
  function renderInventory() {
    inventoryEl.innerHTML = '';

    const items = [];
    const packs = [];
    for (const [id, count] of Object.entries(inventory || {})) {
      if (count <= 0) continue;
      const itemInfo = shopData?.items?.[id];
      const packInfo = shopData?.packs?.[id];
      if (itemInfo) items.push({ ...itemInfo, _count: count });
      else if (packInfo) packs.push({ ...packInfo, _count: count });
      else items.push({ id, icon: '📦', name: id, description: '', rarity: 'common', _count: count });
    }

    const renderItemCard = (it, isPack) => {
      const rarity = it.rarity || 'common';
      return el('div', { class: 'shop-card', style: `border-top:3px solid ${RARITY_COLORS[rarity] || '#718096'};` }, [
        el('div', { class: 'shop-card-icon' }, [
          it.icon || '📦',
          it.enabled === false
            ? el('span', { class: 'shop-tradable-badge', title: '该商品已下架' }, '🚫 已下架')
            : null,
        ]),
        el('div', { class: 'shop-card-body' }, [
          el('div', { class: 'shop-card-name' }, [
            it.name,
            el('span', { class: 'shop-rarity', style: `color:${RARITY_COLORS[rarity] || '#718096'};` }, rarity),
          ]),
          el('div', { class: 'shop-card-desc' }, it.description || ''),
          el('div', { class: 'shop-card-foot' }, [
            el('span', { class: 'shop-count' }, `背包 ×${it._count}`),
          ]),
        ]),
        el('div', { class: 'shop-card-actions' }, [
          el('button', { class: 'btn shop-use-btn', onClick: () => useItem(it) }, isPack ? '🎁 开启' : '✋ 使用'),
        ]),
      ]);
    };

    const renderCosmeticCard = (id, cat) => {
      const it = shopData?.[cat.key]?.[id] || { icon: '📦', name: id, description: '', rarity: 'common' };
      const rarity = it.rarity || 'common';
      const isEquipped = cosmetics?.equipped?.[cat.equipCat] === id;
      return el('div', { class: 'shop-card', style: `border-top:3px solid ${RARITY_COLORS[rarity] || '#718096'};` }, [
        el('div', { class: 'shop-card-icon' }, [
          it.icon || '📦',
          it.enabled === false
            ? el('span', { class: 'shop-tradable-badge', title: '该商品已下架' }, '🚫 已下架')
            : null,
        ]),
        el('div', { class: 'shop-card-body' }, [
          el('div', { class: 'shop-card-name' }, [
            it.name,
            el('span', { class: 'shop-rarity', style: `color:${RARITY_COLORS[rarity] || '#718096'};` }, rarity),
          ]),
          el('div', { class: 'shop-card-desc' }, it.description || ''),
          el('div', { class: 'shop-card-foot' }, [
            el('span', { class: 'shop-owned' + (isEquipped ? ' owned' : '') }, isEquipped ? '✅ 已装备' : '已拥有'),
          ]),
        ]),
        el('div', { class: 'shop-card-actions' }, [
          isEquipped
            ? null
            : el('button', { class: 'btn shop-equip-btn', onClick: () => equipItem(cat.equipCat, id) }, '✨ 装备'),
        ]),
      ]);
    };

    const cosmeticCats = [
      { key: 'avatars', title: '😀 头像', equipCat: 'avatar' },
      { key: 'frames', title: '⭕ 头像框', equipCat: 'frame' },
      { key: 'skins', title: '🎨 皮肤', equipCat: 'skin' },
      { key: 'backgrounds', title: '🖼 背景', equipCat: 'background' },
      { key: 'titles', title: '🏷 称号', equipCat: 'title' },
    ];

    const sections = [];
    if (items.length) sections.push({ title: '🧩 道具', list: items.map((i) => renderItemCard(i, false)) });
    if (packs.length) sections.push({ title: '🎁 礼包', list: packs.map((p) => renderItemCard(p, true)) });
    cosmeticCats.forEach((cat) => {
      const owned = cosmetics?.owned?.[cat.key] || [];
      if (owned.length) sections.push({ title: cat.title, list: owned.map((id) => renderCosmeticCard(id, cat)) });
    });

    if (sections.length === 0) {
      inventoryEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '背包是空的'));
      return;
    }

    sections.forEach((sec) => {
      inventoryEl.append(el('div', { class: 'shop-inv-section' }, [
        el('div', { class: 'shop-inv-title' }, sec.title),
        el('div', { class: 'shop-grid' }, sec.list),
      ]));
    });
  }

  // ---- 会员特权横向对比表（对齐 v1 商城） ----
  function renderVipCompare() {
    const vips = shopData?.vip || {};
    const nameShortMap = { vip_week: '周卡', vip_month: '月卡', vip_season: '季卡', vip_year: '年卡' };
    const vipOrder = ['vip_week', 'vip_month', 'vip_season', 'vip_year'];
    const tiers = [{ id: null, name: '无会员', icon: '🚫' }];
    vipOrder.forEach((id) => {
      if (vips[id]) tiers.push({ id, name: nameShortMap[id] || vips[id].name, vip: vips[id] });
    });

    const labelCell = (text) => el('div', { class: 'vip-compare-cell cell-label' }, text);
    const cell = (content) => el('div', { class: 'vip-compare-cell' }, content);

    // 表头：特权 + 各档会员
    const headerRow = el('div', { class: 'vip-compare-row header' }, [
      labelCell('特权'),
      ...tiers.map((t) => {
        if (!t.vip) return cell(el('strong', { style: 'color:#6c757d;' }, t.name));
        return cell(el('strong', { style: `color:${RARITY_COLORS[t.vip.rarity] || '#007bff'};` }, `${t.vip.icon || '⭐'} ${t.name}`));
      }),
    ]);

    const rowDefs = [
      { label: '💎 价格', values: tiers.map((t) => (t.vip ? `${t.vip.price} 💎` : '免费')) },
      { label: '⏳ 有效期', values: tiers.map((t) => (t.vip ? `${t.vip.days} 天` : '-')) },
      { label: '⚡ 经验加成', values: tiers.map((t) => `×${t.vip?.expBonus || 1}`) },
      { label: '🛒 购物折扣', values: tiers.map((t) => (t.vip?.discountPercent ? `${(100 - t.vip.discountPercent).toFixed(0)} 折` : '原价')) },
      { label: '📬 每日邮件礼包', values: tiers.map((t) => (t.vip ? '✅ 发送' : '❌')) },
      { label: '💎 每日星钻', values: tiers.map((t) => (t.vip?.dailyReward?.starCoins ? `+${t.vip.dailyReward.starCoins}` : '-')) },
      { label: '📈 每日经验', values: tiers.map((t) => (t.vip?.dailyReward?.exp ? `+${t.vip.dailyReward.exp}` : '-')) },
      {
        label: '🎁 每日物品',
        values: tiers.map((t) => {
          const items = t.vip?.dailyReward?.items || [];
          if (items.length === 0) return '-';
          return items.map((it) => {
            const info = shopData?.items?.[it.id];
            return `${info?.icon || '📦'}×${it.count}`;
          }).join(' ');
        }),
      },
      { label: '🎨 专属头像框', values: tiers.map((t) => (t.vip?.id === 'vip_year' ? '🏆 传说' : t.vip ? '🔒 敬请期待' : '❌')) },
      { label: '👑 专属称号', values: tiers.map((t) => (t.id === 'vip_season' || t.id === 'vip_year' ? '🔒 敬请期待' : '❌')) },
      { label: '🛍️ 限定商店', values: tiers.map((t) => (t.id === 'vip_year' ? '✅ 解锁' : t.id === 'vip_season' ? '🔒 敬请期待' : '❌')) },
      { label: '🏅 排行榜高亮', values: tiers.map((t) => (t.id === 'vip_year' ? '🏆 金色' : '❌')) },
    ];

    const rows = rowDefs.map((rd) => el('div', { class: 'vip-compare-row' }, [
      labelCell(rd.label),
      ...rd.values.map((v) => cell(v)),
    ]));

    return el('div', {}, [
      el('div', { class: 'vip-compare-title' }, '📊 会员特权横向对比'),
      el('div', { class: 'vip-compare-table' }, [headerRow, ...rows]),
    ]);
  }

  // ---- 购买 ----
  function buyItem(item) {
    const userId = currentUserId();
    if (!userId) { toast.warn('请先登录'); return; }
    if (!store.get('socketConnected')) { toast.error('未连接服务器'); return; }

    // 外观/礼包/会员只买 1 个；道具可多买
    const cat = CATEGORIES.find((c) => c.key === activeCat);
    const isMulti = !cat.cosmetic && item.category === 'item';
    if (isMulti) {
      // modal.show 的 content 支持 DOM 节点，数量输入框直接嵌入弹窗内容
      const qtyInput = el('input', {
        type: 'number',
        class: 'shop-qty-input',
        value: 1,
        min: 1,
        max: 99,
      });
      const contentEl = el('div', { class: 'shop-buy-modal' }, [
        el('div', {}, `${item.icon} ${item.description || ''}`),
        el('div', { class: 'shop-qty-row' }, [
          el('label', {}, '数量'),
          qtyInput,
        ]),
        el('div', { class: 'text-muted', style: 'font-size:12px;' },
          `💎 单价 ${item.price ?? 0}（余额 ${balance}💎）`),
      ]);
      modal.show({
        title: `购买 ${item.name}`,
        content: contentEl,
        confirmText: '确认购买',
        showCancel: true,
        onConfirm: () => {
          const qty = Math.max(1, Math.min(99, Math.round(Number(qtyInput.value)) || 1));
          doBuy(item, qty);
        },
      });
      return;
    }
    modal.show({
      title: `购买 ${item.name}`,
      content: `${item.icon} ${item.description || ''}\n\n💎 价格：${item.price ?? 0} 星钻（余额 ${balance}💎）`,
      confirmText: '确认购买',
      showCancel: true,
      onConfirm: () => doBuy(item, 1),
    });
  }

  async function doBuy(item, quantity) {
    const userId = currentUserId();
    try {
      const res = await api.shop.buy(userId, item.id, quantity);
      if (!res.success) { toast.error(res.message || '购买失败'); return; }
      toast.success(res.message || '购买成功！');
      // 刷新余额与背包
      const [balRes, invRes] = await Promise.all([
        api.shop.getBalance(userId),
        api.shop.getInventory(userId),
      ]);
      balance = balRes.balance ?? balance;
      inventory = invRes.inventory?.items || inventory;
      renderHeader();
      renderGrid();
      renderInventory();
    } catch (err) {
      toast.error(err.message || '购买失败');
    }
  }

  // ---- 使用道具 / 开启礼包 ----
  async function useItem(item) {
    const userId = currentUserId();
    try {
      const res = await api.shop.useItem(userId, item.id);
      if (!res.success) { toast.error(res.message || '使用失败'); return; }
      toast.success(res.message || '使用成功！');
      // 服务端返回最新背包与星钻
      inventory = res.account?.inventory?.items || inventory;
      if (res.account?.starCoins != null) balance = res.account.starCoins;
      renderHeader();
      renderGrid();
      renderInventory();
    } catch (err) {
      toast.error(err.message || '使用失败');
    }
  }

  // ---- 装备外观 ----
  async function equipItem(category, cosmeticId) {
    const userId = currentUserId();
    try {
      const res = await api.shop.equipCosmetic(userId, category, cosmeticId);
      if (!res.success) { toast.error(res.message || '装备失败'); return; }
      toast.success(res.message || '装备成功！');
      // 刷新用户外观
      const cosRes = await api.shop.getCosmetics(userId);
      cosmetics = cosRes.cosmetics || cosmetics;
      renderGrid();
      renderInventory();
    } catch (err) {
      toast.error(err.message || '装备失败');
    }
  }

  // ---- 组装视图 ----
  container.innerHTML = '';
  container.append(el('div', { class: 'shop-container panel' }, [
    el('h2', { class: 'panel-title' }, '🛒 商城'),
    el('div', { class: 'shop-header' }, [balanceEl, vipEl]),
    viewTabsEl,
    tabsEl,
    gridEl,
    vipCompareEl,
    inventoryEl,
  ]));
  gridEl.append(loadingEl);
  loadAll();

  return () => {
    container.innerHTML = '';
  };
}
