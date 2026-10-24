import { inTauri } from "../store/tauri-store.ts";

/**
 * Whether the app draws its own title bar: on Windows the window has none of
 * its own (tauri.windows.conf.json), so the header carries the window's
 * buttons and the menu bar's menus live under its ☰ button.
 */
export const customTitleBar = () => inTauri() && navigator.platform.startsWith("Win");
