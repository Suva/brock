// The system's clipboard, as text. In the app through Tauri's clipboard
// plugin: WebKit, the engine on a Mac, gives a page no copy or paste events
// without a text selection, and asks before every read. In a browser through
// its own clipboard. Read only when ⌘V is pressed.

import { inTauri } from "../store/tauri-store.ts";

export async function writeText(text: string): Promise<void> {
  if (inTauri()) {
    const plugin = await import("@tauri-apps/plugin-clipboard-manager");
    await plugin.writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}

export async function readText(): Promise<string> {
  if (inTauri()) {
    const plugin = await import("@tauri-apps/plugin-clipboard-manager");
    return (await plugin.readText()) ?? "";
  }
  return navigator.clipboard.readText();
}
