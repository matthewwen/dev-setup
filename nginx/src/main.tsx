import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./app/tokens.scss";
import "./app/base.scss";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
