import { useEffect, useMemo, useRef, useState } from "react";
import { apiList, apiSearch, type Entry, type ListResponse, type SearchResponse, type TreeLevel } from "./api";
import { readRoute, writeRoute, usePopState, type SearchOptions as RouteSearchOptions } from "./useRouting";
import { Directory, sortEntries, type Sort, type SortKey } from "./Directory";
import { Tree } from "./Tree";
import { SearchOptionsBar, SearchResults, type SearchOptionsValue } from "./Search";
import { Preview, type PreviewTarget } from "./Preview";
import { useKeys } from "./useKeys";
import { matchRegex } from "./highlight";
import { opensInPreview, previewable } from "./format";
import { useDebounced } from "../../shared/FindBox";
import "./Explorer.css";

const CACHE_TTL_MS = 10000;

function Crumbs({ path, onGo }: { path: string; onGo: (path: string) => void }) {
  const parts = path.split("/").filter(Boolean);
  return (
    <div id="crumbs">
      <a
        href="#"
        onClick={e => {
          e.preventDefault();
          onGo("/");
        }}
      >
        webroot
      </a>
      {parts.map((name, i) => {
        const target = `/${parts.slice(0, i + 1).join("/")}`;
        const isLast = i === parts.length - 1;
        return (
          <span key={target}>
            <span> / </span>
            {isLast ? (
              <b>{name}</b>
            ) : (
              <a
                href="#"
                onClick={e => {
                  e.preventDefault();
                  onGo(target);
                }}
              >
                {name}
              </a>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function Explorer() {
  const [path, setPath] = useState("/");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [counts, setCounts] = useState({ dirs: 0, files: 0 });
  const [treeLevels, setTreeLevels] = useState<TreeLevel[] | undefined>(undefined);
  const [ripgrepMissing, setRipgrepMissing] = useState(false);
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const [view, setView] = useState<"list" | "results">("list");
  const [selected, setSelected] = useState(-1);
  const [offline, setOffline] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // The URL at page load seeds the query and the search options.
  const [initialRoute] = useState(readRoute);
  const [qInput, setQInput] = useState(initialRoute.search.q);
  const filter = useDebounced(qInput, 60);
  const [showHidden, setShowHidden] = useState(false);
  const [searchOpts, setSearchOpts] = useState<SearchOptionsValue>(() => {
    const { mode, here, glob, regex, case: caseSensitive } = initialRoute.search;
    return { mode, here, glob, regex, case: caseSensitive };
  });
  const [searchData, setSearchData] = useState<SearchResponse | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [treeHidden, setTreeHidden] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const qInputRef = useRef<HTMLInputElement>(null);
  const listCacheRef = useRef<Map<string, { data: ListResponse & { ok: true }; at: number }>>(new Map());
  const prefetchTimerRef = useRef<number>(0);

  // Memoized: useChunked restarts its chunked paint whenever the array
  // identity changes, so a fresh array on every render never finishes.
  const rows = useMemo(() => sortEntries(entries, showHidden, filter, sort), [entries, showHidden, filter, sort]);
  const rowsLen = view === "list" ? rows.length : searchData && searchData.ok ? searchData.results.length : 0;

  function entryAt(i: number): PreviewTarget | null {
    if (view === "list") {
      const e = rows[i];
      return e ? { url: e.url, name: e.name, isDir: e.type === "dir" } : null;
    }
    const r = searchData && searchData.ok ? searchData.results[i] : undefined;
    return r ? { url: r.url, name: r.name, isDir: false } : null;
  }

  // The preview always shows the selected row, so it is derived, not stored.
  const previewTarget = previewOpen ? entryAt(selected) : null;

  async function fetchListing(p: string, opts: { force?: boolean } = {}) {
    const key = `${p}|tree`;
    const hit = listCacheRef.current.get(key);
    if (hit && !opts.force && Date.now() - hit.at < CACHE_TTL_MS) {
      return hit.data;
    }
    const data = await apiList(p, { tree: true });
    if (data.ok) {
      listCacheRef.current.set(key, { data, at: Date.now() });
    }
    return data;
  }

  function prefetch(p: string) {
    window.clearTimeout(prefetchTimerRef.current);
    prefetchTimerRef.current = window.setTimeout(() => {
      const key = `${p}|tree`;
      if (!listCacheRef.current.has(key)) {
        fetchListing(p).catch(() => {});
      }
    }, 120);
  }

  async function openDirectory(target: string, opts: { force?: boolean; replace?: boolean; keepQuery?: boolean } = {}) {
    const push = !opts.replace;
    const normalized = decodeURIComponent(target).replace(/\/+$/, "") || "/";
    if (!opts.keepQuery) {
      setQInput("");
    }
    let data: ListResponse;
    try {
      data = await fetchListing(normalized, { force: opts.force });
    } catch {
      setOffline(true);
      return;
    }
    if (!data.ok) {
      setOffline(false);
      setListError(data.error || "cannot list");
      return;
    }
    setOffline(false);
    setListError(null);
    setView("list");
    setSelected(-1);
    setPath(normalized);
    setEntries(data.entries);
    setCounts({ dirs: data.dirs, files: data.files });
    setParent(data.parent);
    setTreeLevels(data.tree);
    setRipgrepMissing(data.ripgrep === false);
    writeRoute(normalized, null, push);
  }

  async function performSearch(scopePath: string, q: string, opts: SearchOptionsValue, push: boolean) {
    if (!q) {
      await openDirectory(scopePath);
      return;
    }
    setView("results");
    setSelected(-1);
    setSearchQuery(q);
    const routeSearch: RouteSearchOptions = { q, mode: opts.mode, here: opts.here, glob: opts.glob, regex: opts.regex, case: opts.case };
    writeRoute(scopePath, routeSearch, push);
    let data: SearchResponse;
    try {
      data = await apiSearch({
        q,
        mode: opts.mode,
        scope: opts.here && scopePath !== "/" ? scopePath : undefined,
        glob: opts.glob.trim() || undefined,
        regex: opts.regex,
        case: opts.case,
      });
    } catch {
      setOffline(true);
      return;
    }
    setOffline(false);
    if (!data.ok && data.error === "search service is unreachable") {
      setOffline(true);
      return;
    }
    if (!data.ok) {
      setListError(data.error || "search failed");
    } else {
      setListError(null);
    }
    setSearchData(data);
  }

  function runSearch(opts: { replace?: boolean } = {}) {
    performSearch(path, qInput.trim(), searchOpts, !opts.replace);
  }

  function updateSearchOpts(next: SearchOptionsValue) {
    setSearchOpts(next);
    if (view === "results") {
      performSearch(path, qInput.trim(), next, true);
    }
  }

  // Startup: open the directory, and search when the URL carried a query. The
  // query and options state already hold the URL values from useState.
  useEffect(() => {
    const route = initialRoute;
    (async () => {
      await openDirectory(route.path, { keepQuery: true, replace: true });
      if (route.search.q) {
        await performSearch(route.path, route.search.q, route.search, false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount; openDirectory and performSearch are new functions each render
  }, []);

  usePopState(() => {
    const route = readRoute();
    setQInput(route.search.q);
    setSearchOpts({ mode: route.search.mode, here: route.search.here, glob: route.search.glob, regex: route.search.regex, case: route.search.case });
    if (route.search.q) {
      performSearch(route.path, route.search.q, route.search, false);
    } else {
      openDirectory(route.path, { replace: true });
    }
  });

  function selectMove(i: number) {
    if (!rowsLen) {
      return;
    }
    setSelected(Math.max(0, Math.min(i, rowsLen - 1)));
  }

  function activate(i: number) {
    if (!rowsLen) {
      return;
    }
    const clamped = Math.max(0, Math.min(i, rowsLen - 1));
    setSelected(clamped);
    const e = entryAt(clamped);
    if (!e) {
      return;
    }
    if (e.isDir) {
      openDirectory(e.url);
      return;
    }
    // With the pane open, the new selection above already moves the preview.
    if (previewOpen) {
      return;
    }
    if (opensInPreview(e.url)) {
      setPreviewOpen(true);
      return;
    }
    location.href = previewable(e.url) ? e.url : `${e.url}?raw=1`;
  }

  function togglePreview() {
    setPreviewOpen(open => !open);
  }

  useKeys({
    focusSearch: () => {
      qInputRef.current?.focus();
      qInputRef.current?.select();
    },
    moveSelection: d => {
      if (d === "start") {
        selectMove(0);
      } else if (d === "end") {
        selectMove(1e9);
      } else {
        selectMove(selected + d);
      }
    },
    activateSelected: () => activate(selected < 0 ? 0 : selected),
    goUp: () => {
      if (parent !== null) {
        openDirectory(parent);
      }
    },
    togglePreview,
    refresh: () => {
      listCacheRef.current.clear();
      openDirectory(path, { force: true, replace: true });
    },
    onEscape: () => {
      if (view === "results") {
        setQInput("");
        openDirectory(path);
      } else {
        setPreviewOpen(false);
      }
    },
  });

  const rx = view === "results" ? matchRegex(searchQuery, searchOpts.regex, searchOpts.case) : null;

  const statusText =
    offline
      ? "offline"
      : view === "list"
        ? [
            `${counts.dirs} dir${counts.dirs === 1 ? "" : "s"}`,
            `${counts.files} file${counts.files === 1 ? "" : "s"}`,
            filter ? `${rows.length} shown` : "",
            ripgrepMissing ? "ripgrep missing: content search unavailable" : "",
          ]
            .filter(Boolean)
            .join("  ·  ")
        : searchData && searchData.ok
          ? [
              `${searchData.count} ${searchData.count === 1 ? "file" : "files"}`,
              `${searchData.matches} ${searchData.matches === 1 ? "match" : "matches"}`,
              `in ${searchData.scope}`,
              `${searchData.took_ms} ms`,
              searchData.truncated ? "truncated" : "",
            ]
              .filter(Boolean)
              .join("  ·  ")
          : "searching…";

  return (
    <div className="explorer">
      <header>
        <div className="row">
          <button className="btn" onClick={() => setTreeHidden(h => !h)} title="Toggle the tree">
            &#9776;
          </button>
          <button className="btn" onClick={() => parent !== null && openDirectory(parent)} title="Parent directory">
            &#8593;
          </button>
          <Crumbs path={path} onGo={openDirectory} />
          <button className={previewOpen ? "btn on" : "btn"} onClick={togglePreview} title="Preview pane (p)">
            Preview
          </button>
          <ThemeButton />
          <a className="btn" href="/prompts/" title="Saved prompts and model runs">
            Prompts
          </a>
          <a className="btn" href={`/__raw${path === "/" ? "/" : `${path}/`}`} title="Plain nginx index and raw bytes">
            Raw
          </a>
        </div>
        <div className="row row2">
          <input
            id="q"
            ref={qInputRef}
            type="search"
            placeholder="Filter this directory — press Enter to search contents"
            spellCheck={false}
            value={qInput}
            onChange={e => setQInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch();
              }
              if (e.key === "Escape") {
                setQInput("");
                qInputRef.current?.blur();
                openDirectory(path);
              }
            }}
          />
          <SearchOptionsBar value={searchOpts} onChange={updateSearchOpts} />
          <label className="chk">
            <input type="checkbox" checked={showHidden} onChange={e => setShowHidden(e.target.checked)} />
            hidden
          </label>
          <span className="spacer" />
        </div>
      </header>

      <main>
        <Tree currentPath={path} levels={treeLevels} hidden={treeHidden} onOpen={openDirectory} onPrefetch={prefetch} />
        <section id="list">
          {offline && (
            <div className="card error">
              The explorer service is not running.
              <pre>nginx/scripts/explorer.sh start</pre>
            </div>
          )}
          {!offline && listError && <div className="card error">{listError}</div>}
          {!offline &&
            !listError &&
            (view === "list" ? (
              <Directory
                rows={rows}
                filter={filter}
                hasParent={parent !== null}
                sort={sort}
                onSort={(key: SortKey) =>
                  setSort(s => ({ key, dir: (s.key === key ? -s.dir : key === "name" ? 1 : -1) as 1 | -1 }))
                }
                selected={selected}
                onActivateRow={activate}
                onUp={() => parent !== null && openDirectory(parent)}
                onHoverDir={prefetch}
              />
            ) : searchData && searchData.ok ? (
              <SearchResults data={searchData} query={searchQuery} rx={rx} selected={selected} onSelectFile={selectMove} />
            ) : null)}
        </section>
        <Preview open={previewOpen} target={previewTarget} onClose={togglePreview} />
      </main>

      <footer>
        <span id="status">{statusText}</span>
        <span className="spacer" />
        <span className="hint">
          <kbd>/</kbd> search &middot; <kbd>j</kbd>
          <kbd>k</kbd> move &middot; <kbd>Enter</kbd> open &middot; <kbd>p</kbd> preview &middot; <kbd>u</kbd> up &middot; <kbd>r</kbd> refresh
          &middot; <kbd>Esc</kbd> clear
        </span>
      </footer>
    </div>
  );
}

function ThemeButton() {
  return (
    <button
      className="btn"
      title="Theme"
      onClick={() => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("md-theme", next);
      }}
    >
      &#9788;
    </button>
  );
}
