/**
 * 响应式工具（任务 5.1.1/5.1.2）
 * fitBoard：棋盘等比缩放适配（zoom 方案）。
 * 棋盘内部坐标/网格线逻辑不做任何改动，仅按容器可用宽度对整体元素缩放，
 * 布局占位同步缩小，后续元素正常排布；resize 时自动重算。
 */

/**
 * 使棋盘元素适配容器宽度（不放大，仅等比缩小）
 * @param {HTMLElement} boardEl - 棋盘根元素（如 .gobang-board / canvas）
 * @param {HTMLElement} [container] - 参考容器（默认取视口宽度）
 * @returns {{refresh: Function, destroy: Function}}
 *   - refresh()：元素原始尺寸变化后（如贪吃蛇切换单/双模式）重置并重算
 *   - destroy()：解除 resize 监听
 */
export function fitBoard(boardEl, container) {
  let base = null; // 原始宽度（未缩放时记录一次）

  function apply() {
    if (!boardEl) return;
    if (base === null) base = boardEl.offsetWidth || 400;
    const avail = (container && container.clientWidth) || window.innerWidth;
    const scale = Math.min(1, avail / base);
    boardEl.style.zoom = scale < 1 ? String(scale) : '';
  }

  function refresh() {
    boardEl.style.zoom = '';
    base = null;
    apply();
  }

  apply();
  window.addEventListener('resize', apply);

  return {
    refresh,
    destroy() {
      window.removeEventListener('resize', apply);
    },
  };
}
