import { mount } from "svelte";
import App from "./App.svelte";
import { Vault } from "../core/vault.ts";
import { DEMO_KEY } from "../demo/keys.ts";
import { MemoryStore } from "../store/memory-store.ts";
import { Saver } from "../store/saver.ts";
import type { Store } from "../store/store.ts";
import { inTauri, TauriStore } from "../store/tauri-store.ts";
import { Live } from "./live.svelte.ts";
import { savedSession, saveSession } from "./session.ts";
import { applyTheme, savedTheme } from "./theme.ts";
import "./app.css";

applyTheme(savedTheme());

async function start(target: HTMLElement) {
  // In a browser, outside the app, the vault is kept in local storage. The
  // demo on the website (built with `--mode demo`) starts from the tour.
  const store: Store = inTauri()
    ? new TauriStore()
    : import.meta.env.MODE === "demo"
      ? await demoStore()
      : new MemoryStore([], localStorage);
  const saver = new Saver(store);
  const vault = new Vault(await store.load(), {
    onChange: (changes) => saver.push(changes),
    onPurge: (ids) => saver.purge(ids),
  });
  mount(App, { target, props: { live: new Live(vault, saver) } });
  if (freshTour) {
    // The whole tour in view, as ⌘0 shows it, once the map has measured its nodes.
    setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", ctrlKey: true, bubbles: true })), 300);
  }
  showWindow();
  keepUntilSaved(saver);
  fitTitleBar();
}

/** Whether the demo opens on the tour as it comes, rather than the visitor's own map. */
let freshTour = false;

/**
 * The demo's store: the visitor's map if there is one, or else the tour,
 * opened with the notes beside it, where the tour's hints are.
 */
async function demoStore(): Promise<Store> {
  freshTour = localStorage.getItem(DEMO_KEY) === null;
  if (freshTour) {
    saveSession({ ...savedSession(), map: null, node: null, notesOpen: true });
  }
  return new MemoryStore((await import("../demo/tour.ts")).tour(), localStorage, DEMO_KEY);
}

/**
 * On a Mac the window has no title bar of its own: the header takes its
 * place, with the window's buttons over its left end (`titleBarStyle` in
 * tauri.conf.json). The header leaves room for them, except in full screen,
 * where macOS hides them.
 */
function fitTitleBar() {
  if (!inTauri() || !navigator.platform.startsWith("Mac")) return;
  const root = document.documentElement;
  root.classList.add("mac-titlebar");
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    const check = async () => root.classList.toggle("fullscreen", await win.isFullscreen());
    check();
    win.onResized(check);
  });
}

/** How long closing waits for a save that is failing, before it closes anyway. */
const CLOSE_WAIT_MS = 5000;

/**
 * Closing the window waits for what is still being saved. Saves take
 * milliseconds, so this is rarely seen; a disk that refuses them would keep
 * the window open for a few seconds at most.
 */
function keepUntilSaved(saver: Saver) {
  if (inTauri()) {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      win.onCloseRequested(async (event) => {
        if (saver.status === "saved") return;
        event.preventDefault();
        await Promise.race([saver.flush(), new Promise((r) => setTimeout(r, CLOSE_WAIT_MS))]);
        await win.destroy();
      });
    });
  } else {
    // A browser can only ask the person to stay.
    window.addEventListener("beforeunload", (event) => {
      if (saver.status !== "saved") event.preventDefault();
    });
  }
}

const target = document.getElementById("app")!;
start(target).catch((error) => {
  target.textContent = `The vault could not be opened: ${error instanceof Error ? error.message : error}`;
  target.className = "fatal";
  showWindow();
});

/**
 * Shows the app's window, which starts hidden (`visible: false` in
 * tauri.conf.json) so that it does not flash white before the page is
 * there in its colours. By now the styles are loaded and the window's
 * contents made, so it can show at once: a hidden window may draw no frames
 * to wait for. Should this never run, the native side shows the window
 * after a few seconds anyway.
 */
function showWindow() {
  if (!inTauri()) return;
  import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().show());
}
