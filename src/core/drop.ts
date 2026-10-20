// Where a node dragged on a map would land if let go at a point. On the
// middle of another node: it becomes that node's last child (going into it,
// if it is a map). On the top or bottom quarter of a node, or near one: it
// goes beside it, before or after, which also carries it across the centre
// when that node is on the other side. Far from everything: nowhere, and
// letting go puts it back.

import type { Layout, Placed, Tree } from "./layout.ts";
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

export function dropAt(tree: Tree, layout: Layout, draggedId: string, x: number, y: number): Drop | null {
  const dragged = layout.byId.get(draggedId);
  if (!dragged) return null;
  const inBranch = (p: Placed) => {
    // Whether `p` is the dragged node or under it: it cannot go there.
    for (let q: Placed | undefined = p; q; q = q.node.parentId ? layout.byId.get(q.node.parentId) : undefined) {
      if (q.node.id === draggedId) return true;
    }
    return false;
  };
  const candidates = layout.placed.filter((p) => !inBranch(p));
  // Positions count among the children in the vault's order, all of them,
  // without the dragged node.
  const others = (id: string) => tree.children(id).filter((n) => n.id !== draggedId);
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
