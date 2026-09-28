import { test } from "node:test";
import assert from "node:assert/strict";
import { backspaceEdit, enterEdit, indentEdit, type Edit } from "../src/prompts/listKeys.ts";

function run(value: string, edit: Edit | null): string | null {
  return edit && value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

test("enter carries a number past nine and keeps the indent", () => {
  const v = "  9) foo";
  const edit = enterEdit(v, v.length, v.length);
  assert.equal(run(v, edit), "  9) foo\n  10) ");
  assert.deepEqual(edit?.caret, [15, 15]);
});

test("enter on an empty item clears the marker", () => {
  const v = "1. foo\n2. ";
  assert.equal(run(v, enterEdit(v, v.length, v.length)), "1. foo\n");
});

test("enter after z does not continue", () => {
  assert.equal(enterEdit("z. foo", 6, 6), null);
});

test("enter ignores an abbreviation like e.g.", () => {
  assert.equal(enterEdit("e.g. foo", 8, 8), null);
});

test("enter ignores an open paren without a closing delimiter", () => {
  assert.equal(enterEdit("(1. foo", 7, 7), null);
});

test("enter inside the marker does nothing", () => {
  assert.equal(enterEdit("12. foo", 1, 1), null);
});

test("tab inserts two spaces on a plain line", () => {
  assert.equal(run("foo", indentEdit("foo", 1, 1, false)), "f  oo");
});

function atEnd(v: string, f: (v: string, s: number, e: number) => Edit | null): string | null {
  return run(v, f(v, v.length, v.length));
}

test("tab nests a numbered item as the first letter", () => {
  const edit = indentEdit("3. foo\n4. bar", 11, 11, false);
  assert.equal(run("3. foo\n4. bar", edit), "3. foo\n  a. bar");
  assert.deepEqual(edit?.caret, [13, 13]);
});

test("tab continues a sibling at the new depth", () => {
  assert.equal(atEnd("1. x\n  a. y\n2. ", (v, s, e) => indentEdit(v, s, e, false)), "1. x\n  a. y\n  b. ");
});

test("tab under a letter nests as roman", () => {
  assert.equal(atEnd("  a. x\n  b. ", (v, s, e) => indentEdit(v, s, e, false)), "  a. x\n    i. ");
});

test("shift-tab resumes the parent numbering past its sublist", () => {
  assert.equal(atEnd("3. foo\n  a. bar\n  b. ", (v, s, e) => indentEdit(v, s, e, true)), "3. foo\n  a. bar\n4. ");
});

test("shift-tab on a top-level item does nothing", () => {
  assert.equal(indentEdit("1. x", 4, 4, true), null);
});

test("enter continues roman numerals", () => {
  assert.equal(atEnd("    iv. x", enterEdit), "    iv. x\n    v. ");
});

test("enter treats i at the letter depth as a letter", () => {
  assert.equal(atEnd("  i. x", enterEdit), "  i. x\n  j. ");
});

test("enter ignores a word made of roman letters", () => {
  assert.equal(enterEdit("did. foo", 8, 8), null);
});

test("backspace after a marker removes it and its indent", () => {
  assert.equal(atEnd("x\n  3. ", backspaceEdit), "x\n");
});

test("backspace inside item text is left to the browser", () => {
  assert.equal(backspaceEdit("3. foo", 6, 6), null);
});

test("tab and shift-tab shift every selected line", () => {
  const v = "a\n\nb\nc";
  const edit = indentEdit(v, 0, 4, false);
  assert.equal(run(v, edit), "  a\n\n  b\nc");
  assert.deepEqual(edit?.caret, [2, 8]);
  assert.equal(run("  a\n b", indentEdit("  a\n b", 0, 6, true)), "a\nb");
  assert.equal(indentEdit("a", 0, 0, true), null);
});
