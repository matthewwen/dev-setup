import { useCallback, useEffect, useRef, useState } from "react";
import { Toolbar } from "../shared/Toolbar";
import { FindBox, useDebounced } from "../shared/FindBox";
import { rawUrl } from "../shared/fetch";
import { human } from "../shared/format";
import "./TextViewer.css";

const CHUNK = 256 * 1024; // bytes per range request
const TAIL_BYTES = 1024 * 1024; // window loaded by the End button

interface Line {
  no: number | null;
  text: string;
}

// Mutable read state. Kept out of React state because every chunk mutates
// several fields together and none of them need to be reactive on their own
// - report() below is the one place that turns them into UI state.
interface ReadState {
  next: number;
  line: number;
  partial: string;
  done: boolean;
  busy: boolean;
  tail: boolean;
  tailFrom: number;
  total: number | null;
}

function newReadState(): ReadState {
  return { next: 0, line: 1, partial: "", done: false, busy: false, tail: false, tailFrom: 0, total: null };
}

// Reads a file in range requests, so a multi-gigabyte log opens as fast as a
// small one. nginx answers ranges natively for static files.
export function TextViewer({ path }: { path: string }) {
  const src = rawUrl(path);
  const decoderRef = useRef(new TextDecoder("utf-8"));
  const stateRef = useRef<ReadState>(newReadState());

  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState({ total: null as number | null, done: false, tail: false, busy: false, readBytes: 0 });
  const [wrap, setWrap] = useState(false);
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounced(rawQuery, 120);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [tailBanner, setTailBanner] = useState<{ bytes: number; total: number } | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const report = useCallback(() => {
    const s = stateRef.current;
    const readBytes = s.tail ? (s.total ?? 0) - s.tailFrom : s.next;
    setStatus({ total: s.total, done: s.done, tail: s.tail, busy: s.busy, readBytes });
  }, []);

  const readRange = useCallback(
    async (from: number | null, to: number) => {
      const headers = { Range: from === null ? `bytes=-${to}` : `bytes=${from}-${to}` };
      const r = await fetch(src, { headers, cache: "no-store" });
      if (!r.ok && r.status !== 206) {
        throw new Error(`${r.status} ${r.statusText}`);
      }
      const cr = r.headers.get("Content-Range");
      if (cr) {
        const total = Number(cr.split("/")[1]);
        if (!Number.isNaN(total)) {
          stateRef.current.total = total;
        }
      } else if (r.headers.get("Content-Length") && stateRef.current.total === null) {
        // The server ignored the range and sent the whole file.
        stateRef.current.total = Number(r.headers.get("Content-Length"));
      }
      const buf = await r.arrayBuffer();
      return { text: decoderRef.current.decode(buf, { stream: true }), bytes: buf.byteLength, ranged: Boolean(cr) };
    },
    [src],
  );

  const appendLines = useCallback((text: string, numbered: boolean) => {
    const s = stateRef.current;
    const combined = s.partial + text;
    const split = combined.split("\n");
    s.partial = s.done ? "" : split.pop() ?? "";
    if (!split.length) {
      return;
    }
    const newLines: Line[] = split.map(text => ({ no: numbered ? s.line++ : null, text }));
    setLines(prev => [...prev, ...newLines]);
  }, []);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy || s.done) {
      return;
    }
    // No report() before the read: s.busy already blocks a second call, and
    // loadMore runs from the mount effect, where a synchronous setState
    // costs an extra render.
    s.busy = true;
    try {
      const to = s.next + CHUNK - 1;
      const { text, bytes, ranged } = await readRange(s.next, to);
      s.next += bytes;
      if (!ranged || bytes < CHUNK || (s.total !== null && s.next >= s.total)) {
        s.done = true;
      }
      appendLines(text, true);
      if (s.done && s.partial) {
        appendLines("", true);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      s.done = true;
    }
    s.busy = false;
    report();
  }, [appendLines, readRange, report]);

  const loadTail = useCallback(async () => {
    const s = stateRef.current;
    if (s.busy) {
      return;
    }
    s.busy = true;
    report();
    try {
      const { text, bytes } = await readRange(null, TAIL_BYTES);
      s.tail = true;
      s.done = true;
      s.partial = "";
      s.tailFrom = s.total === null ? 0 : Math.max(0, s.total - bytes);
      setLines([]);
      setTailBanner(s.tailFrom > 0 ? { bytes, total: s.total ?? bytes } : null);
      appendLines(text, false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
    s.busy = false;
    report();
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, [appendLines, readRange, report]);

  const restart = useCallback(() => {
    stateRef.current = newReadState();
    setLines([]);
    setTailBanner(null);
    setErrorMsg(null);
    const el = scrollerRef.current;
    if (el) {
      el.scrollTop = 0;
    }
    loadMore();
  }, [loadMore]);

  // The first read. App keys this viewer on its path, so a new path mounts a
  // new TextViewer instead of reusing this one.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- every setState in loadMore runs after its first await
    loadMore();
  }, [loadMore]);

  // Keeps reading while the reader approaches the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      const s = stateRef.current;
      if (s.done || s.busy || s.tail) {
        return;
      }
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
        loadMore();
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [loadMore]);

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement as HTMLElement | null)?.tagName ?? "");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        findRef.current?.focus();
        findRef.current?.select();
        return;
      }
      if (typing) {
        if (e.key === "Escape") {
          setRawQuery("");
          findRef.current?.blur();
        }
        return;
      }
      if (e.key === "G") {
        loadTail();
        e.preventDefault();
      } else if (e.key === "g") {
        const el = scrollerRef.current;
        if (el) {
          el.scrollTop = 0;
        }
        e.preventDefault();
      } else if (e.key === "w") {
        setWrap(w => !w);
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [loadTail]);

  const needle = query.toLowerCase();
  let hits = 0;
  let firstHit = -1;
  if (needle) {
    lines.forEach((line, i) => {
      if (line.text.toLowerCase().includes(needle)) {
        hits++;
        if (firstHit === -1) {
          firstHit = i;
        }
      }
    });
  }
  const firstHitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (firstHit >= 0) {
      firstHitRef.current?.scrollIntoView({ block: "center" });
    }
  }, [query, firstHit]);

  const pct = status.total ? Math.min(100, (status.readBytes / status.total) * 100) : 0;
  const statusText = [
    status.tail ? "tail" : "from start",
    `${human(status.readBytes)} of ${status.total === null ? "?" : human(status.total)}`,
    status.done ? "complete" : `${Math.round(pct)}%`,
  ].join("  ·  ");

  function highlighted(text: string) {
    if (!needle) {
      return text;
    }
    const at = text.toLowerCase().indexOf(needle);
    if (at < 0) {
      return text;
    }
    return (
      <>
        {text.slice(0, at)}
        <mark>{text.slice(at, at + query.length)}</mark>
        {text.slice(at + query.length)}
      </>
    );
  }

  return (
    <div className={wrap ? "text-viewer wrap" : "text-viewer"}>
      <Toolbar
        path={path}
        actions={
          <>
            <FindBox
              inputRef={findRef}
              value={rawQuery}
              onChange={setRawQuery}
              placeholder="find in loaded text"
              hitsLabel={rawQuery ? (hits ? `${hits} ${hits === 1 ? "line" : "lines"}` : "no match") : ""}
            />
            <button className="btn" onClick={loadMore} disabled={status.done || status.busy}>
              Load more
            </button>
            <button className="btn" onClick={loadTail}>
              End
            </button>
            <button className={wrap ? "btn on" : "btn"} onClick={() => setWrap(w => !w)}>
              Wrap
            </button>
          </>
        }
      />
      <main ref={scrollerRef}>
        <div id="body">
          {lines.length === 0 && !errorMsg && "Loading…"}
          {tailBanner && (
            <div className="card">
              Showing the last {human(tailBanner.bytes)} of {human(tailBanner.total)}.{" "}
              <a
                href="#"
                onClick={e => {
                  e.preventDefault();
                  restart();
                }}
              >
                Read from the start
              </a>{" "}
              for line numbers.
            </div>
          )}
          {lines.map((line, i) => (
            <div className="ln" key={i} ref={i === firstHit ? firstHitRef : undefined}>
              <span className="no">{line.no ?? ""}</span>
              <span className="tx">{highlighted(line.text)}</span>
            </div>
          ))}
          {errorMsg && <div className="card error">{errorMsg}</div>}
        </div>
      </main>
      <footer>
        <span>{statusText}</span>
        <div className="bar">
          <span style={{ width: `${pct.toFixed(1)}%` }} />
        </div>
        <span className="spacer" />
        <span>
          <kbd>/</kbd> find &middot; <kbd>G</kbd> end &middot; <kbd>g</kbd> start &middot; <kbd>w</kbd> wrap
        </span>
      </footer>
    </div>
  );
}
