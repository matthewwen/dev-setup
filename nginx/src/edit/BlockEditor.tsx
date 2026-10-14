import { useEffect, useRef, useState } from "react";
import type { Block } from "../markdown/render";
import { apiPatchFile } from "../shared/files-api";
import { onMarkdownKeyDown } from "./keys";
import "./Edit.css";

interface SaveError {
  message: string;
  current?: string;
}

// Edits one top-level block where it stands. `source` is the block's lines
// cut from the document the page rendered; the save sends it back as the
// text the server must still find at those lines.
export function BlockEditor({
  path,
  block,
  source,
  onSaved,
  onClose,
  onReload,
}: {
  path: string;
  block: Block;
  source: string;
  onSaved: (content: string) => void;
  onClose: () => void;
  onReload: () => void;
}) {
  const [text, setText] = useState(source);
  const [error, setError] = useState<SaveError | null>(null);
  const [busy, setBusy] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const dirty = text !== source;

  useEffect(() => {
    const el = areaRef.current;
    if (!el) {
      return;
    }
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) {
      return;
    }
    let width = -1;
    const fit = () => {
      el.style.height = "0";
      el.style.height = `${el.scrollHeight + 2}px`;
    };
    fit();
    // The portal slot joins the page after this mounts, and a resize rewraps lines.
    const obs = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        fit();
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [text]);

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

  const save = async () => {
    if (busy) {
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { status, body } = await apiPatchFile(path, { line: block.line, endLine: block.endLine, expect: source, text });
      if (body.ok) {
        onSaved(body.content);
        return;
      }
      if (status === 409 && "current" in body) {
        setError({ message: body.error, current: body.current });
      } else {
        setError({ message: body.error });
      }
    } catch (err) {
      setError({ message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (dirty && !window.confirm("Discard the change to this block?")) {
      return;
    }
    onClose();
  };

  const range = `L${block.line}${block.endLine !== block.line ? `-${block.endLine}` : ""}`;

  return (
    <div className="md-block-edit">
      <textarea
        ref={areaRef}
        className="md-block-source"
        value={text}
        spellCheck={false}
        disabled={busy}
        onChange={e => setText(e.target.value)}
        onKeyDown={onMarkdownKeyDown(() => void save(), cancel)}
      />
      {error && (
        <div className="md-block-error">
          {error.message}
          {error.current !== undefined && (
            <>
              {" "}
              <button className="rv-link" onClick={onReload}>
                Reload the document
              </button>
              <pre className="md-block-current">{error.current}</pre>
            </>
          )}
        </div>
      )}
      <div className="md-block-bar">
        <span className="md-block-range">{range}</span>
        <span className="md-block-hint">
          <kbd>Esc</kbd> cancel · <kbd>⌘S</kbd> save
        </span>
        <span className="rv-grow" />
        <button className="btn" onClick={cancel} disabled={busy}>
          Cancel
        </button>
        <button className="btn on" onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
