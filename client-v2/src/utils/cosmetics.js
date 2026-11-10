/**
 * 外观展示工具（称号 / 背景 / 皮肤）
 * 数据来源：
 * - cosmetics.equipped：GET /api/shop/cosmetics（本人）或 /api/profile/:id 的 cosmetics.equipped（他人）
 * - cosmeticConfig：GET /api/shop/cosmetics/config → cosmetics.json
 */
import { el } from './dom.js';

const CATEGORY_BUCKET = {
  skin: 'skins',
  background: 'backgrounds',
  title: 'titles',
};

/** 皮肤允许覆盖的 CSS 变量（与 cosmetics.json 的 skin 字段保持一致） */
const SKIN_VARS = [
  '--theme-bg',
  '--theme-primary',
  '--theme-btn-primary-bg',
  '--theme-btn-primary-bg-hover',
  '--theme-panel-bg',
  '--theme-container-bg',
  '--surface-alt',
  '--border-color',
  '--theme-border-color',
  '--text',
  '--text-muted',
  '--accent-indigo',
  '--theme-title-color',
  '--theme-nav-bg',
  '--theme-nav-btn-bg',
  '--theme-nav-btn-bg-hover',
  '--theme-nav-btn-color',
  '--theme-nav-btn-active-bg',
  '--theme-nav-btn-active-hover-bg',
];

/** 取已装备的某个外观配置（skin / background / title） */
export function equippedCosmetic(cosmetics, cosmeticConfig, category) {
  const id = cosmetics?.equipped?.[category];
  const bucket = CATEGORY_BUCKET[category];
  if (!id || !bucket) return null;
  return cosmeticConfig?.[bucket]?.[id] || null;
}

/** 称号徽章节点（未装备或配置缺失时返回 null） */
export function titleBadge(cosmetics, cosmeticConfig) {
  const title = equippedCosmetic(cosmetics, cosmeticConfig, 'title');
  if (!title?.titleText) return null;
  const color = title.titleColor || '#718096';
  return el('span', {
    class: 'cosmetic-title-badge',
    style: `color:${color};border-color:${color};`,
  }, title.titleText);
}

/**
 * 把已装备的背景与皮肤应用到容器。
 * 皮肤只接受白名单内的 CSS 变量键，避免配置写坏页面。
 */
export function applyCosmetics(rootEl, cosmetics, cosmeticConfig) {
  if (!rootEl) return;
  // 先清掉上一次装备留下的样式，避免取消装备后仍然生效
  rootEl.style.background = '';
  rootEl.style.color = '';
  SKIN_VARS.forEach((key) => rootEl.style.removeProperty(key));

  const bg = equippedCosmetic(cosmetics, cosmeticConfig, 'background');
  if (bg?.background) {
    rootEl.style.background = bg.background;
    if (bg.textColor) rootEl.style.color = bg.textColor;
  }
  const skin = equippedCosmetic(cosmetics, cosmeticConfig, 'skin');
  if (skin?.skin && typeof skin.skin === 'object') {
    Object.entries(skin.skin).forEach(([key, value]) => {
      if (SKIN_VARS.includes(key) && typeof value === 'string') {
        rootEl.style.setProperty(key, value);
      }
    });
  }
}

/**
 * 全站应用已装备的皮肤 / 背景（与主题同级别，覆盖导航、页面、面板、聊天等）。
 * 清空时只移除本工具写入的内联样式，不影响主题 CSS。
 */
export function applyGlobalAppearance(cosmetics, cosmeticConfig) {
  const body = document.body;
  if (!body) return;

  body.style.background = '';
  body.style.backgroundAttachment = '';
  body.style.color = '';
  SKIN_VARS.forEach((key) => body.style.removeProperty(key));

  const bg = equippedCosmetic(cosmetics, cosmeticConfig, 'background');
  if (bg?.background) {
    body.style.background = bg.background;
    body.style.backgroundAttachment = 'fixed';
    body.style.backgroundSize = 'cover';
    if (bg.textColor) body.style.color = bg.textColor;
  }

  const skin = equippedCosmetic(cosmetics, cosmeticConfig, 'skin');
  if (skin?.skin && typeof skin.skin === 'object') {
    Object.entries(skin.skin).forEach(([key, value]) => {
      if (SKIN_VARS.includes(key) && typeof value === 'string') {
        body.style.setProperty(key, value);
      }
    });
  }
}

/** 清除全站皮肤 / 背景（退出登录时调用） */
export function clearGlobalAppearance() {
  applyGlobalAppearance(null, null);
}
