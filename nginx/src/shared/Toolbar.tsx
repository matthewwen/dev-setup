import type { ReactNode } from "react";
import { useTheme } from "../app/theme";
import { pathParts } from "./format";
import { rawUrl } from "./fetch";

// The sticky header on every viewer: breadcrumbs to the current path, a
// per-viewer action slot (find box, expand/collapse, wrap, ...), the theme
// toggle, and a Raw link. Every viewer's own page today wires this by hand;
// this is the one copy.
export function Toolbar({ path, actions }: { path: string; actions?: ReactNode }) {
  const [, toggleTheme] = useTheme();
  const parts = pathParts(path);

  return (
    <header className="toolbar">
      <div id="crumbs">
        <a href="/">/</a>
        {parts.map((part, i) => {
          const href = "/" + parts.slice(0, i + 1).join("/") + (i === parts.length - 1 ? "" : "/");
          return (
            <span key={href}>
              <span> &rsaquo; </span>
              {i === parts.length - 1 ? <b>{part}</b> : <a href={href}>{part}</a>}
            </span>
          );
        })}
      </div>
      {actions}
      <button className="btn" onClick={toggleTheme} title="Toggle theme">
        &#9788;
      </button>
      <a className="btn" href={rawUrl(path)} title="View source">
        Raw
      </a>
    </header>
  );
}
