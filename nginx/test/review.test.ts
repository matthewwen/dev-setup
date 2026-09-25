import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../src/markdown/render.ts";
import { blockAt, excerpt, groupComments, lineLabel, markedBlocks, relativeTime, selectionTarget } from "../src/review/model.ts";
import type { ReviewComment } from "../src/shared/review-api.ts";

const { blocks } = renderMarkdown("# Title\n\nFirst paragraph\nsecond line.\n\n- one\n- two\n");

function comment(id: string, over: Partial<ReviewComment> = {}): ReviewComment {
  return {
    id,
    status: "open",
    action: null,
    author: "matt",
    ts: "2026-09-24T20:00:00Z",
    body: "note",
    anchor: { line: 3, endLine: 4 },
    resolved: { confidence: "exact", line: 3, endLine: 4, text: "First paragraph\nsecond line." },
    replies: [],
    ...over,
  };
}

test("blockAt finds the block that contains a line and skips blank lines", () => {
  assert.equal(blockAt(blocks, 4)?.line, 3);
  assert.equal(blockAt(blocks, 7)?.line, 6);
  assert.equal(blockAt(blocks, 2), undefined);
});

test("a selection inside one block targets that block", () => {
  const t = selectionTarget(blocks, 3, 3, "  second line ");
  assert.ok(t.ok);
  if (t.ok) {
    assert.deepEqual([t.block.line, t.block.endLine, t.selection], [3, 4, "second line"]);
  }
});

test("a selection across two blocks or outside the body is refused", () => {
  assert.deepEqual(selectionTarget(blocks, 1, 3, "Title First"), { ok: false, reason: "select text inside one block" });
  assert.deepEqual(selectionTarget(blocks, null, 3, "x"), { ok: false, reason: "select text inside the document body" });
  assert.deepEqual(selectionTarget(blocks, 3, 3, "   "), { ok: false, reason: "empty selection" });
});

test("comments group into document, inline, orphaned, and resolved", () => {
  const groups = groupComments([
    comment("aaaaaa"),
    comment("bbbbbb", { resolved: { confidence: "document" }, anchor: { line: null } }),
    comment("cccccc", { resolved: { confidence: "orphan" } }),
    comment("dddddd", { resolved: { confidence: "moved", line: 6, endLine: 7 } }),
    comment("eeeeee", { status: "resolved", action: "fixed", resolved: { confidence: "orphan" } }),
  ]);
  assert.deepEqual(
    Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((c: ReviewComment) => c.id)])),
    { document: ["bbbbbb"], inline: ["aaaaaa", "dddddd"], orphan: ["cccccc"], resolved: ["eeeeee"] },
  );
});

test("only open, located comments mark a block", () => {
  const marks = markedBlocks(
    [
      comment("aaaaaa"),
      comment("bbbbbb", { resolved: { confidence: "quote", line: 4, endLine: 4 } }),
      comment("cccccc", { status: "resolved", action: "answered" }),
      comment("dddddd", { resolved: { confidence: "orphan" } }),
    ],
    blocks,
  );
  assert.deepEqual([...marks], [[3, ["aaaaaa", "bbbbbb"]]]);
});

test("labels and times read the way the panel shows them", () => {
  assert.equal(lineLabel(comment("aaaaaa")), "L3-4");
  assert.equal(lineLabel(comment("aaaaaa", { resolved: { confidence: "exact", line: 1, endLine: 1 } })), "L1");
  assert.equal(lineLabel(comment("aaaaaa", { resolved: { confidence: "orphan" } })), "");
  const now = Date.parse("2026-09-24T20:00:00Z");
  assert.equal(relativeTime("2026-09-24T19:59:30Z", now), "just now");
  assert.equal(relativeTime("2026-09-24T19:15:00Z", now), "45m ago");
  assert.equal(relativeTime("2026-09-24T15:00:00Z", now), "5h ago");
  assert.equal(relativeTime("2026-09-21T20:00:00Z", now), "3d ago");
  assert.equal(relativeTime("2026-08-01T00:00:00Z", now), "2026-08-01");
  assert.equal(excerpt("a\n  b   c"), "a b c");
  assert.equal(excerpt("x".repeat(10), 5), "xxxx…");
});
