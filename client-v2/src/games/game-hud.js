/**
 * 对局 HUD 附加件（阶段 A · A8 / A9）
 * - 对局信息：手数、网络延迟
 * - 高级统计：格子占比、双方子数、最大连子、平均间隔、终局步数
 * - 本地暂停：棋盘遮罩 + 冻结计时
 */
import { el } from '../utils/dom.js';
import { emit } from '../core/socket.js';
import { eventBus } from '../core/eventBus.js';

/** 创建「手数 / 延迟」信息标签 */
export function createInfoTags(infoClass = 'game-info-tag') {
  const moveCountEl = el('span', { class: infoClass }, '🖐 手数：0');
  const latencyEl = el('span', { class: infoClass }, '📶 --ms');
  return { moveCountEl, latencyEl };
}

/**
 * 网络延迟探测：复用 get_current_game 的往返时间，不新增服务端协议。
 * @param {{ onChange: (ms: number|null) => void, isPaused?: () => boolean, intervalMs?: number }} options
 */
export function createLatencyProbe({ onChange, isPaused, intervalMs = 8000 } = {}) {
  let timer = null;
  let timeout = null;
  let pendingAt = null;

  function report(ms) {
    if (typeof onChange === 'function') onChange(ms);
  }

  function probe() {
    if (typeof isPaused === 'function' && isPaused()) return;
    if (pendingAt != null) return; // 上一次还没回包
    pendingAt = performance.now();
    const ok = emit('get_current_game');
    if (!ok) {
      pendingAt = null;
      report(null);
      return;
    }
    timeout = setTimeout(() => {
      if (pendingAt != null) {
        pendingAt = null;
        report(null);
      }
    }, 5000);
  }

  const off = eventBus.on('game:currentGame', () => {
    if (pendingAt == null) return;
    const ms = Math.round(performance.now() - pendingAt);
    pendingAt = null;
    if (timeout) clearTimeout(timeout);
    timeout = null;
    report(ms);
  });

  return {
    start() {
      if (timer) return;
      probe();
      timer = setInterval(probe, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      if (timeout) clearTimeout(timeout);
      timeout = null;
      pendingAt = null;
    },
    destroy() {
      this.stop();
      off();
    },
  };
}

/** 棋盘总格数 */
function boardSizeOf(board) {
  const rows = board?.length || 0;
  const cols = board?.[0]?.length || 0;
  return rows * cols;
}

/** 五子棋当前最大连子数 */
export function computeMaxChain(board) {
  if (!Array.isArray(board) || board.length === 0) return 0;
  const size = board.length;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  let max = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const color = board[r][c];
      if (!color) continue;
      for (const [dr, dc] of dirs) {
        // 只从连续段起点开始统计，避免重复
        const pr = r - dr;
        const pc = c - dc;
        if (pr >= 0 && pr < size && pc >= 0 && pc < size && board[pr][pc] === color) continue;
        let len = 0;
        let rr = r;
        let cc = c;
        while (rr >= 0 && rr < size && cc >= 0 && cc < size && board[rr][cc] === color) {
          len += 1;
          rr += dr;
          cc += dc;
        }
        if (len > max) max = len;
      }
    }
  }
  return max;
}

/** 统计棋盘上双方棋子数量 */
function countPieces(gameType, board) {
  let first = 0;
  let second = 0;
  if (!board) return { first, second };
  for (const row of board) {
    for (const cell of row) {
      if (!cell) continue;
      if (gameType === 'chinese-chess') {
        if (cell.color === 'red') first += 1;
        else second += 1;
      } else if (cell === 1) first += 1;
      else if (cell === 2) second += 1;
    }
  }
  return { first, second };
}

/**
 * 高级统计面板
 * @param {{ gameType: string, getBoard: () => any, getEntries: () => any[] }} options
 */
export function createStatsPanel({ gameType, getBoard, getEntries }) {
  const sideFirst = gameType === 'chinese-chess' ? '红方' : '黑棋';
  const sideSecond = gameType === 'chinese-chess' ? '黑方' : '白棋';

  const items = {};
  function row(key, label) {
    const value = el('span', { class: 'game-stats__value' }, '--');
    items[key] = value;
    return el('div', { class: 'game-stats__row' }, [
      el('span', { class: 'game-stats__label' }, label),
      value,
    ]);
  }

  const rows = [
    row('cells', '棋盘总格数'),
    row('filled', '已落子 / 占比'),
    row('fillRate', '棋盘填满率'),
    row('first', `${sideFirst}数量`),
    row('second', `${sideSecond}数量`),
  ];
  if (gameType === 'gobang') rows.push(row('chain', '当前最大连子'));
  rows.push(row('interval', '平均落子间隔'));
  rows.push(row('fastest', '最快获胜步数'));

  const root = el('section', { class: 'game-panel game-stats', hidden: true }, [
    el('div', { class: 'game-panel__summary' }, el('span', {}, '📈 高级统计')),
    el('div', { class: 'game-stats__body' }, rows),
  ]);

  let winner = null;

  function set(key, text) {
    if (items[key]) items[key].textContent = text;
  }

  function refresh() {
    const board = typeof getBoard === 'function' ? getBoard() : null;
    const entries = typeof getEntries === 'function' ? getEntries() : [];
    const total = boardSizeOf(board);
    const { first, second } = countPieces(gameType, board);
    const filled = first + second;
    const pct = total > 0 ? (filled / total) * 100 : 0;

    set('cells', String(total || '--'));
    set('filled', total ? `${filled} / ${pct.toFixed(1)}%` : '--');
    set('fillRate', total ? `${pct.toFixed(1)}%` : '--');
    set('first', String(first));
    set('second', String(second));

    if (gameType === 'gobang') set('chain', String(computeMaxChain(board)));

    if (entries.length > 1) {
      const span = entries[entries.length - 1].ts - entries[0].ts;
      const avg = span / (entries.length - 1) / 1000;
      set('interval', `${avg.toFixed(1)} 秒`);
    } else {
      set('interval', '--');
    }

    set('fastest', winner && entries.length > 0 ? `${entries.length} 手` : '--');
  }

  function setWinner(text) {
    winner = text || null;
    refresh();
  }

  return {
    el: root,
    refresh,
    setWinner,
    toggle(force) {
      const show = force !== undefined ? !!force : root.hidden;
      root.hidden = !show;
      if (show) refresh();
      return show;
    },
    get visible() {
      return !root.hidden;
    },
    destroy() {
      root.remove();
    },
  };
}

/**
 * 本地暂停控制器：遮罩 + 阻止棋盘操作由各 play.js 的 paused 标志负责
 * @param {{ boardContainer: HTMLElement, onChange?: (paused: boolean) => void }} options
 */
export function createPauseController({ boardContainer, onChange } = {}) {
  let paused = false;
  let pausedAt = 0;
  let pausedMs = 0;

  const overlay = el('div', { class: 'game-pause-overlay' }, [
    el('div', { class: 'game-pause-overlay__icon' }, '⏸'),
    el('div', { class: 'game-pause-overlay__text' }, '已暂停，按 P 继续'),
  ]);
  overlay.hidden = true;

  function setPaused(next) {
    const value = !!next;
    if (value === paused) return;
    paused = value;
    if (paused) pausedAt = Date.now();
    else if (pausedAt) {
      pausedMs += Date.now() - pausedAt;
      pausedAt = 0;
    }
    if (boardContainer) {
      boardContainer.classList.toggle('game-paused', paused);
      overlay.hidden = !paused;
      if (paused) {
        boardContainer.appendChild(overlay);
      } else {
        overlay.remove();
      }
    }
    if (typeof onChange === 'function') onChange(paused);
  }

  return {
    setPaused,
    isPaused: () => paused,
    /** 已暂停累计时长（毫秒），用于冻结计时 */
    getPausedMs: () => pausedMs + (paused ? Date.now() - pausedAt : 0),
    destroy() {
      overlay.remove();
      if (boardContainer) boardContainer.classList.remove('game-paused');
    },
  };
}
