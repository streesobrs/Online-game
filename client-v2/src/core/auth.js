/**
 * 登录态管理
 * 与 v1 共享 localStorage key（userToken / currentAccountId / nickname / loginStatus），
 * 同一浏览器 v1/v2 切换无需重新登录。
 *
 * 登录走 socket 事件（v1 协议）：
 * - 账号登录：account_login → login_result
 * - 游客登录：guest_login → login_result
 * - 按 token 恢复：get_account_by_token → account_info
 */
import { store } from './store.js';
import { eventBus } from './eventBus.js';
import { emit } from './socket.js';
import { toast } from '../components/toast.js';

// 与 v1 完全一致的 localStorage key
export const TOKEN_KEY = 'userToken';
export const ACCOUNT_ID_KEY = 'currentAccountId';
export const NICKNAME_KEY = 'nickname';
export const LOGIN_STATUS_KEY = 'loginStatus';

/** 读取本地 token */
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/** 保存 token（localStorage + store） */
export function saveToken(token) {
  if (!token) return;
  localStorage.setItem(TOKEN_KEY, token);
  store.set('token', token);
}

/** 清除全部登录态（localStorage + store），与 v1 clearAccount 一致 */
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ACCOUNT_ID_KEY);
  localStorage.removeItem(NICKNAME_KEY);
  localStorage.removeItem(LOGIN_STATUS_KEY);
  store.set('token', null);
  store.set('user', null);
}

/**
 * 规范化账号数据结构（兼容 v1 登录/刷新两种结构）
 * @param {Object} data
 * @returns {Object}
 */
function normalizeAccount(data) {
  if (!data) return null;
  if (data.account) {
    return { ...data, account: data.account, stats: data.account.stats || {} };
  }
  return { ...data, account: data, stats: data.stats || {} };
}

/**
 * 处理登录成功（login_result 通用逻辑）
 * @param {Object} data - login_result 数据 { success, message, data: resultData }
 * @returns {boolean} 是否登录成功
 */
function handleLoginSuccess(data) {
  if (!data || !data.success) return false;
  const resultData = data.data;
  if (!resultData || !resultData.token) return false;

  const account = normalizeAccount(resultData);
  store.set('user', account);
  store.set('token', resultData.token);
  localStorage.setItem(TOKEN_KEY, resultData.token);

  // 提取账号 ID 与昵称（兼容两种结构）
  const inner = resultData.account?.account || resultData.account;
  if (inner?.id) localStorage.setItem(ACCOUNT_ID_KEY, inner.id);
  if (inner?.nickname) {
    localStorage.setItem(NICKNAME_KEY, inner.nickname);
    emit('user_login', { nickname: inner.nickname });
  }
  return true;
}

/**
 * 初始化登录态：
 * 1. 恢复 localStorage 中的 token 到 store
 * 2. 订阅登录相关事件（login_result / account_info / socket:connect）
 * @returns {{ loggedIn: boolean, token: string|null }}
 */
export function initAuth() {
  const token = getToken();
  if (token) store.set('token', token);

  // 监听登录结果（账号登录 / 游客登录 / 自动登录统一走这里）
  eventBus.on('user:loginResult', (data) => {
    if (handleLoginSuccess(data)) {
      toast.success('登录成功');
    } else if (data?.message) {
      toast.error(data.message);
      localStorage.removeItem(TOKEN_KEY);
    }
  });

  // 监听按 token 获取的账号信息
  eventBus.on('user:accountInfo', (data) => {
    if (data?.success && data.data) {
      if (data.data.token) saveToken(data.data.token);
      store.set('user', normalizeAccount(data.data));
    }
  });

  // 注册/重置密码结果（服务端统一回 account_action_result；注册成功不自动登录，需补一步）
  eventBus.on('user:accountActionResult', (data) => {
    if (!data) return;
    if (data.action === 'register') {
      if (data.success && pendingRegister) {
        // 注册成功 → 自动登录（对齐 v1：重发 account_login）
        emit('account_login', {
          username: pendingRegister.username,
          password: pendingRegister.password,
        });
      } else if (!data.success && data.message) {
        toast.error(data.message || '注册失败');
      }
      pendingRegister = null;
    } else if (data.action === 'reset_password') {
      if (data.success) toast.success(data.message || '密码已重置，请使用新密码登录');
      else toast.error(data.message || '密码重置失败');
    } else if (data.action === 'change_password') {
      if (data.success) toast.success(data.message || '✅ 密码修改成功！');
      else toast.error(data.message || '❌ 密码修改失败');
    } else if (data.action === 'set_password') {
      if (data.success) toast.success(data.message || '✅ 密码设置成功！');
      else toast.error(data.message || '❌ 密码设置失败');
    } else if (data.action === 'update_profile') {
      if (data.success) {
        // 更新资料成功后：同步本地存储与 store.user（保持 user 结构不变，只改昵称/资料字段）
        const newNick = data.account?.account?.nickname || data.account?.nickname;
        if (newNick) localStorage.setItem(NICKNAME_KEY, newNick);
        const newProfile = data.account?.account?.profile;
        const current = store.get('user');
        if (current) {
          const inner = current.account?.account || current.account;
          if (inner) {
            if (newNick) inner.nickname = newNick;
            if (newProfile) inner.profile = newProfile;
          }
          store.set('user', { ...current });
        }
        eventBus.emit('user:profileUpdated', { nickname: newNick, profile: newProfile });
        toast.success(data.message || '资料已更新');
      } else {
        toast.error(data.message || '资料更新失败');
      }
    }
  });

  // 注意：登录态恢复已由 socket.js 的 client_connect 统一处理（对齐 v1），
  // 服务端会回发 login_result / 自动登录，不再单独调用 get_account_by_token。

  return { loggedIn: !!token, token: token || null };
}

// 待自动登录的注册凭据（服务端注册成功仅回 account_action_result，需客户端补发 account_login）
let pendingRegister = null;

/** 账号密码登录 */
export function login(username, password) {
  emit('account_login', { username, password });
}

/** 游客登录 */
export function guestLogin() {
  emit('guest_login');
}

/**
 * 注册账号
 * @param {string} username
 * @param {string} password
 * @param {string} [nickname]
 */
export function register(username, password, nickname = null) {
  pendingRegister = { username, password };
  emit('account_register', { username, password, nickname });
}

/**
 * 重置密码（account_reset_password → account_action_result action='reset_password'）
 * @param {string} username
 * @param {string} newPassword
 */
export function resetPassword(username, newPassword) {
  emit('account_reset_password', { username, password: newPassword });
}

/**
 * 修改密码（已设置密码的账号，需旧密码校验 → account_action_result action='change_password'）
 * @param {string} oldPassword
 * @param {string} newPassword
 */
export function changePassword(oldPassword, newPassword) {
  emit('account_change_password', { oldPassword, newPassword });
}

/**
 * 设置密码（未设置密码的账号，如游客升级 → account_action_result action='set_password'）
 * @param {string} password
 */
export function setPassword(password) {
  emit('account_set_password', { password });
}

/** 按 token 获取账号信息（自动登录） */
export function fetchAccountByToken() {
  const token = getToken();
  if (!token) return;
  emit('get_account_by_token', { token });
}

/** 设置/修改昵称（account_update_profile → account_action_result action='update_profile'） */
export function updateNickname(nickname) {
  emit('account_update_profile', { nickname });
}

/**
 * 更新个人资料（如个性签名）
 * 注意：服务端会整体覆盖 profile 对象，必须携带完整 profile（含 avatar/exp/level），避免丢失
 * @param {Object} profile - 完整 profile 对象
 */
export function updateProfile(profile) {
  emit('account_update_profile', { profile });
}

/** 退出登录 */
export function logout() {
  clearAuth();
  toast.info('已退出登录');
  if (window.location.hash !== '#/login') {
    window.location.hash = '#/login';
  }
}
