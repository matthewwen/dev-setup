import { useEffect, useState } from "react";
import { apiFacets, apiTasks, type FacetsOk, type TasksOk } from "./api";
import type { Sort, TaskSummary } from "./types";
import { FindBox, useDebounced } from "../shared/FindBox";
import { useTheme } from "../app/theme";
import "./Prompts.css";

function formatAgo(unixSeconds: number): string {
  const mins = Math.floor((Date.now() - unixSeconds * 1000) / 60000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

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
        <span className="muted">{formatAgo(task.updated_at)}</span>
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
  onOpen,
  onNew,
}: {
  onOpen: (id: number) => void;
  onNew: () => Promise<void>;
}) {
  const [theme, toggleTheme] = useTheme();
  const [view, setView] = useState<"library" | "models">("library");

  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 60);
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [sort, setSort] = useState<Sort>("updated");

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
        tag: selectedTag,
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
  }, [debouncedQ, selectedTag, selectedModel, minRating, sort]);

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

  return (
    <div className="prompts">
      <header className="phead">
        <h1>
          <a href="/prompts/" onClick={e => { e.preventDefault(); setView("library"); }}>Prompts</a>
          {" "}· {view === "models" ? "Models" : "Library"}
        </h1>
        <div className="pactions">
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
          <aside className="psidebar">
            <FindBox value={q} onChange={setQ} placeholder="Search prompts" />

            <div className="pfacet">
              <h2>Tags</h2>
              {(facets?.tags ?? []).map(([tag, count]) => (
                <button
                  key={tag}
                  type="button"
                  className={`pchip ${selectedTag === tag ? "on" : ""}`}
                  onClick={() => setSelectedTag(selectedTag === tag ? "" : tag)}
                >
                  {tag} <span className="muted">{count}</span>
                </button>
              ))}
              {(facets?.tags ?? []).length === 0 && <p className="muted">No tags yet.</p>}
            </div>

            <div className="pfacet">
              <h2>Model</h2>
              <label className="pradio">
                <input type="radio" checked={selectedModel === ""} onChange={() => setSelectedModel("")} />
                any
              </label>
              {modelNames.map(name => (
                <label key={name} className="pradio">
                  <input
                    type="radio"
                    checked={selectedModel === name}
                    onChange={() => setSelectedModel(name)}
                  />
                  {name}
                </label>
              ))}
            </div>

            <div className="pfacet">
              <h2>Rated ≥</h2>
              <Stars value={minRating} onSet={setMinRating} />
            </div>
          </aside>

          <main className="plist">
            <div className="plist-head">
              <span className="muted">
                {loading ? "Loading…" : `${rows.length} of ${total} task${total === 1 ? "" : "s"}`}
              </span>
              <label className="psort">
                sort:{" "}
                <select value={sort} onChange={e => setSort(e.target.value as Sort)}>
                  <option value="updated">updated</option>
                  <option value="rating">rating</option>
                  <option value="title">title</option>
                </select>
              </label>
            </div>
            {rows.length === 0 && !loading ? (
              <p className="muted">No tasks yet. Click + New to save your first prompt.</p>
            ) : (
              <div className="ptasks">
                {rows.map(task => (
                  <TaskRow key={task.id} task={task} onOpen={onOpen} />
                ))}
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
