// Which viewer a URL maps to. Mirrors the extension matches in conf/*.conf;
// nginx has already decided a navigation should render before this runs, so
// this only picks which component, never whether to render at all.
export type ViewerKind = "explorer" | "md" | "json" | "ipynb" | "text" | "eval" | "prompts";

const EXTENSION_VIEWERS: Record<string, ViewerKind> = {
  md: "md",
  markdown: "md",
  mdx: "md",
  json: "json",
  jsonl: "json",
  ndjson: "json",
  ipynb: "ipynb",
  log: "text",
  txt: "text",
  out: "text",
  err: "text",
  go: "text",
  py: "text",
  ts: "text",
  tsx: "text",
  jsx: "text",
  sh: "text",
  bash: "text",
  zsh: "text",
  yaml: "text",
  yml: "text",
  toml: "text",
  tsv: "text",
  csv: "text",
  eval: "eval",
};

export function pickViewer(pathname: string, search: string): ViewerKind {
  if (pathname === "/prompts" || pathname.startsWith("/prompts/")) {
    return "prompts";
  }
  if (pathname.endsWith("/")) {
    return "explorer";
  }
  if (new URLSearchParams(search).get("view") === "text") {
    return "text";
  }
  const name = pathname.slice(pathname.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const ext = dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
  return EXTENSION_VIEWERS[ext] ?? "explorer";
}
