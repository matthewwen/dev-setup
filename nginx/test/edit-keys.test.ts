import { test } from "node:test";
import assert from "node:assert/strict";
import { listEdit } from "../src/edit/keys.ts";
import type { Edit } from "../src/prompts/listKeys.ts";

function run(value: string, edit: Edit | null): string | null {
  return edit && value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

test("enter continues a bullet with its indent and marker", () => {
  const v = "  * foo";
  const edit = listEdit("Enter", false, v, v.length, v.length);
  assert.equal(run(v, edit), "  * foo\n  * ");
  assert.deepEqual(edit?.caret, [12, 12]);
});

test("enter continues a task item with an empty box", () => {
  const v = "- [x] done";
  assert.equal(run(v, listEdit("Enter", false, v, v.length, v.length)), "- [x] done\n- [ ] ");
});

test("enter on an empty bullet clears the marker", () => {
  const v = "- foo\n- ";
  assert.equal(run(v, listEdit("Enter", false, v, v.length, v.length)), "- foo\n");
});

test("tab indents a bullet line and shift-tab outdents it", () => {
  const v = "- foo";
  const indented = run(v, listEdit("Tab", false, v, 5, 5));
  assert.equal(indented, "  - foo");
  assert.equal(run(indented!, listEdit("Tab", true, indented!, 7, 7)), "- foo");
  assert.equal(listEdit("Tab", true, v, 5, 5), null);
});

test("backspace right after a bullet marker removes it", () => {
  const v = "- foo\n- ";
  assert.equal(run(v, listEdit("Backspace", false, v, v.length, v.length)), "- foo\n");
  assert.equal(listEdit("Backspace", false, "- foo", 5, 5), null);
});
