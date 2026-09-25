import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderMarkdown } from "../src/markdown/render.ts";

const fixture = readFileSync(join(import.meta.dirname, "fixtures", "markdown-demo.md"), "utf8");
const { fm, html, headings } = renderMarkdown(fixture);

test("splits YAML front matter from the body", () => {
  assert.match(fm, /^title: Markdown demo/);
  assert.ok(!html.includes("title: Markdown demo"), "front matter leaked into the rendered body");
});

test("collects headings with slugged, deduplicated anchors", () => {
  assert.deepEqual(
    headings.map(h => h.id),
    ["markdown-demo", "text", "lists", "table", "code", "quote", "details", "links-and-images", "unsupported-by-design"],
  );
  assert.ok(html.includes('<h1 id="markdown-demo">'));
  assert.ok(html.includes('<a class="anchor" href="#markdown-demo" aria-label="Permalink">#</a>'));
});

test("renders a table with per-column alignment", () => {
  assert.ok(html.includes('<th style="text-align:left">Left</th>'));
  assert.ok(html.includes('<th style="text-align:center">Center</th>'));
  assert.ok(html.includes('<th style="text-align:right">Right</th>'));
});

test("fenced code carries a language label and a copy button", () => {
  assert.match(html, /<pre><button class="copy">copy<\/button><span class="lang">js<\/span><code>/);
});

test("a diff block highlights added and removed lines", () => {
  assert.ok(html.includes('<span class="diff-d">- removed line</span>'));
  assert.ok(html.includes('<span class="diff-a">+ added line</span>'));
});

test("task list items render as disabled checkboxes", () => {
  assert.ok(html.includes('<li class="task"><input type="checkbox" disabled>unchecked</li>'));
  assert.ok(html.includes('<li class="task"><input type="checkbox" disabled checked>checked</li>'));
});

test("footnote and LaTeX syntax pass through as literal text", () => {
  assert.ok(html.includes("this is not a footnote reference[^1]"));
  assert.ok(html.includes("[^1]: this definition also renders as literal text."));
  assert.ok(html.includes("LaTeX is not supported: $E = mc^2$ and"));
  assert.ok(html.includes("\\int_0^1 x\\,dx"));
  assert.ok(!html.includes('class="katex"'), "LaTeX should not be rendered as an equation");
});

const traced = renderMarkdown(fixture, undefined, { sourceLines: true });

test("top-level blocks carry 1-based line ranges against the raw file", () => {
  const first = traced.blocks[0];
  assert.deepEqual([first.line, first.endLine, first.text], [6, 6, "# Markdown demo"]);
  const byText = (prefix: string) => traced.blocks.find(b => b.text.startsWith(prefix));
  assert.deepEqual([byText("- tight item one")?.line, byText("- tight item one")?.endLine], [20, 22], "a list is one block");
  assert.deepEqual([byText("- first")?.line, byText("- first")?.endLine], [29, 31], "a loose list keeps its blank line");
  assert.deepEqual([byText("| Left")?.line, byText("| Left")?.endLine], [40, 43], "a table is one block");
  assert.deepEqual([byText("```js")?.line, byText("```js")?.endLine], [47, 52], "a fence includes both delimiters");
  assert.deepEqual([byText("> A blockquote.")?.line, byText("> A blockquote.")?.endLine], [62, 64], "a blockquote is one block");
  assert.ok(!traced.blocks.some(b => b.text.startsWith("</details>")), "a closing tag is not a block");
  assert.ok(traced.html.includes('<h1 data-line="6" data-end="6" id="markdown-demo">'));
  assert.ok(traced.html.includes('<ul data-line="20" data-end="22">'));
});

test("source line attributes are opt-in and change nothing else", () => {
  assert.ok(!html.includes("data-line"));
  assert.equal(traced.html.replace(/ data-line="\d+" data-end="\d+"/g, ""), html);
  assert.deepEqual(renderMarkdown(fixture).blocks, traced.blocks);
});

test("a document without front matter starts at line 1", () => {
  const { blocks } = renderMarkdown("Para one.\n\n\nPara two\ncontinues.\n");
  assert.deepEqual(blocks, [
    { line: 1, endLine: 1, text: "Para one." },
    { line: 4, endLine: 5, text: "Para two\ncontinues." },
  ]);
});
