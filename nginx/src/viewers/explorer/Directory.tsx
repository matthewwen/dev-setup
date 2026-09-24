import { useEffect, useMemo, useRef } from "react";
import type { Entry } from "./api";
import { icon, when } from "./format";
import { human } from "../../shared/format";
import { highlightAll } from "./highlight";
import { useChunked } from "./useChunked";

export type SortKey = "name" | "size" | "mtime";
export interface Sort {
  key: SortKey;
  dir: 1 | -1;
}

// Directories stay grouped ahead of files under every sort.
export function sortEntries(entries: Entry[], showHidden: boolean, filter: string, sort: Sort): Entry[] {
  let rows = entries;
  if (!showHidden) {
    rows = rows.filter(e => !e.hidden);
  }
  if (filter) {
    const f = filter.toLowerCase();
    rows = rows.filter(e => e.name.toLowerCase().includes(f));
  }
  const cmp: Record<SortKey, (a: Entry, b: Entry) => number> = {
    name: (a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1),
    size: (a, b) => a.size - b.size,
    mtime: (a, b) => a.mtime - b.mtime,
  };
  return [...rows].sort((a, b) => (a.type === b.type ? cmp[sort.key](a, b) * sort.dir : a.type === "dir" ? -1 : 1));
}

function TableHead({ sort, onSort }: { sort: Sort; onSort: (key: SortKey) => void }) {
  const arrow = (k: SortKey) => (sort.key === k ? (sort.dir > 0 ? " ▲" : " ▼") : "");
  return (
    <thead>
      <tr>
        <th onClick={() => onSort("name")}>Name{arrow("name")}</th>
        <th className="num" onClick={() => onSort("size")}>
          Size{arrow("size")}
        </th>
        <th className="when" onClick={() => onSort("mtime")}>
          Modified{arrow("mtime")}
        </th>
      </tr>
    </thead>
  );
}

export function Directory({
  rows,
  filter,
  hasParent,
  sort,
  onSort,
  selected,
  onActivateRow,
  onUp,
  onHoverDir,
}: {
  rows: Entry[];
  filter: string;
  hasParent: boolean;
  sort: Sort;
  onSort: (key: SortKey) => void;
  selected: number;
  onActivateRow: (i: number) => void;
  onUp: () => void;
  onHoverDir: (path: string) => void;
}) {
  const rx = useMemo(() => (filter ? new RegExp(filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi") : null), [filter]);
  const painted = useChunked(rows);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => {
    if (selected < 0) {
      return;
    }
    tableRef.current?.querySelector(`tbody tr[data-i="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  return (
    <>
      <table ref={tableRef}>
        <TableHead sort={sort} onSort={onSort} />
        <tbody>
          {hasParent && (
            <tr onClick={onUp}>
              <td className="name">
                <span className="ico">&#8617;</span>..
              </td>
              <td className="num" />
              <td className="when" />
            </tr>
          )}
          {painted.map((e, i) => (
            <tr
              key={e.path}
              data-i={i}
              className={i === selected ? "sel" : ""}
              onClick={() => onActivateRow(i)}
              onPointerOver={() => {
                if (e.type === "dir") {
                  onHoverDir(`/${e.path}`);
                }
              }}
            >
              <td className="name">
                <span className="ico">{icon(e)}</span>
                <span className={`${e.type === "dir" ? "dirname" : ""}${e.link ? " lnk" : ""}`}>
                  {highlightAll(e.name, rx)}
                </span>
              </td>
              <td className="num">{e.type === "dir" ? "—" : human(e.size)}</td>
              <td className="when">{when(e.mtime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="card">Nothing here{filter ? " matches the filter." : "."}</div>}
    </>
  );
}
