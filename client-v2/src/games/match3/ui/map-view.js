/**
 * 肉鸽地图选路视图（开发方案 3.1）
 *
 * 纯 DOM + CSS，不引框架；只负责把 mapgen 的节点图画出来并把点击回传，
 * 不持有 run 状态、不做推进（推进在 mode-rogue 里调 mapgen 的纯函数）。
 *
 * 视觉约定：
 * - 纵向 31 排（深度 0 起点 … 30 最终 Boss），窄屏天然竖向滚动
 * - 每排节点在宽度内均匀分布，连线用一张覆盖全图的 SVG 画出
 * - 战争迷雾：未到达（state=locked）的节点不显示类型，只有暗色圆点
 * - 已走过的节点与路径高亮；可选节点（open）脉冲、可点击
 */
import { NODE_META } from '../rogue/mapgen.js';
import { ROGUE_BIOMES } from '../config/config.js';
import { el } from '../../../utils/dom.js';

const ROW_H = 80;      // 每排的纵向间距
const NODE_SIZE = 48;  // 节点直径
const TOP_PAD = 18;
const BOTTOM_PAD = 28;

/** SVG 元素需要 NS（el() 走 createElement，画不出线） */
function svgEl(tag, attrs) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** 节点中心坐标：排内均匀分布（Boss / 起点排只有一个，自然居中） */
function rowX(indexInRow, rowLength) {
  return ((indexInRow + 1) / (rowLength + 1)) * 100;
}
function rowY(depth) {
  return TOP_PAD + depth * ROW_H + ROW_H / 2;
}

/**
 * 渲染地图屏
 * @param {object} map - mapgen.generateMap 的结果（节点 state 已更新到当前进度）
 * @param {object} handlers
 * @param {(nodeId:string)=>void} handlers.onPickNode - 点击某个可选节点
 * @param {()=>void} [handlers.onExit] - 返回模式选择
 * @param {Node} [handlers.topEl] - 标题下方、地图上方的附加区（本轮加成摘要等）
 * @returns {{el:HTMLElement, focus:()=>void}}
 */
export function renderMapScreen(map, { onPickNode, onExit, topEl = null } = {}) {
  const canvasH = TOP_PAD + (map.depth + 1) * ROW_H + BOTTOM_PAD;

  // ---- 区域色带与区域名（1-10 / 11-20 / 21-30，与 ROGUE_BIOMES 同源）----
  const bands = ROGUE_BIOMES.map((biome) => {
    const top = rowY(biome.from) - ROW_H / 2;
    const height = (biome.to - biome.from + 1) * ROW_H;
    return el(
      'div',
      {
        class: `m3-map-band m3-map-band--${biome.id}`,
        style: { top: `${top}px`, height: `${height}px` },
      },
      el('span', { class: 'm3-map-band-label' }, `${biome.icon} ${biome.name} · ${biome.from}-${biome.to}层`),
    );
  });

  // ---- 连线（先于节点画，节点盖在线端上）----
  const edgeSvg = svgEl('svg', {
    class: 'm3-map-edges',
    viewBox: `0 0 100 ${canvasH}`,
    preserveAspectRatio: 'none',
  });
  for (const node of map.nodes) {
    const fromIdx = map.rows[node.depth].findIndex((n) => n.id === node.id);
    const x1 = rowX(fromIdx, map.rows[node.depth].length);
    const y1 = rowY(node.depth);
    for (const toId of node.next) {
      const to = map.byId.get(toId);
      if (!to) continue;
      const toIdx = map.rows[to.depth].findIndex((n) => n.id === toId);
      const x2 = rowX(toIdx, map.rows[to.depth].length);
      const y2 = rowY(to.depth);
      let cls = 'm3-map-edge';
      if (node.state === 'done' && to.state === 'done') cls += ' m3-map-edge--taken';
      else if (node.state === 'done' && to.state === 'open') cls += ' m3-map-edge--active';
      edgeSvg.append(svgEl('line', {
        x1, y1, x2, y2,
        class: cls,
        'vector-effect': 'non-scaling-stroke',
      }));
    }
  }

  // ---- 节点 ----
  const nodeEls = [];
  for (const node of map.nodes) {
    const idx = map.rows[node.depth].findIndex((n) => n.id === node.id);
    const x = rowX(idx, map.rows[node.depth].length);
    const y = rowY(node.depth);
    const meta = NODE_META[node.type] || NODE_META.battle;

    let body;
    if (node.state === 'locked') {
      // 战争迷雾：看不到类型，也点不了
      body = el('div', { class: 'm3-map-node m3-map-node--fog', 'aria-disabled': 'true' }, '·');
    } else {
      const pickable = node.state === 'open';
      body = el(
        'button',
        {
          class: [
            'm3-map-node',
            `m3-map-node--${node.type}`,
            `m3-map-node--${node.state}`,
            meta.danger ? 'm3-map-node--danger' : '',
            pickable ? 'm3-map-node--pickable' : '',
          ].filter(Boolean).join(' '),
          type: 'button',
          title: `${meta.name} · 第 ${node.depth} 层`,
          ...(pickable ? { onClick: () => onPickNode(node.id) } : { disabled: 'true' }),
        },
        el('span', { class: 'm3-map-node-icon' }, meta.icon),
        node.state === 'done' ? el('span', { class: 'm3-map-node-check' }, '✓') : null,
      );
    }
    body.style.top = `${y - NODE_SIZE / 2}px`;
    body.style.left = `calc(${x}% - ${NODE_SIZE / 2}px)`;
    body.style.width = `${NODE_SIZE}px`;
    body.style.height = `${NODE_SIZE}px`;
    body.dataset.depth = String(node.depth);
    body.dataset.id = node.id;
    nodeEls.push(body);
  }

  const scroll = el(
    'div',
    { class: 'm3-map-scroll' },
    el('div', { class: 'm3-map-canvas', style: { height: `${canvasH}px` } }, ...bands, edgeSvg, ...nodeEls),
  );

  const root = el(
    'div',
    { class: 'm3-map-screen' },
    el(
      'div',
      { class: 'm3-map-head' },
      el('h2', { class: 'm3-title' }, '🗺️ 选择前进路线'),
      el('p', { class: 'm3-sub' }, '亮起的节点可以前进；同一层只能选一条岔路，放弃的分支会永久关闭'),
    ),
    topEl,
    scroll,
    el(
      'div',
      { class: 'm3-map-actions' },
      el('button', { class: 'm3-btn m3-btn--ghost', onClick: () => onExit?.() }, '返回选择'),
    ),
  );

  // 进入地图时把视口对准「当前可选的第一排」（续玩深层时不用从起点往下划）
  const focus = () => {
    const firstOpen = nodeEls.find((n) => n.classList.contains('m3-map-node--open'));
    (firstOpen || nodeEls[0]).scrollIntoView({ block: 'center', behavior: 'auto' });
  };

  return { el: root, focus };
}
