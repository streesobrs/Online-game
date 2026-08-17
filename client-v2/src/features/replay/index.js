/**
 * 对局回放模块（补齐 v1 replay-module.js）
 * - 对战历史点击「🎬 回放」→ requestReplay(gameId) 发送 get_game_replay
 * - 服务端回 game_replay → showReplay(replay) 打开回放弹窗
 * - 支持五子棋 / 围棋 / 中国象棋 / 贪吃蛇 四种棋种逐帧播放（步进/进度条/变速/自动播放）
 */
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';

// ========== 回放数据请求 ==========
let pendingResolver = null;

// 全局监听一次 game:replay（socket.js 已映射 game_replay → game:replay）
eventBus.on('game:replay', (data) => {
  if (pendingResolver) pendingResolver(data);
});

/**
 * 请求并等待回放数据（Promise）
 * @param {string} gameId
 * @returns {Promise<Object>} replay
 */
export function requestReplay(gameId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingResolver = null;
      reject(new Error('回放加载超时'));
    }, 8000);
    pendingResolver = (data) => {
      clearTimeout(timeout);
      pendingResolver = null;
      if (data && data.replay && Array.isArray(data.replay.moves) && data.replay.moves.length > 0) {
        resolve(data.replay);
      } else {
        reject(new Error('该对局暂无回放数据'));
      }
    };
    emit('get_game_replay', { gameId });
  });
}

// ========== 弹窗管理 ==========
const state = {
  replay: null,
  currentMoveIndex: 0,
  isPlaying: false,
  playInterval: null,
  speed: 1000,
};

let activeOverlay = null;
let styleInjected = false;

const REPLAY_STYLE = `
.replay-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9998;display:flex;align-items:center;justify-content:center;animation:replay-fade .2s ease}
.replay-modal{background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.25);width:92%;max-width:720px;max-height:94vh;display:flex;flex-direction:column;position:relative;animation:replay-pop .2s ease}
.replay-close{position:absolute;top:10px;right:10px;background:#e74c3c;color:#fff;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px;z-index:10;display:flex;align-items:center;justify-content:center}
.replay-close:hover{background:#c0392b}
.replay-title{padding:16px 48px 0 20px;font-size:16px;font-weight:600;color:#212529}
.replay-players{display:flex;gap:20px;margin:10px 20px 0;padding:8px;background:#f7fafc;border-radius:8px;flex-shrink:0}
.replay-player{flex:1;text-align:center}
.replay-player b{font-size:14px;color:#2d3748}
.replay-player span{display:block;font-size:11px;color:#718096;margin-top:2px}
.replay-board-area{display:flex;justify-content:center;margin:10px 20px;overflow:auto;flex-shrink:1;min-height:60px}
.replay-controls{background:#f7fafc;padding:10px 12px;margin:0 20px 8px;border-radius:8px;flex-shrink:0}
.replay-controls-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px;color:#4a5568}
.replay-controls-top b{color:#2d3748}
.replay-progress{width:100%;cursor:pointer}
.replay-btns{display:flex;justify-content:center;gap:8px;margin:8px 0;flex-wrap:wrap;flex-shrink:0}
.replay-btn{border:none;border-radius:6px;padding:6px 14px;font-size:13px;color:#fff;cursor:pointer;transition:filter .15s}
.replay-btn:hover{filter:brightness(1.1)}
.replay-speed-bar{display:flex;flex-direction:column;align-items:center;gap:5px;margin-bottom:8px;flex-shrink:0}
.replay-speed-row{display:flex;align-items:center;gap:10px;width:100%;max-width:300px;font-size:12px;color:#4a5568}
.replay-speed-row input{flex:1;cursor:pointer}
.replay-speed-labels{display:flex;justify-content:space-between;width:100%;max-width:300px;font-size:11px;color:#718096}
.replay-foot{flex-shrink:0;text-align:center;font-size:11px;color:#718096;padding-bottom:10px}
@keyframes replay-fade{from{opacity:0}to{opacity:1}}
@keyframes replay-pop{from{transform:scale(.96);opacity:0}to{transform:scale(1);opacity:1}}
`;

function ensureStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = REPLAY_STYLE;
  document.head.appendChild(style);
}

const GAME_TYPE_NAMES = { gobang: '五子棋', go: '围棋', 'chinese-chess': '中国象棋', snake: '贪吃蛇' };

/**
 * 打开回放弹窗
 * @param {Object} replay - game_replay 数据 { gameType, player1, player2, moves, score, maxLength, foodEaten, ... }
 */
export function showReplay(replay) {
  // 兼容旧数据：chess/xiangqi → chinese-chess
  if (replay.gameType === 'chess' || replay.gameType === 'xiangqi') replay.gameType = 'chinese-chess';
  state.replay = replay;
  state.currentMoveIndex = 0;
  state.isPlaying = false;
  state.playInterval = null;
  state.speed = 1000;

  close();
  ensureStyle();

  const overlay = el('div', { class: 'replay-overlay' });
  const modal = el('div', { class: 'replay-modal' });
  const typeName = GAME_TYPE_NAMES[replay.gameType] || replay.gameType;

  const isSnake = replay.gameType === 'snake';
  const playersHtml = isSnake
    ? el('div', { class: 'replay-players' }, [
        el('div', { class: 'replay-player' }, [el('b', {}, '🏆 最终分数'), el('span', {}, `得分 ${replay.score || 0}`)]),
        el('div', { class: 'replay-player' }, [el('b', {}, '🐍 最大长度'), el('span', {}, `${replay.maxLength || 1} 节`)]),
        el('div', { class: 'replay-player' }, [el('b', {}, '🍎 吃食物'), el('span', {}, `${replay.foodEaten || 0} 个`)]),
      ])
    : el('div', { class: 'replay-players' }, [
        el('div', { class: 'replay-player' }, [
          el('b', {}, `${replay.gameType === 'chinese-chess' ? '🔴' : '⚫'} ${replay.player1?.nickname || '玩家1'}`),
          el('span', {}, replay.gameType === 'chinese-chess' ? '红方' : '黑方'),
        ]),
        el('div', { class: 'replay-player' }, [
          el('b', {}, `${replay.gameType === 'chinese-chess' ? '⚫' : '⚪'} ${replay.player2?.nickname || '玩家2'}`),
          el('span', {}, replay.gameType === 'chinese-chess' ? '黑方' : '白方'),
        ]),
      ]);

  const boardArea = el('div', { class: 'replay-board-area' });
  boardArea.append(buildBoardDOM(replay.gameType));

  const moveCountEl = el('span', {}, '0');
  const progressEl = el('input', { class: 'replay-progress', type: 'range', min: '0', max: String(replay.moves.length), value: '0' });
  const speedDisplayEl = el('span', {}, '1秒/步');

  const prevBtn = replayBtn('⏮ 上一步', '#3498db', replayPrev);
  const playBtn = replayBtn('▶ 播放', '#27ae60', togglePlay);
  const nextBtn = replayBtn('下一步 ⏭', '#3498db', replayNext);
  const firstBtn = replayBtn('⏮ 开始', '#9b59b6', replayFirst);
  const lastBtn = replayBtn('结束 ⏭', '#9b59b6', replayLast);

  const speedBtns = [
    ['2000', '慢速', '#6c757d'],
    ['1000', '正常', '#3498db'],
    ['500', '快速', '#e67e22'],
    ['200', '极速', '#e74c3c'],
  ].map(([spd, label, color]) =>
    el('button', { class: 'replay-btn', style: `background:${color};padding:4px 10px;font-size:11px;`, onClick: () => setSpeed(parseInt(spd, 10)) }, label));

  const speedSlider = el('input', { type: 'range', min: '5', max: '100', step: '5', value: '50', style: 'flex:1;cursor:pointer;' });
  const speedValueEl = el('span', { style: 'min-width:60px;text-align:right;font-size:12px;color:#4a5568;' }, '1.0步/秒');
  speedSlider.addEventListener('input', () => {
    const sps = parseInt(speedSlider.value, 10) / 10;
    setSpeed(Math.round(1000 / sps));
    speedValueEl.textContent = sps.toFixed(1) + '步/秒';
  });

  progressEl.addEventListener('input', () => jumpToMove(parseInt(progressEl.value, 10)));

  const closeBtn = el('button', { class: 'replay-close', 'aria-label': '关闭' }, '✕');
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  modal.append(
    closeBtn,
    el('div', { class: 'replay-title' }, `🎬 游戏回放 - ${typeName}`),
    playersHtml,
    boardArea,
    el('div', { class: 'replay-controls' }, [
      el('div', { class: 'replay-controls-top' }, [
        el('span', {}, '步数: ', el('b', {}, moveCountEl), ` / ${replay.moves.length}`),
        el('span', {}, '速度: ', speedDisplayEl),
      ]),
      progressEl,
    ]),
    el('div', { class: 'replay-btns' }, [prevBtn, playBtn, nextBtn, firstBtn, lastBtn]),
    el('div', { class: 'replay-btns' }, speedBtns),
    el('div', { class: 'replay-speed-bar' }, [
      el('div', { class: 'replay-speed-row' }, [el('span', {}, '速度:'), speedSlider, speedValueEl]),
      el('div', { class: 'replay-speed-labels' }, [el('span', {}, '慢'), el('span', {}, '快')]),
    ]),
    el('div', { class: 'replay-foot' }, '拖拽进度条可跳转 · 播放时可调速度'),
  );
  overlay.append(modal);
  document.body.appendChild(overlay);
  activeOverlay = overlay;

  // 引用保存在模块状态，供渲染/导航使用
  state.dom = { moveCountEl, progressEl, speedDisplayEl, playBtn };

  renderBoard();
}

function replayBtn(label, color, handler) {
  return el('button', { class: 'replay-btn', style: `background:${color};`, onClick: handler }, label);
}

function buildBoardDOM(gameType) {
  if (gameType === 'gobang') return el('div', { class: 'replay-board-grid' });
  if (gameType === 'go') return el('div', { class: 'replay-board-grid' });
  if (gameType === 'chinese-chess') {
    return el('div', { style: 'position:relative;' }, [
      el('svg', { style: 'display:block;', width: 280, height: 310, viewBox: '0 0 280 310', html: CHESS_BOARD_SVG }),
      el('div', { style: 'position:absolute;inset:0;' }),
    ]);
  }
  if (gameType === 'snake') {
    return el('canvas', { width: 400, height: 400, style: 'border:2px solid #37474f;background:#263238;' });
  }
  return el('div', {}, '暂不支持该游戏的回放');
}

// 象棋棋盘 SVG（对齐 v1 replay-module 棋盘样式）
const CHESS_BOARD_SVG = `
<rect width="280" height="310" fill="#f0d9b5" rx="4"/>
${Array.from({ length: 10 }, (_, i) => `<line x1="20" y1="${20 + i * 30}" x2="${260}" y2="${20 + i * 30}" stroke="#5c4033" stroke-width="1"/>`).join('')}
${Array.from({ length: 9 }, (_, j) => {
  const x = 20 + j * 30;
  return j === 0 || j === 8
    ? `<line x1="${x}" y1="20" x2="${x}" y2="290" stroke="#5c4033" stroke-width="1"/>`
    : `<line x1="${x}" y1="20" x2="${x}" y2="140" stroke="#5c4033" stroke-width="1"/><line x1="${x}" y1="170" x2="${x}" y2="290" stroke="#5c4033" stroke-width="1"/>`;
}).join('')}
<line x1="110" y1="20" x2="170" y2="80" stroke="#5c4033" stroke-width="1"/><line x1="170" y1="20" x2="110" y2="80" stroke="#5c4033" stroke-width="1"/>
<line x1="110" y1="230" x2="170" y2="290" stroke="#5c4033" stroke-width="1"/><line x1="170" y1="230" x2="110" y2="290" stroke="#5c4033" stroke-width="1"/>
<text x="70" y="155" fill="#5c4033" font-size="18" font-family="KaiTi,serif" text-anchor="middle">楚河</text>
<text x="150" y="185" fill="#5c4033" font-size="18" font-family="KaiTi,serif" text-anchor="middle">汉界</text>
`;

// ========== 棋盘渲染 ==========
function renderBoard() {
  const gameType = state.replay.gameType;
  if (gameType === 'gobang') renderGobang();
  else if (gameType === 'go') renderGo();
  else if (gameType === 'chinese-chess') renderChineseChess();
  else if (gameType === 'snake') renderSnake();
}

function setupGridBoard(container, size, cell) {
  if (!container.hasChildNodes()) {
    container.style.cssText = `display:grid;grid-template-columns:repeat(${size},${cell}px);grid-template-rows:repeat(${size},${cell}px);padding:15px;background:#e8c56f;background-image:radial-gradient(circle,#8a6d3b 1px,transparent 1px);background-size:${cell}px ${cell}px;border:2px solid #8a6d3b;border-radius:4px;`;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        container.append(el('div', { style: `width:${cell}px;height:${cell}px;display:flex;align-items:center;justify-content:center;` }));
      }
    }
  }
  return container;
}

function renderGobang() {
  const area = document.querySelector('.replay-board-area');
  const board = area?.firstChild;
  if (!board) return;
  const size = 19, cell = 30;
  setupGridBoard(board, size, cell);
  board.querySelectorAll('.replay-last-move').forEach((n) => n.classList.remove('replay-last-move'));

  const target = state.currentMoveIndex;
  const cells = board.children;
  // 先清除全部棋子再按当前步数重绘（简单可靠）
  Array.from(cells).forEach((cellEl) => { cellEl.innerHTML = ''; });
  for (let i = 0; i < target && i < state.replay.moves.length; i++) {
    const mv = state.replay.moves[i];
    if (!mv || !mv.position) continue;
    const { r, c } = mv.position;
    if (r < 0 || r >= size || c < 0 || c >= size) continue;
    const cellEl = cells[r * size + c];
    const stone = el('div', {
      style: `width:${cell - 6}px;height:${cell - 6}px;border-radius:50%;${mv.color === 1 ? 'background:radial-gradient(circle at 35% 35%,#555,#111);' : 'background:radial-gradient(circle at 35% 35%,#fff,#ccc);'}box-shadow:0 1px 3px rgba(0,0,0,.4);`,
    });
    cellEl.append(stone);
    if (i === target - 1) cellEl.classList.add('replay-last-move');
  }
  board.querySelectorAll('.replay-last-move').forEach((n) => {
    const ring = el('div', { style: 'position:absolute;inset:1px;border-radius:50%;border:2px solid #f1c40f;pointer-events:none;' });
    n.style.position = 'relative';
    n.append(ring);
  });
}

function renderGo() {
  const area = document.querySelector('.replay-board-area');
  const board = area?.firstChild;
  if (!board) return;
  const size = 19, cell = 28;
  setupGridBoard(board, size, cell);
  board.querySelectorAll('.replay-last-move').forEach((n) => n.classList.remove('replay-last-move'));

  const target = state.currentMoveIndex;
  const cells = board.children;
  Array.from(cells).forEach((cellEl) => { cellEl.innerHTML = ''; });
  for (let i = 0; i < target && i < state.replay.moves.length; i++) {
    const mv = state.replay.moves[i];
    if (!mv || !mv.position) continue;
    const { r, c } = mv.position;
    if (r < 0 || r >= size || c < 0 || c >= size) continue;
    const cellEl = cells[r * size + c];
    cellEl.append(el('div', {
      style: `width:${cell - 6}px;height:${cell - 6}px;border-radius:50%;${mv.color === 1 ? 'background:radial-gradient(circle at 35% 35%,#333,#000);' : 'background:radial-gradient(circle at 35% 35%,#fff,#d0d0d0);'}box-shadow:0 1px 3px rgba(0,0,0,.4);`,
    }));
    if (i === target - 1) cellEl.classList.add('replay-last-move');
  }
  board.querySelectorAll('.replay-last-move').forEach((n) => {
    const ring = el('div', { style: 'position:absolute;inset:1px;border-radius:50%;border:2px solid #f1c40f;pointer-events:none;' });
    n.style.position = 'relative';
    n.append(ring);
  });
}

function getInitialChessBoard() {
  return [
    ['b-ju', 'b-ma', 'b-xiang', 'b-shi', 'b-jiang', 'b-shi', 'b-xiang', 'b-ma', 'b-ju'],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 'b-pao', 0, 0, 0, 0, 0, 'b-pao', 0],
    ['b-zu', 0, 'b-zu', 0, 'b-zu', 0, 'b-zu', 0, 'b-zu'],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['r-bing', 0, 'r-bing', 0, 'r-bing', 0, 'r-bing', 0, 'r-bing'],
    [0, 'r-pao', 0, 0, 0, 0, 0, 'r-pao', 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
    ['r-ju', 'r-ma', 'r-xiang', 'r-shi', 'r-shuai', 'r-shi', 'r-xiang', 'r-ma', 'r-ju'],
  ];
}

function renderChineseChess() {
  const area = document.querySelector('.replay-board-area');
  const board = area?.firstChild;
  if (!board) return;
  const piecesLayer = board.children[1];
  if (!piecesLayer) return;
  const cs = 30, pw = 20;
  const target = state.currentMoveIndex;

  // 从初始棋盘应用所有步数
  const grid = getInitialChessBoard();
  for (let i = 0; i < target && i < state.replay.moves.length; i++) {
    const mv = state.replay.moves[i];
    if (mv?.position && mv.position.fromR !== undefined) {
      const { fromR, fromC, toR, toC } = mv.position;
      if (grid[fromR]?.[fromC]) {
        grid[toR][toC] = grid[fromR][fromC];
        grid[fromR][fromC] = 0;
      }
    }
  }

  piecesLayer.innerHTML = '';
  let lastFrom = null, lastTo = null;
  if (target > 0 && target <= state.replay.moves.length) {
    const mv = state.replay.moves[target - 1];
    if (mv?.position && mv.position.fromR !== undefined) {
      lastFrom = [mv.position.fromR, mv.position.fromC];
      lastTo = [mv.position.toR, mv.position.toC];
    }
  }

  const redMap = { ju: '车', ma: '马', xiang: '相', shi: '仕', shuai: '帅', pao: '炮', bing: '兵' };
  const blackMap = { ju: '车', ma: '马', xiang: '象', shi: '士', jiang: '将', pao: '炮', zu: '卒' };
  const ps = 26;

  for (let r = 0; r < 10; r++) {
    for (let c = 0; c < 9; c++) {
      const cell = grid[r][c];
      if (!cell) continue;
      const isRed = cell.startsWith('r-');
      const name = (isRed ? redMap : blackMap)[cell.substring(2)] || cell.substring(2);
      piecesLayer.append(el('div', {
        style: `position:absolute;left:${pw + c * cs - ps / 2}px;top:${pw + r * cs - ps / 2}px;width:${ps}px;height:${ps}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;border:2px solid rgba(255,255,255,.4);box-shadow:0 2px 6px rgba(0,0,0,.3);z-index:10;${isRed ? 'background:radial-gradient(circle at 35% 35%,#ff7b7b 0%,#e04848 50%,#c0392b 100%);color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3);' : 'background:radial-gradient(circle at 35% 35%,#5d6d7e 0%,#3d4c53 50%,#2c3e50 100%);color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.4);'}`,
      }, name));
    }
  }

  // 高亮最后一步（目标格黄色环 + 起始格虚线）
  if (lastTo) {
    piecesLayer.append(el('div', {
      style: `position:absolute;left:${pw + lastTo[1] * cs - 14}px;top:${pw + lastTo[0] * cs - 14}px;width:28px;height:28px;border-radius:50%;border:2px solid #f1c40f;box-shadow:0 0 8px rgba(241,196,15,.6);pointer-events:none;z-index:5;`,
    }));
  }
  if (lastFrom && (lastFrom[0] !== lastTo?.[0] || lastFrom[1] !== lastTo?.[1])) {
    piecesLayer.append(el('div', {
      style: `position:absolute;left:${pw + lastFrom[1] * cs - 14}px;top:${pw + lastFrom[0] * cs - 14}px;width:28px;height:28px;border-radius:50%;border:2px dashed #e74c3c;opacity:.5;pointer-events:none;z-index:5;`,
    }));
  }
}

function renderSnake() {
  const area = document.querySelector('.replay-board-area');
  const canvas = area?.firstChild;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const cellSize = 20, gridSize = 20;

  ctx.fillStyle = '#263238';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#37474f';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  for (let i = 0; i <= gridSize; i++) {
    ctx.moveTo(i * cellSize, 0); ctx.lineTo(i * cellSize, canvas.height);
    ctx.moveTo(0, i * cellSize); ctx.lineTo(canvas.width, i * cellSize);
  }
  ctx.stroke();

  const target = state.currentMoveIndex;
  const moves = state.replay.moves;
  if (target === 0) return;

  let snake = [], foods = [];
  if (moves.length > 0 && Array.isArray(moves[0]) && moves[0][0] === 'init') {
    const initMove = moves[0];
    snake = (initMove[3] || []).map((s) => ({ x: s[0], y: s[1] }));
    const foodCount = initMove[4];
    if (typeof foodCount === 'number' && foodCount > 0) {
      for (let fi = 0; fi < foodCount; fi++) {
        const fx = initMove[5 + fi * 2], fy = initMove[6 + fi * 2];
        if (typeof fx === 'number' && typeof fy === 'number') foods.push({ x: fx, y: fy });
      }
    }
  }

  for (let i = 1; i < target && i < moves.length; i++) {
    const mv = moves[i];
    if (!Array.isArray(mv)) continue;
    const head = { x: mv[1], y: mv[2] };
    const ate = mv[3] === 1;
    if (snake.length > 0) {
      snake.unshift(head);
      if (!ate) snake.pop();
    }
    if (ate && mv.length > 5) {
      const foodCount = mv[4];
      foods = [];
      if (typeof foodCount === 'number' && foodCount > 0) {
        for (let fj = 0; fj < foodCount; fj++) {
          const fxx = mv[5 + fj * 2], fyy = mv[6 + fj * 2];
          if (typeof fxx === 'number' && typeof fyy === 'number') foods.push({ x: fxx, y: fyy });
        }
      }
    }
  }

  if (snake.length === 0 && moves.length > 0 && Array.isArray(moves[0]) && moves[0][0] === 'init') {
    snake = (moves[0][3] || []).map((s) => ({ x: s[0], y: s[1] }));
  }

  foods.forEach((f) => {
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(f.x * cellSize + cellSize / 2, f.y * cellSize + cellSize / 2, cellSize / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  });

  if (snake.length > 0) {
    ctx.fillStyle = '#45b7d1';
    for (let s = 1; s < snake.length; s++) {
      ctx.fillRect(snake[s].x * cellSize + 1, snake[s].y * cellSize + 1, cellSize - 2, cellSize - 2);
    }
    ctx.fillStyle = '#4ecdc4';
    ctx.fillRect(snake[0].x * cellSize + 1, snake[0].y * cellSize + 1, cellSize - 2, cellSize - 2);
  }
}

// ========== UI 更新 ==========
function updateUI() {
  if (!state.dom) return;
  state.dom.moveCountEl.textContent = String(state.currentMoveIndex);
  state.dom.progressEl.value = String(state.currentMoveIndex);
}

// ========== 导航 ==========
function replayPrev() {
  if (state.currentMoveIndex > 0) {
    state.currentMoveIndex--;
    renderBoard();
    updateUI();
  }
}

function replayNext() {
  if (state.currentMoveIndex < state.replay.moves.length) {
    state.currentMoveIndex++;
    renderBoard();
    updateUI();
  }
}

function replayFirst() {
  stopPlay();
  state.currentMoveIndex = 0;
  renderBoard();
  updateUI();
}

function replayLast() {
  stopPlay();
  state.currentMoveIndex = state.replay.moves.length;
  renderBoard();
  updateUI();
}

function jumpToMove(index) {
  stopPlay();
  state.currentMoveIndex = Math.max(0, Math.min(index, state.replay.moves.length));
  renderBoard();
  updateUI();
}

// ========== 播放控制 ==========
function togglePlay() {
  if (state.isPlaying) stopPlay();
  else startPlay();
}

function startPlay() {
  if (state.currentMoveIndex >= state.replay.moves.length) {
    state.currentMoveIndex = 0;
    renderBoard();
    updateUI();
  }
  state.isPlaying = true;
  if (state.dom) {
    state.dom.playBtn.textContent = '⏸ 暂停';
    state.dom.playBtn.style.background = '#e74c3c';
  }
  state.playInterval = setInterval(() => {
    if (state.currentMoveIndex < state.replay.moves.length) {
      state.currentMoveIndex++;
      renderBoard();
      updateUI();
    } else {
      stopPlay();
    }
  }, state.speed);
}

function stopPlay() {
  state.isPlaying = false;
  if (state.playInterval) {
    clearInterval(state.playInterval);
    state.playInterval = null;
  }
  if (state.dom) {
    state.dom.playBtn.textContent = '▶ 播放';
    state.dom.playBtn.style.background = '#27ae60';
  }
}

// ========== 速度控制 ==========
function setSpeed(speed) {
  state.speed = speed;
  if (state.dom) {
    const map = { 2000: '2秒/步', 1000: '1秒/步', 500: '0.5秒/步', 200: '0.2秒/步' };
    state.dom.speedDisplayEl.textContent = map[speed] || `${(speed / 1000).toFixed(1)}秒/步`;
  }
  if (state.isPlaying) {
    stopPlay();
    startPlay();
  }
}

/** 关闭回放弹窗 */
export function close() {
  stopPlay();
  if (activeOverlay) {
    activeOverlay.remove();
    activeOverlay = null;
  }
}
