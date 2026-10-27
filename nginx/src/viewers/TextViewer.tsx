import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Toolbar } from "../shared/Toolbar";
import { FindBox, useDebounced } from "../shared/FindBox";
import { human } from "../shared/format";
import { CHUNK, TAIL_BYTES, TextBuffer, readTextRange, followReadMode, type LogLine } from "./text-stream";
import "./TextViewer.scss";

function newReadState() {
  return {
    next: 0, done: false, busy: false, tail: false, tailFrom: 0,
    total: null as number | null, version: null as string | null,
    buffer: new TextBuffer(), controller: new AbortController(),
  };
}

export function TextViewer({ path }: { path: string }) {
  const src = `/__raw${path.split("/").map(encodeURIComponent).join("/")}`;
  const stateRef = useRef(newReadState());
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState({ total: null as number | null, done: false, tail: false, busy: false, readBytes: 0 });
  const [wrap, setWrap] = useState(false);
  const [following, setFollowing] = useState(false);
  const [pinned, setPinned] = useState(true);
  const pinnedRef = useRef(true);
  const [rawQuery, setRawQuery] = useState("");
  const query = useDebounced(rawQuery, 120);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const report = useCallback(() => {
    const s = stateRef.current;
    setStatus({ total: s.total, done: s.done, tail: s.tail, busy: s.busy, readBytes: s.next - s.tailFrom });
  }, []);

  const reset = useCallback(() => {
    stateRef.current.controller.abort();
    stateRef.current = newReadState();
    return stateRef.current;
  }, []);

  const read = useCallback(async (mode: "more" | "tail" | "live", jump = true) => {
    const s = mode === "tail" ? reset() : stateRef.current;
    if (s.busy || (s.done && mode === "more")) {
      return false;
    }
    s.busy = true;
    try {
      const result = await readTextRange(src, mode === "tail" ? null : s.next,
        mode === "tail" ? TAIL_BYTES : s.next + CHUNK - 1, s.controller.signal);
      if (stateRef.current !== s || s.controller.signal.aborted) {
        return false;
      }
      if (mode === "tail") {
        s.tail = true;
        s.tailFrom = result.start;
        s.buffer = new TextBuffer(false, result.start > 0);
      }
      s.total = result.total;
      s.next = result.start + result.bytes.byteLength;
      s.done = !result.ranged || s.next >= s.total;
      s.buffer.append(result.bytes, mode !== "more");
      setLines(s.buffer.snapshot());
      setErrorMsg(null);
      if (mode === "tail" && jump) {
        pinnedRef.current = true;
        setPinned(true);
        requestAnimationFrame(() => {
          const el = scrollerRef.current;
          if (el && stateRef.current === s) {
            el.scrollTop = el.scrollHeight;
          }
        });
      }
      return true;
    } catch (err) {
      if (stateRef.current === s && !s.controller.signal.aborted) {
        setErrorMsg(err instanceof Error ? err.message : String(err));
      }
      return false;
    } finally {
      s.busy = false;
      if (stateRef.current === s && !s.controller.signal.aborted) {
        report();
      }
    }
  }, [reset, src, report]);

  const loadMore = useCallback(() => read("more"), [read]);
  const loadTail = useCallback(() => read("tail"), [read]);

  const restart = useCallback(() => {
    setFollowing(false);
    reset();
    setLines([]);
    setErrorMsg(null);
    scrollerRef.current?.scrollTo(0, 0);
    loadMore();
  }, [reset, loadMore]);

  useEffect(() => {
    loadMore();
    return () => stateRef.current.controller.abort();
  }, [loadMore]);

  useEffect(() => {
    if (!following) {
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const controller = new AbortController();
    const poll = async () => {
      let delay = 1000;
      try {
        const response = await fetch(src, { method: "HEAD", cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`);
        }
        const length = response.headers.get("Content-Length");
        if (length === null || !Number.isFinite(Number(length))) {
          throw new Error("The server did not return the file size.");
        }
        const size = Number(length);
        const version = response.headers.get("ETag") ?? response.headers.get("Last-Modified");
        const s = stateRef.current;
        const mode = first ? "tail" : followReadMode(s.next, size, s.version, version);
        const updated = mode === null || await read(mode, first);
        if (!stopped && updated) {
          first = false;
          stateRef.current.version = version;
          if ((stateRef.current.total ?? 0) > stateRef.current.next) {
            delay = 0;
          }
          setErrorMsg(null);
        }
      } catch (err) {
        if (!stopped) {
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      }
      if (!stopped) {
        timer = setTimeout(poll, delay);
      }
    };
    poll();
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [following, read, src]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (following && pinnedRef.current && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [following, lines]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) {
      return;
    }
    const onScroll = () => {
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      pinnedRef.current = atBottom;
      setPinned(atBottom);
      const s = stateRef.current;
      if (!following && !s.done && !s.busy && !s.tail && el.scrollTop + el.clientHeight > el.scrollHeight - 600) {
        loadMore();
      }
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, [following, loadMore]);

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
        scrollerRef.current?.scrollTo(0, 0);
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
    following ? (pinned ? "following live" : "live · scroll paused") : status.tail ? "tail" : "from start",
    `${human(status.readBytes)} of ${status.total === null ? "?" : human(status.total)}`,
    following ? "checks every second" : status.done ? "complete" : `${Math.round(pct)}%`,
  ].join("  ·  ");

  function highlighted(line: LogLine) {
    const at = needle ? line.text.toLowerCase().indexOf(needle) : -1;
    let offset = 0;
    return line.runs.map((run, i) => {
      const start = offset;
      offset += run.text.length;
      const from = Math.max(0, at - start);
      const to = Math.min(run.text.length, at + query.length - start);
      return <span key={i} style={run.style}>{at >= 0 && from < to ? <>
        {run.text.slice(0, from)}<mark>{run.text.slice(from, to)}</mark>{run.text.slice(to)}
      </> : run.text}</span>;
    });
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
            <button className="btn" onClick={loadMore} disabled={following || status.done || status.busy}>
              Load more
            </button>
            <button className="btn" onClick={loadTail}>
              End
            </button>
            <button className={following ? "btn on" : "btn"} aria-pressed={following} onClick={() => setFollowing(value => !value)}>
              Follow
            </button>
            <button className={wrap ? "btn on" : "btn"} onClick={() => setWrap(w => !w)}>
              Wrap
            </button>
          </>
        }
      />
      <main ref={scrollerRef}>
        <div id="body">
          {lines.length === 0 && !errorMsg && (status.done ? "No output yet." : "Loading…")}
          {status.tail && (
            <div className="card">
              {following ? "Live view keeps up to 10,000 recent lines. " : "Showing the latest output. "}
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
              <span className="tx">{highlighted(line)}</span>
            </div>
          ))}
          {errorMsg && <div className="card error">{errorMsg}{following && " · Retrying…"}</div>}
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
