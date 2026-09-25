// Pure helpers for the review panel. No DOM, so test/review.test.ts runs
// them under node --test directly.
import type { Block } from "../markdown/render.ts";
import type { ReviewComment } from "../shared/review-api.ts";

export interface Groups {
  document: ReviewComment[];
  inline: ReviewComment[];
  orphan: ReviewComment[];
  resolved: ReviewComment[];
}

// Open comments split by where they land; the server already sorts by line.
export function groupComments(comments: ReviewComment[]): Groups {
  const groups: Groups = { document: [], inline: [], orphan: [], resolved: [] };
  for (const c of comments) {
    if (c.status === "resolved") {
      groups.resolved.push(c);
    } else if (c.resolved.confidence === "document") {
      groups.document.push(c);
    } else if (c.resolved.confidence === "orphan") {
      groups.orphan.push(c);
    } else {
      groups.inline.push(c);
    }
  }
  return groups;
}

// The top-level block that contains `line`, or undefined for a blank line.
export function blockAt(blocks: Block[], line: number): Block | undefined {
  return blocks.find(b => b.line <= line && line <= b.endLine);
}

// Block start line to the ids of the open comments that land in it.
export function markedBlocks(comments: ReviewComment[], blocks: Block[]): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  for (const c of comments) {
    if (c.status !== "open" || c.resolved.line === undefined) {
      continue;
    }
    const block = blockAt(blocks, c.resolved.line);
    if (!block) {
      continue;
    }
    marks.set(block.line, [...(marks.get(block.line) ?? []), c.id]);
  }
  return marks;
}

// A selection is commentable when both ends sit in the same block.
export type SelectionTarget = { ok: true; block: Block; selection: string } | { ok: false; reason: string };

export function selectionTarget(blocks: Block[], startLine: number | null, endLine: number | null, text: string): SelectionTarget {
  const selection = text.trim();
  if (!selection) {
    return { ok: false, reason: "empty selection" };
  }
  if (startLine === null || endLine === null) {
    return { ok: false, reason: "select text inside the document body" };
  }
  if (startLine !== endLine) {
    return { ok: false, reason: "select text inside one block" };
  }
  const block = blocks.find(b => b.line === startLine);
  if (!block) {
    return { ok: false, reason: "select text inside the document body" };
  }
  return { ok: true, block, selection: selection.slice(0, 2000) };
}

export function excerpt(text: string, max = 120): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length <= max ? one : one.slice(0, max - 1) + "…";
}

export function lineLabel(c: ReviewComment): string {
  const { line, endLine } = c.resolved;
  if (line === undefined) {
    return "";
  }
  return endLine !== undefined && endLine !== line ? `L${line}-${endLine}` : `L${line}`;
}

export function relativeTime(ts: string, now: number = Date.now()): string {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) {
    return ts;
  }
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) {
    return "just now";
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ago`;
  }
  if (s < 86400) {
    return `${Math.floor(s / 3600)}h ago`;
  }
  if (s < 7 * 86400) {
    return `${Math.floor(s / 86400)}d ago`;
  }
  return new Date(then).toISOString().slice(0, 10);
}

export const ACTION_LABELS = { fixed: "fixed", answered: "answered", wontfix: "won't fix" } as const;
