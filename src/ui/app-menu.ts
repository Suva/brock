// The app's menu bar, for finding every command without knowing its key.
//
// Keys reach the page first: when the page handles a key (and stops it), the
// menu item is not run as well; when it does not, the menu runs. Where a
// system runs both, the item sees that the page just took its key and does
// nothing (`fresh`). So a menu
// item has a key only where that key never edits text: ⌘↑ in the notes, Tab,
// Enter or Space must stay with the text field. Those items name their key
// instead. Cut, Copy, Paste and Select All are the system's own, so that they
// edit text as everywhere; on the map, the keys copy and paste branches.
//
// Commands about nodes are sent as the key they stand for, to whatever has
// the focus, so that the map and the outline do what their keys do.

import type { MapLayout } from "../core/node.ts";
import { inTauri } from "../store/tauri-store.ts";
import type { FileKind } from "./files.ts";

export interface MenuActions {
  settings(): void;
  importFile(): void;
  exportMap(kind: FileKind): void;
  exportPicture(kind: "svg" | "png"): void;
  copyPicture(): void;
  trash(): void;
  undo(): void;
  redo(): void;
  search(): void;
  link(): void;
  view(view: "map" | "outline"): void;
  toggleLayout(layout: MapLayout): void;
  toggleSidebar(): void;
  showTasks(): void;
  toggleNotes(): void;
  toggleSource(): void;
  toggleHideDone(): void;
  back(): void;
  forward(): void;
  up(): void;
  showTour(): void;
  removeTour(): void;
  checkForUpdates(): void;
}

/** What the window tells the menu as it changes, for its check marks. */
export interface MenuChecks {
  view(view: "map" | "outline"): void;
  layout(layout: MapLayout | null): void;
  sidebar(open: boolean): void;
  notes(open: boolean): void;
  source(on: boolean): void;
  hideDone(on: boolean): void;
}

const mac = () => navigator.platform.startsWith("Mac");

/** When the page last handled a key with ⌘ or Ctrl itself. */
let handledAt = -Infinity;

/** Whether a menu item's run is its own, not the echo of a key the page has already handled. */
const fresh = () => performance.now() - handledAt > 250;

/** Sends a key to what has the focus, as a menu command about nodes. */
export function press(init: KeyboardEventInit) {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

/** The platform's command key with another: ⌘ on a Mac, Ctrl elsewhere. */
export const cmd =(init: KeyboardEventInit = {}): KeyboardEventInit => (mac() ? { metaKey: true, ...init } : { ctrlKey: true, ...init });

/** Puts the menu bar in place, in the app only; returns a way to keep its check marks right. */
export async function installMenu(a: MenuActions): Promise<MenuChecks | null> {
  if (!inTauri()) return null;
  const { Menu, Submenu, MenuItem, PredefinedMenuItem, CheckMenuItem } = await import("@tauri-apps/api/menu");
  const { getVersion } = await import("@tauri-apps/api/app");

  // Registered after the window's own listeners, so it sees what they did.
  window.addEventListener("keydown", (e) => {
    if (e.isTrusted && e.defaultPrevented && (e.metaKey || e.ctrlKey)) handledAt = performance.now();
  });
  const guarded = (action: () => void) => () => {
    if (fresh()) action();
  };

  const item = (text: string, action: () => void, accelerator?: string) =>
    MenuItem.new({ text, action: guarded(action), accelerator });
  const check = (text: string, action: () => void, accelerator?: string) =>
    CheckMenuItem.new({ text, action: guarded(action), accelerator, checked: false });
  const line = () => PredefinedMenuItem.new({ item: "Separator" });
  const system = (name: "Cut" | "Copy" | "Paste" | "SelectAll" | "Minimize" | "Maximize" | "Fullscreen" | "CloseWindow" | "Hide" | "HideOthers" | "ShowAll" | "Quit" | "Services") =>
    PredefinedMenuItem.new({ item: name });

  const mapItem = await check("Map", () => a.view("map"), "Alt+CmdOrCtrl+1");
  const outlineItem = await check("Outline", () => a.view("outline"), "Alt+CmdOrCtrl+2");
  const orgChartItem = await check("Draw as Org Chart", () => a.toggleLayout("org"), "Alt+CmdOrCtrl+3");
  const timelineItem = await check("Draw as Timeline", () => a.toggleLayout("timeline"), "Alt+CmdOrCtrl+4");
  const sidebarItem = await check("Sidebar", a.toggleSidebar, mac() ? "Ctrl+Cmd+S" : "Ctrl+Shift+S");
  const notesItem = await check("Notes", a.toggleNotes, "CmdOrCtrl+Shift+N");
  const sourceItem = await check("Notes as Markdown Source", a.toggleSource, "CmdOrCtrl+E");
  const hideDoneItem = await check("Hide Done Tasks", a.toggleHideDone, "CmdOrCtrl+Shift+H");

  const priorities = await Submenu.new({
    text: "Priority",
    items: await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        item(`Priority ${n}`, () => press(cmd({ key: String(n), code: `Digit${n}` })), `CmdOrCtrl+${n}`),
      ),
    ),
  });

  const submenus = [
    await Submenu.new({
      text: "File",
      items: [
        await item("Import OPML or JSON…", a.importFile),
        await Submenu.new({
          text: "Export This Map",
          items: [
            await item("As Markdown…", () => a.exportMap("md")),
            await item("As OPML…", () => a.exportMap("opml")),
            await item("As JSON (Everything)…", () => a.exportMap("json")),
            await line(),
            await item("As Picture (SVG)…", () => a.exportPicture("svg")),
            await item("As Picture (PNG)…", () => a.exportPicture("png")),
          ],
        }),
        await line(),
        await item("Trash", a.trash),
        await line(),
        await system("CloseWindow"),
      ],
    }),
    await Submenu.new({
      text: "Edit",
      items: [
        await item("Undo", a.undo, "CmdOrCtrl+Z"),
        await item("Redo", a.redo, "CmdOrCtrl+Shift+Z"),
        await line(),
        await system("Cut"),
        await system("Copy"),
        await system("Paste"),
        await system("SelectAll"),
        await item("Copy Map as Picture", a.copyPicture),
        await line(),
        await item("Search…", a.search, "CmdOrCtrl+K"),
        await item("Link To…", a.link, "CmdOrCtrl+L"),
      ],
    }),
    await Submenu.new({
      text: "Node",
      items: [
        await item("New Child (Tab)", () => press({ key: "Tab" })),
        await item("New Sibling (Enter)", () => press({ key: "Enter" })),
        await item("Delete (⌫)", () => press({ key: "Delete" })),
        await line(),
        await item("Task", () => press(cmd({ key: "t" })), "CmdOrCtrl+T"),
        await item("Tick Task (Space)", () => press({ key: " " })),
        priorities,
        await line(),
        await item("Make Map or Undo It", () => press(cmd({ key: "M", shiftKey: true })), "CmdOrCtrl+Shift+M"),
        await item(`Open Map (${mac() ? "⌘↓" : "Ctrl+↓"})`, () => press(cmd({ key: "ArrowDown" }))),
        await item("Fold or Unfold", () => press(cmd({ key: "/" })), "CmdOrCtrl+/"),
      ],
    }),
    await Submenu.new({
      text: "View",
      items: [
        mapItem,
        outlineItem,
        orgChartItem,
        timelineItem,
        await line(),
        sidebarItem,
        await item("Tasks", a.showTasks, "CmdOrCtrl+Shift+T"),
        notesItem,
        sourceItem,
        hideDoneItem,
        await line(),
        await item("Back", a.back, "CmdOrCtrl+["),
        await item("Forward", a.forward, "CmdOrCtrl+]"),
        await item(`Out to the Map Around (${mac() ? "⌘↑" : "Ctrl+↑"})`, a.up),
        await line(),
        await item("Zoom In", () => press(cmd({ key: "=" })), "CmdOrCtrl+="),
        await item("Zoom Out", () => press(cmd({ key: "-" })), "CmdOrCtrl+-"),
        await item("Show Whole Map", () => press(cmd({ key: "0" })), "CmdOrCtrl+0"),
        await line(),
        await system("Fullscreen"),
      ],
    }),
    await Submenu.new({
      text: "Window",
      items: [await system("Minimize"), await system("Maximize")],
    }),
    await Submenu.new({
      text: "Help",
      items: [
        await item("Show the Tour", a.showTour),
        await item("Remove the Tour", a.removeTour),
        await line(),
        await item("Check for Updates…", a.checkForUpdates),
      ],
    }),
  ];

  if (mac()) {
    // The app's own menu, first, as every Mac app has it.
    const version = await getVersion();
    submenus.unshift(
      await Submenu.new({
        text: "Brock",
        items: [
          await PredefinedMenuItem.new({ item: { About: { name: "Brock", version } } }),
          await line(),
          await item("Settings…", a.settings, "CmdOrCtrl+,"),
          await line(),
          await system("Services"),
          await line(),
          await system("Hide"),
          await system("HideOthers"),
          await system("ShowAll"),
          await line(),
          await system("Quit"),
        ],
      }),
    );
  } else {
    // Elsewhere Settings and Quit live in File.
    const file = submenus[0];
    await file.insert([await line(), await item("Settings…", a.settings, "Ctrl+,")], 5);
    await file.append(await system("Quit"));
  }

  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();

  return {
    view: (v) => {
      mapItem.setChecked(v === "map");
      outlineItem.setChecked(v === "outline");
    },
    layout: (l) => {
      orgChartItem.setChecked(l === "org");
      timelineItem.setChecked(l === "timeline");
    },
    sidebar: (open) => sidebarItem.setChecked(open),
    notes: (open) => notesItem.setChecked(open),
    source: (on) => sourceItem.setChecked(on),
    hideDone: (on) => hideDoneItem.setChecked(on),
  };
}
