// The system's clipboard, as text, and pictures put on it. In the app through Tauri's clipboard
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

/** Puts a picture on the clipboard, for pasting into other apps. */
export async function writePicture(canvas: HTMLCanvasElement): Promise<void> {
  if (inTauri()) {
    // The plugin takes the pixels themselves.
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const [{ Image }, plugin] = await Promise.all([import("@tauri-apps/api/image"), import("@tauri-apps/plugin-clipboard-manager")]);
    await plugin.writeImage(await Image.new(new Uint8Array(pixels.buffer), canvas.width, canvas.height));
  } else {
    const png = new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("No picture"))), "image/png"));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  }
}
