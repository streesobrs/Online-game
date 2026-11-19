/**
 * 中国象棋联机对局控制器（任务 3.2.3）
 * 匹配成功后进入对局房间：
 * - 走子同步：本地点击选中棋子 → 显示合法走位 → 走子 emit('move')，订阅 game:move 渲染对手走子
 * - 回合控制：服务端约定 color 1=红（先手）/ 2=黑；本地回合 turn 在 1↔2 切换
 * - 游戏结束：订阅 game:ended / lobby:opponentLeft 展示胜负并返回大厅
 *
 * 协议与 v1 一致：
 * - 匹配成功 match_success → { gameId, opponentId, color }（color: 1 红 / 2 黑）
 * - 走子 socket.emit('move', { game:'chinese-chess', fromR, fromC, toR, toC, color, piece })，
 *   服务端校验回合后原样转发对手 move 事件（含 from / color 1/2）
 * - 将死由服务端 checkGameOver 判定 → endGame 广播 game_ended；认输走 game_result
 */
import { createChessBoard } from './board.js';
import { getChessMoves, isInCheck } from './rules.js';
import { requestUndo, requestHint } from '../board-actions.js';
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { go } from '../../core/router.js';
import { sfx } from '../../core/sfx.js';
import { showRules } from '../rules-dialog.js';
import { bindGameKeys } from '../game-keys.js';
import { createMoveLog, exportGameData } from '../move-log.js';
import {
  createInfoTags, createLatencyProbe, createStatsPanel, createPauseController,
} from '../game-hud.js';

const RED = 1;   // 红方（先手）
const BLACK = 2; // 黑方

let activeMatch = null;

/** 当前是否有进行中的对局 */
export function isMatchActive() {
  return !!activeMatch;
}

/** 当前账号 ID（与 v1 一致：localStorage currentAccountId） */
function currentAccountId() {
  return localStorage.getItem('currentAccountId');
}

/**
 * 开始象棋联机对局（匹配成功时调用）
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @param {{ gameId: string, opponentId: string|number, color: number, opponentNickname?: string, opponentName?: string }} matchData
 * @returns {Object} 对局句柄（含 cleanup）
 */
export function startMatch(container, matchData) {
  cleanupMatch(); // 清理旧对局

  const { gameId, opponentId, color, opponentNickname, opponentName } = matchData;
  const me = color === BLACK ? BLACK : RED; // 1 红 / 2 黑
  let gameOver = false;
  let turn = RED; // 红先（服务端约定 color 1 先行）
  let gameStart = Date.now();
  let timerHandle = null;
  let selected = null; // 选中的棋子 {r, c}
  // 阶段 A：暂停 / 记录 / 重做
  let paused = false;
  let lastOwnMove = null;
  let lastUndoMove = null;
  let lastWinnerText = '';

  // ---- 信息栏 ----
  const turnEl = el('span', { class: 'gobang-info-tag' });
  const oppEl = el('span', { class: 'gobang-info-tag' });
  const timerEl = el('span', { class: 'gobang-info-tag' });
  const { moveCountEl, latencyEl } = createInfoTags('gobang-info-tag');
  const undoBtn = el('button', { class: 'btn btn-secondary' }, '⏪ 悔棋');
  const hintBtn = el('button', { class: 'btn btn-secondary' }, '💡 提示');
  const resignBtn = el('button', { class: 'btn btn-secondary' }, '🏳️ 认输');
  const resetBtn = el('button', { class: 'btn btn-secondary' }, '🔄 重置');
  const rulesBtn = el('button', { class: 'btn btn-secondary', title: '规则（T）' }, '📜 规则');
  const statsBtn = el('button', { class: 'btn btn-secondary' }, '📈 统计');
  const exportBtn = el('button', { class: 'btn btn-secondary' }, '📤 导出');
  const leaveBtn = el('button', { class: 'btn btn-secondary' }, '返回大厅');

  // ---- 阶段 A：落子记录 / 高级统计 ----
  const moveLog = createMoveLog({
    gameType: 'chinese-chess',
    me,
    opponentName: opponentNickname || opponentName || opponentId,
  });
  const statsPanel = createStatsPanel({
    gameType: 'chinese-chess',
    getBoard: () => board.board,
    getEntries: () => moveLog.getEntries(),
  });

  function updateMoveCount() {
    moveCountEl.textContent = `🖐 手数：${moveLog.size()}`;
  }

  function turnName(t) {
    return t === RED ? '红方' : '黑方';
  }

  function colorOf(t) {
    return t === RED ? 'red' : 'black';
  }

  function updateTurn() {
    const mine = turn === me;
    turnEl.textContent = mine ? `● 我的回合（${turnName(turn)}）` : `○ 对方回合（${turnName(turn)}）`;
    turnEl.style.color = mine ? 'var(--theme-accent)' : 'inherit';
    turnEl.style.fontWeight = mine ? 'bold' : 'normal';
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - gameStart - (pauseCtrl ? pauseCtrl.getPausedMs() : 0)) / 1000);
    timerEl.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  oppEl.textContent = `👤 对手：${opponentNickname || opponentName || opponentId || '未知'}`;

  // ---- 棋盘（对局模式：onCellClick 由控制器接管选子/走子）----
  const boardEl = document.createElement('div');
  const board = createChessBoard(boardEl, {
    // 黑方视角：棋盘 180° 旋转，黑棋显示在下方（坐标不变，走子协议不受影响）
    flip: me === BLACK,
    onCellClick: (r, c) => {
      if (gameOver || paused) return;
      const piece = board.get(r, c);

      // 已有选中棋子：尝试走子
      if (selected) {
        const moves = getChessMoves(board.board, selected.r, selected.c);
        if (moves.some((m) => m.r === r && m.c === c)) {
          doMove(selected.r, selected.c, r, c);
          return;
        }
      }

      // 选中己方棋子并显示合法走位
      if (piece && piece.color === colorOf(turn)) {
        board.select(r, c);
        board.setValidMoves(getChessMoves(board.board, r, c));
        selected = { r, c };
      } else {
        board.clearSelection();
        selected = null;
      }
    },
  });

  // ---- 走子（本地合法走位确认后：更新棋盘 + 发服务端 + 切换回合）----
  function doMove(fromR, fromC, toR, toC) {
    if (paused) return false;
    if (gameOver) return false;
    if (turn !== me) { toast.warn('还没轮到你走子'); sfx.play('error'); return false; }
    const moving = board.get(fromR, fromC);
    if (!moving) return false;
    const mover = turn;
    const target = board.get(toR, toC);
    board.movePiece(fromR, fromC, toR, toC);
    // 保留双方轨迹：我方落点用绿色标记，对方上一步的红色标记不清除
    board.setSideLastMove(toR, toC, true);
    // 发送走子（color 为当前回合方：服务端校验回合后转发）
    emit('move', {
      game: 'chinese-chess',
      fromR, fromC, toR, toC,
      color: turn,
      piece: moving.name,
      to: opponentId,
    });
    turn = 3 - turn;
    board.clearSelection();
    selected = null;
    clearHintMarkers();
    lastOwnMove = { fromR, fromC, toR, toC };
    lastUndoMove = null;
    moveLog.add({ color: mover, isSelf: true, fromR, fromC, toR, toC, piece: moving.name });
    updateMoveCount();
    statsPanel.refresh();
    sfx.play(target ? 'capture' : 'place');
    // 走完后检查对方是否被将军（将死由服务端判定并广播 game_ended）
    if (isInCheck(board.board, colorOf(turn))) toast.warn('⚔️ 将军！');
    updateTurn();
    return true;
  }

  // ---- 悔棋：后端棋盘格式（'r-ju'/'b-jiang'）转 v2 {name, color} 模型 ----
  const CHESS_TYPE_NAMES = {
    ju: '车', ma: '马', xiang: '相', shi: '仕', shuai: '帅', pao: '炮', bing: '兵',
    jiang: '将', zu: '卒',
  };
  function backendBoardToV2(backend) {
    const layout = Array.from({ length: 10 }, () => Array(9).fill(null));
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const cell = backend[r][c];
        if (cell && cell !== 0) {
          const str = String(cell);
          const isRed = str.startsWith('r-');
          const type = str.slice(2);
          let name = CHESS_TYPE_NAMES[type] || type;
          // 黑方用象/士（红相/黑象、红仕/黑士，与规则模块一致）
          if (!isRed && type === 'xiang') name = '象';
          if (!isRed && type === 'shi') name = '士';
          layout[r][c] = { name, color: isRed ? 'red' : 'black' };
        }
      }
    }
    return layout;
  }

  const boardContainer = el('div', { class: 'game-board-container' }, [boardEl]);
  const sidePanels = el('div', { class: 'game-side-panels' }, [moveLog.el, statsPanel.el]);

  container.innerHTML = '';
  container.append(
    el('div', { class: 'game-stage game-stage--panels' }, [
      el('div', { class: 'game-status-bar' }, [
        el('div', { class: 'game-status-group' }, [turnEl, oppEl, timerEl, moveCountEl, latencyEl]),
        el('div', { class: 'game-status-spacer' }),
        leaveBtn,
      ]),
      boardContainer,
      el('div', { class: 'game-tools-bar' }, [undoBtn, hintBtn, resignBtn, resetBtn, rulesBtn, statsBtn, exportBtn]),
      sidePanels,
    ])
  );

  // ---- 阶段 A：暂停 / 延迟 / 记录 ----
  const pauseCtrl = createPauseController({
    boardContainer,
    onChange: (v) => {
      paused = v;
      updateTimer();
    },
  });

  const latencyProbe = createLatencyProbe({
    isPaused: () => paused,
    onChange: (ms) => {
      latencyEl.textContent = ms == null ? '📶 --ms' : `📶 ${ms}ms`;
    },
  });
  latencyProbe.start();
  updateMoveCount();
  statsPanel.refresh();

  // 自适应棋盘尺寸：以棋盘容器实际可用空间为准
  const fitBoardSize = () => {
    const stage = container.querySelector('.game-stage');
    const boardContainer = container.querySelector('.game-board-container');
    const board = container.querySelector('.chess-board');
    if (!stage || !boardContainer || !board) return;

    // 清除 board.js 中 fitBoard() 可能设置的 zoom
    board.style.zoom = '';

    const availableWidth = boardContainer.clientWidth || stage.clientWidth || container.clientWidth;
    const availableHeight = boardContainer.clientHeight || stage.clientHeight || container.clientHeight;
    if (availableWidth <= 0) return;

    // 象棋 9列 x 10个交叉点 = 8 x 9 个格距，
    // CSS total = cellSize*8 + 48（横向）/ cellSize*9 + 48（纵向），border-box
    const padding = 48;
    const cellByWidth = Math.floor((availableWidth - padding) / 8);
    const cellByHeight = Math.floor((availableHeight - padding) / 9);
    let cellSize = Math.min(cellByWidth, cellByHeight);

    cellSize = Math.max(12, Math.min(cellSize, 42));
    board.style.setProperty('--board-cell-size', cellSize + 'px');
    // 显式设置棋盘总尺寸（border-box）
    board.style.width = `calc(8 * ${cellSize}px + 48px)`;
    board.style.height = `calc(9 * ${cellSize}px + 48px)`;
  };

  // 初始计算 + 双重延迟计算（确保布局完成后再测量）
  fitBoardSize();
  requestAnimationFrame(() => { fitBoardSize(); });
  requestAnimationFrame(() => { requestAnimationFrame(fitBoardSize); });
  window.addEventListener('resize', fitBoardSize);
  const resizeObserver = new ResizeObserver(fitBoardSize);
  const stageEl = container.querySelector('.game-stage');
  if (stageEl) resizeObserver.observe(stageEl);
  const boardContainerEl = container.querySelector('.game-board-container');
  if (boardContainerEl) resizeObserver.observe(boardContainerEl);

  // 恢复后同步最新对局状态（get_current_game 返回服务端实时快照）
  let stateSyncOff = null;
  let stateSyncTimer = null;

  // 对局重连恢复：用服务端快照重建棋盘与当前回合（棋盘为后端格式，需转换）
  if (matchData.snapshot && matchData.snapshot.board) {
    const layout = backendBoardToV2(matchData.snapshot.board);
    if (layout) board.init(layout);
    turn = matchData.snapshot.currentPlayer || turn;
    updateTurn();
    // 快照可能在重连窗口内过期：对方恰好在这期间落子时，game:move 事件
    // 因尚未订阅而丢失，恢复出的回合会停留在"等对方落子"，造成双方互等。
    // 主动向服务端确认最新棋盘与回合，用权威状态校正。
    syncLatestState();
  }

  function syncLatestState() {
    if (stateSyncOff) return; // 已在同步中
    stateSyncOff = eventBus.on('game:currentGame', (data) => {
      if (!data || data.gameType !== 'chinese-chess') return;
      if (data.gameId != null && String(data.gameId) !== String(gameId)) return;
      if (data.board && Array.isArray(data.board)) {
        const layout = backendBoardToV2(data.board);
        if (layout) board.init(layout);
      }
      if (data.currentPlayer) {
        turn = data.currentPlayer;
        updateTurn();
      }
      if (stateSyncTimer) clearTimeout(stateSyncTimer);
      stateSyncTimer = null;
      if (stateSyncOff) { stateSyncOff(); stateSyncOff = null; }
    });
    emit('get_current_game');
    // 兜底：响应超时则移除监听，避免残留
    stateSyncTimer = setTimeout(() => {
      if (stateSyncOff) { stateSyncOff(); stateSyncOff = null; }
      stateSyncTimer = null;
    }, 3000);
  }

  // ---- 提示标记（与 v1 hint-marker / hint-source / hint-target 一致）----
  let hintMarkers = [];
  function clearHintMarkers() {
    hintMarkers.forEach((m) => m.remove());
    hintMarkers = [];
    boardEl.querySelectorAll('.hint-source, .hint-target').forEach((cell) => {
      cell.classList.remove('hint-source', 'hint-target');
    });
  }
  function showHintMarker(move) {
    clearHintMarkers();
    if (!move || move.fromR == null || move.toR == null) return;
    boardEl.querySelectorAll('.chess-intersection').forEach((cell) => {
      const row = Number(cell.dataset.r);
      const col = Number(cell.dataset.c);
      if (row === move.fromR && col === move.fromC) {
        cell.classList.add('hint-source');
        const marker = el('div', { class: 'hint-marker hint-marker-small hint-chess-inline' }, '📤');
        marker.style.pointerEvents = 'auto';
        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          if (turn === me && !gameOver) {
            board.select(move.fromR, move.fromC);
            board.setValidMoves(getChessMoves(board.board, move.fromR, move.fromC));
            selected = { r: move.fromR, c: move.fromC };
          } else {
            toast.warn('还没轮到你走子');
          }
        });
        cell.appendChild(marker);
        hintMarkers.push(marker);
      }
      if (row === move.toR && col === move.toC) {
        cell.classList.add('hint-target');
        const marker = el('div', { class: 'hint-marker hint-chess-inline' }, '💡');
        marker.style.pointerEvents = 'auto';
        marker.addEventListener('click', (e) => {
          e.stopPropagation();
          if (turn === me && !gameOver) {
            doMove(move.fromR, move.fromC, move.toR, move.toC);
          } else {
            toast.warn('还没轮到你走子');
          }
        });
        cell.appendChild(marker);
        hintMarkers.push(marker);
      }
    });
  }

  // ---- socket 事件 ----
  const offs = [];

  // 对手走子
  offs.push(eventBus.on('game:move', (data) => {
    if (gameOver) return;
    if (data.game && data.game !== 'chinese-chess') return;
    // 跳过自己的走子（服务端一般不会回发给自己，防御性过滤）
    if (data.from != null && String(data.from) === String(currentAccountId())) return;
    if (data.fromR == null || data.fromC == null || data.toR == null || data.toC == null) return;
    const captured = board.get(data.toR, data.toC);
    board.movePiece(data.fromR, data.fromC, data.toR, data.toC);
    // 对方落点用红色标记，保留我方上一步的金色标记
    board.setSideLastMove(data.toR, data.toC);
    turn = me; // 轮到我了
    clearHintMarkers();
    moveLog.add({
      color: data.color === BLACK ? BLACK : RED,
      isSelf: false,
      fromR: data.fromR,
      fromC: data.fromC,
      toR: data.toR,
      toC: data.toC,
      piece: data.piece || null,
    });
    updateMoveCount();
    statsPanel.refresh();
    sfx.play(captured ? 'capture' : 'place');
    // 对手走完后检查我方是否被将军
    if (isInCheck(board.board, colorOf(me))) toast.warn('⚔️ 你被将军了！');
    updateTurn();
    toast.info(`对方走子 → (${data.toR},${data.toC})`);
  }));

  // 游戏结束
  offs.push(eventBus.on('game:ended', (data) => {
    if (gameId != null && data.gameId != null && String(data.gameId) !== String(gameId)) return;
    if (gameOver) return;
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);

    const myId = currentAccountId();
    let msg;
    if (data.result === 'win') {
      msg = String(data.winner) === String(myId) ? '🎉 你获胜了！' : '😢 你输了！';
    } else if (data.result === 'draw') {
      msg = '🤝 平局！';
    } else if (data.result === 'resign') {
      msg = String(data.winner) === String(myId) ? '🎉 对方认输，你获胜了！' : '😢 你认输了！';
    } else {
      msg = '🛑 游戏已结束';
    }
    if (data.reason && data.result === 'win') msg += `（${data.reason}）`;

    const iWon = data.result !== 'draw' && String(data.winner) === String(myId);
    lastWinnerText = data.result === 'draw' ? 'draw' : (iWon ? 'me' : 'opponent');
    moveLog.setWinner(lastWinnerText);
    statsPanel.setWinner(lastWinnerText);
    if (iWon) sfx.play('win');

    modal.show({
      title: '游戏结束',
      content: msg,
      confirmText: '返回大厅',
      showCancel: false,
      onConfirm: () => {
        // 通知服务端释放用户状态（否则停留 playing，无法再次匹配）
        emit('return_lobby');
        go('lobby');
      },
    });
  }));

  // 对手离开
  offs.push(eventBus.on('lobby:opponentLeft', (data) => {
    if (gameOver) return;
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);
    const reason = data?.reason;
    const msg = reason === 'resign'
      ? '🎉 对方已认输，你获胜了！'
      : (data?.nickname ? `对方（${data.nickname}）已离开游戏` : '对方已离开游戏');
    lastWinnerText = 'opponent';
    moveLog.setWinner(lastWinnerText);
    statsPanel.setWinner(lastWinnerText);
    sfx.play('win');
    modal.show({
      title: '游戏结束',
      content: msg,
      confirmText: '返回大厅',
      showCancel: false,
      onConfirm: () => {
        emit('return_lobby');
        go('lobby');
      },
    });
  }));

  // ---- 阶段 A：对局操作函数（按钮与快捷键共用）----
  function doResign() {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束'); return; }
    modal.show({
      title: '认输',
      content: '确定要认输吗？',
      confirmText: '认输',
      showCancel: true,
      onConfirm: () => {
        // 服务端没有 'resign' 事件监听，认输走 game_result（与五子棋/围棋一致）
        emit('game_result', { result: 'resign', reason: '主动认输' });
        toast.info('🏳️ 已认输，等待结果…');
      },
    });
  }

  // ---- 悔棋（与 v1 一致：undo_request → 对手同意 → undo_accepted 恢复棋盘；含库存检查与道具卡消耗）----
  function doUndo() {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束，无法悔棋'); return; }
    requestUndo(() => {
      emit('undo_request');
      toast.info('⏪ 已发送悔棋请求…');
    });
  }

  function doRedo() {
    if (gameOver) { toast.warn('游戏已结束，无法重做'); sfx.play('error'); return; }
    if (!lastUndoMove) { toast.info('暂无可重做的着法'); sfx.play('error'); return; }
    if (turn !== me) { toast.warn('还没轮到你走子'); sfx.play('error'); return; }
    const mv = lastUndoMove;
    if (doMove(mv.fromR, mv.fromC, mv.toR, mv.toC)) {
      toast.success('↪️ 已重做上一步');
    }
  }

  function doReset() {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束'); return; }
    modal.show({
      title: '重置游戏',
      content: '请求重置棋盘？',
      confirmText: '请求重置',
      showCancel: true,
      onConfirm: () => emit('reset'),
    });
  }

  function doStats() {
    sfx.play('click');
    const shown = statsPanel.toggle();
    statsBtn.textContent = shown ? '📈 收起统计' : '📈 统计';
    if (shown) statsPanel.refresh();
  }

  function doExport() {
    sfx.play('click');
    const data = exportGameData({
      gameType: 'chinese-chess',
      me,
      opponentId,
      entries: moveLog.getEntries(),
      durationSec: (Date.now() - gameStart - pauseCtrl.getPausedMs()) / 1000,
      winner: lastWinnerText,
      maxChain: null,
    });
    if (!data) {
      toast.warn('暂无可导出的着法');
      sfx.play('error');
      return;
    }
    toast.success('📤 已导出对局数据');
  }

  function doBack() {
    sfx.play('click');
    if (gameOver) { emit('return_lobby'); go('lobby'); return; }
    modal.show({
      title: '返回大厅',
      content: '确定要退出当前对局吗？',
      confirmText: '退出',
      showCancel: true,
      onConfirm: () => {
        emit('return_lobby');
        go('lobby');
      },
    });
  }

  function doRematch() {
    sfx.play('click');
    modal.show({
      title: '重新匹配',
      content: '将结束当前对局并重新匹配象棋，确定继续？',
      confirmText: '重新匹配',
      showCancel: true,
      onConfirm: () => {
        emit('return_lobby');
        eventBus.emit('games:rematch', 'chinese-chess');
      },
    });
  }

  undoBtn.addEventListener('click', doUndo);

  // 收到对方悔棋请求
  offs.push(eventBus.on('game:undoRequest', (data) => {
    if (gameOver) return;
    modal.show({
      title: '悔棋请求',
      content: `玩家 ${data.fromNickname || '对手'} 请求悔棋，是否同意？`,
      confirmText: '同意',
      showCancel: true,
      onConfirm: () => emit('undo_response', { accepted: true }),
      onCancel: () => emit('undo_response', { accepted: false }),
    });
  }));

  // 悔棋请求已发出
  offs.push(eventBus.on('game:undoRequestSent', (data) => {
    toast.info(data?.message || '已发送悔棋请求，等待对手回应');
  }));

  // 悔棋成功：用服务端完整棋盘数据恢复（board 为后端格式 'r-ju'/'b-jiang'，需转换）
  offs.push(eventBus.on('game:undoAccepted', (data) => {
    if (data.gameType && data.gameType !== 'chinese-chess') return;
    toast.success('✅ 悔棋成功！');
    // 记录被撤销的己方着法，供 Shift+Z 重做（服务端无 redo 协议）
    lastUndoMove = lastOwnMove;
    lastOwnMove = null;
    if (data.board) board.init(backendBoardToV2(data.board));
    turn = data.currentPlayer || turn; // 悔棋后轮到请求方走子
    gameOver = false;
    selected = null;
    clearHintMarkers();
    updateTurn();
    moveLog.clear('棋盘已同步，记录重新开始');
    updateMoveCount();
    statsPanel.refresh();
    sfx.play('click');
  }));

  // 悔棋被拒绝
  offs.push(eventBus.on('game:undoRejected', (data) => {
    toast.error(data?.message || '悔棋请求被拒绝');
  }));

  // ---- 提示（与 v1 一致：request_hint → 服务端 AI 计算 → hint_result 高亮走法；含库存检查与道具卡消耗）----
  hintBtn.addEventListener('click', () => {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束'); return; }
    if (turn !== me) { toast.warn('还没轮到你走子'); sfx.play('error'); return; }
    requestHint(() => {
      emit('request_hint');
      toast.info('💡 正在计算最佳走法…');
    });
  });

  // 提示结果：高亮起点（📤）与目标（💡）
  offs.push(eventBus.on('game:hintResult', (data) => {
    if (data.gameType && data.gameType !== 'chinese-chess') return;
    showHintMarker(data.move);
    const reason = data.reason || '💡 建议位置';
    toast.info(reason);
  }));

  // 提示次数变化/不足
  offs.push(eventBus.on('game:hintDeduct', (data) => {
    if (data && data.success === false && data.message) toast.warn(data.message);
  }));

  // 收到对方重置请求
  offs.push(eventBus.on('game:resetRequest', (data) => {
    if (gameOver) return;
    const isRematch = data.message && data.message.includes('再来一局');
    modal.show({
      title: isRematch ? '再来一局请求' : '重置棋盘请求',
      content: isRematch ? `${data.message}，是否同意？` : `对方请求重置棋盘，是否同意？`,
      confirmText: '同意',
      showCancel: true,
      onConfirm: () => emit('reset_confirm'),
      onCancel: () => emit('reset_reject', { requestId: data.requestId }),
    });
  }));

  // 服务端确认重置后广播 'reset'，双方重建标准开局
  offs.push(eventBus.on('game:reset', () => {
    gameOver = false;
    lastWinnerText = '';
    lastOwnMove = null;
    lastUndoMove = null;
    pauseCtrl.setPaused(false);
    gameStart = Date.now();
    selected = null;
    clearHintMarkers();
    board.reset();
    turn = RED; // 红先
    updateTurn();
    updateTimer();
    moveLog.clear('棋盘已重置');
    moveLog.setWinner('');
    statsPanel.setWinner('');
    updateMoveCount();
    statsPanel.refresh();
    sfx.play('click');
    toast.success('🔄 游戏已重置');
  }));

  // 重置请求被接受（请求方）
  offs.push(eventBus.on('game:resetAccepted', (data) => {
    toast.success(data?.message || '对方已同意重置游戏');
  }));

  // 重置请求被拒绝
  offs.push(eventBus.on('game:resetRejected', (data) => {
    toast.error(data?.message || '对方拒绝了重置请求');
  }));

  // 重置请求超时
  offs.push(eventBus.on('game:resetRequestTimeout', (data) => {
    toast.warn(data?.message || '重置请求超时，对方未回应');
  }));

  resignBtn.addEventListener('click', doResign);
  resetBtn.addEventListener('click', doReset);
  rulesBtn.addEventListener('click', () => showRules('chinese-chess'));
  statsBtn.addEventListener('click', doStats);
  exportBtn.addEventListener('click', doExport);
  leaveBtn.addEventListener('click', doBack);

  const gameKeys = bindGameKeys({
    isPaused: () => paused,
    setPaused: (v) => {
      if (gameOver) return;
      pauseCtrl.setPaused(v);
      toast.info(v ? '⏸ 已暂停，按 P 继续' : '▶ 已继续');
    },
    handlers: {
      undo: doUndo,
      redo: doRedo,
      resign: doResign,
      newGame: doReset,
      rematch: doRematch,
      back: doBack,
      rules: () => showRules('chinese-chess'),
    },
  });

  // 启动计时器
  updateTurn();
  updateTimer();
  timerHandle = setInterval(updateTimer, 1000);

  activeMatch = {
    container,
    board,
    gameId,
    opponentId,
    me,
    get gameOver() { return gameOver; },
    cleanup() {
      if (stateSyncOff) { stateSyncOff(); stateSyncOff = null; }
      if (stateSyncTimer) clearTimeout(stateSyncTimer);
      offs.forEach((off) => off());
      if (timerHandle) clearInterval(timerHandle);
      try { gameKeys.destroy(); } catch { /* noop */ }
      try { latencyProbe.destroy(); } catch { /* noop */ }
      try { pauseCtrl.destroy(); } catch { /* noop */ }
      try { statsPanel.destroy(); } catch { /* noop */ }
      container.innerHTML = '';
      board.destroy();
    },
  };

  return activeMatch;
}

/** 清理当前对局（含切换视图/重新匹配时） */
export function cleanupMatch() {
  if (activeMatch) {
    activeMatch.cleanup();
    activeMatch = null;
  }
}
