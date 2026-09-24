import { useEffect } from "react";
import type { SearchMode } from "./api";

// The directory is the URL path, so /example/ opens that directory
// directly. Search options ride in the query string.
export const dirUrl = (path: string): string => (path === "/" ? "/" : `${path}/`);

export interface SearchOptions {
  q: string;
  mode: SearchMode;
  here: boolean;
  glob: string;
  regex: boolean;
  case: boolean;
}

export interface Route {
  path: string;
  search: SearchOptions;
}

export function readRoute(): Route {
  const p = new URLSearchParams(location.search);
  // #p=/dir is the old link format; honour it once, then use the path.
  const legacy = new URLSearchParams(location.hash.slice(1));
  const path = (legacy.get("p") || decodeURIComponent(location.pathname)).replace(/\/+$/, "") || "/";
  const mode = (p.get("mode") || legacy.get("mode") || "content") as SearchMode;
  return {
    path,
    search: {
      q: p.get("q") || legacy.get("q") || "",
      mode,
      here: p.get("all") !== "1",
      glob: p.get("glob") || "",
      regex: p.get("regex") === "1",
      case: p.get("case") === "1",
    },
  };
}

// `search` is null while browsing a plain directory - the URL then carries
// only the path, matching every other viewer's convention.
export function writeRoute(path: string, search: SearchOptions | null, push: boolean): void {
  const p = new URLSearchParams();
  if (search) {
    p.set("q", search.q);
    p.set("mode", search.mode);
    if (!search.here) {
      p.set("all", "1");
    }
    if (search.glob.trim()) {
      p.set("glob", search.glob.trim());
    }
    if (search.regex) {
      p.set("regex", "1");
    }
    if (search.case) {
      p.set("case", "1");
    }
  }
  const query = p.toString();
  const url = dirUrl(path) + (query ? `?${query}` : "");
  if (push && url !== location.pathname + location.search) {
    history.pushState(null, "", url);
  } else {
    history.replaceState(null, "", url);
  }
}

export function usePopState(handler: () => void): void {
  useEffect(() => {
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [handler]);
}
