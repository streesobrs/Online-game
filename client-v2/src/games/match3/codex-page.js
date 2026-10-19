/**
 * 肉鸽图鉴 / 养成：站点级整页视图（路由 #/codex）
 *
 * 局外三个入口（娱乐菜单 / 结算页 / 这里）共用 codex.js 的同一个整页外壳，
 * 本文件只负责「挂到 #view-root」与「离开时退订」两件事。
 *
 * 注意：路由层不会回收视图的 cleanup（见 core/activity.js 注释），所以这里自己订阅
 * route:change 退订；另外遭遇「已在图鉴页又点一次导航」（hash 不变、手动重挂）时，
 * 先收掉上一个面板，避免面板的 onRogueMeta 订阅叠加。
 */
import { renderCodexPage } from './rogue/codex.js';
import { eventBus } from '../../core/eventBus.js';
import { go } from '../../core/router.js';
import { viewRoot } from '../../utils/dom.js';

/** 当前挂载的整页图鉴的 cleanup（同路由重进时用来收掉上一个） */
let activeStop = null;

/**
 * 渲染图鉴整页（路由 #/codex）
 * @param {HTMLElement} [container] - 内容容器（默认 #view-root）
 * @returns {Function} cleanup
 */
export function renderCodexPageView(container = viewRoot()) {
  if (activeStop) {
    activeStop();
    activeStop = null;
  }

  const stopPage = renderCodexPage(container, { onExit: () => go('games') });
  activeStop = stopPage;

  // 离开本路由时退订（同路由重进不下手：那次由上面的 activeStop 兜）
  const off = eventBus.on('route:change', (id) => {
    if (id === 'codex') return;
    off();
    if (activeStop === stopPage) {
      activeStop();
      activeStop = null;
    }
  });

  return stopPage;
}
