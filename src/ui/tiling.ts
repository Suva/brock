// How the window's panes share its room: one pane, or a split in two, either
// side of which can be split again. A split divides the pane it was made in,
// beside it or below it, so on a wide screen the first goes side by side and
// splitting either half goes one above the other. Each pane is drawn in the
// rectangle worked out here, as a share of the room, so a pane's view stays
// the same component whatever happens to the tree around it.
//
// Plain data and functions, no Svelte: saved in the session and tested under
// Node. Leaves name panes by their place in the window's list of panes.

export type Direction = "beside" | "below";

export type Tiling = { pane: number } | { direction: Direction; share: number; first: Tiling; second: Tiling };

/** A part of the room, each length a share of the whole, from its top left. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Tile extends Rect {
  pane: number;
}

/** The line between the two sides of a split, and the split's whole area, for dragging it. */
export interface Divider {
  /** Which split, as the way to it from the top: "f" for first, "s" for second. */
  path: string;
  direction: Direction;
  /** Where the line is: along the split's area, at its share. */
  at: Rect;
  area: Rect;
}

/** The first side's share of a split is kept within these, so neither side is ever squeezed to nothing. */
export const SHARE_MIN = 0.2;
export const SHARE_MAX = 0.8;

const WHOLE: Rect = { x: 0, y: 0, width: 1, height: 1 };

export const one: Tiling = { pane: 0 };

const isLeaf = (t: Tiling): t is { pane: number } => "pane" in t;

/** The two sides of a split's area. */
function halves(t: Exclude<Tiling, { pane: number }>, a: Rect): [Rect, Rect] {
  if (t.direction === "beside") {
    const w = a.width * t.share;
    return [
      { ...a, width: w },
      { ...a, x: a.x + w, width: a.width - w },
    ];
  }
  const h = a.height * t.share;
  return [
    { ...a, height: h },
    { ...a, y: a.y + h, height: a.height - h },
  ];
}

/** Where each pane goes. */
export function tiles(t: Tiling, area: Rect = WHOLE): Tile[] {
  if (isLeaf(t)) return [{ ...area, pane: t.pane }];
  const [a, b] = halves(t, area);
  return [...tiles(t.first, a), ...tiles(t.second, b)];
}

/** The lines between the sides of every split. */
export function dividers(t: Tiling, area: Rect = WHOLE, path = ""): Divider[] {
  if (isLeaf(t)) return [];
  const [a, b] = halves(t, area);
  const at = t.direction === "beside" ? { x: b.x, y: area.y, width: 0, height: area.height } : { x: area.x, y: b.y, width: area.width, height: 0 };
  return [{ path, direction: t.direction, at, area }, ...dividers(t.first, a, path + "f"), ...dividers(t.second, b, path + "s")];
}

/** The panes in the order ⌃Tab goes round them: each split's first side before its second, so left to right and top to bottom. */
export function order(t: Tiling): number[] {
  return isLeaf(t) ? [t.pane] : [...order(t.first), ...order(t.second)];
}

/** Pane `pane` split in two, `added` beside it or below it, half each. */
export function split(t: Tiling, pane: number, added: number, direction: Direction): Tiling {
  if (isLeaf(t)) return t.pane === pane ? { direction, share: 0.5, first: t, second: { pane: added } } : t;
  return { ...t, first: split(t.first, pane, added, direction), second: split(t.second, pane, added, direction) };
}

/**
 * Without pane `pane`: the other side of its split takes the split's room,
 * and the panes after it in the window's list move up one place, as they do
 * in the list. Null when it is the only pane.
 */
export function close(t: Tiling, pane: number): Tiling | null {
  const renumber = (u: Tiling): Tiling =>
    isLeaf(u) ? { pane: u.pane > pane ? u.pane - 1 : u.pane } : { ...u, first: renumber(u.first), second: renumber(u.second) };
  const without = (u: Tiling): Tiling | null => {
    if (isLeaf(u)) return u.pane === pane ? null : u;
    const first = without(u.first);
    const second = without(u.second);
    if (!first) return second;
    if (!second) return first;
    return { ...u, first, second };
  };
  const left = without(t);
  return left && renumber(left);
}

/** The split at `path` with its first side given `share` of its room. */
export function setShare(t: Tiling, path: string, share: number): Tiling {
  if (isLeaf(t)) return t;
  if (path === "") return { ...t, share: Math.min(SHARE_MAX, Math.max(SHARE_MIN, share)) };
  return path[0] === "f" ? { ...t, first: setShare(t.first, path.slice(1), share) } : { ...t, second: setShare(t.second, path.slice(1), share) };
}

/**
 * A tiling as stored, checked: storage can hold anything. It must name each
 * of the `count` panes exactly once; a share out of bounds comes back in the
 * middle. Null when it does not hold together.
 */
export function readTiling(stored: unknown, count: number): Tiling | null {
  const seen = new Set<number>();
  const read = (v: unknown, depth: number): Tiling | null => {
    if (typeof v !== "object" || v === null || depth > 16) return null;
    const r = v as Record<string, unknown>;
    if ("pane" in r) {
      const p = r.pane;
      if (typeof p !== "number" || !Number.isInteger(p) || p < 0 || p >= count || seen.has(p)) return null;
      seen.add(p);
      return { pane: p };
    }
    if (r.direction !== "beside" && r.direction !== "below") return null;
    const first = read(r.first, depth + 1);
    const second = first && read(r.second, depth + 1);
    if (!first || !second) return null;
    const share = typeof r.share === "number" && r.share >= SHARE_MIN && r.share <= SHARE_MAX ? r.share : 0.5;
    return { direction: r.direction, share, first, second };
  };
  const t = read(stored, 0);
  return t && seen.size === count ? t : null;
}
