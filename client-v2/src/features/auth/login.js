/**
 * 登录入口（v2）
 * 负责「需要登录」场景的跳转：统一跳转到引导式登录页（#/login）。
 * 登录页本体见 login-page.js（引导流程：欢迎/选择/表单/游客昵称/成功）。
 * 登录协议走 core/auth.js（account_login / guest_login → login_result）。
 */
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import * as auth from '../../core/auth.js';

/** 当前是否已登录 */
export function isLoggedIn() {
  return !!store.get('user');
}

/** 跳转到登录页并指定初始步骤 */
function goLoginStep(step) {
  if (isLoggedIn()) return;
  store.set('login.initStep', step || null);
  if (window.location.hash !== '#/login') {
    window.location.hash = '#/login';
  }
}

/** 打开登录页（默认欢迎页；顶部「登录」按钮进登录表单） */
export function showLoginModal() {
  goLoginStep('login');
}

/** 打开注册步骤 */
export function showRegisterModal() {
  goLoginStep('register');
}

/** 未登录则跳转登录页；返回是否已登录 */
export function checkLogin() {
  if (isLoggedIn()) return true;
  goLoginStep();
  return false;
}

/**
 * 自动登录检测（任务 1.8.1）
 * socket 连接后：
 * - 无 token → 跳转登录页（游客/账号登录）
 * - 有 token → 已由 socket.js client_connect 自动恢复；若 account_info 失败 → 跳转登录页
 */
export function initLoginCheck() {
  eventBus.on('socket:connect', () => {
    // 无 token 才需要去登录页；有 token 时由自动登录恢复 user，
    // 若恢复失败会走 user:accountInfo 失败分支跳转，避免把已登录用户踢到登录页
    if (!auth.getToken() && !isLoggedIn() && window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    }
  });
  eventBus.on('user:accountInfo', (data) => {
    if (!(data && data.success) && window.location.hash !== '#/login') {
      window.location.hash = '#/login';
    }
  });
}
