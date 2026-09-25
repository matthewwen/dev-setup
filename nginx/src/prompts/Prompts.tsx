import { useCallback, useEffect, useState } from "react";
import { apiPrompts } from "./api";
import { Library } from "./Library";
import { Detail } from "./Detail";
import "./Prompts.css";

// /prompts/ is the library, /prompts/<id> is one task. This component owns
// the whole subtree below /prompts/, navigating itself with pushState the
// way the explorer does; App.tsx renders it once and does not key it by
// path, so a click from the library to a task never triggers a full reload.
function readTaskId(pathname: string): number | null {
  const m = /^\/prompts\/(\d+)\/?$/.exec(pathname);
  return m ? Number(m[1]) : null;
}

export function Prompts() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((path: string) => {
    if (path !== window.location.pathname) {
      history.pushState(null, "", path);
    }
    setPathname(path);
  }, []);

  const createAndOpen = useCallback(async () => {
    const res = await apiPrompts("task.create");
    if (!res.ok || !res.task) {
      throw new Error(res.ok ? "task.create did not return a task" : res.error);
    }
    navigate(`/prompts/${res.task.id}`);
  }, [navigate]);

  const taskId = readTaskId(pathname);
  if (taskId !== null) {
    return <Detail taskId={taskId} onBack={() => navigate("/prompts/")} />;
  }
  return <Library onOpen={id => navigate(`/prompts/${id}`)} onNew={createAndOpen} />;
}
