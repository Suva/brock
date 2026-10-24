// Where a node dragged on a map would land if let go at a point. On the
// middle of another node: it becomes that node's last child (going into it,
// if it is a map). On the top or bottom quarter of a node, or near one: it
// goes beside it, before or after, which also carries it across the centre
// when that node is on the other side. Far from everything: nowhere, and
// letting go puts it back. The outline's rows have their own, simpler rule:
// `outlineDropAt`.

import { sidesOf, type Layout, type Placed, type Tree } from "./layout.ts";
import type { Place } from "./moves.ts";
import type { Side } from "./node.ts";

export interface Drop extends Place {
  /** The node it goes onto, to highlight. */
  onto: string | null;
  /** The node it goes beside, and on which side of it, to draw a line there. */
  beside: { id: string; after: boolean } | null;
}

/** How near a node the point has to be to go beside it, in pixels of the map. */
const REACH = 120;
/** The share of a node's height at its top and bottom that means beside it, not onto it. */
const EDGE = 0.25;

/** `dragged`: the node dragged, or all the nodes dragged together. */
export function dropAt(tree: Tree, layout: Layout, dragged: string | string[], x: number, y: number): Drop | null {
  const ids = new Set(typeof dragged === "string" ? [dragged] : dragged);
  const draggedId = typeof dragged === "string" ? dragged : dragged[0];
  if (!layout.byId.has(draggedId)) return null;
  const inBranch = (p: Placed) => {
    // Whether `p` is a dragged node or under one: nothing can go there.
    for (let q: Placed | undefined = p; q; q = q.node.parentId ? layout.byId.get(q.node.parentId) : undefined) {
      if (ids.has(q.node.id)) return true;
    }
    return false;
  };
  const candidates = layout.placed.filter((p) => !inBranch(p));
  // Positions count among the children in the vault's order, all of them,
  // without the dragged node.
  const others = (id: string) => tree.children(id).filter((n) => !ids.has(n.id));
  const sideOfPoint: Side = x < 0 ? "left" : "right";

  const on = candidates.find((p) => x >= p.x && x <= p.x + p.width && y >= p.y && y <= p.y + p.height);
  const edge = on && on.depth > 0 && Math.abs(y - (on.y + on.height / 2)) > on.height * (0.5 - EDGE);
  if (on && !edge) {
    const isCentre = on.depth === 0;
    return {
      parentId: on.node.id,
      index: others(on.node.id).length,
      side: isCentre ? sideOfPoint : null,
      onto: on.node.id,
      beside: null,
    };
  }

  let near: Placed | null = on ?? null;
  let nearest = on ? 0 : REACH;
  for (const p of candidates) {
    if (p.depth === 0) continue;
    const dx = Math.max(p.x - x, 0, x - (p.x + p.width));
    const dy = Math.max(p.y - y, 0, y - (p.y + p.height));
    const d = Math.hypot(dx, dy);
    if (d < nearest) {
      nearest = d;
      near = p;
    }
  }
  if (!near) return null;
  const parentId = near.node.parentId!;
  const after = y > near.y + near.height / 2;
  return {
    parentId,
    index: others(parentId).findIndex((n) => n.id === near!.node.id) + (after ? 1 : 0),
    side: near.depth === 1 ? near.side : null,
    onto: null,
    beside: { id: near.node.id, after },
  };
}

/** A row of the outline as drawn: its node, and where it is down the page. */
export interface Row {
  id: string;
  parentId: string | null;
  top: number;
  height: number;
  /** Whether its children are drawn below it, as a portal's are not. */
  open: boolean;
}

/**
 * Where a row dragged in the outline would land if let go at height `y`.
 * The rows are in the order drawn, the centre first. On the middle of a row:
 * under it, last (into it, if it is a map). On its top quarter: before it.
 * On its bottom quarter: after it, or first under it when its children are
 * drawn right below. The centre takes everything onto itself. Above or below
 * every row counts as the first or the last.
 */
export function outlineDropAt(tree: Tree, rows: readonly Row[], dragged: string, y: number): Drop | null {
  // The dragged row and those under it, which follow it in the list.
  const branch = new Set([dragged]);
  for (const row of rows) if (row.parentId && branch.has(row.parentId)) branch.add(row.id);
  if (rows.length === 0 || !rows.some((r) => r.id === dragged)) return null;
  const on =
    rows.find((r) => y >= r.top && y < r.top + r.height) ?? (y < rows[0].top ? rows[0] : rows[rows.length - 1]);
  if (branch.has(on.id)) return null;
  const others = (id: string) => tree.children(id).filter((n) => n.id !== dragged);

  const isCentre = on.parentId === null || on === rows[0];
  const fromMiddle = y - (on.top + on.height / 2);
  const edge = !isCentre && Math.abs(fromMiddle) > on.height * (0.5 - EDGE);
  if (!edge || (fromMiddle > 0 && on.open && tree.children(on.id).some((n) => n.id !== dragged))) {
    return {
      parentId: on.id,
      index: edge ? 0 : others(on.id).length,
      side: null,
      onto: edge ? null : on.id,
      beside: edge ? { id: on.id, after: true } : null,
    };
  }
  const parentId = on.parentId!;
  const after = fromMiddle > 0;
  const siblings = tree.children(parentId);
  const at = siblings.findIndex((n) => n.id === on.id);
  return {
    parentId,
    index: others(parentId).findIndex((n) => n.id === on.id) + (after ? 1 : 0),
    // Beside a branch of the centre, it takes that branch's side on the map.
    side: parentId === rows[0].id ? sidesOf(siblings)[at] : null,
    onto: null,
    beside: { id: on.id, after },
  };
}
