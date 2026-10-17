import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleTaskLine } from "../src/edit/tasks.ts";

test("an upper-case X unchecks to a space", () => {
  assert.equal(toggleTaskLine("- [X] done"), "- [ ] done");
});

test("a line without a task marker returns null", () => {
  assert.equal(toggleTaskLine("- plain item"), null);
  assert.equal(toggleTaskLine("[ ]suffix"), null);
});

test("an ordered item with a paren marker toggles", () => {
  assert.equal(toggleTaskLine("1) [ ] x"), "1) [x] x");
});

test("only the first marker toggles when the body holds another", () => {
  assert.equal(toggleTaskLine("  * [ ] see [ ] later"), "  * [x] see [ ] later");
});

test("standalone and empty checkboxes toggle without changing surrounding text", () => {
  assert.equal(toggleTaskLine("[ ] no list marker"), "[x] no list marker");
  assert.equal(toggleTaskLine("  [X]"), "  [ ]");
  assert.equal(toggleTaskLine("- [ ]"), "- [x]");
});

test("a table toggle changes only the selected checkbox cell", () => {
  const row = "  | [ ] | [X] | `[ ]` | Perk |";
  assert.equal(toggleTaskLine(row, 1), "  | [ ] | [ ] | `[ ]` | Perk |");
  assert.equal(toggleTaskLine(row, 0), "  | [x] | [X] | `[ ]` | Perk |");
  assert.equal(toggleTaskLine(row, 2), null);
  assert.equal(toggleTaskLine(row, 4), null);
  assert.equal(toggleTaskLine(row, -1), null);
});

test("a table without outer pipes preserves its cell spacing when toggled", () => {
  assert.equal(toggleTaskLine("Perk |  [ ]  | details", 1), "Perk |  [x]  | details");
});
