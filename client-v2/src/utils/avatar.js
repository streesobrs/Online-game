/**
 * 头像工具（功能补齐：账号栏/在线玩家/聊天头像/资料卡共用）
 * 头像数据来自 GET /api/users/:accountId/cosmetics → { cosmetics: { equipped } }（公开，仅已装备）
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

/** 头像框颜色（纯色框取色值；渐变框返回渐变本身） */
export function frameColor(cosmetics, cosmeticConfig) {
  const frameId = cosmetics?.equipped?.frame;
  return cosmeticConfig?.frames?.[frameId]?.color || '#e2e8f0';
}

/**
 * 头像框背景
 * 纯色框用 conic-gradient 做成环状（外圈有色、内圈收白）；
 * 渐变框（配置里是 linear-gradient(...)）不能塞进 conic-gradient，
 * 否则整条 background 声明失效 → 头像框完全不显示，这里直接铺渐变。
 */
export function frameBackground(cosmetics, cosmeticConfig) {
  const color = frameColor(cosmetics, cosmeticConfig);
  if (/gradient\(/i.test(color)) return color;
  return `conic-gradient(from 0deg, ${color}, #fff, ${color})`;
}

/**
 * 头像框环宽：跟随头像尺寸缩放
 * 固定的 3px 在大头像上只占 3%，会被头像图片淹没；按 10% 取，最大 12px
 */
export function frameRingSize(size) {
  return Math.min(12, Math.max(2, Math.round(size * 0.1)));
}

/** 渲染带头像框的头像节点（需已获取 cosmetics 数据） */
export function avatarEl(cosmetics, cosmeticConfig, size = 36) {
  const av = avatarInfo(cosmetics, cosmeticConfig);
  // 用 border-box + 内边距做环：外径固定为 size，图片缩进，框就不会被图片盖住
  const ring = frameRingSize(size);
  const inner = size - ring * 2;
  // 内圈必须是不透明的圆底：透明 PNG / emoji 会把渐变透出来，
  // 整块看起来就成了「渐变背景图」而不是头像框
  const plate = 'border-radius:50%;overflow:hidden;background:var(--surface, #fff);';
  const innerEl = av.type === 'img'
    ? el('img', {
        class: 'v2-avatar-img',
        src: av.src,
        alt: '',
        style: `width:${inner}px;height:${inner}px;${plate}`,
      })
    : el('span', {
        class: 'v2-avatar-emoji',
        style: `width:${inner}px;height:${inner}px;${plate}display:inline-flex;align-items:center;justify-content:center;font-size:${Math.round(inner * 0.55)}px;`,
      }, av.text);
  return el('span', {
    class: 'v2-avatar',
    style: `width:${size}px;height:${size}px;box-sizing:border-box;padding:${ring}px;background:${frameBackground(cosmetics, cosmeticConfig)};`,
  }, innerEl);
}

// 模块级缓存：userId -> { cosmetics, cosmeticConfig }（会话内不变）
const cache = new Map();
const loading = new Map(); // userId -> Promise

/** 拉取用户外观（带缓存，失败返回空数据） */
export function fetchAvatarData(userId) {
  if (!userId) return Promise.resolve(null);
  if (cache.has(userId)) return Promise.resolve(cache.get(userId));
  if (loading.has(userId)) return loading.get(userId);
  const p = Promise.all([
    // 头像展示只需要已装备数据，走公开接口，避免对他人使用 requireSelf 接口触发 403
    api.users.getCosmetics(userId).catch(() => null),
    api.shop.getCosmeticsConfig().catch(() => null),
  ])
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
