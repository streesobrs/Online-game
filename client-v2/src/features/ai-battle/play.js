/**
 * AI 对局控制器（任务 4.4.2）
 * 从 AI 对战入口进入后开始对局：
 * - 玩家始终 color 1（五子棋/围棋黑方、象棋红方）先行
 * - 玩家落子 emit('ai_move') → 服务端先回执（含当前玩家回显），AI 思考后回执落子
 * - 结束：本地检测到胜负主动 emit('ai_game_result')；服务端判定后回发 ai_game_end
 *
 * 协议与 v1 一致（见开发文档附录 A）：
 * - 发起：emit('ai_game_start', {gameType, difficulty})
 * - 落子：gobang/go emit('ai_move', {position:{r,c}})；
 *         chinese-chess emit('ai_move', {position:{fromR,fromC,toR,toC,piece}})
 * - 回执：ai_move_result → {position, color, currentPlayer, board?}（象棋始终带 board）
 * - 结束：emit('ai_game_result', {result, gameType, difficulty, duration})；ai_game_end → {result,...}
 */
import { createBoard, BLACK, WHITE } from '../../games/gobang/board.js';
import { createBoard as createGoBoard } from '../../games/go/board.js';
import { createChessBoard } from '../../games/chinese-chess/board.js';
import { checkWin } from '../../games/gobang/rules.js';
import { getChessMoves, isValidMove, isCheckmate } from '../../games/chinese-chess/rules.js';
import { requestUndo, requestHint, clearHintMarkers, showHintMarker } from '../../games/board-actions.js';
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { go } from '../../core/router.js';

let activeBattle = null;

/** 当前是否有进行中的 AI 对局 */
export function isBattleActive() {
  return !!activeBattle;
}

/** 后端象棋棋子类型 → 中文名（与 v1 chessPieceMap 一致） */
const CHESS_TYPE_MAP = {
  ju: '车', ma: '马', xiang: '相', shi: '仕', shuai: '帅',
  pao: '炮', bing: '兵', jiang: '将', zu: '卒',
};

/** 后端象棋棋盘（字符串 'r-ju'/'b-jiang'）→ v2 对象格式 {name, color} */
function convertBackendBoardToFrontend(board) {
  if (!board) return null;
  const out = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = board[r] && board[r][c];
      if (cell && cell !== 0 && typeof cell === 'string') {
        const color = cell.startsWith('r-') ? 'red' : 'black';
        const name = CHESS_TYPE_MAP[cell.substring(2)] || cell.substring(2);
        out[r][c] = { name, color };
      }
    }
  }
  return out;
}

const DIFF_LABEL = { easy: '简单', medium: '中等', hard: '困难' };

/**
 * 开始 AI 对局
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @param {{ gameType: string, difficulty: 'easy'|'medium'|'hard', snapshot?: Object }} opts
 *        snapshot 为重连快照（战局内刷新后恢复）：提供时不再向服务端创建新对局，
 *        直接用快照重建棋盘与回合状态。
 */
export function startAIBattle(container, { gameType, difficulty, snapshot }) {
  cleanupBattle(); // 清理旧对局

  const me = 1; // 玩家始终 color 1
  let myTurn = true;
  let gameOver = false;
  let resultSent = false;
  let startTime = Date.now();
  let timerHandle = null;
  let selected = null; // 象棋选子

  // ---- 信息栏 ----
  const turnEl = el('span', { class: 'ai-info-tag' });
  const timerEl = el('span', { class: 'ai-info-tag' });
  const diffEl = el('span', { class: 'ai-info-tag' });
  const undoBtn = el('button', { class: 'btn btn-secondary' }, '⏪ 悔棋');
  const hintBtn = el('button', { class: 'btn btn-secondary' }, '💡 提示');
  const backBtn = el('button', { class: 'btn btn-secondary' }, '返回AI入口');

  function updateTurn() {
    if (gameOver) return;
    turnEl.textContent = myTurn ? '● 你的回合' : '🤖 AI思考中…';
    turnEl.style.color = myTurn ? 'var(--theme-accent, #3b82f6)' : 'inherit';
  }

  function updateTimer() {
    const s = Math.floor((Date.now() - startTime) / 1000);
    timerEl.textContent = `⏱ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  diffEl.textContent = `🎮 难度：${DIFF_LABEL[difficulty] || difficulty}`;

  // ---- 棋盘 ----
  const boardEl = document.createElement('div');
  let board = null;

  if (gameType === 'gobang') {
    board = createBoard(boardEl, {
      onPlace: (r, c) => {
        if (gameOver || !myTurn) { toast.warn('还没轮到你落子'); return; }
        clearHintMarkers(boardEl); // 落子后清除提示标记
        board.place(r, c, me);
        myTurn = false;
        updateTurn();
        emit('ai_move', { position: { r, c } });
        // 本地即时提示（正式结果以服务端 ai_game_end 为准）
        if (checkWin(board.board, r, c, me)) {
          toast.success('五连！等待结果确认…');
        }
      },
    });
    board.turn = BLACK; // 玩家黑先
  } else if (gameType === 'go') {
    board = createGoBoard(boardEl, {
      onPlace: (r, c) => {
        if (gameOver || !myTurn) { toast.warn('还没轮到你落子'); return; }
        clearHintMarkers(boardEl); // 落子后清除提示标记
        board.place(r, c, me);
        myTurn = false;
        updateTurn();
        emit('ai_move', { position: { r, c } });
      },
    });
    board.turn = BLACK;
  } else if (gameType === 'chinese-chess') {
    board = createChessBoard(boardEl, {
      onCellClick: (r, c) => {
        if (gameOver || !myTurn) return;
        const piece = board.get(r, c);
        // 已有选中棋子：尝试走子
        if (selected) {
          if (piece && piece.color === 'red') {
            // 改选己方棋子
            board.select(r, c);
            board.setValidMoves(getChessMoves(board.board, r, c));
            selected = { r, c };
            return;
          }
          if (isValidMove(board.board, selected.r, selected.c, r, c)) {
            const fromR = selected.r, fromC = selected.c;
            const pieceName = board.get(fromR, fromC).name;
            clearHintMarkers(boardEl); // 走子后清除提示标记
            board.movePiece(fromR, fromC, r, c);
            board.setLastMove(r, c);
            board.clearSelection();
            selected = null;
            myTurn = false;
            updateTurn();
            emit('ai_move', {
              position: { fromR, fromC, toR: r, toC: c, piece: pieceName },
            });
          }
          return;
        }
        // 选中己方红棋
        if (piece && piece.color === 'red') {
          board.select(r, c);
          board.setValidMoves(getChessMoves(board.board, r, c));
          selected = { r, c };
        }
      },
    });
  }

  container.innerHTML = '';
  container.append(
    el('div', { class: 'game-stage' }, [
      el('div', { class: 'game-status-bar' }, [
        el('div', { class: 'game-status-group' }, [turnEl, diffEl, timerEl]),
        el('div', { class: 'game-status-spacer' }),
        backBtn,
      ]),
      el('div', { class: 'game-board-container' }, [boardEl]),
      el('div', { class: 'game-tools-bar' }, [undoBtn, hintBtn]),
    ])
  );

  // 自适应棋盘尺寸 (根据游戏类型动态计算)：以棋盘容器实际可用空间为准
  const fitBoardSize = () => {
    const stage = container.querySelector('.game-stage');
    const boardContainer = container.querySelector('.game-board-container');
    if (!stage || !boardContainer) return;
    const board = boardContainer.querySelector('.gobang-board, .go-board, .chess-board');
    if (!board) return;

    // 清除 board.js 中 fitBoard() 可能设置的 zoom
    board.style.zoom = '';

    const availableWidth = boardContainer.clientWidth || stage.clientWidth || container.clientWidth;
    const availableHeight = boardContainer.clientHeight || stage.clientHeight || container.clientHeight;
    if (availableWidth <= 0) return;

    // 棋盘尺寸公式：
    //   五子棋: 19*cell + cell(两侧半格padding) + 8(边框) = 20*cell + 8
    //   围棋:  21*cell + cell + 8 = 22*cell + 8
    //   象棋:  9*cell + 48 (padding 40 + border 8)，border-box
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

  if (snapshot && snapshot.board) {
    // 重连恢复：服务端对局仍在，直接重建棋盘与回合，不再创建新对局
    if (gameType === 'chinese-chess') {
      const layout = convertBackendBoardToFrontend(snapshot.board);
      if (layout) board.init(layout);
    } else {
      board.restore(snapshot.board, snapshot.currentPlayer);
    }
    myTurn = (snapshot.currentPlayer === me);
    updateTurn();
    // 快照可能在重连窗口内过期：主动向服务端确认最新棋盘与回合，用权威状态校正
    syncLatestState();
  } else {
    // 通知服务端开始 AI 对战
    emit('ai_game_start', { gameType, difficulty });
  }

  function syncLatestState() {
    if (stateSyncOff) return; // 已在同步中
    stateSyncOff = eventBus.on('game:currentGame', (data) => {
      if (!data || data.gameType !== gameType) return;
      if (data.board && Array.isArray(data.board)) {
        if (gameType === 'chinese-chess') {
          const layout = convertBackendBoardToFrontend(data.board);
          if (layout) board.init(layout);
        } else {
          board.restore(data.board, data.currentPlayer);
        }
      }
      if (data.currentPlayer) {
        myTurn = data.currentPlayer === me;
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

  // ---- socket 事件 ----
  const offs = [];

  // 服务端开局回执（含棋盘，象棋需转换）
  offs.push(eventBus.on('ai:gameStart', (data) => {
    if (data.gameType && data.gameType !== gameType) return;
    if (gameType === 'chinese-chess' && data.board) {
      const layout = convertBackendBoardToFrontend(data.board);
      if (layout) board.init(layout);
    } else if (data.currentPlayer) {
      board.turn = data.currentPlayer;
    }
    myTurn = data.currentPlayer === me;
    updateTurn();
  }));

  // AI 移动结果
  offs.push(eventBus.on('ai:moveResult', (data) => {
    if (gameOver || resultSent) return;
    const { position, color, currentPlayer } = data;

    // 象棋：直接用服务端完整棋盘重建（含自己回显）
    if (gameType === 'chinese-chess' && data.board) {
      const layout = convertBackendBoardToFrontend(data.board);
      if (layout) board.init(layout);
    }

    if (color === me) {
      // 自己的落子回执：只切回合
      if (data.board && gameType === 'chinese-chess') {
        // 已重建棋盘，清除本地选子
        board.clearSelection();
        selected = null;
      }
      myTurn = currentPlayer === me;
      updateTurn();
      return;
    }

    // AI 落子
    if (gameType === 'gobang' || gameType === 'go') {
      if (position && position.r != null && position.c != null) {
        board.place(position.r, position.c, color);
        board.turn = BLACK;
      }
    } else if (gameType === 'chinese-chess' && position && position.toR != null) {
      board.setLastMove(position.toR, position.toC);
      board.clearSelection();
      selected = null;
      // 本地检测将死（服务端也判定，双保险）
      if (isCheckmate(board.board, 'red')) {
        finishGame('loss');
        return;
      }
    }

    // 本地检测 AI 五连 → 玩家输
    if (gameType === 'gobang' && position && checkWin(board.board, position.r, position.c, color)) {
      finishGame('loss');
      return;
    }

    myTurn = currentPlayer === me;
    updateTurn();
  }));

  // 游戏结束（服务端权威判定）
  offs.push(eventBus.on('ai:gameEnd', (data) => {
    if (gameOver || resultSent) return;
    finishGame(data.result === 'win' ? 'win' : 'loss');
  }));

  // ---- 悔棋（对齐 v1：AI 对局由服务端直接执行悔棋，无需对手确认）----
  undoBtn.addEventListener('click', () => {
    if (gameOver) { toast.warn('游戏已结束，无法悔棋'); return; }
    if (!myTurn) { toast.warn('AI 思考中，暂时无法悔棋'); return; }
    requestUndo(() => {
      emit('undo_request');
      toast.info('⏪ 悔棋请求已发送…');
    });
  });

  // 悔棋成功：用服务端棋盘恢复（撤销玩家与 AI 各一步）
  offs.push(eventBus.on('game:undoAccepted', (data) => {
    if (data.isAI === false) return; // 只处理 AI 对局的悔棋回执
    if (!data.board) return;
    if (gameType === 'chinese-chess') {
      const layout = convertBackendBoardToFrontend(data.board);
      if (layout) board.init(layout);
      board.clearSelection();
      selected = null;
    } else {
      board.restore(data.board, data.currentPlayer);
    }
    gameOver = false;
    myTurn = true; // 悔棋后轮到玩家
    updateTurn();
    toast.success('✅ 悔棋成功，轮到你了');
  }));

  // ---- 提示（对齐 v1：request_hint → hint_result 高亮推荐位置）----
  hintBtn.addEventListener('click', () => {
    if (gameOver) { toast.warn('游戏已结束'); return; }
    if (!myTurn) { toast.warn('AI 思考中，暂时无法提示'); return; }
    requestHint(() => {
      emit('request_hint');
      toast.info('💡 正在计算最佳位置...');
    });
  });

  // 提示结果：高亮推荐位置（gobang/go 落子点 / 象棋起点+目标）
  offs.push(eventBus.on('game:hintResult', (data) => {
    if (data.gameType && data.gameType !== gameType) return;
    showHintMarker(boardEl, data.move);
    toast.info(data.reason || '💡 建议位置');
  }));

  // 提示次数不足
  offs.push(eventBus.on('game:hintDeduct', (data) => {
    if (data && data.success === false && data.message) toast.warn(data.message);
  }));

  // ---- 结束流程 ----
  function finishGame(result) {
    if (gameOver) return;
    gameOver = true;
    resultSent = true;
    if (timerHandle) clearInterval(timerHandle);
    updateTurn();

    // 上报结果（服务端 endAIGame 有 finished 幂等保护，重复发送安全）
    emit('ai_game_result', {
      result,
      gameType,
      difficulty,
      duration: Date.now() - startTime,
    });

    const msg = result === 'win' ? '🎉 你战胜了AI！' : '😢 你输给了AI！';
    modal.show({
      title: '游戏结束',
      content: msg,
      confirmText: '返回AI对战',
      showCancel: false,
      onConfirm: () => {
        emit('return_lobby'); // 释放服务端 playing 状态
        go('ai-battle');
      },
    });
  }

  // 返回按钮
  backBtn.addEventListener('click', () => {
    if (gameOver) { go('ai-battle'); return; }
    modal.show({
      title: '返回AI对战',
      content: '确定要退出当前对局吗？',
      confirmText: '退出',
      showCancel: true,
      onConfirm: () => {
        emit('return_lobby');
        go('ai-battle');
      },
    });
  });

  // 计时器
  updateTurn();
  updateTimer();
  timerHandle = setInterval(updateTimer, 1000);

  activeBattle = {
    container,
    gameType,
    cleanup() {
      if (stateSyncOff) { stateSyncOff(); stateSyncOff = null; }
      if (stateSyncTimer) clearTimeout(stateSyncTimer);
      offs.forEach((off) => off());
      if (timerHandle) clearInterval(timerHandle);
      if (board && typeof board.destroy === 'function') board.destroy();
      container.innerHTML = '';
    },
  };

  return activeBattle;
}

/** 清理当前 AI 对局（切换视图/重新开始时） */
export function cleanupBattle() {
  if (activeBattle) {
    activeBattle.cleanup();
    activeBattle = null;
  }
}
