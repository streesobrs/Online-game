/**
 * 轻量 Markdown → HTML 渲染器
 * 无第三方依赖，覆盖公告 / 更新日志等常见排版场景。
 *
 * 支持：
 *   标题、段落、分隔线
 *   粗体 / 斜体 / 粗斜体 / 删除线 / 行内代码
 *   无序、有序、多层嵌套列表、任务列表
 *   表格（含左 / 中 / 右对齐）
 *   代码块（带语言标记）
 *   多级引用、链接、图片、裸链接自动识别、<url> 自动链接
 *   行尾两个空格换行
 *   下标 H~2~O、上标 E=mc^2^
 *   脚注 [^1] / [^name]
 *   反斜杠转义
 *   白名单内联 HTML：kbd / mark / sub / sup / b / strong / i / em / u / s / del / ins / br / code / span
 *   块级 HTML：details / summary / div[align=center|left|right]
 * 不支持：数学公式（$...$）、任意带属性 HTML（会按纯文本转义）。
 */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ESC_MAP[c] || c);
}

/** 仅放行安全的链接协议 */
function safeHref(url) {
  const u = String(url).trim();
  return /^(https?:\/\/|mailto:|\/|\.\/|#)/i.test(u) ? u : '#';
}

/** 图片地址：http(s) 或相对路径 */
function safeSrc(url) {
  const u = String(url).trim();
  return /^(https?:\/\/|\/|\.\/)/i.test(u) ? u : '';
}

const ALLOWED_INLINE_TAGS = [
  'kbd', 'mark', 'sub', 'sup', 'b', 'strong', 'i', 'em',
  'u', 's', 'del', 'ins', 'br', 'code', 'span',
].join('|');

/**
 * 行内解析
 * @param {string} text
 * @param {Map<string,string>} [footnotes] 脚注定义
 */
function inline(text, footnotes) {
  const tokens = [];
  /** 暂存已生成的 HTML，避免后续转义或二次解析 */
  const stash = (html) => {
    tokens.push(html);
    return `\u0000${tokens.length - 1}\u0000`;
  };

  let s = String(text);

  // 反斜杠转义（最先处理，避免 \* 被当成强调）
  s = s.replace(/\\([\\`*_{}\[\]()#+\-.!~|>])/g, (m, ch) => stash(esc(ch)));

  // 行内代码（内部不再解析）
  s = s.replace(/`([^`]+)`/g, (m, code) => stash(`<code>${esc(code)}</code>`));

  // 图片
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const src = safeSrc(url);
    if (!src) return stash(esc(m));
    return stash(`<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`);
  });

  // <https://...> 自动链接
  s = s.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g,
    (m, url) => stash(`<a href="${esc(safeHref(url))}" target="_blank" rel="noopener">${esc(url)}</a>`));

  // 白名单内联 HTML（只放行无属性的安全标签）
  s = s.replace(new RegExp(`<(\\/?)(?:${ALLOWED_INLINE_TAGS})\\s*\\/?>`, 'gi'),
    (m) => stash(m));

  // Markdown 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (m, label, url) => stash(`<a href="${esc(safeHref(url))}" target="_blank" rel="noopener">${esc(label)}</a>`));

  // 其余文本转义
  s = esc(s);

  // 脚注引用（需在上下标解析之前，避免 ^ 被误判）
  if (footnotes && footnotes.size) {
    s = s.replace(/\[\^([^\]]+)\]/g, (m, id) => (footnotes.has(id)
      ? `<sup class="footnote-ref"><a href="#fn-${esc(id)}" id="fnref-${esc(id)}">[${esc(id)}]</a></sup>`
      : m));
  }

  // 粗斜体
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/___([^_]+)___/g, '<strong><em>$1</em></strong>');
  // 粗体
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // 斜体（避免跟上面 __ 冲突）
  s = s.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
  s = s.replace(/(?:^|[^_])_([^\s][^_]*?)_/g, (m, t) => m.replace(/_/, '').replace(/_/, '') + '<em>' + t + '</em>');

  // 删除线
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // 下标 / 上标
  s = s.replace(/~([^~\s][^~]*?)~/g, '<sub>$1</sub>');
  s = s.replace(/\^([^^\s][^^]*?)\^/g, '<sup>$1</sup>');

  // 裸链接自动识别（去掉末尾标点）
  s = s.replace(/(^|[^\w/])(https?:\/\/[^\s<>"\u0000]+)/g, (m, pre, url) => {
    const trailing = /[.,;:!?，。；：！？)）]+$/.exec(url);
    let tail = '';
    if (trailing) {
      tail = trailing[0];
      url = url.slice(0, -tail.length);
    }
    return `${pre}<a href="${url}" target="_blank" rel="noopener">${url}</a>${tail}`;
  });

  // 恢复占位内容
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[Number(i)] ?? '');

  return s;
}

/** 段落内多行合并：行尾两个及以上空格视为换行 */
function inlineLines(lines, footnotes) {
  return lines.map((line) => {
    const hardBreak = / {2,}$/.test(line);
    const text = hardBreak ? line.replace(/ +$/, '') : line;
    return inline(text, footnotes) + (hardBreak ? '<br>' : '');
  }).join(' ');
}

/** 列表类型判断 */
function listType(line) {
  if (/^\s*[-*+]\s+/.test(line)) return 'ul';
  if (/^\s*\d+\.\s+/.test(line)) return 'ol';
  return null;
}

/** 列表项信息 */
function listItemInfo(line) {
  const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
  if (!m) return null;
  return {
    indent: m[1].replace(/\t/g, '    ').length,
    ordered: /^\d+\.$/.test(m[2]),
    text: m[3],
  };
}

/** 递归渲染多层列表（支持任务列表） */
function renderList(items, start, indent, footnotes) {
  const ordered = items[start].ordered;
  let body = '';
  let i = start;

  while (i < items.length && items[i].indent >= indent) {
    if (items[i].indent > indent) {
      // 防御：跳级的子列表直接并入当前层级
      const sub = renderList(items, i, items[i].indent, footnotes);
      body += sub.html;
      i = sub.index;
      continue;
    }

    let text = items[i].text;
    i += 1;

    let task = null;
    const tm = /^\[([ xX])\]\s+(.*)$/.exec(text);
    if (tm) {
      task = tm[1].toLowerCase() === 'x';
      text = tm[2];
    }

    let inner = inline(text, footnotes);
    if (task !== null) {
      inner = `<input type="checkbox" disabled${task ? ' checked' : ''}> ${inner}`;
    }

    // 紧跟在后面的更深缩进项作为子列表
    if (i < items.length && items[i].indent > indent) {
      const sub = renderList(items, i, items[i].indent, footnotes);
      inner += sub.html;
      i = sub.index;
    }

    body += `<li${task !== null ? ' class="task-list-item"' : ''}>${inner}</li>`;
  }

  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${body}</${tag}>`, index: i };
}

/** 表格行拆分 */
function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
}

/** 判断某行是否为表格起始行 */
function isTableStart(lines, i) {
  const header = lines[i];
  const sep = lines[i + 1];
  if (header === undefined || sep === undefined) return false;
  if (!header.includes('|')) return false;
  const cells = splitRow(sep);
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c.replace(/\s/g, '')));
}

/** 表格对齐方式 */
function cellAlign(cell) {
  const left = cell.startsWith(':');
  const right = cell.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return '';
}

/**
 * @param {string} md
 * @returns {string} HTML
 */
export function mdToHtml(md) {
  if (!md) return '';

  // 预扫描脚注定义（跳过代码块内部）
  const rawLines = String(md).split('\n');
  const footnotes = new Map();
  const lines = [];
  let inFence = false;
  for (const line of rawLines) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      lines.push(line);
      continue;
    }
    const fm = !inFence && /^\[\^([^\]]+)\]:\s*(.*)$/.exec(line);
    if (fm) {
      footnotes.set(fm[1], fm[2]);
      continue;
    }
    lines.push(line);
  }

  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 代码块 ```lang ... ```
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, '').trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      i++;
      continue;
    }

    // 空行
    if (line.trim() === '') {
      i++;
      continue;
    }

    // 分隔线 --- / ***
    if (/^\s*[-*]{3,}\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // 标题 # / ## / ### / ####
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2], footnotes)}</h${level}>`);
      i++;
      continue;
    }

    // 块级 HTML：details / summary
    if (/^<details>\s*$/i.test(line) || /^<\/details>\s*$/i.test(line)) {
      out.push(line.trim().toLowerCase());
      i++;
      continue;
    }
    const summary = /^<summary>(.*)<\/summary>\s*$/i.exec(line);
    if (summary) {
      out.push(`<summary>${inline(summary[1], footnotes)}</summary>`);
      i++;
      continue;
    }

    // 块级 HTML：居中 / 对齐 div
    const divOpen = /^<div\s+align\s*=\s*["']?(center|left|right)["']?\s*>\s*$/i.exec(line);
    if (divOpen) {
      out.push(`<div align="${divOpen[1].toLowerCase()}">`);
      i++;
      continue;
    }
    if (/^<\/div>\s*$/i.test(line)) {
      out.push('</div>');
      i++;
      continue;
    }

    // 引用（支持多层 > > >）
    if (/^\s*>/.test(line)) {
      const parts = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        const qm = /^\s*((?:>\s*)+)(.*)$/.exec(lines[i]);
        const depth = (qm[1].match(/>/g) || []).length;
        const text = qm[2];
        if (text.trim()) {
          let html = inline(text, footnotes);
          for (let d = 0; d < depth; d++) html = `<blockquote>${html}</blockquote>`;
          parts.push(html);
        }
        i++;
      }
      out.push(parts.join(''));
      continue;
    }

    // 表格
    if (isTableStart(lines, i)) {
      const headers = splitRow(lines[i]);
      const aligns = splitRow(lines[i + 1]).map(cellAlign);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      const th = headers.map((cell, idx) => {
        const align = aligns[idx];
        return `<th${align ? ` style="text-align:${align}"` : ''}>${inline(cell, footnotes)}</th>`;
      }).join('');
      const tbody = rows.map((row) => {
        const tds = headers.map((_, idx) => {
          const align = aligns[idx];
          return `<td${align ? ` style="text-align:${align}"` : ''}>${inline(row[idx] || '', footnotes)}</td>`;
        }).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tbody}</tbody></table>`);
      continue;
    }

    // 列表
    if (listType(line)) {
      const items = [];
      while (i < lines.length && listType(lines[i])) {
        const info = listItemInfo(lines[i]);
        if (!info) break;
        items.push(info);
        i++;
      }
      out.push(renderList(items, 0, items[0].indent, footnotes).html);
      continue;
    }

    // 普通段落（收集连续非空行）
    const pbuf = [line];
    i++;
    while (
      i < lines.length
      && lines[i].trim() !== ''
      && !listType(lines[i])
      && !/^#{1,4}\s+/.test(lines[i])
      && !/^```/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^\s*[-*]{3,}\s*$/.test(lines[i])
      && !isTableStart(lines, i)
      && !/^<(details|summary|\/details|\/summary|div\b|\/div)/i.test(lines[i])
    ) {
      pbuf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inlineLines(pbuf, footnotes)}</p>`);
  }

  // 脚注列表
  if (footnotes.size) {
    const items = [];
    for (const [id, text] of footnotes) {
      items.push(`<li id="fn-${esc(id)}">${inline(text, footnotes)} <a class="footnote-back" href="#fnref-${esc(id)}">↩</a></li>`);
    }
    out.push(`<section class="footnotes"><hr><ol>${items.join('')}</ol></section>`);
  }

  return out.join('\n');
}
