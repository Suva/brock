<!--
  The window: the breadcrumbs of the open map, the map drawn as a map or as an
  outline, the selected node's notes, and whether everything is saved.
-->
<script lang="ts">
  import { onMount, tick, untrack } from "svelte";
  import { toSVG } from "../core/picture.ts";
  import { clearBackground, toCanvas, toPNG } from "./picture.ts";
  import { writePicture } from "./system-clipboard.ts";
  import MapView, { type Elsewhere } from "./MapView.svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { installMenu, type MenuActions, type MenuChecks } from "./app-menu.ts";
  import { customTitleBar } from "./chrome.ts";
  import { menuItems } from "./menu-items.ts";
  import AppMenu from "./AppMenu.svelte";
  import WindowButtons from "./WindowButtons.svelte";
  import { removeTour, showTour } from "./tour.ts";
  import type { Command } from "../core/markdown.ts";
  import type { MapLayout } from "../core/node.ts";
  import { importInto, readOutlines, toJSON, toMarkdown, toOPML } from "../core/exchange.ts";
  import { Pane } from "./pane.svelte.ts";
  import { openText, savePNG, saveText, type FileKind } from "./files.ts";
  import { typingIn } from "./keys.ts";
  import { SHARE_MAX, SHARE_MIN, savedSession, saveSession, type PanePlace, type Split } from "./session.ts";
  import type { Live } from "./live.svelte.ts";
  import NotesPanel from "./NotesPanel.svelte";
  import Palette from "./Palette.svelte";
  import { saveUsage, usage } from "./usage.ts";
  import OutlineView from "./OutlineView.svelte";
  import AttentionBell from "./AttentionBell.svelte";
  import { nextFlag } from "../core/attention.ts";
  import MoreMenu from "./MoreMenu.svelte";
  import Settings from "./Settings.svelte";
  import { agents } from "./agents.svelte.ts";
  import { settle } from "../core/vault.ts";
  import UpdateOffer from "./UpdateOffer.svelte";
  import { canUpdate, findUpdate, watchForUpdates, type Update } from "./updates.ts";
  import Resizer from "./Resizer.svelte";
  import Sidebar, { type Tab } from "./Sidebar.svelte";
  import TrashDialog from "./TrashDialog.svelte";

  let { live }: { live: Live } = $props();
  const vault = $derived(live.vault);
  const version = $derived(live.version);

  // The window starts where it was left: each pane's map and node, if they
  // are still there, its view, the split and the panels (session.ts).
  const start = (() => {
    const saved = savedSession();
    const v = untrack(() => live.vault);
    const panes = saved.panes.map((p): PanePlace => {
      const map = p.map && v.isLive(p.map) && v.get(p.map)!.isMap ? p.map : null;
      const node = map && p.node && v.isLive(p.node) ? p.node : null;
      return { ...p, map, node };
    });
    return { ...saved, panes };
  })();

  // The panes of the window, each with its own map, and the one the keyboard,
  // the header and the panels work on (PLAN.md, split view). Replaced whole
  // when a pane is added or closed.
  let panes = $state.raw(start.panes.map((p) => new Pane(untrack(() => live), p)));
  let active = $state(start.active);
  /** How the window is split, when it has two panes. */
  let split = $state<Split | null>(start.split);

  // ---- Split view ------------------------------------------------------------

  /** The room the panes have: the window less the side panels. */
  let roomWidth = $state(0);
  let roomHeight = $state(0);
  let room: HTMLElement;
  /** Smaller than this, a pane is no use; the window is not split. */
  const PANE_MIN = { width: 360, height: 280 };

  /** View › Split View (⇧⌘D): splits the window, or closes the pane that is not active. */
  function toggleSplit() {
    if (panes.length > 1) closePane(active === 0 ? 1 : 0);
    else splitWindow();
  }

  /**
   * Makes a second pane on this one's map and node, the long way: beside when
   * the room is wider than it is tall, below otherwise, or the other way when
   * only that leaves each pane room enough. The new pane becomes active.
   * False, and said, when the room is too small for two either way.
   */
  function splitWindow(): boolean {
    const fits = (d: Split["direction"]) =>
      d === "beside"
        ? roomWidth / 2 >= PANE_MIN.width && roomHeight >= PANE_MIN.height
        : roomWidth >= PANE_MIN.width && roomHeight / 2 >= PANE_MIN.height;
    const long = roomWidth >= roomHeight ? "beside" : "below";
    const short = long === "beside" ? "below" : "beside";
    const direction = fits(long) ? long : fits(short) ? short : null;
    if (!direction) {
      tell("There is not room for two maps here. Make the window larger, or close a side panel.");
      return false;
    }
    const second = new Pane(untrack(() => live), { map: pane.mapId, node: pane.selected, view: pane.view });
    pane.editing = null;
    panes = [...panes, second];
    split = { direction, share: 0.5 };
    active = panes.length - 1;
    return true;
  }

  function closePane(i: number) {
    if (panes.length < 2) return;
    panes = panes.filter((_, j) => j !== i);
    active = 0;
    split = null;
  }

  /**
   * Makes pane `i` the active one. Every change of pane but splitting and
   * closing goes through here: a title being edited in the pane left is
   * finished first, as the keys now go elsewhere.
   */
  function activate(i: number) {
    if (i === active || !panes[i]) return;
    panes[active].editing = null;
    active = i;
  }

  /** ⌃Tab and ⌃⇧Tab: the next pane, or the one before, becomes active. */
  function switchPane(by: 1 | -1) {
    if (panes.length > 1) activate((active + by + panes.length) % panes.length);
  }

  // A press, a scroll or a pinch in a pane makes it active before anything in
  // it sees the event: listened for on the way down, by the room the panes are in.
  $effect(() => {
    const el = room;
    const types = ["pointerdown", "wheel", "gesturestart"];
    const onEvent = (e: Event) => {
      const at = (e.target as Element | null)?.closest?.<HTMLElement>("[data-pane]");
      if (at && el.contains(at)) activate(Number(at.dataset.pane));
    };
    for (const type of types) el.addEventListener(type, onEvent, { capture: true, passive: true });
    return () => types.forEach((type) => el.removeEventListener(type, onEvent, { capture: true }));
  });

  /** Opens a map in the other pane, splitting the window first if it is not; that pane becomes active. */
  function openBeside(id: string) {
    if (panes.length < 2) {
      if (!splitWindow()) return;
    } else activate(active === 0 ? 1 : 0);
    panes[active].open(id);
  }

  /**
   * Dragging the divider between the panes: the first pane's share of the
   * room. The divider holds the pointer, so letting go anywhere ends it.
   */
  let dividing = $state(false);
  function startDividing(e: PointerEvent) {
    dividing = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function divide(e: PointerEvent) {
    if (!dividing || !split) return;
    const r = room.getBoundingClientRect();
    const at = split.direction === "beside" ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height;
    split = { ...split, share: Math.min(SHARE_MAX, Math.max(SHARE_MIN, at)) };
  }
  function divideByKey(e: KeyboardEvent) {
    if (!split) return;
    const less = split.direction === "beside" ? "ArrowLeft" : "ArrowUp";
    const more = split.direction === "beside" ? "ArrowRight" : "ArrowDown";
    if (e.key !== less && e.key !== more) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.key === more ? 0.05 : -0.05;
    split = { ...split, share: Math.min(SHARE_MAX, Math.max(SHARE_MIN, split.share + step)) };
  }

  /**
   * A node dragged on pane `i`'s map, passed on to whichever other pane the
   * pointer is over: that pane's map shows where it would land and takes it
   * when let go, and becomes the active pane. An outline there takes nothing.
   */
  let dragOver: Pane | null = null;
  function elsewhereFor(i: number): Elsewhere {
    // The pane dragged over is the window's, not this object's: one drag goes on at a time.
    return {
      aim(ids, x, y) {
        const at = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane]");
        const j = at ? Number(at.dataset.pane) : -1;
        const target = j >= 0 && j !== i ? panes[j] : null;
        if (dragOver && dragOver !== target) dragOver.mapView?.leaveFrom();
        dragOver = target;
        target?.mapView?.aimFrom(ids, x, y);
        return target !== null;
      },
      leave() {
        dragOver?.mapView?.leaveFrom();
        dragOver = null;
      },
      land(ids, grabbed, fromCentre) {
        const target = dragOver;
        dragOver = null;
        if (!target?.mapView) return false;
        const moved = target.mapView.landFrom(ids, grabbed, fromCentre);
        if (moved) activate(panes.indexOf(target));
        return moved;
      },
    };
  }

  /** The keys taken before anything else sees them: ⌃Tab is Tab to the outline's rows and the title editor. */
  function onWindowKeyFirst(event: KeyboardEvent) {
    if (event.key !== "Tab" || !event.ctrlKey || event.metaKey || event.altKey) return;
    // Keys pressed in a dialog stay there (keys.ts); a text field in a pane is no matter.
    if ((event.target as Element | null)?.closest?.('[role="dialog"]')) return;
    event.preventDefault();
    event.stopPropagation();
    switchPane(event.shiftKey ? -1 : 1);
  }
  const pane = $derived(panes[active]);
  /** The active pane's map. */
  const mapId = $derived(pane.mapId);
  let notesOpen = $state(start.notesOpen);
  let notesSource = $state(start.notesSource);
  /** The search palette, open to go somewhere or to link the selected node. */
  let searching = $state<false | "go" | "link">(false);
  /** The sidebar on the left, and which of its tabs shows; it opens on the tab used last. */
  let sidebarOpen = $state(start.sidebarOpen);
  let sidebarTab = $state<Tab>(start.sidebarTab);
  /** How wide the side panels are, as dragged. */
  let sidebarWidth = $state(start.sidebarWidth);
  let notesWidth = $state(start.notesWidth);
  /** Done tasks hidden on the map and in the outline (⇧⌘H); nothing is changed in the vault. */
  let hideDone = $state(start.hideDone);

  // Remembered as it changes, for the next start.
  $effect(() => {
    const places = panes.map((p): PanePlace => ({ map: p.mapId, node: p.selected, view: p.view }));
    saveSession({ panes: places, active, split, sidebarOpen, sidebarTab, notesOpen, notesSource, hideDone, sidebarWidth, notesWidth });
  });

  /** A tab's button or key: opens the sidebar on it, or closes it if it is showing. */
  function showTab(tab: Tab) {
    sidebarOpen = !(sidebarOpen && sidebarTab === tab);
    sidebarTab = tab;
  }

  /** A brock: link in a node's notes: opens what it names, as its button or key would, but never closes it. */
  function run(command: Command) {
    if (command === "tasks" || command === "maps" || command === "history") {
      sidebarOpen = true;
      sidebarTab = command;
    } else if (command === "search") searching = "go";
    else if (command === "settings") settingsOpen = true;
    else trashOpen = true;
  }
  let moreOpen = $state(false);
  let attentionOpen = $state(false);
  let trashOpen = $state(false);
  let settingsOpen = $state(false);
  /** A line in the footer for a few seconds: what an export or import did. */
  let notice = $state<{ text: string; bad: boolean } | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function tell(text: string, bad = false) {
    notice = { text, bad };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), bad ? 8000 : 4000);
  }

  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /** A newer version of the app, offered until it is installed or put off. */
  let offered = $state<Update | null>(null);

  /** Help › Check for Updates…: looks now, whether or not updates are on, and says what it found. */
  async function checkForUpdates() {
    if (!canUpdate()) return tell("Updates come with the desktop app; a browser always has the newest.");
    tell("Looking for a newer version…");
    try {
      const update = await findUpdate();
      if (update) {
        offered = update;
        notice = null;
      } else tell("This is the newest version of Brock.");
    } catch (error) {
      tell(`Could not look for updates: ${reason(error)}`, true);
    }
  }

  /** Exports the open map, everything under it included. */
  async function exportMap(kind: FileKind) {
    const title = vault.get(mapId)?.title || "Mind map";
    const content = kind === "json" ? toJSON(vault, mapId) : kind === "md" ? toMarkdown(vault, mapId) : toOPML(vault, mapId);
    try {
      const saved = await saveText(title, content, kind);
      if (saved) tell(`Exported as ${saved}`);
    } catch (error) {
      tell(`Not exported: ${reason(error)}`, true);
    }
  }

  /**
   * A picture of the open map: the map as it is drawn, so the outline shows
   * the map for a moment first.
   */
  async function picture() {
    if (pane.view !== "map") {
      pane.view = "map";
      await tick();
    }
    if (!pane.mapView) throw new Error("There is no map to take a picture of.");
    return pane.mapView.picture(clearBackground());
  }

  async function exportPicture(kind: "svg" | "png") {
    const title = vault.get(mapId)?.title || "Mind map";
    try {
      const p = await picture();
      const saved = kind === "svg" ? await saveText(title, toSVG(p), "svg") : await savePNG(title, await toPNG(p));
      if (saved) tell(`Exported as ${saved}`);
    } catch (error) {
      tell(`Not exported: ${reason(error)}`, true);
    }
  }

  async function copyPicture() {
    try {
      await writePicture(toCanvas(await picture()));
      tell("A picture of the map is on the clipboard.");
    } catch (error) {
      tell(`Not copied: ${reason(error)}`, true);
    }
  }

  /** Brings an OPML or JSON file in, under the selected node. */
  async function importFile() {
    try {
      const text = await openText();
      if (text === null) return;
      const outlines = readOutlines(text);
      if (outlines.length === 0) return tell("The file holds no outline to bring in.", true);
      const parent = pane.selected && vault.isLive(pane.selected) ? pane.selected : mapId;
      const target = vault.get(parent)!;
      // Under a map shown as a portal, it goes in, and the map opens.
      const made = importInto(vault, parent, outlines, target.isMap ? parent : mapId);
      if (target.isMap && parent !== mapId) open(parent);
      pane.selected = made[0].id;
      tell(`Brought in ${made.length === 1 ? `“${made[0].title || "Untitled"}”` : `${made.length} branches`}. ⌘Z takes it out again.`);
    } catch (error) {
      tell(`Not brought in: ${reason(error)}`, true);
    }
  }

  const moreItems = $derived([
    { label: "Export this map as Markdown…", run: () => exportMap("md") },
    { label: "Export this map as OPML…", run: () => exportMap("opml") },
    { label: "Export this map as JSON…", run: () => exportMap("json"), hint: "everything" },
    { label: "Export this map as a picture (SVG)…", run: () => exportPicture("svg") },
    { label: "Export this map as a picture (PNG)…", run: () => exportPicture("png") },
    { label: "Copy this map as a picture", run: copyPicture },
    "line" as const,
    { label: "Import OPML or JSON…", run: importFile, hint: "under the selected node" },
    "line" as const,
    { label: "Trash", run: () => (trashOpen = true) },
    { label: "Show the tour", run: openTour },
    { label: "Remove the tour", run: dropTour },
    ...(canUpdate() ? [{ label: "Check for updates…", run: checkForUpdates }] : []),
    { label: "Settings", run: () => (settingsOpen = true), hint: "⌘," },
  ]);

  /** How the open map is drawn. */
  const mapLayout = $derived.by(() => {
    void version;
    return vault.get(mapId)?.layout ?? null;
  });

  /** Draws the open map this way, or as a mind map again; it shows on the map, not in the outline. */
  function toggleLayout(layout: MapLayout) {
    vault.update(mapId, { layout: mapLayout === layout ? null : layout });
    pane.view = "map";
  }

  const breadcrumbs = $derived.by(() => {
    void version;
    return vault.mapPath(mapId);
  });

  /**
   * The breadcrumbs as shown: all of them when few, or else the top, a "…"
   * for the maps between, and the last two, so a deep map never pushes the
   * header's buttons out of the window.
   */
  const MOST_CRUMBS = 4;
  const folded = $derived(breadcrumbs.length > MOST_CRUMBS ? breadcrumbs.slice(1, -2) : []);
  const shownCrumbs = $derived(
    folded.length ? [breadcrumbs[0], "fold" as const, ...breadcrumbs.slice(-2)] : breadcrumbs,
  );
  let foldOpen = $state(false);

  // Back and forward (⌘← ⌘→, or ⌘[ ⌘]), going into maps and to nodes are the active pane's.
  /** Opens a map in the active pane, or with ⌥ in the other one. */
  const open = (id: string, beside = false) => (beside ? openBeside(id) : pane.open(id));
  const step = (direction: "back" | "forward") => pane.step(direction);
  const up = () => pane.up();
  const canGoBack = $derived(pane.canGoBack);
  const canGoForward = $derived(pane.canGoForward);
  /** Moves how far the open map is shared with agents on: not at all, to read, to edit, and round. */
  function shareWithAgents() {
    const next = ({ none: "read", read: "write", write: "none" } as const)[agents.level(mapId)];
    agents.share(mapId, next);
    const said = { none: "Agents can no longer see this map.", read: "Agents can now read this map.", write: "Agents can now read and edit this map." }[next];
    tell(agents.on || next === "none" ? said : `${said} Allow agents in Settings for it to count.`);
  }

  /** Moves the selected node's mark on: none, attention, critical, OK, and round. */
  function flagSelected() {
    const id = pane.selected ?? mapId;
    const node = live.vault.get(id);
    if (node) live.vault.update(id, { flag: nextFlag(node.flag) });
  }

  // Every pane, shown or not, as map or outline, lets go of nodes that have
  // gone. The map view also falls back for nodes it no longer draws, such as
  // folded ones; this covers the outline and the panes it does not show.
  $effect(() => {
    void version;
    for (const p of panes) p.repair();
  });

  /** What the panes have selected or are editing, which tidying leaves alone. */
  function workedOn(among: readonly Pane[] = panes): string[] {
    return among.flatMap((p) => [p.selected, p.editing]).filter((id): id is string => id !== null);
  }

  // A node left without a title is deleted once no pane has it selected or
  // being edited, so empty "Idea" nodes do not pile up however they came to be.
  let lastWorked = new Set<string>();
  $effect(() => {
    const worked = new Set(workedOn());
    const left = [...lastWorked].filter((id) => !worked.has(id));
    lastWorked = worked;
    if (left.length > 0) untrack(() => live.vault.sweepEmpty(worked, left));
  });
  // And those left from before, on opening.
  onMount(() => {
    live.vault.sweepEmpty(new Set(workedOn()));
  });

  function goTo(id: string) {
    searching = false;
    pane.goTo(id);
  }

  /** Goes to a node chosen in the palette, remembering it was chosen for `query`. */
  function chosen(id: string, query: string) {
    usage.pick(query, id);
    saveUsage();
    if (searching === "link") linkTo(id);
    else goTo(id);
  }

  /** Links the selected node to `id`, chosen in the palette. */
  function linkTo(id: string) {
    searching = false;
    vault.link(pane.selected ?? mapId, id);
  }

  function undo(redo = false) {
    // A title being edited is finished first; what was typed is then undone.
    pane.editing = null;
    const changes = redo ? vault.redo() : vault.undo();
    const last = settle(vault, changes, pane.selected, workedOn(panes.filter((p) => p !== pane)));
    // Selected where it can be seen: in this pane, or else in another pane
    // that shows its map, which becomes the active one.
    const shows = (p: Pane) => last !== null && (last === p.mapId || vault.mapOf(last) === p.mapId);
    const there = shows(pane) ? -1 : panes.findIndex(shows);
    if (there === -1) pane.selected = last;
    else {
      activate(there);
      panes[there].selected = last;
    }
  }

  /**
   * Showing and hiding the sidebar: ⌃⌘S on a Mac, as in Finder, Mail and
   * Notes, and Ctrl+Shift+S elsewhere. Keys of letters, which every keyboard
   * layout types the same way, unlike a backslash.
   */
  function sidebarKey(e: KeyboardEvent): boolean {
    if (e.key.toLowerCase() !== "s" || e.altKey) return false;
    return navigator.platform.startsWith("Mac") ? e.ctrlKey && e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey;
  }

  /** Help › Show the Tour: goes to the tour, adding a fresh one if there is none. */
  function openTour() {
    open(showTour(vault));
    notesOpen = true;
  }

  /** Help › Remove the Tour. */
  function dropTour() {
    if (!removeTour(vault)) return tell("There is no tour in the vault. Show the tour adds one.");
    tell("The tour is in the trash. ⌘Z brings it back.");
  }

  // A quiet look for a newer version, in the app only, unless turned off.
  onMount(() => watchForUpdates((update) => (offered ??= update)));
  // What an agent changed is said in the footer, as the person did not do it.
  onMount(() => {
    agents.onChanged = (what) => tell(`An agent ${what}. ⌘Z undoes it.`);
    return () => (agents.onChanged = null);
  });

  // The menu bar, in the app: every command, with its key.
  let menuChecks = $state<MenuChecks | null>(null);
  /** Where the window has no title bar of its own, the header has the window's buttons and the menu bar's menus (chrome.ts). */
  const ownTitleBar = customTitleBar();
  const menuActions: MenuActions = {
      settings: () => (settingsOpen = true),
      importFile,
      exportMap,
      exportPicture,
      copyPicture,
      trash: () => (trashOpen = true),
      undo: () => undo(),
      redo: () => undo(true),
      search: () => {
        pane.editing = null;
        searching = "go";
      },
      link: () => {
        pane.editing = null;
        searching = "link";
      },
      view: (v) => (pane.view = v),
      toggleLayout,
      toggleSidebar: () => (sidebarOpen = !sidebarOpen),
      showTasks: () => showTab("tasks"),
      showHistory: () => showTab("history"),
      flagSelected,
      shareWithAgents,
      showAttention: () => (attentionOpen = !attentionOpen),
      toggleNotes: () => (notesOpen = !notesOpen),
      toggleSource: () => (notesSource = !notesSource),
      toggleHideDone: () => (hideDone = !hideDone),
      toggleSplit,
      closePane: () => closePane(active),
      back: () => step("back"),
      forward: () => step("forward"),
      up,
      showTour: openTour,
      removeTour: dropTour,
      checkForUpdates,
  };
  onMount(() => {
    if (ownTitleBar) return;
    installMenu(menuActions)
      .then((checks) => (menuChecks = checks))
      .catch((error) => console.error("The menu bar could not be made:", error));
  });
  const quit = () => void getCurrentWindow().close();
  const appMenuItems = $derived(
    menuItems(menuActions, { view: pane.view, layout: mapLayout, sidebar: sidebarOpen, notes: notesOpen, source: notesSource, hideDone, split: panes.length > 1 }, quit),
  );
  $effect(() => {
    menuChecks?.view(pane.view);
    menuChecks?.layout(mapLayout);
    menuChecks?.sidebar(sidebarOpen);
    menuChecks?.notes(notesOpen);
    menuChecks?.source(notesSource);
    menuChecks?.hideDone(hideDone);
    menuChecks?.split(panes.length > 1);
  });

  function onWindowKey(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      // The vault's undo, not a text field's own.
      undo(event.shiftKey);
    } else if (event.key === "ArrowUp" && !event.shiftKey && !event.altKey && !typingIn(event.target)) {
      up();
    } else if (
      // ⌘[ and ⌘] work everywhere; ⌘← and ⌘→ only where they do not move a cursor.
      (event.key === "[" && !event.shiftKey) ||
      (event.key === "ArrowLeft" && !event.shiftKey && !event.altKey && !typingIn(event.target))
    ) {
      step("back");
    } else if (
      (event.key === "]" && !event.shiftKey) ||
      (event.key === "ArrowRight" && !event.shiftKey && !event.altKey && !typingIn(event.target))
    ) {
      step("forward");
    } else if (sidebarKey(event)) {
      sidebarOpen = !sidebarOpen;
    } else if (event.key === "," && !event.shiftKey) {
      settingsOpen = !settingsOpen;
    } else if (key === "k" && !event.shiftKey) {
      pane.editing = null;
      searching = searching ? false : "go";
    } else if (key === "l" && !event.shiftKey) {
      pane.editing = null;
      searching = searching ? false : "link";
    } else if (key === "h" && event.shiftKey) {
      hideDone = !hideDone;
    } else if (key === "t" && event.shiftKey) {
      showTab("tasks");
    } else if (key === "y" && event.shiftKey) {
      showTab("history");
    } else if (key === "a" && event.shiftKey && !event.altKey) {
      flagSelected();
    } else if (key === "b" && event.shiftKey && !event.altKey) {
      attentionOpen = !attentionOpen;
    } else if (key === "d" && event.shiftKey && !event.altKey) {
      toggleSplit();
    } else if (key === "n" && event.shiftKey) {
      notesOpen = !notesOpen;
    } else if (key === "e" && !event.shiftKey && !event.altKey) {
      notesSource = !notesSource;
    } else if (event.altKey && event.code === "Digit1" && !event.shiftKey) {
      // ⌥⌘1 to ⌥⌘5: ⌘1 to ⌘5 set priorities.
      pane.view = "map";
    } else if (event.altKey && event.code === "Digit2" && !event.shiftKey) {
      pane.view = "outline";
    } else if (event.altKey && event.code === "Digit3" && !event.shiftKey) {
      toggleLayout("org");
    } else if (event.altKey && event.code === "Digit4" && !event.shiftKey) {
      toggleLayout("timeline");
    } else if (event.altKey && event.code === "Digit5" && !event.shiftKey) {
      toggleLayout("board");
    } else {
      return;
    }
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onWindowKey} onkeydowncapture={onWindowKeyFirst} />

<div class="app">
  <!-- Clicking a button here leaves the focus where it was, so the map keeps the keyboard.
       On a Mac the header is the title bar: it moves the window, its buttons apart. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header data-tauri-drag-region="deep" onmousedown={(e) => (e.target as Element).closest("button") && e.preventDefault()}>
    <!-- The menu bar's menus, at the far left as in other Windows apps, where the header is the title bar. -->
    {#if ownTitleBar}<AppMenu items={appMenuItems} />{/if}
    <div class="history">
      <button onclick={() => step("back")} disabled={!canGoBack} title="Back (⌘←)" aria-label="Back">‹</button>
      <button onclick={() => step("forward")} disabled={!canGoForward} title="Forward (⌘→)" aria-label="Forward">›</button>
    </div>
    <nav aria-label="Breadcrumbs">
      {#each shownCrumbs as crumb, i (crumb === "fold" ? "fold" : crumb.id)}
        {#if i > 0}<span class="sep">›</span>{/if}
        {#if crumb === "fold"}
          <div class="fold-crumbs">
            <button
              class="crumb"
              class:on={foldOpen}
              onclick={() => (foldOpen = !foldOpen)}
              title="{folded.length} maps between"
              aria-label="{folded.length} maps between">…</button
            >
            {#if foldOpen}
              <MoreMenu
                align="left"
                items={folded.map((m) => ({ label: (m.icon ? `${m.icon} ` : "") + (m.title || "Untitled"), run: () => open(m.id) }))}
                onClose={() => (foldOpen = false)}
              />
            {/if}
          </div>
        {:else}
          <button class="crumb" class:current={crumb.id === mapId} onclick={(e) => open(crumb.id, e.altKey)} title={(crumb.title || "Untitled") + " (⌥-click: in the other pane)"}>
            {#if crumb.icon}{crumb.icon}&nbsp;{/if}{crumb.title || "Untitled"}
          </button>
        {/if}
      {/each}
    </nav>
    <div class="tools">
      <div class="switch" role="group" aria-label="View">
        <button class:on={pane.view === "map"} onclick={() => (pane.view = "map")} title="Map (⌥⌘1)">Map</button>
        <button class:on={pane.view === "outline"} onclick={() => (pane.view = "outline")} title="Outline (⌥⌘2)">Outline</button>
      </div>
      <button
        class="icon-button"
        class:on={hideDone}
        aria-pressed={hideDone}
        onclick={() => (hideDone = !hideDone)}
        title={hideDone ? "Show done tasks (⇧⌘H)" : "Hide done tasks (⇧⌘H)"}
        aria-label="Hide done tasks"
      >
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path d="M5 8.2 7.1 10.3 11 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
          {#if hideDone}<path d="M2.5 13.5 13.5 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />{/if}
        </svg>
      </button>
      <AttentionBell
        {live}
        open={attentionOpen}
        onToggle={() => (attentionOpen = !attentionOpen)}
        onClose={() => (attentionOpen = false)}
        onGoTo={goTo}
      />
      <button class="icon-button" onclick={() => (searching = "go")} title="Search everything (⌘K)" aria-label="Search">
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M10.4 10.4 14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
        </svg>
      </button>
      <div class="more">
        <button class:on={moreOpen} onclick={() => (moreOpen = !moreOpen)} title="Export, import, trash, settings" aria-label="More">⋯</button>
        {#if moreOpen}
          <MoreMenu items={moreItems} onClose={() => (moreOpen = false)} />
        {/if}
      </div>
    </div>
    {#if ownTitleBar}<WindowButtons />{/if}
  </header>

  <div class="body">
    {#if !sidebarOpen}
      <!-- Tabs on the edges: the ways into the panels, out of the way of the map. -->
      <button
        class="knob"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => (sidebarOpen = true)}
        title="Maps, tasks and history (⌃⌘S, ⇧⌘T, ⇧⌘Y)"
        aria-label="Show the sidebar"
      >
        ›
      </button>
    {/if}
    {#if sidebarOpen}
      <Sidebar
        {live}
        {mapId}
        width={sidebarWidth}
        tab={sidebarTab}
        onTab={(tab) => (sidebarTab = tab)}
        onClose={() => (sidebarOpen = false)}
        onOpen={open}
        onGoTo={goTo}
        onTell={(text) => tell(text)}
      />
      <Resizer width={sidebarWidth} edge="left" onResize={(w) => (sidebarWidth = w)} onClose={() => (sidebarOpen = false)} />
    {/if}
    <!-- The panes: one, or two side by side or one above the other. A press or a
         scroll in a pane makes it the active one before anything in it sees it. -->
    <main
      bind:this={room}
      bind:clientWidth={roomWidth}
      bind:clientHeight={roomHeight}
      class:below={split?.direction === "below"}
    >
      {#each panes as p, i (p)}
        {#if i > 0 && split}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <div
            class="divider"
            class:dragging={dividing}
            role="separator"
            aria-orientation={split.direction === "beside" ? "vertical" : "horizontal"}
            aria-label="Resize the panes"
            aria-valuenow={Math.round(split.share * 100)}
            tabindex="-1"
            onpointerdown={startDividing}
            onpointermove={divide}
            onpointerup={() => (dividing = false)}
            onpointercancel={() => (dividing = false)}
            onlostpointercapture={() => (dividing = false)}
            onkeydown={divideByKey}
          ></div>
        {/if}
        <section
          class="pane"
          class:active={i === active}
          class:split={panes.length > 1}
          style:flex-grow={split ? (i === 0 ? split.share : 1 - split.share) : 1}
          data-pane={i}
          aria-label={panes.length > 1 ? (i === active ? "Active pane" : "Other pane") : undefined}
        >
          {#if panes.length > 1}
            {@const title = vault.get(p.mapId)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="strip" onmousedown={(e) => (e.target as Element).closest("button") && e.preventDefault()}>
              <span class="strip-title">{#if title?.icon}{title.icon}&nbsp;{/if}{title?.title || "Untitled"}</span>
              <button class="close" onclick={() => closePane(i)} title="Close this pane" aria-label="Close this pane">×</button>
            </div>
          {/if}
          <div class="view">
            {#if p.view === "map"}
              <MapView
                bind:this={p.mapView}
                {live}
                mapId={p.mapId}
                {hideDone}
                active={i === active}
                pane={p.key}
                elsewhere={panes.length > 1 ? elsewhereFor(i) : undefined}
                bind:selected={p.selected}
                bind:editing={p.editing}
                onOpen={(id, beside) => (beside ? openBeside(id) : p.open(id))}
                onGoTo={goTo}
                onShowNotes={() => (notesOpen = true)}
                onUp={() => p.up()}
              />
            {:else}
              <OutlineView
                {live}
                mapId={p.mapId}
                {hideDone}
                active={i === active}
                bind:selected={p.selected}
                onOpen={(id, beside) => (beside ? openBeside(id) : p.open(id))}
                onUp={() => p.up()}
              />
            {/if}
          </div>
        </section>
      {/each}
    </main>
    {#if !notesOpen}
      <button
        class="knob right"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => (notesOpen = true)}
        title="Notes (⇧⌘N)"
        aria-label="Show the notes"
      >
        ‹
      </button>
    {/if}
    {#if notesOpen}
      <NotesPanel
        {live}
        nodeId={pane.selected ?? mapId}
        centre={(pane.selected ?? mapId) === mapId}
        onClose={() => (notesOpen = false)}
        onGoTo={goTo}
        onCommand={run}
        onProblem={(text) => tell(text, true)}
        source={notesSource}
        onToggleSource={() => (notesSource = !notesSource)}
        width={notesWidth}
      />
      <Resizer width={notesWidth} edge="right" onResize={(w) => (notesWidth = w)} onClose={() => (notesOpen = false)} />
    {/if}
  </div>

  {#if searching}
    <Palette
      {live}
      {mapId}
      purpose={searching}
      exclude={searching === "link" ? (pane.selected ?? mapId) : null}
      onChoose={chosen}
      onClose={() => (searching = false)}
    />
  {/if}

  {#if trashOpen}
    <TrashDialog {live} onClose={() => (trashOpen = false)} onGoTo={(id) => {
        trashOpen = false;
        goTo(id);
      }} />
  {/if}
  {#if settingsOpen}
    <Settings {live} onClose={() => (settingsOpen = false)} onCheck={checkForUpdates} />
  {/if}
  {#if offered}
    <UpdateOffer update={offered} saved={live.saved} onLater={() => (offered = null)} />
  {/if}

  <footer class:failed={live.saveStatus === "failed" || notice?.bad}>
    {#if notice}
      {notice.text}
    {:else if live.saveStatus === "failed"}
      Not saved: {live.saveError}. Trying again…
    {:else if live.saveStatus === "saving"}
      Saving…
    {:else}
      Saved
    {/if}
  </footer>
</div>

<style>
  .app {
    display: grid;
    /* minmax(0, …) lets the body shrink to the window; long notes scroll in their panel. */
    grid-template-rows: auto minmax(0, 1fr) auto;
    /* The column may be narrower than the header's content, which shrinks to fit. */
    grid-template-columns: minmax(0, 1fr);
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--line);
  }

  /* On a Mac the header is the title bar, with the window's buttons at its left. */
  :global(.mac-titlebar) header {
    min-height: 46px;
    padding-left: 96px;
    user-select: none;
    -webkit-user-select: none;
  }

  /* Without a title bar of its own, the header is it: the window's buttons at its right. */
  :global(.custom-titlebar) header {
    min-height: 40px;
    user-select: none;
    -webkit-user-select: none;
  }

  :global(.mac-titlebar.fullscreen) header {
    padding-left: 1rem;
  }

  .history {
    display: flex;
    flex: none;
    margin-left: -0.4rem;
  }

  .knob {
    position: absolute;
    left: 0;
    top: 50%;
    z-index: 2;
    transform: translateY(-50%);
    width: 14px;
    height: 56px;
    padding: 0;
    border: 1px solid var(--line);
    border-left: none;
    border-radius: 0 8px 8px 0;
    background: var(--bg);
    color: var(--muted);
    font-size: 0.9rem;
    line-height: 1;
  }

  .knob.right {
    left: auto;
    right: 0;
    border-left: 1px solid var(--line);
    border-right: none;
    border-radius: 8px 0 0 8px;
  }

  .icon-button {
    display: grid;
    place-items: center;
    padding: 0.3rem 0.45rem;
  }

  .knob:hover {
    width: 18px;
    color: var(--accent);
    background: var(--accent-soft);
  }

  .history button {
    font-size: 1.15rem;
    line-height: 1;
    padding: 0.1rem 0.45rem 0.2rem;
  }

  nav {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    overflow: hidden;
  }

  .sep {
    color: var(--muted);
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.2rem 0.55rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--accent-soft);
  }

  button:disabled {
    color: var(--muted);
    cursor: default;
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .crumb {
    /* Long names shrink with an ellipsis rather than widen the header. */
    flex: 0 1 auto;
    min-width: 2.5rem;
    max-width: 14rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .fold-crumbs {
    position: relative;
    flex: none;
  }

  .sep {
    flex: none;
  }

  .crumb.current {
    font-weight: 600;
  }

  .tools {
    flex: none;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .more {
    position: relative;
  }

  .switch {
    display: flex;
    padding: 2px;
    margin-right: 0.5rem;
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .switch button {
    padding: 0.1rem 0.6rem;
  }

  .body {
    position: relative;
    display: flex;
    min-height: 0;
  }

  main {
    flex: 1;
    min-width: 0;
    display: flex;
  }

  main.below {
    flex-direction: column;
  }

  .pane {
    position: relative;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .pane > .view {
    flex: 1;
    min-height: 0;
  }

  /* The active pane, when there are two: a thin line round it, over the map. */
  .pane.split.active::after {
    content: "";
    position: absolute;
    inset: 0;
    border: 1px solid var(--accent);
    pointer-events: none;
    z-index: 2;
  }

  .strip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.1rem 0.3rem 0.1rem 0.7rem;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.8rem;
    min-width: 0;
  }

  .pane.active .strip {
    color: inherit;
  }

  .strip-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .strip .close {
    flex: none;
    padding: 0 0.35rem;
    line-height: 1.4;
  }

  /* The line between the panes, with a wider place to take hold of it. */
  .divider {
    position: relative;
    flex: 0 0 1px;
    background: var(--line);
    cursor: col-resize;
    touch-action: none;
    z-index: 3;
    outline: none;
  }

  main.below .divider {
    cursor: row-resize;
  }

  .divider::before {
    content: "";
    position: absolute;
    inset: 0 -3px;
  }

  main.below .divider::before {
    inset: -3px 0;
  }

  .divider:hover,
  .divider.dragging {
    background: var(--accent);
  }

  footer {
    padding: 0.3rem 1rem;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.8rem;
  }

  footer.failed {
    color: var(--danger);
  }
</style>
