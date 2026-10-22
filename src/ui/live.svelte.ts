// The vault and the saver made reactive for Svelte. Both are plain objects
// that call listeners; this turns those calls into state, so that anything
// that reads the vault through `version` is drawn again when it changes.

import type { Vault } from "../core/vault.ts";
import type { SaveStatus, Saver } from "../store/saver.ts";

export class Live {
  readonly vault: Vault;
  version = $state(0);
  saveStatus = $state<SaveStatus>("saved");
  saveError = $state<string | null>(null);
  /** Waits until every change so far is saved. */
  readonly saved: () => Promise<void>;

  constructor(vault: Vault, saver: Saver) {
    this.vault = vault;
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
