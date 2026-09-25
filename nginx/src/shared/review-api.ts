// Typed client for GET and POST /api/review in scripts/explorer-server.py,
// proxied at /__api/ by explorer.conf. The store and the anchor rules live
// in scripts/review_store.py; this file only mirrors their JSON shapes.
import type { ApiError } from "../viewers/explorer/api";

const API = "/__api/review";

export type Confidence = "exact" | "moved" | "quote" | "orphan" | "document";
export type Action = "fixed" | "answered" | "wontfix";

export interface Anchor {
  line: number | null;
  endLine?: number;
  quote?: string;
  selection?: string;
}

export interface Resolved {
  confidence: Confidence;
  line?: number;
  endLine?: number;
  text?: string;
}

export interface Reply {
  author: string;
  ts: string;
  body: string;
}

export interface ReviewComment {
  id: string;
  status: "open" | "resolved";
  action: Action | null;
  author: string;
  ts: string;
  body: string;
  anchor: Anchor;
  resolved: Resolved;
  replies: Reply[];
}

export interface ReviewOk {
  ok: true;
  path: string;
  comments: ReviewComment[];
  counts: { open: number; resolved: number; orphan: number };
}

export type ReviewResponse = ReviewOk | ApiError;

// `text` is the block source the page rendered. The server refuses the
// comment when the file no longer holds that text at those lines. The
// server records the author as the login name that runs it.
export interface NewAnchor {
  line: number;
  endLine: number;
  text: string;
  selection?: string;
}

export type ReviewOp =
  | { op: "comment"; body: string; anchor: NewAnchor | null }
  | { op: "reply"; id: string; body: string }
  | { op: "status"; id: string; status: "open" }
  | { op: "status"; id: string; status: "resolved"; action: Action }
  | { op: "delete"; id: string };

export type PostResponse = { ok: true; op: string; id: string; path: string } | ApiError;

export async function apiReview(path: string): Promise<ReviewResponse> {
  const r = await fetch(`${API}?${new URLSearchParams({ path })}`, { cache: "no-store" });
  return r.json() as Promise<ReviewResponse>;
}

export async function apiReviewPost(path: string, op: ReviewOp): Promise<PostResponse> {
  const r = await fetch(API, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...op, path }),
  });
  return r.json() as Promise<PostResponse>;
}
