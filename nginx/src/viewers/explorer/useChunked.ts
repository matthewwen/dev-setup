import { useEffect, useState } from "react";

// Paints the first 200 rows immediately, then 400 more per frame, so a
// directory with thousands of entries shows its first screen at once
// instead of blocking on one huge render.
const FIRST_CHUNK = 200;
const CHUNK = 400;

export function useChunked<T>(rows: T[]): T[] {
  const [count, setCount] = useState(() => Math.min(FIRST_CHUNK, rows.length));
  const [countFor, setCountFor] = useState(rows);

  // A new row list restarts at the first chunk in this render, so the stale
  // count never paints. https://react.dev/learn/you-might-not-need-an-effect
  if (countFor !== rows) {
    setCountFor(rows);
    setCount(Math.min(FIRST_CHUNK, rows.length));
  }

  useEffect(() => {
    if (rows.length <= FIRST_CHUNK) {
      return;
    }
    let handle = 0;
    let next = FIRST_CHUNK;
    const step = () => {
      next = Math.min(next + CHUNK, rows.length);
      setCount(next);
      if (next < rows.length) {
        handle = requestAnimationFrame(step);
      }
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [rows]);

  return rows.length <= count ? rows : rows.slice(0, count);
}
