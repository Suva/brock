// Where the window was left: the map open in each pane and the node selected
// in it, each pane's view, how the window was split (tiling.ts), and which
// panels were open, to start there next time. It belongs to this computer, not the vault,
// so it is kept in the window's own storage: a vault synced to another
// computer should not move what is shown there.

import { SHARE_MAX, SHARE_MIN, one, readTiling, type Tiling } from "./tiling.ts";

export type View = "map" | "outline";

/** Where a pane was left. */
export interface PanePlace {
  map: string | null;
  node: string | null;
  view: View;
}

export interface Session {
  /** One pane, or more when split. */
  panes: PanePlace[];
  /** The pane the keyboard works on. */
  active: number;
  /** How the panes share the room; its leaves are places in `panes`. */
  tiling: Tiling;
  sidebarOpen: boolean;
  sidebarTab: "maps" | "tasks" | "history";
  notesOpen: boolean;
  /** Whether notes show their Markdown source rather than drawn. */
  notesSource: boolean;
  /** Whether done tasks are hidden on the map and in the outline. */
  hideDone: boolean;
  /** The widths of the side panels, in pixels. */
  sidebarWidth: number;
  notesWidth: number;
}

const KEY = "mindmap-session";

/** More panes than this in storage is not a session the window made. */
const MOST_PANES = 16;

const DEFAULTS: Session = {
  panes: [{ map: null, node: null, view: "map" }],
  active: 0,
  tiling: one,
  sidebarOpen: false,
  sidebarTab: "maps",
  notesOpen: false,
  notesSource: false,
  hideDone: false,
  sidebarWidth: 270,
  notesWidth: 320,
};

/** A saved width, if it is a sensible one. */
function width(v: unknown, fallback: number): number {
  return typeof v === "number" && v >= 200 && v <= 800 ? v : fallback;
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

function place(v: unknown): PanePlace | null {
  if (typeof v !== "object" || v === null) return null;
  const p = v as Record<string, unknown>;
  return { map: str(p.map), node: str(p.node), view: p.view === "outline" ? "outline" : "map" };
}

/** Two panes as saved before a pane could be split again: one split, beside or below. */
function twoPanes(v: unknown): Tiling | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  if (s.direction !== "beside" && s.direction !== "below") return null;
  const share = typeof s.share === "number" && s.share >= SHARE_MIN && s.share <= SHARE_MAX ? s.share : 0.5;
  return { direction: s.direction, share, first: { pane: 0 }, second: { pane: 1 } };
}

/**
 * A session as stored, every field checked: storage can hold anything, or
 * nothing. A session saved before the window had panes, with one map, node
 * and view, comes back as one pane, and one with two panes and a `split` as
 * one split. Panes whose tiling does not hold together come back as the
 * active one alone.
 */
export function readSession(stored: unknown): Session {
  const raw = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  let panes = Array.isArray(raw.panes) ? raw.panes.map(place).filter((p): p is PanePlace => p !== null) : [];
  if (panes.length === 0 || panes.length > MOST_PANES) panes = [place(raw) ?? DEFAULTS.panes[0]];
  let active = typeof raw.active === "number" && Number.isInteger(raw.active) && raw.active >= 0 && raw.active < panes.length ? raw.active : 0;
  let tiling = panes.length === 1 ? one : (readTiling(raw.tiling, panes.length) ?? (panes.length === 2 ? twoPanes(raw.split) : null));
  if (!tiling) {
    panes = [panes[active]];
    active = 0;
    tiling = one;
  }
  return {
    panes,
    active,
    tiling,
    sidebarOpen: raw.sidebarOpen === true,
    sidebarTab: raw.sidebarTab === "tasks" || raw.sidebarTab === "history" ? raw.sidebarTab : "maps",
    notesOpen: raw.notesOpen === true,
    notesSource: raw.notesSource === true,
    hideDone: raw.hideDone === true,
    sidebarWidth: width(raw.sidebarWidth, DEFAULTS.sidebarWidth),
    notesWidth: width(raw.notesWidth, DEFAULTS.notesWidth),
  };
}

/** A session opened on one map alone: a new vault's tour, or the demo's. */
export function openingOn(session: Session, map: string | null, notesOpen: boolean): Session {
  return { ...session, panes: [{ map, node: map, view: "map" }], active: 0, tiling: one, notesOpen };
}

/** The session last saved. */
export function savedSession(): Session {
  try {
    return readSession(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return readSession({});
  }
}

export function saveSession(session: Session): void {
  // The active pane's place is also written as a session was before panes, so
  // that a copy of the app from before split view still starts there.
  const { map, node, view } = session.panes[session.active] ?? session.panes[0];
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...session, map, node, view }));
  } catch {
    // Without storage the window starts at the top of the vault next time.
  }
}
