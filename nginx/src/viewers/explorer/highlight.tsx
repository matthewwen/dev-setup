import type { ReactNode } from "react";

// Wraps every match of a global RegExp in <mark>. Unlike shared/FindBox's
// single-match highlight, search results can have several matches per line.
export function highlightAll(text: string, rx: RegExp | null): ReactNode {
  if (!rx) {
    return text;
  }
  rx.lastIndex = 0;
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = rx.exec(text)) !== null) {
    if (m[0] === "") {
      rx.lastIndex++;
      continue;
    }
    if (m.index > last) {
      parts.push(text.slice(last, m.index));
    }
    parts.push(<mark key={key++}>{m[0]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return <>{parts}</>;
}

export function matchRegex(q: string, regex: boolean, caseSensitive: boolean): RegExp | null {
  try {
    const body = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(body, caseSensitive ? "g" : "gi");
  } catch {
    return null;
  }
}
