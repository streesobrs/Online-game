/**
 * 个人资料模块（任务 4.7，全面优化）
 *
 * 布局优化（PC 宽屏双栏）：
 * - 左侧固定信息栏（sticky）：头像/昵称/等级/经验条/资产概览/快捷入口，所有 Tab 下常驻可见
 * - 右侧主区：Tab（资料概览 / 头像装扮 / 对战历史）+ 内容
 * - 资料概览 Tab 内：账号信息 + 战绩统计 双栏并排，各棋种统计通栏网格
 *
 * 信息层级：
 * - 一级：头像、昵称、等级、经验、星钻/成就/悔棋/提示（常驻左侧）
 * - 二级：账号信息、战绩统计、各棋种统计（资料 Tab 双栏）
 * - 三级：头像装扮、对战历史（Tab 切换，按需加载）
 *
 * 响应式：≤1000px 收起为单栏（信息栏变顶部摘要），≤768px 进一步堆叠
 */
import { api } from '../../core/api.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import { NAV_ITEMS } from '../../data/navItems.js';
import * as auth from '../../core/auth.js';
import { requestReplay, showReplay } from '../replay/index.js';
import { resetOnboarding, startOnboarding } from '../../components/onboarding.js';

/** 游戏类型展示元数据 */
const GAME_META = {
  gobang: { name: '五子棋', icon: '🔴' },
  go: { name: '围棋', icon: '⚪' },
  'chinese-chess': { name: '象棋', icon: '🟥' },
  snake: { name: '贪吃蛇', icon: '🐍' },
};

/** 等级里程碑奖励（对齐服务端 config.levelRewards.milestones） */
const LEVEL_REWARD_MILESTONES = [
  { level: 5, desc: '获得100💎 + 🧪经验药水×3 + ↩️悔棋卡×1' },
  { level: 10, desc: '获得250💎 + 🧪经验药水×5 + ✨双倍经验卡×2 + 💡提示卡×3 + 💎7天月卡' },
  { level: 15, desc: '获得500💎 + 🧪经验药水×10 + ✨双倍经验卡×3 + ↩️悔棋卡×3' },
  { level: 20, desc: '获得800💎 + 限定徽章 + 🧪经验药水×10 + ✨双倍经验卡×5 + 💡提示卡×5 + 🍀幸运符×1 + 💎30天月卡' },
  { level: 25, desc: '获得1200💎 + 称号"棋坛精英" + 🌟三倍经验卡×2 + ↩️悔棋卡×5 + 💡提示卡×5' },
  { level: 30, desc: '获得1800💎 + 限定徽章 + 🌟三倍经验卡×3 + 🧪经验药水×20 + 🍀幸运符×3 + 💎30天月卡' },
  { level: 40, desc: '获得3000💎 + 称号"传奇大师" + 🌟三倍经验卡×5 + 🧪经验药水×30 + 🚀等级直升券×1 + 💎30天月卡' },
  { level: 50, desc: '获得5000💎 + 限定徽章 + 称号"至尊棋圣" + 🌟三倍经验卡×10 + 🧪经验药水×50 + 🚀等级直升券×3 + 🍀幸运符×5 + 💎30天月卡' },
];

/** 当前用户 ID（与 v1 一致） */
function currentUserId() {
  return localStorage.getItem('currentAccountId') || '';
}

/**
 * 等级/经验计算（与服务端 calculateLevelAndExp 同算法）
 * @param {number} totalExp - 总经验
 * @param {Object} expMap - {level: 升到下一级所需经验}
 * @returns {{level:number, exp:number, nextExp:number, maxLevel:number}}
 */
function calcLevelExp(totalExp, expMap = {}, maxLevel = 50) {
  const getExp = (lv) => expMap[lv] || Math.max(100, (lv - 1) * 100);
  let level = 1;
  let exp = totalExp || 0;
  while (level < maxLevel && exp >= getExp(level + 1)) {
    exp -= getExp(level + 1);
    level++;
  }
  return { level, exp, nextExp: getExp(level + 1), maxLevel };
}

/** 格式化时间戳为本地日期 */
function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 格式化时长（秒 → 分:秒） */
function formatDuration(sec) {
  if (!sec && sec !== 0) return '-';
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
}

/**
 * 修改/设置密码弹窗（对齐 v1 profile.html 账号设置 changePassword / setPassword）
 * 校验失败时复用输入框元素重开弹窗，避免输入内容丢失。
 * @param {boolean} hasPassword - 账号是否已设置密码（决定「修改密码」还是「设置密码」）
 */
function openPasswordModal(hasPassword) {
  const oldEl = el('input', { type: 'password', class: 'input', placeholder: '当前密码' });
  const newEl = el('input', { type: 'password', class: 'input', placeholder: '新密码（至少6位）' });
  const new2El = el('input', { type: 'password', class: 'input', placeholder: '再次输入新密码' });
  const inputs = hasPassword ? [oldEl, newEl, new2El] : [newEl, new2El];
  inputs.forEach((i) => { i.style.width = '100%'; i.style.marginBottom = '10px'; });

  const show = () => modal.show({
    title: hasPassword ? '🔑 修改密码' : '🔑 设置密码',
    content: el('div', { style: 'padding:4px 0;' }, inputs),
    confirmText: '确认',
    showCancel: true,
    cancelText: '取消',
    onConfirm: () => {
      if (hasPassword && !oldEl.value.trim()) { toast.warn('请输入当前密码'); show(); return; }
      const p = newEl.value;
      if (p.length < 6) { toast.warn('新密码至少6位'); show(); return; }
      if (p !== new2El.value) { toast.warn('两次密码输入不一致'); show(); return; }
      if (hasPassword) auth.changePassword(oldEl.value, p);
      else auth.setPassword(p);
      toast.info('正在提交...');
    },
  });
  show();
}

/**
 * 渲染个人资料视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderProfile(container) {
  const PROFILE_TAB_KEYS = ['info', 'avatar', 'history', 'mail', 'assets', 'rewards', 'achievements', 'shop', 'themes', 'shortcuts'];
  const INIT_TAB = store.get('profile.initTab');
  let activeTab = PROFILE_TAB_KEYS.includes(INIT_TAB) ? INIT_TAB : 'info';
  store.set('profile.initTab', null); // 初始 Tab 已消费，避免下次进入仍停留在上次 Tab
  let profileData = null;
  let expMap = {};
  let cosmetics = null;
  let cosmeticConfig = null;
  let historyData = [];
  let historyFilter = { type: 'all', result: 'all' };
  let embeddedCleanup = null; // 嵌入视图（成就/商城/主题）的清理函数
  // 邮箱 / 资产明细
  let mails = null; // null = 尚未加载
  let mailFilter = 'unread'; // 'unread' | 'all'
  let selectedMailId = null; // 邮箱当前选中的邮件 id
  let txCache = { currency: null, exp: null }; // 星钻/经验记录缓存
  let txTab = 'currency'; // 'currency' | 'exp'
  let selectedTxIdx = 0; // 资产明细当前选中的记录下标

  const asideEl = el('aside', { class: 'panel profile-aside' });
  const tabsEl = el('div', { class: 'profile-tabs' });
  const contentEl = el('div', { class: 'profile-content' });
  const mainEl = el('div', { class: 'profile-main' }, [tabsEl, contentEl]);

  // ---- 数据加载 ----
  async function loadAll() {
    const userId = currentUserId();
    try {
      const [proRes, expRes, cosRes, cfgRes, mailRes] = await Promise.all([
        api.profile.get(userId),
        api.profile.levelExp(),
        api.shop.getCosmetics(userId),
        api.shop.getCosmeticsConfig(),
        api.mails.get(userId),
      ]);
      profileData = proRes.data || null;
      expMap = expRes.data || {};
      cosmetics = cosRes.cosmetics || null;
      cosmeticConfig = cfgRes.cosmetics || null;
      mails = mailRes.mails || [];
    } catch (err) {
      toast.error(err.message || '加载个人资料失败');
      profileData = null;
    }
    renderAll();
  }

  /** 整体重渲染（信息栏 + Tab + 内容） */
  function renderAll() {
    renderAside();
    renderTabs();
    renderContent();
  }

  /** 切换 Tab（Tab 栏 / 快捷按钮复用） */
  function switchTab(key) {
    activeTab = key;
    renderTabs();
    renderContent();
  }

  // ---- 左侧信息栏（sticky，常驻） ----
  function renderAside() {
    asideEl.innerHTML = '';
    if (!profileData) {
      asideEl.append(el('div', { class: 'profile-aside-placeholder' }, '⏳'));
      return;
    }
    const d = profileData;
    const account = d.account || {};
    const { level, exp, nextExp } = calcLevelExp(d.profile?.exp, expMap);
    const expPercent = Math.min(100, nextExp > 0 ? Math.round((exp / nextExp) * 100) : 0);
    const ach = d.achievements?.progress || {};
    const accountTag = account.type === 'guest' ? '游客账号' : (account.isAdmin ? '管理员' : '正式账号');

    asideEl.append(
      // 头像 + 身份
      el('div', { class: 'profile-aside-head' }, [
        avatarPreview(88),
        el('div', { class: 'profile-aside-name', title: account.nickname || account.username }, account.nickname || account.username || '未命名'),
        el('div', { class: 'profile-aside-meta' }, [
          el('span', { class: 'profile-aside-id' }, `ID ${account.id || '-'}`),
          el('span', { class: 'profile-aside-tag' }, accountTag),
        ]),
      ]),
      // 等级 + 经验条
      el('div', { class: 'profile-aside-level' }, [
        el('div', { class: 'profile-aside-level-row' }, [
          el('span', { class: 'profile-aside-level-badge' }, `Lv.${level}`),
          el('span', { class: 'profile-aside-exp-pct' }, `${expPercent}%`),
        ]),
        el('div', { class: 'profile-exp-bar' }, [
          el('div', { class: 'profile-exp-fill', style: `width:${expPercent}%;` }),
        ]),
        el('div', { class: 'profile-aside-exp-text' }, `经验 ${exp} / ${nextExp}`),
      ]),
      // 资产概览
      el('div', { class: 'profile-aside-stats' }, [
        asideStat('💎', d.currency ?? 0, '星钻'),
        asideStat('🏆', `${ach.unlocked ?? 0}/${ach.total ?? 0}`, '成就'),
        asideStat('↩️', d.inventory?.undoCount ?? 0, '悔棋'),
        asideStat('💡', d.inventory?.hintCount ?? 0, '提示'),
      ]),
      // 快捷入口（统一在个人资料页内切换，减少跳转往返）
      el('div', { class: 'profile-aside-actions' }, [
        el('button', { class: 'profile-aside-btn primary', onClick: () => switchTab('avatar') }, '✏️ 编辑头像'),
        el('button', { class: 'profile-aside-btn', onClick: () => switchTab('achievements') }, '🏆 我的成就'),
        el('button', { class: 'profile-aside-btn', onClick: () => switchTab('shop') }, '🛒 我的商城'),
        el('button', { class: 'profile-aside-btn', onClick: () => switchTab('themes') }, '🎨 主题设置'),
        el('button', {
          class: 'profile-aside-btn',
          onClick: () => {
            resetOnboarding();
            window.location.hash = '#/games';
            setTimeout(() => startOnboarding(), 500);
          },
        }, '🧭 新手指引'),
      ]),
    );
  }

  function asideStat(icon, value, label) {
    return el('div', { class: 'profile-aside-stat' }, [
      el('div', { class: 'profile-aside-stat-icon' }, icon),
      el('div', { class: 'profile-aside-stat-value' }, value),
      el('div', { class: 'profile-aside-stat-label' }, label),
    ]);
  }

  // ---- Tab 栏 ----
  function renderTabs() {
    tabsEl.innerHTML = '';
    const unreadMail = mails ? mails.filter((m) => !m.read || (!m.claimed && mailHasRewards(m))).length : 0;
    const tabs = [
      { key: 'info', label: '📄 资料概览' },
      { key: 'avatar', label: '🖼 头像装扮' },
      { key: 'history', label: '📜 对战历史' },
      { key: 'mail', label: `📬 邮箱${unreadMail > 0 ? ` (${unreadMail})` : ''}` },
      { key: 'assets', label: '💰 资产明细' },
      { key: 'rewards', label: '🎁 等级奖励' },
      { key: 'achievements', label: '🏆 我的成就' },
      { key: 'shop', label: '🛒 商城' },
      { key: 'themes', label: '🎨 主题' },
      { key: 'shortcuts', label: '⌨ 快捷键' },
    ];
    tabs.forEach((t) => {
      const btn = el('button', {
        class: 'profile-tab' + (t.key === activeTab ? ' active' : ''),
        onClick: () => switchTab(t.key),
      }, t.label);
      tabsEl.appendChild(btn);
    });
  }

  // ---- 内容分发 ----
  async function renderContent() {
    // 切换前先清理上一个嵌入视图的监听/订阅（成就/商城/主题）
    if (embeddedCleanup) { embeddedCleanup(); embeddedCleanup = null; }
    contentEl.innerHTML = '';
    const needsProfile = activeTab === 'info' || activeTab === 'avatar' || activeTab === 'assets' || activeTab === 'rewards';
    if (!profileData && needsProfile) {
      contentEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '⏳ 加载中...'));
      return;
    }
    if (activeTab === 'info') contentEl.append(renderInfoTab());
    else if (activeTab === 'avatar') contentEl.append(renderAvatarTab());
    else if (activeTab === 'history') await renderHistoryTab();
    else if (activeTab === 'mail') await renderMailTab();
    else if (activeTab === 'assets') contentEl.append(renderAssetsTab());
    else if (activeTab === 'rewards') contentEl.append(renderLevelRewardsTab());
    else if (activeTab === 'achievements') await renderEmbedded('../achievements/index.js', 'renderAchievements');
    else if (activeTab === 'shop') await renderEmbedded('../shop/index.js', 'renderShop');
    else if (activeTab === 'themes') await renderEmbedded('../themes/index.js', 'renderThemePanel');
    else if (activeTab === 'shortcuts') contentEl.append(renderShortcutsTab());
    flashContent();
  }

  /**
   * 渲染嵌入模块（成就/商城/主题）到内容区
   * 子模块 render 会自行清空容器并挂载，返回的 cleanup 函数由本页统一管理
   */
  async function renderEmbedded(modulePath, exportName) {
    contentEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '⏳ 加载中...'));
    try {
      const mod = await import(modulePath);
      const render = mod[exportName];
      if (typeof render !== 'function') {
        contentEl.innerHTML = '';
        contentEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '模块加载失败'));
        return;
      }
      const ret = render(contentEl);
      if (typeof ret === 'function') embeddedCleanup = ret;
    } catch (err) {
      console.error('[Profile] 嵌入模块加载失败:', modulePath, err);
      contentEl.innerHTML = '';
      contentEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '模块加载失败'));
    }
  }

  // ---- 快捷键 Tab ----
  function renderShortcutsTab() {
    const rows = NAV_ITEMS
      .filter((i) => i.shortcut)
      .map((item) => el('div', { class: 'profile-shortcut-row' }, [
        el('kbd', { class: 'profile-shortcut-key' }, item.shortcut.toUpperCase()),
        el('span', { class: 'profile-shortcut-icon' }, item.icon),
        el('span', { class: 'profile-shortcut-name' }, item.inProfile ? `个人资料 · ${item.name}` : item.name),
      ]));
    return el('div', { class: 'panel profile-card' }, [
      el('div', { class: 'profile-section-title' }, '⌨️ 全局快捷键'),
      el('div', { class: 'profile-shortcut-list' }, rows),
      el('p', { class: 'text-muted', style: 'margin-top:12px;font-size:12px;' },
        '在输入框内按键不会触发；按 Ctrl / Alt / 组合键不会触发。'),
    ]);
  }

  /** Tab 切换淡入（减少切换跳跃感） */
  function flashContent() {
    contentEl.classList.remove('profile-content--enter');
    void contentEl.offsetWidth;
    contentEl.classList.add('profile-content--enter');
  }

  // ============ 资料概览 Tab ============
  function renderInfoTab() {
    const d = profileData;
    const account = d.account || {};
    const stats = d.stats || {};

    const infoCards = [
      { label: '账号类型', value: account.type === 'guest' ? '游客' : (account.isAdmin ? '管理员' : '正式账号') },
      { label: '账号 ID', value: account.id || '-' },
      { label: '注册时间', value: formatDate(account.createdAt) },
      { label: '登录次数', value: account.loginCount || 0 },
      { label: '密码状态', value: account.hasPassword ? '已设置' : '未设置' },
    ];

    const statCards = [
      { label: '总对局', value: stats.totalGames ?? 0 },
      { label: '胜利', value: stats.totalWins ?? 0, color: '#48bb78' },
      { label: '平局', value: stats.totalDraws ?? 0 },
      { label: '失败', value: stats.totalLosses ?? 0, color: '#e53e3e' },
      { label: '胜率', value: `${stats.winRate ?? 0}%`, highlight: true },
      { label: '最佳连胜', value: stats.bestStreak ?? 0 },
    ];

    return el('div', { class: 'profile-stack' }, [
      // 账号信息 + 战绩统计 双栏并排（充分利用横向空间）
      el('div', { class: 'profile-duo-grid' }, [
        el('div', { class: 'panel profile-card' }, [
          el('div', { class: 'profile-section-title' }, '📄 账号信息'),
          el('div', { class: 'profile-info-grid' },
            infoCards.map((c) => el('div', { class: 'profile-info-item' }, [
              el('div', { class: 'profile-info-label' }, c.label),
              el('div', { class: 'profile-info-value' }, c.value),
            ]))),
          // 修改/设置密码入口（对齐 v1 账号设置）
          el('div', { style: 'margin-top:14px;text-align:center;' },
            el('button', {
              class: 'btn btn-secondary',
              style: 'padding:6px 18px;font-size:13px;',
              onClick: () => openPasswordModal(!!account.hasPassword),
            }, account.hasPassword ? '🔑 修改密码' : '🔑 设置密码')),
        ]),
        el('div', { class: 'panel profile-card' }, [
          el('div', { class: 'profile-section-title' }, '🏆 战绩统计'),
          el('div', { class: 'profile-stat-grid' },
            statCards.map((c) => el('div', { class: 'profile-stat-item' }, [
              el('div', {
                class: 'profile-stat-value' + (c.highlight ? ' highlight' : ''),
                style: c.color ? `color:${c.color};` : '',
              }, c.value),
              el('div', { class: 'profile-stat-label' }, c.label),
            ]))),
        ]),
      ]),

      // 各棋种统计（通栏）
      el('div', { class: 'panel profile-card' }, [
        el('div', { class: 'profile-section-title' }, '🎮 各棋种统计'),
        el('div', { class: 'profile-game-grid' },
          Object.keys(GAME_META).map((key) => {
            const g = d.games?.[key] || {};
            return el('div', { class: 'profile-game-item' }, [
              el('div', { class: 'profile-game-icon' }, GAME_META[key].icon),
              el('div', { class: 'profile-game-info' }, [
                el('div', { class: 'profile-game-name' }, GAME_META[key].name),
                el('div', { class: 'profile-game-stats' },
                  `对局 ${g.played || g.totalGames || 0} · 胜 ${g.wins || 0} · 负 ${g.losses || 0}`),
              ]),
            ]);
          })),
      ]),

      // 勋章
      renderBadgesCard(),
    ]);
  }

  // ============ 资产明细 Tab（星钻/经验记录，左右分栏） ============
  function renderAssetsTab() {
    const sideEl = el('div', { class: 'profile-tx-side' });
    const detailEl = el('div', { class: 'profile-tx-detail' });
    const switchTx = (key) => {
      txTab = key;
      selectedTxIdx = 0;
      renderTxSubTabs(tabsEl);
      renderTxLayout(sideEl, detailEl, key);
    };
    const tabsEl = el('div', { class: 'profile-tx-tabs' }, [
      el('button', { class: 'profile-tx-tab' + (txTab === 'currency' ? ' active' : ''), onClick: () => switchTx('currency') }, '💎 星钻记录'),
      el('button', { class: 'profile-tx-tab' + (txTab === 'exp' ? ' active' : ''), onClick: () => switchTx('exp') }, '📈 经验记录'),
    ]);
    renderTxLayout(sideEl, detailEl, txTab);
    return el('div', { class: 'profile-stack' }, [
      el('div', { class: 'panel profile-card' }, [
        el('div', { class: 'profile-section-title' }, '💰 资产明细'),
        tabsEl,
        el('div', { class: 'profile-tx-layout' }, [sideEl, detailEl]),
      ]),
    ]);
  }

  function renderTxSubTabs(tabsEl) {
    tabsEl.querySelectorAll('.profile-tx-tab').forEach((b) => b.classList.remove('active'));
    const idx = txTab === 'exp' ? 1 : 0;
    const target = tabsEl.querySelectorAll('.profile-tx-tab')[idx];
    if (target) target.classList.add('active');
  }

  /** 渲染左侧记录列表 + 右侧选中记录详情 */
  async function renderTxLayout(sideEl, detailEl, type) {
    sideEl.innerHTML = '<div class="text-muted" style="text-align:center;padding:24px;">⏳ 加载中...</div>';
    detailEl.innerHTML = '';
    if (!txCache[type]) {
      try {
        txCache[type] = type === 'currency'
          ? await api.currency.transactions(currentUserId(), 30)
          : await api.currency.expTransactions(currentUserId(), 30);
      } catch (e) {
        txCache[type] = { success: false, transactions: [] };
      }
    }
    const tx = txCache[type].transactions || [];
    sideEl.innerHTML = '';
    if (tx.length === 0) {
      sideEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:24px;' }, '暂无记录'));
      detailEl.innerHTML = '';
      return;
    }
    if (selectedTxIdx >= tx.length) selectedTxIdx = 0;
    tx.forEach((t, i) => {
      sideEl.append(el('div', {
        class: 'profile-tx-side-item' + (i === selectedTxIdx ? ' active' : ''),
        onClick: () => { selectedTxIdx = i; renderTxLayout(sideEl, detailEl, type); },
      }, txSideRow(t, type)));
    });
    detailEl.innerHTML = '';
    detailEl.append(txDetail(tx[selectedTxIdx], type));
  }

  const TX_GAME_NAMES = { gobang: '五子棋', go: '围棋', 'chinese-chess': '象棋', snake: '贪吃蛇' };

  /** 交易来源分类：把后端 source 码转成可读标签，并补充具体游戏 */
  function txSourceInfo(source, gameType) {
    const map = {
      battle: { icon: '⚔️', label: '游戏对局' },
      achievement: { icon: '🏆', label: '成就奖励' },
      item_use: { icon: '🧪', label: '道具使用' },
      compensation: { icon: '🎁', label: '系统补偿' },
      mail_reward: { icon: '📬', label: '邮箱奖励' },
      mail_reward_batch: { icon: '📬', label: '邮箱奖励' },
      system: { icon: '⚙️', label: '系统' },
      admin_grant: { icon: '🛠️', label: '管理员发放' },
      admin_revoke_achievement: { icon: '🛠️', label: '管理员操作' },
      exp_reward: { icon: '⭐', label: '经验奖励' },
      level_up: { icon: '⬆️', label: '升级奖励' },
      level_reward: { icon: '🎯', label: '等级奖励' },
      spend: { icon: '🛒', label: '消费' },
      shop: { icon: '🛒', label: '商城' },
    };
    const info = map[source] || { icon: '📄', label: source || '其他' };
    if (gameType && TX_GAME_NAMES[gameType]) {
      return { icon: info.icon, label: `${info.label}（${TX_GAME_NAMES[gameType]}）` };
    }
    return info;
  }

  /** 左侧列表条目（图标 + 原因 + 金额 + 时间） */
  function txSideRow(tx, type) {
    const src = txSourceInfo(tx.source, tx.gameType);
    const meta = `${src.icon} ${src.label} · ${formatDate(tx.timestamp)}`;
    if (type === 'currency') {
      const earn = tx.type === 'earn';
      return [
        el('div', { class: 'profile-tx-side-main' }, [
          el('span', { class: 'profile-tx-icon' }, earn ? '💰' : '💸'),
          el('span', { class: 'profile-tx-reason' }, tx.reason || tx.source || '未知'),
          el('span', { class: 'profile-tx-amount ' + (earn ? 'earn' : 'spend') }, `${earn ? '+' : '-'}${tx.amount}💎`),
        ]),
        el('div', { class: 'profile-tx-side-meta' }, meta),
      ];
    }
    return [
      el('div', { class: 'profile-tx-side-main' }, [
        el('span', { class: 'profile-tx-icon' }, '⭐'),
        el('span', { class: 'profile-tx-reason' }, txReasonText(tx)),
        el('span', { class: 'profile-tx-amount earn' }, `+${tx.finalExp || tx.amount || 0}EXP`),
      ]),
      el('div', { class: 'profile-tx-side-meta' }, meta),
    ];
  }

  /** 右侧详情：金额 + 记录明细行 */
  function txDetail(tx, type) {
    const src = txSourceInfo(tx.source, tx.gameType);
    if (type === 'currency') {
      const earn = tx.type === 'earn';
      return el('div', { class: 'profile-tx-detail-body' }, [
        el('div', { class: 'profile-tx-detail-head' }, [
          el('div', { class: 'profile-tx-detail-title' }, tx.reason || tx.source || '未知'),
          el('span', { class: 'profile-tx-detail-amount ' + (earn ? 'earn' : 'spend') }, `${earn ? '+' : '-'}${tx.amount}💎`),
        ]),
        txRow('来源', `${src.icon} ${src.label}`),
        txRow('类型', earn ? '入账' : '支出'),
        tx.balance != null ? txRow('余额', `${tx.balance}💎`) : null,
        txRow('时间', formatDate(tx.timestamp)),
      ]);
    }
    // 经验记录：兼容多种字段格式（对齐 v1）
    const base = tx.baseExp || tx.amount || 0;
    const bonus = tx.bonusExp || 0;
    const final = tx.finalExp || tx.amount || base || 0;
    const eventLabel = tx.eventLabel || '';
    return el('div', { class: 'profile-tx-detail-body' }, [
      el('div', { class: 'profile-tx-detail-head' }, [
        el('div', { class: 'profile-tx-detail-title' }, txReasonText(tx)),
        el('span', { class: 'profile-tx-detail-amount earn' }, `+${final} EXP`),
      ]),
      txRow('来源', `${src.icon} ${src.label}`),
      txRow('基础', `${base} EXP`),
      bonus > 0 ? txRow('额外奖励', `+${bonus} EXP`) : null,
      eventLabel ? txRow('事件', eventLabel) : null,
      tx.totalExp != null ? txRow('累计经验', `${tx.totalExp} EXP`) : null,
      txRow('时间', formatDate(tx.timestamp)),
    ]);
  }

  function txRow(label, value) {
    return el('div', { class: 'profile-tx-detail-row' }, [
      el('span', { class: 'profile-tx-detail-label' }, label),
      el('span', { class: 'profile-tx-detail-value' }, value),
    ]);
  }

  /** 经验记录原因文本（兼容多种字段格式，对齐 v1） */
  function txReasonText(tx) {
    const base = tx.baseExp || tx.amount || 0;
    const bonus = tx.bonusExp || 0;
    const eventLabel = tx.eventLabel || '';
    const reason = tx.reason || '';
    if (reason && eventLabel && reason !== eventLabel) return `${reason}（${eventLabel}）`;
    if (reason) return reason;
    let detail = `基础 ${base}`;
    if (bonus > 0) detail += ` + 额外 ${bonus}`;
    if (eventLabel) detail += `（含${eventLabel}）`;
    return detail;
  }

  // ============ 等级奖励 Tab ============
  function renderLevelRewardsTab() {
    const rw = profileData.levelRewards || {};
    const claimed = rw.claimedLevels || [];
    const availableSet = new Set((rw.available || []).map((r) => r.level));
    const curLevel = calcLevelExp(profileData.profile?.exp, expMap).level;
    const anyAvailable = availableSet.size > 0;

    const progressSteps = [];
    LEVEL_REWARD_MILESTONES.forEach((r, i) => {
      if (i > 0) progressSteps.push(el('div', { class: 'profile-reward-line' + (claimed.includes(r.level) ? ' claimed' : '') }));
      const isClaimed = claimed.includes(r.level);
      const isAvail = availableSet.has(r.level);
      const isPast = curLevel >= r.level;
      let cls = 'profile-reward-dot';
      if (isClaimed) cls += ' claimed';
      else if (isAvail) cls += ' available';
      else if (isPast) cls += ' active';
      const tip = isClaimed ? '✓' : (isAvail ? '!' : r.level);
      progressSteps.push(el('div', { class: cls, title: `Lv.${r.level}: ${r.desc}` }, tip));
    });

    const rows = LEVEL_REWARD_MILESTONES.map((r) => {
      const isClaimed = claimed.includes(r.level);
      const isAvail = availableSet.has(r.level);
      const isFuture = curLevel < r.level;
      let badge;
      if (isClaimed) badge = el('span', { class: 'profile-reward-badge claimed' }, '✓ 已领取');
      else if (isAvail) badge = el('button', { class: 'profile-reward-badge grab', onClick: () => claimLevelRewards() }, '点击领取');
      else badge = el('span', { class: 'profile-reward-badge locked' }, `Lv.${r.level}解锁`);
      return el('div', {
        class: 'profile-reward-row' + (isClaimed ? ' claimed' : isAvail ? ' available' : isFuture ? ' future' : ''),
        onClick: isAvail ? () => claimLevelRewards() : undefined,
      }, [
        el('div', { class: 'profile-reward-lv' }, `Lv.${r.level}`),
        el('div', { class: 'profile-reward-desc' }, r.desc),
        badge,
      ]);
    });

    return el('div', { class: 'profile-stack' }, [
      el('div', { class: 'panel profile-card' }, [
        el('div', { class: 'profile-section-title profile-reward-head' }, [
          '🎁 等级奖励',
          anyAvailable ? el('button', { class: 'profile-reward-claim-all', onClick: () => claimLevelRewards() }, '领取全部') : null,
        ]),
        el('div', { class: 'profile-reward-progress' }, progressSteps),
        el('div', { class: 'profile-reward-list' }, rows),
      ]),
    ]);
  }

  async function claimLevelRewards() {
    try {
      const res = await api.levelRewards.claim(currentUserId());
      if (!res.success) { toast.error(res.message || '没有可领取的奖励'); return; }
      toast.success(`🎉 成功领取 ${(res.rewards || []).length} 项等级奖励！`);
      await refreshProfileData();
      renderAll();
    } catch (err) {
      toast.error(err.message || '领取失败，请稍后重试');
    }
  }

  // ============ 勋章 ============
  function renderBadgesCard() {
    const ach = profileData.achievements || {};
    const badges = ach.badges || [];
    const defs = ach.badgeDefinitions || {};
    const items = badges.map((id) => {
      const def = defs[id] || { name: id, icon: '' };
      return el('div', { class: 'profile-badge-item', title: def.name }, [
        def.icon
          ? el('img', { class: 'profile-badge-icon', src: def.icon, alt: def.name })
          : el('div', { class: 'profile-badge-icon profile-badge-emoji' }, '🏅'),
        el('div', { class: 'profile-badge-name' }, def.name),
      ]);
    });
    return el('div', { class: 'panel profile-card' }, [
      el('div', { class: 'profile-section-title profile-reward-head' }, [
        '🏅 勋章',
        el('span', { class: 'profile-badge-count' }, `${badges.length} 个`),
      ]),
      items.length === 0
        ? el('div', { class: 'text-muted', style: 'text-align:center;padding:20px;' }, '暂无勋章')
        : el('div', { class: 'profile-badge-grid' }, items),
    ]);
  }

  // ============ 邮箱 Tab ============
  function mailHasRewards(m) {
    return (m.starCoins && m.starCoins > 0) ||
      (m.exp && m.exp > 0) ||
      (m.items && m.items.length > 0) ||
      (m.cosmetics && m.cosmetics.length > 0) ||
      !!m.vip;
  }

  async function renderMailTab() {
    if (mails === null) {
      contentEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '⏳ 加载中...'));
      try {
        const res = await api.mails.get(currentUserId());
        mails = res.mails || [];
      } catch (err) {
        mails = [];
      }
      contentEl.innerHTML = '';
    }
    contentEl.append(buildMailView());
  }

  function buildMailView() {
    const sideEl = el('div', { class: 'profile-mail-side' });
    const detailEl = el('div', { class: 'profile-mail-detail' });
    const unreadTab = el('button', { class: 'profile-mail-tab' + (mailFilter === 'unread' ? ' active' : ''), onClick: () => switchFilter('unread') }, '未读');
    const allTab = el('button', { class: 'profile-mail-tab' + (mailFilter === 'all' ? ' active' : ''), onClick: () => switchFilter('all') }, '全部');
    const switchFilter = (f) => {
      mailFilter = f;
      unreadTab.classList.toggle('active', f === 'unread');
      allTab.classList.toggle('active', f === 'all');
      renderMailList(sideEl, detailEl);
      renderTabs();
    };
    const toolbar = el('div', { class: 'profile-mail-toolbar' }, [
      unreadTab,
      allTab,
      el('div', { class: 'profile-mail-spacer' }),
      el('button', { class: 'profile-mail-action', onClick: () => claimAllMails() }, '一键领取'),
      el('button', { class: 'profile-mail-action', onClick: () => doReload() }, '刷新'),
    ]);
    renderMailList(sideEl, detailEl);
    return el('div', { class: 'panel profile-card' }, [
      el('div', { class: 'profile-section-title' }, '📬 我的邮箱'),
      toolbar,
      el('div', { class: 'profile-mail-layout' }, [sideEl, detailEl]),
    ]);
  }

  /** 渲染左侧标题列表 + 右侧选中邮件详情（左右分栏） */
  function renderMailList(sideEl, detailEl) {
    let list = mails || [];
    if (mailFilter === 'unread') list = list.filter((m) => !m.claimed && !m.read);
    list = [...list]
      .sort((a, b) => (b.timestamp || b.createdAt || 0) - (a.timestamp || a.createdAt || 0))
      .slice(0, 100);

    sideEl.innerHTML = '';
    if (list.length === 0) {
      sideEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:30px;' }, '暂无邮件'));
      detailEl.innerHTML = '';
      return;
    }
    // 选中项不在当前列表时回退到第一条
    if (!list.some((m) => m.id === selectedMailId)) selectedMailId = list[0].id;

    list.forEach((m) => {
      sideEl.append(el('div', {
        class: 'profile-mail-list-item' +
          (m.id === selectedMailId ? ' active' : '') +
          (!m.claimed && !m.read ? ' unread' : ''),
        onClick: () => { selectedMailId = m.id; renderMailList(sideEl, detailEl); },
      }, [
        el('div', { class: 'profile-mail-list-title' }, m.title || '邮件'),
        el('div', { class: 'profile-mail-list-meta' }, `${m.from || '系统'} · ${formatDate(m.timestamp || m.createdAt)}`),
      ]));
    });

    const selected = list.find((m) => m.id === selectedMailId) || list[0];
    detailEl.innerHTML = '';
    detailEl.append(mailDetail(selected));
  }

  function mailDetail(mail) {
    const isClaimed = !!mail.claimed;
    const isRead = !!mail.read;
    const hasRewards = mailHasRewards(mail);
    let statusText, statusColor;
    if (isClaimed) { statusText = '已领取'; statusColor = '#6c757d'; }
    else if (hasRewards) { statusText = '待领取'; statusColor = '#48bb78'; }
    else { statusText = isRead ? '已读' : '未读'; statusColor = '#007bff'; }

    const actionBtn = isClaimed
      ? el('button', { class: 'profile-mail-btn', disabled: true }, '已领取')
      : hasRewards
        ? el('button', { class: 'profile-mail-btn primary', onClick: () => mailClaim(mail.id) }, '领取')
        : el('button', { class: 'profile-mail-btn', onClick: () => mailRead(mail.id) }, '标记已读');
    const deleteBtn = el('button', { class: 'profile-mail-btn danger', onClick: () => mailDelete(mail.id) }, '删除');

    return el('div', { class: 'profile-mail-detail-body' }, [
      el('div', { class: 'profile-mail-detail-head' }, [
        el('div', { class: 'profile-mail-detail-title' }, mail.title || '邮件'),
        el('span', { class: 'profile-mail-status', style: `color:${statusColor};` }, statusText),
      ]),
      el('div', { class: 'profile-mail-detail-meta' }, `${mail.from || '系统'} · ${formatDate(mail.timestamp || mail.createdAt)}`),
      mail.content ? el('div', { class: 'profile-mail-content' }, mail.content) : null,
      mailRewardsSection(mail),
      el('div', { class: 'profile-mail-actions' }, [actionBtn, deleteBtn]),
    ]);
  }

  function mailRewardsSection(mail) {
    if (!mailHasRewards(mail)) return null;
    const sections = [];
    const currencyTags = [];
    if (mail.starCoins > 0) currencyTags.push(el('span', { class: 'profile-mail-tag' }, `💎 ${mail.starCoins} 星钻`));
    if (mail.exp > 0) currencyTags.push(el('span', { class: 'profile-mail-tag' }, `⭐ ${mail.exp} 经验`));
    if (currencyTags.length) sections.push(mailRewardRow('货币', currencyTags));

    const regular = [];
    const packs = [];
    for (const it of mail.items || []) {
      if (it.category === 'pack' || (it.name && (it.name.includes('礼包') || it.name.includes('包')))) packs.push(it);
      else regular.push(it);
    }
    if (regular.length) sections.push(mailRewardRow('物品', regular.map((it) => el('span', { class: 'profile-mail-tag' }, `${it.icon || '📦'} ${it.name || it.id} ×${it.count || 1}`))));
    if (packs.length) sections.push(mailRewardRow('礼包', packs.map((it) => el('span', { class: 'profile-mail-tag' }, `${it.icon || '🎁'} ${it.name || it.id} ×${it.count || 1}`))));
    if (mail.cosmetics && mail.cosmetics.length) sections.push(mailRewardRow('外观', mail.cosmetics.map((c) => el('span', { class: 'profile-mail-tag' }, `${c.icon || '🎨'} ${c.name || c.id}`))));
    if (mail.vip) sections.push(mailRewardRow('会员', [el('span', { class: 'profile-mail-tag' }, `${mail.vip.icon || '💎'} ${mail.vip.name || '会员'} ${mail.vip.days || ''}天`)]));

    return el('div', { class: 'profile-mail-rewards' }, sections);
  }

  function mailRewardRow(label, tags) {
    return el('div', { class: 'profile-mail-reward-row' }, [
      el('span', { class: 'profile-mail-reward-label' }, label),
      ...tags,
    ]);
  }

  async function mailClaim(mailId) {
    try {
      const res = await api.mails.claim(currentUserId(), mailId);
      if (!res.success) { toast.error(res.message || '领取失败'); return; }
      toast.success('🎉 领取成功！');
      await reloadMails();
      await refreshProfileData();
      renderAll();
    } catch (err) {
      toast.error(err.message || '领取失败');
    }
  }

  async function mailRead(mailId) {
    try {
      const res = await api.mails.read(currentUserId(), mailId);
      if (!res.success) { toast.error(res.message || '操作失败'); return; }
      await reloadMails();
      renderAll();
    } catch (err) {
      toast.error(err.message || '操作失败');
    }
  }

  function mailDelete(mailId) {
    modal.show({
      title: '删除邮件',
      content: '确定删除这封邮件吗？',
      confirmText: '删除',
      showCancel: true,
      onConfirm: async () => {
        try {
          const res = await api.mails.remove(currentUserId(), mailId);
          if (!res.success) { toast.error(res.message || '删除失败'); return; }
          toast.success('已删除');
          await reloadMails();
          renderAll();
        } catch (err) {
          toast.error(err.message || '删除失败');
        }
      },
    });
  }

  async function claimAllMails() {
    try {
      const res = await api.mails.claimAll(currentUserId());
      if (!res.success) { toast.error(res.message || '操作失败'); return; }
      toast.success('🎉 已一键领取全部邮件！');
      await reloadMails();
      await refreshProfileData();
      renderAll();
    } catch (err) {
      toast.error(err.message || '操作失败');
    }
  }

  async function doReload() {
    await reloadMails();
    renderAll();
  }

  async function reloadMails() {
    try {
      const res = await api.mails.get(currentUserId());
      mails = res.mails || [];
    } catch (err) {
      mails = mails || [];
    }
  }

  /** 仅刷新个人资料数据（邮件领取/等级奖励后同步余额与等级） */
  async function refreshProfileData() {
    // 余额/等级已变化，清空交易缓存，资产明细下次访问时重新拉取
    txCache = { currency: null, exp: null };
    try {
      const res = await api.profile.get(currentUserId());
      if (res?.data) profileData = res.data;
    } catch (err) { /* 保留旧数据 */ }
  }

  // ============ 头像装扮 Tab ============
  function renderAvatarTab() {
    const owned = cosmetics?.owned || {};
    const equipped = cosmetics?.equipped || {};
    const customAvatars = owned.customAvatars || [];
    const avatarsCfg = cosmeticConfig?.avatars || {};
    const framesCfg = cosmeticConfig?.frames || {};

    // 预设头像网格
    const avatarItems = Object.values(avatarsCfg).map((a) => {
      const isOwned = (owned.avatars || []).includes(a.id) || a.id === 'avatar_default';
      const isEquipped = equipped.avatar === a.id;
      return el('div', { class: 'profile-cosmetic-card' + (isEquipped ? ' equipped' : '') }, [
        el('div', { class: 'profile-cosmetic-icon' }, a.emoji || a.icon || '🎭'),
        el('div', { class: 'profile-cosmetic-name' }, a.name),
        el('button', {
          class: 'btn profile-cosmetic-btn' + (isEquipped ? ' active' : ''),
          disabled: !isOwned,
          onClick: () => equip('avatar', a.id),
        }, isEquipped ? '✔ 使用中' : (isOwned ? '使用' : '未拥有')),
      ]);
    });

    // 头像框网格
    const frameItems = Object.values(framesCfg).map((f) => {
      const isOwned = (owned.frames || []).includes(f.id) || f.id === 'frame_default';
      const isEquipped = equipped.frame === f.id;
      return el('div', { class: 'profile-cosmetic-card' + (isEquipped ? ' equipped' : '') }, [
        el('div', { class: 'profile-cosmetic-icon', style: `color:${f.color || '#e2e8f0'};` }, f.icon || '⭕'),
        el('div', { class: 'profile-cosmetic-name' }, f.name),
        el('button', {
          class: 'btn profile-cosmetic-btn' + (isEquipped ? ' active' : ''),
          disabled: !isOwned,
          onClick: () => equip('frame', f.id),
        }, isEquipped ? '✔ 使用中' : (isOwned ? '使用' : '未拥有')),
      ]);
    });

    // 自定义头像网格
    const customItems = customAvatars.map((c, idx) => {
      const isEquipped = equipped.avatarCustom === `${currentUserId()}/${c.file}`;
      return el('div', { class: 'profile-cosmetic-card custom' + (isEquipped ? ' equipped' : '') }, [
        el('div', { class: 'profile-cosmetic-icon' },
          el('img', { class: 'profile-custom-avatar', src: `/data/cosmetics/avatars/${currentUserId()}/${c.file}`, alt: c.name })),
        el('div', { class: 'profile-cosmetic-name' }, c.name || c.file),
        el('div', { class: 'profile-custom-actions' }, [
          el('button', {
            class: 'btn profile-cosmetic-btn' + (isEquipped ? ' active' : ''),
            onClick: () => equipCustom(c.file),
          }, isEquipped ? '✔ 使用中' : '使用'),
          el('button', { class: 'btn profile-mini-btn', title: '替换', onClick: () => pickUpload(idx) }, '📷'),
          el('button', { class: 'btn profile-mini-btn', title: '改名', onClick: () => renameAvatar(c) }, '✏️'),
          el('button', { class: 'btn profile-mini-btn danger', title: '删除', onClick: () => removeAvatar(c) }, '🗑️'),
        ]),
      ]);
    });

    return el('div', { class: 'profile-stack' }, [
      el('div', { class: 'panel profile-card' }, [
        el('div', { class: 'profile-section-title' }, '当前形象'),
        el('div', { class: 'profile-avatar-preview' }, avatarPreview(72)),
      ]),
      el('div', { class: 'panel profile-card' }, [
        el('div', { class: 'profile-section-title' }, '😀 预设头像'),
        el('div', { class: 'profile-cosmetic-grid' }, avatarItems),
      ]),
      el('div', { class: 'panel profile-card' }, [
        el('div', { class: 'profile-section-title' }, '⭕ 头像框'),
        el('div', { class: 'profile-cosmetic-grid' }, frameItems),
      ]),
      el('div', { class: 'panel profile-card' }, [
        el('div', { class: 'profile-section-title' }, '📷 自定义头像'),
        el('div', { class: 'profile-upload-tip' }, '支持 PNG/JPG/GIF，超过 2MB 的图片将自动压缩'),
        el('div', { class: 'profile-cosmetic-grid' }, [
          el('div', { class: 'profile-cosmetic-card upload', onClick: () => pickUpload(-1) }, [
            el('div', { class: 'profile-cosmetic-icon' }, '➕'),
            el('div', { class: 'profile-cosmetic-name' }, '上传新头像'),
          ]),
          ...customItems,
        ]),
      ]),
    ]);
  }

  // ============ 对战历史 Tab ============
  async function renderHistoryTab() {
    const userId = currentUserId();
    contentEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '⏳ 加载中...'));
    try {
      const res = await api.games.history(userId, 50);
      historyData = res.data || [];
    } catch (err) {
      toast.error(err.message || '加载对战历史失败');
      historyData = [];
    }
    contentEl.innerHTML = '';

    const filterBar = el('div', { class: 'profile-filter-bar' }, [
      el('span', { class: 'profile-filter-label' }, '游戏:'),
      buildFilter('type', ['all', ...Object.keys(GAME_META)]),
      el('span', { class: 'profile-filter-label' }, '结果:'),
      buildFilter('result', ['all', 'win', 'loss', 'draw']),
    ]);

    const filtered = historyData.filter((g) =>
      (historyFilter.type === 'all' || g.gameType === historyFilter.type) &&
      (historyFilter.result === 'all' || g.result === historyFilter.result));

    contentEl.append(el('div', { class: 'panel profile-card' }, [
      filterBar,
      filtered.length === 0
        ? el('div', { class: 'text-muted', style: 'text-align:center;padding:30px;' }, '暂无对战记录')
        : el('div', { class: 'profile-history-list' }, filtered.map(historyCard)),
    ]));

    function buildFilter(key, options) {
      const sel = el('select', {
        class: 'profile-filter-select',
        onChange: (e) => {
          historyFilter[key] = e.target.value;
          renderHistoryTab();
        },
      }, options.map((opt) =>
        el('option', { value: opt, selected: historyFilter[key] === opt },
          key === 'type' ? (GAME_META[opt]?.name || '全部') : ({ all: '全部', win: '胜利', loss: '失败', draw: '平局' }[opt] || opt))));
      return sel;
    }
  }

  function historyCard(g) {
    const meta = GAME_META[g.gameType] || { name: g.gameType, icon: '🎮' };
    const resultMap = { win: ['胜利', '#48bb78'], loss: ['失败', '#e53e3e'], draw: ['平局', '#718096'], end: ['结束', '#718096'] };
    const [resultText, resultColor] = resultMap[g.result] || ['未知', '#718096'];
    return el('div', { class: 'profile-history-item' }, [
      el('div', { class: 'profile-history-icon' }, meta.icon),
      el('div', { class: 'profile-history-info' }, [
        el('div', { class: 'profile-history-name' }, [
          meta.name,
          el('span', { class: 'profile-history-result', style: `color:${resultColor};` }, resultText),
        ]),
        el('div', { class: 'profile-history-meta' },
          `🎯 对手 ${g.opponent || 'AI'} · 📍 ${g.moves || 0} 回合 · ⏱ ${formatDuration(g.duration)} · 📅 ${formatDate(g.date)}`),
      ]),
      // 回放按钮（对齐 v1 games-history.html「🎬 回放」）
      el('button', {
        class: 'profile-history-replay',
        title: '查看本局回放',
        onClick: async () => {
          if (!g.gameId) { toast.warn('该对局无回放记录'); return; }
          toast.info('⏳ 加载回放中...');
          try {
            const replay = await requestReplay(g.gameId);
            showReplay(replay);
          } catch (e) {
            toast.error(e.message || '回放加载失败');
          }
        },
      }, '🎬 回放'),
    ]);
  }

  // ============ 辅助：头像显示 ============
  function avatarInfo() {
    const equipped = cosmetics?.equipped || {};
    if (equipped.avatarCustom) {
      return { type: 'img', src: `/data/cosmetics/avatars/${equipped.avatarCustom}` };
    }
    const cfg = cosmeticConfig?.avatars?.[equipped.avatar];
    if (cfg) return { type: 'emoji', text: cfg.emoji || cfg.icon || '👤' };
    return { type: 'emoji', text: '👤' };
  }

  function frameColor() {
    const frameId = cosmetics?.equipped?.frame;
    return cosmeticConfig?.frames?.[frameId]?.color || '#e2e8f0';
  }

  function avatarPreview(size) {
    const av = avatarInfo();
    const inner = av.type === 'img'
      ? el('img', { class: 'profile-avatar-img', src: av.src, style: `width:${size - 8}px;height:${size - 8}px;` })
      : el('div', { class: 'profile-avatar-emoji', style: `font-size:${Math.round(size * 0.5)}px;` }, av.text);
    return el('div', {
      class: 'profile-avatar-wrap',
      style: `width:${size}px;height:${size}px;background:conic-gradient(from 0deg, ${frameColor()}, #fff, ${frameColor()});`,
    }, inner);
  }

  // ============ 交互：装备 / 上传 / 改名 / 删除 ============
  async function equip(category, cosmeticId) {
    const userId = currentUserId();
    try {
      const res = await api.shop.equipCosmetic(userId, category, cosmeticId);
      if (!res.success) { toast.error(res.message || '装备失败'); return; }
      toast.success(res.message || '装备成功！');
      const cosRes = await api.shop.getCosmetics(userId);
      cosmetics = cosRes.cosmetics || cosmetics;
      renderAll();
    } catch (err) {
      toast.error(err.message || '装备失败');
    }
  }

  async function equipCustom(file) {
    const userId = currentUserId();
    try {
      const res = await api.shop.equipCosmetic(userId, 'avatarCustom', file);
      if (!res.success) { toast.error(res.message || '装备失败'); return; }
      toast.success(res.message || '装备成功！');
      const cosRes = await api.shop.getCosmetics(userId);
      cosmetics = cosRes.cosmetics || cosmetics;
      renderAll();
    } catch (err) {
      toast.error(err.message || '装备失败');
    }
  }

  // 触发文件选择（-1 新增，>=0 替换指定槽位）
  function pickUpload(replaceIndex) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) handleUpload(file, replaceIndex);
    };
    input.click();
  }

  /** 上传前处理：GIF 直传；非 GIF 超过 2MB 压缩；总大小上限 10MB */
  async function handleUpload(file, replaceIndex) {
    const MAX_RAW = 10 * 1024 * 1024;
    if (file.size > MAX_RAW) { toast.error('图片过大（>10MB）'); return; }
    try {
      let dataUrl;
      if (file.type === 'image/gif' || file.size <= 2 * 1024 * 1024) {
        dataUrl = await readAsDataURL(file);
      } else {
        dataUrl = await compressImage(file, 2000);
      }
      const res = await api.avatar.upload(currentUserId(), dataUrl, replaceIndex >= 0 ? replaceIndex : undefined);
      if (!res.success) { toast.error(res.message || '上传失败'); return; }
      toast.success(res.message || '上传成功！');
      const cosRes = await api.shop.getCosmetics(currentUserId());
      cosmetics = cosRes.cosmetics || cosmetics;
      renderAll();
    } catch (err) {
      toast.error(err.message || '上传失败');
    }
  }

  function renameAvatar(item) {
    const nameInput = el('input', {
      type: 'text',
      class: 'profile-rename-input',
      value: item.name || item.file,
      maxlength: 30,
    });
    modal.show({
      title: '重命名头像',
      content: el('div', { class: 'shop-buy-modal' }, [
        el('div', {}, `为「${item.name || item.file}」输入新名称`),
        nameInput,
      ]),
      confirmText: '保存',
      showCancel: true,
      onConfirm: () => {
        const name = nameInput.value.trim();
        if (!name) { toast.warn('名称不能为空'); return; }
        doRename(item.file, name);
      },
    });
  }

  async function doRename(file, name) {
    try {
      const res = await api.avatar.rename(currentUserId(), file, name);
      if (!res.success) { toast.error(res.message || '改名失败'); return; }
      toast.success('改名成功');
      const cosRes = await api.shop.getCosmetics(currentUserId());
      cosmetics = cosRes.cosmetics || cosmetics;
      renderAll();
    } catch (err) {
      toast.error(err.message || '改名失败');
    }
  }

  function removeAvatar(item) {
    modal.show({
      title: '删除头像',
      content: `确定删除自定义头像「${item.name || item.file}」吗？`,
      confirmText: '删除',
      showCancel: true,
      onConfirm: () => doRemove(item.file),
    });
  }

  async function doRemove(file) {
    try {
      const res = await api.avatar.remove(currentUserId(), file);
      if (!res.success) { toast.error(res.message || '删除失败'); return; }
      toast.success('删除成功');
      const cosRes = await api.shop.getCosmetics(currentUserId());
      cosmetics = cosRes.cosmetics || cosmetics;
      renderAll();
    } catch (err) {
      toast.error(err.message || '删除失败');
    }
  }

  // ============ 工具函数 ============
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /** canvas 压缩图片到指定最大边长，输出 JPEG dataURL */
  function compressImage(file, maxSide) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxSide / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('图片解析失败'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ---- 组装视图 ----
  container.innerHTML = '';
  container.append(el('div', { class: 'profile-page' }, [asideEl, mainEl]));
  loadAll();

  // 已迁移模块的快捷键/旧路由入口：已在个人资料页时直接切 Tab（见 router.go）
  const offOpenTab = eventBus.on('profile:openTab', (tab) => switchTab(tab));

  return () => {
    if (embeddedCleanup) { embeddedCleanup(); embeddedCleanup = null; }
    offOpenTab();
    container.innerHTML = '';
  };
}
