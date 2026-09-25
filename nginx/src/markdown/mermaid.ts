import { useEffect, type RefObject } from "react";
import { currentTheme } from "../app/theme";

// Mermaid is large, so the build splits it into its own chunk and a page
// fetches it only when the page has a diagram. Runs go through one queue,
// because mermaid.initialize() sets global state for the next render.
let queue: Promise<void> = Promise.resolve();
let seq = 0;

async function renderAll(root: HTMLElement, cancelled: () => boolean): Promise<void> {
  const els = Array.from(root.querySelectorAll<HTMLElement>(".mermaid"));
  if (!els.length || cancelled()) {
    return;
  }
  const { default: mermaid } = await import("mermaid");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: currentTheme() === "dark" ? "dark" : "default",
  });
  for (const el of els) {
    if (cancelled()) {
      return;
    }
    // The first run reads the source from the fallback <pre>, which the diagram replaces.
    const src = (el.dataset.src ??= el.querySelector("code")?.textContent ?? "");
    try {
      const { svg } = await mermaid.render(`mermaid-${++seq}`, src);
      if (!cancelled()) {
        el.innerHTML = svg;
      }
    } catch (err) {
      if (!cancelled()) {
        const pre = document.createElement("pre");
        pre.appendChild(document.createElement("code")).textContent = src;
        const msg = document.createElement("div");
        msg.className = "mermaid-error";
        msg.textContent = err instanceof Error ? err.message : String(err);
        el.replaceChildren(msg, pre);
      }
    }
  }
}

// Renders every `.mermaid` block under `ref` after `html` changes, and again
// when the theme changes.
export function useMermaid(ref: RefObject<HTMLElement>, html: unknown): void {
  useEffect(() => {
    const root = ref.current;
    if (!root?.querySelector(".mermaid")) {
      return;
    }
    let cancelled = false;
    const run = () => {
      queue = queue.then(() => renderAll(root, () => cancelled)).catch(err => console.error(err));
    };
    run();
    const obs = new MutationObserver(run);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      cancelled = true;
      obs.disconnect();
    };
  }, [ref, html]);
}
