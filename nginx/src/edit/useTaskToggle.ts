import { useEffect, useRef, type RefObject } from "react";
import { apiPatchFile } from "../shared/files-api";
import { toggleTaskLine } from "./tasks";

export function useTaskToggle(
  bodyRef: RefObject<HTMLElement | null>,
  path: string,
  raw: string,
  onSaved: (content: string) => void,
  onConflict: () => void,
) {
  const busy = useRef(false);
  const state = useRef({ raw, onSaved, onConflict });
  useEffect(() => {
    state.current = { raw, onSaved, onConflict };
  });

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) {
      return;
    }
    const onClick = (e: MouseEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLInputElement) || !el.dataset.task) {
        return;
      }
      e.preventDefault();
      if (busy.current) {
        return;
      }
      const n = Number(el.dataset.task);
      const expect = state.current.raw.split("\n")[n - 1];
      const column = el.dataset.taskCell === undefined ? undefined : Number(el.dataset.taskCell);
      const text = expect === undefined ? null : toggleTaskLine(expect, column);
      if (text === null) {
        state.current.onConflict();
        return;
      }
      busy.current = true;
      apiPatchFile(path, { line: n, endLine: n, expect, text })
        .then(({ body: res }) => {
          if (res.ok) {
            state.current.onSaved(res.content);
          } else {
            state.current.onConflict();
          }
        })
        .catch(() => state.current.onConflict())
        .finally(() => {
          busy.current = false;
        });
    };
    body.addEventListener("click", onClick);
    return () => body.removeEventListener("click", onClick);
  }, [bodyRef, path]);
}
