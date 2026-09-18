/**
 * 极简 Markdown → HTML 渲染器
 * 只处理 GitHub Release Notes 常见格式，够用且无依赖。
 *
 * 支持：
 *   # / ## / ### 标题
 *   - / * / + 无序列表
 *   1. 2. 有序列表
 *   **粗体**、*斜体*、`行内代码`
 *   [文本](链接)
 *   ```语言 代码块 ```
 *   > 引用
 *   --- / *** 分隔线
 *   空行 → <p>
 */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ESC_MAP[c] || c);
}

/** 行内解析（粗体/斜体/代码/链接） */
function inline(text) {
  // 先 esc 再替换占位
  let s = esc(text);

  // 行内代码 `code`
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // 粗体 **x** 或 __x__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // 斜体 *x* 或 _x_（避免跟上面 __ 冲突）
  s = s.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
  s = s.replace(/(?:^|[^_])_([^\s][^_]*?)_/g, (m, t) => m.replace(/_/, '').replace(/_/, '') + '<em>' + t + '</em>');
  // 链接 [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  return s;
}

/** 列表类型判断 */
function listType(line) {
  if (/^\s*[-*+]\s+/.test(line)) return 'ul';
  if (/^\s*\d+\.\s+/.test(line)) return 'ol';
  return null;
}

function listItemText(line) {
  return line.replace(/^\s*([-*+]|\d+\.)\s+/, '');
}

/**
 * @param {string} md
 * @returns {string} HTML
 */
export function mdToHtml(md) {
  if (!md) return '';
  const lines = md.split('\n');
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
      out.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
      i++;
      continue;
    }

    // 空行（段落分隔）
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

    // 标题 # / ## / ###
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // 引用 >
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // 列表
    const lt = listType(line);
    if (lt) {
      const buf = [];
      while (i < lines.length && listType(lines[i])) {
        buf.push(listItemText(lines[i]));
        i++;
      }
      out.push(`<${lt}>${buf.map((t) => `<li>${inline(t)}</li>`).join('')}</${lt}>`);
      continue;
    }

    // 普通段落（收集连续非空行）
    const pbuf = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== '' && !listType(lines[i]) && !/^#{1,4}\s+/.test(lines[i]) && !/^```/.test(lines[i]) && !/^\s*>\s?/.test(lines[i]) && !/^\s*[-*]{3,}\s*$/.test(lines[i])) {
      pbuf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(pbuf.join(' '))}</p>`);
  }

  return out.join('\n');
}
