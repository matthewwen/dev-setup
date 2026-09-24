import { useEffect, useMemo, useRef, useState } from "react";
import { Toolbar } from "../shared/Toolbar";
import { SizeGuard } from "../shared/SizeGuard";
import { Notebook } from "../notebook/Notebook";
import { renderNotebook, type NotebookModel } from "../notebook/render";
import { tocEntries, shouldShowToc } from "../markdown/toc";
import { fetchRaw, textViewUrl } from "../shared/fetch";
import "./IpynbViewer.css";

// Embedded images make notebooks large. SizeGuard asks first and offers the
// buffered text viewer.
const BIG_BYTES = 8 * 1024 * 1024;

function IpynbLoader({ path, onLoaded, onError }: { path: string; onLoaded: (model: NotebookModel) => void; onError: (msg: string) => void }) {
  useEffect(() => {
    let cancelled = false;
    fetchRaw(path)
      .then(text => {
        if (cancelled) {
          return;
        }
        onLoaded(renderNotebook(JSON.parse(text)));
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

export function IpynbViewer({ path }: { path: string }) {
  const [model, setModel] = useState<NotebookModel | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [tocHidden, setTocHidden] = useState(() => localStorage.getItem("md-toc") === "0");
  const [activeId, setActiveId] = useState<string | null>(null);
  const scrolledHashRef = useRef(false);

  const entries = useMemo(() => (model ? tocEntries(model.headings, 1, 3) : []), [model]);
  const showToc = shouldShowToc(entries) && !tocHidden;

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

  useEffect(() => {
    if (scrolledHashRef.current || model === null || !location.hash) {
      return;
    }
    scrolledHashRef.current = true;
    document.querySelector(decodeURIComponent(location.hash))?.scrollIntoView();
  }, [model]);

  const toggleToc = () => {
    setTocHidden(hidden => {
      const next = !hidden;
      localStorage.setItem("md-toc", next ? "0" : "1");
      return next;
    });
  };

  return (
    <div className="ipynb-viewer">
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
              <a key={h.id} className={`lvl${h.lvl + 1}${h.id === activeId ? " active" : ""}`} href={`#${h.id}`}>
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
              <IpynbLoader path={path} onLoaded={setModel} onError={setFetchError} />
              {model === null ? "Loading…" : <Notebook model={model} />}
            </SizeGuard>
          )}
        </article>
      </main>
    </div>
  );
}
