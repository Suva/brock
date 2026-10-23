// Opens a web address in the person's browser, never inside the app: through
// Tauri's opener in the app, as a new tab in a browser. Opens a file linked
// from a note too, in the app only, where Rust decides whether it may be
// opened or only shown in Finder or Explorer (`open_file` in lib.rs).

import { invoke } from "@tauri-apps/api/core";
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

/** Whether files linked from notes can be opened here: in the app, not in a browser. */
export const opensFiles = inTauri;

export async function openFile(url: string): Promise<void> {
  if (inTauri()) await invoke("open_file", { url });
}
