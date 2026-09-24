import { useEffect, useState, type ReactNode } from "react";
import { headSize, rawUrl, textViewUrl } from "./fetch";

type Check = "pending" | "ok" | "big";

// HEADs a file before a viewer renders it whole. Over the limit, offers the
// buffered text viewer, the raw bytes, or rendering anyway - the three-way
// choice every viewer's tooBig() card gave today, now shared.
export function SizeGuard({
  path,
  limitBytes,
  children,
}: {
  path: string;
  limitBytes: number;
  children: ReactNode;
}) {
  const [check, setCheck] = useState<Check>("pending");
  const [proceedAnyway, setProceedAnyway] = useState(false);

  // The viewer that renders this is keyed on its path, so a new path mounts a
  // new SizeGuard with fresh state.
  useEffect(() => {
    let cancelled = false;
    headSize(path)
      .then(size => {
        if (!cancelled) {
          setCheck(size !== null && size > limitBytes ? "big" : "ok");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCheck("ok");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [path, limitBytes]);

  if (check === "pending") {
    return null;
  }

  if (check === "big" && !proceedAnyway) {
    return (
      <div className="card error">
        This file is large. Rendering it whole would block the page.
        <br />
        <br />
        <a href={textViewUrl(path)}>Open the buffered text viewer</a>
        {" · "}
        <a href={rawUrl(path)}>Raw</a>
        {" · "}
        <a
          href="#"
          onClick={e => {
            e.preventDefault();
            setProceedAnyway(true);
          }}
        >
          Render anyway
        </a>
      </div>
    );
  }

  return <>{children}</>;
}
