import type { Heading } from "./render.ts";

export interface TocEntry {
  lvl: number;
  id: string;
  text: string;
}

// h2 through h4 by default - h1 is the document title, and deeper headings
// would make the sidebar noisy. A notebook has no single document title, so
// it widens the range to h1-h3.
export function tocEntries(headings: Heading[], minLvl = 2, maxLvl = 4): TocEntry[] {
  return headings.filter(h => h.lvl >= minLvl && h.lvl <= maxLvl);
}

// A document with only one or two headings does not need a sidebar.
export function shouldShowToc(entries: TocEntry[]): boolean {
  return entries.length >= 3;
}
