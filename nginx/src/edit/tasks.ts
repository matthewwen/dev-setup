const RE_TASK = /^(\s*(?:(?:[-+*]|\d{1,9}[.)])\s+)?)\[([ xX])\](?=[ \t\r]|$)/;

export function toggleTaskLine(line: string, column?: number): string | null {
  if (column !== undefined) {
    if (!Number.isInteger(column) || column < 0) {
      return null;
    }
    const cells = line.split("|");
    const index = column + (line.trimStart().startsWith("|") ? 1 : 0);
    const cell = cells[index];
    const text = cell === undefined ? null : toggleTaskLine(cell);
    if (text === null) {
      return null;
    }
    cells[index] = text;
    return cells.join("|");
  }
  const m = line.match(RE_TASK);
  if (!m) {
    return null;
  }
  const box = m[2] === " " ? "[x]" : "[ ]";
  return m[1] + box + line.slice(m[0].length);
}
