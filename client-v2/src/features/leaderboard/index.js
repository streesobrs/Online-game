/**
 * 排行榜模块（任务 4.3.1）
 * 复刻 v1 排行榜：游戏类型筛选（全部/五子棋/围棋/象棋/贪吃蛇）+ Top20 榜单。
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
];

/** 当前登录账号 ID（高亮自己） */
const myId = localStorage.getItem('currentAccountId');

/** 榜单条目 DOM（对齐 v1 renderLeaderboardItem） */
function leaderboardItem(player, gameType) {
  const isTop3 = player.rank <= 3;
  const medal = player.rank === 1 ? '🥇' : player.rank === 2 ? '🥈' : player.rank === 3 ? '🥉' : '';
  const isMe = player.id != null && String(player.id) === String(myId);
  const isSnake = gameType === 'snake';
  const winrateCls = player.winrateNum >= 60 ? 'high' : player.winrateNum >= 40 ? 'mid' : 'low';

  const metaEls = [
    el('span', { class: 'leaderboard-lv-badge' }, `Lv.${player.level || 1}`),
    el('span', {}, `🏟️ ${player.totalGames || 0}局`),
  ];
  if (!isSnake && player.streak && player.streak > 2) {
    metaEls.push(el('span', { class: 'leaderboard-streak-badge' }, `🔥 ${player.streak}连胜`));
  }
  if (!isSnake && player.maxStreak && player.maxStreak > 0) {
    metaEls.push(el('span', { class: 'leaderboard-maxstreak' }, `最高${player.maxStreak}连胜`));
  }

  // 明细：贪吃蛇显示最高分，棋类显示胜/负/平
  const statEls = isSnake
    ? [el('div', { class: 'leaderboard-stat-item' }, [
      el('div', { class: 'leaderboard-stat-value' }, String(player.score || 0)),
      el('div', { class: 'leaderboard-stat-label' }, '最高分'),
    ])]
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
    el('div', { class: 'leaderboard-player-detail' }, statEls),
    !isSnake && totalForRate > 0
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
  let gameType = 'all';

  const typeBtnsEl = el('div', { class: 'leaderboard-controls' });
  const listEl = el('div', { class: 'leaderboard-list' });
  const myRankEl = el('div', { class: 'leaderboard-self-container' });

  container.innerHTML = '';
  container.append(
    el('div', { class: 'leaderboard-page' }, [
      el('div', { class: 'leaderboard-title' }, '🏆 排行榜'),
      typeBtnsEl,
      listEl,
      myRankEl,
    ])
  );

  function renderTypes() {
    typeBtnsEl.innerHTML = '';
    GAME_TYPES.forEach(({ key, label }) => {
      typeBtnsEl.append(
        el('button', {
          class: `lobby-btn ${key === gameType ? 'active' : ''}`,
          onClick: () => selectType(key),
        }, label)
      );
    });
  }

  function selectType(key) {
    gameType = key;
    renderTypes();
    myRankEl.innerHTML = ''; // 切换类型时清空旧排名，等待新类型 my_rank 返回
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
        el('span', { class: 'leaderboard-self-stats' }, `🏟️ ${player.totalGames || 0}局 · ${player.winrate || '0%'}`),
      ])
    );
  }

  function load() {
    listEl.innerHTML = '';
    listEl.append(el('div', { class: 'leaderboard-empty' }, '🏆 加载中...'));
    emit('get_leaderboard', { limit: 20, gameType });
  }

  renderTypes();
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
