const DAY_MS = 86400000;

export function formatAgo(unixSeconds: number, now = Date.now()): string {
  const mins = Math.floor((now - unixSeconds * 1000) / 60000);
  if (mins < 1) {
    return "just now";
  }
  if (mins < 60) {
    return `${mins}m ago`;
  }
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

// Day boundaries are local midnight, so "Yesterday" means the previous
// calendar day, not the previous 24 hours.
export function dateGroup(unixSeconds: number, now = new Date()): string {
  const t = unixSeconds * 1000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (t >= today) {
    return "Today";
  }
  if (t >= today - DAY_MS) {
    return "Yesterday";
  }
  if (t >= today - 6 * DAY_MS) {
    return "Previous 7 days";
  }
  if (t >= today - 29 * DAY_MS) {
    return "Previous 30 days";
  }
  return new Date(t).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Sorts newest first before grouping: rows still in another sort's order (the
// fetch for a new sort has not landed yet) would otherwise repeat a label.
export function groupByDate<T>(rows: T[], at: (row: T) => number, now = new Date()): [string, T[]][] {
  const groups: [string, T[]][] = [];
  for (const row of [...rows].sort((a, b) => at(b) - at(a))) {
    const label = dateGroup(at(row), now);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) {
      last[1].push(row);
    } else {
      groups.push([label, [row]]);
    }
  }
  return groups;
}
