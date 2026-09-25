import { useEffect, useMemo, useRef, type RefObject } from "react";
import { renderMarkdown, type Block, type Heading } from "./render";
import { useMermaid } from "./mermaid";
import "./Markdown.css";

// Renders Markdown source to HTML and wires the copy buttons the renderer
// embeds in every fenced code block. Those buttons are plain markup inside
// dangerouslySetInnerHTML, not React elements, so a click listener on the
// container - not a CopyButton per block - is what makes them work.
// `sourceLines` adds data-line attributes for the review overlay, which finds
// the blocks through `bodyRef`.
export function Markdown({
  src,
  onHeadings,
  onBlocks,
  sourceLines,
  bodyRef,
}: {
  src: string;
  onHeadings?: (headings: Heading[]) => void;
  onBlocks?: (blocks: Block[]) => void;
  sourceLines?: boolean;
  bodyRef?: RefObject<HTMLDivElement>;
}) {
  const { fm, html, headings, blocks } = useMemo(() => renderMarkdown(src, undefined, { sourceLines }), [src, sourceLines]);
  const ref = useRef<HTMLDivElement>(null);
  useMermaid(ref, html);

  useEffect(() => {
    onHeadings?.(headings);
  }, [headings, onHeadings]);

  useEffect(() => {
    onBlocks?.(blocks);
  }, [blocks, onBlocks]);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const onClick = (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest("pre .copy");
      if (!(btn instanceof HTMLElement)) {
        return;
      }
      const code = btn.parentElement?.querySelector("code");
      if (!code) {
        return;
      }
      navigator.clipboard.writeText(code.innerText);
      btn.textContent = "copied";
      setTimeout(() => {
        btn.textContent = "copy";
      }, 1200);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, []);

  return (
    <div className="markdown-body" ref={ref}>
      {fm && <div id="frontmatter">{fm}</div>}
      <div id="body" ref={bodyRef} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
