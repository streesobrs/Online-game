/**
 * 观战列表（任务 4.5.1）
 * 发送 get_spectate_list 获取当前进行中的对局（PvP + AI），渲染卡片列表。
 * 点击「观战」→ emit('spectate_join', {gameId}) → 服务端回 spectate_joined → play.js 进入对局视图。
 * 协议与 v1 一致（见开发文档附录 A）：
 * - 获取：emit('get_spectate_list') → spectate_list {games: [{gameId, gameType, player1, player2, moveCount, spectatorCount, isAI}]}
 * - 加入：emit('spectate_join', {gameId}) → spectate_joined {game:{gameId, gameType, moves, currentPlayer, ...}}
 */
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { store } from '../../core/store.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { go } from '../../core/router.js';
import { startSpectate, cleanupSpectate } from './play.js';

const GAME_TYPE_NAMES = {
  gobang: '🔴 五子棋',
  go: '⚪ 围棋',
  'chinese-chess': '🟥 象棋',
  snake: '🐍 贪吃蛇',
};

/** 观战可支持的游戏类型（与 v1 一致：贪吃蛇暂不支持观战） */
const SPECTATEABLE = new Set(['gobang', 'go', 'chinese-chess']);

/**
 * 渲染观战列表视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderSpectate(container) {
  let cleaned = false;
  cleanupSpectate(); // 清理可能残留的观战订阅（返回列表/切换视图时）

  const listEl = el('div', { class: 'spectate-list', style: 'margin-top:16px;' });

  function loadList() {
    listEl.innerHTML = '<div class="text-muted" style="text-align:center;padding:40px;">⏳ 加载中...</div>';
    emit('get_spectate_list');
  }

  function renderGames(data) {
    if (cleaned) return;
    const games = (data && data.games) || [];
    if (games.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:60px 20px;">
          <div style="font-size:48px;margin-bottom:16px;">🎮</div>
          <div style="font-size:18px;color:#a0aec0;margin-bottom:8px;">暂无进行中的对局</div>
          <div style="font-size:14px;color:#cbd5e0;">当前没有可观的比赛，稍后再来看看吧</div>
        </div>`;
      return;
    }
    listEl.innerHTML = '';
    games.forEach((game) => listEl.append(gameCard(game)));
  }

  function gameCard(game) {
    const watchBtn = el('button', {
      class: 'btn spectate-join-btn',
      onClick: () => {
        if (!SPECTATEABLE.has(game.gameType)) {
          toast.warn('暂不支持观战该类型的游戏');
          return;
        }
        if (!store.get('socketConnected')) { toast.error('未连接服务器'); return; }
        if (!store.get('user')) { toast.error('请先登录'); return; }
        watchBtn.disabled = true;
        watchBtn.textContent = '⏳ 加入中...';
        emit('spectate_join', { gameId: game.gameId });
      },
    }, '👁️ 观战');

    return el('div', { class: 'spectate-card' }, [
      el('div', { class: 'spectate-card-head' }, [
        el('span', { class: 'spectate-game-name' }, GAME_TYPE_NAMES[game.gameType] || game.gameType),
        el('span', { class: 'flex gap-8' }, [
          game.isAI ? el('span', { class: 'spectate-badge badge-ai' }, '🤖 AI') : null,
          el('span', { class: 'spectate-badge' }, `👁️ ${game.spectatorCount || 0} 人`),
        ]),
      ]),
      el('div', { class: 'spectate-card-players' }, [
        el('span', {}, `🔴 ${game.player1}`),
        el('span', { class: 'text-muted' }, 'VS'),
        el('span', {}, `⚪ ${game.player2}`),
      ]),
      el('div', { class: 'spectate-card-foot' }, [
        el('span', { class: 'text-muted', style: 'font-size:13px;' }, `步数: ${game.moveCount || 0}`),
        watchBtn,
      ]),
    ]);
  }

  container.innerHTML = '';
  container.append(el('div', { class: 'spectate-container panel', style: 'max-width:760px;width:100%;' }, [
    el('h2', { class: 'panel-title' }, '👁️ 观战'),
    el('div', { class: 'text-muted', style: 'text-align:center;margin-bottom:16px;' },
      '观看其他玩家的实时对局，学习高手操作！'),
    listEl,
  ]));

  // 监听 spectate_list；socket 未连接时补拉（connect 后重发）
  const offList = eventBus.on('spectate:list', renderGames);
  const offConnect = eventBus.on('socket:connect', () => {
    if (!cleaned) loadList();
  });

  // 加入成功：进入对局视图（4.5.2）
  const offJoined = eventBus.on('spectate:joined', (game) => {
    if (cleaned) return;
    if (!game || !SPECTATEABLE.has(game.gameType)) {
      toast.warn('暂不支持观战该类型的游戏');
      emit('spectate_leave', { gameId: game && game.gameId });
      go('spectate');
      return;
    }
    // 进入观战对局视图（自行管理订阅与清理）
    startSpectate(container, game);
  });

  loadList();

  return () => {
    cleaned = true;
    cleanupSpectate();
    offList();
    offConnect();
    offJoined();
    container.innerHTML = '';
  };
}
