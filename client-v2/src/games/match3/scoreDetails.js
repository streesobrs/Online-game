/**
 * 积分详情弹窗（闯关 / 无尽共用）
 *
 * 把累计分数按来源拆开展示，让玩家理解「分是从哪来的」：
 * - 基础消除：消除格数 × 每格基准分 × 连锁倍率，随连锁层数累计
 * - 特殊触发：条状 / 竖条 / 炸弹 / 彩球触发的加分
 * - 障碍击碎：每击碎一个障碍的加分
 * 三者之和 = 当前总分（保证与 HUD 一致）。
 *
 * breakdown 结构由 cascade.js 的 emptyBreakdown / mergeBreakdown 约定：
 *   { tile, special, blocker, specials: {row,col,bomb,rainbow}, cascades: {层数:次数} }
 */
import { SCORE, SPECIAL, COLOR_NAMES, colorScoreMultiplier } from './config.js';
import { el } from '../../utils/dom.js';
import { modal } from '../../components/modal.js';

const SPECIAL_NAMES = {
  [SPECIAL.ROW]: '横向条状',
  [SPECIAL.COL]: '竖向条状',
  [SPECIAL.BOMB]: '炸弹',
  [SPECIAL.RAINBOW]: '彩球',
};

/** 千分位分隔（纯展示） */
function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 一行：标签 / 值 / 说明 */
function row(label, value, hint = '') {
  return el(
    'div',
    { class: 'm3-detail-row' },
    el('span', { class: 'm3-detail-label' }, label),
    hint ? el('span', { class: 'm3-detail-hint' }, hint) : null,
    el('span', { class: 'm3-detail-val' }, String(value)),
  );
}

/**
 * 打开积分详情弹窗
 * @param {Object} info - board 的 onUpdate / getState / onGameOver 参数，含 breakdown
 */
export function showScoreDetails(info) {
  const breakdown = info?.breakdown || {};
  const total = info?.score || 0;

  // ---- 累计触发统计 ----
  const specItems = Object.entries(breakdown.specials || {})
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${SPECIAL_NAMES[kind] || kind}×${count}`);

  const cascadeItems = Object.entries(breakdown.cascades || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([level, count]) => `n${level}（${Math.round(SCORE.cascadeStep * (Number(level) - 1) * 100) + 100}%）×${count}`);

  // ---- 各目标进度 ----
  const goalInfo = (info?.goals || []).map((g) => {
    let current;
    if (g.type === 'score') current = total;
    else if (g.type === 'collect') current = (info?.collected || {})[g.color] || 0;
    else current = info?.blockersCleared || 0;
    return { g, current };
  });

  // 无尽模式按颜色数缩放得分，需向玩家说明，否则会疑惑「消了这么多怎么才这点分」
  const colorMult = colorScoreMultiplier(info?.colors);
  const multHint = info?.colors && colorMult !== 1
    ? `${info.colors} 色得分倍率 ×${colorMult}（颜色越多每分越值钱）`
    : '';

  modal.show({
    title: '📊 积分详情',
    showCancel: false,
    confirmText: '知道了',
    content: el(
      'div',
      { class: 'm3-detail' },
      el(
        'div',
        { class: 'm3-detail-total' },
        el('span', { class: 'm3-detail-total-label' }, '当前总分'),
        el('span', { class: 'm3-detail-total-num' }, fmt(total)),
      ),
      el(
        'div',
        { class: 'm3-detail-sec' },
        el('div', { class: 'm3-detail-sec-title' }, '分数构成'),
        multHint ? el('p', { class: 'm3-detail-sub' }, multHint) : null,
        row('基础消除', fmt(breakdown.tile || 0)),
        breakdown.special ? row('特殊触发', `+${fmt(breakdown.special || 0)}`) : null,
        breakdown.blocker ? row('击碎障碍', `+${fmt(breakdown.blocker || 0)}`) : null,
      ),
      specItems.length
        ? el(
          'div',
          { class: 'm3-detail-sec' },
          el('div', { class: 'm3-detail-sec-title' }, '特殊元素触发'),
          ...specItems.map((t) => el('span', { class: 'm3-detail-chip' }, t)),
        )
        : null,
      cascadeItems.length
        ? el(
          'div',
          { class: 'm3-detail-sec' },
          el('div', { class: 'm3-detail-sec-title' }, '连锁倍率分布'),
          el(
            'p',
            { class: 'm3-detail-sub' },
            `每连锁多加 ${Math.round(SCORE.cascadeStep * 100)}% 上限 ${Math.round((SCORE.cascadeMax - 1) * 100)}%`,
          ),
          ...cascadeItems.map((t) => el('span', { class: 'm3-detail-chip' }, t)),
        )
        : null,
      goalInfo.length
        ? el(
          'div',
          { class: 'm3-detail-sec' },
          el('div', { class: 'm3-detail-sec-title' }, '关卡目标'),
          ...goalInfo.map(({ g, current }) => {
            const text =
              g.type === 'score'
                ? `得分 ${fmt(Math.min(current, g.target))} / ${fmt(g.target)}`
                : g.type === 'collect'
                  ? `收集 ${COLOR_NAMES[g.color] || g.color}色 ${Math.min(current, g.target)} / ${g.target}`
                  : `清除障碍 ${Math.min(current, g.target)} / ${g.target}`;
            const done = current >= g.target;
            return el(
              'div',
              { class: `m3-detail-goal${done ? ' m3-detail-goal--done' : ''}` },
              text,
            );
          }),
        )
        : null,
    ),
  });
}