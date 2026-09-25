import { useEffect, useRef, useState } from "react";
import { useDebounced } from "../shared/FindBox";

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaveState {
  status: AutosaveStatus;
  at: number | null;
  error: string | null;
}

// Saves a fast-changing value 800ms after the last change, or immediately via
// flush() on blur / before the page unloads. A response is dropped unless it
// belongs to the most recent save this hook sent, so a slow save landing
// after a newer one can never overwrite what the newer one wrote.
export function useAutosave(
  value: string,
  save: (value: string) => Promise<void>,
  delayMs = 800,
): AutosaveState & { flush: () => void } {
  const debounced = useDebounced(value, delayMs);
  const [state, setState] = useState<AutosaveState>({ status: "idle", at: null, error: null });
  const savedRef = useRef(value);
  const seqRef = useRef(0);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  function run(v: string) {
    if (v === savedRef.current) {
      return;
    }
    const seq = ++seqRef.current;
    setState(s => ({ ...s, status: "saving" }));
    save(v).then(
      () => {
        if (seq === seqRef.current) {
          savedRef.current = v;
          setState({ status: "saved", at: Date.now(), error: null });
        }
      },
      err => {
        if (seq === seqRef.current) {
          setState({ status: "error", at: null, error: String(err) });
        }
      },
    );
  }

  useEffect(() => {
    run(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save is a new function every render; only a change to the debounced value should retrigger this
  }, [debounced]);

  useEffect(() => {
    const onUnload = () => {
      if (valueRef.current !== savedRef.current) {
        save(valueRef.current);
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- save is a new function every render; this listener is installed once
  }, []);

  return { ...state, flush: () => run(valueRef.current) };
}
