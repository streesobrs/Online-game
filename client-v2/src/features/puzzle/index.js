/**
 * 每日一题 · 五子棋残局挑战（#/puzzle）
 * - 服务端按自然日轮换题目，答案由服务端校验（客户端拿不到答案）
 * - 黑先，一步连成五子即为通关；通关奖励通过邮件发放，每天仅一次
 */
import { api } from '../../core/api.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { go } from '../../core/router.js';
import { createBoard } from '../../games/gobang/board.js';

/** 把题目棋子转成棋盘数据（0 空 / 1 黑 / 2 白） */
function buildBoardData(data) {
  const size = data.size || 19;
  const grid = Array.from({ length: size }, () => new Array(size).fill(0));
  (data.black || []).forEach(([r, c]) => { grid[r][c] = 1; });
  (data.white || []).forEach(([r, c]) => { grid[r][c] = 2; });
  return grid;
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
  let submitting = false;

  const metaEl = el('div', { class: 'puzzle-meta' });
  const boardArea = el('div', { class: 'puzzle-board-area' });
  const boardWrap = el('div', { class: 'puzzle-board-wrap' }, [boardArea]);

  /** 棋盘自适应：按容器宽度计算格子尺寸，避免小屏溢出 */
  function fitBoard() {
    const boardEl = boardArea.querySelector('.gobang-board');
    if (!boardEl) return;
    const cols = 19;
    const padding = 4 + 20; // 边框 + 棋盘内边距占位（约）
    const width = boardWrap.clientWidth || container.clientWidth || window.innerWidth;
    const available = Math.min(width, window.innerHeight * 0.62);
    let cell = Math.floor((available - padding * 2) / cols);
    cell = Math.max(10, Math.min(cell, 26));
    boardEl.style.setProperty('--board-cell-size', cell + 'px');
  }

  const resizeObserver = new ResizeObserver(() => fitBoard());

  function renderMeta() {
    metaEl.innerHTML = '';
    boardWrap.classList.toggle('solved', !!data.solved);
    const statusText = data.solved
      ? `✅ 今日已通关（尝试 ${data.attempts} 次），奖励已发放到邮箱`
      : `⚫ 黑先，点击棋盘寻找一步制胜（已尝试 ${data.attempts} 次）`;
    metaEl.append(
      el('div', { class: 'puzzle-head-row' }, [
        el('span', { class: 'puzzle-name' }, `🧩 ${data.title}`),
        el('span', { class: 'puzzle-reward' }, `🎁 ${data.reward.starCoins} 星钻 · ${data.reward.exp} 经验`),
      ]),
      el('div', { class: 'puzzle-tip' }, data.tip || ''),
      el('div', { class: 'puzzle-status' + (data.solved ? ' solved' : '') }, statusText),
    );
  }

  function renderBoard() {
    if (board) {
      board.destroy();
      board = null;
    }
    boardArea.innerHTML = '';
    board = createBoard(boardArea, { onPlace: tryMove });
    board.restore(buildBoardData(data), 1);
    fitBoard();
    resizeObserver.disconnect();
    resizeObserver.observe(boardWrap);
  }

  /** 落子并提交服务端校验 */
  async function tryMove(r, c) {
    if (!data || data.solved || submitting) return;
    if (board.board[r][c] !== 0) return;
    submitting = true;
    board.place(r, c, 1);

    try {
      const res = await api.puzzle.submit(r, c);
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
        // 错误落子：还原棋盘，保留尝试次数
        board.restore(buildBoardData(data), 1);
        toast.warn(res.data.message || '这一步没能连成五子，再想想');
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
    el('div', { class: 'puzzle-subtitle text-muted' }, '每天一道五子棋残局，黑先一步制胜，通关可得星钻与经验奖励'),
    el('div', { class: 'puzzle-card' }, [metaEl, boardWrap]),
    el('div', { class: 'puzzle-note text-muted' }, '每日仅首次通关发放奖励，奖励通过邮件发放，请到邮箱领取'),
  ]));

  load();

  return () => {
    cleaned = true;
    resizeObserver.disconnect();
    if (board) {
      board.destroy();
      board = null;
    }
    container.innerHTML = '';
  };
}
