import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Action, ReviewComment, ReviewOp } from "../shared/review-api";
import type { ReviewState } from "./useReview";
import { ACTION_LABELS, excerpt, groupComments, lineLabel, relativeTime } from "./model";
import "./Review.css";

// What the composer comments on: a block (optionally a phrase inside it),
// or the whole document when `line` is null.
export interface Draft {
  line: number | null;
  endLine: number;
  text: string;
  selection?: string;
}

// Cmd/Ctrl+Enter submits and Escape cancels, in every text box the panel owns.
function keys(submit: () => void, cancel: () => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };
}

function Composer({ draft, review, onDone }: { draft: Draft; review: ReviewState; onDone: (stale: boolean) => void }) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, [draft]);

  const submit = async () => {
    if (!body.trim() || busy) {
      return;
    }
    setBusy(true);
    const anchor = draft.line === null ? null : { line: draft.line, endLine: draft.endLine, text: draft.text, selection: draft.selection };
    const err = await review.post({ op: "comment", body, anchor });
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    onDone(false);
  };

  const stale = error?.includes("document changed") ?? false;

  return (
    <div className="rv-composer">
      <div className="rv-target">
        {draft.line === null ? "Note on the whole document" : `L${draft.line}${draft.endLine !== draft.line ? `-${draft.endLine}` : ""}`}
      </div>
      {draft.line !== null && <blockquote className="rv-quote">{excerpt(draft.selection ?? draft.text, 240)}</blockquote>}
      <textarea
        ref={ref}
        value={body}
        rows={4}
        placeholder="Leave a comment"
        onChange={e => setBody(e.target.value)}
        onKeyDown={keys(submit, () => onDone(false))}
      />
      {error && (
        <div className="rv-error">
          {error}
          {stale && (
            <>
              {" "}
              <button className="rv-link" onClick={() => onDone(true)}>
                Reload the document
              </button>
            </>
          )}
        </div>
      )}
      <div className="rv-row">
        <span className="rv-grow" />
        <button className="btn" onClick={() => onDone(false)}>
          Cancel
        </button>
        <button className="btn on" disabled={!body.trim() || busy} onClick={submit} title="Ctrl+Enter">
          Comment
        </button>
      </div>
    </div>
  );
}

function Card({ c, review, active, onPick }: { c: ReviewComment; review: ReviewState; active: boolean; onPick: (c: ReviewComment) => void }) {
  const [mode, setMode] = useState<"idle" | "reply" | "resolve">("idle");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (op: ReviewOp) => {
    setBusy(true);
    const err = await review.post(op);
    setBusy(false);
    setError(err);
    if (!err) {
      setMode("idle");
      setReply("");
    }
  };
  const sendReply = () => {
    if (reply.trim()) {
      void run({ op: "reply", id: c.id, body: reply });
    }
  };
  const resolve = (action: Action) => run({ op: "status", id: c.id, status: "resolved", action });
  const remove = () => {
    if (window.confirm("Delete this comment? The agent will no longer see it.")) {
      void run({ op: "delete", id: c.id });
    }
  };

  const conf = c.resolved.confidence;
  const quote = c.anchor.selection ?? c.anchor.quote;
  const resolved = c.status === "resolved";

  return (
    <div id={`rv-${c.id}`} className={`rv-card${active ? " active" : ""}${resolved ? " resolved" : ""}`}>
      <div className="rv-meta" onClick={() => onPick(c)} title={conf === "orphan" || conf === "document" ? undefined : "Show in the document"}>
        <b>{c.author}</b>
        <span className="muted" title={c.ts}>
          {relativeTime(c.ts)}
        </span>
        <span className="rv-grow" />
        {lineLabel(c) && <span className="rv-line">{lineLabel(c)}</span>}
        {(conf === "moved" || conf === "quote") && (
          <span className={`rv-badge ${conf}`} title={conf === "moved" ? "The block moved since the comment" : "The block changed; matched by its text"}>
            {conf}
          </span>
        )}
        {resolved && c.action && <span className={`rv-badge ${c.action}`}>{ACTION_LABELS[c.action]}</span>}
      </div>
      {quote && <blockquote className="rv-quote">{excerpt(quote, 200)}</blockquote>}
      <div className="rv-body">{c.body}</div>
      {c.replies.map((r, i) => (
        <div key={i} className="rv-reply">
          <div className="rv-meta">
            <b>{r.author}</b>
            <span className="muted" title={r.ts}>
              {relativeTime(r.ts)}
            </span>
          </div>
          <div className="rv-body">{r.body}</div>
        </div>
      ))}
      {mode === "reply" && (
        <div className="rv-composer inline">
          <textarea
            autoFocus
            rows={3}
            value={reply}
            placeholder="Reply"
            onChange={e => setReply(e.target.value)}
            onKeyDown={keys(sendReply, () => setMode("idle"))}
          />
          <div className="rv-row">
            <span className="rv-grow" />
            <button className="btn" onClick={() => setMode("idle")}>
              Cancel
            </button>
            <button className="btn on" disabled={!reply.trim() || busy} onClick={sendReply}>
              Reply
            </button>
          </div>
        </div>
      )}
      {mode === "resolve" && (
        <div className="rv-row">
          <span className="muted">Resolve as</span>
          {(Object.keys(ACTION_LABELS) as Action[]).map(a => (
            <button key={a} className="btn" disabled={busy} onClick={() => resolve(a)}>
              {ACTION_LABELS[a]}
            </button>
          ))}
          <button className="rv-link" onClick={() => setMode("idle")}>
            cancel
          </button>
        </div>
      )}
      {mode === "idle" && (
        <div className="rv-actions">
          <button className="rv-link" onClick={() => setMode("reply")}>
            Reply
          </button>
          {resolved ? (
            <button className="rv-link" disabled={busy} onClick={() => run({ op: "status", id: c.id, status: "open" })}>
              Reopen
            </button>
          ) : (
            <button className="rv-link" onClick={() => setMode("resolve")}>
              Resolve
            </button>
          )}
          <button className="rv-link danger" disabled={busy} onClick={remove}>
            Delete
          </button>
        </div>
      )}
      {error && <div className="rv-error">{error}</div>}
    </div>
  );
}

export function ReviewPanel({
  review,
  draft,
  activeId,
  onDraftDone,
  onNote,
  onPick,
}: {
  review: ReviewState;
  draft: Draft | null;
  activeId: string | null;
  onDraftDone: (reload: boolean) => void;
  onNote: () => void;
  onPick: (c: ReviewComment) => void;
}) {
  const { data, error } = review;
  const groups = groupComments(data?.comments ?? []);
  const card = (c: ReviewComment) => <Card key={c.id} c={c} review={review} active={c.id === activeId} onPick={onPick} />;

  return (
    <aside id="review">
      <div className="rv-head">
        <span>Comments</span>
        {data && (
          <span className="muted">
            {data.counts.open} open{data.counts.resolved ? `, ${data.counts.resolved} resolved` : ""}
          </span>
        )}
        <span className="rv-grow" />
        <button className="rv-link" onClick={() => void review.refresh()} title="Refetch comments">
          refresh
        </button>
      </div>
      {error && <div className="rv-error card">{error}</div>}
      {draft && <Composer key={`${draft.line}:${draft.selection ?? ""}`} draft={draft} review={review} onDone={onDraftDone} />}
      {data && !data.comments.length && !draft && <p className="muted rv-empty">Select text, or hover a block and click +, to leave a comment.</p>}
      {groups.document.length > 0 && <div className="rv-group">On the document</div>}
      {groups.document.map(card)}
      {groups.document.length > 0 && groups.inline.length > 0 && <div className="rv-group">In the text</div>}
      {groups.inline.map(card)}
      {groups.orphan.length > 0 && (
        <details className="rv-fold" open>
          <summary title="The commented text is gone from the document">Orphaned ({groups.orphan.length})</summary>
          {groups.orphan.map(card)}
        </details>
      )}
      {groups.resolved.length > 0 && (
        <details className="rv-fold">
          <summary>Resolved ({groups.resolved.length})</summary>
          {groups.resolved.map(card)}
        </details>
      )}
      <button className="btn rv-note" onClick={onNote}>
        Add a note on the document
      </button>
    </aside>
  );
}
