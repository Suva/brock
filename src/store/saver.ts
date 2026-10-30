// Hands the vault's changes to the store in the order they were made, one
// write at a time, each edit as a write of its own, so that the log can tell
// one step from the next. A write that fails is tried again, and nothing after it is written
// first, so the database never holds a later edit without an earlier one.
// Removing nodes for good, when the trash is emptied, takes its turn in the
// same line.

import type { Change } from "../core/node.ts";
import type { Store } from "./store.ts";

export type SaveStatus = "saved" | "saving" | "failed";

export interface SaverOptions {
  /** How long to wait before trying a failed write again. */
  retryMs?: number;
}

export class Saver {
  #store: Store;
  #queue: ({ changes: Change[]; origin: string } | { purge: string[] })[] = [];
  #running: Promise<void> | null = null;
  #retryMs: number;
  #listeners: (() => void)[] = [];
  status: SaveStatus = "saved";
  /** Why the last write failed, while it is failing. */
  error: string | null = null;

  constructor(store: Store, options: SaverOptions = {}) {
    this.#store = store;
    this.#retryMs = options.retryMs ?? 2000;
  }

  /** `origin` says who made the changes, for the history: "user" if not said. */
  push(changes: Change[], origin = "user"): void {
    if (changes.length === 0) return;
    this.#queue.push({ changes, origin });
    this.#running ??= this.#run();
  }

  /** Removes nodes for good, after everything handed in before. */
  purge(ids: string[]): void {
    if (ids.length === 0) return;
    this.#queue.push({ purge: ids });
    this.#running ??= this.#run();
  }

  /** Resolves once everything handed in so far is written. */
  async flush(): Promise<void> {
    while (this.#running) await this.#running;
  }

  /** Calls `listener` whenever `status` changes; returns a way to stop. */
  onStatus(listener: () => void): () => void {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  async #run(): Promise<void> {
    this.#set("saving", null);
    while (this.#queue.length > 0) {
      const first = this.#queue[0];
      try {
        if ("changes" in first) await this.#store.save(first.changes, first.origin);
        else await this.#store.purge(first.purge);
        this.#queue.shift();
        if (this.status === "failed") this.#set("saving", null);
      } catch (error) {
        this.#set("failed", error instanceof Error ? error.message : String(error));
        await new Promise((resolve) => setTimeout(resolve, this.#retryMs));
      }
    }
    this.#running = null;
    this.#set("saved", null);
  }

  #set(status: SaveStatus, error: string | null): void {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    for (const listener of this.#listeners) listener();
  }
}
