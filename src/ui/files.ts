// Saving and opening files for export and import. In the app, the dialogs
// are opened by the native side, which writes and reads the file: the window
// never names a path. In a browser, a file is downloaded, and one is chosen
// with the browser's own picker.

import { invoke } from "@tauri-apps/api/core";
import { inTauri } from "../store/tauri-store.ts";

export type FileKind = "json" | "md" | "opml" | "svg";

const TYPES: Record<FileKind | "png", string> = {
  json: "application/json",
  md: "text/markdown",
  opml: "text/x-opml",
  svg: "image/svg+xml",
  png: "image/png",
};

/** Saves text as a file named `name` (without its extension). Returns the name saved as, or null if cancelled. */
export async function saveText(name: string, content: string, kind: FileKind): Promise<string | null> {
  const file = `${safeName(name)}.${kind}`;
  if (inTauri()) return invoke<string | null>("save_text", { name: file, content, kind });
  return download(new Blob([content], { type: TYPES[kind] }), file);
}

/** Saves a PNG picture, as `saveText` saves text. */
export async function savePNG(name: string, bytes: Uint8Array): Promise<string | null> {
  const file = `${safeName(name)}.png`;
  if (inTauri()) return invoke<string | null>("save_bytes", { name: file, bytes: Array.from(bytes), kind: "png" });
  return download(new Blob([bytes as BlobPart], { type: TYPES.png }), file);
}

/** In a browser: the file downloaded. */
function download(blob: Blob, file: string): string {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: file });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return file;
}

/** Asks for an OPML or JSON file and reads it. Null if cancelled. */
export async function openText(): Promise<string | null> {
  if (inTauri()) return invoke<string | null>("open_text");
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".opml,.xml,.json" });
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) file.text().then(resolve, () => resolve(null));
      else resolve(null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** A title made fit to be a file's name everywhere. */
function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Mind map";
}
