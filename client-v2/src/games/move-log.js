/**
 * 落子 / 走子记录面板 + 对局数据导出（v1 格式）
 *
 * 服务端只回传棋盘快照，不含历史顺序，因此悔棋 / 重连后只能清空记录重来，
 * 不伪造历史（见阶段 A 规格）。
 */
import { el } from '../utils/dom.js';

const GAME_LABEL = {
  gobang: '五子棋',
  go: '围棋',
  'chinese-chess': '象棋',
};

/** 落子方名称：象棋 1=红 / 2=黑，其余 1=黑 / 2=白 */
function colorName(gameType, color) {
  if (gameType === 'chinese-chess') return Number(color) === 1 ? '红方' : '黑方';
  return Number(color) === 1 ? '黑棋' : '白棋';
}

/** 导出用色名（象棋 red/black） */
function exportColorName(gameType, color) {
  if (gameType === 'chinese-chess') return Number(color) === 1 ? 'red' : 'black';
  return Number(color) === 1 ? 'black' : 'white';
}

function formatEntry(gameType, entry, opponentName) {
  const who = entry.isSelf ? '自己' : (opponentName || '对方');
  const side = colorName(gameType, entry.color);
  const head = `${entry.seq}. ${who}(${side})`;
  if (gameType === 'chinese-chess') {
    const piece = entry.piece ? `${entry.piece}` : '棋子';
    return `${head}${piece}：(${entry.fromR + 1},${entry.fromC + 1})→(${entry.toR + 1},${entry.toC + 1})`;
  }
  return `${head}：(${entry.r + 1},${entry.c + 1})`;
}

/**
 * 创建落子记录面板
 * @param {{ gameType: string, me: number, opponentName?: string, open?: boolean }} options
 */
export function createMoveLog({ gameType, me, opponentName, open } = {}) {
  const entries = [];
  let seq = 0;
  let winnerText = '';

  const countEl = el('span', { class: 'game-panel__badge' }, '0');
  const listEl = el('div', { class: 'move-log__list' });
  const noteEl = el('div', { class: 'move-log__note', hidden: true });

  // 桌面默认展开，小屏默认折叠，避免挤压棋盘
  const defaultOpen = open !== undefined
    ? !!open
    : (window.innerWidth >= 1024 || (window.innerWidth >= 768 && window.innerWidth > window.innerHeight));

  const root = el('details', { class: 'game-panel move-log', open: defaultOpen ? '' : null }, [
    el('summary', { class: 'game-panel__summary' }, [
      el('span', {}, '📜 落子记录'),
      countEl,
    ]),
    noteEl,
    listEl,
  ]);

  function scrollToBottom() {
    listEl.scrollTop = listEl.scrollHeight;
  }

  function add(move) {
    if (!move) return null;
    seq += 1;
    const entry = {
      ...move,
      seq,
      ts: move.ts || Date.now(),
      isSelf: !!move.isSelf,
    };
    entries.push(entry);

    const item = el('div', {
      class: `move-log__item move-log__item--${entry.isSelf ? 'self' : 'other'}`,
    }, formatEntry(gameType, entry, opponentName));
    listEl.append(item);

    // 最多保留 200 条，超出裁剪最早的记录
    while (entries.length > 200) entries.shift();
    while (listEl.children.length > 200) listEl.firstElementChild?.remove();

    countEl.textContent = String(entries.length);
    noteEl.hidden = true;
    scrollToBottom();
    return entry;
  }

  function clear(note) {
    entries.length = 0;
    seq = 0;
    listEl.innerHTML = '';
    countEl.textContent = '0';
    if (note) {
      noteEl.textContent = note;
      noteEl.hidden = false;
    } else {
      noteEl.hidden = true;
    }
  }

  function setWinner(text) {
    winnerText = text || '';
  }

  return {
    el: root,
    add,
    clear,
    setWinner,
    getEntries: () => entries.slice(),
    size: () => entries.length,
    destroy() {
      root.remove();
    },
  };
}

/** 掩码对手 ID：保留前 4 位 */
function maskId(id) {
  if (id == null || id === '') return '';
  const str = String(id);
  if (str === 'AI') return 'AI';
  return str.length > 4 ? `${str.slice(0, 4)}****` : str;
}

/** 秒 → mm:ss */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** 生成 v1 格式的导出数据 */
export function buildExportData({ gameType, me, opponentId, entries = [], durationSec = 0, winner, maxChain = null }) {
  let blackMoves = 0;
  let whiteMoves = 0;
  const moveLog = entries.map((e) => {
    if (Number(e.color) === 1) blackMoves += 1;
    else whiteMoves += 1;
    const base = {
      color: exportColorName(gameType, e.color),
      isSelf: !!e.isSelf,
      timestamp: new Date(e.ts).toISOString(),
      piece: e.piece || null,
    };
    if (gameType === 'chinese-chess') {
      return {
        ...base,
        fromPosition: [e.fromR, e.fromC],
        toPosition: [e.toR, e.toC],
      };
    }
    return { ...base, position: [e.r, e.c] };
  });

  const myColor = exportColorName(gameType, me);

  return {
    version: '4.0',
    timestamp: new Date().toISOString(),
    gameType,
    gameTypeName: GAME_LABEL[gameType] || gameType,
    gameDuration: formatDuration(durationSec),
    totalMoves: entries.length,
    blackMoves,
    whiteMoves,
    winner: winner || null,
    maxChain,
    myColor,
    opponentId: maskId(opponentId),
    moveLog,
  };
}

/** 触发浏览器下载 */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * 导出对局 JSON（v1 格式）并下载
 * @returns {Object|null} 导出的数据；无着法时返回 null
 */
export function exportGameData(options) {
  const { gameType } = options;
  if (!options.entries || options.entries.length === 0) return null;
  const data = buildExportData(options);
  const stamp = Date.now();
  downloadJson(`棋类对局数据_${gameType}_${stamp}.json`, data);
  return data;
}

export default createMoveLog;
