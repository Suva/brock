// Copy, cut and paste of branches. A copy is outlines (exchange.ts), which
// carry everything under them, maps inside included; pasting makes new
// nodes of them. A cut deletes the branches and, when pasted, brings the
// same nodes back at the new place, so that links to them still hold.

import { newBranch } from "./branches.ts";
import { importInto, markdownList, outlineOf, type Outline } from "./exchange.ts";
import type { Node } from "./node.ts";
import type { Vault } from "./vault.ts";

export interface Clip {
  /** What was put on the system's clipboard, to know a paste is this clip. */
  text: string;
  outlines: Outline[];
  /** For a cut: the nodes cut, which a paste moves rather than copies. */
  cut: string[] | null;
}

/** A clip of branches, everything under them included, and its text for other apps. */
export function copyOf(vault: Vault, ids: string[]): Clip {
  const outlines = ids.map((id) => outlineOf(vault, id));
  return { text: markdownList(outlines), outlines, cut: null };
}

/** Cuts branches: they are copied and deleted, as one step. */
export function cut(vault: Vault, ids: string[]): Clip {
  const clip = copyOf(vault, ids);
  vault.transact(() => ids.forEach((id) => vault.delete(id)));
  return { ...clip, cut: ids };
}

/**
 * Pastes a clip under `parentId`, last, as one step, and returns the nodes
 * pasted, at the top of their branches. A cut is moved there, if its nodes
 * are still in the trash; otherwise, and for a copy, new nodes are made,
 * keeping links to nodes of the vault that are still there.
 */
export function paste(vault: Vault, clip: Clip, parentId: string, centreId: string): Node[] {
  const waiting = clip.cut?.filter((id) => {
    const n = vault.get(id);
    return n && n.deletedAt !== null;
  });
  if (clip.cut && waiting && waiting.length === clip.cut.length && !waiting.some((id) => underOrIs(vault, parentId, id))) {
    return vault.transact(() =>
      waiting.map((id) => {
        vault.restoreTo(id, parentId);
        if (parentId === centreId) {
          // A branch of the centre gets a side, and a colour if it had none.
          const node = vault.get(id)!;
          const others = vault.children(parentId).filter((n) => n.id !== id);
          const fields = newBranch(others);
          vault.update(id, node.color ? { side: fields.side } : fields);
        }
        return vault.get(id)!;
      }),
    );
  }
  return importInto(vault, parentId, clip.outlines, centreId, (id) => vault.isLive(id));
}

function underOrIs(vault: Vault, id: string, ancestor: string): boolean {
  return id === ancestor || vault.ancestors(id).some((n) => n.id === ancestor);
}
