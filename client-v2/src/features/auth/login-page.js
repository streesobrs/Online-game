/**
 * 引导式登录页（v2）— 路由 #/login
 * 完整全屏页面，带引导流程：
 *   欢迎 → 选择登录方式（游客体验/账号登录/注册新账号）
 *   → 表单（登录 / 注册 / 重置密码）
 *   → 游客设置昵称（引导完善资料）
 *   → 成功过渡 → 进入游戏大厅（并触发新手引导）
 *
 * 登录协议复用 core/auth.js（account_login / guest_login / account_register
 * / account_reset_password / account_update_profile）。
 */
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import * as auth from '../../core/auth.js';
import { el, viewRoot } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';

/** 品牌特性展示（欢迎页） */
const FEATURES = [
  { icon: '♟️', title: '四款经典棋牌', desc: '五子棋 · 围棋 · 象棋 · 贪吃蛇，一厅通玩' },
  { icon: '🤖', title: '智能 AI 对战', desc: '多难度人机陪练，随时磨炼棋艺' },
  { icon: '👥', title: '实时联机社交', desc: '好友系统 · 在线玩家 · 观战挑战' },
  { icon: '💬', title: '聊天互动', desc: '频道畅聊 · 私信离线送达 · 表情互动' },
];

/** 步骤名称（welcome 无进度点） */
const PROGRESS_MAP = {
  choose: 1, login: 2, register: 2, reset: 2, nickname: 3, done: 4,
};

let container = null;
let currentStep = '';
let loginPending = false; // 已发起登录，等待 login_result
let guestFlow = false;    // 本次是游客登录（成功 → 昵称引导）
let enteredViaPage = false; // 本页是否完成过登录（用于区分自动恢复等外部登录）
let unsubUser = null;
let offAuthResult = null;

/** 渲染登录页（路由 #/login 挂载） */
export function renderLoginPage(root = viewRoot()) {
  if (store.get('user')) {
    window.location.hash = '#/games';
    return;
  }
  container = root;
  root.innerHTML = '';
  enteredViaPage = false;

  // 监听登录成功（游客/账号/注册统一在 store.user 更新时流转）
  if (unsubUser) unsubUser();
  unsubUser = store.subscribe('user', (user) => {
    if (!user) return;
    if (!loginPending) {
      // 非本页发起且未在本页登录过（如自动恢复/其他标签页登录）：直接进入大厅
      if (!enteredViaPage) window.location.hash = '#/games';
      return;
    }
    loginPending = false;
    enteredViaPage = true;
    if (guestFlow) setStep('nickname');
    else finishLogin();
  });

  // 注册/登录失败时重置等待状态，避免残留阻塞后续操作
  if (offAuthResult) offAuthResult();
  offAuthResult = eventBus.on('user:accountActionResult', (data) => {
    if (data && !data.success && (data.action === 'register')) {
      loginPending = false;
    }
  });

  root.append(buildShell());
  const initStep = store.get('login.initStep') || 'welcome';
  store.set('login.initStep', null);
  setStep(STEP_BUILDERS[initStep] ? initStep : 'welcome');
}

/** 组装页面骨架（左品牌区 + 右登录卡片） */
function buildShell() {
  const hero = el('div', { class: 'login-hero' }, [
    el('div', { class: 'login-hero-inner' }, [
      el('div', { class: 'login-logo' }, '🏆'),
      el('h1', { class: 'login-hero-title' }, '棋艺对决大厅'),
      el('p', { class: 'login-hero-sub' }, '一厅汇聚四款经典棋牌 · 联机对战 · AI 陪练 · 好友社交'),
      el('div', { class: 'login-hero-features' },
        FEATURES.map((f) => el('div', { class: 'login-feature' }, [
          el('div', { class: 'login-feature-icon' }, f.icon),
          el('div', { class: 'login-feature-text' }, [
            el('div', { class: 'login-feature-title' }, f.title),
            el('div', { class: 'login-feature-desc' }, f.desc),
          ]),
        ]))),
      el('div', { class: 'login-hero-footer' }, '支持 v1 账号登录 · 进度自动保存 · 同一浏览器无需重复登录'),
    ]),
  ]);

  const panel = el('div', { class: 'login-panel' }, [
    el('div', { class: 'login-card' }, [
      el('div', { class: 'login-progress', id: 'login-progress' }),
      el('div', { class: 'login-step', id: 'login-step' }),
    ]),
  ]);

  return el('div', { class: 'login-page' }, [hero, panel]);
}

/** 切换步骤 */
function setStep(step) {
  currentStep = step;
  const progress = container?.querySelector('#login-progress');
  const box = container?.querySelector('#login-step');
  if (!box) return;

  // 进度指示：choose/done 起显示步骤点
  if (progress) {
    const idx = PROGRESS_MAP[step];
    progress.innerHTML = '';
    if (idx) {
      progress.append(
        ...Array.from({ length: 4 }, (_, i) => el('span', {
          class: 'login-progress-dot' + (i < idx ? ' active' : ''),
        }, '')),
      );
      progress.append(el('span', { class: 'login-progress-label' }, STEP_LABELS[step] || ''));
    }
  }

  const content = STEP_BUILDERS[step] ? STEP_BUILDERS[step]() : stepWelcomeContent();
  box.innerHTML = '';
  box.append(content);
}

/** 步骤标题文案 */
const STEP_LABELS = {
  choose: '选择登录方式',
  login: '账号登录',
  register: '注册新账号',
  reset: '重置密码',
  nickname: '完善资料',
  done: '登录成功',
};

const STEP_BUILDERS = {
  welcome: stepWelcomeContent,
  choose: stepChooseContent,
  login: stepLoginContent,
  register: stepRegisterContent,
  reset: stepResetContent,
  nickname: stepNicknameContent,
  done: stepDoneContent,
};

/* ===== 步骤 1：欢迎 ===== */
function stepWelcomeContent() {
  return el('div', { class: 'login-step-inner' }, [
    el('h2', { class: 'login-title' }, '欢迎来到棋艺世界'),
    el('p', { class: 'login-desc' }, '登录或体验游客模式，即可开始你的棋艺之旅'),
    el('button', { class: 'btn btn-primary login-cta', onClick: () => setStep('choose') }, '开始旅程 →'),
  ]);
}

/* ===== 步骤 2：选择登录方式 ===== */
function stepChooseContent() {
  const opt = (icon, title, desc, onClick, cls = '') => el('button', {
    class: 'login-option' + (cls ? ` ${cls}` : ''),
    onClick,
  }, [
    el('div', { class: 'login-option-icon' }, icon),
    el('div', { class: 'login-option-text' }, [
      el('div', { class: 'login-option-title' }, title),
      el('div', { class: 'login-option-desc' }, desc),
    ]),
    el('span', { class: 'login-option-arrow' }, '›'),
  ]);

  return el('div', { class: 'login-step-inner' }, [
    el('h2', { class: 'login-title' }, '选择登录方式'),
    el('div', { class: 'login-options' }, [
      opt('🎮', '游客体验', '无需注册，立即开玩，稍后完善昵称', handleGuest),
      opt('🔑', '账号登录', '已有账号，直接登录继续', () => setStep('login')),
      opt('✨', '注册新账号', '创建账号，保存进度与成就', () => setStep('register')),
    ]),
    el('button', { class: 'login-back', onClick: () => setStep('welcome') }, '← 返回'),
  ]);
}

/* ===== 步骤 3a：账号登录 ===== */
function stepLoginContent() {
  const u = el('input', { class: 'input login-input', placeholder: '用户名', autocomplete: 'username' });
  const p = el('input', {
    class: 'input login-input',
    type: 'password',
    placeholder: '密码',
    autocomplete: 'current-password',
    onKeydown: (e) => { if (e.key === 'Enter') submit(); },
  });
  let busy = false;

  function submit() {
    const username = u.value.trim();
    const password = p.value;
    if (!username || !password) { toast.error('请输入用户名和密码'); return; }
    if (busy) return;
    if (!store.get('socketConnected')) { toast.error('正在连接服务器，请稍候再试'); return; }
    busy = true;
    guestFlow = false;
    loginPending = true;
    auth.login(username, password);
    // 登录失败（密码错误等）时允许重新提交
    const offLogin = eventBus.on('user:loginResult', (data) => {
      if (!data || data.success) return;
      offLogin();
      busy = false;
    });
  }

  return el('div', { class: 'login-step-inner' }, [
    el('h2', { class: 'login-title' }, '账号登录'),
    el('p', { class: 'login-desc' }, '支持 v1 账号，登录后自动保存进度'),
    u, p,
    el('button', { class: 'btn btn-primary login-cta', onClick: submit }, '登 录'),
    el('div', { class: 'login-links' }, [
      el('button', { class: 'login-link', onClick: () => setStep('reset') }, '忘记密码？'),
      el('button', { class: 'login-link', onClick: () => setStep('choose') }, '返回'),
    ]),
  ]);
}

/* ===== 步骤 3b：注册 ===== */
function stepRegisterContent() {
  const u = el('input', { class: 'input login-input', placeholder: '用户名', autocomplete: 'username' });
  const p = el('input', { class: 'input login-input', type: 'password', placeholder: '密码（至少 6 位）', autocomplete: 'new-password' });
  const p2 = el('input', { class: 'input login-input', type: 'password', placeholder: '确认密码', autocomplete: 'new-password' });
  const n = el('input', { class: 'input login-input', placeholder: '昵称（可选）' });
  let busy = false;

  function submit() {
    const username = u.value.trim();
    const password = p.value;
    if (!username || !password) { toast.error('请输入用户名和密码'); return; }
    if (password.length < 6) { toast.error('密码至少 6 位'); return; }
    if (password !== p2.value) { toast.error('两次输入的密码不一致'); return; }
    if (busy) return;
    if (!store.get('socketConnected')) { toast.error('正在连接服务器，请稍候再试'); return; }
    busy = true;
    guestFlow = false;
    loginPending = true;
    auth.register(username, password, n.value.trim() || null);
    // 注册失败时允许重新提交
    const offReg = eventBus.on('user:accountActionResult', (data) => {
      if (data?.action !== 'register') return;
      offReg();
      busy = false;
    });
  }

  return el('div', { class: 'login-step-inner' }, [
    el('h2', { class: 'login-title' }, '注册新账号'),
    el('p', { class: 'login-desc' }, '创建后自动登录，保存你的棋艺进度'),
    u, p, p2, n,
    el('button', { class: 'btn btn-primary login-cta', onClick: submit }, '注 册'),
    el('div', { class: 'login-links' }, [
      el('button', { class: 'login-link', onClick: () => setStep('choose') }, '返回'),
    ]),
  ]);
}

/* ===== 步骤 3c：重置密码 ===== */
function stepResetContent() {
  const u = el('input', { class: 'input login-input', placeholder: '用户名', autocomplete: 'username' });
  const p = el('input', { class: 'input login-input', type: 'password', placeholder: '新密码（至少 6 位）', autocomplete: 'new-password' });
  const p2 = el('input', { class: 'input login-input', type: 'password', placeholder: '确认新密码', autocomplete: 'new-password' });

  function submit() {
    const username = u.value.trim();
    const password = p.value;
    if (!username || !password) { toast.error('请输入用户名和新密码'); return; }
    if (password.length < 6) { toast.error('密码至少 6 位'); return; }
    if (password !== p2.value) { toast.error('两次输入的密码不一致'); return; }
    auth.resetPassword(username, password);
    toast.info('重置请求已发送，成功后请重新登录');
  }

  return el('div', { class: 'login-step-inner' }, [
    el('h2', { class: 'login-title' }, '重置密码'),
    el('p', { class: 'login-desc' }, '重置成功后请使用新密码登录'),
    u, p, p2,
    el('button', { class: 'btn btn-primary login-cta', onClick: submit }, '重 置'),
    el('div', { class: 'login-links' }, [
      el('button', { class: 'login-link', onClick: () => setStep('login') }, '返回登录'),
    ]),
  ]);
}

/** 从 store.user 提取昵称（兼容两种账号结构） */
function userNickname(user) {
  const inner = user?.account?.account || user?.account || {};
  return inner.nickname || inner.username || '玩家';
}

/* ===== 步骤 4：游客设置昵称 ===== */
function stepNicknameContent() {
  const input = el('input', { class: 'input login-input', placeholder: '输入你的昵称', value: userNickname(store.get('user')), maxlength: '16' });
  let busy = false;

  function save() {
    const nick = input.value.trim();
    if (!nick) { toast.error('昵称不能为空'); return; }
    if (busy) return;
    busy = true;
    // 等待 account_action_result(update_profile) 成功后进入大厅
    const off = eventBus.on('user:accountActionResult', (data) => {
      if (data?.action !== 'update_profile') return;
      off();
      if (data.success) finishLogin();
      else { toast.error(data.message || '昵称保存失败'); busy = false; }
    });
    auth.updateNickname(nick);
  }

  return el('div', { class: 'login-step-inner' }, [
    el('div', { class: 'login-nick-avatar' }, '🎮'),
    el('h2', { class: 'login-title' }, '给游戏账号起个昵称'),
    el('p', { class: 'login-desc' }, '其他玩家在聊天、排行榜中看到的将是你设置的昵称'),
    input,
    el('button', { class: 'btn btn-primary login-cta', onClick: save }, '保存并进入'),
    el('button', { class: 'login-back', onClick: () => finishLogin() }, '跳过，暂不设置'),
  ]);
}

/* ===== 步骤 5：登录成功过渡 ===== */
function stepDoneContent() {
  const name = userNickname(store.get('user'));

  setTimeout(() => {
    destroyLoginPage();
    if (container) container.innerHTML = '';
    window.location.hash = '#/games';
    // 新手引导由 main.js 监听进入游戏大厅时统一触发
  }, 1400);

  return el('div', { class: 'login-step-inner login-done' }, [
    el('div', { class: 'login-done-check' }, '✓'),
    el('h2', { class: 'login-title' }, `欢迎，${name}`),
    el('p', { class: 'login-desc' }, '正在进入游戏大厅...'),
  ]);
}

/** 登录成功：进入过渡步骤 */
function finishLogin() {
  setStep('done');
}

/** 游客体验（无需表单，直接登录） */
function handleGuest() {
  if (!store.get('socketConnected')) {
    toast.error('正在连接服务器，请稍候再试');
    return;
  }
  guestFlow = true;
  loginPending = true;
  auth.guestLogin();
}

/** 清理（路由切走时释放） */
export function destroyLoginPage() {
  if (unsubUser) { unsubUser(); unsubUser = null; }
  if (offAuthResult) { offAuthResult(); offAuthResult = null; }
}
