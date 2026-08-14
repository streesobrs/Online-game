/**
 * AI 对战入口（任务 4.4.1）
 * 选择游戏类型（五子棋/围棋/象棋）+ 难度（简单/中等/困难）后开始 AI 对战。
 * 协议与 v1 一致：
 * - emit('ai_game_start', {gameType, difficulty}) → 服务端 createAIGame 回发 ai_game_start
 * - 对局逻辑在 play.js 中实现（4.4.2）
 */
import { el } from '../../utils/dom.js';
import { go } from '../../core/router.js';
import { startAIBattle, cleanupBattle } from './play.js';

/** AI 可选游戏（与 v1 一致：不含贪吃蛇） */
const AI_GAMES = [
  { id: 'gobang', name: '五子棋', icon: '🔴' },
  { id: 'go', name: '围棋', icon: '⚪' },
  { id: 'chinese-chess', name: '象棋', icon: '🟥' },
];

/** 难度配置（与 v1 按钮样式一致） */
const DIFFICULTIES = [
  { id: 'easy', label: '🟢 简单难度', desc: 'AI会随机落子', color: '#48bb78' },
  { id: 'medium', label: '🟡 中等难度', desc: 'AI会进行简单的策略思考', color: '#ed8936' },
  { id: 'hard', label: '🔴 困难难度', desc: 'AI会进行深度的策略思考', color: '#f56565' },
];

/**
 * 渲染 AI 对战入口视图
 * @param {HTMLElement} container - 内容容器（#view-root）
 * @returns {Function} cleanup 函数
 */
export function renderAIBattle(container) {
  let selectedGame = AI_GAMES[0].id;
  cleanupBattle(); // 清理可能残留的对局订阅（返回入口/切换视图时）

  // 游戏类型卡片
  const gameCards = AI_GAMES.map((g) =>
    el('div', {
      class: 'ai-game-type-card' + (g.id === selectedGame ? ' selected' : ''),
      'data-game-type': g.id,
      onClick: () => {
        selectedGame = g.id;
        gameCards.forEach((c) => c.classList.toggle('selected', c.dataset.gameType === selectedGame));
      },
    }, `${g.icon} ${g.name}`)
  );

  // 难度按钮
  const difficultyBtns = DIFFICULTIES.map((d) =>
    el('button', {
      class: 'btn ai-difficulty-btn',
      style: `background:${d.color};`,
      onClick: () => startAIBattle(container, { gameType: selectedGame, difficulty: d.id }),
    }, [
      el('div', { style: 'font-size:16px;font-weight:600;' }, d.label),
      el('div', { style: 'font-size:12px;color:rgba(255,255,255,0.9);margin-top:6px;' }, d.desc),
    ])
  );

  // 返回大厅按钮
  const backBtn = el('button', { class: 'btn ai-back-btn' }, '🏠 返回大厅');
  backBtn.addEventListener('click', () => go('lobby'));

  container.innerHTML = '';
  container.append(el('div', { class: 'ai-container panel', style: 'max-width:620px;width:100%;' }, [
    el('h2', { class: 'panel-title' }, '🤖 AI对战'),
    el('div', { class: 'ai-subtitle' }, '选择游戏类型和难度，挑战AI！'),
    el('div', { class: 'ai-game-types' }, [
      el('div', { class: 'ai-label' }, '游戏类型：'),
      el('div', { class: 'flex gap-8', style: 'justify-content:center;flex-wrap:wrap;' }, gameCards),
    ]),
    el('div', { class: 'ai-difficulties' }, difficultyBtns),
    backBtn,
  ]));

  // cleanup（无异步订阅，无需额外清理）
  return () => {
    cleanupBattle();
    container.innerHTML = '';
  };
}
