/**
 * 五子棋联机对局控制器（任务 2.3）
 * 匹配成功后进入对局房间：
 * - 2.3.1 联机落子同步：本地落子 emit('move')，订阅 game:move 渲染对手落子
 * - 2.3.2 对局房间：信息栏（对手信息、当前回合/先手方、计时器、返回大厅）
 * - 2.3.3 游戏结束：订阅 game:ended / lobby:opponentLeft 展示胜负并返回大厅
 *
 * 协议与 v1 一致（见附录 A）：
 * - 匹配成功 match_success → { gameId, opponentId, color }（color: 1 黑 / 2 白）
 * - 落子 socket.emit('move', { r, c, game: 'gobang' })；服务端转发对手 move 事件（含 from/color）
 * - 游戏结束服务端广播 game_ended → { gameId, result, winner, reason, ... }
 * - 返回大厅 socket.emit('return_lobby')
 */
import { createBoard, BLACK, WHITE } from './board.js';
import { checkWin } from './rules.js';
import { requestUndo, requestHint, clearHintMarkers, showHintMarker } from '../board-actions.js';
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { store } from '../../core/store.js';
import { go } from '../../core/router.js';
import { sfx } from '../../core/sfx.js';
import { showRules } from '../rules-dialog.js';
import { bindGameKeys } from '../game-keys.js';
import { createMoveLog, exportGameData } from '../move-log.js';
import {
  createInfoTags, createLatencyProbe, createStatsPanel, createPauseController, computeMaxChain,
} from '../game-hud.js';

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
 * 开始五子棋联机对局（匹配成功时调用）
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @param {{ gameId: string, opponentId: string|number, color: number, opponentName?: string }} matchData
 * @returns {Object} 对局句柄（含 cleanup）
 */
export function startMatch(container, matchData) {
  cleanupMatch(); // 清理旧对局

  const { gameId, opponentId, color, opponentNickname, opponentName } = matchData;
  const me = color === WHITE ? WHITE : BLACK; // 1 黑 / 2 白
  let gameOver = false;
  let gameStart = Date.now();
  let timerHandle = null;
  // 阶段 A：暂停 / 记录 / 重做
  let paused = false;
  let lastOwnMove = null;
  let lastUndoMove = null;
  let lastWinnerText = '';

  // ---- 信息栏（2.3.2）----
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
    gameType: 'gobang',
    me,
    opponentName: opponentNickname || opponentName || opponentId,
  });
  const statsPanel = createStatsPanel({
    gameType: 'gobang',
    getBoard: () => board.board,
    getEntries: () => moveLog.getEntries(),
  });

  function updateMoveCount() {
    moveCountEl.textContent = `🖐 手数：${moveLog.size()}`;
  }

  function updateTurn() {
    const name = board.turn === BLACK ? '黑棋' : '白棋';
    const mine = board.turn === me;
    turnEl.textContent = mine ? `● 我的回合（${name}）` : `○ 对方回合（${name}）`;
    turnEl.style.color = mine ? 'var(--theme-accent)' : 'inherit';
    turnEl.style.fontWeight = mine ? 'bold' : 'normal';
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - gameStart - (pauseCtrl ? pauseCtrl.getPausedMs() : 0)) / 1000);
    timerEl.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  oppEl.textContent = `👤 对手：${opponentNickname || opponentName || opponentId || '未知'}`;

  // ---- 棋盘（对局模式：onPlace 由控制器接管）----
  const boardEl = document.createElement('div');
  const board = createBoard(boardEl, {
    onPlace: (r, c) => {
      performOwnPlace(r, c);
    },
  });
  board.turn = BLACK; // 黑先（服务端约定 1 黑先行）

  /** 己方落子统一入口（本地点击 / Shift+Z 重做共用） */
  function performOwnPlace(r, c) {
    if (paused) return false;
    if (gameOver) return false;
    if (board.turn !== me) {
      toast.warn('还没轮到你落子');
      sfx.play('error');
      return false;
    }
    if (board.board[r]?.[c] !== 0) {
      toast.warn('该位置已有棋子');
      sfx.play('error');
      return false;
    }
    clearHintMarkers(boardEl); // 落子后清除提示标记（对齐 v1）
    board.place(r, c, me);
    emit('move', { r, c, game: 'gobang' }); // 2.3.1 发送落子
    board.turn = 3 - me; // 切换到对方回合
    updateTurn();
    lastOwnMove = { r, c };
    lastUndoMove = null;
    moveLog.add({ color: me, isSelf: true, r, c });
    updateMoveCount();
    statsPanel.refresh();
    sfx.play('place');
    // 本地即时提示（正式结果以服务端 game:ended 为准）
    if (checkWin(board.board, r, c, me)) {
      toast.success('五连！等待结果确认…');
    }
    return true;
  }

  // 恢复后同步最新对局状态（get_current_game 返回服务端实时快照）
  let stateSyncOff = null;
  let stateSyncTimer = null;

  // 对局重连恢复：用服务端快照重建棋盘与当前回合
  if (matchData.snapshot && matchData.snapshot.board) {
    board.restore(matchData.snapshot.board, matchData.snapshot.currentPlayer);
    // 快照可能在重连窗口内过期：对方恰好在这期间落子时，game:move 事件
    // 因尚未订阅而丢失，恢复出的回合会停留在"等对方落子"，造成双方互等。
    // 主动向服务端确认最新棋盘与回合，用权威状态校正。
    syncLatestState();
  }

  function syncLatestState() {
    if (stateSyncOff) return; // 已在同步中
    stateSyncOff = eventBus.on('game:currentGame', (data) => {
      if (!data || data.gameType !== 'gobang') return;
      if (data.gameId != null && String(data.gameId) !== String(gameId)) return;
      if (data.board && Array.isArray(data.board)) {
        board.restore(data.board, data.currentPlayer);
      } else if (data.currentPlayer) {
        board.turn = data.currentPlayer;
      }
      updateTurn();
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

  // ---- 阶段 A：暂停 / 延迟 / 快捷键 ----
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

  // 自适应棋盘尺寸：以棋盘容器实际可用空间为准，兼容纵向（手机）和分栏（平板/桌面）布局
  const fitBoardSize = () => {
    const stage = container.querySelector('.game-stage');
    const boardContainer = container.querySelector('.game-board-container');
    const board = container.querySelector('.gobang-board');
    if (!stage || !boardContainer || !board) return;

    // 清除 board.js 中 fitBoard() 可能设置的 zoom，统一由本函数控制尺寸
    board.style.zoom = '';

    // 棋盘实际宽度公式：19 * cellSize + cellSize(两侧半格padding合计) + 8(边框) = 20 * cellSize + 8
    // 使用容器 clientWidth，回退到 stage 或 container 宽度
    const availableWidth = boardContainer.clientWidth || stage.clientWidth || container.clientWidth;
    const availableHeight = boardContainer.clientHeight || stage.clientHeight || container.clientHeight;
    if (availableWidth <= 0) return;

    const padding = 8;
    const cols = 20; // 19格 + 1格padding
    const rows = 20;

    const cellByWidth = Math.floor((availableWidth - padding) / cols);
    const cellByHeight = Math.floor((availableHeight - padding) / rows);
    let cellSize = Math.min(cellByWidth, cellByHeight);

    // 限制范围：小屏不低于12px（保证最基本触控），大屏不超过42px
    cellSize = Math.max(12, Math.min(cellSize, 42));
    board.style.setProperty('--board-cell-size', cellSize + 'px');
    // 显式设置棋盘总尺寸（border-box，含 padding + border）
    board.style.width = `calc(${cols} * ${cellSize}px + ${padding}px)`;
    board.style.height = `calc(${rows} * ${cellSize}px + ${padding}px)`;
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

  // ---- socket 事件（2.3.1 / 2.3.3）----
  const offs = [];

  // 对手落子
  offs.push(eventBus.on('game:move', (data) => {
    if (gameOver) return;
    if (data.game && data.game !== 'gobang') return;
    // 跳过自己的落子（服务端一般不会回发给自己，防御性过滤）
    if (data.from != null && String(data.from) === String(currentAccountId())) return;
    if (data.r == null || data.c == null) return;
    if (board.board[data.r]?.[data.c] !== 0) return; // 位置已占用
    const color = data.color === WHITE ? WHITE : BLACK;
    board.place(data.r, data.c, color);
    board.turn = me; // 轮到我了
    updateTurn();
    moveLog.add({ color, isSelf: false, r: data.r, c: data.c });
    updateMoveCount();
    statsPanel.refresh();
    sfx.play('place');
    if (checkWin(board.board, data.r, data.c, color)) {
      toast.info('对方已形成五连！');
    }
  }));

  // 游戏结束（2.3.3）
  offs.push(eventBus.on('game:ended', (data) => {
    if (gameId != null && data.gameId != null && String(data.gameId) !== String(gameId)) return;
    if (gameOver) return;
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);

    const myId = currentAccountId();
    const iWon = data.result !== 'draw' && String(data.winner) === String(myId);
    lastWinnerText = data.result === 'draw' ? 'draw' : (iWon ? 'me' : 'opponent');
    moveLog.setWinner(lastWinnerText);
    statsPanel.setWinner(lastWinnerText);
    if (iWon) sfx.play('win');

    let msg;
    if (data.result === 'win') {
      msg = String(data.winner) === String(myId) ? '🎉 你获胜了！' : '😢 你输了！';
    } else if (data.result === 'draw') {
      msg = '🤝 平局！';
    } else if (data.result === 'resign') {
      msg = String(data.winner) === String(myId) ? '🎉 对方认输，你获胜了！' : '😢 你认输了！';
    } else if (data.result === 'timeout') {
      msg = '⏰ 游戏超时！';
    } else {
      msg = '🛑 游戏已结束';
    }

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

  // ---- 悔棋（2.4.1，含库存检查与道具卡消耗，对齐 v1 requestUndo）----
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
    if (board.turn !== me) { toast.warn('还没轮到你落子'); sfx.play('error'); return; }
    const mv = lastUndoMove;
    if (performOwnPlace(mv.r, mv.c)) {
      toast.success('↪️ 已重做上一步');
    }
  }

  // ---- 认输（2.4.2）----
  function doResign() {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束'); return; }
    modal.show({
      title: '认输',
      content: '确定要认输吗？',
      confirmText: '认输',
      showCancel: true,
      onConfirm: () => {
        // 服务端没有 'resign' 事件监听，认输走 game_result（与 v1 落子获胜上报一致）
        emit('game_result', { result: 'resign', reason: '主动认输' });
        toast.info('🏳️ 已认输，等待结果…');
      },
    });
  }

  // ---- 重置（2.4.3）----
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

  function doRules() {
    showRules('gobang');
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
      gameType: 'gobang',
      me,
      opponentId,
      entries: moveLog.getEntries(),
      durationSec: (Date.now() - gameStart - pauseCtrl.getPausedMs()) / 1000,
      winner: lastWinnerText,
      maxChain: computeMaxChain(board.board),
    });
    if (!data) {
      toast.warn('暂无可导出的着法');
      sfx.play('error');
      return;
    }
    toast.success('📤 已导出对局数据');
  }

  function doRematch() {
    sfx.play('click');
    modal.show({
      title: '重新匹配',
      content: '将结束当前对局并重新匹配五子棋，确定继续？',
      confirmText: '重新匹配',
      showCancel: true,
      onConfirm: () => {
        emit('return_lobby');
        eventBus.emit('games:rematch', 'gobang');
      },
    });
  }

  leaveBtn.addEventListener('click', doBack);
  undoBtn.addEventListener('click', doUndo);
  hintBtn.addEventListener('click', () => {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束'); return; }
    if (board.turn !== me) { toast.warn('还没轮到你落子'); sfx.play('error'); return; }
    requestHint(() => {
      emit('request_hint');
      toast.info('💡 正在计算最佳位置...');
    });
  });
  resignBtn.addEventListener('click', doResign);
  resetBtn.addEventListener('click', doReset);
  rulesBtn.addEventListener('click', doRules);
  statsBtn.addEventListener('click', doStats);
  exportBtn.addEventListener('click', doExport);

  // 阶段 A：对局快捷键（Z / Shift+Z / U / N / P / M / R / T）
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
      rules: doRules,
    },
  });

  // 提示结果：高亮推荐落子位置
  offs.push(eventBus.on('game:hintResult', (data) => {
    if (data.gameType && data.gameType !== 'gobang') return;
    showHintMarker(boardEl, data.move);
    toast.info(data.reason || '💡 建议位置');
  }));

  // 提示次数不足
  offs.push(eventBus.on('game:hintDeduct', (data) => {
    if (data && data.success === false && data.message) toast.warn(data.message);
  }));

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

  // 悔棋成功：用服务端完整棋盘数据恢复
  offs.push(eventBus.on('game:undoAccepted', (data) => {
    if (data.gameType && data.gameType !== 'gobang') return;
    toast.success('✅ 悔棋成功！');
    // 记录被撤销的己方着法，供 Shift+Z 重做（服务端无 redo 协议）
    lastUndoMove = lastOwnMove;
    lastOwnMove = null;
    if (data.board) board.restore(data.board, data.currentPlayer);
    gameOver = false;
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

  // 服务端确认重置后广播 'reset'（EVENT_MAP → game:reset），双方重建空棋盘
  offs.push(eventBus.on('game:reset', () => {
    gameOver = false;
    lastWinnerText = '';
    lastOwnMove = null;
    lastUndoMove = null;
    pauseCtrl.setPaused(false);
    gameStart = Date.now();
    board.reset();
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
