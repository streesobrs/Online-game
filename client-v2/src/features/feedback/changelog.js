/**
 * 更新日志渲染组件（帮助/反馈页 Tab 之一）
 *
 * 数据源：src/config/changelog.js
 *   —— 该文件由 scripts/gen-changelog.js 从 git 提交记录生成（npm run changelog），
 *      不请求任何外部接口，因此没有网络/限流问题。
 * 渲染：极简 Markdown → HTML（src/utils/md.js）
 */
import { el } from '../../utils/dom.js';
import { CHANGELOG } from '../../config/changelog.js';
import { mdToHtml } from '../../utils/md.js';

/** 格式化 ISO 日期 */
function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** 每页条数 */
const PAGE_SIZE = 10;

/** 当前页码（跨 Tab 切换保留） */
let currentPage = 1;

/**
 * 渲染更新日志面板
 * @param {HTMLElement} container - 挂载容器（feedback 页的 Tab 区域）
 * @returns {Function} cleanup
 */
export function renderChangelog(container) {
  container.innerHTML = '';

  // 空态：尚未执行过生成脚本
  if (!CHANGELOG.length) {
    container.append(
      el('div', { class: 'clg-empty' }, [
        el('div', {}, '📭 还没有更新记录'),
        el('div', { class: 'clg-empty-hint' }, '运行 npm run changelog 生成后重新打包即可展示'),
      ])
    );
    return () => { };
  }

  const totalPages = Math.max(1, Math.ceil(CHANGELOG.length / PAGE_SIZE));

  const header = el('div', { class: 'clg-header' }, [
    el('div', { class: 'clg-title' }, '📰 更新日志'),
    el('div', { class: 'clg-meta' }, [
      el('span', {}, `共 ${CHANGELOG.length} 条更新记录`),
    ]),
  ]);

  const mount = el('div');

  /** 渲染指定页 @param {number} page @param {boolean} focus 是否滚动到列表顶部 */
  const paint = (page, focus = false) => {
    currentPage = Math.min(Math.max(1, page), totalPages);

    const start = (currentPage - 1) * PAGE_SIZE;
    const listEl = el('div', { class: 'clg-list' });
    CHANGELOG.slice(start, start + PAGE_SIZE).forEach((r) => listEl.append(renderRelease(r)));

    mount.innerHTML = '';
    mount.append(listEl);
    if (totalPages > 1) mount.append(renderPager(totalPages, paint));

    if (focus) listEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  container.append(header, mount);
  paint(currentPage);
  return () => { };
}

/** 分页条 */
function renderPager(totalPages, onGo) {
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, CHANGELOG.length);

  const btn = (label, page, disabled) =>
    el(
      'button',
      {
        class: 'clg-page-btn',
        type: 'button',
        disabled: disabled || null,
        onClick: () => onGo(page, true),
      },
      label
    );

  return el('div', { class: 'clg-pager' }, [
    btn('‹ 上一页', currentPage - 1, currentPage === 1),
    el('span', { class: 'clg-page-info' }, `第 ${start}-${end} 条 · 第 ${currentPage}/${totalPages} 页`),
    btn('下一页 ›', currentPage + 1, currentPage === totalPages),
  ]);
}

function renderRelease(r) {
  return el('div', { class: 'clg-release' }, [
    // 头部：版本号 + 标题 + 提交短哈希
    el('div', { class: 'clg-release-head' }, [
      el('div', { class: 'clg-release-tag' }, r.tag),
      el('div', { class: 'clg-release-title' }, r.name),
      ...(r.hash ? [el('span', { class: 'clg-release-hash' }, r.hash)] : []),
    ]),
    el('div', { class: 'clg-release-meta' }, [
      el('span', {}, `📅 ${fmtDate(r.publishedAt)}`),
    ]),
    // 详情（默认折叠）
    el('details', { class: 'clg-release-body' }, [
      el('summary', {}, '查看完整更新说明'),
      el('div', { class: 'clg-release-md', html: mdToHtml(r.body) || '<em>（无详细说明）</em>' }),
    ]),
  ]);
}
