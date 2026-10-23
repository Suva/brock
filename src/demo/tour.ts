// The tour: Brock explained in a map of its own. Each node's title is a short
// hint to try on it, and its notes, open beside the map, say more. It is made
// through the vault's own edits, as anything typed would be, so it is always
// a vault the app can open.
//
// It is in two places, worded for each: the website's demo opens on it, as
// the whole vault (`tour`), and the app adds it to a new vault on its first
// start, as a map under the top (`addTour`), to be removed when done.
//
// In a browser some keys belong to the browser and never reach the page:
// ⌘T, ⌘N, ⌘W and ⌘1 to ⌘5 among them. There the hints point to the buttons
// in the notes panel that do the same.

import { newBranch } from "../core/branches.ts";
import type { Node, NodeFields } from "../core/node.ts";
import { Vault } from "../core/vault.ts";

const DAY = 24 * 60 * 60 * 1000;

export const TOUR_TITLE = "Welcome to Brock";

/** Where the tour is shown: the website's demo, or the app. */
type Place = "web" | "app";

/** Notes from paragraphs, a blank line between them. */
const notes = (...paragraphs: string[]) => paragraphs.join("\n\n");

/** The website's demo: the tour as a whole vault, with tasks done today, yesterday and last week as seen at `now`. */
export function tour(now = Date.now()): Node[] {
  const nodes = new Map<string, Node>();
  const vault = new Vault([], {
    now: () => now,
    onChange: (changes) => changes.forEach((c) => nodes.set(c.after.id, c.after)),
  });
  fill(vault, vault.rootId, now, "web");
  return [...nodes.values()];
}

/**
 * The app: the tour added as a map of its own, the last under `parentId`,
 * as one step. Returns the map's id.
 */
export function addTour(vault: Vault, parentId: string, now = Date.now()): string {
  return vault.transact(() => {
    const parent = vault.get(parentId)!;
    // Under a map's centre, it is a branch with a side and a colour.
    const fields = parent.isMap ? newBranch(vault.children(parentId)) : {};
    const map = vault.addChild(parentId, { title: TOUR_TITLE, ...fields });
    vault.setMap(map.id, true);
    fill(vault, map.id, now, "app");
    return map.id;
  });
}

/** Gives `rootId` the tour's title, notes and branches. */
function fill(vault: Vault, rootId: string, now: number, place: Place) {
  const web = place === "web";
  /** The way to make a task or set a priority: a key in the app, a button in a browser. */
  const taskWay = web
    ? "the **Task** button at the top of this panel, or **⌘T** in the app"
    : "**⌘T**, or the **Task** button at the top of this panel";
  const priorityWay = web
    ? "The numbers at the top of this panel set a priority, or **⌘1** to **⌘5** in the app."
    : "**⌘1** to **⌘5** set a priority, or the numbers at the top of this panel.";
  /** The way to the sidebar's tasks: its tab on the map's left edge, or a key a browser keeps for itself. */
  const tasksWay = web
    ? "The **›** tab on the left edge of the map opens the sidebar"
    : "**⇧⌘T**, or the **›** tab on the left edge of the map, opens the sidebar";

  vault.update(rootId, {
    title: TOUR_TITLE,
    body: web
      ? notes(
          "This is Brock, running in your browser. The map is a tour of what it does.",
          "**Click a node** to read its hint here, or move between nodes with the **arrow keys**. Then change anything you like.",
          "What you change is kept in this browser only. **Start over**, under the demo, brings the tour back.",
        )
      : notes(
          "This map is a tour of Brock, to try things on. **Click a node** to read its hint here, or move between nodes with the **arrow keys**. Change anything you like.",
          "When you're done, **Help › Remove the Tour** takes it away; it waits in the trash for a while. **Help › Show the Tour** brings it back any time.",
        ),
  });

  const branch = (title: string, fields: Partial<NodeFields> = {}) =>
    vault.addChild(rootId, { title, ...newBranch(vault.children(rootId)), ...fields });
  const add = (parent: Node, title: string, fields: Partial<NodeFields> = {}) =>
    vault.addChild(parent.id, { title, ...fields, ...(vault.get(parent.id)!.isMap ? newBranch(vault.children(parent.id)) : {}) });

  // ---- Right: making a map ---------------------------------------------------

  const start = branch("Start here", {
    body: notes("The basics of making a map. Try the nodes below in order: each one's notes say what to do."),
  });
  add(start, "Arrows move", {
    body: notes("Select a node with a click, then move to its neighbours with ← → ↑ ↓.", "**Shift** with an arrow chooses several nodes at once."),
  });
  add(start, "Tab adds a child", {
    body: notes("Select a node and press **Tab**: a new node appears under it, ready for its title.", "**Escape** on a new, empty node takes it away again."),
  });
  add(start, "Enter adds a sibling", {
    body: notes("**Enter** adds a node after the selected one; **Shift+Enter**, before it."),
  });
  add(start, "Type to rename", {
    body: notes("With a node selected, just start typing to replace its title, or press **Space** or **F2** to change it.", "**Enter** finishes."),
  });
  add(start, "Delete, then ⌘Z", {
    body: notes("**Delete** or **Backspace** removes a node and everything under it.", "**⌘Z** brings it back; **⇧⌘Z** redoes. Deleted branches also wait in the trash, in the ⋯ menu."),
  });
  add(start, "Drag to move", {
    body: notes(
      "Drag a node onto another to put it there, or between two to put it beside them. Near the edge, the map moves along.",
      "From the keyboard: **⌥** with the arrows.",
    ),
  });

  const maps = branch("Maps inside maps", {
    body: notes(
      "Any node can be a map of its own, with its own nodes, as many levels deep as you like. A map shows as a stack, like this one.",
      "On the map around it, **double-click** a map to go in, or select it and press **⌘↓**.",
    ),
  });
  vault.setMap(maps.id, true);
  add(maps, "You're inside", {
    body: notes("The breadcrumbs at the top show where you are. Click one to go back up."),
  });
  add(maps, "⌘↑ goes back out", {
    body: notes("**⌘↑**, or the **↑** button on this map's centre, goes back to the map around this one."),
  });
  add(maps, "Make any node a map", {
    body: notes("Select a node and press **⇧⌘M**: everything under it moves into a map of its own. Press it again to undo that."),
  });
  const deeper = add(maps, "Deeper still", {
    body: notes("Maps can hold maps. Double-click to go one level further in."),
  });
  vault.setMap(deeper.id, true);
  add(deeper, "Maps in maps in maps", {
    body: notes("There is no limit to how deep they go."),
  });
  add(deeper, "All maps: the Maps tab", {
    body: notes("The **›** tab on the left edge of the map, or **⌃⌘S**, opens the sidebar. Its **Maps** tab lists every map as a tree, to jump to any of them."),
  });

  const tasks = branch("Tasks", {
    body: notes(
      `Any node can be a task with a checkbox: ${taskWay}.`,
      `${tasksWay}: its **Tasks** tab lists the tasks of this map or of all maps. Done ones are grouped by when they were done, handy for a stand-up, and each group can be cleared on its own.`,
    ),
  });
  add(tasks, "Tick me", {
    task: "open",
    body: notes("**Space**, or a click on the box, ticks a task. Do it again to untick it."),
  });
  add(tasks, "Priorities", {
    task: "open",
    priority: 1,
    body: notes(`${priorityWay} 1 to 3 come before tasks without a priority, 4 and 5 after them.`),
  });
  add(tasks, "Hide what's done", {
    task: "open",
    priority: 4,
    body: notes("The checkbox button at the top, beside the magnifier, hides done tasks on the map, or **⇧⌘H**. Nothing is deleted."),
  });
  add(tasks, "Open the Tasks tab", { task: "done", doneAt: now, body: notes("Done today: it's under **Today** in the sidebar's Tasks tab.") });
  add(tasks, "Grouped by day", { task: "done", doneAt: now - DAY, body: notes("Done yesterday.") });
  add(tasks, "Clear a group", {
    task: "done",
    doneAt: now - 8 * DAY,
    body: notes("Done last week. In the Tasks tab, **Clear** beside a group moves its tasks to the trash, and leaves the others."),
  });

  // ---- Left: finding and keeping --------------------------------------------

  const notesBranch = branch("Notes and links", {
    body: notes("Every node has notes, like these. Click the notes to write; they're Markdown."),
  });
  const markdown = add(notesBranch, "Markdown notes", {
    body: notes(
      "Notes can have **bold**, *italics*, lists and checkboxes:",
      "- [x] Write a note\n- [ ] Tick this box",
      "Web addresses become links: https://github.com/Suva/brock",
    ),
  });
  const linked = add(notesBranch, "Links: ⌘L", {
    body: notes(
      "Select a node, press **⌘L** and pick another. The link is drawn as a dashed line, and the other node lists it under **Linked from**.",
      "This node links to **Tasks**.",
    ),
  });
  vault.link(linked.id, tasks.id);
  add(notesBranch, "Colours and icons", {
    icon: "🎨",
    body: notes("Pick a colour or an icon for the selected node at the top of this panel. A colour carries down the whole branch."),
  });
  vault.update(markdown.id, {
    body: markdown.body + "\n\n" + `Notes can link to nodes too: [Maps inside maps](node:${maps.id}).`,
  });

  const finding = branch("Finding things", {
    body: notes("However many maps you have, any node is a few keys away."),
  });
  add(finding, "⌘K searches", {
    body: notes("**⌘K**, or the magnifier at the top, searches the titles and notes of every map. Pick a result to go straight there.", "**Tab** in the search narrows it to this map, then to maps only."),
  });
  add(finding, "First letters find it", {
    body: notes(
      "Search also finds a node by the first letters of its title's words: **mim** finds *Maps inside maps*.",
      "It learns as you go: the nodes you go to often, and the one you picked for the same letters before, come first.",
    ),
  });
  add(finding, "Back and forward", {
    body: notes("The **‹ ›** buttons at the top, or **⌘[** and **⌘]**, go back and forward through the maps you've visited."),
  });
  add(finding, "Map or outline", {
    body: notes("The switch at the top shows the same map as an indented list, for writing quickly. **⌥⌘1** and **⌥⌘2** switch between them."),
  });
  add(finding, "Zoom and pan", {
    body: notes("Scroll to move around; pinch, or hold **⌘** and scroll, to zoom. **⌘0** shows the whole map. The minimap shows where you are."),
  });

  const keeping = branch("Yours to keep", {
    body: notes("Brock needs no account and works without the internet. In the app, your maps are in a database on your computer."),
  });
  add(keeping, "Saved as you go", {
    body: notes("There's no Save button: every change is kept as you make it, and a copy of everything is made each day."),
  });
  add(keeping, "Export and import", {
    body: notes("The **⋯** menu exports a map to Markdown, OPML or JSON, or as a picture, and imports OPML from other outliners, or JSON exported before."),
  });
  if (web) {
    add(keeping, "Here: this browser", {
      body: notes("In this demo, what you change is kept in this browser only, and nowhere else."),
    });
    add(keeping, "Get Brock", {
      icon: "⬇️",
      body: notes("Brock is free, for Mac, Windows and Linux. The downloads are on this page, under the demo."),
    });
  } else {
    add(keeping, "Every command, in the menus", {
      body: notes("The menu bar lists every command with its key, for finding one without knowing the key."),
    });
    add(keeping, "Updates, when you say", {
      body: notes(
        "Brock looks for a newer version now and then and offers it in a corner of the window. Nothing is installed until you click **Install and restart**.",
        "**Help › Check for Updates…** looks at once. **Settings** (**⌘,**) turns the looking off.",
      ),
    });
    add(keeping, "Done? Remove the tour", {
      icon: "👋",
      body: notes(
        "**Help › Remove the Tour** takes this whole map away, wherever it is. It waits in the trash, so **⌘Z** or the trash brings it back.",
        "**Help › Show the Tour** adds a fresh one any time.",
      ),
    });
  }
}
