// The tour in the app: added to a new vault the first time Brock starts with
// it, and shown or removed from the Help menu. Which map is the tour, and
// whether it was offered, belong to this computer, so they are kept in the
// window's storage, as the session is.

import { addTour } from "../demo/tour.ts";
import type { Vault } from "../core/vault.ts";

const KEY = "brock-tour";

interface Saved {
  /** Whether the first start has been and gone, tour or not. */
  offered: boolean;
  /** The tour's map, while there is one. */
  id: string | null;
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof Saved, unknown>>;
    return { offered: raw.offered === true, id: typeof raw.id === "string" ? raw.id : null };
  } catch {
    return { offered: false, id: null };
  }
}

function save(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch {
    // Without storage the tour may be offered again, to a vault still new.
  }
}

/** A vault no one has written in yet: its top alone, with no notes. */
function isNew(vault: Vault): boolean {
  const top = vault.get(vault.rootId)!;
  return vault.children(top.id).length === 0 && top.body.trim() === "";
}

/**
 * On the first start: the tour, if the vault is new, added as the app's own
 * doing, which ⌘Z does not take away. Returns its map, or null. A vault with
 * anything in it never gets one, nor does a vault emptied later.
 */
export function welcome(vault: Vault): string | null {
  const saved = load();
  if (saved.offered) return null;
  const id = isNew(vault) ? addTour(vault, vault.rootId) : null;
  vault.forgetUndo();
  save({ offered: true, id });
  return id;
}

/** The tour's map, if it is in the vault and not deleted. */
export function tourMap(vault: Vault): string | null {
  const { id } = load();
  return id && vault.isLive(id) ? id : null;
}

/** The tour's map: the one there is, or a fresh one under the top. */
export function showTour(vault: Vault): string {
  const id = tourMap(vault) ?? addTour(vault, vault.rootId);
  save({ offered: true, id });
  return id;
}

/** Moves the tour to the trash, as one step to undo. Returns whether there was one. */
export function removeTour(vault: Vault): boolean {
  const id = tourMap(vault);
  if (!id) return false;
  vault.delete(id);
  return true;
}
