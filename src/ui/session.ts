// Where the window was left: the map open and the node selected in it, the
// view, and which panels were open, to start there next time. It belongs to
// this computer, not the vault, so it is kept in the window's own storage:
// a vault synced to another computer should not move what is shown there.

export interface Session {
  map: string | null;
  node: string | null;
  view: "map" | "outline";
  sidebarOpen: boolean;
  sidebarTab: "maps" | "tasks";
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

const DEFAULTS: Session = { map: null, node: null, view: "map", sidebarOpen: false, sidebarTab: "maps", notesOpen: false, notesSource: false, hideDone: false, sidebarWidth: 270, notesWidth: 320 };

/** A saved width, if it is a sensible one. */
function width(v: unknown, fallback: number): number {
  return typeof v === "number" && v >= 200 && v <= 800 ? v : fallback;
}

/** The session last saved, every field checked: storage can hold anything, or nothing. */
export function savedSession(): Session {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof Session, unknown>>;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      map: str(raw.map),
      node: str(raw.node),
      view: raw.view === "outline" ? "outline" : "map",
      sidebarOpen: raw.sidebarOpen === true,
      sidebarTab: raw.sidebarTab === "tasks" ? "tasks" : "maps",
      notesOpen: raw.notesOpen === true,
      notesSource: raw.notesSource === true,
      hideDone: raw.hideDone === true,
      sidebarWidth: width(raw.sidebarWidth, DEFAULTS.sidebarWidth),
      notesWidth: width(raw.notesWidth, DEFAULTS.notesWidth),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Without storage the window starts at the top of the vault next time.
  }
}
