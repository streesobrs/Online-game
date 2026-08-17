/**
 * HTTP API 封装
 * 同源相对路径请求，自动注入 Authorization: Bearer {token}。
 * 参考开发文档第九章 + 附录 B（v1 HTTP API 清单）。
 * 注意：v1 登录/注册走 Socket 事件（account_login / guest_login / account_register），
 * HTTP 侧仅有 /api/auth/verify 用于校验 token。
 */
import { store } from './store.js';
import { toast } from '../components/toast.js';

const BASE_URL = ''; // 同源相对路径（部署在 /beta/ 或 /preview/ 下均指向当前源）

/**
 * 基础请求
 * @param {string} path - 接口路径（如 '/api/shop/data'）
 * @param {Object} [options] - fetch 选项
 * @returns {Promise<any>} 响应 JSON
 * @throws {Error} 网络错误 / HTTP 非 2xx（message 取自服务端返回）
 */
async function request(path, options = {}) {
  const token = store.get('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, { ...options, headers });
  } catch (err) {
    toast.error(`网络请求失败: ${path}`);
    throw err;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.message || body?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }

  return res.json();
}

/** 全局 API 对象 */
export const api = {
  get: (path) => request(path, { method: 'GET' }),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),

  // ===== 业务接口封装（按附录 B，后续任务按需补全）=====

  auth: {
    /** 校验 token 是否有效 */
    verify: (token) => api.post('/api/auth/verify', { token }),
  },

  shop: {
    /** 商城数据（商品列表，可传 userId 获取动态价格） */
    getData: (userId) => api.get(`/api/shop/data?userId=${encodeURIComponent(userId || '')}`),
    /** 背包 */
    getInventory: (userId) => api.get(`/api/shop/inventory?userId=${encodeURIComponent(userId || '')}`),
    /** 购买商品 @param {string} itemId @param {number} [quantity=1] */
    buy: (userId, itemId, quantity = 1) => api.post('/api/shop/buy', { userId, itemId, quantity }),
    /** 使用道具 */
    useItem: (userId, itemId) => api.post('/api/shop/use-item', { userId, itemId }),
    /** 星钻余额 */
    getBalance: (userId) => api.get(`/api/currency/balance?userId=${encodeURIComponent(userId || '')}`),
    /** 会员信息 */
    getVip: (userId) => api.get(`/api/shop/vip?userId=${encodeURIComponent(userId || '')}`),
    /** 用户外观（已拥有 + 已装备） */
    getCosmetics: (userId) => api.get(`/api/shop/cosmetics?userId=${encodeURIComponent(userId || '')}`),
    /** 全部外观配置 */
    getCosmeticsConfig: () => api.get('/api/shop/cosmetics/config'),
    /** 装备外观 */
    equipCosmetic: (userId, category, cosmeticId) => api.post('/api/shop/cosmetics/equip', { userId, category, cosmeticId }),
  },

  leaderboard: {
    /** 排行榜 @param {number} [limit=10] */
    get: (limit = 10) => api.get(`/api/leaderboard?limit=${limit}`),
  },

  profile: {
    /** 个人资料 @param {string} accountId */
    get: (accountId) => api.get(`/api/profile/${encodeURIComponent(accountId)}`),
    /** 等级经验配置（levelExp.json：{level: 升到下一级所需经验}） */
    levelExp: () => api.get('/api/config/levelExp'),
  },

  mails: {
    /** 邮件列表 @param {string} accountId */
    get: (accountId) => api.get(`/api/mails/${encodeURIComponent(accountId)}`),
    /** 领取单封邮件 */
    claim: (accountId, mailId) => api.post(`/api/mails/${encodeURIComponent(accountId)}/claim/${encodeURIComponent(mailId)}`),
    /** 一键领取所有邮件 */
    claimAll: (accountId) => api.post(`/api/mails/${encodeURIComponent(accountId)}/claim-all`),
    /** 标记单封邮件为已读 */
    read: (accountId, mailId) => api.post(`/api/mails/${encodeURIComponent(accountId)}/read/${encodeURIComponent(mailId)}`),
    /** 标记全部已读 */
    readAll: (accountId) => api.post(`/api/mails/${encodeURIComponent(accountId)}/read-all`),
    /** 删除单封邮件 */
    remove: (accountId, mailId) => api.delete(`/api/mails/${encodeURIComponent(accountId)}/${encodeURIComponent(mailId)}`),
  },

  currency: {
    /** 星钻交易记录 @param {string} accountId @param {number} [limit=30] */
    transactions: (accountId, limit = 30) => api.get(`/api/currency/${encodeURIComponent(accountId)}/transactions?limit=${limit}`),
    /** 经验记录 @param {string} accountId @param {number} [limit=30] */
    expTransactions: (accountId, limit = 30) => api.get(`/api/currency/${encodeURIComponent(accountId)}/exp-transactions?limit=${limit}`),
  },

  levelRewards: {
    /** 可领取的等级奖励列表 @param {string} accountId */
    get: (accountId) => api.get(`/api/level-rewards/${encodeURIComponent(accountId)}`),
    /** 领取所有可领取的等级奖励 */
    claim: (accountId) => api.post(`/api/level-rewards/${encodeURIComponent(accountId)}/claim`),
  },

  avatar: {
    /** 上传自定义头像 @param {string} avatar - base64 dataURL @param {number} [replaceIndex] @param {string} [name] */
    upload: (userId, avatar, replaceIndex, name) => api.post('/api/avatar/upload', { userId, avatar, replaceIndex, name }),
    /** 删除自定义头像 */
    remove: (userId, avatarFile) => api.post('/api/avatar/delete', { userId, avatarFile }),
    /** 重命名自定义头像 */
    rename: (userId, avatarFile, name) => api.post('/api/avatar/rename', { userId, avatarFile, name }),
  },

  themes: {
    list: () => api.get('/api/themes'),
    get: (id) => api.get(`/api/themes/${id}`),
  },

  users: {
    online: () => api.get('/api/users/online'),
    search: (query) => api.get(`/api/users/search?q=${encodeURIComponent(query)}`),
  },

  chat: {
    history: () => api.get('/api/chat/history'),
  },

  games: {
    /** 对战历史 @param {string} accountId @param {number} [limit=20] */
    history: (accountId, limit = 20) => api.get(`/api/games/history?accountId=${encodeURIComponent(accountId || '')}&limit=${limit}`),
    stats: () => api.get('/api/games/stats'),
  },

  spectate: {
    list: () => api.get('/api/spectate/games'),
  },

  feedback: {
    list: () => api.get('/api/feedbacks'),
    submit: (data) => api.post('/api/feedbacks', data),
  },
};
