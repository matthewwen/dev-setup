import { useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "../shared/Toolbar";
import { SizeGuard } from "../shared/SizeGuard";
import { Markdown } from "../markdown/Markdown";
import { tocEntries, shouldShowToc } from "../markdown/toc";
import type { Heading } from "../markdown/render";
import { fetchRaw, textViewUrl } from "../shared/fetch";
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

  return (
    <div className="md-viewer">
      <Toolbar
        path={path}
        actions={
          <button className="btn" onClick={toggleToc} title="Toggle contents">
            &#9776;
          </button>
        }
      />
      <main className={showToc ? "" : "no-toc"}>
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
        <article>
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
              {raw === null ? "Loading…" : <Markdown src={raw} onHeadings={setHeadings} />}
            </SizeGuard>
          )}
        </article>
      </main>
    </div>
  );
}
