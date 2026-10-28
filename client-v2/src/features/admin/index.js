/**
 * 简易后台管理（#/admin）
 *
 * 仅管理员可见：复用服务端 /admin 命名空间的鉴权（admin_user_token_login），
 * 登录成功后使用下发的 adminToken 调用管理接口。
 *
 * 功能：
 * - 概览：在线/账号/对局统计、全服广播、维护模式开关
 * - 账号：搜索、封禁/解封、禁言/解除、设为/取消管理员
 * - 邮件物品：按账号 ID 发送邮件（可带星钻/经验/物品）、全服邮件、直接发放物品
 * - 对局：进行中对局强制结束、最近对局记录
 * - 反馈：查看反馈并修改处理状态
 */
import { el } from '../../utils/dom.js';
import { eventBus } from '../../core/eventBus.js';
import { store } from '../../core/store.js';
import { go } from '../../core/router.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';

const GAME_TYPE_NAMES = {
  gobang: '五子棋',
  go: '围棋',
  'chinese-chess': '象棋',
  snake: '贪吃蛇',
  match3: '消消乐',
};

const FEEDBACK_TYPE_NAMES = {
  bug: 'Bug 反馈',
  feature: '功能建议',
  question: '问题咨询',
  other: '其他',
};

const FEEDBACK_STATUS = {
  pending: '待处理',
  processing: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

const TABS = [
  { id: 'overview', label: '概览', icon: '📊' },
  { id: 'accounts', label: '账号', icon: '👥' },
  { id: 'mail', label: '邮件物品', icon: '✉️' },
  { id: 'games', label: '对局', icon: '🎮' },
  { id: 'feedback', label: '反馈', icon: '📝' },
  { id: 'update', label: '更新', icon: '🔄' },
];

/** 当前登录账号是否为管理员 */
function isAdminAccount() {
  const user = store.get('user');
  const inner = user?.account?.account || user?.account || null;
  return !!inner?.isAdmin;
}

/** 账号数据的内层对象（服务端有两种包装结构） */
function accountInner(acc) {
  return acc?.account || acc || {};
}

/**
 * 账号的总对局统计
 * 服务端下发的账号对象顶层带 stats / games（不是 account 内部），
 * stats 缺失或全为 0 时回退为按游戏类型累加 games。
 */
function accountTotals(acc) {
  const stats = acc?.stats || {};
  const totals = {
    totalGames: stats.totalGames || 0,
    totalWins: stats.totalWins || 0,
    totalLosses: stats.totalLosses || 0,
    totalDraws: stats.totalDraws || 0,
  };
  if (totals.totalGames || totals.totalWins || totals.totalLosses || totals.totalDraws) {
    return totals;
  }

  const games = acc?.games || {};
  Object.values(games).forEach((g) => {
    if (!g) return;
    totals.totalGames += g.totalGames || 0;
    totals.totalWins += g.wins || 0;
    totals.totalLosses += g.losses || 0;
    totals.totalDraws += g.draws || 0;
  });
  return totals;
}

/** 时间格式化 */
function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 时长格式化（毫秒 → 可读） */
function formatDuration(ms) {
  const n = Number(ms) || 0;
  if (n <= 0) return '—';
  if (n < 1000) return `${n} 毫秒`;
  const s = Math.round(n / 1000);
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  return `${m} 分 ${s % 60} 秒`;
}

/** 对局结果文案 */
function gameResultText(g) {
  const p1 = g.player1Nickname || g.player1 || '玩家1';
  const p2 = g.player2Nickname || g.player2 || '玩家2';
  if (!g.winner || g.winner === 'draw' || g.result === 'draw') return '平局';
  if (g.winner === 'ai') return `${p2} 胜`;
  if (g.winner === g.player1) return `${p1} 胜`;
  if (g.winner === g.player2) return `${p2} 胜`;
  return `${g.winner} 胜`;
}

function badge(text, variant) {
  return el('span', { class: `admin-badge admin-badge--${variant}` }, text);
}

function statCard(key, label) {
  return el('div', { class: 'admin-stat' }, [
    el('span', { class: 'admin-stat__label' }, label),
    el('span', { class: 'admin-stat__value', 'data-stat': key }, '—'),
  ]);
}

/** 管理接口（REST，需要 adminToken） */
async function adminFetch(path, options = {}, token) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(path, { ...options, headers });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.success === false) {
    throw new Error(body?.message || `请求失败（HTTP ${res.status}）`);
  }
  return body;
}

/** 模块级会话（页面离开时销毁） */
let session = null;

function destroySession() {
  if (!session) return;
  if (session.offRoute) session.offRoute();
  if (session.socket) {
    try { session.socket.removeAllListeners(); session.socket.disconnect(); } catch { /* ignore */ }
  }
  session = null;
}

/**
 * 渲染后台管理页
 * @param {HTMLElement} container - #view-root
 */
export function renderAdmin(container) {
  destroySession();

  // 已加载账号数据且明确不是管理员：直接展示无权限
  if (store.get('user') && !isAdminAccount()) {
    container.innerHTML = '';
    container.append(el('div', { class: 'admin-page' }, [
      el('div', { class: 'admin-empty' }, [
        el('div', { class: 'admin-empty__icon' }, '🔒'),
        el('div', { class: 'admin-empty__title' }, '仅管理员可访问'),
        el('div', { class: 'admin-empty__desc' }, '当前账号没有后台管理权限。'),
        el('button', { class: 'admin-btn admin-btn--primary', onClick: () => go('games') }, '返回游戏大厅'),
      ]),
    ]));
    return;
  }

  const state = {
    ready: false,
    error: '',
    tab: 'overview',
    stats: null,
    maintenance: null,
    maintenanceKey: '',
    accounts: [],
    accountsKey: '',
    users: [],
    activeGames: [],
    activeGamesKey: '',
    history: [],
    historyLoaded: false,
    feedbacks: [],
    feedbackLoaded: false,
    feedbackLoading: false,
    adminName: '',
    items: [],
    packs: [],
    itemsLoaded: false,
    itemsLoading: false,
    pickerRefreshers: new Set(),
    cosmetics: [],
    vipOptions: [],
    achievements: [],
    mailTemplates: [],
    templatesLoaded: false,
    scheduledJobs: [],
    scheduledLoaded: false,
    userMails: [],
    userMailsUserId: '',
    userMailsLoaded: false,
    gitInfo: null,
    gitChecking: false,
    updateStatus: null,
    updateSnapshot: null,
    updateLogs: [],
  };

  const refs = {};
  let renderTemplateOptions = () => { };
  let renderUserMails = () => { };
  let renderScheduledJobs = () => { };

  const statusText = el('span', { class: 'admin-status__text' }, '正在连接后台…');
  const statusDot = el('span', { class: 'admin-status__dot' });
  const statusBar = el('div', { class: 'admin-status' }, [statusDot, statusText]);

  const content = el('div', { class: 'admin-content' });

  const tabsEl = el('nav', { class: 'admin-tabs' }, TABS.map((tab) => el('button', {
    class: 'admin-tab' + (tab.id === state.tab ? ' active' : ''),
    type: 'button',
    'data-tab': tab.id,
    onClick: () => switchTab(tab.id),
  }, [
    el('span', { class: 'admin-tab__icon' }, tab.icon),
    el('span', { class: 'admin-tab__label' }, tab.label),
    tab.id === 'accounts' ? el('span', { class: 'admin-tab__count', 'data-count': 'accounts' }) : null,
    tab.id === 'games' ? el('span', { class: 'admin-tab__count', 'data-count': 'games' }) : null,
    tab.id === 'feedback' ? el('span', { class: 'admin-tab__count', 'data-count': 'feedback' }) : null,
  ])));

  const page = el('div', { class: 'admin-page' }, [
    el('header', { class: 'admin-head' }, [
      el('div', { class: 'admin-head__left' }, [
        el('button', { class: 'admin-back', type: 'button', onClick: () => go('games') }, '← 返回大厅'),
        el('div', { class: 'admin-head__titles' }, [
          el('h1', { class: 'admin-title' }, '🛠️ 后台管理'),
          el('div', { class: 'admin-subtitle' }, '简易管理面板'),
        ]),
      ]),
      el('div', { class: 'admin-head__right' }, [
        el('span', { class: 'admin-identity', 'data-identity': '' }, ''),
        el('button', { class: 'admin-btn admin-btn--ghost', type: 'button', onClick: () => refreshCurrentTab() }, '刷新'),
        el('a', { class: 'admin-btn admin-btn--ghost', href: '/admin', title: '打开旧版完整后台' }, '旧版后台'),
      ]),
    ]),
    statusBar,
    tabsEl,
    content,
  ]);

  container.innerHTML = '';
  container.append(page);

  switchTab(state.tab);

  // ===== 会话与鉴权 =====
  function setStatus(text, isError = false) {
    statusText.textContent = text;
    statusDot.classList.toggle('is-error', isError);
  }

  function connect() {
    if (!window.io) {
      state.error = 'Socket.IO 未加载，无法连接后台';
      setStatus(state.error, true);
      renderNoAccess(state.error);
      return;
    }

    const userToken = localStorage.getItem('userToken');
    if (!userToken) {
      state.error = '缺少登录凭证，请重新登录';
      setStatus(state.error, true);
      renderNoAccess(state.error);
      return;
    }

    setStatus('正在验证管理员身份…');

    const socket = window.io('/admin', {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    session = {
      socket,
      token: localStorage.getItem('adminToken') || '',
      offRoute: eventBus.on('route:change', (id) => {
        if (id !== 'admin') destroySession();
      }),
    };

    socket.on('connect', () => {
      setStatus('正在验证管理员身份…');
      socket.emit('admin_user_token_login', { userToken });
    });

    socket.on('connect_error', (err) => {
      state.error = `后台连接失败：${err?.message || '未知错误'}`;
      setStatus(state.error, true);
    });

    socket.on('admin_login_result', (data) => {
      if (!data?.success) {
        state.error = data?.message || '管理员身份验证失败';
        setStatus(state.error, true);
        renderNoAccess(state.error);
        try { socket.disconnect(); } catch { /* ignore */ }
        return;
      }

      session.token = data.token || '';
      if (session.token) localStorage.setItem('adminToken', session.token);

      const acc = accountInner(data.account);
      state.adminName = acc.nickname || acc.username || '管理员';
      state.ready = true;
      state.error = '';
      // 重连后清掉旧的更新状态，等 REST/推送回填，避免显示上一次残留的“更新进行中”
      state.updateStatus = null;
      setStatus('后台已连接');
      page.querySelector('[data-identity]').textContent = state.adminName;

      // 维护状态不在 admin_update 里，单独拉一次；其余数据由 admin_update 自动推送
      socket.emit('get_system_stats');
      socket.emit('get_items_list');
      if (state.tab === 'accounts') socket.emit('get_all_accounts');
      if (state.tab === 'games' && !state.historyLoaded) socket.emit('get_game_history', { limit: 20 });
      if (state.tab === 'update') { loadUpdateStatus(); checkGitUpdate(false); }
    });

    socket.on('admin_update', (data) => {
      if (!data) return;
      state.stats = data.stats || null;
      state.accounts = Array.isArray(data.accounts) ? data.accounts : [];
      state.users = Array.isArray(data.users) ? data.users : [];
      state.activeGames = (Array.isArray(data.games) ? data.games : []).filter((g) => g.status === 'playing');
      updateCounts();

      // 数据未变化时跳过列表重建，避免每 2 秒刷新一次导致按钮点击瞬间失效
      const accountsKey = JSON.stringify([
        state.accounts.map((acc) => {
          const inner = accountInner(acc);
          const totals = accountTotals(acc);
          return [inner.id, !!inner.online, !!inner.isAdmin, !!inner.isBanned,
          inner.nickname, inner.lastLogin, inner.loginCount,
          totals.totalGames, totals.totalWins, totals.totalLosses];
        }),
        state.users.map((u) => [u.accountId, !!u.muted, u.muteInfo?.remainingMinutes ?? -1]),
      ]);
      const accountsChanged = accountsKey !== state.accountsKey;
      state.accountsKey = accountsKey;

      const activeGamesKey = state.activeGames.map((g) => `${g.gameId}:${g.moveCount || 0}`).join('|');
      const gamesChanged = activeGamesKey !== state.activeGamesKey;
      state.activeGamesKey = activeGamesKey;

      if (state.tab === 'overview') syncOverview();
      if (state.tab === 'accounts' && accountsChanged) renderAccountsBody();
      if (state.tab === 'games' && gamesChanged) renderActiveGames();
      if (state.tab === 'mail') syncAccountOptions();
    });

    socket.on('admin_system_stats', (data) => {
      if (!data) return;
      state.stats = { ...(state.stats || {}), ...data };
      state.maintenance = data.maintenance || null;
      if (state.tab === 'overview') syncOverview();
    });

    socket.on('admin_accounts_list', (data) => {
      state.accounts = Array.isArray(data?.accounts) ? data.accounts : [];
      updateCounts();
      if (state.tab === 'accounts') renderAccountsBody();
    });

    socket.on('admin_items_list', (data) => {
      state.items = Array.isArray(data?.items) ? data.items : [];
      state.packs = Array.isArray(data?.packs) ? data.packs : [];
      state.cosmetics = Array.isArray(data?.cosmetics) ? data.cosmetics : [];
      state.vipOptions = Array.isArray(data?.vip) ? data.vip : [];
      state.itemsLoaded = true;
      state.itemsLoading = false;
      state.pickerRefreshers.forEach((fn) => fn());
      if (state.tab === 'mail') refreshMailSelectors();
    });

    socket.on('achievements_list', (data) => {
      const categories = Array.isArray(data?.categories) ? data.categories : [];
      const list = [];
      categories.forEach((category) => {
        (category.achievements || []).forEach((ach) => {
          list.push({
            id: String(ach.id),
            name: ach.name,
            description: ach.description || '',
            type: category.name || ach.type || '',
          });
        });
      });
      state.achievements = list;
      if (state.tab === 'mail') refreshMailSelectors();
    });

    socket.on('admin_mail_templates', (data) => {
      state.mailTemplates = Array.isArray(data?.templates) ? data.templates : [];
      state.templatesLoaded = true;
      if (state.tab === 'mail') renderTemplateOptions();
    });

    socket.on('admin_scheduled_mails', (data) => {
      state.scheduledJobs = Array.isArray(data?.jobs) ? data.jobs : [];
      state.scheduledLoaded = true;
      if (state.tab === 'mail') renderScheduledJobs();
    });

    socket.on('admin_user_mails', (data) => {
      state.userMails = Array.isArray(data?.mails) ? data.mails : [];
      state.userMailsUserId = data?.userId || '';
      state.userMailsLoaded = true;
      if (state.tab === 'mail') renderUserMails();
    });

    socket.on('admin_game_history', (data) => {
      state.history = Array.isArray(data?.games) ? data.games : [];
      state.historyLoaded = true;
      updateCounts();
      if (state.tab === 'games') renderHistory();
    });

    socket.on('admin_accounts_updated', () => {
      socket.emit('get_all_accounts');
    });

    // ===== 更新流程（服务端 UpdateManager 推送到 admins 房间） =====
    socket.on('update_status', (data) => {
      state.updateStatus = data || null;
      if (state.tab === 'update') syncUpdateStatus();
    });

    socket.on('update_log', (entry) => {
      if (!entry) return;
      state.updateLogs.push(entry);
      if (state.updateLogs.length > 50) state.updateLogs.shift();
      if (state.tab === 'update') appendUpdateLog(entry);
    });

    socket.on('admin_action_result', (data) => {
      if (!data) return;
      const actionMessages = {
        send_mail: '邮件已发送',
        send_mail_batch: '批量邮件已发送',
        send_mail_all: '全站邮件已发送',
        grant_items: '物品已发放',
        revoke_mail: '邮件已撤回',
        delete_mail: '邮件已删除',
        save_mail_template: '模板已保存',
        delete_mail_template: '模板已删除',
        cancel_scheduled_mail: '定时任务已取消',
      };
      const msg = data.message || actionMessages[data.action] || '操作完成';
      if (data.success) toast.success(msg);
      else toast.error(msg || '操作失败');

      if (data.action === 'send_mail' || data.action === 'send_mail_batch' || data.action === 'send_mail_all') {
        if (data.scheduled) socket.emit('get_scheduled_mails');
      }
      if (['revoke_mail', 'delete_mail'].includes(data.action) && state.userMailsUserId) {
        socket.emit('get_user_mails', { id: state.userMailsUserId });
      }
      if (['save_mail_template', 'delete_mail_template'].includes(data.action)) {
        state.templatesLoaded = false;
        socket.emit('get_mail_templates');
      }
      if (data.action === 'cancel_scheduled_mail') {
        socket.emit('get_scheduled_mails');
      }

      if (!data.success) return;
      if (['ban_account', 'unban_account', 'mute_user', 'unmute_user',
        'upgrade_to_admin', 'downgrade_from_admin'].includes(data.action)) {
        socket.emit('get_all_accounts');
      }
      if (data.action === 'maintenance_mode') {
        state.maintenance = {
          ...(state.maintenance || {}),
          enabled: !!data.enabled,
        };
        socket.emit('get_system_stats');
      }
      if (['end_game', 'broadcast'].includes(data.action)) {
        socket.emit('get_system_stats');
      }
    });

    socket.on('auth_error', (data) => {
      toast.error(data?.message || '后台授权已失效，请刷新页面重试');
    });

    socket.on('disconnect', () => {
      if (session && session.socket === socket) {
        setStatus('后台连接已断开，正在重连…', true);
      }
    });

    socket.on('reconnect', () => {
      setStatus('后台已重连');
      socket.emit('admin_user_token_login', { userToken });
    });
  }

  function renderNoAccess(message) {
    content.innerHTML = '';
    content.append(el('div', { class: 'admin-empty' }, [
      el('div', { class: 'admin-empty__icon' }, '🔒'),
      el('div', { class: 'admin-empty__title' }, '无法进入后台'),
      el('div', { class: 'admin-empty__desc' }, message || '仅管理员可访问。'),
      el('div', { class: 'admin-empty__actions' }, [
        el('button', {
          class: 'admin-btn admin-btn--primary',
          type: 'button',
          onClick: () => {
            destroySession();
            state.ready = false;
            state.error = '';
            switchTab(state.tab);
            connect();
          },
        }, '重试'),
        el('button', { class: 'admin-btn admin-btn--ghost', type: 'button', onClick: () => go('games') }, '返回大厅'),
      ]),
    ]));
  }

  // ===== Tab =====
  function switchTab(id) {
    state.tab = id;
    tabsEl.querySelectorAll('.admin-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === id);
    });

    if (state.error && !state.ready) {
      renderNoAccess(state.error);
      return;
    }

    if (id !== 'mail') refs.mail = null;
    if (id !== 'update') refs.update = null;

    if (id === 'overview') renderOverview();
    else if (id === 'accounts') renderAccounts();
    else if (id === 'mail') renderMail();
    else if (id === 'games') renderGames();
    else if (id === 'feedback') renderFeedback();
    else if (id === 'update') renderUpdate();

    if (session?.socket && state.ready) {
      if (id === 'accounts') session.socket.emit('get_all_accounts');
      if (id === 'games' && !state.historyLoaded) session.socket.emit('get_game_history', { limit: 20 });
      if (id === 'feedback' && !state.feedbackLoaded) loadFeedbacks();
      if (id === 'mail') {
        if (!state.templatesLoaded) session.socket.emit('get_mail_templates');
        if (!state.scheduledLoaded) session.socket.emit('get_scheduled_mails');
        if (!state.achievements.length) session.socket.emit('get_achievements_list');
      }
    }
  }

  function refreshCurrentTab() {
    if (!session?.socket) {
      toast.warn('后台尚未连接');
      return;
    }
    if (state.tab === 'overview') session.socket.emit('get_system_stats');
    if (state.tab === 'accounts') session.socket.emit('get_all_accounts');
    if (state.tab === 'games') {
      session.socket.emit('get_game_history', { limit: 20 });
      session.socket.emit('get_system_stats');
    }
    if (state.tab === 'feedback') loadFeedbacks();
    if (state.tab === 'update') {
      loadUpdateStatus();
      checkGitUpdate(true);
    }
    toast.info('已刷新');
  }

  function setNodeText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function updateCounts() {
    const accountsCount = tabsEl.querySelector('[data-count="accounts"]');
    if (accountsCount) setNodeText(accountsCount, state.accounts.length ? String(state.accounts.length) : '');
    const gamesCount = tabsEl.querySelector('[data-count="games"]');
    if (gamesCount) setNodeText(gamesCount, state.activeGames.length ? String(state.activeGames.length) : '');
    const feedbackCount = tabsEl.querySelector('[data-count="feedback"]');
    if (feedbackCount) {
      const pending = state.feedbacks.filter((f) => f.status === 'pending').length;
      setNodeText(feedbackCount, pending ? String(pending) : '');
    }
  }

  // ===== 概览 =====
  function renderOverview() {
    content.innerHTML = '';
    refs.overview = {};
    refs.accounts = null;
    refs.games = null;
    refs.feedback = null;

    const statsGrid = el('div', { class: 'admin-stat-grid' }, [
      statCard('onlineUsers', '在线用户'),
      statCard('totalUsers', '注册账号'),
      statCard('activeGames', '进行中对局'),
      statCard('totalGames', '历史对局'),
      statCard('todayUsers', '今日活跃'),
      statCard('peakOnline', '在线峰值'),
    ]);

    // ---- 维护模式 ----
    const messageInput = el('input', {
      class: 'admin-input',
      type: 'text',
      placeholder: '维护提示文案（默认：系统维护中，请稍后再试）',
      maxlength: '120',
    });
    const durationInput = el('input', {
      class: 'admin-input admin-input--number',
      type: 'number',
      min: '0',
      max: '10080',
      value: '30',
      title: '自动结束时间（分钟，0 表示手动关闭）',
    });
    const blockChatInput = el('input', { type: 'checkbox' });
    const kickInput = el('input', { type: 'checkbox', checked: true });

    const maintenanceState = el('div', { class: 'admin-maintenance-state', 'data-maintenance-state': '' }, '状态：—');
    const maintenanceEnd = el('div', { class: 'admin-maintenance-end', 'data-maintenance-end': '' });

    const maintenanceForm = el('div', { class: 'admin-form' }, [
      el('div', { class: 'admin-form-row' }, [messageInput]),
      el('div', { class: 'admin-form-row admin-form-row--wrap' }, [
        el('label', { class: 'admin-field' }, [
          el('span', { class: 'admin-field__label' }, '持续（分钟）'),
          durationInput,
        ]),
        el('label', { class: 'admin-check' }, [blockChatInput, el('span', {}, '禁止聊天')]),
        el('label', { class: 'admin-check' }, [kickInput, el('span', {}, '开启时踢出玩家')]),
      ]),
      el('div', { class: 'admin-form-actions' }, [
        el('button', {
          class: 'admin-btn admin-btn--warning',
          type: 'button',
          onClick: () => {
            const message = messageInput.value.trim() || '系统维护中，请稍后再试';
            const durationMinutes = Math.max(0, parseInt(durationInput.value, 10) || 0);
            emitAdmin('maintenance_mode', {
              enabled: true,
              message,
              durationMinutes,
              blockChat: blockChatInput.checked,
              kick: kickInput.checked,
            });
          },
        }, '开启维护'),
        el('button', {
          class: 'admin-btn admin-btn--success',
          type: 'button',
          onClick: () => {
            modal.show({
              title: '关闭维护模式',
              content: '将恢复所有玩家正常访问，确定关闭维护模式吗？',
              confirmText: '关闭维护',
              onConfirm: () => emitAdmin('maintenance_mode', { enabled: false }),
            });
          },
        }, '关闭维护'),
      ]),
    ]);

    // ---- 全服广播 ----
    const broadcastInput = el('input', {
      class: 'admin-input',
      type: 'text',
      placeholder: '输入要广播给所有玩家的消息',
      maxlength: '200',
    });
    const sendBroadcast = () => {
      const message = broadcastInput.value.trim();
      if (!message) { toast.warn('请输入广播内容'); return; }
      emitAdmin('broadcast', { message });
      broadcastInput.value = '';
    };
    broadcastInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendBroadcast();
    });

    const broadcastPanel = el('div', { class: 'admin-form' }, [
      el('div', { class: 'admin-form-row' }, [broadcastInput]),
      el('div', { class: 'admin-form-actions' }, [
        el('button', { class: 'admin-btn admin-btn--primary', type: 'button', onClick: sendBroadcast }, '发送广播'),
      ]),
    ]);

    content.append(
      section('服务器概览', '来自后台定时推送的实时数据', statsGrid),
      section('维护模式', '开启后玩家会收到维护提示，可按需踢出在线玩家', [
        maintenanceState,
        maintenanceEnd,
        maintenanceForm,
      ]),
      section('全服广播', '消息会以系统提示形式推送给所有在线玩家', broadcastPanel),
    );

    refs.overview = {
      maintenanceState,
      maintenanceEnd,
      messageInput,
      durationInput,
      blockChatInput,
      kickInput,
    };

    syncOverview();
  }

  function syncOverview() {
    const grid = content.querySelector('.admin-stat-grid');
    if (!grid) return;
    const stats = state.stats || {};
    const users = stats.users || {};
    const games = stats.games || {};
    const values = {
      onlineUsers: stats.onlineUsers ?? users.online ?? 0,
      totalUsers: stats.totalUsers ?? users.registeredTotal ?? 0,
      activeGames: stats.activeGames ?? games.active ?? 0,
      totalGames: stats.totalGames ?? games.totalPlayed ?? 0,
      todayUsers: stats.todayUsers ?? users.todayActive ?? 0,
      peakOnline: stats.peakOnline ?? 0,
    };
    grid.querySelectorAll('[data-stat]').forEach((node) => {
      const key = node.dataset.stat;
      if (key in values) setNodeText(node, String(values[key]));
    });

    if (!refs.overview) return;
    const m = state.maintenance;
    if (m) {
      setNodeText(refs.overview.maintenanceState, m.enabled ? '状态：维护中' : '状态：正常');
      refs.overview.maintenanceState.classList.toggle('is-on', !!m.enabled);
      setNodeText(refs.overview.maintenanceEnd, m.enabled && m.endTime
        ? `预计结束：${formatTime(m.endTime)}`
        : (m.enabled ? '未设置自动结束时间' : ''));

      // 仅当服务端维护状态变化时回填表单，避免覆盖用户正在输入的时长/文案
      const maintenanceKey = JSON.stringify([m.enabled, m.endTime, m.message, m.durationMinutes, m.blockChat]);
      if (maintenanceKey !== state.maintenanceKey) {
        state.maintenanceKey = maintenanceKey;
        if (!refs.overview.messageInput.value && m.message) {
          refs.overview.messageInput.value = m.message;
        }
        if (m.durationMinutes) refs.overview.durationInput.value = String(m.durationMinutes);
        refs.overview.blockChatInput.checked = !!m.blockChat;
      }
    }
  }

  // ===== 账号 =====
  function renderAccounts() {
    content.innerHTML = '';
    refs.overview = null;
    refs.games = null;
    refs.feedback = null;

    const searchInput = el('input', {
      class: 'admin-input admin-input--search',
      type: 'search',
      placeholder: '搜索昵称 / 用户名 / 账号 ID',
    });
    const filterSelect = el('select', { class: 'admin-select' }, [
      el('option', { value: 'all' }, '全部账号'),
      el('option', { value: 'online' }, '仅在线'),
      el('option', { value: 'admin' }, '管理员'),
      el('option', { value: 'banned' }, '已封禁'),
      el('option', { value: 'muted' }, '禁言中'),
    ]);
    const list = el('div', { class: 'admin-list', 'data-account-list': '' });
    const hint = el('div', { class: 'admin-list-hint' });

    searchInput.addEventListener('input', () => renderAccountsBody());
    filterSelect.addEventListener('change', () => renderAccountsBody());

    content.append(section('账号管理', '修改操作会实时生效并记录到操作日志', [
      el('div', { class: 'admin-toolbar' }, [searchInput, filterSelect]),
      hint,
      list,
    ]));

    refs.accounts = { searchInput, filterSelect, list, hint };
    renderAccountsBody();
  }

  function mutedMap() {
    const map = new Map();
    state.users.forEach((u) => {
      if (u?.accountId) map.set(u.accountId, u);
    });
    return map;
  }

  function renderAccountsBody() {
    if (!refs.accounts) return;
    const { searchInput, filterSelect, list, hint } = refs.accounts;
    const keyword = (searchInput.value || '').trim().toLowerCase();
    const filter = filterSelect.value;
    const userMap = mutedMap();

    const rows = state.accounts
      .map((acc) => ({ acc, inner: accountInner(acc), user: userMap.get(accountInner(acc).id) }))
      .filter(({ acc, inner, user }) => {
        if (keyword) {
          const hay = `${inner.nickname || ''} ${inner.username || ''} ${inner.id || ''}`.toLowerCase();
          if (!hay.includes(keyword)) return false;
        }
        if (filter === 'online') return !!(inner.online || user);
        if (filter === 'admin') return !!inner.isAdmin;
        if (filter === 'banned') return !!inner.isBanned;
        if (filter === 'muted') return !!(user && user.muted);
        return true;
      })
      .sort((a, b) => (b.inner.lastLogin || b.inner.lastSeen || 0) - (a.inner.lastLogin || a.inner.lastSeen || 0));

    list.innerHTML = '';
    hint.textContent = `共 ${state.accounts.length} 个账号，筛选后 ${rows.length} 个`;

    if (!rows.length) {
      list.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
        el('div', { class: 'admin-empty__icon' }, '🗂️'),
        el('div', { class: 'admin-empty__desc' }, '没有符合条件的账号'),
      ]));
      return;
    }

    const frag = document.createDocumentFragment();
    rows.slice(0, 200).forEach(({ acc, inner, user }) => {
      frag.append(accountRow(acc, inner, user));
    });
    list.append(frag);
    if (rows.length > 200) {
      list.append(el('div', { class: 'admin-list-hint' }, '仅显示前 200 个账号，请使用搜索缩小范围。'));
    }
  }

  function accountRow(acc, inner, user) {
    const isOnline = !!(inner.online || user);
    const isMuted = !!(user && user.muted);
    const totals = accountTotals(acc);
    const level = inner.profile?.level ?? 1;

    const badges = [
      isOnline ? badge('在线', 'online') : badge('离线', 'offline'),
      inner.isAdmin ? badge('管理员', 'admin') : null,
      inner.isBanned ? badge('已封禁', 'danger') : null,
      isMuted ? badge('禁言中', 'warning') : null,
    ];

    const ops = el('div', { class: 'admin-account-ops' }, [
      inner.isBanned
        ? el('button', {
          class: 'admin-btn admin-btn--sm admin-btn--success',
          type: 'button',
          onClick: () => {
            modal.show({
              title: '解封账号',
              content: `确定解封「${inner.nickname || inner.username || inner.id}」吗？`,
              confirmText: '解封',
              onConfirm: () => emitAdmin('unban_account', { accountId: inner.id }),
            });
          },
        }, '解封')
        : el('button', {
          class: 'admin-btn admin-btn--sm admin-btn--danger',
          type: 'button',
          disabled: !!inner.isAdmin,
          title: inner.isAdmin ? '不能封禁管理员账号' : '',
          onClick: () => openBanModal(inner),
        }, '封禁'),
      isMuted
        ? el('button', {
          class: 'admin-btn admin-btn--sm admin-btn--success',
          type: 'button',
          onClick: () => emitAdmin('unmute_user', { accountId: inner.id }),
        }, '解除禁言')
        : el('button', {
          class: 'admin-btn admin-btn--sm admin-btn--warning',
          type: 'button',
          onClick: () => openMuteModal(inner),
        }, '禁言'),
      inner.isAdmin
        ? el('button', {
          class: 'admin-btn admin-btn--sm admin-btn--ghost',
          type: 'button',
          onClick: () => {
            modal.show({
              title: '取消管理员',
              content: `确定取消「${inner.nickname || inner.username || inner.id}」的管理员权限吗？取消后将无法进入后台。`,
              confirmText: '取消权限',
              onConfirm: () => emitAdmin('downgrade_from_admin', { accountId: inner.id }),
            });
          },
        }, '取消管理员')
        : el('button', {
          class: 'admin-btn admin-btn--sm admin-btn--ghost',
          type: 'button',
          onClick: () => {
            modal.show({
              title: '设为管理员',
              content: `确定将「${inner.nickname || inner.username || inner.id}」设为管理员吗？该账号将可以进入后台。`,
              confirmText: '设为管理员',
              onConfirm: () => emitAdmin('upgrade_to_admin', { accountId: inner.id }),
            });
          },
        }, '设为管理员'),
    ]);

    const muteText = isMuted && user?.muteInfo
      ? el('div', { class: 'admin-account-mute' },
        `禁言剩余 ${user.muteInfo.remainingMinutes ?? '—'} 分钟${user.muteInfo.reason ? `：${user.muteInfo.reason}` : ''}`)
      : null;

    return el('div', { class: 'admin-account' }, [
      el('div', { class: 'admin-account__main' }, [
        el('div', { class: 'admin-account__name' }, [
          el('span', { class: 'admin-account__nick' }, inner.nickname || inner.username || inner.id),
          ...badges,
        ]),
        el('div', { class: 'admin-account__meta' },
          `${inner.username ? `@${inner.username}` : '游客号'} · ID ${inner.id} · Lv.${level}`),
        muteText,
      ]),
      el('div', { class: 'admin-account__stats' }, [
        el('span', {}, `对局 ${totals.totalGames}`),
        el('span', {}, `胜 ${totals.totalWins}`),
        el('span', {}, `负 ${totals.totalLosses}`),
        el('span', {}, `平 ${totals.totalDraws}`),
        el('span', {}, `登录 ${inner.loginCount || 0}`),
        el('span', {}, `最后登录 ${formatTime(inner.lastLogin || inner.lastSeen)}`),
      ]),
      ops,
    ]);
  }

  function openBanModal(inner) {
    const reasonInput = el('input', { class: 'admin-input', type: 'text', placeholder: '封禁原因（可选）' });
    modal.show({
      title: '封禁账号',
      content: el('div', {}, [
        el('div', { class: 'admin-modal-desc' }, `确定封禁「${inner.nickname || inner.username || inner.id}」吗？`),
        reasonInput,
      ]),
      confirmText: '封禁',
      onConfirm: () => emitAdmin('ban_account', {
        accountId: inner.id,
        reason: reasonInput.value.trim(),
      }),
    });
  }

  function openMuteModal(inner) {
    const durationSelect = el('select', { class: 'admin-select' }, [
      el('option', { value: '10' }, '10 分钟'),
      el('option', { value: '60', selected: true }, '1 小时'),
      el('option', { value: '360' }, '6 小时'),
      el('option', { value: '1440' }, '1 天'),
      el('option', { value: '0' }, '永久'),
    ]);
    const reasonInput = el('input', { class: 'admin-input', type: 'text', placeholder: '禁言原因（可选）' });
    modal.show({
      title: '禁言账号',
      content: el('div', { class: 'admin-modal-form' }, [
        el('div', { class: 'admin-modal-desc' }, `禁言「${inner.nickname || inner.username || inner.id}」`),
        el('label', { class: 'admin-field' }, [el('span', { class: 'admin-field__label' }, '时长'), durationSelect]),
        reasonInput,
      ]),
      confirmText: '禁言',
      onConfirm: () => emitAdmin('mute_user', {
        accountId: inner.id,
        duration: parseInt(durationSelect.value, 10) || 0,
        reason: reasonInput.value.trim(),
      }),
    });
  }

  // ===== 邮件与物品 =====
  function ensureItemsLoaded() {
    if (state.itemsLoaded || state.itemsLoading) return;
    if (!session?.socket || !session.socket.connected) return;
    state.itemsLoading = true;
    session.socket.emit('get_items_list');
  }

  /** 可发放物品（物品 + 礼包，按 id 去重） */
  function grantableItems() {
    const map = new Map();
    [...state.items, ...state.packs].forEach((item) => {
      if (!item || !item.id || item.enabled === false || map.has(item.id)) return;
      map.set(item.id, item);
    });
    return Array.from(map.values());
  }

  /** 物品选择器：已选列表（可改数量）+ 可点击添加的物品标签 */
  function buildItemPicker() {
    const selected = new Map();
    const selectedEl = el('div', { class: 'admin-picker__selected' });
    const availableEl = el('div', { class: 'admin-picker__available' });

    function renderSelected() {
      selectedEl.innerHTML = '';
      if (!selected.size) {
        selectedEl.append(el('div', { class: 'admin-picker__empty' }, '尚未选择物品'));
        return;
      }
      selected.forEach((item) => {
        selectedEl.append(el('div', { class: 'admin-picker__row' }, [
          el('span', { class: 'admin-picker__icon' }, item.icon || '📦'),
          el('span', { class: 'admin-picker__name', title: item.id }, item.name || item.id),
          el('input', {
            class: 'admin-input admin-picker__count',
            type: 'number',
            min: '1',
            value: String(item.count),
            onChange: (e) => {
              item.count = Math.max(1, parseInt(e.target.value, 10) || 1);
              e.target.value = String(item.count);
            },
          }),
          el('button', {
            class: 'admin-btn admin-btn--sm admin-btn--danger',
            type: 'button',
            onClick: () => {
              selected.delete(item.id);
              renderSelected();
              renderAvailable();
            },
          }, '移除'),
        ]));
      });
    }

    function renderAvailable() {
      availableEl.innerHTML = '';
      if (!state.itemsLoaded) {
        availableEl.append(el('div', { class: 'admin-picker__empty' }, '正在加载物品列表…'));
        return;
      }
      const all = grantableItems();
      if (!all.length) {
        availableEl.append(el('div', { class: 'admin-picker__empty' }, '暂无可发放物品'));
        return;
      }
      all.forEach((item) => {
        const active = selected.has(item.id);
        availableEl.append(el('button', {
          class: 'admin-picker__chip' + (active ? ' is-active' : ''),
          type: 'button',
          title: item.description || item.id,
          onClick: () => {
            if (selected.has(item.id)) selected.delete(item.id);
            else selected.set(item.id, {
              id: item.id,
              name: item.name || item.id,
              icon: item.icon || '📦',
              count: 1,
            });
            renderSelected();
            renderAvailable();
          },
        }, `${item.icon || '📦'} ${item.name || item.id}`));
      });
    }

    const node = el('div', { class: 'admin-picker' }, [
      el('div', { class: 'admin-picker__label' }, '已选物品'),
      selectedEl,
      el('div', { class: 'admin-picker__label' }, '点击下方物品添加'),
      availableEl,
    ]);

    renderSelected();
    renderAvailable();
    ensureItemsLoaded();

    const refresh = () => { renderSelected(); renderAvailable(); };
    state.pickerRefreshers.add(refresh);

    return {
      node,
      getItems: () => Array.from(selected.values())
        .map((item) => ({ id: item.id, count: Math.max(1, parseInt(item.count, 10) || 1) })),
      setItems: (list = []) => {
        selected.clear();
        const all = grantableItems();
        list.forEach((it) => {
          if (!it || !it.id) return;
          const found = all.find((x) => x.id === it.id) || {};
          selected.set(it.id, {
            id: it.id,
            name: found.name || it.name || it.id,
            icon: found.icon || it.icon || '📦',
            count: Math.max(1, parseInt(it.count, 10) || 1),
          });
        });
        renderSelected();
        renderAvailable();
      },
      refresh,
    };
  }

  /** 通用标签选择器（外观 / 成就） */
  function buildChipPicker(itemsFn, config = {}) {
    const selected = new Map();
    const wrap = el('div', { class: 'admin-picker__available' });

    function render() {
      wrap.innerHTML = '';
      const all = itemsFn();
      if (!all.length) {
        wrap.append(el('div', { class: 'admin-picker__empty' }, config.emptyText || '暂无可选项'));
        return;
      }
      all.forEach((item) => {
        const active = selected.has(item.id);
        wrap.append(el('button', {
          class: 'admin-picker__chip' + (active ? ' is-active' : ''),
          type: 'button',
          title: item.description || item.id,
          onClick: () => {
            if (selected.has(item.id)) selected.delete(item.id);
            else selected.set(item.id, item);
            render();
          },
        }, `${item.icon || ''} ${item.name || item.id}`.trim()));
      });
    }

    render();

    return {
      node: wrap,
      getSelected: () => Array.from(selected.values()),
      setSelected: (list = []) => {
        selected.clear();
        list.forEach((entry) => {
          const id = typeof entry === 'string' ? entry : entry?.id;
          if (!id) return;
          const found = itemsFn().find((x) => x.id === id);
          if (found) selected.set(id, found);
        });
        render();
      },
      refresh: render,
    };
  }

  /** 账号 ID 输入建议列表 */
  function accountOptions() {
    return state.accounts
      .map((acc) => {
        const inner = accountInner(acc);
        if (!inner.id) return null;
        return el('option', {
          value: inner.id,
          label: `${inner.nickname || inner.username || '未命名'}（${inner.id}）`,
        });
      })
      .filter(Boolean);
  }

  function accountIdInput(placeholder) {
    return el('input', {
      class: 'admin-input',
      type: 'text',
      placeholder,
      list: 'admin-account-options',
      autocomplete: 'off',
    });
  }

  /** 账号列表推送后刷新输入建议（不重建表单，避免覆盖已输入内容） */
  function syncAccountOptions() {
    const list = content.querySelector('#admin-account-options');
    if (!list) return;
    list.innerHTML = '';
    accountOptions().forEach((option) => list.append(option));
  }

  const MAIL_STATE_TEXT = {
    active: '可领取',
    claimed: '已领取',
    pending: '未生效',
    expired: '已过期',
    revoked: '已撤回',
    unsent: '未发送',
  };

  const MAIL_STATE_VARIANT = {
    active: 'success',
    claimed: 'info',
    pending: 'warning',
    expired: 'danger',
    revoked: 'danger',
    unsent: 'info',
  };

  /** 邮件有效期文案（start 用于把早于送达时间的生效时间归一到实际送达时刻） */
  function mailValidityText(mail, startOverride = 0) {
    const from = Math.max(Number(mail.validFrom) || 0, Number(startOverride) || 0);
    const until = Number(mail.validUntil) || 0;
    if (!until) return `${from ? formatTime(from) : '立即'} 起长期有效`;
    return `${formatTime(from)} 至 ${formatTime(until)}`;
  }

  /** 领取条件文案 */
  function mailConditionsText(conditions) {
    const c = conditions || {};
    const parts = [];
    if (c.minLevel) parts.push(`等级 ≥ ${c.minLevel}`);
    if (c.minTotalGames) parts.push(`总对局 ≥ ${c.minTotalGames}`);
    Object.entries(c.minGames || {}).forEach(([type, count]) => {
      parts.push(`${GAME_TYPE_NAMES[type] || type} ≥ ${count} 局`);
    });
    if (Array.isArray(c.achievements) && c.achievements.length) {
      parts.push(`需解锁 ${c.achievements.length} 项成就`);
    }
    return parts.length ? parts.join('、') : '无';
  }

  // ===== 邮件与物品 =====
  function renderMail() {
    content.innerHTML = '';
    refs.overview = null;
    refs.accounts = null;
    refs.games = null;
    refs.feedback = null;
    state.pickerRefreshers.clear();

    const datalist = el('datalist', { id: 'admin-account-options' }, accountOptions());

    // ---- 模板 ----
    const templateSelect = el('select', { class: 'admin-select' }, [
      el('option', { value: '' }, '选择邮件模板…'),
    ]);

    // ---- 发送邮件 ----
    const mailUserInput = accountIdInput('收件人账号 ID（可从列表选择）');
    const titleInput = el('input', {
      class: 'admin-input',
      type: 'text',
      placeholder: '邮件标题（必填）',
      maxlength: '60',
    });
    const contentInput = el('textarea', {
      class: 'admin-input admin-textarea',
      rows: '4',
      placeholder: '邮件正文（可选）',
    });
    const FROM_CUSTOM = '__custom__';
    const fromSelect = el('select', { class: 'admin-select', style: { flex: '1' } }, [
      el('option', { value: '管理员' }, '管理员'),
      el('option', { value: '系统' }, '系统'),
      el('option', { value: FROM_CUSTOM }, '自定义…'),
    ]);
    const fromCustomInput = el('input', {
      class: 'admin-input',
      type: 'text',
      maxlength: '20',
      placeholder: '输入自定义发送人（留空按「管理员」发送）',
      style: { display: 'none', flex: '1' },
    });
    const syncFromCustom = () => {
      const isCustom = fromSelect.value === FROM_CUSTOM;
      fromCustomInput.style.display = isCustom ? '' : 'none';
    };
    fromSelect.addEventListener('change', () => {
      syncFromCustom();
      if (fromSelect.value === FROM_CUSTOM) fromCustomInput.focus();
    });
    /** 读取发送人：预设直接取值，自定义取输入框，留空回退「管理员」 */
    const getMailFrom = () => {
      const value = (fromSelect.value || '').trim();
      if (value && value !== FROM_CUSTOM) return value;
      return fromCustomInput.value.trim() || '管理员';
    };
    /** 回填发送人（预设命中则选中，否则落到「自定义…」） */
    const setMailFrom = (value) => {
      const v = (value || '管理员').toString();
      const isPreset = Array.from(fromSelect.options).some((opt) => opt.value === v);
      fromSelect.value = isPreset ? v : FROM_CUSTOM;
      fromCustomInput.value = isPreset ? '' : v;
      syncFromCustom();
    };
    const starCoinsInput = el('input', {
      class: 'admin-input admin-input--number',
      type: 'number',
      min: '0',
      value: '0',
      title: '星钻数量',
    });
    const expInput = el('input', {
      class: 'admin-input admin-input--number',
      type: 'number',
      min: '0',
      value: '0',
      title: '经验值',
    });
    const slotsInput = el('input', {
      class: 'admin-input admin-input--number',
      type: 'number',
      min: '0',
      value: '0',
      title: '头像槽位',
    });
    const vipSelect = el('select', { class: 'admin-select' }, [el('option', { value: '' }, '无会员')]);
    const mailPicker = buildItemPicker();
    const cosmeticPicker = buildChipPicker(() => state.cosmetics, { emptyText: '正在加载外观列表…' });
    const achPicker = buildChipPicker(() => state.achievements, { emptyText: '正在加载成就列表…' });

    // ---- 有效期 / 条件 / 定时 ----
    const validFromInput = el('input', { class: 'admin-input', type: 'datetime-local' });
    const durationInput = el('input', {
      class: 'admin-input admin-input--number',
      type: 'number',
      min: '0',
      step: '0.5',
      value: '0',
      title: '持续时长（小时），0 表示长期有效',
    });
    const scheduledInput = el('input', { class: 'admin-input', type: 'datetime-local' });
    const timingHint = el('div', { class: 'admin-picker__hint' });

    const minLevelInput = el('input', { class: 'admin-input admin-input--number', type: 'number', min: '0', value: '0' });
    const minTotalInput = el('input', { class: 'admin-input admin-input--number', type: 'number', min: '0', value: '0' });
    const gameInputs = {};
    const gameFields = Object.keys(GAME_TYPE_NAMES).map((type) => {
      const input = el('input', { class: 'admin-input admin-input--number', type: 'number', min: '0', value: '0' });
      gameInputs[type] = input;
      return el('label', { class: 'admin-field' }, [
        el('span', { class: 'admin-field__label' }, `${GAME_TYPE_NAMES[type]}局数`),
        input,
      ]);
    });

    const collectMailPayload = () => {
      const minGames = {};
      Object.entries(gameInputs).forEach(([type, input]) => {
        const n = Math.max(0, parseInt(input.value, 10) || 0);
        if (n > 0) minGames[type] = n;
      });

      const conditions = {};
      const minLevel = Math.max(0, parseInt(minLevelInput.value, 10) || 0);
      const minTotalGames = Math.max(0, parseInt(minTotalInput.value, 10) || 0);
      if (minLevel) conditions.minLevel = minLevel;
      if (minTotalGames) conditions.minTotalGames = minTotalGames;
      if (Object.keys(minGames).length) conditions.minGames = minGames;
      const achievements = achPicker.getSelected().map((a) => String(a.id));
      if (achievements.length) conditions.achievements = achievements;

      const durationHours = Math.max(0, parseFloat(durationInput.value) || 0);
      const vipValue = vipSelect.value;
      let vip = null;
      if (vipValue) {
        const [days, expBonus] = vipValue.split(':').map(Number);
        vip = { days, expBonus };
      }

      return {
        title: titleInput.value.trim(),
        content: contentInput.value.trim(),
        items: mailPicker.getItems(),
        cosmetics: cosmeticPicker.getSelected().map((c) => ({ id: c.id, category: c.category })),
        vip,
        slots: Math.max(0, parseInt(slotsInput.value, 10) || 0),
        starCoins: Math.max(0, parseInt(starCoinsInput.value, 10) || 0),
        exp: Math.max(0, parseInt(expInput.value, 10) || 0),
        from: getMailFrom(),
        validFrom: validFromInput.value ? new Date(validFromInput.value).getTime() : 0,
        durationMinutes: Math.round(durationHours * 60),
        conditions: Object.keys(conditions).length ? conditions : null,
        scheduledAt: scheduledInput.value ? new Date(scheduledInput.value).getTime() : 0,
      };
    };

    /** 邮件实际送达时间：取「定时发送」与「生效时间」中较晚者 */
    const resolveDeliverAt = (payload) => Math.max(Number(payload.scheduledAt) || 0, Number(payload.validFrom) || 0);

    /** 刷新「送达时间 / 有效期」提示，避免定时与生效时间填串 */
    const refreshTimingHint = () => {
      const payload = collectMailPayload();
      const deliverAt = resolveDeliverAt(payload);
      const deferred = deliverAt > Date.now() + 5000;
      const delayedByValidFrom = (Number(payload.validFrom) || 0) > (Number(payload.scheduledAt) || 0);
      let text;
      if (!deferred) {
        text = '立即送达，送达后玩家即可领取';
      } else {
        text = `将于 ${formatTime(deliverAt)} 送达${delayedByValidFrom ? '（生效时间晚于发送时间，投递顺延至生效时间）' : ''}`;
      }
      if (payload.durationMinutes > 0) {
        const start = deferred ? deliverAt : Date.now();
        text += `；有效期至 ${formatTime(start + payload.durationMinutes * 60 * 1000)}`;
      } else {
        text += '；长期有效';
      }
      timingHint.textContent = text;
    };
    [validFromInput, scheduledInput, durationInput].forEach((input) => {
      input.addEventListener('input', refreshTimingHint);
      input.addEventListener('change', refreshTimingHint);
    });

    const sendMail = () => {
      const userId = mailUserInput.value.trim();
      if (!userId) { toast.warn('请输入收件人账号 ID'); return; }
      const payload = collectMailPayload();
      if (!payload.title) { toast.warn('请输入邮件标题'); return; }
      emitAdmin('send_mail_to_user', { ...payload, userId });
    };

    const sendMailAll = () => {
      const payload = collectMailPayload();
      if (!payload.title) { toast.warn('请输入邮件标题'); return; }
      const deliverAt = resolveDeliverAt(payload);
      const timed = deliverAt > Date.now() + 5000;
      modal.show({
        title: timed ? '确认定时发送全服邮件' : '确认发送全服邮件',
        content: timed
          ? `将在 ${formatTime(deliverAt)} 向所有账号发送「${payload.title}」，确定继续吗？`
          : `将向所有账号发送「${payload.title}」，该操作不可撤销，确定继续吗？`,
        confirmText: timed ? '确认安排' : '确认发送',
        onConfirm: () => emitAdmin('send_mail_all', payload),
      });
    };

    // ---- 模板操作 ----
    renderTemplateOptions = function () {
      const current = templateSelect.value;
      templateSelect.innerHTML = '';
      templateSelect.append(el('option', { value: '' }, '选择邮件模板…'));
      state.mailTemplates.forEach((t) => {
        templateSelect.append(el('option', { value: t.id }, t.name));
      });
      templateSelect.value = current;
    };

    const applyTemplate = () => {
      const tpl = state.mailTemplates.find((t) => t.id === templateSelect.value);
      if (!tpl) { toast.warn('请选择模板'); return; }
      const m = tpl.mailData || {};
      const c = m.conditions || {};
      titleInput.value = m.title || '';
      contentInput.value = m.content || '';
      setMailFrom(m.from || '管理员');
      starCoinsInput.value = String(m.starCoins || 0);
      expInput.value = String(m.exp || 0);
      slotsInput.value = String(m.slots || 0);
      durationInput.value = m.durationMinutes ? String(Math.round((m.durationMinutes / 60) * 10) / 10) : '0';
      minLevelInput.value = String(c.minLevel || 0);
      minTotalInput.value = String(c.minTotalGames || 0);
      Object.entries(gameInputs).forEach(([type, input]) => {
        input.value = String(c.minGames?.[type] || 0);
      });
      achPicker.setSelected(c.achievements || []);
      cosmeticPicker.setSelected(m.cosmetics || []);
      mailPicker.setItems(m.items || []);
      vipSelect.value = m.vip?.days ? `${m.vip.days}:${m.vip.expBonus || 0}` : '';
      toast.success('模板已套用');
    };

    const saveTemplate = () => {
      const nameInput = el('input', { class: 'admin-input', type: 'text', placeholder: '模板名称（必填）', maxlength: '40' });
      modal.show({
        title: '保存为邮件模板',
        content: el('div', { class: 'admin-form' }, [nameInput]),
        confirmText: '保存',
        onConfirm: () => {
          const name = nameInput.value.trim();
          if (!name) { toast.warn('请输入模板名称'); return; }
          emitAdmin('save_mail_template', { name, mailData: collectMailPayload() });
        },
      });
    };

    const deleteTemplate = () => {
      const tpl = state.mailTemplates.find((t) => t.id === templateSelect.value);
      if (!tpl) { toast.warn('请选择要删除的模板'); return; }
      modal.show({
        title: '删除邮件模板',
        content: `确定删除模板「${tpl.name}」吗？`,
        confirmText: '删除',
        onConfirm: () => emitAdmin('delete_mail_template', { id: tpl.id }),
      });
    };

    // ---- 邮件管理 ----
    const manageUserInput = accountIdInput('输入账号 ID 查询其邮件');
    const userMailList = el('div', { class: 'admin-list', 'data-user-mails': '' });
    const scheduledList = el('div', { class: 'admin-list', 'data-scheduled-mails': '' });

    const queryUserMails = () => {
      const userId = manageUserInput.value.trim();
      if (!userId) { toast.warn('请输入账号 ID'); return; }
      state.userMailsLoaded = false;
      state.userMailsUserId = userId;
      emitAdmin('get_user_mails', { id: userId });
    };

    const revokeMail = (mail) => {
      modal.show({
        title: '撤回邮件',
        content: `确定撤回「${mail.title || '无标题'}」吗？玩家将无法再领取该邮件。`,
        confirmText: '撤回',
        onConfirm: () => emitAdmin('revoke_mail', { userId: state.userMailsUserId, mailId: mail.id }),
      });
    };

    const deleteMail = (mail) => {
      modal.show({
        title: '删除邮件',
        content: `确定删除「${mail.title || '无标题'}」吗？记录将从玩家邮箱移除。`,
        confirmText: '删除',
        onConfirm: () => emitAdmin('delete_mail', { userId: state.userMailsUserId, mailId: mail.id }),
      });
    };

    renderUserMails = function () {
      if (!refs.mail?.userMailList) return;
      userMailList.innerHTML = '';
      if (!state.userMailsLoaded) {
        userMailList.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
          el('div', { class: 'admin-empty__desc' }, '正在查询邮件…'),
        ]));
        return;
      }
      if (!state.userMails.length) {
        userMailList.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
          el('div', { class: 'admin-empty__desc' }, '该账号没有邮件'),
        ]));
        return;
      }
      state.userMails.forEach((mail) => {
        const stateText = MAIL_STATE_TEXT[mail.state] || '未知';
        const variant = MAIL_STATE_VARIANT[mail.state] || 'info';
        const canRevoke = !mail.claimed && !mail.revoked;
        userMailList.append(el('div', { class: 'admin-mail-row' }, [
          el('div', { class: 'admin-mail-row__main' }, [
            el('div', { class: 'admin-mail-row__title' }, [
              badge(stateText, variant),
              el('span', {}, mail.title || '无标题'),
            ]),
            el('div', { class: 'admin-mail-row__meta' }, [
              `送达时间：${formatTime(mail.scheduledAt || mail.createdAt)}`,
              el('br'),
              `有效期：${mailValidityText(mail, mail.scheduledAt || mail.createdAt)}`,
              el('br'),
              `领取条件：${mailConditionsText(mail.conditions)}`,
              el('br'),
              `创建于 ${formatTime(mail.createdAt)}${mail.claimedAt ? ` · 领取于 ${formatTime(mail.claimedAt)}` : ''}`,
            ]),
          ]),
          el('div', { class: 'admin-mail-row__actions' }, [
            canRevoke ? el('button', {
              class: 'admin-btn admin-btn--sm admin-btn--warning',
              type: 'button',
              onClick: () => revokeMail(mail),
            }, '撤回') : null,
            el('button', {
              class: 'admin-btn admin-btn--sm admin-btn--danger',
              type: 'button',
              onClick: () => deleteMail(mail),
            }, '删除'),
          ]),
        ]));
      });
    };

    renderScheduledJobs = function () {
      if (!refs.mail?.scheduledList) return;
      scheduledList.innerHTML = '';
      if (!state.scheduledLoaded) {
        scheduledList.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
          el('div', { class: 'admin-empty__desc' }, '正在加载定时队列…'),
        ]));
        return;
      }
      if (!state.scheduledJobs.length) {
        scheduledList.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
          el('div', { class: 'admin-empty__desc' }, '当前没有待发送的定时邮件'),
        ]));
        return;
      }
      state.scheduledJobs.forEach((job) => {
        const targetText = job.target?.type === 'all'
          ? '全服'
          : job.target?.type === 'users'
            ? `${job.target.userIds?.length || 0} 个账号`
            : job.target?.userId || '未知';
        scheduledList.append(el('div', { class: 'admin-mail-row' }, [
          el('div', { class: 'admin-mail-row__main' }, [
            el('div', { class: 'admin-mail-row__title' }, [
              badge('定时', 'warning'),
              el('span', {}, job.mailData?.title || '无标题'),
            ]),
            el('div', { class: 'admin-mail-row__meta' }, [
              `发送时间：${formatTime(job.scheduledAt)}`,
              el('br'),
              `收件人：${targetText}`,
              el('br'),
              `有效期：${mailValidityText(job.mailData || {}, job.scheduledAt)} · 条件：${mailConditionsText(job.mailData?.conditions)}`,
            ]),
          ]),
          el('div', { class: 'admin-mail-row__actions' }, [
            el('button', {
              class: 'admin-btn admin-btn--sm admin-btn--danger',
              type: 'button',
              onClick: () => {
                modal.show({
                  title: '取消定时邮件',
                  content: `确定取消「${job.mailData?.title || '无标题'}」的定时发送吗？`,
                  confirmText: '取消任务',
                  onConfirm: () => emitAdmin('cancel_scheduled_mail', { jobId: job.id }),
                });
              },
            }, '取消'),
          ]),
        ]));
      });
    };

    refs.mail = { userMailList, scheduledList, vipSelect };
    state.pickerRefreshers.add(cosmeticPicker.refresh);
    state.pickerRefreshers.add(achPicker.refresh);

    // ---- 发放物品 ----
    const grantUserInput = accountIdInput('收件人账号 ID（可从列表选择）');
    const grantPicker = buildItemPicker();

    const grantItems = () => {
      const userId = grantUserInput.value.trim();
      if (!userId) { toast.warn('请输入收件人账号 ID'); return; }
      const items = grantPicker.getItems();
      if (!items.length) { toast.warn('请选择要发放的物品'); return; }
      emitAdmin('grant_items', { id: userId, items });
    };

    content.append(
      datalist,
      section('发送邮件', '支持有效期、领取条件、定时发送、模板与完整附件类型', [
        el('div', { class: 'admin-form' }, [
          el('div', { class: 'admin-form-row' }, [templateSelect]),
          el('div', { class: 'admin-form-row admin-form-row--wrap' }, [
            el('button', { class: 'admin-btn admin-btn--sm', type: 'button', onClick: applyTemplate }, '套用模板'),
            el('button', { class: 'admin-btn admin-btn--sm', type: 'button', onClick: saveTemplate }, '保存为模板'),
            el('button', { class: 'admin-btn admin-btn--sm admin-btn--danger', type: 'button', onClick: deleteTemplate }, '删除模板'),
          ]),
          el('div', { class: 'admin-form-row' }, [mailUserInput]),
          titleInput,
          contentInput,
          el('div', { class: 'admin-field', style: { flexDirection: 'column', alignItems: 'stretch', gap: '6px' } }, [
            el('span', { class: 'admin-field__label' }, '发送人'),
            el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, [fromSelect, fromCustomInput]),
          ]),
          el('div', { class: 'admin-form-row admin-form-row--wrap' }, [
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '星钻'),
              starCoinsInput,
            ]),
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '经验'),
              expInput,
            ]),
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '头像槽位'),
              slotsInput,
            ]),
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '会员'),
              vipSelect,
            ]),
          ]),
          el('div', { class: 'admin-picker__label' }, '外观附件（可多选）'),
          cosmeticPicker.node,
          mailPicker.node,
          el('div', { class: 'admin-picker__label' }, '有效期'),
          el('div', { class: 'admin-form-row admin-form-row--wrap' }, [
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '生效时间（留空为随邮件送达）'),
              validFromInput,
            ]),
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '持续时长（小时，0=长期）'),
              durationInput,
            ]),
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '定时发送（留空为立即）'),
              scheduledInput,
            ]),
          ]),
          timingHint,
          el('div', { class: 'admin-picker__label' }, '领取条件（留空表示无门槛）'),
          el('div', { class: 'admin-form-row admin-form-row--wrap' }, [
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '最低等级'),
              minLevelInput,
            ]),
            el('label', { class: 'admin-field' }, [
              el('span', { class: 'admin-field__label' }, '最低总对局'),
              minTotalInput,
            ]),
            ...gameFields,
          ]),
          el('div', { class: 'admin-picker__label' }, '需要的成就（可多选）'),
          achPicker.node,
          el('div', { class: 'admin-form-actions' }, [
            el('button', {
              class: 'admin-btn admin-btn--primary',
              type: 'button',
              onClick: sendMail,
            }, '发送邮件'),
            el('button', {
              class: 'admin-btn admin-btn--warning',
              type: 'button',
              onClick: sendMailAll,
            }, '发送全服邮件'),
          ]),
        ]),
      ]),
      section('邮件管理', '按账号查看全部邮件，支持撤回与删除', [
        el('div', { class: 'admin-form' }, [
          el('div', { class: 'admin-form-row' }, [manageUserInput]),
          el('div', { class: 'admin-form-actions' }, [
            el('button', { class: 'admin-btn admin-btn--primary', type: 'button', onClick: queryUserMails }, '查询邮件'),
            el('button', {
              class: 'admin-btn admin-btn--ghost',
              type: 'button',
              onClick: () => { state.scheduledLoaded = false; emitAdmin('get_scheduled_mails'); },
            }, '刷新定时队列'),
          ]),
          userMailList,
        ]),
      ]),
      section('定时队列', '到达设定时间后由服务端自动投递', [scheduledList]),
      section('发放物品', '物品会直接进入目标账号背包', [
        el('div', { class: 'admin-form' }, [
          el('div', { class: 'admin-form-row' }, [grantUserInput]),
          grantPicker.node,
          el('div', { class: 'admin-form-actions' }, [
            el('button', {
              class: 'admin-btn admin-btn--success',
              type: 'button',
              onClick: grantItems,
            }, '发放物品'),
          ]),
        ]),
      ]),
    );

    renderTemplateOptions();
    renderUserMails();
    renderScheduledJobs();
    refreshMailSelectors();
    refreshTimingHint();
    ensureItemsLoaded();

    // 成就 / 外观列表可能还没加载，进入 Tab 时补拉
    if (!state.achievements.length && session?.socket) session.socket.emit('get_achievements_list');
  }

  /** 物品 / 外观 / 会员下拉刷新（数据到达后调用） */
  function refreshMailSelectors() {
    if (!refs.mail) return;
    const { vipSelect } = refs.mail;
    if (vipSelect) {
      const current = vipSelect.value;
      vipSelect.innerHTML = '';
      vipSelect.append(el('option', { value: '' }, '无会员'));
      state.vipOptions.forEach((pkg) => {
        vipSelect.append(el('option', {
          value: `${pkg.days}:${pkg.expBonus || 0}`,
        }, `${pkg.name || `${pkg.days}天会员`}`));
      });
      vipSelect.value = current;
    }
    state.pickerRefreshers.forEach((fn) => fn());
  }

  // ===== 对局 =====
  function renderGames() {
    content.innerHTML = '';
    refs.overview = null;
    refs.accounts = null;
    refs.feedback = null;

    const activeList = el('div', { class: 'admin-list', 'data-active-games': '' });
    const historyList = el('div', { class: 'admin-list', 'data-history-games': '' });

    content.append(
      section('进行中对局', '可强制结束异常对局', activeList),
      section('最近对局', '服务端保存的已完成对局记录', historyList),
    );

    refs.games = { activeList, historyList };
    renderActiveGames();
    renderHistory();
  }

  function renderActiveGames() {
    if (!refs.games) return;
    const list = refs.games.activeList;
    list.innerHTML = '';
    if (!state.activeGames.length) {
      list.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
        el('div', { class: 'admin-empty__desc' }, '当前没有进行中的对局'),
      ]));
      return;
    }

    state.activeGames.forEach((g) => {
      const p1 = g.player1Nickname || g.player1 || '玩家1';
      const p2 = g.player2Nickname || g.player2 || '玩家2';
      list.append(el('div', { class: 'admin-game-row' }, [
        el('div', { class: 'admin-game-row__main' }, [
          el('div', { class: 'admin-game-row__title' }, [
            el('span', { class: 'admin-game-type' }, GAME_TYPE_NAMES[g.gameType] || g.gameType || '对局'),
            el('span', {}, `${p1} vs ${p2}`),
            g.isAIGame ? badge('AI', 'info') : null,
          ]),
          el('div', { class: 'admin-game-row__meta' },
            `对局 ID ${g.gameId} · 已走 ${g.moveCount || 0} 步 · 开始于 ${formatTime(g.startTime)}`),
        ]),
        el('button', {
          class: 'admin-btn admin-btn--sm admin-btn--danger',
          type: 'button',
          onClick: () => {
            modal.show({
              title: '强制结束对局',
              content: `确定结束「${p1} vs ${p2}」这局对局吗？操作不可撤销。`,
              confirmText: '结束对局',
              onConfirm: () => emitAdmin('end_game', { gameId: g.gameId }),
            });
          },
        }, '强制结束'),
      ]));
    });
  }

  function renderHistory() {
    if (!refs.games) return;
    const list = refs.games.historyList;
    list.innerHTML = '';
    if (!state.historyLoaded) {
      list.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
        el('div', { class: 'admin-empty__desc' }, '正在加载最近对局…'),
      ]));
      return;
    }
    if (!state.history.length) {
      list.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
        el('div', { class: 'admin-empty__desc' }, '暂无对局记录'),
      ]));
      return;
    }

    state.history.forEach((g) => {
      const p1 = g.player1Nickname || g.player1 || '玩家1';
      const p2 = g.player2Nickname || g.player2 || '玩家2';
      list.append(el('div', { class: 'admin-game-row' }, [
        el('div', { class: 'admin-game-row__main' }, [
          el('div', { class: 'admin-game-row__title' }, [
            el('span', { class: 'admin-game-type' }, GAME_TYPE_NAMES[g.gameType] || g.gameType || '对局'),
            el('span', {}, `${p1} vs ${p2}`),
            el('span', { class: 'admin-game-result' }, gameResultText(g)),
          ]),
          el('div', { class: 'admin-game-row__meta' },
            `结束于 ${formatTime(g.endTime)} · 用时 ${formatDuration(g.duration)} · ${g.gameId}`),
        ]),
      ]));
    });
  }

  // ===== 反馈 =====
  function renderFeedback() {
    content.innerHTML = '';
    refs.overview = null;
    refs.accounts = null;
    refs.games = null;

    const filterSelect = el('select', { class: 'admin-select' }, [
      el('option', { value: 'all' }, '全部反馈'),
      el('option', { value: 'pending' }, '待处理'),
      el('option', { value: 'processing' }, '处理中'),
      el('option', { value: 'resolved' }, '已解决'),
      el('option', { value: 'closed' }, '已关闭'),
    ]);
    const list = el('div', { class: 'admin-list', 'data-feedback-list': '' });
    filterSelect.addEventListener('change', () => renderFeedbackBody());

    content.append(section('玩家反馈', '修改状态后会实时通知提交者', [
      el('div', { class: 'admin-toolbar' }, [filterSelect]),
      list,
    ]));

    refs.feedback = { filterSelect, list };
    if (!state.feedbackLoaded) loadFeedbacks();
    else renderFeedbackBody();
  }

  async function loadFeedbacks() {
    if (!session) {
      toast.warn('后台尚未连接');
      return;
    }
    state.feedbackLoading = true;
    if (refs.feedback) {
      refs.feedback.list.innerHTML = '';
      refs.feedback.list.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
        el('div', { class: 'admin-empty__desc' }, '正在加载反馈…'),
      ]));
    }
    try {
      const res = await adminFetch('/api/feedbacks', {}, session.token);
      state.feedbacks = Array.isArray(res?.data) ? res.data : [];
      state.feedbackLoaded = true;
      updateCounts();
    } catch (err) {
      toast.error(`加载反馈失败：${err.message}`);
      state.feedbacks = [];
    } finally {
      state.feedbackLoading = false;
      if (state.tab === 'feedback') renderFeedbackBody();
    }
  }

  function renderFeedbackBody() {
    if (!refs.feedback) return;
    const { filterSelect, list } = refs.feedback;
    const filter = filterSelect.value;
    const rows = state.feedbacks.filter((f) => filter === 'all' || f.status === filter);

    list.innerHTML = '';
    if (!rows.length) {
      list.append(el('div', { class: 'admin-empty admin-empty--inline' }, [
        el('div', { class: 'admin-empty__icon' }, '📭'),
        el('div', { class: 'admin-empty__desc' }, state.feedbackLoading ? '正在加载反馈…' : '没有符合条件的反馈'),
      ]));
      return;
    }

    rows.forEach((fb) => {
      const statusSelect = el('select', {
        class: 'admin-select admin-select--sm',
        onChange: (e) => changeFeedbackStatus(fb.id, e.target.value, statusSelect),
      }, Object.entries(FEEDBACK_STATUS).map(([value, label]) => el('option', {
        value,
        selected: fb.status === value,
      }, label)));

      const votes = Array.isArray(fb.votes) ? fb.votes.length : 0;
      const comments = Array.isArray(fb.comments) ? fb.comments.length : 0;

      list.append(el('div', { class: 'admin-feedback' }, [
        el('div', { class: 'admin-feedback__head' }, [
          el('div', { class: 'admin-feedback__title' }, [
            el('span', { class: `admin-badge admin-badge--type-${fb.type || 'other'}` },
              FEEDBACK_TYPE_NAMES[fb.type] || '反馈'),
            el('span', { class: 'admin-feedback__name' }, fb.title || '（无标题）'),
          ]),
          statusSelect,
        ]),
        el('div', { class: 'admin-feedback__content' }, fb.content || ''),
        el('div', { class: 'admin-feedback__meta' },
          `${fb.nickname || fb.accountId || '匿名'} · ${formatTime(fb.createdAt)} · 👍 ${votes} · 💬 ${comments}`),
      ]));
    });
  }

  async function changeFeedbackStatus(id, status, selectEl) {
    if (!session?.token) {
      toast.warn('后台登录凭证缺失，请刷新页面重试');
      return;
    }
    selectEl.disabled = true;
    try {
      const res = await adminFetch(`/api/feedbacks/${encodeURIComponent(id)}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }, session.token);
      const fb = state.feedbacks.find((item) => item.id === id);
      if (fb) fb.status = res?.feedback?.status || status;
      toast.success('反馈状态已更新');
      updateCounts();
      renderFeedbackBody();
    } catch (err) {
      toast.error(`更新失败：${err.message}`);
      renderFeedbackBody();
    }
  }

  // ===== 系统更新（Git 自动更新） =====
  function renderUpdate() {
    content.innerHTML = '';
    refs.overview = null;
    refs.accounts = null;
    refs.games = null;
    refs.feedback = null;

    const badgeEl = el('span', { class: 'admin-badge admin-badge--info' }, '未检查');
    const localVersionEl = el('span', { class: 'admin-stat__value' }, '—');
    const remoteVersionEl = el('span', { class: 'admin-stat__value' }, '—');
    const commitHint = el('div', { class: 'admin-list-hint' }, '尚未检查');
    const detailEl = el('div', { class: 'admin-list-hint' });
    const messageEl = el('div', { class: 'admin-list-hint' }, '点击「检查更新」获取 Git 仓库最新提交');

    const checkBtn = el('button', {
      class: 'admin-btn admin-btn--ghost',
      type: 'button',
      onClick: () => checkGitUpdate(true),
    }, '🔍 检查更新');
    const applyBtn = el('button', {
      class: 'admin-btn admin-btn--success',
      type: 'button',
      disabled: true,
      onClick: () => applyGitUpdate(),
    }, '⚡ 一键更新');

    const statusTitle = el('div', { class: 'admin-maintenance-state' }, '当前没有进行中的更新');
    const statusMsg = el('div', { class: 'admin-list-hint' });
    const progressFill = el('div', {
      style: { height: '100%', width: '0%', background: 'var(--theme-primary, #6366f1)', transition: 'width 0.3s' },
    });
    const logList = el('div', { class: 'admin-list' });

    const versionCard = (label, valueEl) => el('div', { class: 'admin-stat' }, [
      el('span', { class: 'admin-stat__label' }, label),
      valueEl,
    ]);

    content.append(
      section('Git 自动更新', '从远端仓库获取最新提交，自动生成更新包，并沿用现有的备份、重启与回滚流程', [
        el('div', { class: 'admin-toolbar' }, [badgeEl, checkBtn, applyBtn]),
        el('div', { class: 'admin-stat-grid' }, [
          versionCard('当前部署版本', localVersionEl),
          versionCard('远端最新版本', remoteVersionEl),
        ]),
        commitHint,
        detailEl,
        messageEl,
      ]),
      section('更新状态', '实时阶段与日志；更新完成后服务会自动重启，页面会自动重连', [
        statusTitle,
        statusMsg,
        el('div', {
          style: {
            height: '6px',
            borderRadius: '3px',
            background: 'rgba(148, 163, 184, 0.25)',
            overflow: 'hidden',
            margin: '8px 0',
          },
        }, [progressFill]),
        logList,
      ]),
    );

    refs.update = {
      badgeEl, localVersionEl, remoteVersionEl, commitHint, detailEl, messageEl,
      checkBtn, applyBtn, statusTitle, statusMsg, progressFill, logList,
    };

    state.updateLogs.slice(-30).forEach((entry) => appendUpdateLog(entry));
    syncUpdateStatus();
    if (state.gitInfo) renderGitInfo(state.gitInfo);

    if (state.ready) {
      loadUpdateStatus();
      checkGitUpdate(false);
    }
  }

  function setGitApplyEnabled(enabled) {
    if (!refs.update) return;
    refs.update.applyBtn.disabled = !enabled;
    refs.update.applyBtn.style.opacity = enabled ? '1' : '0.5';
    refs.update.applyBtn.style.cursor = enabled ? 'pointer' : 'not-allowed';
  }

  function renderGitInfo(data) {
    if (!refs.update || !data) return;
    const r = refs.update;
    const local = data.local || {};
    const remote = data.remote || {};

    r.localVersionEl.textContent = local.version || '—';
    r.remoteVersionEl.textContent = remote.version || '—';

    const behind = (data.behind === null || data.behind === undefined) ? '' : `（落后 ${data.behind} 个提交）`;
    r.commitHint.textContent = `已部署 ${local.appliedCommit || local.head || '—'} · 远端 ${remote.shortCommit || '—'}${behind}`;
    r.detailEl.textContent = remote.message
      ? `${remote.message} · ${remote.author || '未知作者'} · ${formatTime(remote.date)}`
      : '';

    const isPkg = data.mode === 'pkg';
    r.badgeEl.className = `admin-badge ${isPkg ? 'admin-badge--warning' : (data.updateAvailable ? 'admin-badge--info' : 'admin-badge--online')}`;
    r.badgeEl.textContent = isPkg ? '不可用（EXE 模式）' : (data.updateAvailable ? '有可用更新' : '已是最新');
    r.messageEl.textContent = isPkg
      ? '当前为 EXE 打包运行，Git 自动更新不可用，请改用旧版后台上传更新包。'
      : (data.reason || '');

    setGitApplyEnabled(!isPkg && !!data.updateAvailable);
  }

  async function checkGitUpdate(force) {
    if (!refs.update || !session?.token || state.gitChecking) return;
    state.gitChecking = true;
    const r = refs.update;
    r.checkBtn.disabled = true;
    r.checkBtn.textContent = '⏳ 检查中…';
    try {
      const data = await adminFetch(`/api/update/git/check${force ? '?force=1' : ''}`, {}, session.token);
      state.gitInfo = data;
      renderGitInfo(data);
    } catch (err) {
      r.badgeEl.className = 'admin-badge admin-badge--danger';
      r.badgeEl.textContent = '检查失败';
      r.messageEl.textContent = err.message;
      setGitApplyEnabled(false);
    } finally {
      state.gitChecking = false;
      if (refs.update) {
        r.checkBtn.disabled = false;
        r.checkBtn.textContent = '🔍 检查更新';
      }
    }
  }

  function applyGitUpdate() {
    const info = state.gitInfo;
    if (!info?.remote || !session?.token) return;
    const target = `版本 ${info.remote.version}（提交 ${info.remote.shortCommit}）`;
    modal.show({
      title: '确认自动更新',
      content: `确定更新到 ${target}？更新会先自动备份，再应用文件并重启服务，在线玩家会被短暂断开。`,
      confirmText: '开始更新',
      onConfirm: async () => {
        try {
          const res = await adminFetch('/api/update/git/apply', { method: 'POST' }, session.token);
          toast.success(`已开始更新到 ${res.version}（${res.shortCommit}）`);
          setGitApplyEnabled(false);
        } catch (err) {
          toast.error(`启动更新失败：${err.message}`);
        }
      },
    });
  }

  async function loadUpdateStatus() {
    if (!session?.token) return;
    try {
      const res = await adminFetch('/api/update/status', {}, session.token);
      state.updateSnapshot = res?.status || null;
      syncUpdateStatus();
    } catch { /* 状态拉取失败不影响更新操作 */ }
  }

  function syncUpdateStatus() {
    if (!refs.update) return;
    const r = refs.update;
    const st = state.updateStatus;
    const snap = state.updateSnapshot;

    if (st && st.status && st.status !== 'idle') {
      const labels = {
        in_progress: '更新进行中',
        rolling_back: '回滚中',
        rolled_back: '已回滚',
        rollback_failed: '回滚失败',
        success: '更新成功',
        failed: '更新失败',
      };
      const label = labels[st.status] || st.status;
      const phase = st.currentPhase ? ` · ${st.currentPhase}` : '';
      const phaseProgress = st.phases && st.currentPhase && st.phases[st.currentPhase]
        ? Number(st.phases[st.currentPhase].progress) || 0
        : 0;
      const pct = Math.min(100, Math.max(0, Math.round(phaseProgress)));
      r.statusTitle.textContent = `${label}${phase}${pct ? ` · ${pct}%` : ''}`;
      r.statusMsg.textContent = st.error ? `错误：${st.error}` : (st.message || '');
      r.progressFill.style.width = `${pct}%`;
      return;
    }

    if (snap) {
      const labels = {
        idle: '当前没有进行中的更新',
        updating: '更新进行中（或刚重启）',
        uploaded: '更新包已上传，等待开始（旧版后台）',
        success: '上次更新成功',
        failed: '上次更新失败',
      };
      r.statusTitle.textContent = labels[snap.state] || '当前没有进行中的更新';
      r.statusMsg.textContent = snap.lastError
        ? `错误：${snap.lastError}`
        : (snap.currentVersion ? `当前版本 ${snap.currentVersion}` : '');
      r.progressFill.style.width = '0%';
      return;
    }

    r.statusTitle.textContent = '当前没有进行中的更新';
    r.statusMsg.textContent = '';
    r.progressFill.style.width = '0%';
  }

  function appendUpdateLog(entry) {
    if (!refs.update || !entry) return;
    const color = entry.level === 'error'
      ? 'var(--theme-stat-lose-color, #e53e3e)'
      : (entry.level === 'warn' ? '#d69e2e' : '');
    const node = el('div', {
      class: 'admin-list-hint',
      style: color ? { color } : null,
    }, `[${formatTime(entry.timestamp)}] ${entry.message || ''}`);
    refs.update.logList.append(node);
    while (refs.update.logList.children.length > 50) {
      refs.update.logList.firstElementChild.remove();
    }
  }

  // ===== 通用 =====
  function section(title, desc, ...children) {
    return el('section', { class: 'admin-section' },
      el('div', { class: 'admin-section__head' }, [
        el('h2', { class: 'admin-section__title' }, title),
        desc ? el('div', { class: 'admin-section__desc' }, desc) : null,
      ]),
      ...children,
    );
  }

  function emitAdmin(event, payload) {
    if (!session?.socket || !session.socket.connected) {
      toast.warn('后台尚未连接，请稍后重试');
      return;
    }
    session.socket.emit(event, payload);
  }

  // 启动连接
  connect();

  return () => destroySession();
}
