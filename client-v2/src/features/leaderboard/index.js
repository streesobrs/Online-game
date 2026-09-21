/**
 * 排行榜模块（任务 4.3.1）
 * 复刻 v1 排行榜：游戏类型筛选（全部/五子棋/围棋/象棋/贪吃蛇/消消乐）+ Top20 榜单。
 * 消消乐各玩法得分尺度不可比（闯关几千 / 无尽数十万 / 三色爽局数百万），
 * 因此一级选中消消乐后再按玩法二级筛选，每个榜只跟同玩法比。
 * 协议：get_leaderboard {limit, gameType} → leaderboard {leaderboard: [...]}
 *       get_my_rank {gameType} → my_rank（4.3.2 我的排名）
 */
import { eventBus } from '../../core/eventBus.js';
import { emit } from '../../core/socket.js';
import { el, viewRoot } from '../../utils/dom.js';

const GAME_TYPES = [
  { key: 'all', label: '🏆 全部' },
  { key: 'gobang', label: '⚫ 五子棋' },
  { key: 'go', label: '⚫ 围棋' },
  { key: 'chinese-chess', label: '♟️ 象棋' },
  { key: 'snake', label: '🐍 贪吃蛇' },
  { key: 'match3', label: '🍬 消消乐' },
];

/** 消消乐二级玩法榜单（榜单键与服务端 MATCH3_LEADERBOARD_TYPES 一致） */
const MATCH3_TYPES = [
  { key: 'match3-level', label: '🏁 闯关' },
  { key: 'match3-endless', label: '♾️ 无尽' },
  { key: 'match3-endless3', label: '🌈 三色爽局' },
  { key: 'match3-rogue', label: '🎲 肉鸽试炼' },
];

/**
 * 榜单明细列：值字段 + 标签。
 * 表内的（贪吃蛇与消消乐各玩法）为单人游戏，显示对应玩法的指标；
 * 棋类不在表内，走胜/负/平三列并显示胜率条。
 */
const STAT_COLUMNS = {
  snake: [{ key: 'score', label: '最高分' }],
  'match3-level': [{ key: 'maxLevel', label: '通关' }, { key: 'totalStars', label: '星数' }],
  'match3-endless': [{ key: 'score', label: '最高分' }],
  'match3-endless3': [{ key: 'score', label: '最高分' }],
  'match3-rogue': [{ key: 'maxFloor', label: '层数' }, { key: 'score', label: '最高分' }],
};

/** 得分型榜单：无胜负概念，隐藏连胜角标与胜率条 */
const SCORE_TYPES = Object.keys(STAT_COLUMNS);

/** 当前登录账号 ID（高亮自己） */
const myId = localStorage.getItem('currentAccountId');

/** 分数用千分位，无尽 / 三色爽局的分数会到几十上百万 */
function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-US');
}

/** 成绩摘要（「我的排名」卡用）：得分型榜单显示本玩法指标，棋类显示局数与胜率 */
function statSummary(player, gameType) {
  const columns = STAT_COLUMNS[gameType];
  const games = `🏟️ ${player.totalGames || 0}局`;
  if (!columns) return `${games} · ${player.winrate || '0%'}`;
  return [games, ...columns.map(({ key, label }) => `${label} ${formatNumber(player[key])}`)].join(' · ');
}

/** 榜单条目 DOM（对齐 v1 renderLeaderboardItem） */
function leaderboardItem(player, gameType) {
  const isTop3 = player.rank <= 3;
  const medal = player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '';
  const isMe = player.id != null && String(player.id) === String(myId);
  const columns = STAT_COLUMNS[gameType];
  const isScoreType = SCORE_TYPES.includes(gameType);
  const winrateCls = player.winrateNum >= 60 ? 'high' : player.winrateNum >= 40 ? 'mid' : 'low';

  const metaEls = [
    el('span', { class: 'leaderboard-lv-badge' }, `Lv.${player.level || 1}`),
    el('span', {}, `🏟️ ${player.totalGames || 0}局`),
  ];
  if (!isScoreType && player.streak && player.streak > 2) {
    metaEls.push(el('span', { class: 'leaderboard-streak-badge' }, `🔥 ${player.streak}连胜`));
  }
  if (!isScoreType && player.maxStreak && player.maxStreak > 0) {
    metaEls.push(el('span', { class: 'leaderboard-maxstreak' }, `最高${player.maxStreak}连胜`));
  }

  // 明细：单人游戏显示本玩法指标，棋类显示胜/负/平
  const statEls = columns
    ? columns.map(({ key, label }) =>
      el('div', { class: 'leaderboard-stat-item' }, [
        el('div', { class: 'leaderboard-stat-value' }, formatNumber(player[key])),
        el('div', { class: 'leaderboard-stat-label' }, label),
      ])
    )
    : ['wins', 'losses', 'draws'].map((key, idx) =>
      el('div', { class: 'leaderboard-stat-item' }, [
        el('div', { class: `leaderboard-stat-value ${['win', 'lose', 'draw'][idx]}` }, String(player[key] || 0)),
        el('div', { class: 'leaderboard-stat-label' }, ['胜', '负', '平'][idx]),
      ])
    );

  const totalForRate = (player.wins || 0) + (player.losses || 0) + (player.draws || 0);

  return el('div', {
    class: `leaderboard-item ${isTop3 ? `top-${player.rank}` : ''} ${isMe ? 'is-me' : ''}`,
  }, [
    el('div', { class: 'leaderboard-rank-col' },
      isTop3
        ? el('span', { class: 'leaderboard-rank-medal' }, medal)
        : el('span', { class: 'leaderboard-rank-num' }, String(player.rank))
    ),
    el('div', { class: 'leaderboard-player-info' }, [
      el('div', { class: 'leaderboard-player-name' }, player.name || player.username || '未知玩家'),
      el('div', { class: 'leaderboard-player-meta' }, metaEls),
    ]),
    // is-score 标记：小屏没有胜率条，得分型榜单的明细必须保留
    el('div', { class: `leaderboard-player-detail ${isScoreType ? 'is-score' : ''}` }, statEls),
    !isScoreType && totalForRate > 0
      ? el('div', { class: 'leaderboard-winrate-col' }, [
        el('div', { class: 'leaderboard-winrate-text' }, player.winrate || '0%'),
        el('div', { class: 'leaderboard-winrate-bar-bg' }, [
          el('div', {
            class: `leaderboard-winrate-bar ${winrateCls}`,
            style: `width:${Math.min(player.winrateNum || 0, 100)}%;`,
          }),
        ]),
      ])
      : null,
  ]);
}

/**
 * 渲染排行榜视图（路由 #/leaderboard）
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderLeaderboard(container = viewRoot()) {
  let mainType = 'all';                  // 一级类型（含「消消乐」）
  let match3Type = MATCH3_TYPES[0].key;  // 消消乐二级玩法，默认闯关
  /** 实际请求 / 渲染用的榜单键 */
  const currentType = () => (mainType === 'match3' ? match3Type : mainType);

  const typeBtnsEl = el('div', { class: 'leaderboard-controls' });
  const subTypeBtnsEl = el('div', { class: 'leaderboard-subcontrols' });
  const listEl = el('div', { class: 'leaderboard-list' });
  const myRankEl = el('div', { class: 'leaderboard-self-container' });

  container.innerHTML = '';
  container.append(
    el('div', { class: 'leaderboard-page' }, [
      el('div', { class: 'leaderboard-title' }, '🏆 排行榜'),
      typeBtnsEl,
      subTypeBtnsEl,
      listEl,
      myRankEl,
    ])
  );

  function renderTypes() {
    typeBtnsEl.innerHTML = '';
    GAME_TYPES.forEach(({ key, label }) => {
      typeBtnsEl.append(
        el('button', {
          class: `lobby-btn ${key === mainType ? 'active' : ''}`,
          onClick: () => selectType(key),
        }, label)
      );
    });
  }

  /** 消消乐按玩法二级筛选，只有选中消消乐时出现 */
  function renderSubTypes() {
    subTypeBtnsEl.innerHTML = '';
    if (mainType !== 'match3') return;
    MATCH3_TYPES.forEach(({ key, label }) => {
      subTypeBtnsEl.append(
        el('button', {
          class: `lobby-btn ${key === match3Type ? 'active' : ''}`,
          onClick: () => {
            match3Type = key;
            renderSubTypes();
            load();
          },
        }, label)
      );
    });
  }

  function selectType(key) {
    mainType = key;
    renderTypes();
    renderSubTypes();
    load();
  }

  function render(data) {
    const list = Array.isArray(data.leaderboard) ? data.leaderboard : [];
    if (list.length === 0) {
      listEl.innerHTML = '';
      listEl.append(el('div', { class: 'leaderboard-empty' }, '暂无排行数据'));
      return;
    }
    listEl.innerHTML = '';
    const gameType = currentType();
    list.forEach((player) => listEl.append(leaderboardItem(player, gameType)));

    // 我的排名：自己不在 Top20 时向服务端请求单独排名（对齐 v1 updateLeaderboard）
    const myUsername = localStorage.getItem('nickname');
    const inTopList = list.some(
      (p) =>
        (p.id != null && String(p.id) === String(myId)) ||
        (myUsername && p.name === myUsername)
    );
    if (inTopList) {
      myRankEl.innerHTML = '';
    } else {
      emit('get_my_rank', { gameType });
    }
  }

  function renderMyRank(data) {
    if (!data || data.inTopList) {
      myRankEl.innerHTML = '';
      return;
    }
    const player = data.player;
    if (!player) {
      myRankEl.innerHTML = '';
      return;
    }
    myRankEl.innerHTML = '';
    myRankEl.append(
      el('div', { class: 'leaderboard-self-card' }, [
        el('span', { class: 'leaderboard-self-label' }, '我的排名'),
        el('span', { class: 'leaderboard-self-rank' }, `#${player.rank}`),
        el('span', { class: 'leaderboard-self-name' }, player.name || '未知'),
        el('span', { class: 'leaderboard-lv-badge' }, `Lv.${player.level || 1}`),
        el('span', { class: 'leaderboard-self-stats' }, statSummary(player, currentType())),
      ])
    );
  }

  function load() {
    myRankEl.innerHTML = ''; // 清空旧排名，等待本次请求的 my_rank 返回
    listEl.innerHTML = '';
    listEl.append(el('div', { class: 'leaderboard-empty' }, '🏆 加载中...'));
    emit('get_leaderboard', { limit: 20, gameType: currentType() });
  }

  renderTypes();
  renderSubTypes();
  load();

  // socket 未连接时 emit 丢弃，连接后补拉
  const offData = eventBus.on('leaderboard:update', (data) => {
    if (data && data.leaderboard) render(data);
  });
  const offMyRank = eventBus.on('leaderboard:myRank', renderMyRank);
  const offConnect = eventBus.on('socket:connect', load);

  return () => {
    offData();
    offMyRank();
    offConnect();
    container.innerHTML = '';
  };
}
