// Which node an arrow key moves to on a map. Left and right follow the tree,
// outwards to a child or inwards to the parent, whichever way that is on the
// node's side of the centre. Up and down go to the sibling above or below;
// past the first or last sibling, to the nearest node at the same depth on
// that side, which crosses from one branch into the next; and only then to
// whatever is nearest on screen on that side and no deeper, never across the
// centre. Nearest on screen alone would pick a node of
// a deeper level that happens to sit a little higher over a sibling.

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
  const ahead = (p: Placed) => (direction === "up" ? middleY(from) - middleY(p) : middleY(p) - middleY(from)) > 0;
  const nearest = (candidates: Placed[]) =>
    candidates.reduce<Placed | null>(
      (best, p) => (!best || Math.abs(middleY(p) - middleY(from)) < Math.abs(middleY(best) - middleY(from)) ? p : best),
      null,
    );
  if (from.depth === 0) return null;
  const sameSide = layout.placed.filter((p) => p !== from && p.side === from.side && ahead(p));
  const sibling = nearest(sameSide.filter((p) => p.node.parentId === from.node.parentId));
  if (sibling) return sibling.node.id;
  const cousin = nearest(sameSide.filter((p) => p.depth === from.depth));
  if (cousin) return cousin.node.id;
  return anything(layout, from, direction);
}

/** The nearest node above or below on screen on the same side, no deeper than this one. */
function anything(layout: Layout, from: Placed, direction: "up" | "down"): string | null {
  let best: Placed | null = null;
  let bestScore = Infinity;
  for (const p of layout.placed) {
    if (p === from || p.side !== from.side || p.depth > from.depth) continue;
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
