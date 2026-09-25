// Typed client for the prompt-library endpoints on scripts/explorer-server.py,
// proxied at /__api/ by explorer.conf. See scripts/prompts.py for the schema
// these mirror. Unlike src/viewers/explorer/api.ts, POST /api/prompts needs
// no token: see the design doc's auth decision.
import type { ApiError } from "../viewers/explorer/api";
import type { ModelScore, Run, Sort, Task, TaskSummary } from "./types";

const API = "/__api/prompts";

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(`${API}${path}${qs ? `?${qs}` : ""}`, { cache: "no-store" });
  return r.json() as Promise<T>;
}

async function post<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, ...body }),
    cache: "no-store",
  });
  return r.json() as Promise<T>;
}

export interface TasksOk {
  ok: true;
  tasks: TaskSummary[];
  total: number;
  truncated: boolean;
}
export type TasksResponse = TasksOk | ApiError;

export interface TaskOk {
  ok: true;
  task: Task;
}
export type TaskResponse = TaskOk | ApiError;

export interface FacetsOk {
  ok: true;
  tags: [string, number][];
  models: ModelScore[];
  task_count: number;
}
export type FacetsResponse = FacetsOk | ApiError;

export interface PromptsOk {
  ok: true;
  op: string;
  task?: Task;
  run?: Run;
}
export type PromptsResponse = PromptsOk | ApiError;

export interface ListTasksParams {
  q?: string;
  tag?: string;
  model?: string;
  minRating?: number;
  sort?: Sort;
  limit?: number;
  offset?: number;
}

export function apiTasks(p: ListTasksParams = {}): Promise<TasksResponse> {
  const params: Record<string, string> = {};
  if (p.q) {
    params.q = p.q;
  }
  if (p.tag) {
    params.tag = p.tag;
  }
  if (p.model) {
    params.model = p.model;
  }
  if (p.minRating) {
    params.rating = String(p.minRating);
  }
  if (p.sort) {
    params.sort = p.sort;
  }
  if (p.limit) {
    params.limit = String(p.limit);
  }
  if (p.offset) {
    params.offset = String(p.offset);
  }
  return get<TasksResponse>("/tasks", params);
}

export function apiTask(id: number): Promise<TaskResponse> {
  return get<TaskResponse>("/task", { id: String(id) });
}

export function apiFacets(tag = ""): Promise<FacetsResponse> {
  return get<FacetsResponse>("/facets", tag ? { tag } : {});
}

// `op` names the server-side operation (task.create, run.update, ...); the
// rest of `body` is whatever fields that op takes. See scripts/prompts.py.
export function apiPrompts(op: string, body: Record<string, unknown> = {}): Promise<PromptsResponse> {
  return post<PromptsResponse>(op, body);
}
