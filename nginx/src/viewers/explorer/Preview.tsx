import { previewable } from "./format";

export interface PreviewTarget {
  url: string;
  name: string;
  isDir: boolean;
}

// A directory previews as its plain nginx index, a file as its viewer or raw.
// `open` and `target` are separate: the pane can be open with nothing
// selected yet, right after the reader clicks Preview with no active row.
export function Preview({ open, target, onClose }: { open: boolean; target: PreviewTarget | null; onClose: () => void }) {
  const src = target ? (target.isDir ? target.url : previewable(target.url) ? target.url : `${target.url}?raw=1`) : "about:blank";
  return (
    <aside id="preview" className={open ? "on" : ""}>
      <div className="phead">
        <span className="pname">{target ? target.name + (target.isDir ? "/" : "") : ""}</span>
        <a className="btn" target="_blank" rel="noreferrer" href={target?.url ?? "#"}>
          Open
        </a>
        <button className="btn" onClick={onClose}>
          &times;
        </button>
      </div>
      <iframe id="pFrame" title="preview" src={src} />
    </aside>
  );
}
