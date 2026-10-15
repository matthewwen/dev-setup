import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Markdown } from "../markdown/Markdown";
import { apiReadFile, apiWriteFile, type FileOk } from "../shared/files-api";
import { onMarkdownKeyDown } from "./keys";
import { readSpell, writeSpell } from "./spell";
import "./Edit.css";

const PREVIEW_DELAY_MS = 300;
const SPLIT_KEY = "md-edit-split";
const MIN_SPLIT = 15;
const MAX_SPLIT = 85;

interface SaveError {
  message: string;
  conflict?: string;
}

function readSplit(): number {
  const n = Number(localStorage.getItem(SPLIT_KEY));
  return n >= MIN_SPLIT && n <= MAX_SPLIT ? n : 50;
}

// Edits the whole source, text above and preview below. The save sends the
// hash from the read, so a change made on disk in the meantime stops the save
// instead of being overwritten.
export function DocEditor({ path, onSaved, onClose }: { path: string; onSaved: (text: string) => void; onClose: () => void }) {
  const [base, setBase] = useState<FileOk | null>(null);
  const [text, setText] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(() => localStorage.getItem("md-edit-preview") !== "0");
  const [previewSrc, setPreviewSrc] = useState("");
  const [split, setSplit] = useState(readSplit);
  const [spell, setSpell] = useState(readSpell);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const panesRef = useRef<HTMLDivElement>(null);

  const dirty = base !== null && text !== base.content;

  const load = () =>
    apiReadFile(path)
      .then(r => {
        if (!r.ok) {
          setLoadError(r.error);
          return;
        }
        setBase(r);
        setText(r.content);
        setPreviewSrc(r.content);
        setSaveError(null);
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));

  useEffect(() => {
    let current = true;
    apiReadFile(path)
      .then(r => {
        if (!current) {
          return;
        }
        if (!r.ok) {
          setLoadError(r.error);
          return;
        }
        setBase(r);
        setText(r.content);
        setPreviewSrc(r.content);
        areaRef.current?.focus({ preventScroll: true });
      })
      .catch(err => {
        if (current) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      current = false;
    };
  }, [path]);

  useEffect(() => {
    if (!preview) {
      return;
    }
    const timer = window.setTimeout(() => setPreviewSrc(text), PREVIEW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, preview]);

  useEffect(() => {
    if (!dirty) {
      return;
    }
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async (ifMatch?: string) => {
    if (!base || busy) {
      return;
    }
    if (!dirty && ifMatch === undefined) {
      onClose();
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      const { status, body } = await apiWriteFile(path, text, ifMatch ?? base.sha256);
      if (body.ok) {
        onSaved(text);
        return;
      }
      if (status === 409 && "sha256" in body) {
        setSaveError({ message: body.error, conflict: body.sha256 });
      } else {
        setSaveError({ message: body.error });
      }
    } catch (err) {
      setSaveError({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm("Discard the unsaved changes?")) {
      return;
    }
    onClose();
  };

  const togglePreview = () => {
    setPreview(on => {
      localStorage.setItem("md-edit-preview", on ? "0" : "1");
      return !on;
    });
  };

  const toggleSpell = () => {
    setSpell(on => {
      writeSpell(!on);
      return !on;
    });
  };

  const startDrag = (e: PointerEvent<HTMLDivElement>) => {
    const panes = panesRef.current;
    if (!panes) {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: globalThis.PointerEvent) => {
      const box = panes.getBoundingClientRect();
      const pct = ((ev.clientY - box.top) / box.height) * 100;
      setSplit(Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, pct)));
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      setSplit(v => {
        localStorage.setItem(SPLIT_KEY, String(Math.round(v)));
        return v;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  return (
    <div className="md-doc-edit">
      <div className="md-doc-bar">
        <span className="md-doc-status">
          {loadError ? <span className="error">{loadError}</span> : busy ? "Saving…" : dirty ? "Unsaved changes" : "Editing"}
        </span>
        <span className="md-block-hint">
          <kbd>Esc</kbd> cancel · <kbd>⌘S</kbd> save
        </span>
        <button className={`btn${spell ? " on" : ""}`} onClick={toggleSpell} title="Toggle spell check">
          Spell
        </button>
        <button className={`btn${preview ? " on" : ""}`} onClick={togglePreview} title="Toggle live preview">
          Preview
        </button>
        <button className="btn" onClick={cancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn on" onClick={() => void save()} disabled={!base || busy || !dirty}>
          Save
        </button>
      </div>
      {saveError && (
        <div className="md-block-error">
          {saveError.message}
          {saveError.conflict !== undefined && (
            <>
              {" "}
              <button className="rv-link" onClick={() => void load()}>
                Reload from disk
              </button>
              {" · "}
              <button className="rv-link danger" onClick={() => void save(saveError.conflict)}>
                Overwrite
              </button>
            </>
          )}
        </div>
      )}
      <div ref={panesRef} className="md-doc-panes">
        <textarea
          ref={areaRef}
          className="md-doc-source"
          style={preview ? { flex: `0 0 ${split}%` } : undefined}
          value={text}
          spellCheck={spell}
          disabled={base === null}
          onChange={e => setText(e.target.value)}
          onKeyDown={onMarkdownKeyDown(() => void save(), cancel)}
        />
        {preview && (
          <>
            <div className="md-doc-handle" onPointerDown={startDrag} title="Drag to resize" />
            <div className="md-doc-preview">
              <Markdown src={previewSrc} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
