/**
 * 贪吃蛇联机对局控制器（任务 3.3.3）
 * 贪吃蛇是实时对战（非回合制），协议与 v1 一致：
 * - 匹配：match_request {game:'snake'} → 服务端发 snake_match_found（非 match_success）
 *   { matchId, playerId, opponentId, opponentNickname, snake, opponentSnake, foods, gameTimeLeft }
 *   （P1 初始蛇 [{x:5,y:15}]，P2 [{x:24,y:15}]；30×30 棋盘，canvas 540×540，时长 120s）
 * - 方向无独立事件：方向 + 蛇身通过 snake_update 全量上报
 *   { matchId, playerId, snake, direction, score, foods, gameTimeLeft }
 * - 对手状态同步：snake_opponent_update（每 tick 转发）、snake_full_state_sync（响应请求）、snake_food_sync（食物变更）
 * - 碰撞：撞墙/撞自己/撞对方 → 1s 后回初始点无限复活（与 v1 respawnPlayer 一致）
 * - 结束：服务端 endGame 广播 snake_game_over；时间耗尽本地判定后 emit return_lobby
 */
import { createSnakeBoard, SNAKE_DIRS } from './board.js';
import { emit } from '../../core/socket.js';
import { eventBus } from '../../core/eventBus.js';
import { el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';
import { go } from '../../core/router.js';

const DUAL = {
  gridSize: 30,
  initialSpeed: 120,   // 与 v1 snakeDualConfig.initialSpeed 一致
  gameDuration: 120,
  respawnDelay: 1000,
  foodScore: 10,
};

let activeMatch = null;

/** 当前是否有进行中的对局 */
export function isMatchActive() {
  return !!activeMatch;
}

/**
 * 开始贪吃蛇联机对局（snake_match_found 时调用）
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @param {Object} matchData - snake_match_found 数据
 * @returns {Object} 对局句柄（含 cleanup）
 */
export function startDualMatch(container, matchData) {
  cleanupDualMatch(); // 清理旧对局

  const { matchId, playerId, opponentId, opponentNickname } = matchData;
  const myStart = Array.isArray(matchData.snake) && matchData.snake.length
    ? matchData.snake
    : [{ x: 5, y: Math.floor(DUAL.gridSize / 2) }];
  const oppStart = Array.isArray(matchData.opponentSnake) && matchData.opponentSnake.length
    ? matchData.opponentSnake
    : [{ x: DUAL.gridSize - 6, y: Math.floor(DUAL.gridSize / 2) }];
  const isPlayer1 = myStart[0].x < 15; // P1 左半场 / P2 右半场，用于复活复位

  // ---- 状态 ----
  const state = {
    matchId,
    playerId,
    snake: myStart,
    direction: 'right',
    nextDirection: 'right',
    snake2: oppStart,
    direction2: 'left',
    foods: Array.isArray(matchData.foods) ? matchData.foods : [],
    score: 0,
    score2: 0,
    speed: DUAL.initialSpeed,
    gameTimeLeft: matchData.gameTimeLeft ?? DUAL.gameDuration,
    running: true,
    ended: false,
    respawning: false,
    rafId: null,
    lastTime: 0,
    gameTimer: null,
  };

  // ---- DOM ----
  const myScoreEl = el('span', { class: 'snake-hud-value' }, '0');
  const oppScoreEl = el('span', { class: 'snake-hud-value' }, '0');
  const timeEl = el('span', { class: 'snake-hud-value' }, fmtTime(state.gameTimeLeft));
  const boardEl = document.createElement('div');
  const board = createSnakeBoard(boardEl, { mode: 'dual' });

  function fmtTime(s) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function updateHud() {
    myScoreEl.textContent = String(state.score);
    oppScoreEl.textContent = String(state.score2);
    timeEl.textContent = fmtTime(state.gameTimeLeft);
  }

  // ---- 方向控制（防 180° 反转，与 v1 一致）----
  function setDirection(dir) {
    if (state.ended || state.respawning) return;
    const cur = state.direction;
    if (dir === 'up' && cur === 'down') return;
    if (dir === 'down' && cur === 'up') return;
    if (dir === 'left' && cur === 'right') return;
    if (dir === 'right' && cur === 'left') return;
    state.nextDirection = dir;
  }

  function onKeydown(e) {
    let dir = null;
    switch (e.key) {
      case 'ArrowUp': case 'w': case 'W': dir = 'up'; break;
      case 'ArrowDown': case 's': case 'S': dir = 'down'; break;
      case 'ArrowLeft': case 'a': case 'A': dir = 'left'; break;
      case 'ArrowRight': case 'd': case 'D': dir = 'right'; break;
    }
    if (dir) {
      e.preventDefault();
      setDirection(dir);
    }
  }

  // ---- 食物（避开两条蛇）----
  function generateFood() {
    for (let i = 0; i < 500; i++) {
      const f = {
        x: Math.floor(Math.random() * DUAL.gridSize),
        y: Math.floor(Math.random() * DUAL.gridSize),
      };
      const onSnake = state.snake.some((s) => s.x === f.x && s.y === f.y);
      const onSnake2 = state.snake2.some((s) => s.x === f.x && s.y === f.y);
      const onFood = state.foods.some((fd) => fd.x === f.x && fd.y === f.y);
      if (!onSnake && !onSnake2 && !onFood) return f;
    }
    return null;
  }

  // ---- 上报 / 对手更新 ----
  function sendUpdate() {
    emit('snake_update', {
      matchId: state.matchId,
      playerId: state.playerId,
      snake: state.snake,
      direction: state.direction,
      score: state.score,
      foods: state.foods,
      gameTimeLeft: state.gameTimeLeft,
    });
  }

  function handleOpponentUpdate(data) {
    if (state.ended) return;
    if (Array.isArray(data.snake)) state.snake2 = data.snake;
    if (typeof data.score === 'number') state.score2 = data.score;
    if (Array.isArray(data.foods)) state.foods = data.foods;
    if (typeof data.gameTimeLeft === 'number') state.gameTimeLeft = data.gameTimeLeft;
    updateHud();
  }

  // ---- 复活（1s 后回初始点，方向复位）----
  function respawn() {
    if (state.respawning) return;
    state.respawning = true;
    state.snake = [];
    setTimeout(() => {
      if (state.ended || !state.running) return;
      state.snake = isPlayer1
        ? [{ x: 5, y: Math.floor(DUAL.gridSize / 2) }]
        : [{ x: DUAL.gridSize - 6, y: Math.floor(DUAL.gridSize / 2) }];
      state.direction = isPlayer1 ? 'right' : 'left';
      state.nextDirection = state.direction;
      state.respawning = false;
      board.render({ snake: state.snake, snake2: state.snake2, foods: state.foods });
    }, DUAL.respawnDelay);
  }

  // ---- 单步移动（吃食物 +10 并补食物、碰撞复活、上报）----
  function step() {
    if (state.ended || state.respawning) return;
    state.direction = state.nextDirection;
    const head = state.snake[0];
    if (!head) return;
    const next = {
      x: head.x + SNAKE_DIRS[state.direction].x,
      y: head.y + SNAKE_DIRS[state.direction].y,
    };

    // 碰撞：撞墙 / 撞自己 / 撞对方
    const hitWall = next.x < 0 || next.x >= DUAL.gridSize || next.y < 0 || next.y >= DUAL.gridSize;
    const hitSelf = state.snake.some((s) => s.x === next.x && s.y === next.y);
    const hitOther = state.snake2.some((s) => s.x === next.x && s.y === next.y);
    if (hitWall || hitSelf || hitOther) {
      respawn();
      board.render({ snake: state.snake, snake2: state.snake2, foods: state.foods });
      return;
    }

    state.snake.unshift(next);

    // 吃食物
    const idx = state.foods.findIndex((f) => f.x === next.x && f.y === next.y);
    if (idx >= 0) {
      state.foods.splice(idx, 1);
      state.score += DUAL.foodScore;
      const f = generateFood();
      if (f) state.foods.push(f);
      // 通知对手食物变更（服务端转 snake_food_sync）
      emit('snake_food_update', { matchId: state.matchId, playerId: state.playerId, foods: state.foods });
      updateHud();
    } else {
      state.snake.pop();
    }

    sendUpdate();
    board.render({ snake: state.snake, snake2: state.snake2, foods: state.foods });
  }

  // ---- 游戏循环 ----
  function loop(now) {
    if (state.running && !state.ended && !state.respawning && now - state.lastTime >= state.speed) {
      state.lastTime = now;
      step();
    }
    state.rafId = requestAnimationFrame(loop);
  }

  // ---- 结束 ----
  function endGame(msg, winnerLabel) {
    if (state.ended) return;
    state.ended = true;
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    if (state.gameTimer) clearInterval(state.gameTimer);
    if (state.syncInterval) clearInterval(state.syncInterval);
    emit('return_lobby'); // 释放服务端用户状态
    modal.show({
      title: '游戏结束',
      content: winnerLabel
        ? `${msg}\n${winnerLabel}（你 ${state.score} 分 / 对手 ${state.score2} 分）`
        : `${msg}（你 ${state.score} 分 / 对手 ${state.score2} 分）`,
      confirmText: '返回大厅',
      showCancel: false,
      onConfirm: () => go('lobby'),
    });
  }

  // ---- socket 事件 ----
  const offs = [];

  // 对手状态（每 tick 服务端转发）
  offs.push(eventBus.on('snake:opponentUpdate', handleOpponentUpdate));

  // 全量状态同步（snake_request_full_state 响应 / 中途重连）
  offs.push(eventBus.on('snake:fullStateSync', (data) => {
    if (state.ended) return;
    if (data.isPlayer1) {
      if (Array.isArray(data.player1Snake)) state.snake = data.player1Snake;
      if (typeof data.player1Score === 'number') state.score = data.player1Score;
      if (Array.isArray(data.player2Snake)) state.snake2 = data.player2Snake;
      if (typeof data.player2Score === 'number') state.score2 = data.player2Score;
    } else {
      if (Array.isArray(data.player2Snake)) state.snake = data.player2Snake;
      if (typeof data.player2Score === 'number') state.score = data.player2Score;
      if (Array.isArray(data.player1Snake)) state.snake2 = data.player1Snake;
      if (typeof data.player1Score === 'number') state.score2 = data.player1Score;
    }
    if (Array.isArray(data.foods)) state.foods = data.foods;
    if (typeof data.gameTimeLeft === 'number') state.gameTimeLeft = data.gameTimeLeft;
    updateHud();
    board.render({ snake: state.snake, snake2: state.snake2, foods: state.foods });
  }));

  // 食物同步
  offs.push(eventBus.on('snake:foodSync', (data) => {
    if (state.ended) return;
    if (Array.isArray(data.foods)) {
      state.foods = data.foods;
      board.render({ snake: state.snake, snake2: state.snake2, foods: state.foods });
    }
  }));

  // 服务端结束（时间到/对方认输等）
  offs.push(eventBus.on('snake:gameOver', (data) => {
    if (state.ended) return;
    const win = data.winner != null && String(data.winner) === String(state.playerId);
    endGame('🎮 对战结束', data.result === 'resign' ? (win ? '对方认输，你获胜！' : '对方获胜') : (win ? '你获胜！' : '对手获胜'));
  }));

  // ---- 界面 ----
  function virtualBtn(dir, label) {
    return el('button', {
      class: 'snake-virtual-btn',
      style: dir === 'up' ? 'grid-area:up' : dir === 'left' ? 'grid-area:left' : dir === 'down' ? 'grid-area:down' : 'grid-area:right',
    }, label);
  }
  const upBtn = virtualBtn('up', '▲');
  const leftBtn = virtualBtn('left', '◀');
  const downBtn = virtualBtn('down', '▼');
  const rightBtn = virtualBtn('right', '▶');
  [upBtn, leftBtn, downBtn, rightBtn].forEach((btn, i) => {
    btn.addEventListener('click', () => setDirection(['up', 'left', 'down', 'right'][i]));
  });

  const hud = el('div', { class: 'snake-hud' }, [
    el('span', {}, `我：`), myScoreEl,
    el('span', { style: 'margin-left:16px;' }, `对手：`), oppScoreEl,
    el('span', { style: 'margin-left:16px;' }, `⏱ `), timeEl,
    el('span', { style: 'margin-left:16px;' }, `👤 ${opponentNickname || opponentId || '对手'}`),
  ]);
  const controls = el('div', { class: 'snake-virtual-controls' }, [upBtn, leftBtn, downBtn, rightBtn]);

  // 返回大厅（中止对局 → 释放服务端用户状态，与 v1 一致）
  const leaveBtn = el('button', { class: 'btn btn-secondary', style: 'padding:6px 20px;' }, '返回大厅');
  leaveBtn.addEventListener('click', () => {
    modal.show({
      title: '返回大厅',
      content: '确定要退出当前对局吗？',
      confirmText: '退出',
      showCancel: true,
      onConfirm: () => {
        emit('return_lobby');
        cleanupDualMatch();
        go('lobby');
      },
    });
  });
  const actions = el('div', { style: 'text-align:center;margin-top:12px;' }, [leaveBtn]);

  container.innerHTML = '';
  container.append(hud, boardEl, controls, actions);

  // ---- 启动 ----
  document.addEventListener('keydown', onKeydown);
  board.render({ snake: state.snake, snake2: state.snake2, foods: state.foods });
  updateHud();
  state.lastTime = performance.now();
  state.rafId = requestAnimationFrame(loop);

  // 全量状态同步（对齐 v1：开局请求一次 + 每 2s 定期请求，保证双方状态一致）
  function requestFullState() {
    emit('snake_request_full_state', { matchId: state.matchId });
  }
  requestFullState();
  state.syncInterval = setInterval(() => {
    if (!state.ended && state.running) requestFullState();
  }, 2000);

  // 倒计时
  state.gameTimer = setInterval(() => {
    if (state.ended) return;
    state.gameTimeLeft--;
    updateHud();
    if (state.gameTimeLeft <= 0) {
      // 时间耗尽：本地判定胜负（服务端可能已结束，以 gameOver 事件为准）
      if (state.score > state.score2) endGame('⏰ 时间到！', '你获胜！');
      else if (state.score2 > state.score) endGame('⏰ 时间到！', '对手获胜');
      else endGame('⏰ 时间到！', '平局！');
    }
  }, 1000);

  toast.success('🎮 匹配成功！双人贪吃蛇开始！');

  activeMatch = {
    container,
    board,
    gameId: matchId,
    cleanup() {
      state.ended = true;
      state.running = false;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      if (state.gameTimer) clearInterval(state.gameTimer);
      if (state.syncInterval) clearInterval(state.syncInterval);
      offs.forEach((off) => off());
      document.removeEventListener('keydown', onKeydown);
      container.innerHTML = '';
      board.destroy();
    },
  };

  return activeMatch;
}

/** 清理当前对局 */
export function cleanupDualMatch() {
  if (activeMatch) {
    activeMatch.cleanup();
    activeMatch = null;
  }
}
