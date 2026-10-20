// The vault in the app's SQLite database, through the commands in src-tauri/src/lib.rs.

import { invoke } from "@tauri-apps/api/core";
import type { Change, Node } from "../core/node.ts";
import type { Store } from "./store.ts";

export class TauriStore implements Store {
  load(): Promise<Node[]> {
    return invoke<Node[]>("load_vault");
  }

  save(changes: Change[]): Promise<void> {
    return invoke("apply_changes", { changes });
  }

  purge(ids: string[]): Promise<void> {
    return invoke("purge_nodes", { ids });
  }
}

/** Whether the window runs inside the app, rather than in a browser. */
export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
