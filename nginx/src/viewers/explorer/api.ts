// Typed clients for scripts/explorer-server.py, proxied at /__api/ by
// explorer.conf. See conf/explorer.conf for the health-check fallback when
// the service is down.
const API = "/__api";

export interface Entry {
  name: string;
  type: "dir" | "file";
  size: number;
  mtime: number;
  url: string;
  path: string;
  link: boolean;
  ext: string;
  hidden: boolean;
}

export interface TreeLevel {
  path: string;
  parent: string | null;
  dirs: number;
  files: number;
  entries: Entry[];
}

export interface ListOk {
  ok: true;
  path: string;
  parent: string | null;
  dirs: number;
  files: number;
  entries: Entry[];
  tree?: TreeLevel[];
  ripgrep?: boolean;
}

export interface ApiError {
  ok: false;
  error: string;
}

export type ListResponse = ListOk | ApiError;

export interface SearchMatch {
  line: number;
  text: string;
}

export interface SearchResult {
  url: string;
  path: string;
  name: string;
  dir: string;
  size?: number;
  mtime?: number;
  matches: SearchMatch[];
}

export interface SearchOk {
  ok: true;
  scope: string;
  count: number;
  matches: number;
  truncated: boolean;
  took_ms: number;
  results: SearchResult[];
}

export type SearchResponse = SearchOk | ApiError;

export type SearchMode = "content" | "names" | "both";

async function call<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const r = await fetch(`${API}${endpoint}?${new URLSearchParams(params)}`, { cache: "no-store" });
  return r.json() as Promise<T>;
}

export function apiList(path: string, opts: { tree?: boolean } = {}): Promise<ListResponse> {
  const params: Record<string, string> = { path };
  if (opts.tree) {
    params.tree = "1";
  }
  return call<ListResponse>("/list", params);
}

export interface SearchParams {
  q: string;
  mode: SearchMode;
  scope?: string;
  glob?: string;
  regex?: boolean;
  case?: boolean;
}

export function apiSearch(p: SearchParams): Promise<SearchResponse> {
  const params: Record<string, string> = { q: p.q, mode: p.mode };
  if (p.scope) {
    params.scope = p.scope;
  }
  if (p.glob) {
    params.glob = p.glob;
  }
  if (p.regex) {
    params.regex = "1";
  }
  if (p.case) {
    params.case = "1";
  }
  return call<SearchResponse>("/search", params);
}
