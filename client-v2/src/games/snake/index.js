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
import { api } from '../../core/api.js';
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

// 贪吃蛇道具配置（与 v1 SNAKE_ITEM_TYPES 完全一致，服务端商城 items.json 同名）
const SNAKE_ITEM_TYPES = {
  item_snake_revive: { id: 'item_snake_revive', name: '复活卡', icon: '❤️', desc: '撞墙时弹出选择框确认是否使用，获得5秒无敌保护', type: 'revive' },
  item_snake_speed: { id: 'item_snake_speed', name: '加速卡', icon: '⚡', desc: '10秒内移动速度翻倍', type: 'speed' },
  item_snake_double: { id: 'item_snake_double', name: '双倍卡', icon: '✖️2', desc: '15秒内得分翻倍', type: 'double' },
  item_snake_shrink: { id: 'item_snake_shrink', name: '缩短卡', icon: '🔽', desc: '身体缩短3节', type: 'shrink' },
};

/** 当前账号 id（与 v1 gameUserId 同源，均为账号 id） */
function snakeUserId() {
  return localStorage.getItem('currentAccountId') || localStorage.getItem('gameUserId') || '';
}

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
    // 道具效果状态（对齐 v1 snakeGameState）
    inventory: {},         // 道具背包（localStorage snakeItemInventory + 服务端同步）
    invincibleEndTime: 0,  // 复活卡无敌保护结束时间（5 秒）
    speedBoostEndTime: 0,  // 加速卡效果结束时间（10 秒）
    doubleScoreEndTime: 0, // 双倍得分卡结束时间（15 秒）
    scoreMultiplier: 1,    // 得分倍率（双倍卡 = 2）
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

  // ---- 贪吃蛇道具系统（对齐 v1：复活/加速/双倍/缩短卡）----

  // 从 localStorage 加载道具（并尝试从服务器同步）
  function loadSnakeItems() {
    try {
      const saved = localStorage.getItem('snakeItemInventory');
      state.inventory = saved ? JSON.parse(saved) : {};
    } catch (e) {
      state.inventory = {};
    }
    syncServerSnakeItems();
    updateSnakeItemBar();
  }

  // 从服务器同步道具（商城购买的道具存于背包，进入页面时拉取合并）
  async function syncServerSnakeItems() {
    try {
      const userId = snakeUserId();
      if (!userId) return;
      const data = await api.shop.getInventory(userId);
      if (data && data.success && data.inventory && data.inventory.items) {
        const snakeItemIds = Object.keys(SNAKE_ITEM_TYPES);
        let changed = false;
        for (const [itemId, count] of Object.entries(data.inventory.items)) {
          if (snakeItemIds.includes(itemId) && count > 0) {
            state.inventory[itemId] = (state.inventory[itemId] || 0) + count;
            changed = true;
          }
        }
        if (changed) {
          saveSnakeItems();
          updateSnakeItemBar();
        }
      }
    } catch (e) {
      console.warn('[Snake] 同步服务器道具失败:', e.message);
    }
  }

  function saveSnakeItems() {
    try {
      localStorage.setItem('snakeItemInventory', JSON.stringify(state.inventory));
    } catch (e) {
      console.warn('[Snake] 保存道具失败:', e);
    }
  }

  // 同步消耗服务器端道具（登录账号时）
  function consumeServerItem(itemId) {
    const userId = snakeUserId();
    if (!userId) return;
    api.shop.useItem(userId, itemId).catch((e) => console.warn('[Snake] 同步消耗服务器道具失败:', e.message));
  }

  // 更新道具栏显示
  function updateSnakeItemBar() {
    const hasItems = Object.values(state.inventory).some((c) => c > 0);
    itemBarEl.style.display = hasItems ? 'block' : 'none';
    itemListEl.innerHTML = '';
    if (!hasItems) return;
    for (const [itemId, count] of Object.entries(state.inventory)) {
      if (count <= 0) continue;
      const config = SNAKE_ITEM_TYPES[itemId];
      if (!config) continue;
      itemListEl.append(el('div', {
        class: 'snake-item-chip',
        title: `${config.name}：${config.desc}\n双击使用`,
        ondblclick: () => useSnakeItem(itemId),
      }, [
        el('span', {}, config.icon),
        el('span', { class: 'snake-item-chip-name' }, config.name),
        el('span', { class: 'snake-item-chip-count' }, `×${count}`),
      ]));
    }
  }

  // 使用道具（双击道具栏触发）
  function useSnakeItem(itemId) {
    if (!state.running || state.gameOver) {
      toast.warn('请先开始游戏再使用道具');
      return;
    }
    if (!state.inventory[itemId] || state.inventory[itemId] <= 0) {
      toast.error('道具不足');
      return;
    }
    const config = SNAKE_ITEM_TYPES[itemId];
    if (!config) return;
    const now = Date.now();
    switch (config.type) {
      case 'revive':
        // 复活卡 - 碰撞时自动消耗，双击仅提示剩余数量
        toast.info(`❤️ 你还有 ${state.inventory['item_snake_revive']} 张复活卡，撞墙时会弹出选择框确认是否使用`, 2500);
        return;
      case 'speed':
        if (state.speedBoostEndTime > now) { toast.warn('加速效果已生效中'); return; }
        state.speed = Math.max(30, Math.floor(state.speed / 2));
        state.speedBoostEndTime = now + 10000;
        toast.success('⚡ 加速卡已使用，速度翻倍持续10秒！');
        break;
      case 'double':
        if (state.doubleScoreEndTime > now) { toast.warn('双倍得分已生效中'); return; }
        state.scoreMultiplier = 2;
        state.doubleScoreEndTime = now + 15000;
        toast.success('✖️2 双倍得分卡已使用，持续15秒！');
        break;
      case 'shrink':
        if (state.snake.length <= 2) { toast.warn('蛇已经太短了，无法再缩短'); return; }
        const shrinkCount = Math.min(3, state.snake.length - 1);
        state.snake.splice(state.snake.length - shrinkCount, shrinkCount);
        toast.success(`🔽 身体缩短${shrinkCount}节！`);
        break;
    }
    // 消耗道具（本地 + 服务端）
    state.inventory[itemId]--;
    saveSnakeItems();
    updateSnakeItemBar();
    consumeServerItem(itemId);
  }

  // 清除道具效果（游戏结束时调用）
  function clearSnakeItemEffects() {
    state.invincibleEndTime = 0;
    state.speedBoostEndTime = 0;
    state.doubleScoreEndTime = 0;
    state.scoreMultiplier = 1;
  }

  // 碰撞处理：有复活卡弹确认框，使用后无敌 5 秒并倒退一步；否则结束
  function handleCollision() {
    const hasRevive = state.inventory['item_snake_revive'] && state.inventory['item_snake_revive'] > 0;
    if (hasRevive) {
      const remain = state.inventory['item_snake_revive'];
      state.running = false; // 暂停游戏等待玩家选择
      modal.show({
        title: '💥 撞到了！',
        content: el('div', { style: 'text-align:center;' }, [
          el('p', {}, '你还有 ', el('strong', { style: 'color:#f59e0b;font-size:18px;' }, String(remain)), ' 张复活卡'),
          el('p', { style: 'font-size:13px;color:#666;' }, '使用一张并获得5秒无敌保护？'),
        ]),
        confirmText: '❤️ 使用复活卡',
        cancelText: '放弃结束',
        onConfirm: () => {
          state.inventory['item_snake_revive']--;
          saveSnakeItems();
          updateSnakeItemBar();
          consumeServerItem('item_snake_revive');
          state.invincibleEndTime = Date.now() + 5000;
          // 重置蛇的位置到安全位置（倒退一步）
          state.snake = state.snake.slice(0, Math.max(1, state.snake.length - 1));
          if (state.snake.length === 0) state.snake = [{ x: 10, y: 10 }];
          const newRemain = state.inventory['item_snake_revive'] || 0;
          toast.success(`❤️ 复活成功！剩余${newRemain}张，5秒无敌保护已激活`, 3000);
          state.running = true;
          state.lastTime = performance.now();
          board.render({ snake: state.snake, foods: state.foods, invincible: true });
        },
        onCancel: () => endGame('💥 撞到了！'),
      });
      return;
    }
    endGame('💥 撞到了！');
  }

  // ---- 移动（吃食物加分加长；撞墙/撞自己按复活卡/无敌处理）----
  function move() {
    state.direction = state.nextDirection;
    const head = state.snake[0];
    const next = {
      x: head.x + DIRS[state.direction].x,
      y: head.y + DIRS[state.direction].y,
    };
    const now = Date.now();
    const isInvincible = state.invincibleEndTime > now;

    // 碰撞：撞墙 / 撞自己（无敌时间内跳过，对齐 v1）
    const hitWall = next.x < 0 || next.x >= SOLO_CONFIG.gridSize || next.y < 0 || next.y >= SOLO_CONFIG.gridSize;
    const hitSelf = state.snake.some((s) => s.x === next.x && s.y === next.y);
    if (!isInvincible && (hitWall || hitSelf)) {
      handleCollision(); // 复活弹窗或结束接管，本帧不移动
      return;
    }

    // 无敌时间结束提示
    if (state.invincibleEndTime > 0 && now >= state.invincibleEndTime) {
      state.invincibleEndTime = 0;
      toast.info('🛡️ 无敌保护已结束', 1500);
    }

    state.snake.unshift(next);
    const ateFood = state.foods.findIndex((f) => f.x === next.x && f.y === next.y) >= 0;

    // 加速效果过期恢复速度（按得分回退，对齐 v1）
    if (state.speedBoostEndTime > 0 && now > state.speedBoostEndTime) {
      state.speedBoostEndTime = 0;
      state.speed = Math.max(SOLO_CONFIG.minSpeed, SOLO_CONFIG.initialSpeed - Math.min(Math.floor(state.score / 100) * 10, 90));
      toast.info('⚡ 加速效果已结束', 1500);
    }
    // 双倍得分过期
    if (state.doubleScoreEndTime > 0 && now > state.doubleScoreEndTime) {
      state.doubleScoreEndTime = 0;
      state.scoreMultiplier = 1;
      toast.info('✖️2 双倍得分效果已结束', 1500);
    }

    if (ateFood) {
      const idx = state.foods.findIndex((f) => f.x === next.x && f.y === next.y);
      state.foods.splice(idx, 1);
      state.score += SOLO_CONFIG.foodScore * state.scoreMultiplier;
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
    board.render({ snake: state.snake, foods: state.foods, invincible: isInvincible });
  }

  function endGame(msg) {
    state.running = false;
    state.gameOver = true;
    clearSnakeItemEffects(); // 清除道具效果（对齐 v1 clearSnakeItemEffects）
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
    clearSnakeItemEffects(); // 重置道具效果状态
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
    board.render({ snake: state.snake, foods: state.foods, invincible: false });
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
  // 道具栏（对齐 v1 snake-item-bar，双击使用）
  const itemListEl = el('div', { class: 'snake-item-bar-list' });
  const itemBarEl = el('div', { class: 'snake-item-bar', style: 'display:none;' }, [
    el('div', { class: 'snake-item-bar-head' }, [
      el('span', { class: 'snake-item-bar-title' }, '🎒 道具'),
      el('span', { class: 'snake-item-bar-hint' }, '双击使用'),
    ]),
    itemListEl,
  ]);
  const controls = el('div', { class: 'snake-virtual-controls' }, [upBtn, leftBtn, downBtn, rightBtn]);
  const actions = el('div', { style: 'text-align:center;margin-top:12px;' }, [startBtn]);

  container.innerHTML = '';
  container.append(hud, itemBarEl, boardEl, controls, actions);

  // 触摸滑动控制方向（移动端，任务 5.1.2）
  let touchStart = null;
  function onTouchStart(e) {
    touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function onTouchEnd(e) {
    if (!touchStart) return;
    const dx = e.changedTouches[0].clientX - touchStart.x;
    const dy = e.changedTouches[0].clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return; // 忽略轻点
    if (Math.abs(dx) > Math.abs(dy)) setDirection(dx > 0 ? 'right' : 'left');
    else setDirection(dy > 0 ? 'down' : 'up');
  }
  boardEl.addEventListener('touchstart', onTouchStart, { passive: true });
  boardEl.addEventListener('touchend', onTouchEnd, { passive: true });

  startBtn.addEventListener('click', startGame);
  document.addEventListener('keydown', onKeydown);

  // 初始渲染（未开始时展示初始蛇 + 食物）
  startGame();
  // 加载贪吃蛇道具（本地缓存 + 服务端背包同步，对齐 v1 loadSnakeItems）
  loadSnakeItems();

  window.snakeBoard = board;

  return () => {
    state.running = false;
    if (state.rafId) cancelAnimationFrame(state.rafId);
    document.removeEventListener('keydown', onKeydown);
    boardEl.removeEventListener('touchstart', onTouchStart);
    boardEl.removeEventListener('touchend', onTouchEnd);
    board.destroy();
    if (window.snakeBoard === board) delete window.snakeBoard;
  };
}
