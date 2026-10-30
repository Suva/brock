// The vault and the saver made reactive for Svelte. Both are plain objects
// that call listeners; this turns those calls into state, so that anything
// that reads the vault through `version` is drawn again when it changes.

import type { LogEntry } from "../core/activity.ts";
import type { Vault } from "../core/vault.ts";
import type { SaveStatus, Saver } from "../store/saver.ts";

export class Live {
  readonly vault: Vault;
  version = $state(0);
  saveStatus = $state<SaveStatus>("saved");
  saveError = $state<string | null>(null);
  /** Waits until every change so far is saved. */
  readonly saved: () => Promise<void>;
  /** The latest entries of the log, newest first, once everything so far is saved. */
  readonly history: (limit: number) => Promise<LogEntry[]>;

  constructor(vault: Vault, saver: Saver, history: (limit: number) => Promise<LogEntry[]> = async () => []) {
    this.vault = vault;
    this.history = async (limit) => {
      await saver.flush();
      return history(limit);
    };
    this.version = vault.version;
    this.saveStatus = saver.status;
    this.saved = () => saver.flush();
    vault.onChange(() => (this.version = vault.version));
    saver.onStatus(() => {
      this.saveStatus = saver.status;
      this.saveError = saver.error;
    });
  }
}
