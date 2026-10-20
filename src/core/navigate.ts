// Which node an arrow key moves to on a map. Left and right follow the tree,
// outwards to a child or inwards to the parent, whichever way that is on the
// node's side of the centre. Up and down go to the nearest node above or below
// on screen, which crosses from one branch to the next.

import type { Layout, Placed } from "./layout.ts";

export type Direction = "up" | "down" | "left" | "right";

export function neighbour(layout: Layout, id: string, direction: Direction): string | null {
  const from = layout.byId.get(id);
  if (!from) return null;
  return direction === "left" || direction === "right" ? across(layout, from, direction) : along(layout, from, direction);
}

const middleY = (p: Placed) => p.y + p.height / 2;

function across(layout: Layout, from: Placed, direction: "left" | "right"): string | null {
  const outwards = from.side === null || from.side === direction;
  if (!outwards) return from.node.parentId;
  // The child level with the node, of those on this side.
  const kids = layout.placed.filter(
    (p) => p.node.parentId === from.node.id && (from.side !== null || p.side === direction),
  );
  let best: Placed | null = null;
  for (const kid of kids) {
    if (!best || Math.abs(middleY(kid) - middleY(from)) < Math.abs(middleY(best) - middleY(from))) best = kid;
  }
  return best?.node.id ?? null;
}

function along(layout: Layout, from: Placed, direction: "up" | "down"): string | null {
  let best: Placed | null = null;
  let bestScore = Infinity;
  for (const p of layout.placed) {
    if (p === from) continue;
    const dy = direction === "up" ? middleY(from) - middleY(p) : middleY(p) - middleY(from);
    if (dy <= 0) continue;
    // How far apart the two are sideways: nothing if they overlap. Being in
    // the same column counts for more than being close.
    const gap = Math.max(0, p.x - (from.x + from.width), from.x - (p.x + p.width));
    const score = dy + gap * 3;
    if (score < bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best?.node.id ?? null;
}
