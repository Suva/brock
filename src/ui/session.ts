// Where the window was left: the map open in each pane and the node selected
// in it, each pane's view, how the window was split, and which panels were
// open, to start there next time. It belongs to this computer, not the vault,
// so it is kept in the window's own storage: a vault synced to another
// computer should not move what is shown there.

export type View = "map" | "outline";

/** Where a pane was left. */
export interface PanePlace {
  map: string | null;
  node: string | null;
  view: View;
}

/**
 * How the window is split in two: the second pane beside the first or below
 * it, chosen when splitting (PLAN.md), and how much of the room the first
 * pane has, as a share, so that it suits a window of another size.
 */
export interface Split {
  direction: "beside" | "below";
  share: number;
}

export interface Session {
  /** One pane, or two when split. */
  panes: PanePlace[];
  /** The pane the keyboard works on. */
  active: number;
  /** Set exactly when there are two panes. */
  split: Split | null;
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

/** The divider's share is kept within these, so neither pane is ever squeezed to nothing. */
export const SHARE_MIN = 0.2;
export const SHARE_MAX = 0.8;

const DEFAULTS: Session = {
  panes: [{ map: null, node: null, view: "map" }],
  active: 0,
  split: null,
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

function split(v: unknown): Split | null {
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;
  if (s.direction !== "beside" && s.direction !== "below") return null;
  const share = typeof s.share === "number" && s.share >= SHARE_MIN && s.share <= SHARE_MAX ? s.share : 0.5;
  return { direction: s.direction, share };
}

/**
 * A session as stored, every field checked: storage can hold anything, or
 * nothing. A session saved before the window had panes, with one map, node
 * and view, comes back as one pane; two panes without a sensible split come
 * back as the active one alone.
 */
export function readSession(stored: unknown): Session {
  const raw = (typeof stored === "object" && stored !== null ? stored : {}) as Record<string, unknown>;
  let panes = Array.isArray(raw.panes) ? raw.panes.map(place).filter((p): p is PanePlace => p !== null) : [];
  if (panes.length === 0 || panes.length > 2) panes = [place(raw) ?? DEFAULTS.panes[0]];
  let active = typeof raw.active === "number" && Number.isInteger(raw.active) && raw.active >= 0 && raw.active < panes.length ? raw.active : 0;
  const how = panes.length === 2 ? split(raw.split) : null;
  if (panes.length === 2 && !how) {
    panes = [panes[active]];
    active = 0;
  }
  return {
    panes,
    active,
    split: how,
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
  return { ...session, panes: [{ map, node: map, view: "map" }], active: 0, split: null, notesOpen };
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
