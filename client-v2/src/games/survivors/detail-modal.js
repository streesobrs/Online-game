/**
 * 图鉴详情模态框：左侧 Canvas 直接运行真实的 buff / 怪物模块，右侧数值文案。
 * 整页图鉴（codex-page.js）与局内图鉴（catalog.js）共用同一套组件。
 */
import { el } from '../../utils/dom.js';
import { eventBus } from '../../core/eventBus.js';
import { formatTime, highlightNumbers } from './helpers.js';
import { ELEMENT_INFO } from './elements.js';
import { createPreview, PREVIEW_W, PREVIEW_H } from './preview-sim.js';

const PW = PREVIEW_W;
const PH = PREVIEW_H;

/** 当前打开的详情框（同一时刻只保留一个） */
let active = null;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function buffTagChip(text, color) {
  return el('span', { class: 'sv-detail-chip', style: { color, borderColor: color } }, text);
}

// ---------------- 右侧数值文案 ----------------

function buffCopy(buff, stacks, getLevel, setLevel) {
  const max = Math.max(1, buff.max || 1);
  const copy = el('div', { class: 'sv-detail-copy' });

  copy.append(el('div', { class: 'sv-detail-block' }, [
    el('div', { class: 'sv-detail-block-title' }, '效果'),
    el('p', { class: 'sv-detail-text' }, ...highlightNumbers(buff.desc || '')),
    buff.detail ? el('p', { class: 'sv-detail-text sv-detail-muted' }, ...highlightNumbers(buff.detail)) : null,
  ]));

  const effectNow = el('span', { class: 'sv-detail-now' });
  const rows = [];
  const table = el('div', { class: 'sv-detail-table' });
  for (let lv = 1; lv <= max; lv += 1) {
    const row = el('button', {
      class: 'sv-detail-row',
      type: 'button',
      onClick: () => setLevel(lv),
    }, [
      el('span', { class: 'sv-detail-row-lv' }, `Lv.${lv}`),
      el('span', { class: 'sv-detail-row-val' }, ...highlightNumbers(
        typeof buff.effect === 'function' ? buff.effect(lv) : buff.desc || '',
      )),
    ]);
    rows.push({ el: row, lv });
    table.append(row);
  }
  copy.append(el('div', { class: 'sv-detail-block' }, [
    el('div', { class: 'sv-detail-block-title' }, ['数值成长 ', effectNow]),
    table,
  ]));

  const extras = [];
  if (stacks > 0) extras.push(buffTagChip(`本局 ${stacks} / ${max} 层`, '#5eead4'));
  if (buff.requireText) extras.push(el('span', { class: 'sv-detail-note' }, buff.requireText));
  if (extras.length) {
    copy.append(el('div', { class: 'sv-detail-block sv-detail-block--extras' }, extras));
  }

  function refresh() {
    const lv = getLevel();
    const text = typeof buff.effect === 'function' ? buff.effect(lv) : '';
    effectNow.replaceChildren(...highlightNumbers(`当前 Lv.${lv}${text ? ` · ${text}` : ''}`));
    rows.forEach((row) => row.el.classList.toggle('is-current', row.lv === lv));
  }
  refresh();
  return { node: copy, refresh };
}

function monsterCopy(monster) {
  const s = monster.stats || {};
  let unlock = '特殊召唤';
  if (monster.spawnable) unlock = monster.unlockAt ? `${formatTime(monster.unlockAt)} 后出现` : '开局出现';
  else if (monster.boss) unlock = `每 ${monster.spawnInterval} 秒出现`;

  const stat = (label, value, cls = '') => el('div', { class: `sv-detail-stat ${cls}`.trim() }, [
    el('span', { class: 'sv-detail-stat-label' }, label),
    el('span', { class: 'sv-detail-stat-value' }, ...highlightNumbers(String(value))),
  ]);

  const copy = el('div', { class: 'sv-detail-copy' }, [
    el('div', { class: 'sv-detail-block' }, [
      el('div', { class: 'sv-detail-block-title' }, '行为'),
      el('p', { class: 'sv-detail-text' }, ...highlightNumbers(monster.desc || '')),
    ]),
    el('div', { class: 'sv-detail-block' }, [
      el('div', { class: 'sv-detail-block-title' }, '初始数值'),
      el('div', { class: 'sv-detail-stats' }, [
        stat('❤ 生命', s.hp, 'is-hp'),
        stat('👣 速度', s.speed),
        stat('⚔ 伤害', s.dmg, 'is-atk'),
        stat('⭐ 经验', s.xp, 'is-xp'),
        stat('⭕ 半径', s.r),
        stat('⚖ 权重', monster.spawnable ? (monster.weight || 1) : '—'),
      ]),
    ]),
    el('div', { class: 'sv-detail-block' }, [
      el('div', { class: 'sv-detail-block-title' }, '出没'),
      el('div', { class: 'sv-detail-stat-line' }, [
        el('span', { class: 'sv-detail-chip' }, unlock),
        monster.spawnable ? el('span', { class: 'sv-detail-note' }, '按权重混入普通刷怪池') : null,
        monster.boss ? el('span', { class: 'sv-detail-note' }, 'Boss 单位') : null,
      ]),
      el('p', { class: 'sv-detail-text sv-detail-muted' }, '展示为初始数值，对局中生命、速度与伤害会随时间成长。'),
    ]),
  ]);
  return copy;
}

// ---------------- 模态框骨架 ----------------

function closeDetail() {
  if (!active) return;
  const current = active;
  active = null;
  if (current.raf) cancelAnimationFrame(current.raf);
  document.removeEventListener('keydown', current.onKey, true);
  if (current.offRoute) current.offRoute();
  current.overlay.remove();
  document.body.classList.remove('sv-detail-open');
}

function openDetail({ kind, item, stacks = 0 }) {
  closeDetail();

  const isBuff = kind === 'buff';
  const overlay = el('div', { class: 'sv-detail-overlay' });
  const headIcon = isBuff
    ? el('span', { class: 'sv-detail-icon' }, item.icon || '📖')
    : el('span', { class: 'sv-detail-swatch', style: { background: (item.stats && item.stats.color) || '#94a3b8' } });

  const tags = [];
  if (isBuff) {
    if (item.element) {
      const info = ELEMENT_INFO[item.element];
      tags.push(buffTagChip(`${info ? info.icon : ''} ${info ? info.name : ''}元素`, info ? info.color : '#93c5fd'));
    }
    if (item.reaction) tags.push(buffTagChip(item.reactionName || '元素反应', item.color || '#facc15'));
    tags.push(el('span', { class: 'sv-detail-chip' }, `上限 ${Math.max(1, item.max || 1)} 层`));
    if (stacks > 0) tags.push(el('span', { class: 'sv-detail-chip' }, `本局 ${stacks} 层`));
  }

  const title = el('h3', { class: 'sv-detail-title' }, item.name || '详情');
  const sub = el('div', { class: 'sv-detail-tags' }, ...tags);
  const closeBtn = el('button', { class: 'sv-detail-close', type: 'button', 'aria-label': '关闭' }, '×');
  closeBtn.addEventListener('click', closeDetail);

  // 左侧演示引擎：直接运行真实 buff / 怪物模块
  const sim = createPreview({ kind, item });
  const baseCaption = isBuff ? '真实效果演示 · 拖动层数查看变化' : '真实行为演示';
  const caption = el('div', { class: 'sv-detail-cap' }, sim.note ? `${baseCaption} · ${sim.note}` : baseCaption);

  const canvas = el('canvas', { class: 'sv-detail-canvas' });
  const previewCol = el('div', { class: 'sv-detail-preview' }, [canvas, caption]);

  let level = Math.max(1, Math.min(item.max || 1, stacks > 0 ? stacks : 1));
  let copyRefresh = null;
  let slider = null;
  let levelLabel = null;

  const setLevel = (lv) => {
    level = clamp(lv, 1, Math.max(1, item.max || 1));
    if (slider) slider.value = String(level);
    if (levelLabel) levelLabel.textContent = `Lv.${level}`;
    sim.setLevel(level);
    if (copyRefresh) copyRefresh();
  };

  if (isBuff && (item.max || 1) > 1) {
    slider = el('input', {
      class: 'sv-detail-range',
      type: 'range',
      min: 1,
      max: Math.max(1, item.max || 1),
      step: 1,
      value: level,
      'aria-label': '演示层数',
    });
    levelLabel = el('b', { class: 'sv-detail-level' }, `Lv.${level}`);
    slider.addEventListener('input', () => setLevel(Number(slider.value)));
    previewCol.append(el('div', { class: 'sv-detail-levelbar' }, [
      el('span', { class: 'sv-detail-leveltext' }, '演示层数'),
      slider,
      levelLabel,
    ]));
  }

  let copyNode;
  if (isBuff) {
    const built = buffCopy(item, stacks, () => level, setLevel);
    copyNode = built.node;
    copyRefresh = built.refresh;
    if (level > 1) setLevel(level);
  } else {
    copyNode = monsterCopy(item);
  }

  const body = el('div', { class: 'sv-detail-body' }, [previewCol, copyNode]);
  const panel = el('div', { class: 'sv-detail', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${item.name || ''} 详情` }, [
    el('header', { class: 'sv-detail-head' }, [headIcon, el('div', { class: 'sv-detail-heading' }, [title, sub]), closeBtn]),
    body,
  ]);
  overlay.append(panel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDetail();
  });

  document.body.appendChild(overlay);
  document.body.classList.add('sv-detail-open');

  // 抢先处理 Esc：关闭详情而不是让局内图鉴 / 游戏同时响应
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeDetail();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const ctx = canvas.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(PW * dpr);
  canvas.height = Math.round(PH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  let last = performance.now();
  const frame = (now) => {
    if (!active || active.overlay !== overlay) return;
    const step = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    sim.update(step);
    ctx.clearRect(0, 0, PW, PH);
    sim.draw(ctx);
    active.raf = requestAnimationFrame(frame);
  };

  active = {
    overlay,
    raf: requestAnimationFrame(frame),
    onKey,
    // 路由切换（返回大厅等）时自动收掉详情，避免覆盖层残留在新页面上
    offRoute: eventBus.on('route:change', () => closeDetail()),
  };
}

/** 打开强化 / 元素 / 反应强化的详情 */
export function openBuffDetail(buff, options = {}) {
  if (!buff) return;
  openDetail({ kind: 'buff', item: buff, stacks: Number(options.stacks) || 0 });
}

/** 打开怪物详情 */
export function openMonsterDetail(monster) {
  if (!monster) return;
  openDetail({ kind: 'monster', item: monster });
}

export { closeDetail };
