/**
 * 贪吃蛇棋盘渲染模块（任务 3.3.1）
 * Canvas 渲染（与 v1 一致）：深色背景 + 网格线 + 圆形食物 + 圆角矩形蛇身/蛇头
 * 两套配置与 v1 snakeGameConfig / snakeDualConfig 一致：
 * - solo：20×20、cellSize 20、canvas 400×400、初始食物 3 个
 * - dual：30×30、cellSize 18、canvas 540×540（联机对局用，3.3.3 接入）
 */
import { el } from '../../utils/dom.js';
import { fitBoard } from '../../utils/responsive.js';

export const SNAKE_CONFIG = {
  solo: {
    gridSize: 20,
    cellSize: 20,
    canvasWidth: 400,
    canvasHeight: 400,
    initialFoodCount: 3,
    colors: {
      head: '#4ecdc4',
      body: '#45b7d1',
      food: '#ff6b6b',
      foodSpecial: '#ffd93d',
      grid: '#2d2d44',
      background: '#1a1a2e',
    },
  },
  dual: {
    gridSize: 30,
    cellSize: 18,
    canvasWidth: 540,
    canvasHeight: 540,
    colors: {
      head1: '#4ecdc4',
      body1: '#45b7d1',
      head2: '#ff6b6b',
      body2: '#ee5a24',
      food: '#ffd93d',
      grid: '#2d2d44',
      background: '#1a1a2e',
    },
  },
};

export const SNAKE_DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * 创建贪吃蛇画布
 * @param {HTMLElement} container - 挂载容器
 * @param {Object} [options]
 * @param {'solo'|'dual'} [options.mode] - 单机/联机画布（默认 solo）
 * @returns {Object} 渲染 API
 */
export function createSnakeBoard(container, options = {}) {
  const { mode = 'solo' } = options;
  let config = SNAKE_CONFIG[mode] || SNAKE_CONFIG.solo;
  let destroyed = false;

  const canvas = el('canvas', {
    class: 'snake-canvas',
    width: config.canvasWidth,
    height: config.canvasHeight,
  });
  const ctx = canvas.getContext('2d');
  container.appendChild(canvas);
  const fit = fitBoard(canvas, container);

  /** 切换画布尺寸（联机开始/结束时调用） */
  function resize(nextMode) {
    config = SNAKE_CONFIG[nextMode] || SNAKE_CONFIG.solo;
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    fit.refresh(); // 画布原始尺寸变化后重算缩放
  }

  /**
   * 绘制一条蛇（蛇身批量 rect + 蛇头单独填充）
   * @param {Array<{x:number,y:number}>} snake - 蛇身数组，下标 0 为头
   * @param {string} headColor
   * @param {string} bodyColor
   */
  function drawSnake(snake, headColor, bodyColor) {
    const { cellSize } = config;
    // 蛇身（除头）
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    snake.slice(1).forEach((s) => {
      ctx.rect(s.x * cellSize + 1, s.y * cellSize + 1, cellSize - 2, cellSize - 2);
    });
    ctx.fill();
    // 蛇头
    const head = snake[0];
    ctx.fillStyle = headColor;
    ctx.fillRect(head.x * cellSize + 1, head.y * cellSize + 1, cellSize - 2, cellSize - 2);
  }

  /**
   * 渲染一帧
   * @param {Object} state
   * @param {Array<{x:number,y:number}>} [state.snake] - 己方蛇身（下标 0 为头）
   * @param {Array<{x:number,y:number}>} [state.snake2] - 对手蛇身（联机模式传入即进入双人渲染）
   * @param {Array<{x:number,y:number}>} [state.foods] - 食物数组
   * @param {boolean} [state.invincible] - 无敌状态（复活卡 5 秒保护，金色闪烁发光，对齐 v1）
   */
  function render(state = {}) {
    if (destroyed) return;
    const { gridSize, cellSize, colors } = config;
    const dual = !!state.snake2;

    // 背景
    ctx.fillStyle = colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 网格线
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= gridSize; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize + 0.5, 0);
      ctx.lineTo(i * cellSize + 0.5, canvas.height);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellSize + 0.5);
      ctx.lineTo(canvas.width, i * cellSize + 0.5);
      ctx.stroke();
    }

    // 食物（圆形；单机交替双色，联机单色）
    if (Array.isArray(state.foods)) {
      state.foods.forEach((f, i) => {
        ctx.beginPath();
        ctx.fillStyle = dual ? colors.food : (i % 2 === 0 ? colors.food : colors.foodSpecial);
        ctx.arc(
          f.x * cellSize + cellSize / 2,
          f.y * cellSize + cellSize / 2,
          cellSize / 2 - 2,
          0,
          Math.PI * 2
        );
        ctx.fill();
      });
    }

    // 对手蛇
    if (dual && Array.isArray(state.snake2) && state.snake2.length) {
      drawSnake(state.snake2, colors.head2, colors.body2);
    }
    // 己方蛇（无敌时金色 + 闪烁发光，复刻 v1 renderSnakeGame）
    if (Array.isArray(state.snake) && state.snake.length) {
      const invincible = !!state.invincible;
      const blinkOn = !invincible || Math.floor(Date.now() / 150) % 2 === 0;
      if (blinkOn) {
        if (invincible) {
          ctx.save();
          ctx.shadowColor = '#ffd700';
          ctx.shadowBlur = 15;
          drawSnake(state.snake, '#ffd700', '#ffeb3b');
          ctx.restore();
        } else {
          drawSnake(state.snake, dual ? colors.head1 : colors.head, dual ? colors.body1 : colors.body);
        }
      }
    }
  }

  return {
    get config() { return config; },
    render,
    resize,
    destroy() {
      destroyed = true;
      fit.destroy();
      canvas.remove();
    },
  };
}
