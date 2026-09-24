import { useEffect } from "react";

export interface KeyActions {
  focusSearch: () => void;
  moveSelection: (delta: number | "start" | "end") => void;
  activateSelected: () => void;
  goUp: () => void;
  togglePreview: () => void;
  refresh: () => void;
  onEscape: () => void;
}

// j/k move, g/G jump, Enter opens, u/Backspace go up, p toggles the preview,
// r refreshes, / focuses search, Escape clears the search or closes preview.
export function useKeys(actions: KeyActions): void {
  useEffect(() => {
    function onKeydown(e: KeyboardEvent) {
      const typing = /^(INPUT|TEXTAREA)$/.test((document.activeElement as HTMLElement | null)?.tagName ?? "");
      if (e.key === "/" && !typing) {
        e.preventDefault();
        actions.focusSearch();
        return;
      }
      if (typing) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      switch (e.key) {
        case "j":
        case "ArrowDown":
          actions.moveSelection(1);
          break;
        case "k":
        case "ArrowUp":
          actions.moveSelection(-1);
          break;
        case "g":
          actions.moveSelection("start");
          break;
        case "G":
          actions.moveSelection("end");
          break;
        case "Enter":
          actions.activateSelected();
          break;
        case "u":
        case "Backspace":
          actions.goUp();
          break;
        case "p":
          actions.togglePreview();
          break;
        case "r":
          actions.refresh();
          break;
        case "Escape":
          actions.onEscape();
          break;
        default:
          return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [actions]);
}
