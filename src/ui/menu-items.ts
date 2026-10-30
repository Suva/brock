// The menu bar's commands as the items of the header's ☰ menu (AppMenu.svelte),
// where the window has no menu bar of its own (see chrome.ts). The same
// commands as app-menu.ts, which makes the native menu bar elsewhere.

import type { MapLayout } from "../core/node.ts";
import { cmd, press, type MenuActions } from "./app-menu.ts";

export type Item =
  | { label: string; run: () => void; hint?: string; checked?: boolean }
  | { label: string; items: Item[] }
  | "line";

/** What the window is showing, for the check marks. */
export interface MenuState {
  view: "map" | "outline";
  layout: MapLayout | null;
  sidebar: boolean;
  notes: boolean;
  source: boolean;
  hideDone: boolean;
}

const line = "line" as const;

export function menuItems(a: MenuActions, s: MenuState, quit: () => void): Item[] {
  const priorities: Item[] = [1, 2, 3, 4, 5].map((n) => ({
    label: `Priority ${n}`,
    run: () => press(cmd({ key: String(n), code: `Digit${n}` })),
    hint: `Ctrl+${n}`,
  }));
  return [
    {
      label: "File",
      items: [
        { label: "Import OPML or JSON…", run: a.importFile, hint: "under the selected node" },
        {
          label: "Export This Map",
          items: [
            { label: "As Markdown…", run: () => a.exportMap("md") },
            { label: "As OPML…", run: () => a.exportMap("opml") },
            { label: "As JSON (Everything)…", run: () => a.exportMap("json") },
            line,
            { label: "As Picture (SVG)…", run: () => a.exportPicture("svg") },
            { label: "As Picture (PNG)…", run: () => a.exportPicture("png") },
          ],
        },
        line,
        { label: "Trash", run: a.trash },
        line,
        { label: "Settings…", run: a.settings, hint: "Ctrl+," },
        { label: "Quit", run: quit },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", run: a.undo, hint: "Ctrl+Z" },
        { label: "Redo", run: a.redo, hint: "Ctrl+Shift+Z" },
        line,
        { label: "Copy Map as Picture", run: a.copyPicture },
        line,
        { label: "Search…", run: a.search, hint: "Ctrl+K" },
        { label: "Link To…", run: a.link, hint: "Ctrl+L" },
      ],
    },
    {
      label: "Node",
      items: [
        { label: "New Child", run: () => press({ key: "Tab" }), hint: "Tab" },
        { label: "New Sibling", run: () => press({ key: "Enter" }), hint: "Enter" },
        { label: "Delete", run: () => press({ key: "Delete" }), hint: "Del" },
        line,
        { label: "Task", run: () => press(cmd({ key: "t" })), hint: "Ctrl+T" },
        { label: "Tick Task", run: () => press({ key: " " }), hint: "Space" },
        { label: "Mark: Attention, Critical, OK, None", run: a.flagSelected, hint: "Ctrl+Shift+A" },
        { label: "Priority", items: priorities },
        line,
        { label: "Make Map or Undo It", run: () => press(cmd({ key: "M", shiftKey: true })), hint: "Ctrl+Shift+M" },
        { label: "Open Map", run: () => press(cmd({ key: "ArrowDown" })), hint: "Ctrl+↓" },
        { label: "Fold or Unfold", run: () => press(cmd({ key: "/" })), hint: "Ctrl+/" },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Map", run: () => a.view("map"), hint: "Alt+Ctrl+1", checked: s.view === "map" },
        { label: "Outline", run: () => a.view("outline"), hint: "Alt+Ctrl+2", checked: s.view === "outline" },
        { label: "Draw as Org Chart", run: () => a.toggleLayout("org"), hint: "Alt+Ctrl+3", checked: s.layout === "org" },
        { label: "Draw as Timeline", run: () => a.toggleLayout("timeline"), hint: "Alt+Ctrl+4", checked: s.layout === "timeline" },
        { label: "Draw as Board", run: () => a.toggleLayout("board"), hint: "Alt+Ctrl+5", checked: s.layout === "board" },
        line,
        { label: "Sidebar", run: a.toggleSidebar, hint: "Ctrl+Shift+S", checked: s.sidebar },
        { label: "Tasks", run: a.showTasks, hint: "Ctrl+Shift+T" },
        { label: "History", run: a.showHistory, hint: "Ctrl+Shift+Y" },
        { label: "Marked Nodes (the Bell)", run: a.showAttention, hint: "Ctrl+Shift+B" },
        { label: "Notes", run: a.toggleNotes, hint: "Ctrl+Shift+N", checked: s.notes },
        { label: "Notes as Markdown Source", run: a.toggleSource, hint: "Ctrl+E", checked: s.source },
        { label: "Hide Done Tasks", run: a.toggleHideDone, hint: "Ctrl+Shift+H", checked: s.hideDone },
        line,
        { label: "Back", run: a.back, hint: "Ctrl+[" },
        { label: "Forward", run: a.forward, hint: "Ctrl+]" },
        { label: "Out to the Map Around", run: a.up, hint: "Ctrl+↑" },
        line,
        { label: "Zoom In", run: () => press(cmd({ key: "=" })), hint: "Ctrl+=" },
        { label: "Zoom Out", run: () => press(cmd({ key: "-" })), hint: "Ctrl+-" },
        { label: "Show Whole Map", run: () => press(cmd({ key: "0" })), hint: "Ctrl+0" },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Show the Tour", run: a.showTour },
        { label: "Remove the Tour", run: a.removeTour },
        line,
        { label: "Check for Updates…", run: a.checkForUpdates },
      ],
    },
  ];
}
