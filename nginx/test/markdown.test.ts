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
