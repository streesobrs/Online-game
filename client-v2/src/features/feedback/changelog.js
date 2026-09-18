/**
 * 更新日志渲染组件（帮助/反馈页 Tab 之一）
 *
 * 数据源：src/config/changelog.js
 *   —— 该文件由 server/scripts/gen-changelog.js 从 git 提交记录生成（npm run changelog），
 *      不请求任何外部接口，因此没有网络/限流问题。
 * 布局：左侧版本列表 + 右侧选中记录详情（与资料页「邮箱」Tab 一致）
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

/** 每条记录的稳定标识 */
const keyOf = (r) => r.hash || r.tag;

/** 每页条数 */
const PAGE_SIZE = 10;

/** 当前页码 / 选中记录（跨 Tab 切换保留） */
let currentPage = 1;
let selectedKey = null;

/** 计算需要展示的页码：首尾页 + 当前页前后各一页，中间用省略号跳过 */
function visiblePages(current, total) {
  const pages = [1];
  for (let p = current - 1; p <= current + 1; p++) {
    if (p > 1 && p < total) pages.push(p);
  }
  if (total > 1) pages.push(total);
  return pages;
}

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
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  if (!CHANGELOG.some((r) => keyOf(r) === selectedKey)) selectedKey = keyOf(CHANGELOG[0]);

  const header = el('div', { class: 'clg-header' }, [
    el('div', { class: 'clg-title' }, '📰 更新日志'),
    el('div', { class: 'clg-meta' }, `共 ${CHANGELOG.length} 条更新记录`),
  ]);

  const sideEl = el('div', { class: 'clg-side' });
  const pagerEl = el('div', { class: 'clg-pager' });
  const detailEl = el('div', { class: 'clg-detail' });

  const paint = () => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const items = CHANGELOG.slice(start, start + PAGE_SIZE);

    // 选中项不在本页时，回退到本页第一条（与邮箱逻辑一致）
    if (items.length && !items.some((r) => keyOf(r) === selectedKey)) {
      selectedKey = keyOf(items[0]);
    }

    sideEl.innerHTML = '';
    items.forEach((r) => {
      sideEl.append(
        el(
          'div',
          {
            class: 'clg-side-item' + (keyOf(r) === selectedKey ? ' active' : ''),
            onClick: () => {
              selectedKey = keyOf(r);
              paint();
            },
          },
          [
            el('div', { class: 'clg-side-item-title' }, r.name),
            el('div', { class: 'clg-side-item-meta' }, [
              el('span', { class: 'clg-side-item-tag' }, r.tag),
              el('span', {}, fmtDate(r.publishedAt)),
            ]),
          ]
        )
      );
    });

    renderPager(pagerEl, totalPages, (page) => {
      currentPage = page;
      paint();
    });

    detailEl.innerHTML = '';
    detailEl.append(renderDetail(CHANGELOG.find((r) => keyOf(r) === selectedKey)));
  };

  container.append(
    header,
    el('div', { class: 'clg-layout' }, [
      el('div', { class: 'clg-side-col' }, [sideEl, pagerEl]),
      detailEl,
    ])
  );
  paint();
  return () => { };
}

/** 右侧：选中记录的详情 */
function renderDetail(r) {
  if (!r) return el('div', { class: 'clg-detail-md' }, '（无记录）');

  // 提交里没有 Build 脚注时，tag 会回退成 commit hash，此时不再重复展示
  const chips = [];
  if (r.tag && r.tag !== r.hash) chips.push(el('span', { class: 'clg-detail-tag' }, r.tag));
  if (r.hash) chips.push(el('span', { class: 'clg-detail-hash' }, r.hash));
  chips.push(el('span', {}, `📅 ${fmtDate(r.publishedAt)}`));

  return el('div', {}, [
    el('div', { class: 'clg-detail-head' }, [
      el('div', { class: 'clg-detail-title' }, r.name),
      r.type
        ? el('span', { class: 'clg-detail-type' }, r.scope ? `${r.type}(${r.scope})` : r.type)
        : null,
    ]),
    el('div', { class: 'clg-detail-meta' }, chips),
    el('div', { class: 'clg-detail-md', html: mdToHtml(r.body) || '<em>（无详细说明）</em>' }),
  ]);
}

/** 左侧：分页条（支持直接输入页码跳转） */
function renderPager(pagerEl, totalPages, onGo) {
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, CHANGELOG.length);

  const pageBtn = (page) =>
    el(
      'button',
      {
        class: 'clg-page-btn clg-page-num' + (page === currentPage ? ' active' : ''),
        type: 'button',
        onClick: () => onGo(page),
      },
      String(page)
    );

  const navBtn = (label, page, disabled) =>
    el(
      'button',
      {
        class: 'clg-page-btn',
        type: 'button',
        disabled: disabled || null,
        onClick: () => onGo(page),
      },
      label
    );

  const nav = [navBtn('‹', currentPage - 1, currentPage === 1)];
  const pages = visiblePages(currentPage, totalPages);
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) nav.push(el('span', { class: 'clg-page-gap' }, '…'));
    nav.push(pageBtn(p));
  });
  nav.push(navBtn('›', currentPage + 1, currentPage === totalPages));

  // 跳转输入框
  const input = el('input', {
    class: 'clg-page-input',
    type: 'number',
    min: '1',
    max: String(totalPages),
    value: String(currentPage),
  });
  const jump = () => {
    const n = Math.floor(Number(input.value));
    if (Number.isFinite(n) && n >= 1) onGo(Math.min(n, totalPages));
    else input.value = String(currentPage);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') jump();
  });

  // 固定两行：第一行翻页/页码，第二行跳转；避免在窄侧栏里随机折行
  pagerEl.innerHTML = '';
  pagerEl.append(
    el('div', { class: 'clg-pager-nav' }, nav),
    el('div', { class: 'clg-pager-jump' }, [
      el('span', {}, '跳至'),
      input,
      el('button', { class: 'clg-page-btn', type: 'button', onClick: jump }, '跳转'),
    ]),
    el('div', { class: 'clg-page-info' }, `第 ${start}-${end} 条 · 第 ${currentPage}/${totalPages} 页`)
  );
}
