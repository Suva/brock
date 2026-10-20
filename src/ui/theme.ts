// Light, dark, or as the system is. The choice belongs to this computer, not
// the vault, so it is kept in the window's own storage.

export type Theme = "system" | "light" | "dark";

const KEY = "mindmap-theme";

export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}
