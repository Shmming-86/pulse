/**
 * 极简 Markdown 渲染器（零依赖）。
 *
 * 安全原则：先转义 HTML，再套用格式。渲染结果里不会出现原始 HTML 标签，
 * 链接只允许 http/https/mailto，且强制 rel="noopener noreferrer"。
 *
 * 支持：标题、粗体/斜体/删除线、行内代码、围栏代码块、有序/无序列表、
 * 任务清单（- [ ] / - [x]）、引用、分割线、链接、表格、硬换行。
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char]);
}

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function renderLink(label, url) {
  // 入参已经过 escapeHtml，直接复用，避免二次转义（URL 里的 & 会变成 &amp;amp;）
  const target = url.trim();
  if (!SAFE_URL.test(target)) return label;
  return `<a href="${target}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/** 行内语法：代码、粗体、删除线、斜体、链接 */
function inline(raw) {
  // 先抽出行内代码，避免其中的 * _ 被当成格式符号
  const codes = [];
  let text = String(raw).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  text = escapeHtml(text);

  // 链接：[文字](地址)（地址不安全的降级为纯文字）
  text = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_, label, url) => renderLink(label, url));
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');

  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => codes[Number(index)]);
}

const LIST_UL = /^\s*[-*+]\s+(.*)$/;
const LIST_OL = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;


function tableCells(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

/** 表格分隔行：每个单元格都是 --- / :--- / ---: 形式 */
function isTableSeparator(line) {
  if (!line || !line.includes('-')) return false;
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderBlocks(lines) {
  const html = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    html.push(`<p>${paragraph.map((line) => inline(line)).join('<br>')}</p>`);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // 围栏代码块
    if (/^\s*```/.test(line)) {
      flushParagraph();
      const lang = line.trim().replace(/^```/, '').trim();
      const buffer = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        buffer.push(lines[i]);
        i += 1;
      }
      html.push(
        `<pre class="md-pre"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(
          buffer.join('\n'),
        )}</code></pre>`,
      );
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    if (HR.test(line)) {
      flushParagraph();
      html.push('<hr>');
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      html.push(`<h${level + 2}>${inline(heading[2])}</h${level + 2}>`);
      continue;
    }

    // 引用块
    if (/^\s*>\s?/.test(line)) {
      flushParagraph();
      const buffer = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buffer.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      i -= 1;
      html.push(`<blockquote>${buffer.map((item) => inline(item)).join('<br>')}</blockquote>`);
      continue;
    }

    // 表格：当前行含 |，下一行是分隔行
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushParagraph();
      const head = tableCells(line);
      i += 1;
      const body = [];
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim()) {
        i += 1;
        body.push(tableCells(lines[i]));
      }
      html.push(
        `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head
          .map((cell) => `<th>${inline(cell)}</th>`)
          .join('')}</tr></thead><tbody>${body
          .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }

    // 列表（允许任务清单）
    if (LIST_UL.test(line) || LIST_OL.test(line)) {
      flushParagraph();
      const ordered = LIST_OL.test(line);
      const items = [];
      while (i < lines.length && (ordered ? LIST_OL.test(lines[i]) : LIST_UL.test(lines[i]))) {
        const content = lines[i].match(ordered ? LIST_OL : LIST_UL)[1];
        const task = content.match(/^\[( |x|X)\]\s+(.*)$/);
        if (task) {
          const checked = task[1].toLowerCase() === 'x';
          items.push(
            `<li class="md-task"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${inline(
              task[2],
            )}</li>`,
          );
        } else {
          items.push(`<li>${inline(content)}</li>`);
        }
        i += 1;
      }
      i -= 1;
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  return html.join('');
}

export function renderMarkdown(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return '';
  return renderBlocks(text.split('\n'));
}

/** 是否包含 Markdown 语法（用于提示“渲染中”之类的场景） */
export function looksLikeMarkdown(source) {
  return /(^|\n)\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```)|\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)/.test(
    String(source ?? ''),
  );
}
