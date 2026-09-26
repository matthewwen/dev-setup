import { useEffect, useRef, useState } from "react";
import { apiFacets, apiPrompts, apiTask } from "./api";
import type { Run, Task } from "./types";
import { Stars } from "./Library";
import { useAutosave } from "./useAutosave";
import { CopyButton } from "../shared/CopyButton";
import { useTheme } from "../app/theme";
import "./Prompts.css";

function parseTagsClient(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const tag = part.trim();
    if (!tag) {
      continue;
    }
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(tag);
  }
  return out;
}

interface RefDraft {
  kind: "path" | "url";
  value: string;
  label: string;
}

const MD_LINK_RE = /^\[([^\]]+)\]\((\S+)\)$/;

function parseRefInput(raw: string): RefDraft {
  const trimmed = raw.trim();
  const m = MD_LINK_RE.exec(trimmed);
  const value = m ? m[2].trim() : trimmed;
  const label = m ? m[1].trim() : "";
  return { kind: value.startsWith("/") ? "path" : "url", value, label };
}

function refToInput(ref: RefDraft): string {
  return ref.label ? `[${ref.label}](${ref.value})` : ref.value;
}

function epochToDateInput(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

function dateInputToEpoch(value: string): number {
  const t = Date.parse(value);
  return Number.isNaN(t) ? Math.floor(Date.now() / 1000) : Math.floor(t / 1000);
}

function formatDate(epoch: number): string {
  return new Date(epoch * 1000).toISOString().slice(0, 10);
}

// Grows a <textarea> to fit its content instead of scrolling internally.
function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) {
    return;
  }
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function RunForm({
  initial,
  modelOptions,
  harnessOptions,
  onCancel,
  onSubmit,
}: {
  initial: { model: string; harness: string; rating: number; turns: string; notes: string; ranAt: string };
  modelOptions: string[];
  harnessOptions: string[];
  onCancel: () => void;
  onSubmit: (values: {
    model: string;
    harness: string;
    rating: number;
    turns: number | null;
    notes: string;
    ranAt: string;
  }) => Promise<void>;
}) {
  const [model, setModel] = useState(initial.model);
  const [harness, setHarness] = useState(initial.harness);
  const [rating, setRating] = useState(initial.rating);
  const [turns, setTurns] = useState(initial.turns);
  const [notes, setNotes] = useState(initial.notes);
  const [ranAt, setRanAt] = useState(initial.ranAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (!model.trim()) {
      setError("model is required");
      return;
    }
    setSaving(true);
    setError(null);
    onSubmit({
      model: model.trim(),
      harness: harness.trim(),
      rating,
      turns: turns.trim() ? Number(turns) : null,
      notes,
      ranAt,
    }).catch(err => {
      setSaving(false);
      setError(String(err));
    });
  }

  return (
    <div className="rform">
      <div className="rform-row">
        <label>
          model <input list="prompt-models" value={model} onChange={e => setModel(e.target.value)} />
        </label>
        <label>
          harness <input list="prompt-harnesses" value={harness} onChange={e => setHarness(e.target.value)} />
        </label>
      </div>
      <div className="rform-row">
        <label>
          rating <Stars value={rating} onSet={setRating} />
        </label>
        <label>
          turns{" "}
          <input
            type="number"
            min={1}
            value={turns}
            onChange={e => setTurns(e.target.value)}
            className="rform-narrow"
          />
        </label>
        <label>
          ran <input type="date" value={ranAt} onChange={e => setRanAt(e.target.value)} />
        </label>
      </div>
      <label className="rform-notes">
        notes <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="rform-actions">
        <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
        <button className="btn on" onClick={submit} disabled={saving}>Save run</button>
      </div>
      <datalist id="prompt-models">
        {modelOptions.map(m => <option key={m} value={m} />)}
      </datalist>
      <datalist id="prompt-harnesses">
        {harnessOptions.map(h => <option key={h} value={h} />)}
      </datalist>
    </div>
  );
}

function RefList({
  refs,
  onAdd,
  onUpdate,
  onDelete,
}: {
  refs: RefDraft[];
  onAdd: (raw: string) => void;
  onUpdate: (index: number, raw: string) => void;
  onDelete: (index: number) => void;
}) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingInput, setEditingInput] = useState("");
  const [newInput, setNewInput] = useState("");

  function startEdit(i: number) {
    setEditingIndex(i);
    setEditingInput(refToInput(refs[i]));
  }

  function commitEdit() {
    if (editingIndex === null) {
      return;
    }
    if (editingInput.trim()) {
      onUpdate(editingIndex, editingInput);
    }
    setEditingIndex(null);
  }

  function submitNew() {
    if (!newInput.trim()) {
      return;
    }
    onAdd(newInput);
    setNewInput("");
  }

  return (
    <ul className="preflist">
      {refs.map((ref, i) =>
        editingIndex === i ? (
          <li key={i} className="pref-editing">
            <input
              value={editingInput}
              onChange={e => setEditingInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") {
                  commitEdit();
                } else if (e.key === "Escape") {
                  setEditingIndex(null);
                }
              }}
              onBlur={commitEdit}
              autoFocus
            />
          </li>
        ) : (
          <li key={i}>
            {ref.kind === "path" ? (
              <a href={ref.value}>📁 {ref.label || ref.value}</a>
            ) : (
              <a href={ref.value} target="_blank" rel="noreferrer">🔗 {ref.label || ref.value}</a>
            )}
            <span className="pref-actions">
              <button className="btn" onClick={() => startEdit(i)} aria-label="Edit reference">✎</button>
              <button className="btn" onClick={() => onDelete(i)} aria-label="Delete reference">✕</button>
            </span>
          </li>
        ),
      )}
      <li className="pref-add">
        <input
          value={newInput}
          onChange={e => setNewInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") {
              submitNew();
            }
          }}
          placeholder="Add a path, a URL, or [label](url)"
        />
        <button className="btn" onClick={submitNew}>+ Add</button>
      </li>
    </ul>
  );
}

function RunRow({ run, onEdit, onDelete }: { run: Run; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr>
      <td>{run.model}</td>
      <td className="muted">{run.harness || "—"}</td>
      <td>{run.rating ? "★".repeat(run.rating) + "☆".repeat(5 - run.rating) : <span className="muted">—</span>}</td>
      <td>{run.turns ?? <span className="muted">—</span>}</td>
      <td className="muted">{formatDate(run.ran_at)}</td>
      <td className="rnotes">{run.notes || <span className="muted">—</span>}</td>
      <td className="ractions">
        <button className="btn" onClick={onEdit} aria-label="Edit run">✎</button>
        <button className="btn" onClick={onDelete} aria-label="Delete run">✕</button>
      </td>
    </tr>
  );
}

export function Detail({ taskId, onBack }: { taskId: number; onBack: () => void }) {
  const [theme, toggleTheme] = useTheme();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<string[]>([]);

  const [title, setTitle] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [notesText, setNotesText] = useState("");
  const [refs, setRefs] = useState<RefDraft[]>([]);
  const [refsError, setRefsError] = useState<string | null>(null);

  const [runForm, setRunForm] = useState<"closed" | "new" | number>("closed");
  // Computed once via the lazy initializer rather than at render time, so a
  // fresh "ran" default does not count as an impure call during render.
  const [today] = useState(() => epochToDateInput(Math.floor(Date.now() / 1000)));

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // A named function, not inlined in the effect: setLoading below runs after
  // the await, inside this function's own body, which the effect only calls
  // — the same shape Explorer.tsx uses for openDirectory.
  async function loadTask(id: number, isCancelled: () => boolean) {
    setLoading(true);
    const res = await apiTask(id);
    if (isCancelled()) {
      return;
    }
    setLoading(false);
    if (!res.ok) {
      setLoadError(res.error);
      return;
    }
    const t = res.task;
    setTask(t);
    setTitle(t.title);
    setTagsText(t.tags.join(", "));
    setPromptText(t.prompt);
    setNotesText(t.notes);
    setRefs(t.refs.map(r => ({ kind: r.kind, value: r.value, label: r.label })));
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadTask(taskId, () => cancelled);
    })();
    apiFacets().then(res => {
      if (!cancelled && res.ok) {
        setModelOptions(res.models.map(m => m.model));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  useEffect(() => {
    if (promptExpanded) {
      autoGrow(promptRef.current);
    } else {
      promptRef.current?.style.removeProperty("height");
    }
  }, [promptText, promptExpanded]);
  useEffect(() => autoGrow(notesRef.current), [notesText]);

  async function saveField(field: string, value: unknown) {
    const res = await apiPrompts("task.update", { id: taskId, [field]: value });
    if (!res.ok) {
      throw new Error(res.error);
    }
    if (res.task) {
      const t = res.task;
      setTask(prev => (prev ? { ...prev, created_at: t.created_at, updated_at: t.updated_at } : t));
    }
  }

  const titleAuto = useAutosave(title, v => saveField("title", v));
  const promptAuto = useAutosave(promptText, v => saveField("prompt", v));
  const notesAuto = useAutosave(notesText, v => saveField("notes", v));
  const tagsAuto = useAutosave(tagsText, v => saveField("tags", parseTagsClient(v)));

  const autosaves = [titleAuto, promptAuto, notesAuto, tagsAuto];
  const anySaving = autosaves.some(a => a.status === "saving");
  const firstError = autosaves.find(a => a.status === "error");
  const lastSavedAt = Math.max(0, ...autosaves.map(a => a.at ?? 0));

  async function persistRefs(next: RefDraft[]) {
    setRefs(next);
    const res = await apiPrompts("task.update", { id: taskId, refs: next });
    if (!res.ok) {
      setRefsError(res.error);
      return;
    }
    setRefsError(null);
    const t = res.task;
    if (t) {
      setRefs(t.refs.map(r => ({ kind: r.kind, value: r.value, label: r.label })));
      setTask(prev => (prev ? { ...prev, updated_at: t.updated_at } : t));
    }
  }

  function addRef(raw: string) {
    persistRefs([...refs, parseRefInput(raw)]);
  }

  function updateRef(index: number, raw: string) {
    persistRefs(refs.map((r, i) => (i === index ? parseRefInput(raw) : r)));
  }

  function deleteRef(index: number) {
    persistRefs(refs.filter((_, i) => i !== index));
  }

  async function deleteTask() {
    if (!window.confirm("Delete this task and all of its runs?")) {
      return;
    }
    const res = await apiPrompts("task.delete", { id: taskId });
    if (res.ok) {
      onBack();
    }
  }

  async function submitRun(values: {
    model: string;
    harness: string;
    rating: number;
    turns: number | null;
    notes: string;
    ranAt: string;
  }) {
    const op = typeof runForm === "number" ? "run.update" : "run.create";
    const body: Record<string, unknown> = {
      task_id: taskId,
      model: values.model,
      harness: values.harness,
      rating: values.rating || null,
      turns: values.turns,
      notes: values.notes,
      ran_at: dateInputToEpoch(values.ranAt),
    };
    if (typeof runForm === "number") {
      body.id = runForm;
    }
    const res = await apiPrompts(op, body);
    if (!res.ok) {
      throw new Error(res.error);
    }
    if (res.task) {
      setTask(res.task);
    }
    setRunForm("closed");
  }

  async function deleteRun(runId: number) {
    if (!window.confirm("Delete this run?")) {
      return;
    }
    const res = await apiPrompts("run.delete", { id: runId, task_id: taskId });
    if (res.ok && res.task) {
      setTask(res.task);
    }
  }

  if (loading) {
    return (
      <div className="prompts">
        <p className="muted" style={{ padding: 20 }}>Loading…</p>
      </div>
    );
  }
  if (loadError || !task) {
    return (
      <div className="prompts">
        <p className="error" style={{ padding: 20 }}>{loadError || "Task not found"}</p>
        <button className="btn" onClick={onBack} style={{ marginLeft: 20 }}>Back to library</button>
      </div>
    );
  }

  const harnessOptions = [...new Set(task.runs.map(r => r.harness).filter(Boolean))];
  const statusText = anySaving
    ? "saving…"
    : firstError
      ? `error: ${firstError.error}`
      : lastSavedAt > 0
        ? `saved ${new Date(lastSavedAt).toLocaleTimeString()}`
        : "new · unsaved";

  const runInitial = (run?: Run) => ({
    model: run?.model ?? "",
    harness: run?.harness ?? "",
    rating: run?.rating ?? 0,
    turns: run?.turns != null ? String(run.turns) : "",
    notes: run?.notes ?? "",
    ranAt: run ? epochToDateInput(run.ran_at) : today,
  });

  return (
    <div className="prompts pdetail">
      <header className="phead">
        <h1>
          <a href="/prompts/" onClick={e => { e.preventDefault(); onBack(); }}>Prompts</a> › #{task.id}
        </h1>
        <span className={`pstatus ${firstError ? "error" : ""}`}>{statusText}</span>
        <div className="pactions">
          <button className="btn" onClick={onBack}>Library</button>
          <a className="btn" href="/">Explorer</a>
          <CopyButton text={() => promptText} label="Copy prompt" />
          <button className="btn" onClick={deleteTask}>Delete</button>
          <button className="btn" onClick={toggleTheme}>{theme === "dark" ? "☀" : "◐"}</button>
        </div>
      </header>

      <main className="pdetail-body">
        <label className="pfield">
          <span className="plabel">Title</span>
          <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => titleAuto.flush()} />
        </label>
        <label className="pfield">
          <span className="plabel">Tags</span>
          <input value={tagsText} onChange={e => setTagsText(e.target.value)} onBlur={() => tagsAuto.flush()} />
        </label>
        <p className="muted pmeta">
          created {formatDate(task.created_at)} · updated {formatDate(task.updated_at)} · {promptText.length.toLocaleString()} chars
        </p>

        <label className="pfield">
          <span className="plabel prompt-label">
            Prompt
            <button
              className="btn prompt-toggle"
              type="button"
              onClick={() => setPromptExpanded(expanded => !expanded)}
              aria-expanded={promptExpanded}
            >
              {promptExpanded ? "Minimize" : "Expand"}
            </button>
          </span>
          <textarea
            ref={promptRef}
            className={`pgrow${promptExpanded ? "" : " prompt-minimized"}`}
            value={promptText}
            onChange={e => setPromptText(e.target.value)}
            onBlur={() => promptAuto.flush()}
            autoFocus={!task.prompt}
            rows={6}
          />
        </label>

        <label className="pfield">
          <span className="plabel">Notes <span className="muted">markdown</span></span>
          <textarea
            ref={notesRef}
            className="pgrow"
            value={notesText}
            onChange={e => setNotesText(e.target.value)}
            onBlur={() => notesAuto.flush()}
            rows={3}
          />
        </label>

        <div className="pfield">
          <span className="plabel">References</span>
          <RefList refs={refs} onAdd={addRef} onUpdate={updateRef} onDelete={deleteRef} />
          {refsError && <p className="error">{refsError}</p>}
        </div>

        <section className="pruns">
          <div className="pruns-head">
            <h2>Runs ({task.runs.length})</h2>
            <button className="btn" onClick={() => setRunForm("new")}>+ Add run</button>
          </div>
          {task.runs.length > 0 && (
            <table className="rtable">
              <thead>
                <tr>
                  <th>model</th><th>harness</th><th>rating</th><th>turns</th><th>ran</th><th>notes</th><th />
                </tr>
              </thead>
              <tbody>
                {task.runs.map(run => (
                  <RunRow
                    key={run.id}
                    run={run}
                    onEdit={() => setRunForm(run.id)}
                    onDelete={() => deleteRun(run.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
          {runForm !== "closed" && (
            <RunForm
              initial={runInitial(typeof runForm === "number" ? task.runs.find(r => r.id === runForm) : undefined)}
              modelOptions={modelOptions}
              harnessOptions={harnessOptions}
              onCancel={() => setRunForm("closed")}
              onSubmit={submitRun}
            />
          )}
        </section>
      </main>
    </div>
  );
}
