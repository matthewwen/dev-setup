import type { KeyboardEvent } from "react";

export interface Edit {
  from: number;
  to: number;
  text: string;
  caret: [number, number];
}

type Style = "number" | "letter" | "roman";

const ITEM = /^([ \t]*)(\(?)(\d+|[ivxlcdm]+|[IVXLCDM]+|[A-Za-z])([.)])[ \t]+/;
const INDENT = "  ";
const LEVEL_STYLES: Style[] = ["number", "letter", "roman"];
const FIRST: Record<Style, string> = { number: "1", letter: "a", roman: "i" };
const ROMAN: [number, string][] = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

function lineStart(value: string, i: number): number {
  return value.lastIndexOf("\n", i - 1) + 1;
}

function lineEnd(value: string, i: number): number {
  const j = value.indexOf("\n", i);
  return j === -1 ? value.length : j;
}

function toRoman(n: number): string {
  let out = "";
  for (const [v, sym] of ROMAN) {
    for (; n >= v; n -= v) {
      out += sym;
    }
  }
  return out;
}

function fromRoman(label: string): number {
  const s = label.toLowerCase();
  let n = 0;
  let i = 0;
  for (const [v, sym] of ROMAN) {
    for (; s.startsWith(sym, i); i += sym.length) {
      n += v;
    }
  }
  return i === s.length && toRoman(n) === s ? n : 0;
}

function levelStyle(indent: string): Style {
  return LEVEL_STYLES[Math.floor(indent.length / INDENT.length) % LEVEL_STYLES.length];
}

function styleOf(label: string, indent: string): Style {
  if (/^\d+$/.test(label)) {
    return "number";
  }
  if (label.length > 1 || (levelStyle(indent) === "roman" && fromRoman(label) > 0)) {
    return "roman";
  }
  return "letter";
}

function listItem(line: string): RegExpExecArray | null {
  const m = ITEM.exec(line);
  if (!m || (m[2] === "(" && m[4] !== ")")) {
    return null;
  }
  if (m[3].length > 1 && !/^\d+$/.test(m[3]) && fromRoman(m[3]) === 0) {
    return null;
  }
  return m;
}

function nextLabel(label: string, style: Style): string | null {
  if (style === "number") {
    return String(Number(label) + 1);
  }
  if (style === "roman") {
    const next = toRoman(fromRoman(label) + 1);
    return label === label.toUpperCase() ? next.toUpperCase() : next;
  }
  if (label === "z" || label === "Z") {
    return null;
  }
  return String.fromCharCode(label.charCodeAt(0) + 1);
}

function siblingLabel(value: string, ls: number, indent: string): string | null {
  for (let end = ls - 1; end >= 0; ) {
    const start = lineStart(value, end);
    const line = value.slice(start, end);
    end = start - 1;
    if (line.trim() === "") {
      continue;
    }
    const width = /^[ \t]*/.exec(line)![0].length;
    if (width > indent.length) {
      continue;
    }
    const m = width === indent.length ? listItem(line) : null;
    return m && nextLabel(m[3], styleOf(m[3], indent));
  }
  return null;
}

function relabel(value: string, start: number, end: number, ls: number, m: RegExpExecArray, indent: string): Edit {
  const label = siblingLabel(value, ls, indent) ?? FIRST[levelStyle(indent)];
  const text = `${indent}${m[2]}${label}${m[4]} `;
  const oldEnd = ls + m[0].length;
  const move = (pos: number) => (pos < oldEnd ? ls + text.length : pos + text.length - m[0].length);
  return { from: ls, to: oldEnd, text, caret: [move(start), move(end)] };
}

export function enterEdit(value: string, start: number, end: number): Edit | null {
  const ls = lineStart(value, start);
  const le = lineEnd(value, start);
  const m = listItem(value.slice(ls, le));
  if (!m || start - ls < m[0].length) {
    return null;
  }
  if (start === end && value.slice(ls + m[0].length, le).trim() === "") {
    return { from: ls, to: le, text: "", caret: [ls, ls] };
  }
  const [, indent, open, label, delim] = m;
  const next = nextLabel(label, styleOf(label, indent));
  if (next === null) {
    return null;
  }
  const text = `\n${indent}${open}${next}${delim} `;
  const caret = start + text.length;
  return { from: start, to: end, text, caret: [caret, caret] };
}

export function backspaceEdit(value: string, start: number, end: number): Edit | null {
  const ls = lineStart(value, start);
  const m = start === end ? listItem(value.slice(ls, lineEnd(value, start))) : null;
  if (!m || start !== ls + m[0].length) {
    return null;
  }
  return { from: ls, to: start, text: "", caret: [ls, ls] };
}

export function indentEdit(value: string, start: number, end: number, outdent: boolean): Edit | null {
  const ls = lineStart(value, start);
  const le = lineEnd(value, end > start && value[end - 1] === "\n" ? end - 1 : end);
  const block = value.slice(ls, le);
  const multi = block.includes("\n");
  const m = multi ? null : listItem(block);
  if (m) {
    const indent = outdent ? m[1].replace(/^ {1,2}/, "") : INDENT + m[1];
    return indent === m[1] ? null : relabel(value, start, end, ls, m, indent);
  }
  if (!outdent && !multi) {
    const caret = start + INDENT.length;
    return { from: start, to: end, text: INDENT, caret: [caret, caret] };
  }
  const lines = block.split("\n");
  const next = lines.map(l => (outdent ? l.replace(/^ {1,2}/, "") : l === "" ? l : INDENT + l));
  const text = next.join("\n");
  if (text === block) {
    return null;
  }
  const selStart = Math.max(ls, start + next[0].length - lines[0].length);
  const selEnd = start === end ? selStart : Math.max(selStart, end + text.length - block.length);
  return { from: ls, to: le, text, caret: [selStart, selEnd] };
}

function apply(el: HTMLTextAreaElement, edit: Edit): void {
  el.setSelectionRange(edit.from, edit.to);
  const ok = edit.text === ""
    ? edit.from === edit.to || document.execCommand("delete")
    : document.execCommand("insertText", false, edit.text);
  if (!ok) {
    el.setRangeText(edit.text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(edit.caret[0], edit.caret[1]);
}

export function onListKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
  if (e.nativeEvent.isComposing || e.altKey || e.ctrlKey || e.metaKey) {
    return;
  }
  const el = e.currentTarget;
  const { value, selectionStart, selectionEnd } = el;
  let edit: Edit | null = null;
  if (e.key === "Enter" && !e.shiftKey) {
    edit = enterEdit(value, selectionStart, selectionEnd);
  } else if (e.key === "Tab") {
    edit = indentEdit(value, selectionStart, selectionEnd, e.shiftKey);
  } else if (e.key === "Backspace") {
    edit = backspaceEdit(value, selectionStart, selectionEnd);
  }
  if (!edit) {
    return;
  }
  e.preventDefault();
  apply(el, edit);
}
