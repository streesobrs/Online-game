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
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { go } from '../../core/router.js';

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

  // ---- 信息栏 ----
  const turnEl = el('span', { class: 'gobang-info-tag' });
  const oppEl = el('span', { class: 'gobang-info-tag' });
  const timerEl = el('span', { class: 'gobang-info-tag' });
  const undoBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '⏪ 悔棋');
  const hintBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '💡 提示');
  const resignBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '🏳️ 认输');
  const resetBtn = el('button', { class: 'btn btn-secondary', style: 'padding:4px 12px;font-size:13px;' }, '🔄 重置');
  const leaveBtn = el('button', { class: 'btn btn-secondary', style: 'margin-left:auto;padding:4px 12px;font-size:13px;' }, '返回大厅');

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
    const s = Math.floor((Date.now() - gameStart) / 1000);
    timerEl.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  oppEl.textContent = `👤 对手：${opponentNickname || opponentName || opponentId || '未知'}`;

  // ---- 棋盘（对局模式：onCellClick 由控制器接管选子/走子）----
  const boardEl = document.createElement('div');
  const board = createChessBoard(boardEl, {
    // 黑方视角：棋盘 180° 旋转，黑棋显示在下方（坐标不变，走子协议不受影响）
    flip: me === BLACK,
    onCellClick: (r, c) => {
      if (gameOver) return;
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
    if (turn !== me) { toast.warn('还没轮到你走子'); return; }
    const moving = board.get(fromR, fromC);
    if (!moving) return;
    board.movePiece(fromR, fromC, toR, toC);
    board.setLastMove(toR, toC);
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
    // 走完后检查对方是否被将军（将死由服务端判定并广播 game_ended）
    if (isInCheck(board.board, colorOf(turn))) toast.warn('⚔️ 将军！');
    updateTurn();
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

  container.innerHTML = '';
  container.append(infoBar(), boardEl);

  function infoBar() {
    const bar = el('div', {
      class: 'gobang-match-info',
      style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;max-width:724px;width:100%;',
    }, [turnEl, oppEl, timerEl, undoBtn, hintBtn, resignBtn, resetBtn, leaveBtn]);
    return bar;
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
    board.movePiece(data.fromR, data.fromC, data.toR, data.toC);
    board.setLastMove(data.toR, data.toC);
    turn = me; // 轮到我了
    clearHintMarkers();
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

  // 认输
  resignBtn.addEventListener('click', () => {
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
  });

  // ---- 悔棋（与 v1 一致：undo_request → 对手同意 → undo_accepted 恢复棋盘）----
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

  // 悔棋成功：用服务端完整棋盘数据恢复（board 为后端格式 'r-ju'/'b-jiang'，需转换）
  offs.push(eventBus.on('game:undoAccepted', (data) => {
    if (data.gameType && data.gameType !== 'chinese-chess') return;
    toast.success('✅ 悔棋成功！');
    if (data.board) board.init(backendBoardToV2(data.board));
    turn = data.currentPlayer || turn; // 悔棋后轮到请求方走子
    gameOver = false;
    selected = null;
    clearHintMarkers();
    updateTurn();
  }));

  // 悔棋被拒绝
  offs.push(eventBus.on('game:undoRejected', (data) => {
    toast.error(data?.message || '悔棋请求被拒绝');
  }));

  // ---- 提示（与 v1 一致：request_hint → 服务端 AI 计算 → hint_result 高亮走法）----
  hintBtn.addEventListener('click', () => {
    if (gameOver) { toast.warn('游戏已结束'); return; }
    if (turn !== me) { toast.warn('还没轮到你走子'); return; }
    emit('request_hint');
    toast.info('💡 正在计算最佳走法…');
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

  // ---- 重置（与 v1 一致：reset → 对方确认 → 服务端广播 reset）----
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

  // 服务端确认重置后广播 'reset'，双方重建标准开局
  offs.push(eventBus.on('game:reset', () => {
    gameOver = false;
    gameStart = Date.now();
    selected = null;
    clearHintMarkers();
    board.reset();
    turn = RED; // 红先
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
