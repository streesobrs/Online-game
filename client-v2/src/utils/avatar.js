/**
 * 头像工具（功能补齐：账号栏/在线玩家/聊天头像/资料卡共用）
 * 头像数据来自 GET /api/shop/cosmetics?userId= → { cosmetics: { owned, equipped } }
 * 展示逻辑复用 v2 profile 页（4.7）：equipped.avatarCustom → 图片，equipped.avatar → 配置表情，否则 👤
 */
import { el } from './dom.js';
import { api } from '../core/api.js';

/** 头像信息：{type:'img'|'emoji', src?, text?} */
export function avatarInfo(cosmetics, cosmeticConfig) {
  const equipped = cosmetics?.equipped || {};
  if (equipped.avatarCustom) return { type: 'img', src: `/data/cosmetics/avatars/${equipped.avatarCustom}` };
  const cfg = cosmeticConfig?.avatars?.[equipped.avatar];
  if (cfg) return { type: 'emoji', text: cfg.emoji || cfg.icon || '👤' };
  return { type: 'emoji', text: '👤' };
}

/** 头像框颜色 */
export function frameColor(cosmetics, cosmeticConfig) {
  const frameId = cosmetics?.equipped?.frame;
  return cosmeticConfig?.frames?.[frameId]?.color || '#e2e8f0';
}

/** 渲染带头像框的头像节点（需已获取 cosmetics 数据） */
export function avatarEl(cosmetics, cosmeticConfig, size = 36) {
  const av = avatarInfo(cosmetics, cosmeticConfig);
  const inner = av.type === 'img'
    ? el('img', {
        class: 'v2-avatar-img',
        src: av.src,
        alt: '',
        style: `width:${size - 6}px;height:${size - 6}px;`,
      })
    : el('span', { class: 'v2-avatar-emoji', style: `font-size:${Math.round(size * 0.5)}px;` }, av.text);
  return el('span', {
    class: 'v2-avatar',
    style: `width:${size}px;height:${size}px;background:conic-gradient(from 0deg, ${frameColor(cosmetics, cosmeticConfig)}, #fff, ${frameColor(cosmetics, cosmeticConfig)});`,
  }, inner);
}

// 模块级缓存：userId -> { cosmetics, cosmeticConfig }（会话内不变）
const cache = new Map();
const loading = new Map(); // userId -> Promise

/** 拉取用户外观（带缓存，失败返回空数据） */
export function fetchAvatarData(userId) {
  if (!userId) return Promise.resolve(null);
  if (cache.has(userId)) return Promise.resolve(cache.get(userId));
  if (loading.has(userId)) return loading.get(userId);
  const p = Promise.all([api.shop.getCosmetics(userId), api.shop.getCosmeticsConfig()])
    .then(([cosRes, cfgRes]) => {
      const data = { cosmetics: cosRes?.cosmetics || null, cosmeticConfig: cfgRes?.cosmetics || null };
      cache.set(userId, data);
      loading.delete(userId);
      return data;
    })
    .catch(() => {
      loading.delete(userId);
      return { cosmetics: null, cosmeticConfig: null };
    });
  loading.set(userId, p);
  return p;
}

/** 渲染头像节点：先占位，异步拉取数据后替换为真实头像 */
export function avatarNode(userId, size = 36) {
  const holder = el('span', {
    class: 'v2-avatar v2-avatar--placeholder',
    style: `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.5)}px;`,
  }, '👤');
  if (!userId) return holder;
  fetchAvatarData(userId).then((data) => {
    holder.replaceWith(avatarEl(data?.cosmetics, data?.cosmeticConfig, size));
  });
  return holder;
}
