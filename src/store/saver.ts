// Hands the vault's changes to the store in the order they were made, one
// write at a time. Changes that arrive during a write go together in the next
// one. A write that fails is tried again, and nothing after it is written
// first, so the database never holds a later edit without an earlier one.

import type { Change } from "../core/node.ts";
import type { Store } from "./store.ts";

export type SaveStatus = "saved" | "saving" | "failed";

export interface SaverOptions {
  /** How long to wait before trying a failed write again. */
  retryMs?: number;
}

export class Saver {
  #store: Store;
  #queue: Change[][] = [];
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

  push(changes: Change[]): void {
    if (changes.length === 0) return;
    this.#queue.push(changes);
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
      const batch = this.#queue.flat();
      const count = this.#queue.length;
      try {
        await this.#store.save(batch);
        this.#queue.splice(0, count);
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
