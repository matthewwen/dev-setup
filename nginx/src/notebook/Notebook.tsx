import { CopyButton } from "../shared/CopyButton";
import type { CellModel, NotebookModel, OutputModel } from "./render";
import "./Notebook.css";
import "../markdown/Markdown.css";

function Output({ o }: { o: OutputModel }) {
  switch (o.kind) {
    case "stream":
    case "error":
      return (
        <div className={o.kind === "error" || o.err ? "out err" : "out"}>
          <pre>{o.text}</pre>
        </div>
      );
    case "html":
      return (
        <div className="out html">
          {o.label && <div className="outlabel">{o.label}</div>}
          <div dangerouslySetInnerHTML={{ __html: o.html }} />
        </div>
      );
    case "image":
      return (
        <div className="out">
          {o.label && <div className="outlabel">{o.label}</div>}
          <img src={o.src} alt="" />
        </div>
      );
    case "markdown":
      return (
        <div className="out markdown-body">
          {o.label && <div className="outlabel">{o.label}</div>}
          <div dangerouslySetInnerHTML={{ __html: o.html }} />
        </div>
      );
    case "text":
      return (
        <div className="out">
          {o.label && <div className="outlabel">{o.label}</div>}
          <pre>{o.text}</pre>
        </div>
      );
  }
}

function Cell({ cell }: { cell: CellModel }) {
  if (cell.kind === "markdown") {
    return (
      <section className="cell md">
        <div className="gutter" />
        <div className="cell-body markdown-body" dangerouslySetInnerHTML={{ __html: cell.html }} />
      </section>
    );
  }
  if (cell.kind === "raw") {
    return (
      <section className="cell raw">
        <div className="gutter">raw</div>
        <div className="cell-body">
          <pre>
            <code>{cell.source}</code>
          </pre>
        </div>
      </section>
    );
  }
  return (
    <section className="cell code">
      <div className="gutter">In [{cell.executionCount == null ? " " : cell.executionCount}]</div>
      <div className="cell-body">
        <pre>
          <CopyButton text={() => cell.source} label="copy" copiedLabel="copied" delayMs={1200} className="copy" />
          <span className="lang">{cell.lang}</span>
          <code dangerouslySetInnerHTML={{ __html: cell.sourceHtml }} />
        </pre>
        {cell.outputs.length > 0 && (
          <div className="outputs">
            {cell.outputs.map((o, i) => (
              <Output key={i} o={o} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Notebook({ model }: { model: NotebookModel }) {
  return (
    <>
      <div id="meta">
        {model.kernel} &middot; {model.cellCount} cells &middot; nbformat {model.nbformat}
      </div>
      <div id="body">
        {model.cells.map((cell, i) => (
          <Cell key={i} cell={cell} />
        ))}
      </div>
    </>
  );
}
