import { useEffect } from "react";
import { pickViewer } from "./route";
import { Toolbar } from "../shared/Toolbar";
import { TextViewer } from "../viewers/TextViewer";
import { JsonViewer } from "../viewers/JsonViewer";
import { MdViewer } from "../viewers/MdViewer";
import { IpynbViewer } from "../viewers/IpynbViewer";
import { Explorer } from "../viewers/explorer/Explorer";

// Reads the URL once per navigation and picks a viewer. The explorer then
// navigates itself (pushState) without a further read of this URL; every
// other viewer is a full page load per path, so this runs once per page.
export function App() {
  const path = decodeURIComponent(window.location.pathname);
  const search = window.location.search;
  const viewer = pickViewer(path, search);

  useEffect(() => {
    document.title = viewer === "explorer" ? "Files" : path.split("/").filter(Boolean).pop() ?? "dev-setup";
  }, [path, viewer]);

  if (viewer === "text") {
    return <TextViewer key={path} path={path} />;
  }
  if (viewer === "json") {
    return <JsonViewer key={path} path={path} />;
  }
  if (viewer === "md") {
    return <MdViewer key={path} path={path} />;
  }
  if (viewer === "ipynb") {
    return <IpynbViewer key={path} path={path} />;
  }
  if (viewer === "explorer") {
    return <Explorer />;
  }

  return (
    <>
      <Toolbar path={path} />
      <main style={{ padding: 24 }}>
        <p className="muted">
          No viewer for <code>{path}</code> yet (would use the <code>{viewer}</code> viewer).
        </p>
      </main>
    </>
  );
}
