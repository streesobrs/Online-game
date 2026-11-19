/**
 * 棋类规则弹窗
 * 文案与 v1（client/index.html 的 gameConfigs[].rules）保持一致。
 */
import { el } from '../utils/dom.js';
import { modal } from '../components/modal.js';
import { sfx } from '../core/sfx.js';

export const RULES = {
  gobang: {
    title: '五子棋规则',
    emoji: '🔴',
    text: `五子棋规则：
• 黑白双方轮流落子，黑棋先行
• 先在一条直线（横、竖、斜）上形成五子连珠者获胜
• 落子后不能移动或拿掉任何棋子
• 禁止长连（超过五颗棋子连成一线）
• 禁止三三、四四、长连等禁手（本版本简化规则）`,
  },
  go: {
    title: '围棋规则',
    emoji: '⚪',
    text: `围棋规则：
• 黑白双方轮流落子，黑棋先行
• 棋子放在交叉点上，不能移动
• 当一组棋子的气（相邻空格）被对方填满时，这组棋子被提走
• 禁止自杀（落子后使自己的棋子立即无气）
• 禁止打劫（立即提回被提走的棋子）
• 游戏结束时，领地和棋子数量之和多者获胜`,
  },
  'chinese-chess': {
    title: '象棋规则',
    emoji: '🟥',
    text: `象棋规则：
• 红方先行，双方轮流移动棋子
• 马走日，象走田，车走直线炮翻山
• 士走斜线护将边，将在九宫转圈圈
• 兵卒过河横竖走，过河之前只向前
• 吃掉对方的将帅获胜
• 不能长将、长捉、长杀等重复循环`,
  },
};

/**
 * 打开规则弹窗
 * @param {'gobang'|'go'|'chinese-chess'} gameType
 */
export function showRules(gameType) {
  const rule = RULES[gameType];
  if (!rule) return;
  sfx.play('click');
  modal.show({
    title: `${rule.emoji} ${rule.title}`,
    content: el('div', { class: 'game-rules' }, [
      el('p', { class: 'game-rules__text' }, rule.text),
      el('p', { class: 'game-rules__keys' }, '对局快捷键：Z 悔棋 · Shift+Z 重做 · U 认输 · N 新局 · P 暂停 · M 重新匹配 · R 返回大厅 · T 规则'),
    ]),
    confirmText: '知道了',
    showCancel: false,
  });
}

export default showRules;
