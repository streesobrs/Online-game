/**
 * 贪吃蛇视图（阶段 3）
 * - 本地模式：完整单机游戏（任务 3.3.2 控制逻辑 + 3.3.4 死亡/结束）
 *   - 键盘方向键/WASD 与虚拟按键控制蛇移动（防 180° 反转，与 v1 handleSnakeKeydown/handleVirtualKey 一致）
 *   - gameLoop 按速度 tick 移动蛇、吃食物加分加长、撞墙/撞自己判定
 * - 联机对局由 3.3.3 接入（协议与回合制不同：snake_match_found 专用事件 + snake_update 全量上报）
 */
import { createSnakeBoard } from './board.js';
import { startDualMatch, cleanupDualMatch } from './play.js';
import { emit } from '../../core/socket.js';
import { store } from '../../core/store.js';
import { viewRoot, el } from '../../utils/dom.js';
import { toast } from '../../components/toast.js';
import { modal } from '../../components/modal.js';

const SOLO_CONFIG = {
  gridSize: 20,
  initialSpeed: 150,   // 与 v1 snakeGameConfig.initialSpeed 一致
  minSpeed: 50,
  foodScore: 10,
  initialFoodCount: 3,
  maxFoodCount: 8,
  speedUpEvery: 100,   // 每 100 分速度 -10
};

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * 渲染贪吃蛇视图
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup 函数
 */
export function renderSnake(container = viewRoot()) {
  // 联机对局模式：lobby 匹配成功后写入 pendingMatch（game === 'snake'），
  // 由 play.js 启动双人对局（snake_match_found 专用协议，不走 match_success）
  const pending = store.get('pendingMatch');
  if (pending && (!pending.game || pending.game === 'snake')) {
    store.set('pendingMatch', null);
    const match = startDualMatch(container, pending);
    window.snakeMatch = match;
    return () => {
      cleanupDualMatch();
      if (window.snakeMatch === match) delete window.snakeMatch;
    };
  }

  // ---- 游戏状态 ----
  const state = {
    snake: [],
    direction: 'right',
    nextDirection: 'right',
    foods: [],
    score: 0,
    highScore: 0,          // 最高分（localStorage 持久化，与服务端 snake_sync_highscore 同步）
    speed: SOLO_CONFIG.initialSpeed,
    running: false,
    gameOver: false,
    rafId: null,
    lastTime: 0,
    moveHistory: [],       // 操作历史（与 v1 紧凑格式一致，供 snake_game_end 上报）
    maxLength: 0,          // 蛇的最大长度
    foodEaten: 0,          // 吃到的食物数量
  };

  // ---- DOM ----
  const scoreEl = el('span', { class: 'snake-hud-value' }, '0');
  const highScoreEl = el('span', { class: 'snake-hud-value' }, '0');
  const speedEl = el('span', { class: 'snake-hud-value' }, `${state.speed}ms`);
  const boardEl = document.createElement('div');
  const board = createSnakeBoard(boardEl, { mode: 'solo' });

  function updateHud() {
    scoreEl.textContent = String(state.score);
    highScoreEl.textContent = String(state.highScore);
    speedEl.textContent = `${state.speed}ms`;
  }

  // 加载本地最高分并同步到服务端（对齐 v1 initSnakeGame）
  const savedHighScore = parseInt(localStorage.getItem('snakeHighScore') || '0', 10);
  if (savedHighScore > 0) {
    state.highScore = savedHighScore;
    highScoreEl.textContent = String(state.highScore);
  }
  emit('snake_sync_highscore', { highScore: savedHighScore });

  // ---- 方向控制（防 180° 反转，与 v1 一致）----
  function setDirection(dir) {
    if (state.gameOver) return;
    if (!state.running) return; // 未开始时忽略（开始后方向恒 right）
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

  // ---- 食物生成（随机避开蛇身与已有食物，500 次防死循环，与 v1 一致）----
  function generateFood() {
    for (let i = 0; i < 500; i++) {
      const f = {
        x: Math.floor(Math.random() * SOLO_CONFIG.gridSize),
        y: Math.floor(Math.random() * SOLO_CONFIG.gridSize),
      };
      const onSnake = state.snake.some((s) => s.x === f.x && s.y === f.y);
      const onFood = state.foods.some((fd) => fd.x === f.x && fd.y === f.y);
      if (!onSnake && !onFood) return f;
    }
    return null;
  }

  // 初始食物数量随最高分增长（对齐 v1 startSnakeGame：每 200 分 +1，上限 maxFoodCount）
  function initialFoodCount() {
    const extra = Math.min(
      Math.floor(state.highScore / 200),
      SOLO_CONFIG.maxFoodCount - SOLO_CONFIG.initialFoodCount
    );
    return Math.min(SOLO_CONFIG.initialFoodCount + extra, SOLO_CONFIG.maxFoodCount);
  }

  function resetFoods() {
    state.foods = [];
    const target = initialFoodCount();
    while (state.foods.length < target) {
      const f = generateFood();
      if (f) state.foods.push(f);
      else break;
    }
  }

  // ---- 移动（吃食物加分加长；撞墙/撞自己停止）----
  function move() {
    state.direction = state.nextDirection;
    const head = state.snake[0];
    const next = {
      x: head.x + DIRS[state.direction].x,
      y: head.y + DIRS[state.direction].y,
    };

    // 碰撞：撞墙 / 撞自己（3.3.4 完善死亡/结束流程）
    if (next.x < 0 || next.x >= SOLO_CONFIG.gridSize || next.y < 0 || next.y >= SOLO_CONFIG.gridSize) {
      endGame('🐍 撞到墙了');
      return;
    }
    if (state.snake.some((s) => s.x === next.x && s.y === next.y)) {
      endGame('🐍 撞到自己了');
      return;
    }

    state.snake.unshift(next);
    const ateFood = state.foods.findIndex((f) => f.x === next.x && f.y === next.y) >= 0;

    if (ateFood) {
      const idx = state.foods.findIndex((f) => f.x === next.x && f.y === next.y);
      state.foods.splice(idx, 1);
      state.score += SOLO_CONFIG.foodScore;
      state.foodEaten++;
      // 最高分：超越时更新并持久化（对齐 v1 updateSnakeScore）
      if (state.score > state.highScore) {
        state.highScore = state.score;
        localStorage.setItem('snakeHighScore', String(state.highScore));
      }
      // 每 100 分加速（下限 minSpeed，与 v1 一致）
      if (state.speed > SOLO_CONFIG.minSpeed && state.score % SOLO_CONFIG.speedUpEvery === 0) {
        state.speed = Math.max(SOLO_CONFIG.minSpeed, state.speed - 10);
      }
      // 补食物（上限 maxFoodCount）
      if (state.foods.length < SOLO_CONFIG.maxFoodCount) {
        const f = generateFood();
        if (f) state.foods.push(f);
      }
    } else {
      state.snake.pop();
    }

    // 更新最大长度
    if (state.snake.length > state.maxLength) {
      state.maxLength = state.snake.length;
    }

    // 记录操作历史（与 v1 超紧凑格式一致：方向/新头x/y/是否吃食，吃食时附食物列表）
    const moveRecord = [state.direction, state.snake[0].x, state.snake[0].y, ateFood ? 1 : 0];
    if (ateFood) {
      moveRecord.push(state.foods.length);
      state.foods.forEach((f) => moveRecord.push(f.x, f.y));
    }
    state.moveHistory.push(moveRecord);

    updateHud();
    board.render({ snake: state.snake, foods: state.foods });
  }

  function endGame(msg) {
    state.running = false;
    state.gameOver = true;
    // 上报对局结果到服务端（对齐 v1 endSnakeGame：记战绩/统计/经验/成就）
    emit('snake_game_end', {
      score: state.score,
      highScore: state.highScore,
      gameType: 'snake',
      moveHistory: state.moveHistory,
      maxLength: state.maxLength,
      foodEaten: state.foodEaten,
    });
    const isNewRecord = state.score > 0 && state.score > prevHighScore;
    toast.error(`${msg}，得分 ${state.score}`);
    modal.show({
      title: '游戏结束',
      content: `${msg}\n得分：${state.score}\n最高分：${state.highScore}${isNewRecord ? '\n🎉 新纪录！' : ''}`,
      confirmText: '再来一局',
      showCancel: true,
      cancelText: '关闭',
      onConfirm: () => startGame(),
    });
  }

  // ---- 游戏循环 ----
  function loop(now) {
    if (state.running && now - state.lastTime >= state.speed) {
      state.lastTime = now;
      move();
    }
    state.rafId = requestAnimationFrame(loop);
  }

  // ---- 开始/重新开始 ----
  let prevHighScore = state.highScore; // 本局开始前的最高分（用于结算判定新纪录）

  function startGame() {
    prevHighScore = state.highScore;
    state.snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    state.direction = 'right';
    state.nextDirection = 'right';
    state.score = 0;
    state.speed = SOLO_CONFIG.initialSpeed;
    state.running = true;
    state.gameOver = false;
    state.lastTime = performance.now();
    state.moveHistory = [];
    state.maxLength = state.snake.length;
    state.foodEaten = 0;
    resetFoods();
    updateHud();
    board.render({ snake: state.snake, foods: state.foods });
    startBtn.textContent = '重新开始';
    if (!state.rafId) state.rafId = requestAnimationFrame(loop);
    // 通知服务端单机对局开始（对齐 v1 startSnakeGame）
    emit('snake_game_start', { gameType: 'snake' });
  }

  // ---- 虚拟按键 ----
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
    const dir = ['up', 'left', 'down', 'right'][i];
    btn.addEventListener('click', () => setDirection(dir));
  });

  const startBtn = el('button', { class: 'btn btn-primary', style: 'padding:8px 24px;' }, '开始游戏');

  // ---- 界面组装 ----
  const hud = el('div', { class: 'snake-hud' }, [
    el('span', {}, `分数：`), scoreEl,
    el('span', { style: 'margin-left:16px;' }, `最高：`), highScoreEl,
    el('span', { style: 'margin-left:16px;' }, `速度：`), speedEl,
  ]);
  const controls = el('div', { class: 'snake-virtual-controls' }, [upBtn, leftBtn, downBtn, rightBtn]);
  const actions = el('div', { style: 'text-align:center;margin-top:12px;' }, [startBtn]);

  container.innerHTML = '';
  container.append(hud, boardEl, controls, actions);

  startBtn.addEventListener('click', startGame);
  document.addEventListener('keydown', onKeydown);

  // 初始渲染（未开始时展示初始蛇 + 食物）
  startGame();

  window.snakeBoard = board;

  return () => {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    document.removeEventListener('keydown', onKeydown);
    board.destroy();
    if (window.snakeBoard === board) delete window.snakeBoard;
  };
}
