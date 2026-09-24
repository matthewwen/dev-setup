import type { Entry } from "./api";

const EXT_ICON: Record<string, string> = {
  md: "📝", markdown: "📝", txt: "📄", log: "🪵",
  json: "🔢", jsonl: "🔢", ndjson: "🔢", ipynb: "📓", yaml: "⚙️", yml: "⚙️", toml: "⚙️", conf: "⚙️", ini: "⚙️",
  py: "🐍", sh: "🐚", bash: "🐚", zsh: "🐚", js: "📜", mjs: "📜", ts: "📜", html: "🌐", css: "🎨",
  png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", svg: "🖼️", pdf: "📕",
  eval: "🧪", zip: "🗜️", tar: "🗜️", gz: "🗜️", csv: "📊", tsv: "📊", parquet: "📊",
  safetensors: "🧠", bin: "🧠", pt: "🧠",
};

export function icon(e: Entry): string {
  return e.type === "dir" ? "📁" : EXT_ICON[e.ext] || "📄";
}

export function when(ts: number): string {
  if (!ts) {
    return "";
  }
  const d = new Date(ts * 1000);
  const days = (Date.now() - d.getTime()) / 86400000;
  if (days < 1) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (days < 300) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], { year: "numeric", month: "short" });
}

// Viewer-backed types open in the browser; the rest are raw downloads.
const RENDERED = /\.(md|markdown|mdx|json|jsonl|ndjson|ipynb|eval|html|htm|txt|log|out|err|yaml|yml|png|jpe?g|gif|svg|pdf|csv|tsv)$/i;
export const previewable = (url: string): boolean => RENDERED.test(url);
