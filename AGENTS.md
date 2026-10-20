# Working on Mind Map

Notes for anyone, human or AI agent, changing this code. The
[README](README.md) says what the app does and how to run it, [PLAN.md](PLAN.md)
where it is going, and [TASKS.md](TASKS.md) what is next.

## Commands

```bash
npm install          # once
npm start            # build and open the app (tauri dev)
npm run dev          # the window alone, in a browser, vault in local storage
npm test             # TypeScript tests, then Rust tests
npm run test:core    # TypeScript tests only, in a second
npm run check        # svelte-check: types of the TypeScript and Svelte
npm run package      # an installer for this system, in src-tauri/target/release/bundle
```

Node 24 or newer and Rust are needed.

**On this Mac**, the command line tools carry a beta macOS 27 SDK that their
linker cannot read, and Rust builds fail with `tapi error: malformed file ...
MacOSX27.0.sdk`. Until the tools are updated or that SDK removed, build with
the 26.5 SDK:

```bash
export SDKROOT=/Library/Developer/CommandLineTools/SDKs/MacOSX26.5.sdk
```

## How it fits together

The vault is **one tree of nodes**. A map is a node with `isMap` set; it holds
every node under it down to the next map, which it shows as a portal. The
top node of the vault is always a map.

The window keeps the **whole vault in memory** and does all the work there:
editing, undo, deciding what a map shows. The Rust side only stores. Every
edit ends in a list of changes, `{ before, after }` per node, which is all
that is ever saved, undone or, later, synced.

```
edit in the window → Vault (src/core) → changes → Saver → Store → apply_changes (Rust) → SQLite
```

| Path | What lives there |
|---|---|
| `src/core/node.ts` | A node, and a change, as they are stored |
| `src/core/vault.ts` | The vault in memory: reading the tree, edits, undo, repairing a broken tree on opening |
| `src/core/sort-key.ts` | Fractional keys that keep the order of siblings |
| `src/core/ids.ts` | Node ids (ULIDs) |
| `src/core/layout.ts` | Where each node of a map goes, from the sizes the window measures |
| `src/core/navigate.ts` | Which node an arrow key moves to |
| `src/core/branches.ts` | The side and colour a new branch of a map's centre is given, and the palette |
| `src/core/search.ts` | Searching titles and notes, in memory |
| `src/core/overview.ts` | The vault's maps as a tree, with what each holds |
| `src/core/drop.ts` | Where a node dragged on a map would land |
| `src/core/urls.ts` | Web addresses in text, and trimming the sentence off them |
| `src/core/markdown.ts` | Notes' Markdown read into blocks and spans, never HTML |
| `src/core/exchange.ts` | Export to JSON, Markdown and OPML; reading OPML and JSON back in |
| `src/core/tasks.ts` | Tasks across the vault: progress under a node, the lists of the tasks panel |
| `src/core/history.ts` | The maps visited, for back and forward |
| `src/core/moves.ts` | Moving a node from the keyboard: up and down, in and out, across the centre |
| `src/store/store.ts` | What a store does: load everything, save changes |
| `src/store/tauri-store.ts` | The store in the app, through Tauri commands |
| `src/store/memory-store.ts` | The store in tests, and in a browser (`npm run dev`) |
| `src/store/saver.ts` | Writes changes in order, one write at a time, retrying failures |
| `src/ui/main.ts` | Opens the store and the vault, and the window |
| `src/ui/live.svelte.ts` | The vault and saver made reactive for Svelte |
| `src/ui/App.svelte` | The window: breadcrumbs, the view, notes, the undo keys |
| `src/ui/MapView.svelte` | The map: measuring nodes, drawing them and their lines, panning, zooming, the minimap, editing from the keyboard |
| `src/ui/camera.ts` | Pan and zoom maths for the map |
| `src/ui/files.ts` | Saving and opening files for export and import: native dialogs in the app, downloads in a browser |
| `src/ui/TasksList.svelte` | The sidebar's Tasks tab: the open map's or all maps' tasks |
| `src/ui/MoreMenu.svelte` | The ⋯ menu: export, import, trash, settings |
| `src/ui/TrashDialog.svelte` | The trash: restoring, emptying for good |
| `src/ui/Settings.svelte` | Settings (⌘,): appearance, the daily copies |
| `src/ui/theme.ts` | Light, dark or as the system, kept in the window's storage |
| `src/ui/open-url.ts` | Opens a web address in the browser, never in the app |
| `src/ui/keys.ts` | Whether a key is typing, which the views leave alone |
| `src/ui/OutlineView.svelte` | The same map as an indented list |
| `src/ui/NotesPanel.svelte` | The selected node's notes, read or written, its links and the nodes linking to it |
| `src/ui/Markdown.svelte` | Draws notes from `markdown.ts`'s blocks; links are buttons |
| `src/ui/Sidebar.svelte` | The sidebar on the left, with the Maps and Tasks tabs; places to go in the vault |
| `src/ui/MapsList.svelte` | The sidebar's Maps tab: every map of the vault as a tree |
| `src/ui/Palette.svelte` | Search (⌘K): the field, the results and going to one |
| `src-tauri/src/db.rs` | The SQLite database: schema and its migrations, saving, loading, a full-text search not used yet |
| `src-tauri/src/lib.rs` | The app: where the vault is, the commands the window calls, the dialogs of export and import, the opener for web addresses |
| `src-tauri/src/backups.rs` | Daily copies of the vault, the last seven kept |

## Rules that are easy to break

- **`src/core/` stays pure.** No DOM, no Tauri, no Svelte, no Node modules: it
  is meant to run anywhere, a web version included, and its tests run under
  plain Node.
- **Erasable TypeScript only.** Tests run `.ts` files directly under Node,
  which strips types and nothing else: no enums, no parameter properties, no
  namespaces. Imports name the `.ts` extension.
- **Nodes change only through the vault's edits.** Each edit records its
  changes, which are what gets saved. A node changed any other way is never
  saved.
- **Nothing is ever really deleted.** Deleting sets `deletedAt` on the node
  only; the nodes under it go with it and come back with it. Undoing the
  making of a node marks it deleted too. Syncing will need every node to stay.
- **Svelte compares by identity.** The vault changes its own lists in place;
  copy one before handing it to the window (`childrenOf` in `App.svelte`), or
  the window will not update. Anything the window reads from the vault should
  read `live.version` so that it is read again after a change.
- **A new column needs a migration.** Add a step to `MIGRATIONS` in `db.rs`;
  never change a step that has been released. Add the field to `Node` in both
  `node.ts` and `db.rs`, and to their `SELECT` and upsert.
- **The layout does not measure.** `layoutMap` is given each node's size;
  the map measures its nodes with a ResizeObserver and lays them out again
  when a size changes. A node's look must come from CSS that its size
  follows, never from sizes set by script.
- **Clicks are not drags.** Pointer handlers ignore movement under
  `DRAG_START_PX`, and capture the pointer only once a drag starts, so that
  buttons inside the map still get their clicks.
- **The views listen to the whole window.** The map takes every key pressed
  outside a text field (`typingIn` in `keys.ts`), wherever the focus is, so
  that Tab never moves the focus between buttons; the outline brings the
  focus back to its selected row. A new text field is left alone by both
  without anything more. Buttons in the header also leave the focus where it
  was.
- **The centre's children keep their sides when moved.** Their sides are
  balanced by order when not set, so a move that changes the order fixes all
  their sides first (`pinSides` in `moves.ts`). A new branch is given its
  side and its colour when it is made, for the same reason: make branches
  with `newBranch` or `branchBeside` from `branches.ts`, in every view.
- **Going into a map animates a copy.** When the open map changes, the map
  view copies its layer as it is (`$effect.pre`, before the page changes),
  zooms the copy into the portal or away and removes it, and grows the new
  map in once its camera is set. Anything drawn on the layer is copied with
  it; nothing on it may rely on scripts or ids staying unique while the copy
  lives (about a third of a second).
- **Zoomed out, only the drawing changes.** Bars in place of text and the
  larger branch names come from CSS and transforms; text keeps its place, so
  measured sizes, and with them the layout, stay the same at every zoom.
- **Left for the vault, right for the node.** The sidebar on the left holds
  lists of places to go (maps, tasks), as tabs; the panel on the right is
  about the selected node (notes, colour, links). A new list goes in the
  sidebar as a tab, not as a panel of its own. The sidebar is worked by
  mouse and keeps the focus where it was, so the map's keys go on working.
- **Links live on the node they start from** (`links`, a list of ids), so
  they are saved, undone and synced with it; there is no table of their own.
  A link to a deleted node is kept and ignored until the node comes back.
- **Notes are never HTML.** `markdown.ts` reads them into a structure and
  `Markdown.svelte` draws it with ordinary elements; nothing uses `{@html}`.
  Only http, https and `node:` links become links; anything else stays text.
- **Links in notes count as links.** `[text](node:id)` in a node's notes
  makes it appear under "Linked from" on that node (`linksTo` in
  `vault.ts`); `[[Title]]` does not, as what it means can change.
- **Only web addresses may be opened, and only on a click.** The capability
  in `src-tauri/capabilities/default.json` lets the opener open http and
  https addresses and nothing else. The README promises that nothing leaves
  the computer otherwise; anything new that reaches the network has to be
  said there.
- **The window never names a file.** Export and import open the system's
  dialogs from Rust (`save_text`, `open_text` in `lib.rs`), which writes or
  reads the file chosen; the window hands over text and gets text back. Keep
  new file access that way rather than giving the window a file system.
- **Fields added to nodes get defaults where nodes are read.** Nodes saved
  before a field existed come back without it: `withDefaults` in `vault.ts`
  fills it in for the window, `#[serde(default)]` and the column's default
  for the database. A new field needs all three, and a migration.
- **Emptying the trash is the only real deletion.** It removes nodes from
  the database and their entries from the log, and clears the undo history,
  which could otherwise bring them back. It goes through the saver
  (`purge`), in order with the changes before it.
- **One node selected, others chosen with it.** The map keeps `selected`,
  the node the keyboard, the notes and editing work on, and `others`, chosen
  with it. Commands that make sense for several act on `topmost` of them
  (from `moves.ts`), so a branch is moved or deleted with its top, and as
  one step; the rest act on `selected`. The outline has one selected row.
- **Every change of map goes through `moveTo`** in `App.svelte`, which
  remembers where it was for back and forward. Setting the open map any
  other way leaves a gap in the history.
- **On a Mac the header is the title bar.** The window has none of its own
  (`titleBarStyle: Overlay` in `tauri.conf.json`); its buttons sit over the
  header's left end, placed by `trafficLightPosition` to line up with the
  header's middle, and the header leaves room for them (`.mac-titlebar` in
  `App.svelte`) except in full screen. The header moves the window
  (`data-tauri-drag-region="deep"`); its buttons stay buttons. Change the
  header's height and the buttons' position has to follow. Windows and
  Linux keep their own title bars.
- **Keys pressed in a dialog stay there.** `typingIn` in `keys.ts` treats
  anything inside `role="dialog"` like a text field, so the views leave it
  alone. Give every new dialog that role.
- **Saved changes are written in order.** The saver never writes an edit
  before an earlier one that failed; keep it that way.

## Testing

`test/*.test.ts` covers the core, the layout, the camera and the saver with Node's test runner;
`src-tauri/src/db.rs` has the database's tests. Neither drives the window.
A change to the window should be tried in it, with `npm run dev` or `npm start`,
and said so. When driving the browser preview with a tool: text it types
arrives without key presses, so typing on a selected node to start editing
must be tried with key presses; and the preview keeps some ⌘ shortcuts for
itself, so send those to the page with `dispatchEvent`.

## Working agreements

- Commit and push only when asked.
- Comments say why the code is the way it is. User-facing text avoids jargon.
- When a change makes something in the README, PLAN.md or this file untrue,
  fix the text in the same change.
- When a task in TASKS.md is done, remove it from there.
