# Mind map app: plan

A desktop mind-mapping app that starts with a single node. Any node can become
a map of its own, and you can move into it and back out to its parent. Everything
is saved as you go to a local database. It should be fast to navigate and search,
clean to look at, and give a good overview of everything in it.

The name is still to be chosen (see "Open questions").

## Decisions so far

| Question | Decision |
|---|---|
| Platform | Desktop first, with **Tauri 2**. A web or cloud version, and maybe phones, later |
| Layout | Mostly automatic, taking hints: drag a node to the other side of its map's centre, or to a new place among its siblings, and the layout follows |
| Node content | A title and longer text. Links (web addresses and links to other nodes) early. Markdown and images later |
| Vaults | One for now. More vaults later |
| Saving | No Save command: every change is written to the database at once |
| Back to the parent map | ⌘↑, with ⌘↓ to open a map (not Escape, which is needed for other things) |
| UI framework | Svelte 5 with Vite (not SvelteKit: one window needs no routing) |

## The model

Everything is **one tree of nodes**. A map is a node marked as a map root.

- Every node has exactly one parent, except the single top root, which is itself
  a map.
- **Make into map** turns a node into a map root. In its parent's map it is drawn
  as one *portal* node with a sign that there is more inside. Opening it shows
  that node in the centre of its own canvas.
- **Back to parent** opens the nearest ancestor that is a map root, with the node
  you came from selected.
- A breadcrumb bar shows where you are (`Home › Work › Project X`); any part of
  it can be clicked.
- Turning a map back into an ordinary node just clears the mark: its nodes appear
  in the parent's map again. Moving a branch between maps is just changing a
  parent.

Links between nodes are kept apart from the tree, so a node can point anywhere
without having two parents.

### Tables (SQLite)

```
nodes
  id           ULID: sortable, unique on every device, ready for syncing later
  parent_id
  sort_key     order among siblings, as a fractional index: a reorder rewrites one row
  side         left | right | null: the hint for a map root's direct children
  title
  body         the longer text
  is_map       boolean
  collapsed
  color, icon
  created_at, updated_at
  deleted_at   soft delete: for undo, a trash and later syncing

links
  id, from_id, to_id, label, created_at, deleted_at

ops            every change, in order: undo and redo now, syncing later
nodes_fts      FTS5 index over title and body
meta           schema version, settings
```

## Storage

- One SQLite file in the app's data folder, in WAL mode. Each change is a small
  transaction written as it happens.
- Rust (`rusqlite`) owns the database. The window calls a handful of Tauri
  commands (apply these operations, load this map, search) and gets back plain
  data.
- A copy of the database is made automatically once a day, keeping the last few.
- Export to JSON, Markdown and OPML, and import from OPML, so nothing is locked in.
- The window only knows a `Store` interface. A web version can put SQLite
  compiled to WASM, or a server, behind it without changing the UI.

## The code

| Layer | Language | What |
|---|---|---|
| `core/` | TypeScript, pure | The model, operations, undo, layout, search ranking. Unit tested; reused by a web version |
| `store/` | TypeScript interface, Rust behind it | Loading and saving through Tauri commands |
| `ui/` | TypeScript + framework | Canvas, outline, search palette, breadcrumbs, editor |
| `src-tauri/` | Rust | Database, backups, export, files, menus |

Most of the logic stays in TypeScript so the Rust stays small and the core can
run in a browser.

**UI framework: Svelte 5 + Vite.** It updates only what changed rather than
re-rendering whole components, which matters when one map holds hundreds of
nodes and you drag or type.

The framework doesn't make the engines behave the same. Tauri uses each system's
own webview: WebKit on macOS, WebView2 (Chromium) on Windows, WebKitGTK on Linux.
Keeping to plain DOM, SVG and CSS transforms and avoiding new web features goes
a long way, but Linux's WebKitGTK is the slowest at panning and zooming many
elements. Try it there early, not at the end.

## The canvas

- **Automatic layout**: a tidy tree spreading left and right of the centre.
  Each direct child of the centre goes on its `side`, or wherever balances the
  map best if it has none. Deeper nodes follow their branch. The order among
  siblings comes from `sort_key`.
- **Hints by dragging**: dropping a node across the centre sets its side; dropping
  it between siblings sets its order; dropping it on another node makes it that
  node's child. The layout animates to its new shape. Nodes are never placed by
  hand to the pixel, which keeps maps tidy.
- **Rendering**: nodes as DOM elements placed with CSS transforms, lines in one
  SVG layer underneath, nothing drawn that is off screen. Submaps keep each canvas
  to hundreds of nodes, so this stays fast and text is edited in ordinary
  text fields. If a map ever gets far bigger, drawing can move to a canvas
  without touching `core/`.
- **Transitions**: opening a map zooms into its portal node; going back zooms out
  of it, so it is always clear which way you went.
- **Links between nodes**: a dashed curve when both ends are in the same map;
  otherwise a small link sign on the node that opens the other end.
- **Text**: the title shows on the node; the body opens in a side panel. Web
  addresses in it can be clicked.

## Getting an overview

1. **Minimap** in a corner of the canvas.
2. **Outline view**: the same tree as an indented list, for reading through and
   restructuring quickly. A toggle, not a separate thing to keep in step.
3. **Map of maps**: only the map roots, as a tree in a sidebar (⌘\), with how
   much each holds: what is in the vault at a glance.
4. **Zooming out hides detail**: deeper levels shrink to dots, and only the upper
   levels keep their labels.

## Search

- A palette (⌘K) that matches titles and bodies as you type. Each result shows
  its path; choosing one opens its map and selects it.
- Filters: only this map, only maps.
- Search runs over the vault in memory, which is all loaded anyway: about
  15–35 ms over 100,000 nodes. The SQLite full-text index is kept up to date
  for when a vault is too big for that, or for a web version that does not
  load everything.

## Keyboard

| Key | Action |
|---|---|
| Tab | New child |
| Enter | New sibling |
| Arrow keys | Move between nodes |
| Typing, or F2 | Edit the title |
| ⌘↵, or a double click on a portal | Open that map |
| ⌘↑ | Back to the parent map, as Finder goes to the enclosing folder; ⌘↓ opens a map |
| ⌘K | Search everything |
| ⌘⇧M | Make into map, or back into an ordinary node |
| ⌘Z, ⌘⇧Z | Undo, redo |
| Delete | Delete the node and what is under it (undoable, and kept in the trash) |

Ctrl in place of ⌘ on Windows and Linux.

## Milestones

1. **Core and storage** (done): the model, operations and undo in TypeScript, with tests;
   the SQLite schema and Tauri commands; a Tauri + Svelte project that starts.
2. **One map** (done): adding, editing, deleting and moving nodes from the keyboard;
   automatic layout; saved as you go; the body panel.
3. **Maps inside maps** (done): make into map, opening and going back, breadcrumbs,
   transitions.
4. **Search** (done): the palette, FTS.
5. **Overview** (done): minimap, outline view, map of maps, zooming out.
6. **Hints and links**: dragging to set side, order and parent; links between
   nodes; clickable web addresses.
7. **Safety and finish**: trash, daily copies, export and import, colours and
   icons, settings.
8. **Releases**: installers for macOS, Windows and Linux built by GitHub, and
   updates.

Later: Markdown in bodies, images, more vaults, syncing and a web version, phones.

## Open questions

- **The name.** There are many mind-mapping apps, so it needs a check against
  existing apps, domains and trademarks. Ideas to start from, none checked yet,
  most of them about digging into nested maps: Warren, Burrow, Delve, Thicket,
  Canopy, Sprig, Nook, Loam.
- Whether the top of the vault is a map like any other, or a special home view.
