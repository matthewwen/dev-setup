import { useEffect, useState } from "react";
import { apiFacets, apiTasks, type FacetsOk, type TasksOk } from "./api";
import type { Sort, TaskSummary } from "./types";
import { FindBox, useDebounced } from "../shared/FindBox";
import { useTheme } from "../app/theme";
import { formatAgo, groupByDate } from "./dates";
import "./Prompts.scss";

export function Stars({ value, onSet }: { value: number; onSet: (n: number) => void }) {
  return (
    <span className="pstars">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          className={`pstar ${n <= value ? "on" : ""}`}
          onClick={() => onSet(n === value ? 0 : n)}
          aria-label={`rated at least ${n}`}
        >
          ★
        </button>
      ))}
    </span>
  );
}

function TaskRow({ task, onOpen }: { task: TaskSummary; onOpen: (id: number) => void }) {
  return (
    <div className="trow" onClick={() => onOpen(task.id)}>
      <div className="trow-top">
        <span className="ttitle">{task.title || <span className="muted">Untitled</span>}</span>
        <span className="tstats">
          {task.avg_rating !== null ? `★ ${task.avg_rating.toFixed(1)}` : "—"}
          <span className="muted"> · {task.run_count} run{task.run_count === 1 ? "" : "s"}</span>
        </span>
      </div>
      <div className="trow-bottom">
        <span className="ttags">
          {task.tags.length ? task.tags.join(" · ") : <span className="muted">no tags</span>}
        </span>
        <span className="muted tdates">
          <span title={new Date(task.updated_at * 1000).toLocaleString()}>edited {formatAgo(task.updated_at)}</span>
          {" · "}
          <span title={new Date(task.created_at * 1000).toLocaleString()}>created {formatAgo(task.created_at)}</span>
        </span>
      </div>
      {task.best_model && (
        <div className="tbest muted">best: {task.best_model} ★{task.best_rating}</div>
      )}
    </div>
  );
}

function ModelsPanel({
  facets,
  scopeTag,
  onScopeChange,
}: {
  facets: FacetsOk | null;
  scopeTag: string;
  onScopeChange: (tag: string) => void;
}) {
  const models = facets?.models ?? [];
  const maxAvg = Math.max(1, ...models.map(m => m.avg_rating ?? 0));
  return (
    <div className="pmodels">
      <div className="pmodels-scope">
        <label>
          scope:{" "}
          <select value={scopeTag} onChange={e => onScopeChange(e.target.value)}>
            <option value="">all tags</option>
            {(facets?.tags ?? []).map(([tag]) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </label>
      </div>
      {models.length === 0 ? (
        <p className="muted">No rated runs yet.</p>
      ) : (
        <table className="mtable">
          <thead>
            <tr>
              <th>model</th><th>tasks</th><th>runs</th><th>rated</th><th>avg</th><th>★4+</th><th>bar</th>
            </tr>
          </thead>
          <tbody>
            {models.map(m => (
              <tr key={m.model}>
                <td>{m.model}</td>
                <td>{m.tasks}</td>
                <td>{m.runs}</td>
                <td>{m.rated}</td>
                <td>{m.avg_rating !== null ? m.avg_rating.toFixed(2) : "—"}</td>
                <td>{m.strong}</td>
                <td className="mbar-cell">
                  <div className="mbar" style={{ width: `${((m.avg_rating ?? 0) / maxAvg) * 100}%` }} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Library({
  tag,
  search,
  onFilterChange,
  onHome,
  onOpen,
  onNew,
}: {
  tag: string;
  search: string;
  onFilterChange: (key: string, value: string) => void;
  onHome: () => void;
  onOpen: (id: number) => void;
  onNew: () => Promise<void>;
}) {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState<"library" | "models">("library");

  const [filtersOpen, setFiltersOpen] = useState(false);
  const params = new URLSearchParams(search);
  const q = params.get("q") ?? "";
  const selectedModel = params.get("model") ?? "";
  const minRating = Math.max(0, Math.min(5, Number(params.get("rating")) || 0));
  const sortParam = params.get("sort");
  const sort: Sort = sortParam === "created" || sortParam === "title" ? sortParam : "updated";
  const debouncedQ = useDebounced(q, 60);

  const [rows, setRows] = useState<TaskSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [facets, setFacets] = useState<FacetsOk | null>(null);
  const [modelsScopeTag, setModelsScopeTag] = useState("");

  // A named function, not inlined in the effect: setLoading below runs after
  // the await, inside this function's own body, which the effect only calls
  // — the same shape Explorer.tsx uses for openDirectory.
  async function loadTasks(isCancelled: () => boolean) {
    setLoading(true);
    let res: TasksOk | { ok: false; error: string };
    try {
      res = await apiTasks({
        q: debouncedQ,
        tag,
        model: selectedModel,
        minRating: minRating || undefined,
        sort,
      });
    } catch (err) {
      if (!isCancelled()) {
        setLoading(false);
        setError(String(err));
      }
      return;
    }
    if (isCancelled()) {
      return;
    }
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      setRows([]);
      setTotal(0);
      return;
    }
    setError(null);
    setRows(res.tasks);
    setTotal(res.total);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadTasks(() => cancelled);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadTasks is a new function every render; only its own inputs should retrigger this
  }, [debouncedQ, tag, selectedModel, minRating, sort]);

  useEffect(() => {
    let cancelled = false;
    apiFacets(modelsScopeTag).then(res => {
      if (!cancelled && res.ok) {
        setFacets(res);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [modelsScopeTag]);

  const modelNames = facets?.models.map(m => m.model) ?? [];
  const dateKey = sort === "created" ? "created_at" : sort === "updated" ? "updated_at" : null;
  const groups: [string, TaskSummary[]][] = dateKey
    ? groupByDate(rows, task => task[dateKey])
    : [["", rows]];

  return (
    <div className="prompts">
      <header className="phead">
        <h1>
          <a href="/prompts/" onClick={e => { e.preventDefault(); setView("library"); onHome(); }}>Prompts</a>
          {" "}· {view === "models" ? "Models" : "Library"}
        </h1>
        <div className="pactions">
          {view === "library" && (
            <button className="btn pfilter-toggle" aria-expanded={filtersOpen} aria-controls="prompt-filters" onClick={() => setFiltersOpen(open => !open)}>
              Filters{q || tag || selectedModel || minRating ? " •" : ""}
            </button>
          )}
          {view === "library" ? (
            <>
              <button className="btn" onClick={() => onNew().catch(err => setError(String(err)))}>+ New</button>
              <button className="btn" onClick={() => setView("models")}>Models</button>
            </>
          ) : (
            <button className="btn" onClick={() => setView("library")}>Library</button>
          )}
          <a className="btn" href="/">Explorer</a>
          <button className="btn" onClick={toggleTheme}>{theme === "dark" ? "☀" : "◐"}</button>
        </div>
      </header>

      {error && <p className="error perror">{error}</p>}

      {view === "models" ? (
        <ModelsPanel facets={facets} scopeTag={modelsScopeTag} onScopeChange={setModelsScopeTag} />
      ) : (
        <div className="pbody">
          {filtersOpen && <button className="pfilter-backdrop" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />}
          <aside id="prompt-filters" className={`psidebar${filtersOpen ? " open" : ""}`} onKeyDown={e => { if (e.key === "Escape") { setFiltersOpen(false); } }}>
            <button className="btn pfilter-close" onClick={() => setFiltersOpen(false)}>Done</button>
            <FindBox value={q} onChange={value => onFilterChange("q", value)} placeholder="Search prompts" />

            <div className="pfacet">
              <h2>Tags</h2>
              {(facets?.tags ?? []).map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  className={`pchip ${tag === name ? "on" : ""}`}
                  onClick={() => onFilterChange("tag", tag === name ? "" : name)}
                >
                  {name} <span className="muted">{count}</span>
                </button>
              ))}
              {(facets?.tags ?? []).length === 0 && <p className="muted">No tags yet.</p>}
            </div>

            <div className="pfacet">
              <h2>Model</h2>
              <label className="pradio">
                <input type="radio" checked={selectedModel === ""} onChange={() => onFilterChange("model", "")} />
                any
              </label>
              {modelNames.map(name => (
                <label key={name} className="pradio">
                  <input
                    type="radio"
                    checked={selectedModel === name}
                    onChange={() => onFilterChange("model", name)}
                  />
                  {name}
                </label>
              ))}
            </div>

            <div className="pfacet">
              <h2>Rated ≥</h2>
              <Stars value={minRating} onSet={value => onFilterChange("rating", value ? String(value) : "")} />
            </div>
          </aside>

          <main className="plist">
            <div className="plist-head">
              <span className="muted">
                {loading ? "Loading…" : `${rows.length} of ${total} task${total === 1 ? "" : "s"}`}
              </span>
              <label className="psort">
                sort:{" "}
                <select value={sort} onChange={e => onFilterChange("sort", e.target.value)}>
                  <option value="updated">updated</option>
                  <option value="created">created</option>
                  <option value="title">title</option>
                </select>
              </label>
            </div>
            {rows.length === 0 && !loading ? (
              <p className="muted">
                {tag
                  ? `No tasks tagged ${tag}. Click + New to add one with this tag.`
                  : "No tasks yet. Click + New to save your first prompt."}
              </p>
            ) : (
              groups.map(([label, group]) => (
                <section key={label || "all"} className="pgroup">
                  {label && <h2 className="pgroup-head">{label}</h2>}
                  <div className="ptasks">
                    {group.map(task => (
                      <TaskRow key={task.id} task={task} onOpen={onOpen} />
                    ))}
                  </div>
                </section>
              ))
            )}
          </main>
        </div>
      )}
    </div>
  );
}
