/**
 * 全站外观（皮肤 / 背景）
 * 与主题同级：装备后作用于 body，覆盖导航、页面、面板、聊天等所有区域。
 * 数据来源仍是 /api/shop/cosmetics 与 /api/shop/cosmetics/config。
 */
import { api } from './api.js';
import { store } from './store.js';
import { applyGlobalAppearance, clearGlobalAppearance } from '../utils/cosmetics.js';

let requestSeq = 0;

/** 拉取当前账号外观并应用到全站 */
export async function refreshUserAppearance() {
  const userId = localStorage.getItem('currentAccountId');
  if (!userId) {
    clearGlobalAppearance();
    return;
  }
  const seq = ++requestSeq;
  try {
    const [cosRes, cfgRes] = await Promise.all([
      api.shop.getCosmetics(userId),
      api.shop.getCosmeticsConfig(),
    ]);
    if (seq !== requestSeq) return;
    applyGlobalAppearance(cosRes?.cosmetics, cfgRes?.cosmetics);
  } catch (err) {
    if (seq === requestSeq) console.warn('[Appearance] 加载外观失败', err?.message || err);
  }
}

/** 初始化：登录后自动应用，退出后清除 */
export function initAppearance() {
  store.subscribe('user', (user) => {
    if (user) refreshUserAppearance();
    else clearGlobalAppearance();
  });
}
