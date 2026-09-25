import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "../shared/Toolbar";
import { SizeGuard } from "../shared/SizeGuard";
import { Markdown } from "../markdown/Markdown";
import { tocEntries, shouldShowToc } from "../markdown/toc";
import type { Block, Heading } from "../markdown/render";
import { fetchRaw, textViewUrl } from "../shared/fetch";
import type { ReviewComment } from "../shared/review-api";
import { ReviewPanel, type Draft } from "../review/ReviewPanel";
import { DocOverlay } from "../review/DocOverlay";
import { useReview } from "../review/useReview";
import { blockAt, markedBlocks } from "../review/model";
import "./MdViewer.css";

// Rendering a very large document blocks the page, so SizeGuard asks first
// and offers the buffered text viewer.
const BIG_BYTES = 2 * 1024 * 1024;

function MdLoader({ path, onLoaded, onError }: { path: string; onLoaded: (text: string) => void; onError: (msg: string) => void }) {
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

export function MdViewer({ path }: { path: string }) {
  const [raw, setRaw] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [tocHidden, setTocHidden] = useState(() => localStorage.getItem("md-toc") === "0");
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrolledHashRef = useRef(false);

  const entries = useMemo(() => tocEntries(headings), [headings]);
  const showToc = shouldShowToc(entries) && !tocHidden;

  // Follows the reader's position in the document once the TOC is showing.
  useEffect(() => {
    if (!showToc) {
      return;
    }
    const targets = entries.map(h => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null);
    if (!targets.length) {
      return;
    }
    const obs = new IntersectionObserver(
      list => {
        list.forEach(entry => {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        });
      },
      { rootMargin: "-70px 0px -75% 0px" },
    );
    targets.forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [showToc, entries]);

  // Scrolls to the URL's #hash once, the first time the document has loaded.
  useEffect(() => {
    if (scrolledHashRef.current || raw === null || !location.hash) {
      return;
    }
    scrolledHashRef.current = true;
    document.querySelector(decodeURIComponent(location.hash))?.scrollIntoView();
  }, [raw]);

  const toggleToc = () => {
    setTocHidden(hidden => {
      const next = !hidden;
      localStorage.setItem("md-toc", next ? "0" : "1");
      return next;
    });
  };

  // ---------- review comments ----------
  const loaded = raw !== null;
  const review = useReview(path, loaded);
  const { refresh } = review;
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [reviewOpen, setReviewOpen] = useState(() => localStorage.getItem("md-comments") === "1");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLElement>(null);

  const comments = useMemo(() => review.data?.comments ?? [], [review.data]);
  const marks = useMemo(() => markedBlocks(comments, blocks), [comments, blocks]);
  const openCount = review.data?.counts.open ?? 0;

  const showReview = (open: boolean) => {
    setReviewOpen(open);
    localStorage.setItem("md-comments", open ? "1" : "0");
  };

  const reloadDocument = useCallback(() => {
    fetchRaw(path)
      .then(text => setRaw(prev => (prev === text ? prev : text)))
      .catch(() => undefined);
  }, [path]);

  // An agent edits the file and answers in the store while the reader is in
  // another window, so coming back refetches both.
  useEffect(() => {
    if (!loaded) {
      return;
    }
    const onFocus = () => {
      reloadDocument();
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loaded, reloadDocument, refresh]);

  const startDraft = (d: Draft) => {
    setDraft(d);
    setActiveComment(null);
    showReview(true);
  };

  const endDraft = (reload: boolean) => {
    setDraft(null);
    if (reload) {
      reloadDocument();
      void refresh();
    }
  };

  const pickComment = (c: ReviewComment) => {
    setActiveComment(c.id);
    const line = c.resolved.line;
    const block = line === undefined ? undefined : blockAt(blocks, line);
    const el = block && bodyRef.current?.querySelector(`[data-line="${block.line}"]`);
    if (!(el instanceof HTMLElement)) {
      return;
    }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("rv-flash");
    void el.offsetWidth;
    el.classList.add("rv-flash");
    window.setTimeout(() => el.classList.remove("rv-flash"), 1500);
  };

  const showComment = (id: string) => {
    setActiveComment(id);
    showReview(true);
    requestAnimationFrame(() => document.getElementById(`rv-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };

  return (
    <div className="md-viewer">
      <Toolbar
        path={path}
        actions={
          <>
            <button className={`btn${reviewOpen ? " on" : ""}`} onClick={() => showReview(!reviewOpen)} title="Toggle comments">
              Comments{openCount ? ` ${openCount}` : ""}
            </button>
            <button className="btn" onClick={toggleToc} title="Toggle contents">
              &#9776;
            </button>
          </>
        }
      />
      <main className={`${showToc ? "" : "no-toc"}${reviewOpen ? " with-review" : ""}`}>
        {showToc && (
          <nav id="toc">
            <div>Contents</div>
            {entries.map(h => (
              <a key={h.id} className={`lvl${h.lvl}${h.id === activeId ? " active" : ""}`} href={`#${h.id}`}>
                {h.text}
              </a>
            ))}
          </nav>
        )}
        <article ref={hostRef} className="rv-host">
          {fetchError && (
            <div className="card error">
              Cannot load {path}
              <br />
              {fetchError}
              <br />
              <br />
              <a href={textViewUrl(path)}>Open the buffered text viewer</a>
            </div>
          )}
          {!fetchError && (
            <SizeGuard path={path} limitBytes={BIG_BYTES}>
              <MdLoader path={path} onLoaded={setRaw} onError={setFetchError} />
              {raw === null ? "Loading…" : <Markdown src={raw} onHeadings={setHeadings} onBlocks={setBlocks} sourceLines bodyRef={bodyRef} />}
            </SizeGuard>
          )}
          {loaded && (
            <DocOverlay
              bodyRef={bodyRef}
              hostRef={hostRef}
              blocks={blocks}
              marks={marks}
              draftLine={draft?.line ?? null}
              onComment={startDraft}
              onShow={showComment}
            />
          )}
        </article>
        {reviewOpen && (
          <ReviewPanel
            review={review}
            draft={draft}
            activeId={activeComment}
            onDraftDone={endDraft}
            onNote={() => startDraft({ line: null, endLine: 0, text: "" })}
            onPick={pickComment}
          />
        )}
      </main>
    </div>
  );
}
