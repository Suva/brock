// The app's own updates, through Tauri's updater: it reads latest.json from
// the newest release on GitHub (`plugins.updater` in tauri.conf.json) and,
// when that names a newer version, the window offers it. Nothing is
// downloaded or installed until the person says so. In a browser, and in
// the website's demo, there is nothing to update.
//
// Whether to look by itself belongs to this computer, not the vault, so it is
// kept in the window's own storage.

import type { Update } from "@tauri-apps/plugin-updater";
import { inTauri } from "../store/tauri-store.ts";

export type { Update };

const KEY = "brock-updates";

/** Whether the app looks for updates by itself. On unless turned off in Settings. */
export function updatesOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setUpdatesOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Without storage the choice lasts until the window closes.
  }
}

/**
 * The website's "What's new", made from CHANGELOG.md, at a version's changes:
 * the offer links there, in the browser, rather than showing notes itself.
 */
export const whatsNew = (version: string) => `https://brock.clysuva.com/changes.html#v${version}`;

/** Whether this window can update itself at all: only the app can. */
export const canUpdate = () => inTauri();

/** The newer version, if there is one; null if this is the newest. Throws when the releases cannot be reached. */
export async function findUpdate(): Promise<Update | null> {
  if (!canUpdate()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  return check({ timeout: 30_000 });
}

/**
 * Downloads the update, installs it and starts the app again. `progress` is
 * told the share downloaded, 0 to 1, when the size is known. Everything is
 * saved first: on Windows the installer closes the app without asking it.
 */
export async function installUpdate(update: Update, saved: () => Promise<void>, progress: (share: number | null) => void): Promise<void> {
  let size = 0;
  let done = 0;
  await saved();
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") size = event.data.contentLength ?? 0;
    else if (event.event === "Progress") done += event.data.chunkLength;
    progress(size ? Math.min(1, done / size) : null);
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/** How long after the start the app first looks, so that it does not slow the start. */
const FIRST_LOOK_MS = 5_000;
/** How often it looks again while it stays open. */
const LOOK_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Looks for an update a little after the start, and once a day while the
 * app stays open, if updates are on; tells `found` of one. A failure, such as
 * having no network, is kept quiet: it is tried again the next time.
 */
export function watchForUpdates(found: (update: Update) => void): void {
  if (!canUpdate()) return;
  const look = () => {
    if (!updatesOn()) return;
    findUpdate().then(
      (update) => update && found(update),
      (error) => console.warn("Could not look for an update:", error),
    );
  };
  setTimeout(look, FIRST_LOOK_MS);
  setInterval(look, LOOK_EVERY_MS);
}
