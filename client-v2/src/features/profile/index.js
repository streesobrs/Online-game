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
import { go } from '../../core/router.js';

/** 游戏类型展示元数据 */
const GAME_META = {
  gobang: { name: '五子棋', icon: '🔴' },
  go: { name: '围棋', icon: '⚪' },
  'chinese-chess': { name: '象棋', icon: '🟥' },
  snake: { name: '贪吃蛇', icon: '🐍' },
};

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
 * 渲染个人资料视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderProfile(container) {
  let activeTab = 'info'; // info | avatar | history
  let profileData = null;
  let expMap = {};
  let cosmetics = null;
  let cosmeticConfig = null;
  let historyData = [];
  let historyFilter = { type: 'all', result: 'all' };

  const asideEl = el('aside', { class: 'panel profile-aside' });
  const tabsEl = el('div', { class: 'profile-tabs' });
  const contentEl = el('div', { class: 'profile-content' });
  const mainEl = el('div', { class: 'profile-main' }, [tabsEl, contentEl]);

  // ---- 数据加载 ----
  async function loadAll() {
    const userId = currentUserId();
    try {
      const [proRes, expRes, cosRes, cfgRes] = await Promise.all([
        api.profile.get(userId),
        api.profile.levelExp(),
        api.shop.getCosmetics(userId),
        api.shop.getCosmeticsConfig(),
      ]);
      profileData = proRes.data || null;
      expMap = expRes.data || {};
      cosmetics = cosRes.cosmetics || null;
      cosmeticConfig = cfgRes.cosmetics || null;
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
      // 快捷入口（相关个人模块整合，减少跳转往返）
      el('div', { class: 'profile-aside-actions' }, [
        el('button', { class: 'profile-aside-btn primary', onClick: () => switchTab('avatar') }, '✏️ 编辑头像'),
        el('button', { class: 'profile-aside-btn', onClick: () => go('achievements') }, '🏆 我的成就'),
        el('button', { class: 'profile-aside-btn', onClick: () => go('shop') }, '🛒 我的商城'),
        el('button', { class: 'profile-aside-btn', onClick: () => go('themes') }, '🎨 主题设置'),
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
    const tabs = [
      { key: 'info', label: '📄 资料概览' },
      { key: 'avatar', label: '🖼 头像装扮' },
      { key: 'history', label: '📜 对战历史' },
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
    contentEl.innerHTML = '';
    if (!profileData && activeTab !== 'history') {
      contentEl.append(el('div', { class: 'text-muted', style: 'text-align:center;padding:40px;' }, '⏳ 加载中...'));
      return;
    }
    if (activeTab === 'info') contentEl.append(renderInfoTab());
    else if (activeTab === 'avatar') contentEl.append(renderAvatarTab());
    else if (activeTab === 'history') await renderHistoryTab();
    flashContent();
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
    ]);
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

  return () => {
    container.innerHTML = '';
  };
}
