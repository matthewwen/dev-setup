import { useCallback, useState } from "react";

// The inline script in index.html sets document.documentElement.dataset.theme
// before first paint, from the same storage key, so the page never flashes
// the wrong theme. This module reads that state and lets the app change it.
const STORAGE_KEY = "md-theme";

export type Theme = "light" | "dark";

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  const toggle = useCallback(() => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
  }, [theme]);

  return [theme, toggle];
}
