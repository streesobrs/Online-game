/**
 * 大厅匹配
 * 选择游戏 → 「开始匹配」发送 match_request → 匹配中可取消（cancel_match）。
 * 匹配协议与 v1 一致：{ game: 'gobang'|'go'|'chinese-chess'|'snake' }。
 * 匹配成功/超时的完整对战逻辑在阶段 2 各游戏模块实现。
 */
import { emit } from '../../core/socket.js';
import { store } from '../../core/store.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { go } from '../../core/router.js';
import { GAMES } from '../../data/navItems.js';

const GAME_NAMES = Object.fromEntries(GAMES.map((g) => [g.id, g.name]));

/**
 * 渲染大厅视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderLobby(container) {
  let matchGame = GAMES[0].id;
  let isMatching = false;

  const statusEl = el('div', { class: 'text-muted', style: 'margin-top:12px;' },
    '欢迎来到联机大厅！选择游戏后点击「开始匹配」寻找对手');
  const matchBtn = el('button', { class: 'btn btn-primary btn-lg' }, '🎯 开始匹配');
  const cancelBtn = el('button', { class: 'btn btn-secondary btn-lg', style: 'display:none;' }, '❌ 取消匹配');

  const gameBtns = GAMES.map((g) =>
    el('button', {
      class: 'btn lobby-game-btn' + (g.id === matchGame ? ' active' : ''),
      'data-game': g.id,
      onClick: () => {
        if (isMatching) return; // 匹配中禁止换游戏
        matchGame = g.id;
        syncGameBtns();
      },
    }, `${g.icon} ${g.name}`)
  );

  function syncGameBtns() {
    gameBtns.forEach((b) => b.classList.toggle('active', b.dataset.game === matchGame));
  }

  function startMatch() {
    if (isMatching) return;
    if (!store.get('socketConnected')) { toast.error('未连接服务器'); return; }
    if (!store.get('user')) { toast.error('请先登录'); return; }

    isMatching = true;
    emit('match_request', { game: matchGame });
    matchBtn.style.display = 'none';
    cancelBtn.style.display = '';
    statusEl.textContent = `🔍 正在寻找${GAME_NAMES[matchGame]}对手...`;
  }

  function cancelMatch() {
    if (!isMatching) return;
    isMatching = false;
    emit('cancel_match');
    matchBtn.style.display = '';
    cancelBtn.style.display = 'none';
    statusEl.textContent = '已取消匹配';
  }

  matchBtn.addEventListener('click', startMatch);
  cancelBtn.addEventListener('click', cancelMatch);

  container.innerHTML = '';
  container.append(el('div', { class: 'lobby-container panel', style: 'max-width:560px;width:100%;text-align:center;' }, [
    el('h2', { class: 'panel-title' }, '联机大厅'),
    el('div', { class: 'flex gap-8', style: 'justify-content:center;flex-wrap:wrap;' }, gameBtns),
    el('div', { class: 'flex gap-8', style: 'justify-content:center;margin-top:16px;' }, [matchBtn, cancelBtn]),
    statusEl,
  ]));

  // 匹配结果（2.3.2：匹配成功写入 pendingMatch 并跳转对局视图；超时恢复匹配按钮）
  const offSuccess = eventBus.on('lobby:matchSuccess', (data) => {
    console.log('[Lobby] 匹配成功:', data);
    store.set('pendingMatch', data);
    go('gobang');
  });
  const offTimeout = eventBus.on('lobby:matchTimeout', () => {
    isMatching = false;
    matchBtn.style.display = '';
    cancelBtn.style.display = 'none';
    statusEl.textContent = '匹配超时，请重试';
  });

  // cleanup
  return () => {
    if (isMatching) emit('cancel_match');
    offSuccess();
    offTimeout();
    container.innerHTML = '';
  };
}
