// The branches of a map: the children of its centre. Each has a side and a
// colour, given when it is made so that later moves never change them; the
// map and the outline both make branches through here.

import { sideForNewChild, sidesOf } from "./layout.ts";
import type { Node, NodeFields } from "./node.ts";

export const PALETTE = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9", "#f08c00", "#0c8599", "#d6336c", "#5c7cfa"];

/** The colour of the `index`th branch: its own, or else one by its place, for branches made before colours were kept. */
export function branchColour(branches: readonly Node[], index: number): string {
  return branches[index]?.color ?? PALETTE[index % PALETTE.length];
}

/** The colour the branches use least, the first of the palette when even. */
function leastUsed(branches: readonly Node[]): string {
  const used = new Map(PALETTE.map((c) => [c, 0]));
  branches.forEach((_, i) => {
    const c = branchColour(branches, i);
    used.set(c, (used.get(c) ?? 0) + 1);
  });
  return PALETTE.reduce((best, c) => (used.get(c)! < used.get(best)! ? c : best), PALETTE[0]);
}

/** The side and colour of a new branch: the side with fewer, the colour used least. */
export function newBranch(branches: readonly Node[]): Partial<NodeFields> {
  return { side: sideForNewChild(branches), color: leastUsed(branches) };
}

/** The side and colour of a new branch beside `sibling`: on its side. */
export function branchBeside(branches: readonly Node[], sibling: Node): Partial<NodeFields> {
  const i = branches.indexOf(sibling);
  return { side: i >= 0 ? sidesOf(branches)[i] : sideForNewChild(branches), color: leastUsed(branches) };
}
