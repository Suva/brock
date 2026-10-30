// Where each node of a map goes. The centre is in the middle, its children in
// two columns to its right and left, and each branch grows outwards from
// there. Every node's branch takes a band of height, its children are stacked
// in it, and the node sits halfway down its children: the layout most mind map
// apps use, which reads as a list on each side. A map with `layout: "org"`
// goes downwards instead, as an org chart: each level a row, a node centred
// over its children. Nodes whose children are all leaves stack them in a
// column under themselves, as org charts do: a row of every leaf would make
// a chart of a few dozen nodes too wide to read. A map with `layout:
// "timeline"` runs along a straight line from its centre: its children in
// order, by turns above and below the line, each with all under it in a column.
// A map with `layout: "board"` has those columns side by side under its centre,
// each in a lane.
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
  /** Null for the centre, and on an org chart or timeline, which have no sides. */
  side: Side | null;
  /** 0 for the centre, 1 for its children and so on. */
  depth: number;
  /** Which child of the centre this node's branch starts from, in order; -1 for the centre. */
  branch: number;
  /** Whether it is in a column under its parent, on an org chart or timeline. */
  stacked: boolean;
  /** Whether the node has children that are not drawn: folded away, or inside a map. */
  hidden: number;
}

export interface Layout {
  centreId: string;
  /**
   * Whether it has no sides: an org chart or a timeline, where siblings run
   * from left to right, unless stacked, and a node's children are below it.
   */
  down: boolean;
  /** Whether it is a timeline, along the line through the centre's middle. */
  timeline: boolean;
  /** Whether it is a board, with a lane for each of the centre's children. */
  board: boolean;
  /** Whether each child of the centre heads a column of all under it: a timeline or a board. */
  columns: boolean;
  /** The lanes of a board, left to right; `id` is the node heading each. */
  lanes: { id: string; x: number; y: number; width: number; height: number }[];
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
  /** On a map drawn downwards: from a row to the next. */
  down: 48,
  /** Between siblings side by side, which need more room than stacked ones. */
  beside: 16,
  /** Between the centre's children side by side. */
  centreBeside: 32,
  /** How far a stacked column starts to the right of its parent's left edge. */
  stackIndent: 18,
  /** On a timeline: from the line to what is above or below it. */
  stem: 40,
  /** The least from one event to the next, along the line. */
  step: 72,
  /** On a board: the narrowest a column is. */
  column: 160,
  /** Around a column, to the edge of its lane. */
  lanePad: 10,
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
      stacked: false,
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

  const lanes: Layout["lanes"] = [];

  const finish = (): Layout => {
    const bounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (const p of [...placed, ...lanes]) {
      bounds.left = Math.min(bounds.left, p.x);
      bounds.top = Math.min(bounds.top, p.y);
      bounds.right = Math.max(bounds.right, p.x + p.width);
      bounds.bottom = Math.max(bounds.bottom, p.y + p.height);
    }
    const timeline = centre.layout === "timeline";
    const board = centre.layout === "board";
    return { centreId, down: centre.layout !== null, timeline, board, columns: timeline || board, lanes, placed, byId, bounds };
  };

  const c = sizeOf(centre);

  /** A child of the centre and all under it, in the order they are drawn down a column. */
  const columnOf = (top: Node) => {
    const column: { node: Node; depth: number }[] = [];
    const collect = (node: Node, depth: number) => {
      column.push({ node, depth });
      for (const kid of shown(node)) collect(kid, depth + 1);
    };
    collect(top, 1);
    return column;
  };
  type Column = ReturnType<typeof columnOf>;
  const indent = (depth: number) => SPACING.stackIndent * (depth - 1);
  const columnHeight = (column: Column) =>
    column.reduce((sum, { node }) => sum + sizeOf(node).height, 0) + SPACING.between * (column.length - 1);
  const columnWidth = (column: Column) => Math.max(...column.map(({ node, depth }) => indent(depth) + sizeOf(node).width));
  /** Places a column with its top left corner at `left`, `top`, each level stepped in. */
  const placeColumn = (column: Column, left: number, top: number, branch: number) => {
    let y = top;
    for (const { node, depth } of column) {
      const s = sizeOf(node);
      put({
        node,
        x: left + indent(depth),
        y,
        width: s.width,
        height: s.height,
        side: null,
        depth,
        branch,
        stacked: depth > 1,
        hidden: shown(node).length === 0 ? tree.children(node.id).length : 0,
      });
      y += s.height + SPACING.between;
    }
  };

  if (centre.layout === "board") {
    put({ node: centre, x: -c.width / 2, y: -c.height / 2, width: c.width, height: c.height, side: null, depth: 0, branch: -1, stacked: false, hidden: 0 });
    const columns = shown(centre).map(columnOf);
    // All one width, as a board's columns are; all as tall as the tallest.
    const width = Math.max(SPACING.column, ...columns.map(columnWidth));
    const height = Math.max(0, ...columns.map(columnHeight));
    const step = width + 2 * SPACING.lanePad + SPACING.beside;
    const top = c.height / 2 + SPACING.down;
    columns.forEach((column, i) => {
      const left = (i - (columns.length - 1) / 2) * step - width / 2;
      placeColumn(column, left, top, i);
      lanes.push({
        id: column[0].node.id,
        x: left - SPACING.lanePad,
        y: top - SPACING.lanePad,
        width: width + 2 * SPACING.lanePad,
        height: height + 2 * SPACING.lanePad,
      });
    });
    return finish();
  }

  if (centre.layout === "timeline") {
    put({ node: centre, x: -c.width / 2, y: -c.height / 2, width: c.width, height: c.height, side: null, depth: 0, branch: -1, stacked: false, hidden: 0 });
    // Each side only has to keep clear of itself, so the two interlock.
    const ends = [c.width / 2 + SPACING.centreAcross, c.width / 2 + SPACING.centreAcross];
    let last = -Infinity;
    shown(centre).forEach((event, i) => {
      const column = columnOf(event);
      const above = i % 2 === 0 ? 0 : 1;
      const left = Math.max(ends[above], last + SPACING.step);
      placeColumn(column, left, above === 0 ? -SPACING.stem - columnHeight(column) : SPACING.stem, i);
      ends[above] = left + columnWidth(column) + SPACING.centreBeside;
      last = left;
    });
    return finish();
  }

  if (centre.layout === "org") {
    /** Whether a node's children go in a column. One child sits right under it, and the centre keeps its branches in a row. */
    const stacks = (node: Node, depth: number) =>
      depth > 0 && shown(node).length > 1 && shown(node).every((k) => shown(k).length === 0);
    const stackHeight = (node: Node) =>
      shown(node).reduce((sum, k) => sum + sizeOf(k).height, 0) + SPACING.between * (shown(node).length - 1);

    // One height for each level, so that rows line up across the branches.
    const heights: number[] = [];
    const measureRows = (node: Node, depth: number) => {
      heights[depth] = Math.max(heights[depth] ?? 0, sizeOf(node).height);
      if (stacks(node, depth)) heights[depth + 1] = Math.max(heights[depth + 1] ?? 0, stackHeight(node));
      else for (const kid of shown(node)) measureRows(kid, depth + 1);
    };
    measureRows(centre, 0);
    const tops = [-c.height / 2];
    for (const height of heights) tops.push(tops[tops.length - 1] + height + SPACING.down);

    const gap = (depth: number) => (depth === 0 ? SPACING.centreBeside : SPACING.beside);
    const row = (node: Node, depth: number) =>
      shown(node).reduce((sum, k) => sum + span(k, depth + 1), 0) + gap(depth) * Math.max(0, shown(node).length - 1);
    const spans = new Map<string, number>();
    const span = (node: Node, depth: number): number => {
      let w = spans.get(node.id);
      if (w === undefined) {
        const under = stacks(node, depth) ? stackWidth(node) : row(node, depth);
        spans.set(node.id, (w = Math.max(sizeOf(node).width, under)));
      }
      return w;
    };
    const stackWidth = (node: Node) => SPACING.stackIndent + Math.max(...shown(node).map((k) => sizeOf(k).width));

    /** Places a node and its branch in the span starting at `left`. */
    const placeDown = (node: Node, left: number, depth: number, branch: number) => {
      const s = sizeOf(node);
      const middle = left + span(node, depth) / 2;
      // Over a column it stays at the left, for the column's line to drop from it.
      const stacked = stacks(node, depth);
      put({
        node,
        x: stacked ? left : middle - s.width / 2,
        y: tops[depth],
        width: s.width,
        height: s.height,
        side: null,
        depth,
        branch,
        stacked: false,
        hidden: depth > 0 && shown(node).length === 0 ? tree.children(node.id).length : 0,
      });
      if (stacked) {
        const x = left + SPACING.stackIndent;
        let y = tops[depth + 1];
        for (const kid of shown(node)) {
          const k = sizeOf(kid);
          put({
            node: kid,
            x,
            y,
            width: k.width,
            height: k.height,
            side: null,
            depth: depth + 1,
            branch,
            stacked: true,
            hidden: tree.children(kid.id).length,
          });
          y += k.height + SPACING.between;
        }
        return;
      }
      let x = middle - row(node, depth) / 2;
      shown(node).forEach((kid, i) => {
        placeDown(kid, x, depth + 1, depth === 0 ? i : branch);
        x += span(kid, depth + 1) + gap(depth);
      });
    };
    placeDown(centre, -span(centre, 0) / 2, 0, -1);
    return finish();
  }

  put({
    node: centre,
    x: -c.width / 2,
    y: -c.height / 2,
    width: c.width,
    height: c.height,
    side: null,
    depth: 0,
    branch: -1,
    stacked: false,
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

  return finish();
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
