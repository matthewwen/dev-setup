import type { KeyboardEvent } from "react";
import { apply, backspaceEdit, enterEdit, indentEdit, softBreakEdit, type Edit } from "../prompts/listKeys.ts";

const BULLET = /^([ \t]*)([-*+])([ \t]+)(\[[ xX]\][ \t]+)?/;
const INDENT = "  ";

function lineStart(value: string, i: number): number {
  return value.lastIndexOf("\n", i - 1) + 1;
}

function lineEnd(value: string, i: number): number {
  const j = value.indexOf("\n", i);
  return j === -1 ? value.length : j;
}

export function bulletEnterEdit(value: string, start: number, end: number): Edit | null {
  const ls = lineStart(value, start);
  const le = lineEnd(value, start);
  const line = value.slice(ls, le);
  const m = BULLET.exec(line);
  if (!m || start - ls < m[0].length) {
    return null;
  }
  if (start === end && line.slice(m[0].length).trim() === "") {
    return { from: ls, to: le, text: "", caret: [ls, ls] };
  }
  const text = `\n${m[1]}${m[2]}${m[3]}${m[4] ? "[ ] " : ""}`;
  const caret = start + text.length;
  return { from: start, to: end, text, caret: [caret, caret] };
}

export function bulletIndentEdit(value: string, start: number, end: number, outdent: boolean): Edit | null {
  const ls = lineStart(value, start);
  const le = lineEnd(value, start);
  if (end > le) {
    return null;
  }
  const line = value.slice(ls, le);
  const m = BULLET.exec(line);
  if (!m) {
    return null;
  }
  if (outdent) {
    const cut = /^ {1,2}/.exec(m[1])?.[0].length ?? 0;
    if (cut === 0) {
      return null;
    }
    return { from: ls, to: ls + cut, text: "", caret: [Math.max(ls, start - cut), Math.max(ls, end - cut)] };
  }
  return { from: ls, to: ls, text: INDENT, caret: [start + INDENT.length, end + INDENT.length] };
}

export function bulletBackspaceEdit(value: string, start: number, end: number): Edit | null {
  if (start !== end) {
    return null;
  }
  const ls = lineStart(value, start);
  const m = BULLET.exec(value.slice(ls, lineEnd(value, start)));
  if (!m || start !== ls + m[0].length) {
    return null;
  }
  return { from: ls, to: start, text: "", caret: [ls, ls] };
}

export function listEdit(key: string, shift: boolean, value: string, start: number, end: number): Edit | null {
  if (key === "Enter") {
    if (shift) {
      return softBreakEdit(value, start, end);
    }
    return bulletEnterEdit(value, start, end) ?? enterEdit(value, start, end);
  }
  if (key === "Tab") {
    return bulletIndentEdit(value, start, end, shift) ?? indentEdit(value, start, end, shift);
  }
  if (key === "Backspace") {
    return bulletBackspaceEdit(value, start, end) ?? backspaceEdit(value, start, end);
  }
  return null;
}

// Cmd/Ctrl+S and Cmd/Ctrl+Enter save, Escape cancels, and Enter, Tab, and
// Backspace follow Markdown list items. No hard wrap: a document keeps its
// own line width.
export function onMarkdownKeyDown(save: () => void, cancel: () => void) {
  return (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "Enter")) {
      e.preventDefault();
      save();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) {
      return;
    }
    const el = e.currentTarget;
    const edit = listEdit(e.key, e.shiftKey, el.value, el.selectionStart, el.selectionEnd);
    if (!edit) {
      return;
    }
    e.preventDefault();
    apply(el, edit);
  };
}
