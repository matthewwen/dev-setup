// Markdown renderer shared by md-viewer.html and ipynb-viewer.html.
// nginx serves it at /__md/render.js (see conf/md.conf). Pure functions and
// two module-level collections, `headings` and `slugs`, which a page reads
// after calling renderMarkdown(). No DOM access and no third-party code.
"use strict";
/* ============================ markdown renderer ============================ */

const NUL = "\u0000";
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Inline HTML kept as markup after escaping. Attributes are dropped.
const SAFE_TAGS = "br|hr|details|summary|kbd|sub|sup|b|i|u|em|strong|del|s|small|abbr|dl|dt|dd";
const unescapeSafeTags = s => s
  .replace(new RegExp("&lt;(\\/?(?:" + SAFE_TAGS + "))\\s*\\/?&gt;", "gi"), (_, t) => "<" + t.toLowerCase() + ">");

const KEYWORDS = new RegExp("\\b(?:" + [
  "const", "let", "var", "function", "return", "class", "extends", "new", "this", "typeof", "instanceof",
  "import", "from", "export", "default", "async", "await", "yield", "throw",
  "if", "else", "elif", "for", "while", "do", "switch", "case", "break", "continue", "try", "except",
  "catch", "finally", "with", "as", "in", "is", "not", "and", "or", "def", "lambda", "pass", "raise",
  "self", "None", "True", "False", "null", "nil", "true", "false", "void", "public", "private", "static",
  "struct", "enum", "interface", "type", "impl", "fn", "pub", "mut", "match", "use", "package", "func",
  "then", "fi", "esac", "done", "local", "echo", "set", "unset", "sudo", "cd", "kubectl", "helm", "git"
].join("|") + ")\\b");

const NO_HASH_COMMENT = new Set(["css", "scss", "less", "json", "json5", "html", "xml", "c", "cpp", "h"]);

function highlight(code, lang) {
  lang = (lang || "").toLowerCase();
  if (lang === "diff" || lang === "patch") {
    return code.split("\n").map(l => {
      const cls = /^\+/.test(l) ? "diff-a" : /^-/.test(l) ? "diff-d" : /^@@/.test(l) ? "tok-com" : "";
      return cls ? '<span class="' + cls + '">' + esc(l) + "</span>" : esc(l);
    }).join("\n");
  }
  const parts = ['("(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)'];
  parts.push(NO_HASH_COMMENT.has(lang) ? "(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)" : "(#[^\\n]*|\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)");
  parts.push("(\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[-+]?\\d+)?\\b|\\b0x[0-9a-f]+\\b)");
  parts.push("(" + KEYWORDS.source + ")");
  const re = new RegExp(parts.join("|"), "gi");
  let out = "", last = 0, m;
  while ((m = re.exec(code)) !== null) {
    out += esc(code.slice(last, m.index));
    const cls = m[1] ? "tok-str" : m[2] ? "tok-com" : m[3] ? "tok-num" : "tok-kw";
    out += '<span class="' + cls + '">' + esc(m[0]) + "</span>";
    last = m.index + m[0].length;
  }
  return out + esc(code.slice(last));
}

const slugs = new Map();
function slug(text) {
  let s = text.toLowerCase().replace(/<[^>]*>/g, "").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
  if (!s) s = "section";
  const n = slugs.get(s) || 0;
  slugs.set(s, n + 1);
  return n ? s + "-" + n : s;
}

const headings = [];

function inline(text) {
  const spans = [];
  // Code spans are captured before escaping so their content stays literal.
  text = text.replace(/(`+)([\s\S]*?)\1/g, (_, __, code) => {
    spans.push(code.replace(/^ | $/g, ""));
    return NUL + (spans.length - 1) + NUL;
  });
  text = unescapeSafeTags(esc(text));
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src, title) => '<img src="' + src + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : "") + ">");
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, label, href, title) => '<a href="' + href + '"' + (title ? ' title="' + title + '"' : "") + ">" + label + "</a>");
  text = text.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, '<a href="$1">$1</a>');
  text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>()"']+)/g, '$1<a href="$2">$2</a>');
  text = text.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^\n_]+?)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^\w*])\*([^\s*][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
  text = text.replace(/(^|[\s(])_([^\s_][^_\n]*?)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");
  text = text.replace(/~~([^\n]+?)~~/g, "<del>$1</del>");
  return text.replace(new RegExp(NUL + "(\\d+)" + NUL, "g"), (_, i) => "<code>" + esc(spans[+i]) + "</code>");
}

const RE_FENCE = /^(\s*)(`{3,}|~{3,})\s*([\w+#.-]*)/;
const RE_HEAD = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_HR = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const RE_ITEM = /^(\s*)([-+*]|\d{1,9}[.)])(\s+)(.*)$/;
const RE_TROW = /^\s*\|?(?:[^|\n]*\|)+[^|\n]*\|?\s*$/;
const RE_TSEP = /^\s*\|?(?:\s*:?-{1,}:?\s*\|)+\s*:?-{0,}:?\s*\|?\s*$/;

function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    let m = line.match(RE_FENCE);
    if (m) {
      const close = new RegExp("^\\s*" + m[2][0] + "{" + m[2].length + ",}\\s*$");
      const strip = m[1].length, lang = m[3];
      const buf = [];
      i++;
      while (i < lines.length && !close.test(lines[i])) buf.push(lines[i++].slice(strip));
      i++;
      out.push('<pre><button class="copy">copy</button>' + (lang ? '<span class="lang">' + esc(lang) + "</span>" : "") +
        "<code>" + highlight(buf.join("\n"), lang) + "</code></pre>");
      continue;
    }

    if ((m = line.match(RE_HEAD))) {
      const lvl = m[1].length, html = inline(m[2]), id = slug(m[2]);
      headings.push({ lvl, id, text: m[2].replace(/[`*_[\]()]/g, "") });
      out.push("<h" + lvl + ' id="' + id + '">' + html +
        '<a class="anchor" href="#' + id + '" aria-label="Permalink">#</a></h' + lvl + ">");
      i++;
      continue;
    }

    if (RE_HR.test(line)) { out.push("<hr>"); i++; continue; }

    // Collapsible sections written as raw HTML stay structural instead of literal.
    if (/^\s*<details\b/i.test(line)) { out.push(/\bopen\b/i.test(line) ? "<details open>" : "<details>"); i++; continue; }
    if (/^\s*<\/details>/i.test(line)) { out.push("</details>"); i++; continue; }
    if ((m = line.match(/^\s*<summary\b[^>]*>([\s\S]*?)<\/summary>\s*$/i))) {
      out.push("<summary>" + inline(m[1]) + "</summary>");
      i++;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const buf = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (buf.length && lines[i].trim()))) {
        buf.push(lines[i++].replace(/^ {0,3}>\s?/, ""));
      }
      out.push("<blockquote>" + blocks(buf) + "</blockquote>");
      continue;
    }

    if (RE_ITEM.test(line)) {
      const [html, next] = list(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    if (line.includes("|") && RE_TROW.test(line) && i + 1 < lines.length && RE_TSEP.test(lines[i + 1])) {
      const [html, next] = table(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    const buf = [];
    while (i < lines.length && lines[i].trim() && !RE_HEAD.test(lines[i]) && !RE_HR.test(lines[i]) &&
           !RE_FENCE.test(lines[i]) && !/^ {0,3}>/.test(lines[i]) && !RE_ITEM.test(lines[i])) {
      buf.push(lines[i++]);
    }
    out.push("<p>" + inline(buf.join("\n").replace(/  $/gm, "<br>")) + "</p>");
  }
  return out.join("\n");
}

function list(lines, start) {
  const first = lines[start].match(RE_ITEM);
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const startNo = ordered ? parseInt(first[2], 10) : 1;
  const items = [];
  let i = start, loose = false;

  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(RE_ITEM);
    if (m && m[1].length <= baseIndent + 1) {
      if (m[1].length < baseIndent) break;
      if (ordered !== /\d/.test(m[2])) break;
      items.push({ content: [m[4]], pad: m[1].length + m[2].length + m[3].length });
      i++;
      continue;
    }
    if (!line.trim()) {
      // A blank line continues the list only when the next line belongs to it.
      const nxt = lines[i + 1];
      const nm = nxt && nxt.trim() ? nxt.match(RE_ITEM) : null;
      const sameList = nm && nm[1].length >= baseIndent && /\d/.test(nm[2]) === ordered;
      const indented = nxt && nxt.trim() && nxt.search(/\S/) > baseIndent;
      if (sameList || indented) {
        loose = true;
        if (items.length) items[items.length - 1].content.push("");
        i++;
        continue;
      }
      break;
    }
    if (!items.length) break;
    const cur = items[items.length - 1];
    if (line.search(/\S/) > baseIndent) { cur.content.push(line.slice(Math.min(cur.pad, line.search(/\S/)))); i++; continue; }
    break;
  }

  const body = items.map(it => {
    let inner = blocks(it.content);
    let cls = "";
    const task = it.content[0].match(/^\[([ xX])\]\s+/);
    if (task) {
      cls = ' class="task"';
      inner = inner.replace(/^<p>\[[ xX]\]\s*/, "<p>");
      inner = inner.replace("<p>", '<p><input type="checkbox" disabled' + (task[1] === " " ? "" : " checked") + ">");
    }
    if (!loose) inner = inner.replace(/^<p>([\s\S]*?)<\/p>$/, "$1").replace(/^<p>([\s\S]*?)<\/p>\n/, "$1\n");
    return "<li" + cls + ">" + inner + "</li>";
  }).join("\n");

  const tag = ordered ? "ol" : "ul";
  const attr = ordered && startNo !== 1 ? ' start="' + startNo + '"' : "";
  return ["<" + tag + attr + ">\n" + body + "\n</" + tag + ">", i];
}

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
}

function table(lines, start) {
  const head = cells(lines[start]);
  const align = cells(lines[start + 1]).map(s =>
    /^:-+:$/.test(s) ? "center" : /-+:$/.test(s) ? "right" : /^:-+/.test(s) ? "left" : "");
  let i = start + 2;
  const rows = [];
  while (i < lines.length && lines[i].trim() && lines[i].includes("|")) rows.push(cells(lines[i++]));
  const sty = j => align[j] ? ' style="text-align:' + align[j] + '"' : "";
  const thead = "<tr>" + head.map((c, j) => "<th" + sty(j) + ">" + inline(c) + "</th>").join("") + "</tr>";
  const tbody = rows.map(r => "<tr>" + head.map((_, j) => "<td" + sty(j) + ">" + inline(r[j] || "") + "</td>").join("") + "</tr>").join("\n");
  return ["<table><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>", i];
}

function renderMarkdown(src) {
  src = src.replace(/\r\n?/g, "\n").replace(/\t/g, "    ");
  let fm = "";
  const m = src.match(/^---\n([\s\S]*?)\n(?:---|\.\.\.)\s*\n/);
  if (m) { fm = m[1]; src = src.slice(m[0].length); }
  return { fm, html: blocks(src.split("\n")) };
}
