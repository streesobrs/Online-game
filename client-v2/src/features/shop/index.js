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

/** 商城商品分类（对应 /api/shop/data 返回的键） */
const CATEGORIES = [
  { key: 'items', label: '🧩 道具', cosmetic: false },
  { key: 'avatars', label: '😀 头像', cosmetic: true, equipCat: 'avatar' },
  { key: 'frames', label: '⭕ 头像框', cosmetic: true, equipCat: 'frame' },
  { key: 'skins', label: '🎨 皮肤', cosmetic: true, equipCat: 'skin' },
  { key: 'backgrounds', label: '🖼 背景', cosmetic: true, equipCat: 'background' },
  { key: 'titles', label: '🏷 称号', cosmetic: true, equipCat: 'title' },
  { key: 'packs', label: '🎁 礼包', cosmetic: false },
  { key: 'vip', label: '👑 VIP', cosmetic: false },
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
  let activeCat = CATEGORIES[0].key;
  let shopData = null;      // /api/shop/data 返回的 data
  let inventory = {};       // {itemId: count}
  let balance = 0;          // 星钻余额
  let vipInfo = null;       // {isActive, remainingDays, ...}
  let cosmetics = null;     // {owned, equipped}
  let cosmeticConfig = null; // cosmetics.json 配置

  const balanceEl = el('span', { class: 'shop-balance' }, '💎 --');
  const vipEl = el('span', { class: 'shop-vip-badge' }, '');
  const gridEl = el('div', { class: 'shop-grid' });
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
    renderTabs();
    renderGrid();
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
    const items = Object.values((shopData && shopData[activeCat]) || {});
    if (!items || items.length === 0) {
      gridEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '该分类暂无商品'));
      return;
    }
    items.forEach((item) => gridEl.append(itemCard(item)));
  }

  // ---- 单个商品卡片 ----
  function itemCard(item) {
    const cat = CATEGORIES.find((c) => c.key === activeCat);
    const isItem = !cat.cosmetic && item.category !== 'pack' && item.category !== 'vip';
    const ownedCount = inventory[item.id] || 0;

    const priceEl = el('span', { class: 'shop-price' }, `💎 ${item.price ?? 0}`);
    const rarity = item.rarity || 'common';

    // 购买按钮
    const buyBtn = el('button', {
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
      el('div', { class: 'shop-card-icon' }, item.icon || '🎁'),
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
    } catch (err) {
      toast.error(err.message || '购买失败');
    }
  }

  // ---- 使用道具 ----
  async function useItem(item) {
    const userId = currentUserId();
    try {
      const res = await api.shop.useItem(userId, item.id);
      if (!res.success) { toast.error(res.message || '使用失败'); return; }
      toast.success(res.message || '使用成功！');
      // 服务端返回最新背包与星钻
      inventory = res.account?.inventory || inventory;
      if (res.account?.starCoins != null) balance = res.account.starCoins;
      renderHeader();
      renderGrid();
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
    } catch (err) {
      toast.error(err.message || '装备失败');
    }
  }

  // ---- 组装视图 ----
  container.innerHTML = '';
  container.append(el('div', { class: 'shop-container panel', style: 'max-width:880px;width:100%;' }, [
    el('h2', { class: 'panel-title' }, '🛒 商城'),
    el('div', { class: 'shop-header' }, [balanceEl, vipEl]),
    tabsEl,
    gridEl,
  ]));
  gridEl.append(loadingEl);
  loadAll();

  return () => {
    container.innerHTML = '';
  };
}
