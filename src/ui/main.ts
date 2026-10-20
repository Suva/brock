import { mount } from "svelte";
import App from "./App.svelte";
import { Vault } from "../core/vault.ts";
import { MemoryStore } from "../store/memory-store.ts";
import { Saver } from "../store/saver.ts";
import type { Store } from "../store/store.ts";
import { inTauri, TauriStore } from "../store/tauri-store.ts";
import { Live } from "./live.svelte.ts";
import { applyTheme, savedTheme } from "./theme.ts";
import "./app.css";

applyTheme(savedTheme());

async function start(target: HTMLElement) {
  // In a browser, outside the app, the vault is kept in local storage.
  const store: Store = inTauri() ? new TauriStore() : new MemoryStore([], localStorage);
  const saver = new Saver(store);
  const vault = new Vault(await store.load(), {
    onChange: (changes) => saver.push(changes),
    onPurge: (ids) => saver.purge(ids),
  });
  mount(App, { target, props: { live: new Live(vault, saver) } });
  keepUntilSaved(saver);
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
});
