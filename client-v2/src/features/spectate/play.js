/**
 * 观战对局视图（任务 4.5.2）
 * spectate_joined 成功后接管容器渲染只读棋盘：
 * - 回放已有落子（spectate_joined 返回 moves）
 * - 订阅 game:move 实时同步双方落子（broadcastToSpectators 广播，观战者非玩家不受 from 过滤影响）
 * - 订阅 game:ended → 弹窗提示 → 返回观战列表（spectate_leave）
 *
 * 协议与 v1 一致（见开发文档附录 A）：
 * - 加入观战：emit('spectate_join', {gameId}) → spectate_joined {game:{gameId, gameType, moves, currentPlayer, ...}}
 * - 实时落子：move 事件（gobang/go 带 r,c；chess 带 fromR/fromC/toR/toC）
 * - 结束：game_ended 广播；退出观战 emit('spectate_leave', {gameId})
 */
import { createBoard } from '../../games/gobang/board.js';
import { createBoard as createGoBoard } from '../../games/go/board.js';
import { createChessBoard } from '../../games/chinese-chess/board.js';
import { eventBus } from '../../core/eventBus.js';
import { emit } from '../../core/socket.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { go } from '../../core/router.js';

let activeSpectate = null;

/** 当前是否有进行中的观战 */
export function isSpectating() {
  return !!activeSpectate;
}

const GAME_NAMES = { gobang: '五子棋', go: '围棋', 'chinese-chess': '象棋' };

/**
 * 进入观战对局视图（spectate_joined 成功时调用）
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @param {{gameId: string, gameType: string, moves: Array, currentPlayer?: number}} game
 * @returns {Function} cleanup 函数（离开观战时调用）
 */
export function startSpectate(container, game) {
  cleanupSpectate(); // 清理旧观战

  const { gameId, gameType, moves = [] } = game;
  const me = null; // 观战者无颜色

  // ---- 信息栏 ----
  const turnEl = el('span', { class: 'spectate-info-tag' });
  const leaveBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;margin-left:auto;' }, '离开观战');

  function updateStatus() {
    turnEl.textContent = '👁️ 观战中（实时同步）';
    turnEl.style.color = 'var(--theme-accent, #6366f1)';
  }

  // ---- 只读棋盘 ----
  const boardEl = document.createElement('div');
  let board = null;

  if (gameType === 'gobang') {
    board = createBoard(boardEl, { onPlace: () => { } }); // 观战禁止落子
  } else if (gameType === 'go') {
    board = createGoBoard(boardEl, { onPlace: () => { } });
  } else if (gameType === 'chinese-chess') {
    board = createChessBoard(boardEl, { onCellClick: () => { } }); // 观战禁止走子
  } else {
    toast.warn('暂不支持观战该类型的游戏');
    return () => { };
  }

  // 回放已有落子
  function replayMoves(list) {
    for (const m of list) {
      if (gameType === 'chinese-chess' && m.fromR != null) {
        board.movePiece(m.fromR, m.fromC, m.toR, m.toC);
        board.setLastMove(m.toR, m.toC);
      } else if (m.r != null) {
        board.place(m.r, m.c, m.color || 1);
      }
    }
  }
  replayMoves(moves);

  container.innerHTML = '';
  container.append(
    el('div', { class: 'spectate-match-info', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;max-width:724px;width:100%;' }, [turnEl, leaveBtn]),
    boardEl
  );
  updateStatus();

  // ---- 自适应棋盘尺寸 ----
  const fitBoardSize = () => {
    const board = boardEl.querySelector('.gobang-board, .go-board, .chess-board');
    if (!board) return;
    // 清除 board.js 中 fitBoard() 可能设置的 zoom
    board.style.zoom = '';

    const availableWidth = boardEl.clientWidth || container.clientWidth || window.innerWidth;
    const availableHeight = window.innerHeight * 0.7;

    let cols = 20, rows = 20, padding = 8;
    if (gameType === 'gobang') { cols = 20; rows = 20; padding = 8; }
    else if (gameType === 'go') { cols = 22; rows = 22; padding = 8; }
    else if (gameType === 'chinese-chess') { cols = 9; rows = 10; padding = 48; }

    const cellByWidth = Math.floor((availableWidth - padding) / cols);
    const cellByHeight = Math.floor((availableHeight - padding) / rows);
    let cellSize = Math.min(cellByWidth, cellByHeight);
    cellSize = Math.max(10, Math.min(cellSize, 42));
    board.style.setProperty('--board-cell-size', cellSize + 'px');
    // 显式设置棋盘总尺寸（border-box）
    board.style.width = `calc(${cols} * ${cellSize}px + ${padding}px)`;
    board.style.height = `calc(${rows} * ${cellSize}px + ${padding}px)`;
  };

  fitBoardSize();
  requestAnimationFrame(() => { fitBoardSize(); });
  requestAnimationFrame(() => { requestAnimationFrame(fitBoardSize); });
  window.addEventListener('resize', fitBoardSize);
  const spectateResizeObserver = new ResizeObserver(fitBoardSize);
  spectateResizeObserver.observe(boardEl);

  // ---- socket 事件 ----
  const offs = [];

  // 实时同步落子（broadcastToSpectators 发给观战者，观战者非玩家不会命中 from 过滤）
  offs.push(eventBus.on('game:move', (data) => {
    if (activeSpectate !== null && data.game && data.game !== gameType) return;
    if (data.gameType && data.gameType !== gameType) return;
    if (gameType === 'chinese-chess' && data.fromR != null) {
      const piece = board.get(data.fromR, data.fromC);
      board.movePiece(data.fromR, data.fromC, data.toR, data.toC);
      board.setLastMove(data.toR, data.toC);
    } else if (data.r != null) {
      board.place(data.r, data.c, data.color || 1);
    }
  }));

  // 游戏结束（broadcastToSpectators 广播 game_ended）
  offs.push(eventBus.on('game:ended', (data) => {
    if (activeSpectate === null) return;
    cleanupSpectate();
    modal.show({
      title: '对局结束',
      content: '🎮 被观战的对局已结束',
      confirmText: '返回观战列表',
      showCancel: false,
      onConfirm: () => {
        emit('spectate_leave', { gameId });
        go('spectate');
      },
    });
  }));

  // 离开观战按钮
  leaveBtn.addEventListener('click', () => {
    cleanupSpectate();
    emit('spectate_leave', { gameId });
    go('spectate');
  });

  activeSpectate = {
    container,
    gameId,
    gameType,
    cleanup() {
      offs.forEach((off) => off());
      window.removeEventListener('resize', fitBoardSize);
      spectateResizeObserver.disconnect();
      if (board && typeof board.destroy === 'function') board.destroy();
      container.innerHTML = '';
    },
  };

  return activeSpectate.cleanup;
}

/** 清理当前观战（切换视图/离开时） */
export function cleanupSpectate() {
  if (activeSpectate) {
    activeSpectate.cleanup();
    activeSpectate = null;
  }
}
