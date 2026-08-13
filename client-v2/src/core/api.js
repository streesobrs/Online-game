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
    getData: () => api.get('/api/shop/data'),
    getInventory: () => api.get('/api/shop/inventory'),
    buy: (itemId, quantity) => api.post('/api/shop/buy', { itemId, quantity }),
    useItem: (itemId) => api.post('/api/shop/use-item', { itemId }),
  },

  leaderboard: {
    /** 排行榜 @param {number} [limit=10] */
    get: (limit = 10) => api.get(`/api/leaderboard?limit=${limit}`),
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
    history: () => api.get('/api/games/history'),
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
