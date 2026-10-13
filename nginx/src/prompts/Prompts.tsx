import { useCallback, useEffect, useRef, useState } from "react";
import { apiPrompts } from "./api";
import { Library } from "./Library";
import { Detail } from "./Detail";
import "./Prompts.css";

// /prompts/ is the library, /prompts/?tag=<tag> is the library filtered to
// one tag, and /prompts/<id> is one task. This component owns
// the whole subtree below /prompts/, navigating itself with pushState the
// way the explorer does; App.tsx renders it once and does not key it by
// path, so a click from the library to a task never triggers a full reload.
function readTaskId(pathname: string): number | null {
  const m = /^\/prompts\/(\d+)\/?$/.exec(pathname);
  return m ? Number(m[1]) : null;
}

function readTag(search: string): string {
  return new URLSearchParams(search).get("tag") ?? "";
}

function libraryUrl(tag: string): string {
  return tag ? `/prompts/?${new URLSearchParams({ tag })}` : "/prompts/";
}

function currentUrl(): string {
  return window.location.pathname + window.location.search;
}

export function Prompts() {
  const [url, setUrl] = useState(currentUrl);
  const { pathname, search } = new URL(url, window.location.origin);

  const taskId = readTaskId(pathname);
  const tag = readTag(search);
  const lastLibraryUrl = useRef("/prompts/");

  useEffect(() => {
    if (taskId === null) {
      lastLibraryUrl.current = url;
    }
  }, [taskId, url]);

  useEffect(() => {
    const onPop = () => setUrl(currentUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (taskId === null) {
      document.title = tag ? `Prompts · ${tag}` : "Prompts";
    }
  }, [taskId, tag]);

  const navigate = useCallback((next: string) => {
    if (next !== currentUrl()) {
      history.pushState(null, "", next);
    }
    setUrl(next);
  }, []);

  const createAndOpen = useCallback(async () => {
    const res = await apiPrompts("task.create", tag ? { tags: [tag] } : {});
    if (!res.ok || !res.task) {
      throw new Error(res.ok ? "task.create did not return a task" : res.error);
    }
    navigate(`/prompts/${res.task.id}`);
  }, [navigate, tag]);

  if (taskId !== null) {
    return (
      <Detail
        taskId={taskId}
        onBack={() => navigate(lastLibraryUrl.current)}
        onHome={() => navigate("/prompts/")}
      />
    );
  }
  return (
    <Library
      tag={tag}
      onTagChange={next => navigate(libraryUrl(next))}
      onOpen={id => navigate(`/prompts/${id}`)}
      onNew={createAndOpen}
    />
  );
}
