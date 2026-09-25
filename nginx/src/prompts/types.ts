// Mirrors the dataclasses in scripts/prompts.py field for field. Every
// response serializes with dataclasses.asdict, so the JSON field names are
// the Python field names, snake_case included.

export interface Run {
  id: number;
  task_id: number;
  model: string;
  harness: string;
  rating: number | null;
  turns: number | null;
  notes: string;
  ran_at: number;
}

export interface Ref {
  id: number;
  kind: "path" | "url";
  value: string;
  label: string;
}

export interface Task {
  id: number;
  title: string;
  prompt: string;
  notes: string;
  tags: string[];
  refs: Ref[];
  runs: Run[];
  created_at: number;
  updated_at: number;
}

export interface TaskSummary {
  id: number;
  title: string;
  tags: string[];
  prompt_chars: number;
  run_count: number;
  avg_rating: number | null;
  best_model: string | null;
  best_rating: number | null;
  updated_at: number;
}

export interface ModelScore {
  model: string;
  runs: number;
  rated: number;
  avg_rating: number | null;
  strong: number;
  tasks: number;
}

export type Sort = "updated" | "rating" | "title";
