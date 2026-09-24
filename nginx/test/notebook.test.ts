import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderNotebook } from "../src/notebook/render.ts";

const raw = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "sample.ipynb"), "utf8"));
const model = renderNotebook(raw);

test("reads kernel and nbformat metadata", () => {
  assert.equal(model.kernel, "Python 3");
  assert.equal(model.cellCount, 4);
  assert.equal(model.nbformat, "4.5");
});

test("a code cell keeps its In [n] execution count", () => {
  const code = model.cells[1];
  assert.equal(code.kind, "code");
  if (code.kind === "code") {
    assert.equal(code.executionCount, 1);
  }
});

test("an HTML output is sanitized of a script tag", () => {
  const code = model.cells[1];
  assert.equal(code.kind, "code");
  if (code.kind !== "code") {
    return;
  }
  const html = code.outputs.find(o => o.kind === "html");
  assert.ok(html && html.kind === "html");
  if (html && html.kind === "html") {
    assert.ok(!html.html.includes("<script"), "script tag survived sanitize()");
    assert.ok(html.html.includes("<table>"), "sanitize() dropped safe markup too");
  }
});

test("ANSI escapes are stripped from a traceback", () => {
  const code = model.cells[1];
  assert.equal(code.kind, "code");
  if (code.kind !== "code") {
    return;
  }
  const error = code.outputs.find(o => o.kind === "error");
  assert.ok(error && error.kind === "error");
  if (error && error.kind === "error") {
    assert.ok(!error.text.includes("\u001b"), "ANSI escape survived stripping");
    assert.equal(error.text, "Traceback\nValueError: boom");
  }
});

test("two markdown cells with the same heading get distinct anchors", () => {
  const ids = model.headings.map(h => h.id);
  assert.deepEqual(ids, ["notebook-demo", "overview", "overview-1"]);
});

test("a raw cell keeps its source without a markdown or code render", () => {
  assert.deepEqual(model.cells[3], { kind: "raw", source: "a raw cell\n" });
});
