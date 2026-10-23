// Files and folders dragged onto the window from Finder or Explorer. In the
// app, Tauri hands over their paths, which a page is never given; a browser
// gives none, so there nothing happens.

import { inTauri } from "../store/tauri-store.ts";

export interface FileDrops {
  /** Files are dragged over the window: the element under them, or null once they leave. */
  over: (under: Element | null) => void;
  /** Files were dropped on the element under them. */
  drop: (paths: string[], under: Element | null) => void;
}

/** Calls `on` for every drag of files over the window, until the function it returns is called. */
export function watchFileDrops(on: FileDrops): () => void {
  if (!inTauri()) return () => {};
  let unlisten: (() => void) | null = null;
  let stopped = false;
  // Tauri calls the position physical, but only Windows gives the screen's
  // pixels; a Mac and Linux give the page's own, which a Retina screen has
  // two of to each pixel, so dividing there lands halfway to the corner.
  const scale = navigator.platform.startsWith("Win") ? devicePixelRatio : 1;
  const under = (p: { x: number; y: number }) => document.elementFromPoint(p.x / scale, p.y / scale);
  import("@tauri-apps/api/webview")
    .then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type === "enter" || payload.type === "over") on.over(under(payload.position));
        else if (payload.type === "leave") on.over(null);
        else {
          on.over(null);
          on.drop(payload.paths, under(payload.position));
        }
      }),
    )
    .then((stop) => (stopped ? stop() : (unlisten = stop)));
  return () => {
    stopped = true;
    unlisten?.();
  };
}
