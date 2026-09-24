import type { SearchMode, SearchOk } from "./api";
import { human } from "../../shared/format";
import { highlightAll } from "./highlight";

export interface SearchOptionsValue {
  mode: SearchMode;
  here: boolean;
  glob: string;
  regex: boolean;
  case: boolean;
}

const MODES: SearchMode[] = ["content", "names", "both"];

export function SearchOptionsBar({ value, onChange }: { value: SearchOptionsValue; onChange: (next: SearchOptionsValue) => void }) {
  return (
    <>
      <div className="seg">
        {MODES.map(m => (
          <button key={m} className={value.mode === m ? "on" : ""} onClick={() => onChange({ ...value, mode: m })}>
            {m[0].toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
      <label className="chk">
        <input type="checkbox" checked={value.here} onChange={e => onChange({ ...value, here: e.target.checked })} />
        this subtree
      </label>
      <label>
        glob{" "}
        <input
          type="text"
          placeholder="*.md,*.yaml"
          spellCheck={false}
          value={value.glob}
          onChange={e => onChange({ ...value, glob: e.target.value })}
        />
      </label>
      <label className="chk">
        <input type="checkbox" checked={value.regex} onChange={e => onChange({ ...value, regex: e.target.checked })} />
        regex
      </label>
      <label className="chk">
        <input type="checkbox" checked={value.case} onChange={e => onChange({ ...value, case: e.target.checked })} />
        case
      </label>
    </>
  );
}

export function SearchResults({
  data,
  query,
  rx,
  selected,
  onSelectFile,
}: {
  data: SearchOk;
  query: string;
  rx: RegExp | null;
  selected: number;
  onSelectFile: (i: number) => void;
}) {
  if (!data.count) {
    return (
      <div className="card">
        No match for <b>{query}</b> in {data.scope}.
      </div>
    );
  }
  return (
    <div id="results">
      {data.results.map((r, i) => (
        <div
          key={r.path}
          className={i === selected ? "file sel" : "file"}
          onClick={e => {
            if ((e.target as HTMLElement).closest("a")) {
              return;
            }
            onSelectFile(i);
          }}
        >
          <div className="fhead">
            <a className="fname" href={r.url}>
              {highlightAll(r.name, rx)}
            </a>
            {r.dir && <span className="fdir">{r.dir}/</span>}
            <span className="spacer" />
            {r.matches.length > 0 && (
              <span className="fmeta">
                {r.matches.length} line{r.matches.length === 1 ? "" : "s"}
              </span>
            )}
            <a className="fmeta" href={`${r.url}?raw=1`}>
              raw
            </a>
          </div>
          {r.matches.length ? (
            r.matches.map((m, k) => (
              <div className="line" key={k}>
                <span className="no">{m.line}</span>
                <span>{highlightAll(m.text, rx)}</span>
              </div>
            ))
          ) : (
            <div className="empty">{r.size !== undefined ? human(r.size) : "name match"}</div>
          )}
        </div>
      ))}
    </div>
  );
}
