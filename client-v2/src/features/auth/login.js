/**
 * 登录界面
 * 模态框形式：账号登录（用户名 + 密码） + 游客登录两种模式。
 * 登录协议走 core/auth.js（account_login / guest_login → login_result）。
 * 登录成功（store.user 更新）后自动关闭弹窗。
 */
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import * as auth from '../../core/auth.js';
import { modal } from '../../components/modal.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

let modalShown = false;

/** 当前是否已登录 */
export function isLoggedIn() {
  return !!store.get('user');
}

/** 展示登录弹窗（已登录或已弹出时忽略） */
export function showLoginModal() {
  if (isLoggedIn() || modalShown) return;
  modalShown = true;

  const usernameInput = el('input', { class: 'input', placeholder: '用户名', autocomplete: 'username' });
  const passwordInput = el('input', {
    class: 'input',
    type: 'password',
    placeholder: '密码',
    autocomplete: 'current-password',
    onKeydown: (e) => { if (e.key === 'Enter') handleLogin(); },
  });

  const content = el('div', { class: 'flex-col', style: 'gap:12px;' }, [
    usernameInput,
    passwordInput,
    el('button', {
      class: 'btn btn--ghost',
      style: 'width:100%;background:var(--theme-accent);color:#fff;',
      onClick: () => auth.guestLogin(),
    }, '游客登录'),
    el('p', { class: 'text-muted', style: 'font-size:12px;text-align:center;' }, '支持 v1 账号，登录后自动保存进度'),
  ]);

  function handleLogin() {
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    if (!username || !password) {
      toast.error('请输入用户名和密码');
      return;
    }
    auth.login(username, password);
  }

  modal.show({
    title: '登录',
    content,
    confirmText: '登 录',
    onConfirm: handleLogin,
    showCancel: false,
    onCancel: () => { modalShown = false; },
  });
}

/** 未登录则弹出登录框；返回是否已登录 */
export function checkLogin() {
  if (isLoggedIn()) return true;
  showLoginModal();
  return false;
}

/**
 * 自动登录检测（任务 1.8.1）
 * socket 连接后：
 * - 无 token → 直接弹出登录框（游客/账号登录）
 * - 有 token → auth.js 已发 get_account_by_token；若 account_info 失败（token 失效）→ 弹出登录框
 */
export function initLoginCheck() {
  eventBus.on('socket:connect', () => {
    if (!auth.getToken()) {
      showLoginModal();
    }
  });
  eventBus.on('user:accountInfo', (data) => {
    if (!(data && data.success)) {
      showLoginModal();
    }
  });
}

// 登录成功后自动关闭弹窗
store.subscribe('user', (user) => {
  if (user && modalShown) {
    modal.close();
    modalShown = false;
  }
});
