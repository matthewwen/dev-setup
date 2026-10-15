import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleTaskLine } from "../src/edit/tasks.ts";

test("an upper-case X unchecks to a space", () => {
  assert.equal(toggleTaskLine("- [X] done"), "- [ ] done");
});

test("a line without a task marker returns null", () => {
  assert.equal(toggleTaskLine("- plain item"), null);
  assert.equal(toggleTaskLine("[ ] no list marker"), null);
});

test("an ordered item with a paren marker toggles", () => {
  assert.equal(toggleTaskLine("1) [ ] x"), "1) [x] x");
});

test("only the first marker toggles when the body holds another", () => {
  assert.equal(toggleTaskLine("  * [ ] see [ ] later"), "  * [x] see [ ] later");
});
