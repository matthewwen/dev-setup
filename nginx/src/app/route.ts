// Which viewer a URL maps to. Mirrors the extension matches in conf/*.conf;
// nginx has already decided a navigation should render before this runs, so
// this only picks which component, never whether to render at all.
export type ViewerKind = "explorer" | "md" | "json" | "ipynb" | "text" | "eval";

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
  tsv: "text",
  csv: "text",
  eval: "eval",
};

export function pickViewer(pathname: string, search: string): ViewerKind {
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
