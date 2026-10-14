// Typed client for GET and POST /api/files in scripts/explorer-server.py,
// proxied at /__api/ by explorer.conf.
import type { ApiError } from "../viewers/explorer/api";

const API = "/__api/files";

export interface FileOk {
  ok: true;
  path: string;
  content: string;
  sha256: string;
  size: number;
  mtime: number;
}

export type FileResponse = FileOk | ApiError;

export interface WriteOk {
  ok: true;
  op: "write";
  path: string;
  sha256: string;
}

// 409 means the file changed on disk since it was read; `sha256` is what is
// there now.
export interface WriteConflict extends ApiError {
  sha256: string;
}

export type WriteResponse = WriteOk | WriteConflict | ApiError;

export interface PatchOk {
  ok: true;
  op: "patch";
  path: string;
  sha256: string;
  content: string;
}

// 409 means lines line..endLine no longer read `expect`; `current` is what
// they read now.
export interface PatchConflict extends ApiError {
  line: number;
  endLine: number;
  current: string;
}

export type PatchResponse = PatchOk | PatchConflict | ApiError;

export async function apiPatchFile(
  path: string,
  range: { line: number; endLine: number; expect: string; text: string },
): Promise<{ status: number; body: PatchResponse }> {
  const r = await fetch(API, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "patch", path, ...range }),
  });
  return { status: r.status, body: (await r.json()) as PatchResponse };
}

export async function apiReadFile(path: string): Promise<FileResponse> {
  const r = await fetch(`${API}?${new URLSearchParams({ path })}`, { cache: "no-store" });
  return r.json() as Promise<FileResponse>;
}

export async function apiWriteFile(path: string, content: string, ifMatch: string): Promise<{ status: number; body: WriteResponse }> {
  const r = await fetch(API, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "write", path, content, if_match: ifMatch }),
  });
  return { status: r.status, body: (await r.json()) as WriteResponse };
}
