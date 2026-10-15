const RE_TASK = /^(\s*(?:[-+*]|\d{1,9}[.)])\s+)\[([ xX])\]/;

export function toggleTaskLine(line: string): string | null {
  const m = line.match(RE_TASK);
  if (!m) {
    return null;
  }
  const box = m[2] === " " ? "[x]" : "[ ]";
  return m[1] + box + line.slice(m[0].length);
}
