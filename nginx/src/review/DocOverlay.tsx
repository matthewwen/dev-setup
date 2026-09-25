import { useEffect, useRef, useState, type RefObject } from "react";
import type { Block } from "../markdown/render";
import { selectionTarget, type SelectionTarget } from "./model";
import type { Draft } from "./ReviewPanel";

interface Hover {
  line: number;
  top: number;
}

interface Sel {
  target: SelectionTarget;
  top: number;
  left: number;
}

// The rendered document is one dangerouslySetInnerHTML string, so React owns
// none of its nodes. Everything here works from the outside: delegated
// listeners on the body, controls positioned over the host, and classes set
// on the renderer's own [data-line] elements. No wrapper per block, so no
// Markdown.css sibling or first-child rule changes.
export function DocOverlay({
  bodyRef,
  hostRef,
  blocks,
  marks,
  draftLine,
  onComment,
  onShow,
}: {
  bodyRef: RefObject<HTMLDivElement>;
  hostRef: RefObject<HTMLElement>;
  blocks: Block[];
  marks: Map<number, string[]>;
  draftLine: number | null;
  onComment: (draft: Draft) => void;
  onShow: (id: string) => void;
}) {
  const [hover, setHover] = useState<Hover | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const clearTimer = useRef<number | undefined>(undefined);

  const keepHover = () => window.clearTimeout(clearTimer.current);
  const dropHover = () => {
    keepHover();
    clearTimer.current = window.setTimeout(() => setHover(null), 300);
  };

  useEffect(() => {
    const body = bodyRef.current;
    const host = hostRef.current;
    if (!body || !host) {
      return;
    }
    const over = (e: MouseEvent) => {
      const el = (e.target as Element).closest?.("[data-line]");
      if (!(el instanceof HTMLElement) || !body.contains(el)) {
        return;
      }
      window.clearTimeout(clearTimer.current);
      setHover({ line: Number(el.dataset.line), top: el.getBoundingClientRect().top - host.getBoundingClientRect().top });
    };
    const leave = () => {
      window.clearTimeout(clearTimer.current);
      clearTimer.current = window.setTimeout(() => setHover(null), 300);
    };
    body.addEventListener("mouseover", over);
    host.addEventListener("mouseleave", leave);
    return () => {
      body.removeEventListener("mouseover", over);
      host.removeEventListener("mouseleave", leave);
      window.clearTimeout(clearTimer.current);
    };
  }, [bodyRef, hostRef, blocks]);

  useEffect(() => {
    const lineOf = (node: Node | null): number | null => {
      const el = node instanceof Element ? node : node?.parentElement;
      const block = el?.closest("[data-line]");
      return block instanceof HTMLElement && bodyRef.current?.contains(block) ? Number(block.dataset.line) : null;
    };
    const onChange = () => {
      const s = document.getSelection();
      const body = bodyRef.current;
      const host = hostRef.current;
      if (!s || s.isCollapsed || !s.rangeCount || !body || !host || !body.contains(s.anchorNode)) {
        setSel(null);
        return;
      }
      const target = selectionTarget(blocks, lineOf(s.anchorNode), lineOf(s.focusNode), s.toString());
      if (!target.ok && target.reason === "empty selection") {
        setSel(null);
        return;
      }
      const rect = s.getRangeAt(s.rangeCount - 1).getBoundingClientRect();
      const box = host.getBoundingClientRect();
      setSel({ target, top: rect.bottom - box.top + 6, left: Math.max(rect.right - box.left, 120) });
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [bodyRef, hostRef, blocks]);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const touched: Element[] = [];
    const mark = (line: number, cls: string) => {
      const el = body.querySelector(`[data-line="${line}"]`);
      if (el) {
        el.classList.add(cls);
        touched.push(el);
      }
    };
    marks.forEach((_ids, line) => mark(line, "rv-marked"));
    if (draftLine !== null) {
      mark(draftLine, "rv-draft");
    }
    return () => {
      for (const el of touched) {
        el.classList.remove("rv-marked", "rv-draft");
      }
    };
  }, [bodyRef, blocks, marks, draftLine]);

  const block = hover ? blocks.find(b => b.line === hover.line) : undefined;
  const ids = hover ? marks.get(hover.line) : undefined;

  const commentOnSelection = () => {
    if (!sel?.target.ok) {
      return;
    }
    const { block: b, selection } = sel.target;
    onComment({ line: b.line, endLine: b.endLine, text: b.text, selection: selection === b.text.trim() ? undefined : selection });
    document.getSelection()?.removeAllRanges();
    setSel(null);
  };

  return (
    <>
      {hover && block && (
        <div className="rv-gutter" style={{ top: hover.top }} onMouseEnter={keepHover} onMouseLeave={dropHover}>
          <button
            className="rv-plus"
            title={`Comment on L${block.line}${block.endLine !== block.line ? `-${block.endLine}` : ""}`}
            onClick={() => onComment({ line: block.line, endLine: block.endLine, text: block.text })}
          >
            +
          </button>
          {ids && (
            <button className="rv-count" title={`${ids.length} open comment${ids.length > 1 ? "s" : ""}`} onClick={() => onShow(ids[0])}>
              {ids.length}
            </button>
          )}
        </div>
      )}
      {sel &&
        (sel.target.ok ? (
          <button className="rv-selbtn" style={{ top: sel.top, left: sel.left }} onMouseDown={e => e.preventDefault()} onClick={commentOnSelection}>
            Comment
          </button>
        ) : (
          <span className="rv-selbtn no" style={{ top: sel.top, left: sel.left }}>
            {sel.target.reason}
          </span>
        ))}
    </>
  );
}
