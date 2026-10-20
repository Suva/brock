import { mount } from "svelte";
import App from "./App.svelte";
import { Vault } from "../core/vault.ts";
import { MemoryStore } from "../store/memory-store.ts";
import { Saver } from "../store/saver.ts";
import type { Store } from "../store/store.ts";
import { inTauri, TauriStore } from "../store/tauri-store.ts";
import { Live } from "./live.svelte.ts";
import "./app.css";

async function start(target: HTMLElement) {
  // In a browser, outside the app, the vault is kept in local storage.
  const store: Store = inTauri() ? new TauriStore() : new MemoryStore([], localStorage);
  const saver = new Saver(store);
  const vault = new Vault(await store.load(), { onChange: (changes) => saver.push(changes) });
  mount(App, { target, props: { live: new Live(vault, saver) } });
}

const target = document.getElementById("app")!;
start(target).catch((error) => {
  target.textContent = `The vault could not be opened: ${error instanceof Error ? error.message : error}`;
  target.className = "fatal";
});
