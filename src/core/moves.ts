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

import { newBranch } from "./branches.ts";
import { sidesOf } from "./layout.ts";
import type { Node, Side } from "./node.ts";
import type { Vault } from "./vault.ts";

export interface Where {
  /** The centre of the map the node is moved in. */
  centreId: string;
  /** Whether the centre's children are shown in two columns, as on the map. */
  columns: boolean;
}


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

/** Where a node is put: under `parentId` at `index` among its other children, on `side` if that is the centre. */
export interface Place {
  parentId: string;
  index: number;
  side: Side | null;
}

/**
 * Puts a node where it was dropped. A node that becomes a branch of the
 * centre takes the side it was dropped on and, if it has none, a colour; a
 * folded parent unfolds to show it. Returns false when nothing would change.
 */
export function place(vault: Vault, id: string, to: Place, centreId: string): boolean {
  const node = vault.get(id);
  if (!node || node.parentId === null || id === centreId) return false;
  const others = vault.children(to.parentId).filter((n) => n.id !== id);
  const index = Math.max(0, Math.min(to.index, others.length));
  const stays =
    node.parentId === to.parentId &&
    vault.children(to.parentId).indexOf(node) === index &&
    (to.side === null || to.side === sidesOf(vault.children(to.parentId))[index]);
  if (stays) return false;
  vault.transact(() => {
    if (to.parentId === centreId || node.parentId === centreId) pinSides(vault, centreId);
    const parent = vault.get(to.parentId)!;
    if (parent.collapsed) vault.update(parent.id, { collapsed: false });
    vault.move(id, to.parentId, index);
    if (to.parentId === centreId) {
      const fields: { side?: Side; color?: string } = {};
      if (to.side) fields.side = to.side;
      // Dropped on the centre in the outline, which has no sides: the side a
      // new branch would take, so the map does not rebalance the others.
      else if (node.parentId !== centreId) fields.side = newBranch(others).side!;
      if (!node.color) fields.color = newBranch(others).color!;
      vault.update(id, fields);
    }
  });
  return true;
}

/**
 * The nodes of a selection that act on their own: those without a selected
 * ancestor (a branch moves, or goes, with its top), in the order of the
 * tree, leaving out the centre.
 */
export function topmost(vault: Vault, ids: Iterable<string>, centreId: string): string[] {
  const chosen = new Set(ids);
  const out: string[] = [];
  const visit = (id: string) => {
    for (const child of vault.children(id)) {
      if (chosen.has(child.id)) out.push(child.id);
      else visit(child.id);
    }
  };
  visit(centreId);
  return out;
}

/** Where several dragged nodes land: as `place`, with the node they go onto or beside. */
export interface Landing extends Place {
  beside: { id: string; after: boolean } | null;
}

/**
 * Puts several nodes where they were dropped, one after another in the
 * order given, as one step. Refused when the place is one of them or under
 * one of them. Returns whether anything moved.
 */
export function placeAll(vault: Vault, ids: string[], to: Landing, centreId: string): boolean {
  if (ids.length === 0) return false;
  const moving = new Set(ids);
  if (to.beside && moving.has(to.beside.id)) return false;
  const inside = [to.parentId, ...vault.ancestors(to.parentId).map((n) => n.id)];
  if (inside.some((id) => moving.has(id))) return false;
  return vault.transact(() => {
    let moved = false;
    let previous: string | null = null;
    for (const id of ids) {
      const others = vault.children(to.parentId).filter((n) => n.id !== id);
      // The first goes where it was dropped; each next one right after the one before.
      const index = previous
        ? others.findIndex((n) => n.id === previous) + 1
        : to.beside
          ? others.findIndex((n) => n.id === to.beside!.id) + (to.beside.after ? 1 : 0)
          : others.length;
      moved = place(vault, id, { parentId: to.parentId, index, side: to.side }, centreId) || moved;
      previous = id;
    }
    return moved;
  });
}
