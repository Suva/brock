// Opens a web address in the person's browser, never inside the app: through
// Tauri's opener in the app, as a new tab in a browser.

import { inTauri } from "../store/tauri-store.ts";

export async function openUrl(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  if (inTauri()) {
    const opener = await import("@tauri-apps/plugin-opener");
    await opener.openUrl(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
