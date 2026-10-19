/**
 * 棋盘目标判定（开发方案 3.2 / 4.1）
 *
 * 闯关模式（mode-level）与肉鸽（mode-rogue）共用同一套目标语义，抽成纯函数避免两份漂移：
 * - score：本层得分达到 target
 * - collect：本层累计消除某颜色 target 个（info.collected 由 board 每盘从 0 计）
 * - clearBlockers：本层累计击碎障碍 target 个（info.blockersCleared）
 *
 * info 即 board 的 onUpdate / getState 快照：{ score, collected, blockersCleared, ... }
 */
import { COLOR_NAMES } from '../config/config.js';

/** 目标文案 */
export function goalLabel(goal) {
  if (goal.type === 'score') return `得分达到 ${goal.target}`;
  if (goal.type === 'collect') return `收集 ${COLOR_NAMES[goal.color] || goal.color}色 ${goal.target} 个`;
  return `清除障碍 ${goal.target} 个`;
}

/** 目标的简短行内文案（侧栏紧凑展示用） */
export function goalShort(goal) {
  if (goal.type === 'score') return `得分 ${goal.target}`;
  if (goal.type === 'collect') return `${COLOR_NAMES[goal.color] || goal.color}色 ×${goal.target}`;
  return `清障 ${goal.target}`;
}

/**
 * 目标的「原值」提示：减免类祝福（侦察报告 / 采集协议）把目标压低后，
 * 侧栏把未减免的原值一并摆出来，玩家才看得出这张祝福削了多少。
 * @param {object} goal - 目标；带上 `base`（减免前的值）时才有提示
 * @returns {string|null} 形如「（原 900）」；无减免 / 原值等于现值时返回 null
 */
export function goalBaseNote(goal) {
  if (!Number.isFinite(goal && goal.base) || goal.base === goal.target) return null;
  return goal.type === 'collect' ? `（原 ×${goal.base}）` : `（原 ${goal.base}）`;
}

/**
 * 单个目标的当前进度
 * @returns {{goal:object, current:number, done:boolean}}
 */
export function goalProgressOne(goal, info) {
  if (goal.type === 'score') {
    return { goal, current: info.score || 0, done: (info.score || 0) >= goal.target };
  }
  if (goal.type === 'collect') {
    const current = info.collected?.[goal.color] || 0;
    return { goal, current, done: current >= goal.target };
  }
  const current = info.blockersCleared || 0;
  return { goal, current, done: current >= goal.target };
}

/** 一组目标的进度（与闯关 level.goals 同形） */
export function goalProgress(goals, info) {
  return (goals || []).map((goal) => goalProgressOne(goal, info));
}

/** 全部目标是否达成（过关判定） */
export function allGoalsDone(goals, info) {
  const list = goals || [];
  return list.length > 0 && list.every((goal) => goalProgressOne(goal, info).done);
}
