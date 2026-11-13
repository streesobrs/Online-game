/**
 * 每日一题 · 残局挑战（#/puzzle）
 * - 服务端按自然日轮换五子棋 / 中国象棋残局，答案由服务端校验（客户端拿不到答案）
 * - 五子棋：黑先一步连五或防守；象棋：红先一步杀 / 多步连杀 / 防守反杀
 * - 多步残局：红方走对后黑方自动应招，最后一步通关发奖励
 */
import { api } from '../../core/api.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { go } from '../../core/router.js';
import { createBoard } from '../../games/gobang/board.js';
import { createChessBoard } from '../../games/chinese-chess/board.js';
import { getChessMoves } from '../../games/chinese-chess/rules.js';

/** 把题目棋子转成棋盘数据（0 空 / 1 黑 / 2 白） */
function buildBoardData(data) {
  const size = data.size || 19;
  const grid = Array.from({ length: size }, () => new Array(size).fill(0));
  (data.black || []).forEach(([r, c]) => { grid[r][c] = 1; });
  (data.white || []).forEach(([r, c]) => { grid[r][c] = 2; });
  return grid;
}

/** 深拷贝象棋棋盘，避免落子后污染原始残局数据 */
function cloneLayout(layout) {
  return (layout || []).map((row) => row.map((p) => (p ? { ...p } : null)));
}

/**
 * 渲染每日一题视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderPuzzle(container) {
  let cleaned = false;
  let data = null;
  let board = null;
  let chess = null;
  let selected = null;
  let submitting = false;
  let moveHistory = [];   // 象棋：红方已走的全部走法（用于服务端逐手比对）
  let replyTimer = null;  // 象棋：黑方应招动画定时器

  const metaEl = el('div', { class: 'puzzle-meta' });
  const boardArea = el('div', { class: 'puzzle-board-area' });
  const boardWrap = el('div', { class: 'puzzle-board-wrap' }, [boardArea]);

  /** 五子棋棋盘自适应 */
  function fitGobangBoard() {
    const boardEl = boardArea.querySelector('.gobang-board');
    if (!boardEl) return;
    const cols = 19;
    const padding = 4 + 20;
    const width = boardWrap.clientWidth || container.clientWidth || window.innerWidth;
    const available = Math.min(width, window.innerHeight * 0.62);
    let cell = Math.floor((available - padding * 2) / cols);
    cell = Math.max(10, Math.min(cell, 26));
    boardEl.style.setProperty('--board-cell-size', cell + 'px');
  }

  /** 象棋棋盘自适应 */
  function fitChessBoard() {
    const boardEl = boardArea.querySelector('.chess-board');
    if (!boardEl) return;
    boardEl.style.zoom = '';
    const width = boardWrap.clientWidth || container.clientWidth || window.innerWidth;
    const availableWidth = Math.min(width, window.innerHeight * 0.62);
    const availableHeight = window.innerHeight * 0.62;
    const padding = 48;
    const cellByWidth = Math.floor((availableWidth - padding) / 8);
    const cellByHeight = Math.floor((availableHeight - padding) / 9);
    const cell = Math.max(12, Math.min(cellByWidth, cellByHeight, 42));
    boardEl.style.setProperty('--board-cell-size', cell + 'px');
    boardEl.style.width = `calc(8 * ${cell}px + 48px)`;
    boardEl.style.height = `calc(9 * ${cell}px + 48px)`;
  }

  function fitBoard() {
    if (data?.game === 'xiangqi') fitChessBoard();
    else fitGobangBoard();
  }

  const resizeObserver = new ResizeObserver(() => fitBoard());

  function renderMeta() {
    metaEl.innerHTML = '';
    boardWrap.classList.toggle('solved', !!data.solved);
    const statusText = data.solved
      ? `✅ 今日已通关（尝试 ${data.attempts} 次），奖励已发放到邮箱`
      : playingText();
    metaEl.append(
      el('div', { class: 'puzzle-head-row' }, [
        el('span', { class: 'puzzle-name' }, `🧩 ${data.title}`),
        el('span', { class: 'puzzle-reward' }, `🎁 ${data.reward.starCoins} 星钻 · ${data.reward.exp} 经验`),
      ]),
      el('div', { class: 'puzzle-tip' }, data.tip || ''),
      el('div', { class: 'puzzle-status' + (data.solved ? ' solved' : '') }, statusText),
    );
  }

  /** 当前状态文案（区分棋种 / 多步 / 防守） */
  function playingText() {
    if (data.game !== 'xiangqi') {
      return `⚫ 黑先，点击棋盘找出关键一手（已尝试 ${data.attempts} 次）`;
    }
    if (data.replying) return '🤔 黑方正在应招…';
    const total = data.totalSteps || 1;
    const done = Math.min(data.step || 0, total);
    if (total <= 1) {
      return `🔴 红先，点击棋子走一步杀（已尝试 ${data.attempts} 次）`;
    }
    const next = Math.min(done + 1, total);
    const prefix = data.defense ? '🛡️ 黑方马上要绝杀，红方抢先反杀' : '🔴 红先';
    return `${prefix} · 第 ${next}/${total} 步（已尝试 ${data.attempts} 次）`;
  }

  function destroyBoards() {
    if (replyTimer) {
      clearTimeout(replyTimer);
      replyTimer = null;
    }
    if (board) {
      board.destroy();
      board = null;
    }
    if (chess) {
      chess.destroy();
      chess = null;
    }
    boardArea.innerHTML = '';
    selected = null;
    moveHistory = [];
  }

  function renderBoard() {
    destroyBoards();
    if (data.game === 'xiangqi') renderChessBoard();
    else renderGobangBoard();
    resizeObserver.disconnect();
    resizeObserver.observe(boardWrap);
  }

  function renderGobangBoard() {
    board = createBoard(boardArea, { onPlace: tryMove });
    board.restore(buildBoardData(data), 1);
    fitBoard();
  }

  function renderChessBoard() {
    chess = createChessBoard(boardArea, { onCellClick: onChessClick });
    chess.init(cloneLayout(data.layout));
    fitBoard();
  }

  /** 五子棋：落子并提交服务端校验 */
  async function tryMove(r, c) {
    if (!data || data.solved || submitting) return;
    if (board.board[r][c] !== 0) return;
    submitting = true;
    board.place(r, c, 1);

    try {
      const res = await api.puzzle.submit({ r, c });
      if (cleaned) return;

      if (!res || !res.success) {
        board.restore(buildBoardData(data), 1);
        toast.error(res?.message || '提交失败，请稍后重试');
        return;
      }

      data.attempts = res.data.attempts || data.attempts;
      if (res.data.correct) {
        data.solved = true;
        toast.success('🎉 残局破解成功！奖励已发送到邮箱');
      } else {
        board.restore(buildBoardData(data), 1);
        toast.warn(res.data.message || '这一步不对，再想想');
      }
      renderMeta();
    } catch (err) {
      if (!cleaned) {
        board.restore(buildBoardData(data), 1);
        toast.error(err?.message || '提交失败，请稍后重试');
      }
    } finally {
      submitting = false;
    }
  }

  /** 象棋：选子 / 走子 */
  function onChessClick(r, c) {
    if (!data || data.solved || submitting || !chess) return;
    const piece = chess.get(r, c);

    if (selected) {
      const moves = getChessMoves(chess.board, selected.r, selected.c);
      if (moves.some((m) => m.r === r && m.c === c)) {
        const from = selected;
        selected = null;
        chess.clearSelection();
        chess.movePiece(from.r, from.c, r, c);
        // 我方走子用绿色标记；等对方应招后再追加红色标记，两边轨迹都保留
        chess.setSideLastMove(r, c, true);
        submitChessMove(from.r, from.c, r, c);
        return;
      }
    }

    if (piece && piece.color === 'red') {
      selected = { r, c };
      chess.select(r, c);
      chess.setValidMoves(getChessMoves(chess.board, r, c));
    } else {
      selected = null;
      chess.clearSelection();
    }
  }

  function resetChess() {
    if (!chess) return;
    if (replyTimer) {
      clearTimeout(replyTimer);
      replyTimer = null;
    }
    selected = null;
    moveHistory = [];
    data.step = 0;
    data.replying = false;
    chess.init(cloneLayout(data.layout));
  }

  /** 黑方应招：延时走子，制造“对手在思考”的节奏 */
  function scheduleReply(reply) {
    if (!Array.isArray(reply) || reply.length !== 4 || !chess) {
      data.replying = false;
      submitting = false;
      renderMeta();
      return;
    }
    const [fr, fc, tr, tc] = reply;
    data.replying = true;
    renderMeta();
    replyTimer = setTimeout(() => {
      replyTimer = null;
      if (cleaned || !chess) {
        data.replying = false;
        submitting = false;
        return;
      }
      chess.movePiece(fr, fc, tr, tc);
      // 追加对方应招标记（红色），不覆盖我方的绿色标记
      chess.setSideLastMove(tr, tc);
      data.replying = false;
      submitting = false;
      renderMeta();
    }, 450);
  }

  /** 象棋：提交走法（多步残局回传红方全部走法） */
  async function submitChessMove(fr, fc, tr, tc) {
    if (!data || data.solved || submitting) return;
    submitting = true;
    moveHistory.push([fr, fc, tr, tc]);

    try {
      const res = await api.puzzle.submit({ moves: moveHistory.slice() });
      if (cleaned) return;

      if (!res || !res.success) {
        resetChess();
        submitting = false;
        renderMeta();
        toast.error(res?.message || '提交失败，请稍后重试');
        return;
      }

      data.attempts = res.data.attempts || data.attempts;

      if (res.data.correct && res.data.finished) {
        data.solved = true;
        submitting = false;
        renderMeta();
        toast.success('🎉 残局破解成功！奖励已发送到邮箱');
        return;
      }

      if (res.data.correct) {
        // 中间步：黑方自动应招，保持 submitting 直到应招动画结束
        data.step = res.data.step || data.step + 1;
        toast.success(`第 ${data.step} 步正确，看黑方怎么应对`);
        scheduleReply(res.data.reply);
        return;
      }

      resetChess();
      submitting = false;
      renderMeta();
      toast.warn(res.data.message || '这一步不对，再想想');
    } catch (err) {
      if (!cleaned) {
        resetChess();
        submitting = false;
        renderMeta();
        toast.error(err?.message || '提交失败，请稍后重试');
      }
    }
  }

  async function load() {
    boardArea.innerHTML = '<div class="text-muted" style="padding:40px;text-align:center;">⏳ 加载中...</div>';
    try {
      const res = await api.puzzle.daily();
      if (cleaned) return;
      if (!res || !res.success) {
        boardArea.innerHTML = '';
        boardArea.append(el('div', { class: 'text-muted', style: 'padding:40px;text-align:center;' },
          res?.message || '加载失败，请稍后重试'));
        return;
      }
      data = res.data;
      data.step = 0;
      data.replying = false;
      moveHistory = [];
      renderMeta();
      renderBoard();
    } catch (err) {
      if (cleaned) return;
      boardArea.innerHTML = '';
      boardArea.append(el('div', { class: 'text-muted', style: 'padding:40px;text-align:center;' },
        err?.message || '加载失败，请稍后重试'));
    }
  }

  container.innerHTML = '';
  container.append(el('div', { class: 'puzzle-page panel' }, [
    el('button', { class: 'page-back-btn', type: 'button', onClick: () => go('games') }, '← 返回游戏'),
    el('h2', { class: 'panel-title' }, '🧩 每日一题 · 残局挑战'),
    el('div', { class: 'puzzle-subtitle text-muted' }, '每天一道五子棋或中国象棋残局，有的要连走几步、有的要先防守再反杀，奖励通过邮件发放'),
    el('div', { class: 'puzzle-card' }, [metaEl, boardWrap]),
    el('div', { class: 'puzzle-note text-muted' }, '每日仅首次通关发放奖励，奖励通过邮件发放，请到邮箱领取'),
  ]));

  load();

  return () => {
    cleaned = true;
    resizeObserver.disconnect();
    destroyBoards();
    container.innerHTML = '';
  };
}
