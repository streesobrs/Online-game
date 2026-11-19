/**
 * 围棋联机对局控制器（任务 3.1.3）
 * 匹配成功后进入对局房间：
 * - 落子同步：本地 tryPlace 提子后 emit('move', { r, c, game: 'go' })，订阅 game:move 本地提子渲染对手落子
 * - 提子/自杀/打劫在客户端本地处理（服务端 executeGoMove 只落子，checkGoWin 恒 false，与 v1 一致）
 * - 终局：棋盘填满 ≥95% 或双方均无合法手 → game_result { result:'win', reason:'棋盘填满' }（v1 同款）
 * - 认输：game_result { result:'resign' }（服务端无 resign 事件，走 handleGameResult，与五子棋一致）
 *
 * 协议与 v1 一致（见附录 A）：
 * - 匹配成功 match_success → { gameId, opponentId, color }（color: 1 黑 / 2 白）
 * - 落子 socket.emit('move', { r, c, game: 'go' })；服务端转发对手 move 事件（含 from/color）
 * - 游戏结束服务端广播 game_ended → { gameId, result, winner, reason, ... }
 */
import { createBoard, BLACK, WHITE, EMPTY } from './board.js';
import { tryPlace, countScore } from './rules.js';
import { requestUndo, requestHint, clearHintMarkers, showHintMarker } from '../board-actions.js';
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
 * 开始围棋联机对局（匹配成功时调用）
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @param {{ gameId: string, opponentId: string|number, color: number, opponentNickname?: string }} matchData
 * @returns {Object} 对局句柄（含 cleanup）
 */
export function startMatch(container, matchData) {
  cleanupMatch(); // 清理旧对局

  const { gameId, opponentId, color, opponentNickname, opponentName } = matchData;
  const me = color === WHITE ? WHITE : BLACK; // 1 黑 / 2 白
  let gameOver = false;
  let gameStart = Date.now();
  let timerHandle = null;
  let koPosition = null; // 打劫位置
  let koColor = null;    // 被禁落子方（被提子颜色，与 v1 gameState.koColor 一致）
  // 阶段 A：暂停 / 记录 / 重做
  let paused = false;
  let lastOwnMove = null;
  let lastUndoMove = null;
  let lastWinnerText = '';

  // ---- 信息栏 ----
  const turnEl = el('span', { class: 'go-info-tag' });
  const oppEl = el('span', { class: 'go-info-tag' });
  const timerEl = el('span', { class: 'go-info-tag' });
  const { moveCountEl, latencyEl } = createInfoTags('go-info-tag');
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
    gameType: 'go',
    me,
    opponentName: opponentNickname || opponentName || opponentId,
  });
  const statsPanel = createStatsPanel({
    gameType: 'go',
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

  /** 打劫检查（与 v1 isKo 一致：上一手只提一子形成的劫位，对方不能立即回提） */
  function isKo(r, c, color) {
    return !!(koPosition && koPosition.r === r && koPosition.c === c && koColor === color);
  }

  /** 落子流程（自己与对手共用）：打劫检查 → tryPlace（落子+提对方+自杀检查）→ 增量渲染 → 更新劫位 */
  function applyMove(r, c, color) {
    if (isKo(r, c, color)) return { ok: false, ko: true };
    const res = tryPlace(board.board, r, c, color);
    if (!res.ok) return { ok: false, suicide: true };

    res.captured.forEach((s) => board.removeStone(s.r, s.c));
    board.place(r, c, color);

    if (res.captured.length === 1) {
      koPosition = { r: res.captured[0].r, c: res.captured[0].c };
      koColor = 3 - color;
    } else {
      koPosition = null;
      koColor = null;
    }
    return { ok: true, captured: res.captured };
  }

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
    clearHintMarkers(boardEl); // 落子后清除提示标记（对齐 v1）
    const mv = applyMove(r, c, me);
    if (!mv.ok) {
      if (mv.ko) toast.warn('❌ 打劫，不能立即回提');
      else toast.warn('该位置无法落子（自杀或已占用）');
      sfx.play('error');
      return false;
    }
    emit('move', { r, c, game: 'go' }); // 发送落子
    board.turn = 3 - me; // 切换到对方回合
    updateTurn();
    lastOwnMove = { r, c };
    lastUndoMove = null;
    moveLog.add({ color: me, isSelf: true, r, c });
    updateMoveCount();
    statsPanel.refresh();
    if (mv.captured.length > 0) {
      toast.info(`⚫⚪ 提子 ${mv.captured.length} 颗`);
      sfx.play('capture');
    } else {
      sfx.play('place');
    }
    checkGoEnd();
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
      if (!data || data.gameType !== 'go') return;
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
    const board = container.querySelector('.go-board');
    if (!stage || !boardContainer || !board) return;

    // 清除 board.js 中 fitBoard() 可能设置的 zoom
    board.style.zoom = '';

    // 围棋实际宽度公式：21 * cellSize + cellSize(两侧半格padding合计) + 8(边框) = 22 * cellSize + 8
    const availableWidth = boardContainer.clientWidth || stage.clientWidth || container.clientWidth;
    const availableHeight = boardContainer.clientHeight || stage.clientHeight || container.clientHeight;
    if (availableWidth <= 0) return;

    const padding = 8;
    const cols = 22; // 21格 + 1格padding
    const rows = 22;

    const cellByWidth = Math.floor((availableWidth - padding) / cols);
    const cellByHeight = Math.floor((availableHeight - padding) / rows);
    let cellSize = Math.min(cellByWidth, cellByHeight);

    cellSize = Math.max(12, Math.min(cellSize, 42));
    board.style.setProperty('--board-cell-size', cellSize + 'px');
    // 显式设置棋盘总尺寸（border-box）
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

  // ---- 终局判定（与 v1 checkGoWin 一致：填满 ≥95% 或双方均无合法手）----
  function hasValidMove(color) {
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        if (board.board[r][c] === EMPTY && tryPlace(board.board, r, c, color).ok) {
          return true; // tryPlace 不可变，不污染当前棋盘
        }
      }
    }
    return false;
  }

  function checkGoEnd() {
    let filled = 0;
    for (let r = 0; r < board.size; r++) {
      for (let c = 0; c < board.size; c++) {
        if (board.board[r][c] !== EMPTY) filled++;
      }
    }
    if (filled >= board.size * board.size * 0.95) return finishGo('win');
    if (!hasValidMove(BLACK) && !hasValidMove(WHITE)) return finishGo('win');
  }

  function finishGo(result) {
    if (gameOver) return;
    gameOver = true;
    if (timerHandle) clearInterval(timerHandle);
    emit('game_result', { result, reason: '棋盘填满' });
    toast.success('棋盘已满/无合法落子！等待结果确认…');
    showScoreModal(); // 本地点目展示（复刻 v1 showGameResult）
  }

  /** 点目弹窗（复刻 v1 showGameResult：黑/白分数、子数、领地、贴目 7.5、胜负差） */
  function showScoreModal() {
    const score = countScore(board.board);
    const winner = score.black > score.white ? '黑棋' : '白棋';
    const diff = Math.abs(score.black - score.white).toFixed(1);

    const card = (name, total, stones, terr, komiText, dark) => {
      const style = dark
        ? 'background:#212529;color:#fff;padding:12px 16px;border-radius:8px;flex:1;text-align:center;'
        : 'background:#fff;color:#212529;padding:12px 16px;border-radius:8px;border:2px solid #ced4da;flex:1;text-align:center;';
      return el('div', { style }, [
        el('div', { style: 'font-size:15px;font-weight:bold;' }, name),
        el('div', { style: 'font-size:28px;font-weight:bold;margin:6px 0;' }, total.toFixed(1)),
        el('div', { style: 'font-size:13px;opacity:.85;' }, `子数：${stones}`),
        el('div', { style: 'font-size:13px;opacity:.85;' }, `领地：${terr.toFixed(1)}`),
        ...(komiText ? [el('div', { style: 'font-size:12px;opacity:.7;margin-top:4px;' }, komiText)] : []),
      ]);
    };

    const content = el('div', { style: 'text-align:center;' }, [
      el('h2', { style: 'margin:0 0 14px;' }, `${winner}获胜！`),
      el('div', { style: 'display:flex;gap:12px;margin-bottom:14px;' }, [
        card('黑棋', score.black, score.blackStones, score.black - score.blackStones, null, true),
        card('白棋', score.white, score.whiteStones, score.white - score.whiteStones, '贴目：7.5', false),
      ]),
      el('div', { style: 'font-size:16px;font-weight:bold;' }, `胜负差：${diff}子`),
    ]);

    modal.show({
      title: '🏁 游戏结束 - 数子结果',
      content,
      confirmText: '返回大厅',
      showCancel: false,
      onConfirm: () => {
        // 通知服务端释放用户状态（否则停留 playing，无法再次匹配）
        emit('return_lobby');
        go('lobby');
      },
    });
  }

  // ---- socket 事件 ----
  const offs = [];

  // 对手落子
  offs.push(eventBus.on('game:move', (data) => {
    if (gameOver) return;
    if (data.game && data.game !== 'go') return;
    if (data.from != null && String(data.from) === String(currentAccountId())) return; // 防御性过滤
    if (data.r == null || data.c == null) return;
    if (board.board[data.r]?.[data.c] !== EMPTY) return; // 位置已占用（服务端只落子，双方本地提子应一致）

    clearHintMarkers(boardEl); // 对手落子同样清除提示标记
    const color = data.color === WHITE ? WHITE : BLACK;
    const mv = applyMove(data.r, data.c, color);
    if (!mv.ok) return; // 对方合法落子理论上不应出现，防御性跳过
    board.turn = me; // 轮到我了
    updateTurn();
    moveLog.add({ color, isSelf: false, r: data.r, c: data.c });
    updateMoveCount();
    statsPanel.refresh();
    if (mv.captured.length > 0) {
      toast.info(`⚫⚪ 对方提子 ${mv.captured.length} 颗`);
      sfx.play('capture');
    } else {
      sfx.play('place');
    }
    checkGoEnd();
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
    } else if (data.result === 'timeout') {
      msg = '⏰ 游戏超时！';
    } else {
      msg = '🛑 游戏已结束';
    }

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

  // 悔棋成功：用服务端完整棋盘数据恢复（打劫状态重置）
  offs.push(eventBus.on('game:undoAccepted', (data) => {
    if (data.gameType && data.gameType !== 'go') return;
    toast.success('✅ 悔棋成功！');
    // 记录被撤销的己方着法，供 Shift+Z 重做（服务端无 redo 协议）
    lastUndoMove = lastOwnMove;
    lastOwnMove = null;
    if (data.board) board.restore(data.board, data.currentPlayer);
    koPosition = null;
    koColor = null;
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

  // ---- 提示（对齐 v1：库存检查 → request_hint → hint_result 高亮推荐落子）----
  hintBtn.addEventListener('click', () => {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束'); return; }
    if (board.turn !== me) { toast.warn('还没轮到你落子'); sfx.play('error'); return; }
    requestHint(() => {
      emit('request_hint');
      toast.info('💡 正在计算最佳位置...');
    });
  });

  // 提示结果：高亮推荐落子位置
  offs.push(eventBus.on('game:hintResult', (data) => {
    if (data.gameType && data.gameType !== 'go') return;
    showHintMarker(boardEl, data.move);
    toast.info(data.reason || '💡 建议位置');
  }));

  // 提示次数不足
  offs.push(eventBus.on('game:hintDeduct', (data) => {
    if (data && data.success === false && data.message) toast.warn(data.message);
  }));

  function doResign() {
    sfx.play('click');
    if (gameOver) { toast.warn('游戏已结束'); return; }
    modal.show({
      title: '认输',
      content: '确定要认输吗？',
      confirmText: '认输',
      showCancel: true,
      onConfirm: () => {
        emit('game_result', { result: 'resign', reason: '主动认输' });
        toast.info('🏳️ 已认输，等待结果…');
      },
    });
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
      gameType: 'go',
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
      content: '将结束当前对局并重新匹配围棋，确定继续？',
      confirmText: '重新匹配',
      showCancel: true,
      onConfirm: () => {
        emit('return_lobby');
        eventBus.emit('games:rematch', 'go');
      },
    });
  }

  undoBtn.addEventListener('click', doUndo);
  resignBtn.addEventListener('click', doResign);
  resetBtn.addEventListener('click', doReset);
  rulesBtn.addEventListener('click', () => showRules('go'));
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
      rules: () => showRules('go'),
    },
  });

  // 收到对方重置请求
  offs.push(eventBus.on('game:resetRequest', (data) => {
    if (gameOver) return;
    const isRematch = data.message && data.message.includes('再来一局');
    modal.show({
      title: isRematch ? '再来一局请求' : '重置棋盘请求',
      content: isRematch ? `${data.message}，是否同意？` : '对方请求重置棋盘，是否同意？',
      confirmText: '同意',
      showCancel: true,
      onConfirm: () => emit('reset_confirm'),
      onCancel: () => emit('reset_reject', { requestId: data.requestId }),
    });
  }));

  // 服务端确认重置
  offs.push(eventBus.on('game:reset', () => {
    gameOver = false;
    lastWinnerText = '';
    lastOwnMove = null;
    lastUndoMove = null;
    koPosition = null;
    koColor = null;
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

  offs.push(eventBus.on('game:resetAccepted', (data) => {
    toast.success(data?.message || '对方已同意重置游戏');
  }));
  offs.push(eventBus.on('game:resetRejected', (data) => {
    toast.error(data?.message || '对方拒绝了重置请求');
  }));
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
