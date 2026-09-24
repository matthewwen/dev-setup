import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "../shared/Toolbar";
import { SizeGuard } from "../shared/SizeGuard";
import { FindBox, useDebounced } from "../shared/FindBox";
import { CopyButton } from "../shared/CopyButton";
import { fetchRaw, rawUrl, textViewUrl } from "../shared/fetch";
import "./JsonViewer.css";

// Parsing and rendering a very large document blocks the page, so SizeGuard
// asks first and offers the buffered text viewer.
const BIG_BYTES = 4 * 1024 * 1024;

// Nodes deeper than this, or with more entries than this, start collapsed so
// huge documents stay responsive.
const OPEN_DEPTH = 2;
const BIG_NODE = 100;

type LeafKind = "string" | "number" | "boolean" | "null";

interface LeafNode {
  kind: "leaf";
  leafKind: LeafKind;
  value: string | number | boolean | null;
  key: string | null;
  path: string;
}

interface ContainerNode {
  kind: "object" | "array";
  entries: AnyNode[];
  key: string | null;
  path: string;
  depth: number;
  defaultOpen: boolean;
}

type AnyNode = LeafNode | ContainerNode;

function classify(v: unknown): "object" | "array" | LeafKind {
  if (v === null) {
    return "null";
  }
  if (Array.isArray(v)) {
    return "array";
  }
  const t = typeof v;
  if (t === "string" || t === "number" || t === "boolean") {
    return t;
  }
  return "object";
}

function buildTree(value: unknown, key: string | null, path: string, depth: number, containerPaths: string[]): AnyNode {
  const kind = classify(value);
  if (kind === "object" || kind === "array") {
    const entries: [string, unknown][] =
      kind === "array"
        ? (value as unknown[]).map((v, i) => [String(i), v])
        : Object.entries(value as Record<string, unknown>);
    containerPaths.push(path);
    return {
      kind,
      key,
      path,
      depth,
      defaultOpen: depth < OPEN_DEPTH && entries.length <= BIG_NODE,
      entries: entries.map(([k, v]) =>
        buildTree(v, k, path + (kind === "array" ? `[${k}]` : (path ? "." : "") + k), depth + 1, containerPaths),
      ),
    };
  }
  return { kind: "leaf", leafKind: kind, key, path, value: value as string | number | boolean | null };
}

// The text a search matches against a node's own row - its key and, for a
// leaf, its own value. A container's children are separate nodes with their
// own rows, so they never contribute to their parent's match text.
function ownRowText(node: AnyNode): string {
  const keyText = node.key ?? "";
  if (node.kind !== "leaf") {
    return keyText;
  }
  const v = node.value;
  const valText = node.leafKind === "string" ? `"${String(v)}"` : String(v);
  return `${keyText} ${valText}`;
}

function findHits(node: AnyNode, needle: string, ancestors: string[], hits: string[], forceOpen: Set<string>) {
  if (ownRowText(node).toLowerCase().includes(needle)) {
    hits.push(node.path);
    ancestors.forEach(a => forceOpen.add(a));
  }
  if (node.kind !== "leaf") {
    const nextAncestors = [...ancestors, node.path];
    node.entries.forEach(child => findHits(child, needle, nextAncestors, hits, forceOpen));
  }
}

function countNodes(v: unknown): number {
  if (v === null || typeof v !== "object") {
    return 1;
  }
  const vals = Array.isArray(v) ? v : Object.values(v as object);
  return vals.reduce((a, x) => a + countNodes(x), 1);
}

interface Parsed {
  value: unknown;
  kind: "json" | "jsonl";
  records?: number;
  ms: number;
}

// nginx rewrites *.json, *.jsonl, and *.ndjson navigations here. Falls back
// to line-delimited JSON, which .jsonl and log files use, when a document
// does not parse as one JSON value.
function parseJsonOrJsonl(text: string): Parsed {
  const t0 = performance.now();
  try {
    return { value: JSON.parse(text), kind: "json", ms: performance.now() - t0 };
  } catch (jsonErr) {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
      try {
        return { value: lines.map(l => JSON.parse(l)), kind: "jsonl", records: lines.length, ms: performance.now() - t0 };
      } catch {
        // fall through to the JSON error
      }
    }
    throw jsonErr;
  }
}

function PathChip({ jsonPath }: { jsonPath: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="path"
      title="Copy path"
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard.writeText(jsonPath || "$");
        setCopied(true);
        setTimeout(() => setCopied(false), 900);
      }}
    >
      {copied ? "copied" : jsonPath || "$"}
    </button>
  );
}

function highlighted(text: string, needle: string) {
  if (!needle) {
    return text;
  }
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function NodeView({
  node,
  overrides,
  toggle,
  needle,
  hitSet,
  firstHit,
  firstHitRef,
}: {
  node: AnyNode;
  overrides: Record<string, boolean>;
  toggle: (path: string) => void;
  needle: string;
  hitSet: Set<string>;
  firstHit: string | null;
  firstHitRef: React.RefObject<HTMLDivElement>;
}) {
  const isHit = hitSet.has(node.path);
  const label = node.key !== null && (
    <>
      <span className="k">{highlighted(node.key, needle)}</span>
      <span className="meta">:</span>{" "}
    </>
  );

  if (node.kind === "leaf") {
    const text = node.leafKind === "string" ? `"${node.value}"` : String(node.value);
    const cls = node.leafKind === "string" ? "s" : node.leafKind === "number" ? "n" : node.leafKind === "boolean" ? "b" : "nl";
    return (
      <div className={isHit ? "node hit" : "node"} ref={node.path === firstHit ? firstHitRef : undefined}>
        <div className="row">
          <span className="tw" />
          {label}
          <span className={cls}>{highlighted(text, needle)}</span>
          <PathChip jsonPath={node.path} />
        </div>
      </div>
    );
  }

  const open = overrides[node.path] ?? node.defaultOpen;
  const braces = node.kind === "array" ? ["[", "]"] : ["{", "}"];
  const count = node.entries.length;

  return (
    <div className={`node${open ? "" : " collapsed"}${isHit ? " hit" : ""}`} ref={node.path === firstHit ? firstHitRef : undefined}>
      <div
        className="row"
        onClick={() => {
          if (count) {
            toggle(node.path);
          }
        }}
      >
        <span className="tw">{count ? "▾" : ""}</span>
        {label}
        <span className="brace meta">{braces[0]}</span>
        <span className="preview">
          {braces[0]} {count} {count === 1 ? "item" : "items"} {braces[1]}
        </span>
        <PathChip jsonPath={node.path} />
      </div>
      <div className="kids">
        {node.entries.map(child => (
          <NodeView
            key={child.path}
            node={child}
            overrides={overrides}
            toggle={toggle}
            needle={needle}
            hitSet={hitSet}
            firstHit={firstHit}
            firstHitRef={firstHitRef}
          />
        ))}
        <div className="row">
          <span className="tw" />
          <span className="meta">{braces[1]}</span>
        </div>
      </div>
    </div>
  );
}

function JsonLoader({ path, onLoaded, onError }: { path: string; onLoaded: (text: string) => void; onError: (msg: string) => void }) {
  useEffect(() => {
    let cancelled = false;
    fetchRaw(path)
      .then(text => {
        if (!cancelled) {
          onLoaded(text);
        }
      })
      .catch(err => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, onLoaded, onError]);
  return null;
}

export function JsonViewer({ path }: { path: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [view, setView] = useState<"tree" | "raw">("tree");
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounced(rawQuery, 140);
  const findRef = useRef<HTMLInputElement>(null);
  const firstHitRef = useRef<HTMLDivElement>(null);

  const handleLoaded = useCallback((text: string) => setRaw(text), []);
  const handleError = useCallback((msg: string) => setFetchError(msg), []);

  const parsed = useMemo<{ ok: Parsed } | { error: string } | null>(() => {
    if (raw === null) {
      return null;
    }
    try {
      return { ok: parseJsonOrJsonl(raw) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }, [raw]);

  const built = useMemo(() => {
    if (!parsed || "error" in parsed) {
      return null;
    }
    const containerPaths: string[] = [];
    const root = buildTree(parsed.ok.value, null, "", 0, containerPaths);
    return { root, containerPaths };
  }, [parsed]);

  const needle = query.trim().toLowerCase();
  const { hitSet, firstHit, forceOpen } = useMemo(() => {
    if (!built || !needle) {
      return { hitSet: new Set<string>(), firstHit: null as string | null, forceOpen: new Set<string>() };
    }
    const hits: string[] = [];
    const forceOpen = new Set<string>();
    findHits(built.root, needle, [], hits, forceOpen);
    return { hitSet: new Set(hits), firstHit: hits[0] ?? null, forceOpen };
  }, [built, needle]);

  // A search permanently expands the ancestors of any match, same as the
  // original page's classList.remove("collapsed") - clearing the query
  // leaves those nodes open. Applied in the render that sees a new search, so
  // the matches never paint collapsed first.
  const [openedFor, setOpenedFor] = useState(forceOpen);
  if (openedFor !== forceOpen) {
    setOpenedFor(forceOpen);
    if (forceOpen.size > 0) {
      setOverrides(prev => {
        const next = { ...prev };
        forceOpen.forEach(p => {
          next[p] = true;
        });
        return next;
      });
    }
  }

  useEffect(() => {
    if (firstHit) {
      firstHitRef.current?.scrollIntoView({ block: "center" });
    }
  }, [firstHit]);

  // A container's collapsed state starts at its computed default and only
  // becomes explicit in `overrides` once the reader clicks it.
  const toggle = useCallback(
    (path: string) => {
      if (!built) {
        return;
      }
      const findDefault = (node: AnyNode): boolean | null => {
        if (node.kind !== "leaf") {
          if (node.path === path) {
            return node.defaultOpen;
          }
          for (const child of node.entries) {
            const r = findDefault(child);
            if (r !== null) {
              return r;
            }
          }
        }
        return null;
      };
      setOverrides(prev => {
        const current = prev[path] ?? findDefault(built.root) ?? true;
        return { ...prev, [path]: !current };
      });
    },
    [built],
  );

  const expandAll = useCallback(() => {
    if (!built) {
      return;
    }
    const next: Record<string, boolean> = {};
    built.containerPaths.forEach(p => (next[p] = true));
    setOverrides(next);
  }, [built]);

  const collapseAll = useCallback(() => {
    if (!built) {
      return;
    }
    const next: Record<string, boolean> = {};
    built.containerPaths.forEach(p => (next[p] = false));
    setOverrides(next);
  }, [built]);

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== findRef.current) {
        e.preventDefault();
        findRef.current?.focus();
      }
      if (e.key === "Escape" && document.activeElement === findRef.current) {
        setRawQuery("");
        findRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, []);

  const prettyText = parsed && "ok" in parsed ? JSON.stringify(parsed.ok.value, null, 2) : "";

  const statsLine = useMemo(() => {
    if (!parsed || "error" in parsed) {
      return "";
    }
    const { value, kind, records, ms } = parsed.ok;
    const bytes = raw === null ? 0 : new Blob([raw]).size;
    return [
      kind === "jsonl" ? `${records} records (line-delimited)` : classify(value),
      `${countNodes(value).toLocaleString()} nodes`,
      `${(bytes / 1024).toFixed(1)} KiB`,
      `parsed in ${ms.toFixed(0)} ms`,
    ].join("  ·  ");
  }, [parsed, raw]);

  const loaded = raw !== null && !fetchError;
  const hits = hitSet.size;

  return (
    <div className="json-viewer">
      <Toolbar
        path={path}
        actions={
          loaded && built ? (
            <>
              <FindBox
                inputRef={findRef}
                value={rawQuery}
                onChange={setRawQuery}
                placeholder="filter keys / values"
                hitsLabel={rawQuery ? (hits ? `${hits} ${hits === 1 ? "match" : "matches"}` : "no match") : ""}
              />
              <button className="btn" onClick={expandAll}>
                Expand
              </button>
              <button className="btn" onClick={collapseAll}>
                Collapse
              </button>
              <button className="btn" onClick={() => setView(v => (v === "tree" ? "raw" : "tree"))}>
                {view === "tree" ? "Source" : "Tree"}
              </button>
              <CopyButton text={() => prettyText} />
            </>
          ) : null
        }
      />
      {loaded && built && <div className="stats">{statsLine}</div>}
      <main>
        {fetchError && (
          <div className="error card">
            Cannot render {path}
            {"\n"}
            {fetchError}
            {"\n\n"}
            <a href={textViewUrl(path)}>Open the buffered text viewer</a>
            {"  ·  "}
            <a href={rawUrl(path)}>Raw</a>
          </div>
        )}
        {!fetchError && (
          <SizeGuard path={path} limitBytes={BIG_BYTES}>
            <JsonLoader path={path} onLoaded={handleLoaded} onError={handleError} />
            {raw === null && "Loading…"}
            {parsed && "error" in parsed && (
              <div className="error card">
                Cannot render {path}
                {"\n"}
                {parsed.error}
                {"\n\n"}
                <a href={textViewUrl(path)}>Open the buffered text viewer</a>
                {"  ·  "}
                <a href={rawUrl(path)}>Raw</a>
              </div>
            )}
            {built &&
              (view === "tree" ? (
                <div id="tree">
                  <NodeView
                    node={built.root}
                    overrides={overrides}
                    toggle={toggle}
                    needle={needle}
                    hitSet={hitSet}
                    firstHit={firstHit}
                    firstHitRef={firstHitRef}
                  />
                </div>
              ) : (
                <pre id="raw">{prettyText}</pre>
              ))}
          </SizeGuard>
        )}
      </main>
    </div>
  );
}
