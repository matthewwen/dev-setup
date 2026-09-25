// Ported from html/md-render.js, with types added and its two module-level
// collections (`headings`, `slugs`) turned into per-call state: the SPA calls
// renderMarkdown() again on every navigation, and a module-level Map would
// leak slugs and headings from the previous document into the next.
import { esc } from "../shared/format.ts";
import { highlight } from "./highlight.ts";

const NUL = "\u0000";

// Inline HTML kept as markup after escaping. Attributes are dropped.
const SAFE_TAGS = "br|hr|details|summary|kbd|sub|sup|b|i|u|em|strong|del|s|small|abbr|dl|dt|dd";
const unescapeSafeTags = (s: string): string =>
  s.replace(new RegExp(`&lt;(\\/?(?:${SAFE_TAGS}))\\s*\\/?&gt;`, "gi"), (_, t) => `<${t.toLowerCase()}>`);

function inline(text: string): string {
  const spans: string[] = [];
  // Code spans are captured before escaping so their content stays literal.
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, __, code) => {
    spans.push(code.replace(/^ | $/g, ""));
    return NUL + (spans.length - 1) + NUL;
  });
  text = unescapeSafeTags(esc(text));
  text = text.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src, title) => `<img src="${src}" alt="${alt}"${title ? ` title="${title}"` : ""}>`,
  );
  text = text.replace(
    /\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, label, href, title) => `<a href="${href}"${title ? ` title="${title}"` : ""}>${label}</a>`,
  );
  text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>()"']+)/g, '$1<a href="$2">$2</a>');
  text = text.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^\n_]+?)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^\w*])\*([^\s*][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^\s_][^_\n]*?)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  text = text.replace(/~~([^\n]+?)~~/g, "<del>$1</del>");
  return text.replace(new RegExp(NUL + "(\\d+)" + NUL, "g"), (_, i) => `<code>${esc(spans[+i])}</code>`);
}

const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/;
const RE_HEAD = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_ITEM = /^(\s*)([-+*]|\d{1,9}[.)])(\s+)(.*)$/;
const RE_TROW = /^\s*\|?(?:[^|\n]*\|)+[^|\n]*\|?\s*$/;
const RE_TSEP = /^\s*\|?(?:\s*:?-{1,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}

function table(lines: string[], start: number): [string, number] {
  const head = cells(lines[start]);
  const align = cells(lines[start + 1]).map(s => (/^:-+:$/.test(s) ? "center" : /-+:$/.test(s) ? "right" : /^:-+/.test(s) ? "left" : ""));
  let i = start + 2;
  const rows: string[][] = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
    rows.push(cells(lines[i++]));
  }
  const sty = (j: number) => (align[j] ? ` style="text-align:${align[j]}"` : "");
  const thead = `<tr>${head.map((c, j) => `<th${sty(j)}>${inline(c)}</th>`).join("")}</tr>`;
  const tbody = rows.map(r => `<tr>${head.map((_, j) => `<td${sty(j)}>${inline(r[j] || "")}</td>`).join("")}</tr>`).join("\n");
  return [`<table><thead>${thead}</thead><tbody>${tbody}</tbody></table>`, i];
}

export interface Heading {
  lvl: number;
  id: string;
  text: string;
}

// A top-level block's source range, 1-based against the raw file, front
// matter included. `text` is the block's own lines, joined.
export interface Block {
  line: number;
  endLine: number;
  text: string;
}

export interface RenderResult {
  fm: string;
  html: string;
  headings: Heading[];
  blocks: Block[];
}

export interface RenderOptions {
  // Add data-line and data-end to the opening tag of every top-level block.
  sourceLines?: boolean;
}

// `sharedSlugs` lets a notebook dedupe anchor ids across every markdown
// cell's own renderMarkdown() call, the way the original module-level `slugs`
// map did across a whole page - a standalone document just gets a fresh map.
export function renderMarkdown(src: string, sharedSlugs?: Map<string, number>, opts: RenderOptions = {}): RenderResult {
  const headings: Heading[] = [];
  const slugs = sharedSlugs ?? new Map<string, number>();

  function slug(text: string): string {
    let s = text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
    if (!s) {
      s = "section";
    }
    const n = slugs.get(s) || 0;
    slugs.set(s, n + 1);
    return n ? `${s}-${n}` : s;
  }

  function list(lines: string[], start: number): [string, number] {
    const first = lines[start].match(RE_ITEM)!;
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const startNo = ordered ? parseInt(first[2], 10) : 1;
    const items: { content: string[]; pad: number }[] = [];
    let i = start;
    let loose = false;

    while (i < lines.length) {
      const line = lines[i];
      const m = line.match(RE_ITEM);
      if (m && m[1].length <= baseIndent + 1) {
        if (m[1].length < baseIndent) {
          break;
        }
        if (ordered !== /\d/.test(m[2])) {
          break;
        }
        items.push({ content: [m[4]], pad: m[1].length + m[2].length + m[3].length });
        i++;
        continue;
      }
      if (!line.trim()) {
        // A blank line continues the list only when the next line belongs to it.
        const nxt = lines[i + 1];
        const nm = nxt && nxt.trim() ? nxt.match(RE_ITEM) : null;
        const sameList = Boolean(nm && nm[1].length >= baseIndent && /\d/.test(nm[2]) === ordered);
        const indented = Boolean(nxt && nxt.trim() && nxt.search(/\S/) > baseIndent);
        if (sameList || indented) {
          loose = true;
          if (items.length) {
            items[items.length - 1].content.push("");
          }
          i++;
          continue;
        }
        break;
      }
      if (!items.length) {
        break;
      }
      const cur = items[items.length - 1];
      if (line.search(/\S/) > baseIndent) {
        cur.content.push(line.slice(Math.min(cur.pad, line.search(/\S/))));
        i++;
        continue;
      }
      break;
    }

    const body = items
      .map(it => {
        let inner = blocks(it.content);
        let cls = "";
        const task = it.content[0].match(/^\[([ xX])\]\s+/);
        if (task) {
          cls = ' class="task"';
          inner = inner.replace(/^<p>\[[ xX]\]\s*/, "<p>");
          inner = inner.replace("<p>", `<p><input type="checkbox" disabled${task[1] === " " ? "" : " checked"}>`);
        }
        if (!loose) {
          inner = inner.replace(/^<p>([\s\S]*?)<\/p>$/, "$1").replace(/^<p>([\s\S]*?)<\/p>\n/, "$1\n");
        }
        return `<li${cls}>${inner}</li>`;
      })
      .join("\n");

    const tag = ordered ? "ol" : "ul";
    const attr = ordered && startNo !== 1 ? ` start="${startNo}"` : "";
    return [`<${tag}${attr}>\n${body}\n</${tag}>`, i];
  }

  // One top-level block per call: the branch that matches consumes its lines,
  // pushes exactly one HTML string, and returns the index of the next line.
  function step(lines: string[], i: number, out: string[]): number {
    const line = lines[i];
    let m = line.match(RE_FENCE);
    if (m) {
      const close = new RegExp(`^\\s*${m[2][0]}{${m[2].length},}\\s*$`);
      const strip = m[1].length;
      const lang = m[3];
      const buf: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) {
        buf.push(lines[i++].slice(strip));
      }
      i++;
      out.push(
        `<pre><button class="copy">copy</button>${lang ? `<span class="lang">${esc(lang)}</span>` : ""}` +
          `<code>${highlight(buf.join("\n"), lang)}</code></pre>`,
      );
      return i;
    }

    if ((m = line.match(RE_HEAD))) {
      const lvl = m[1].length;
      const html = inline(m[2]);
      const id = slug(m[2]);
      headings.push({ lvl, id, text: m[2].replace(/[`*_[\]()]/g, "") });
      out.push(`<h${lvl} id="${id}">${html}<a class="anchor" href="#${id}" aria-label="Permalink">#</a></h${lvl}>`);
      i++;
      return i;
    }

    if (RE_HR.test(line)) {
      out.push("<hr>");
      i++;
      return i;
    }

    // Collapsible sections written as raw HTML stay structural instead of literal.
    if (/^\s*<details\b/i.test(line)) {
      out.push(/\bopen\b/i.test(line) ? "<details open>" : "<details>");
      i++;
      return i;
    }
    if (/^\s*<\/details>/i.test(line)) {
      out.push("</details>");
      i++;
      return i;
    }
    if ((m = line.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>\s*$/i))) {
      out.push(`<summary>${inline(m[1])}</summary>`);
      i++;
      return i;
    }

    if (/^ {0,3}>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (buf.length && lines[i].trim()))) {
        buf.push(lines[i++].replace(/^ {0,3}>\s?/, ""));
      }
      out.push(`<blockquote>${blocks(buf)}</blockquote>`);
      return i;
    }

    if (RE_ITEM.test(line)) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      return i;
    }

    if (line.includes("|") && RE_TROW.test(line) && i + 1 < lines.length && RE_TSEP.test(lines[i + 1])) {
      const [html, next] = table(lines, i);
      out.push(html);
      i = next;
      return i;
    }

    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !RE_HEAD.test(lines[i]) &&
      !RE_HR.test(lines[i]) &&
      !RE_FENCE.test(lines[i]) &&
      !/^ {0,3}>/.test(lines[i]) &&
      !RE_ITEM.test(lines[i])
    ) {
      buf.push(lines[i++]);
    }
    out.push(`<p>${inline(buf.join("\n").replace(/ {2}$/gm, "<br>"))}</p>`);
    return i;
  }

  // `spans` collects a source line range per top-level block. Nested calls
  // from blockquotes and list items pass none, because their line arrays are
  // rewritten copies. `offset` is the number of raw lines above `lines`.
  function blocks(lines: string[], spans?: Block[], offset = 0): string {
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].trim()) {
        i++;
        continue;
      }
      const start = i;
      i = step(lines, i, out);
      if (!spans) {
        continue;
      }
      const html = out[out.length - 1];
      if (html.startsWith("</")) {
        continue;
      }
      let end = Math.min(i, lines.length) - 1;
      while (end > start && !lines[end].trim()) {
        end--;
      }
      const line = start + offset + 1;
      const endLine = end + offset + 1;
      spans.push({ line, endLine, text: lines.slice(start, end + 1).join("\n") });
      if (opts.sourceLines) {
        out[out.length - 1] = html.replace(/^<([a-z][a-z0-9]*)/, `<$1 data-line="${line}" data-end="${endLine}"`);
      }
    }
    return out.join("\n");
  }

  src = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  let fm = "";
  let fmLines = 0;
  const m = src.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*\n/);
  if (m) {
    fm = m[1];
    fmLines = m[0].split("\n").length - 1;
    src = src.slice(m[0].length);
  }
  const blockSpans: Block[] = [];
  const html = blocks(src.split("\n"), blockSpans, fmLines);
  return { fm, html, headings, blocks: blockSpans };
}
