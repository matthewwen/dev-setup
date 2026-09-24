import { useEffect, useMemo, useRef } from "react";
import { renderMarkdown, type Heading } from "./render";
import "./Markdown.css";

// Renders Markdown source to HTML and wires the copy buttons the renderer
// embeds in every fenced code block. Those buttons are plain markup inside
// dangerouslySetInnerHTML, not React elements, so a click listener on the
// container - not a CopyButton per block - is what makes them work.
export function Markdown({ src, onHeadings }: { src: string; onHeadings?: (headings: Heading[]) => void }) {
  const { fm, html, headings } = useMemo(() => renderMarkdown(src), [src]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    onHeadings?.(headings);
  }, [headings, onHeadings]);

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
      <div id="body" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
