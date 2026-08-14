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
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { store } from '../../core/store.js';
import { go } from '../../core/router.js';

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

  // ---- 信息栏（2.3.2）----
  const turnEl = el('span', { class: 'gobang-info-tag' });
  const oppEl = el('span', { class: 'gobang-info-tag' });
  const timerEl = el('span', { class: 'gobang-info-tag' });
  const undoBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '⏪ 悔棋');
  const resignBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '🏳️ 认输');
  const resetBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '🔄 重置');
  const leaveBtn = el('button', { class: 'btn btn-secondary', style: 'margin-left:auto;padding:4px 12px;font-size:13px;' }, '返回大厅');

  function updateTurn() {
    const name = board.turn === BLACK ? '黑棋' : '白棋';
    const mine = board.turn === me;
    turnEl.textContent = mine ? `● 我的回合（${name}）` : `○ 对方回合（${name}）`;
    turnEl.style.color = mine ? 'var(--theme-accent)' : 'inherit';
    turnEl.style.fontWeight = mine ? 'bold' : 'normal';
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - gameStart) / 1000);
    timerEl.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  oppEl.textContent = `👤 对手：${opponentNickname || opponentName || opponentId || '未知'}`;

  // ---- 棋盘（对局模式：onPlace 由控制器接管）----
  const boardEl = document.createElement('div');
  const board = createBoard(boardEl, {
    onPlace: (r, c) => {
      if (gameOver) return;
      if (board.turn !== me) { toast.warn('还没轮到你落子'); return; }
      board.place(r, c, me);
      emit('move', { r, c, game: 'gobang' }); // 2.3.1 发送落子
      board.turn = 3 - me; // 切换到对方回合
      updateTurn();
      // 本地即时提示（正式结果以服务端 game:ended 为准）
      if (checkWin(board.board, r, c, me)) {
        toast.success('五连！等待结果确认…');
      }
    },
  });
  board.turn = BLACK; // 黑先（服务端约定 1 黑先行）

  container.innerHTML = '';
  container.append(infoBar(), boardEl);

  function infoBar() {
    const bar = el('div', {
      class: 'gobang-match-info',
      style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;max-width:724px;width:100%;',
    }, [turnEl, oppEl, timerEl, undoBtn, resignBtn, resetBtn, leaveBtn]);
    return bar;
  }

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

  // 返回大厅按钮
  leaveBtn.addEventListener('click', () => {
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
  });

  // ---- 悔棋（2.4.1）----
  undoBtn.addEventListener('click', () => {
    if (gameOver) { toast.warn('游戏已结束，无法悔棋'); return; }
    emit('undo_request');
    toast.info('⏪ 已发送悔棋请求…');
  });

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
    if (data.board) board.restore(data.board, data.currentPlayer);
    gameOver = false;
    updateTurn();
  }));

  // 悔棋被拒绝
  offs.push(eventBus.on('game:undoRejected', (data) => {
    toast.error(data?.message || '悔棋请求被拒绝');
  }));

  // ---- 认输（2.4.2）----
  resignBtn.addEventListener('click', () => {
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
  });

  // ---- 重置（2.4.3）----
  resetBtn.addEventListener('click', () => {
    if (gameOver) { toast.warn('游戏已结束'); return; }
    modal.show({
      title: '重置游戏',
      content: '请求重置棋盘？',
      confirmText: '请求重置',
      showCancel: true,
      onConfirm: () => emit('reset'),
    });
  });

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
    gameStart = Date.now();
    board.reset();
    updateTurn();
    updateTimer();
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
      offs.forEach((off) => off());
      if (timerHandle) clearInterval(timerHandle);
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
