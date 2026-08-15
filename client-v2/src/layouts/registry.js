/**
 * 布局注册表
 * 布局 = 纯函数 render(container) => cleanup，消费同一份 NAV_ITEMS。
 * 参照开发文档第十章 10.2。
 */
import { renderTopNav } from './topnav.js';

// 账号条为全局元素（独立于导航布局），由 main.js 挂载到 #account-root
export { renderAccountBar } from './topnav.js';

export const LAYOUTS = {
    topnav: {
        id: 'topnav',
        name: '顶部导航',
        render: renderTopNav,
    },
    // hub: { id: 'hub', name: '大厅九宫格', render: renderHub }, // 后续任务实现
    // dock: { id: 'dock', name: 'Dock磁吸', render: renderDock }, // 后续任务实现
};

/** 按 id 获取布局（未知 id 回退 topnav） */
export function getLayout(id) {
    return LAYOUTS[id] || LAYOUTS.topnav;
}

/**
 * 切换布局
 * @param {string} id - 布局 id
 */
export function switchLayout(id) {
    const layout = getLayout(id);
    const container = document.getElementById('nav-root') || document.getElementById('app');
    if (!container) return;

    // 清理旧布局
    if (window._currentLayoutCleanup) window._currentLayoutCleanup();
    container.innerHTML = '';
    container.className = `nav-layout nav-layout--${layout.id}`;

    // 渲染新布局
    window._currentLayoutCleanup = layout.render(container);
    localStorage.setItem('nav-layout', id);
}
