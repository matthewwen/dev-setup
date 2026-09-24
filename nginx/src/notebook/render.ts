// Ported from the notebook renderer in html/ipynb-viewer.html, with types
// added. Markdown cells and Markdown outputs go through the shared
// markdown/render.ts, sharing one slug map across the whole notebook so two
// cells with the same heading text get distinct anchors, the way the
// original page's module-level `slugs` map did.
import { highlight } from "../markdown/highlight.ts";
import { renderMarkdown, type Heading } from "../markdown/render.ts";

// eslint-disable-next-line no-control-regex -- ESC is the ANSI escape this strips
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function text(v: unknown): string {
  if (Array.isArray(v)) {
    return v.join("");
  }
  return v == null ? "" : String(v);
}

interface RawNotebook {
  metadata?: {
    kernelspec?: { language?: string; display_name?: string };
    language_info?: { name?: string };
  };
  cells?: RawCell[];
  nbformat?: number;
  nbformat_minor?: number;
}

interface RawCell {
  cell_type?: string;
  source?: unknown;
  execution_count?: number | null;
  outputs?: RawOutput[];
}

interface RawOutput {
  output_type?: string;
  name?: string;
  text?: unknown;
  traceback?: string[];
  ename?: string;
  evalue?: string;
  data?: Record<string, unknown>;
  execution_count?: number | null;
}

export function notebookLanguage(nb: RawNotebook): string {
  const m = nb.metadata || {};
  return m.kernelspec?.language || m.language_info?.name || "python";
}

export type OutputModel =
  | { kind: "stream"; text: string; err: boolean }
  | { kind: "error"; text: string }
  | { kind: "html"; html: string; label: string | null }
  | { kind: "image"; src: string; label: string | null }
  | { kind: "markdown"; html: string; label: string | null }
  | { kind: "text"; text: string; label: string | null };

export type CellModel =
  | { kind: "markdown"; html: string; headings: Heading[] }
  | { kind: "raw"; source: string }
  | { kind: "code"; executionCount: number | null; lang: string; source: string; sourceHtml: string; outputs: OutputModel[] };

export interface NotebookModel {
  kernel: string;
  cellCount: number;
  nbformat: string;
  headings: Heading[];
  cells: CellModel[];
}

const UNSAFE_TAG = /<(script|iframe|object|embed|link|meta|base|form)\b[^>]*>[\s\S]*?<\/\1\s*>|<(script|iframe|object|embed|link|meta|base|form)\b[^>]*\/?>/gi;
const ON_ATTR = /\son\w+\s*=\s*(?:"[^"]*"|'[^']*')/gi;
const JS_URL_ATTR = /\b(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi;

// Regex-based fallback for a non-browser context (this repo's own tests -
// node:test has no DOMParser). Less thorough than the DOM-based pass below,
// which is what actually protects a reader's browser; this only keeps the
// same guarantee for code that runs render.ts outside one.
function sanitizeWithoutDom(html: string): string {
  return html.replace(UNSAFE_TAG, "").replace(ON_ATTR, "").replace(JS_URL_ATTR, '$1="#"');
}

// Notebook HTML outputs come from the kernel, so drop anything that runs code.
export function sanitize(html: string): string {
  if (typeof DOMParser === "undefined") {
    return sanitizeWithoutDom(html);
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, iframe, object, embed, link, meta, base, form").forEach(el => el.remove());
  doc.querySelectorAll("*").forEach(el => {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /^\s*javascript:/i.test(a.value)) {
        el.removeAttribute(a.name);
      }
    }
  });
  return doc.body.innerHTML;
}

function renderOutput(o: RawOutput): OutputModel | null {
  switch (o.output_type) {
    case "stream":
      return { kind: "stream", text: text(o.text), err: o.name === "stderr" };
    case "error": {
      const tb = (o.traceback || []).join("\n").replace(ANSI, "");
      return { kind: "error", text: tb || `${o.ename}: ${o.evalue}` };
    }
    case "execute_result":
    case "display_data":
      return renderData(o.data || {}, o.execution_count ?? null);
    default:
      return null;
  }
}

function renderData(d: Record<string, unknown>, n: number | null): OutputModel | null {
  const label = n != null ? `Out [${n}]` : null;
  if (d["text/html"]) {
    return { kind: "html", html: sanitize(text(d["text/html"])), label };
  }
  for (const t of IMAGE_TYPES) {
    if (d[t]) {
      return { kind: "image", src: `data:${t};base64,${text(d[t]).replace(/\s/g, "")}`, label };
    }
  }
  if (d["image/svg+xml"]) {
    return { kind: "image", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text(d["image/svg+xml"]))}`, label };
  }
  if (d["text/markdown"]) {
    return { kind: "markdown", html: renderMarkdown(text(d["text/markdown"])).html, label };
  }
  if (d["text/plain"] != null) {
    return { kind: "text", text: text(d["text/plain"]), label };
  }
  return null;
}

function renderCell(c: RawCell, lang: string, slugs: Map<string, number>, headings: Heading[]): CellModel {
  const s = text(c.source);
  if (c.cell_type === "markdown") {
    const result = renderMarkdown(s, slugs);
    headings.push(...result.headings);
    return { kind: "markdown", html: result.html, headings: result.headings };
  }
  if (c.cell_type !== "code") {
    return { kind: "raw", source: s };
  }
  const outputs = (c.outputs || []).map(renderOutput).filter((o): o is OutputModel => o !== null);
  return { kind: "code", executionCount: c.execution_count ?? null, lang, source: s, sourceHtml: highlight(s, lang), outputs };
}

export function renderNotebook(raw: unknown): NotebookModel {
  const nb = raw as RawNotebook;
  const lang = notebookLanguage(nb);
  const slugs = new Map<string, number>();
  const headings: Heading[] = [];
  const cells = (Array.isArray(nb.cells) ? nb.cells : []).map(c => renderCell(c, lang, slugs, headings));
  const m = nb.metadata || {};
  const kernel = m.kernelspec?.display_name || lang;
  return {
    kernel,
    cellCount: cells.length,
    nbformat: `${nb.nbformat ?? "?"}.${nb.nbformat_minor ?? "?"}`,
    headings,
    cells,
  };
}
