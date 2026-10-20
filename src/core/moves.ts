// Moving a node from the keyboard: up and down among its siblings, in under
// the sibling above it, out to beside its parent, and across the centre. The
// same moves serve the map and the outline. Each is one undo step and returns
// whether it moved anything.
//
// On a map, the centre's children are in two columns (`columns`). Their order
// in the vault interleaves the two, so there moving one up or down skips the
// siblings on the other side. In the outline they are one list. Either way
// the sides of all of them are fixed before one moves: otherwise changing the
// order would rebalance the columns and move other nodes across.

export interface Where {
  /** The centre of the map the node is moved in. */
  centreId: string;
  /** Whether the centre's children are shown in two columns, as on the map. */
  columns: boolean;
}

import { sidesOf } from "./layout.ts";
import type { Node, Side } from "./node.ts";
import type { Vault } from "./vault.ts";

/** Gives every child of the centre the side it is drawn on now, so that none moves across. */
function pinSides(vault: Vault, centreId: string): void {
  const kids = vault.children(centreId);
  const sides = sidesOf(kids);
  kids.forEach((kid, i) => {
    if (kid.side === null) vault.update(kid.id, { side: sides[i] });
  });
}

/** The node's siblings as they are shown: for children of the centre, those on its side. */
function shownSiblings(vault: Vault, node: Node, { centreId, columns }: Where): Node[] {
  const siblings = [...vault.children(node.parentId!)];
  if (node.parentId !== centreId || !columns) return siblings;
  const sides = sidesOf(siblings);
  const mine = sides[siblings.indexOf(node)];
  return siblings.filter((_, i) => sides[i] === mine);
}

/** Moves a node one place up (-1) or down (+1) among the siblings shown with it. */
export function reorder(vault: Vault, id: string, step: -1 | 1, where: Where): boolean {
  const { centreId } = where;
  const node = vault.get(id);
  if (!node || node.parentId === null || id === centreId) return false;
  const shown = shownSiblings(vault, node, where);
  const target = shown[shown.indexOf(node) + step];
  if (!target) return false;
  vault.transact(() => {
    if (node.parentId === centreId) pinSides(vault, centreId);
    // Positions are counted among the other siblings, without the node.
    const others = vault.children(node.parentId!).filter((n) => n.id !== id);
    const at = others.findIndex((n) => n.id === target.id);
    vault.move(id, node.parentId!, step < 0 ? at : at + 1);
  });
  return true;
}

/** Moves a node in, to be the last child of the sibling shown above it. */
export function indent(vault: Vault, id: string, where: Where): boolean {
  const node = vault.get(id);
  if (!node || node.parentId === null || id === where.centreId) return false;
  const shown = shownSiblings(vault, node, where);
  const above = shown[shown.indexOf(node) - 1];
  // A map above would take the node out of sight, into a map of its own.
  if (!above || above.isMap) return false;
  vault.transact(() => {
    if (above.collapsed) vault.update(above.id, { collapsed: false });
    vault.move(id, above.id, vault.children(above.id).length);
  });
  return true;
}

/** Moves a node out, to just after its parent. A child of the centre stays where it is. */
export function outdent(vault: Vault, id: string, { centreId }: Where): boolean {
  const node = vault.get(id);
  if (!node || node.parentId === null || node.parentId === centreId || id === centreId) return false;
  const parent = vault.get(node.parentId)!;
  if (parent.parentId === null) return false;
  vault.transact(() => {
    let side: Side | null = null;
    if (parent.parentId === centreId) {
      // Becoming a child of the centre: it goes on its old branch's side.
      pinSides(vault, centreId);
      side = vault.get(parent.id)!.side;
    }
    const others = vault.children(parent.parentId!).filter((n) => n.id !== id);
    vault.move(id, parent.parentId!, others.findIndex((n) => n.id === parent.id) + 1);
    if (side) vault.update(id, { side });
  });
  return true;
}

/** Moves a child of the centre to the other side of it. */
export function setSide(vault: Vault, id: string, side: Side, centreId: string): boolean {
  const node = vault.get(id);
  if (!node || node.parentId !== centreId) return false;
  const kids = vault.children(centreId);
  if (sidesOf(kids)[kids.indexOf(node)] === side) return false;
  vault.transact(() => {
    pinSides(vault, centreId);
    vault.update(id, { side });
  });
  return true;
}
