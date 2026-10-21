// Where each node of a map goes. The centre is in the middle, its children in
// two columns to its right and left, and each branch grows outwards from
// there. Every node's branch takes a band of height, its children are stacked
// in it, and the node sits halfway down its children: the layout most mind map
// apps use, which reads as a list on each side.
//
// Sizes come from outside (the window measures each node's text), so this is
// pure and the same everywhere. Coordinates are in pixels at zoom 1, with the
// centre node's middle at 0, 0.

import type { Node, Side } from "./node.ts";

export interface Size {
  width: number;
  height: number;
}

export interface Placed {
  node: Node;
  /** Top left corner. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Null for the centre. */
  side: Side | null;
  /** 0 for the centre, 1 for its children and so on. */
  depth: number;
  /** Which child of the centre this node's branch starts from, in order; -1 for the centre. */
  branch: number;
  /** Whether the node has children that are not drawn: folded away, or inside a map. */
  hidden: number;
}

export interface Layout {
  centreId: string;
  /** Every node drawn, the centre first, each parent before its children. */
  placed: Placed[];
  byId: Map<string, Placed>;
  bounds: { left: number; top: number; right: number; bottom: number };
}

/** What the layout reads from the vault. */
export interface Tree {
  get(id: string): Node | undefined;
  children(id: string): readonly Node[];
}

export const SPACING = {
  /** From a node to its children. */
  across: 40,
  /** From the centre to its children, which needs more room. */
  centreAcross: 64,
  /** Between siblings. */
  between: 8,
  /** Between the centre's children, which start whole branches. */
  centreBetween: 16,
};

/** `leaveOut`: nodes not to draw, with all under them, as done tasks when they are hidden. */
export function layoutMap(
  tree: Tree,
  centreId: string,
  size: (node: Node) => Size,
  leaveOut: ReadonlySet<string> = new Set(),
): Layout {
  const centre = tree.get(centreId);
  if (!centre) throw new Error(`No node ${centreId}`);

  const sizes = new Map<string, Size>();
  const sizeOf = (node: Node) => {
    let s = sizes.get(node.id);
    if (!s) sizes.set(node.id, (s = size(node)));
    return s;
  };
  // Children drawn under a node: none for a folded node, or for a map other
  // than the centre, which is drawn as a portal.
  const shown = (node: Node) =>
    node.collapsed || (node.isMap && node.id !== centreId)
      ? []
      : leaveOut.size
        ? tree.children(node.id).filter((n) => !leaveOut.has(n.id))
        : tree.children(node.id);

  const bands = new Map<string, number>();
  const band = (node: Node): number => {
    let h = bands.get(node.id);
    if (h === undefined) {
      const kids = shown(node);
      const stack = kids.reduce((sum, k) => sum + band(k), 0) + SPACING.between * Math.max(0, kids.length - 1);
      h = Math.max(sizeOf(node).height, stack);
      bands.set(node.id, h);
    }
    return h;
  };

  const placed: Placed[] = [];
  const byId = new Map<string, Placed>();
  const put = (p: Placed) => {
    placed.push(p);
    byId.set(p.node.id, p);
  };

  /** Places a node and its branch in the band starting at `top`, its inner edge at `edge`. */
  const place = (node: Node, edge: number, top: number, side: Side, depth: number, branch: number) => {
    const s = sizeOf(node);
    const middle = top + band(node) / 2;
    const x = side === "right" ? edge : edge - s.width;
    put({
      node,
      x,
      y: middle - s.height / 2,
      width: s.width,
      height: s.height,
      side,
      depth,
      branch,
      hidden: shown(node).length === 0 ? tree.children(node.id).length : 0,
    });
    const kids = shown(node);
    const stack = kids.reduce((sum, k) => sum + band(k), 0) + SPACING.between * Math.max(0, kids.length - 1);
    let y = middle - stack / 2;
    const childEdge = side === "right" ? x + s.width + SPACING.across : x - SPACING.across;
    for (const kid of kids) {
      place(kid, childEdge, y, side, depth + 1, branch);
      y += band(kid) + SPACING.between;
    }
  };

  const c = sizeOf(centre);
  put({
    node: centre,
    x: -c.width / 2,
    y: -c.height / 2,
    width: c.width,
    height: c.height,
    side: null,
    depth: 0,
    branch: -1,
    hidden: 0,
  });
  const kids = shown(centre);
  const sides = sidesOf(kids);
  for (const side of ["right", "left"] as const) {
    const column = kids.map((k, i) => ({ k, i })).filter(({ i }) => sides[i] === side);
    const stack =
      column.reduce((sum, { k }) => sum + band(k), 0) + SPACING.centreBetween * Math.max(0, column.length - 1);
    let y = -stack / 2;
    const edge = side === "right" ? c.width / 2 + SPACING.centreAcross : -c.width / 2 - SPACING.centreAcross;
    for (const { k, i } of column) {
      place(k, edge, y, side, 1, i);
      y += band(k) + SPACING.centreBetween;
    }
  }

  const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const p of placed) {
    bounds.left = Math.min(bounds.left, p.x);
    bounds.top = Math.min(bounds.top, p.y);
    bounds.right = Math.max(bounds.right, p.x + p.width);
    bounds.bottom = Math.max(bounds.bottom, p.y + p.height);
  }
  return { centreId, placed, byId, bounds };
}

/**
 * The side of each of the centre's children: its own, or else the side that
 * has fewer so far, the right when they are even.
 */
export function sidesOf(children: readonly Node[]): Side[] {
  let right = children.filter((n) => n.side === "right").length;
  let left = children.filter((n) => n.side === "left").length;
  return children.map((n) => {
    if (n.side) return n.side;
    if (right <= left) {
      right++;
      return "right";
    }
    left++;
    return "left";
  });
}

/** The side for a new child of the centre: the one with fewer children. */
export function sideForNewChild(children: readonly Node[]): Side {
  const sides = sidesOf(children);
  const right = sides.filter((s) => s === "right").length;
  return right <= sides.length - right ? "right" : "left";
}
