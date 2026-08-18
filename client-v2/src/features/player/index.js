/**
 * 他人主页（v2）— 路由 #/player
 * 通过 /api/profile/:accountId 展示公开的部分数据（昵称/等级/战绩/星钻/徽章等），
 * 不展示 username、密码状态等敏感信息。
 * 入口：用户资料卡（userCard）「查看主页」按钮。
 */
import { store } from '../../core/store.js';
import { api } from '../../core/api.js';
import { el, viewRoot } from '../../utils/dom.js';
import { avatarEl, fetchAvatarData } from '../../utils/avatar.js';

/** 游戏类型展示元数据（与个人资料页一致） */
const GAME_META = {
  gobang: { name: '五子棋', icon: '🔴' },
  go: { name: '围棋', icon: '⚪' },
  'chinese-chess': { name: '象棋', icon: '🟥' },
  snake: { name: '贪吃蛇', icon: '🐍' },
};

function pad(n) { return String(n).padStart(2, '0'); }

/** 等级/经验计算（与服务端 calculateLevelAndExp 同算法） */
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

function formatDate(ts) {
  if (!ts) return '-';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 跳转到他人主页 */
export function goPlayer(accountId) {
  store.set('player.viewId', accountId);
  if (window.location.hash === '#/player') {
    renderPlayerProfile(); // 已在主页：直接重渲染
    return;
  }
  window.location.hash = '#/player';
}

/** 渲染他人主页（路由 #/player） */
export function renderPlayerProfile(container = viewRoot()) {
  const accountId = store.get('player.viewId');
  container.innerHTML = '';
  if (!accountId) {
    container.append(el('div', { class: 'player-state' }, '未指定用户'));
    return;
  }

  const state = el('div', { class: 'player-state' }, '加载中...');
  container.append(state);

  Promise.all([api.profile.get(accountId), api.profile.levelExp(), fetchAvatarData(accountId)])
    .then(([pro, expRes, avData]) => {
      const data = pro?.data;
      if (!data) {
        state.textContent = '未找到该玩家';
        return;
      }
      container.innerHTML = '';
      container.append(buildPage(data, expRes?.data || {}, avData));
    })
    .catch(() => { state.textContent = '加载失败'; });

  return () => { container.innerHTML = ''; };
}

function asideStat(icon, value, label) {
  return el('div', { class: 'profile-aside-stat' }, [
    el('div', { class: 'profile-aside-stat-icon' }, icon),
    el('div', { class: 'profile-aside-stat-value' }, value),
    el('div', { class: 'profile-aside-stat-label' }, label),
  ]);
}

/** 组装他人主页（复用个人资料页样式类） */
function buildPage(d, expMap, avData) {
  const account = d.account || {};
  const profile = d.profile || {};
  const stats = d.stats || {};
  const ach = d.achievements || {};
  const { level, exp, nextExp } = calcLevelExp(profile.exp, expMap);
  const expPercent = Math.min(100, nextExp > 0 ? Math.round((exp / nextExp) * 100) : 0);
  const accountTag = account.type === 'guest' ? '游客账号' : (account.isAdmin ? '管理员' : '正式账号');

  // 左侧信息栏（sticky）
  const aside = el('div', { class: 'profile-aside' }, [
    el('div', { class: 'profile-aside-head' }, [
      avatarEl(avData?.cosmetics, avData?.cosmeticConfig, 88),
      el('div', { class: 'profile-aside-name', title: account.nickname }, account.nickname || '未命名'),
      el('div', { class: 'profile-aside-meta' }, [
        el('span', { class: 'profile-aside-id' }, `ID ${account.id || '-'}`),
        el('span', { class: 'profile-aside-tag' }, accountTag),
      ]),
    ]),
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
    el('div', { class: 'profile-aside-stats' }, [
      asideStat('💎', d.currency ?? 0, '星钻'),
      asideStat('🏆', `${ach.progress?.unlocked ?? 0}/${ach.progress?.total ?? 0}`, '成就'),
      asideStat('⚔️', stats.totalWins ?? 0, '胜场'),
      asideStat('🔥', stats.bestStreak ?? 0, '连胜'),
    ]),
  ]);

  // 账号信息（不含 username/密码等敏感字段）
  const infoCards = [
    { label: '账号类型', value: account.type === 'guest' ? '游客' : (account.isAdmin ? '管理员' : '正式账号') },
    { label: '账号 ID', value: account.id || '-' },
    { label: '注册时间', value: formatDate(account.createdAt) },
    { label: '登录次数', value: account.loginCount || 0 },
  ];

  const statCards = [
    { label: '总对局', value: stats.totalGames ?? 0 },
    { label: '胜利', value: stats.totalWins ?? 0, color: '#48bb78' },
    { label: '平局', value: stats.totalDraws ?? 0 },
    { label: '失败', value: stats.totalLosses ?? 0, color: '#e53e3e' },
    { label: '胜率', value: `${stats.winRate ?? 0}%`, highlight: true },
    { label: '最佳连胜', value: stats.bestStreak ?? 0 },
  ];

  // 已解锁徽章
  const badges = ach.badges || [];
  const defs = ach.badgeDefinitions || {};
  const badgeItems = badges.map((id) => {
    const def = defs[id] || {};
    return el('div', { class: 'profile-badge-item', title: def.name || id }, [
      def.icon
        ? el('img', { class: 'profile-badge-icon', src: def.icon, alt: def.name || id })
        : el('div', { class: 'profile-badge-icon profile-badge-emoji' }, '🏅'),
      el('div', { class: 'profile-badge-name' }, def.name || id),
    ]);
  });

  const main = el('div', { class: 'profile-main' }, [
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
    el('div', { class: 'panel profile-card' }, [
      el('div', { class: 'profile-section-title' }, `🏅 已解锁徽章（${badges.length}）`),
      badges.length
        ? el('div', { class: 'profile-badge-grid' }, badgeItems)
        : el('div', { class: 'player-empty' }, '暂无徽章'),
    ]),
  ]);

  return el('div', { class: 'player-page' }, [
    el('button', {
      class: 'player-back',
      onClick: () => {
        if (window.history.length > 1) window.history.back();
        else window.location.hash = '#/games';
      },
    }, '← 返回'),
    el('div', { class: 'profile-page' }, [aside, main]),
  ]);
}
