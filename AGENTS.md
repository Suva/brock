# Working on Brock

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
npm run site         # build the website into _site/ and serve it at http://127.0.0.1:4321
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
| `src/core/layout.ts` | Where each node of a map goes, from the sizes the window measures: out to both sides, downwards as an org chart, along a timeline, or in a board's columns |
| `src/core/navigate.ts` | Which node an arrow key moves to |
| `src/core/branches.ts` | The side and colour a new branch of a map's centre is given, and the palette |
| `src/core/search.ts` | Searching titles and notes, in memory, and ranking what is found |
| `src/core/usage.ts` | What search learns from use: nodes gone to often, and the one chosen for a query |
| `src/core/overview.ts` | The vault's maps as a tree, with what each holds |
| `src/core/drop.ts` | Where a node dragged on a map, or a row in the outline, would land |
| `src/core/urls.ts` | Web addresses in text, and trimming the sentence off them |
| `src/core/markdown.ts` | Notes' Markdown read into blocks and spans, never HTML |
| `src/core/exchange.ts` | Export to JSON, Markdown and OPML; reading OPML and JSON back in |
| `src/core/tasks.ts` | Tasks across the vault: progress under a node, the lists of the tasks panel and their order, how a due date reads, done tasks by the day they were done, clearing them |
| `src/core/history.ts` | The maps visited, for back and forward |
| `src/core/clipboard.ts` | Copy, cut and paste of branches: copies as outlines, cuts moved whole |
| `src/core/picture.ts` | A picture of a map as plain shapes, and writing it as SVG |
| `src/core/activity.ts` | The history read from the log: steps (what one write put there, typing joined), their wording, and taking a step back for the nodes still as it left them |
| `src/core/attention.ts` | The marks for the person, green, orange and red: the nodes carrying one, their order and counts for the bell, going round them, setting them |
| `src/core/agent.ts` | What an AI agent may read and change of the vault, in the maps shared with it: the requests it can make, checked, and how they are answered as text |
| `src/core/moves.ts` | Moving a node from the keyboard: up and down, in and out, across the centre, from column to column |
| `src/store/store.ts` | What a store does: load everything, save changes |
| `src/store/tauri-store.ts` | The store in the app, through Tauri commands |
| `src/store/memory-store.ts` | The store in tests, and in a browser (`npm run dev`) |
| `src/store/saver.ts` | Writes changes in order, one write at a time, retrying failures |
| `src/ui/agents.svelte.ts` | Whether agents are allowed and which maps are shared with them, to read or to edit, kept in the window's storage; answers the requests the native side passes on |
| `src/ui/main.ts` | Opens the store and the vault, and the window |
| `src/ui/live.svelte.ts` | The vault and saver made reactive for Svelte |
| `src/ui/App.svelte` | The window: breadcrumbs, the view, notes, the undo keys |
| `src/ui/app-menu.ts` | The menu bar in the app: every command and its key |
| `src/ui/MapView.svelte` | The map: measuring nodes, drawing them and their lines, panning, zooming, the minimap, editing from the keyboard |
| `src/ui/camera.ts` | Pan and zoom maths for the map |
| `src/ui/picture.ts` | A picture of the open map, read off the page; drawn on a canvas for PNG and the clipboard |
| `src/ui/files.ts` | Saving and opening files for export and import: native dialogs in the app, downloads in a browser |
| `src/ui/TasksList.svelte` | The sidebar's Tasks tab: the open map's or all maps' tasks, the done ones by when they were done |
| `src/ui/MoreMenu.svelte` | The ⋯ menu: export, import, trash, settings |
| `src/ui/chrome.ts` | Whether the app draws its own title bar: on Windows |
| `src/ui/AppMenu.svelte` | The ☰ menu on Windows: the menu bar's menus, opening to the side on hover |
| `src/ui/menu-items.ts` | The menu bar's commands as the ☰ menu's items |
| `src/ui/WindowButtons.svelte` | Minimise, maximise and close, drawn in the header on Windows |
| `src/ui/TrashDialog.svelte` | The trash: restoring, emptying for good |
| `src/ui/Settings.svelte` | Settings (⌘,): appearance, pictures, updates, the daily copies |
| `src/ui/updates.ts` | The app's own updates: looking for one quietly, installing it and starting again; whether to look, kept in the window's storage |
| `src/ui/UpdateOffer.svelte` | A newer version offered in a corner of the window, installed only on a click |
| `src/ui/usage.ts` | Search's usage, kept in the window's storage |
| `src/ui/session.ts` | Where the window was left (map, node, view, panels), to start there |
| `src/ui/theme.ts` | Light, dark or as the system, kept in the window's storage |
| `src/ui/system-clipboard.ts` | The system's clipboard as text: Tauri's plugin in the app, the browser's elsewhere |
| `src/ui/PriorityBadge.svelte` | A priority, 1 to 5, as a numbered circle |
| `src/ui/open-url.ts` | Opens a web address in the browser, never in the app; a linked file through Rust's rules |
| `src/ui/file-drop.ts` | Files and folders dragged onto the window, with their paths, in the app only |
| `src/ui/keys.ts` | Whether a key is typing, which the views leave alone |
| `src/ui/OutlineView.svelte` | The same map as an indented list |
| `src/ui/NotesPanel.svelte` | The selected node: task, priority, colour, icon, its notes, its links and the nodes linking to it |
| `src/ui/NoteEditor.svelte` | The notes' editor (CodeMirror), drawn as they are written or as their Markdown source |
| `src/ui/live-preview.ts` | What the editor draws in place of the Markdown: marks hidden but where the cursor is, checkboxes, links, tables |
| `src/ui/Sidebar.svelte` | The sidebar on the left, with the Maps, Tasks and History tabs; places to go in the vault |
| `src/ui/HistoryList.svelte` | The sidebar's History tab: the steps by day, who made them, and Revert |
| `src/ui/AttentionBell.svelte` | The bell in the header: the badges (orange or red for what asks, grey for the green ones) and the list of marked nodes that opens from it |
| `src/ui/MapsList.svelte` | The sidebar's Maps tab: every map of the vault as a tree |
| `src/ui/Resizer.svelte` | The handle that drags a side panel's edge to change its width; widths are kept in the session |
| `src/ui/Palette.svelte` | Search (⌘K): the field, the results and going to one |
| `src/demo/tour.ts` | The tour map: the whole vault of the website's demo, and a map the app adds to a new vault |
| `src/ui/tour.ts` | The tour in the app: added on a new vault's first start, shown and removed from the Help menu |
| `site/` | The website's page; `scripts/build-site.mjs` builds it, with the demo, into `_site/` |
| `CHANGELOG.md` | What each release changes, for the people using it; the website's "What's new" and the releases' notes |
| `scripts/changelog.mjs` | Reads `CHANGELOG.md`: dates a release, gives a version's notes, writes the "What's new" page |
| `src-tauri/src/db.rs` | The SQLite database: schema and its migrations, saving, loading, the log with who made each change, typing joined as it is written, and its reading for the History tab, a full-text search not used yet |
| `src-tauri/src/lib.rs` | The app: where the vault is, the commands the window calls, the dialogs of export and import, the opener for web addresses |
| `brand/` | The logo and the icon, kept out of the app's package. `brock-logo.svg` and `brock-logo-plain.svg` are the logo with its wordmark, on a tile with a grey surround and on plain black. `brock-icon.svg` is the app icon: the logo without the wordmark, with two more branches where the word was. Every size is made from it with `npx tauri icon brand/brock-icon.svg -o src-tauri/icons`; delete the `android` and `ios` folders that makes, and copy `64x64.png` to `static/favicon.png` |
| `src-tauri/src/maintenance.rs` | Keeping the vault small in the background: joining old typing in the log, and giving free space back, in small steps on its own connection |
| `src-tauri/src/agent.rs` | The door agents knock on: a loopback listener while agents are allowed, `agent.json` with its port and secret, and one request per connection passed to the window |
| `src-tauri/src/mcp.rs` | `brock --mcp`: the app's own program as the MCP server an agent starts. It relays tool calls to the running app through that door and holds no data, starting the app first if it is closed and agents are allowed; `main.rs` runs it before anything of the app starts. The tools are in `mcp-tools.json` |
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
- **A map is drawn one of four ways.** `layout` on its centre is null for out
  to both sides, `"org"` for downwards, `"timeline"` along a line, or `"board"`
  in columns. The last three have no sides (`Placed.side` is null, `Layout.down` is true) and
  everything turns a quarter: `navigate.ts`, `drop.ts`, `moveNode` and the lines in `MapView.svelte`
  each ask `layout.down`. Leaves under a node stack in a column there
  (`Placed.stacked`), where siblings run up and down as on a mind map, so
  those ask that as well. On a timeline and a board everything under the
  centre's child is such a column (`Layout.columns`). A timeline's line and a
  board's lanes are more of the map's lines, so pictures have them.
  A new style needs no migration: the column is unchecked. The nodes' stored `side` is left alone, so a map
  comes back as it was. Anything new that goes by side has to ask too.
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
  lists of places to go (maps, tasks, history), as tabs; the panel on the right is
  about the selected node (notes, colour, links). A new list goes in the
  sidebar as a tab, not as a panel of its own. The sidebar is worked by
  mouse and keeps the focus where it was, so the map's keys go on working.
- **Links live on the node they start from** (`links`, a list of ids), so
  they are saved, undone and synced with it; there is no table of their own.
  A link to a deleted node is kept and ignored until the node comes back.
- **Notes are never HTML.** They are edited as text, in CodeMirror, and
  `live-preview.ts` draws them with ordinary elements: marks and widgets
  built with `textContent`, tables from `markdown.ts`'s structure; nothing
  uses `{@html}` or `innerHTML`.
  Only http, https, `file:`, `node:` and `brock:` links become links; anything else
  stays text. A `brock:` link names one of `COMMANDS` in `markdown.ts` and
  only opens a panel or dialog (`run` in `App.svelte`); keep it to things
  that change nothing, as a link in a pasted note is clicked without thought.
- **The notes' editor never rewrites notes.** The live preview only hides
  marks and draws over them; what is saved is what was typed, so a note
  edited in one place stays as it was everywhere else. What it draws as a
  link follows `markdown.ts` (`linkTarget`, `bareLinks`), so the editor and
  everything else reading notes agree. It has no undo of its own: ⌘Z is
  the vault's, and a change from outside is taken into the editor.
- **Links in notes count as links.** `[text](node:id)` in a node's notes
  makes it appear under "Linked from" on that node (`linksTo` in
  `vault.ts`); `[[Title]]` does not, as what it means can change.
- **Updates are offered, never forced.** The app looks for a newer version
  by itself (`watchForUpdates` in `updates.ts`, unless turned off in
  Settings), but downloads and installs one only when Install and restart
  is clicked, after everything is saved: on Windows the installer closes
  the app without asking it. The README says where the app looks, as it
  promises that nothing else reaches the network.
- **Only web addresses may be opened, and only on a click.** The capability
  in `src-tauri/capabilities/default.json` lets the opener open http and
  https addresses and nothing else. The README promises that nothing leaves
  the computer otherwise; anything new that reaches the network has to be
  said there. Files linked from notes are opened by Rust (`open_file` in
  `lib.rs`), never by the window: only folders and the documents in
  `DOCUMENTS` open, and anything else is shown in Finder or Explorer, as it
  might be a program. Keep that list to things that do not run.
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
  header's height and the buttons' position has to follow. On Windows the
  window has no title bar either (`decorations: false` in
  `tauri.windows.conf.json`): the header draws minimise, maximise and close
  at its right (`WindowButtons.svelte`), and there is no native menu bar, so
  its menus are under ☰ at the header's left (`AppMenu.svelte`, opened by
  Alt or F10 too). `customTitleBar` in `chrome.ts` says which. Linux keeps
  its own title bar and menu bar.
- **Number keys are matched by `e.code`, not `e.key`.** ⌘1 to ⌘5 and ⌥⌘1 to ⌥⌘5
  look at the key's place (`Digit1`): where digits need Shift, as in French
  layouts, and with ⌥ on a Mac, `e.key` is another character.
- **Shortcuts are letters, arrows and common punctuation.** Keys like `\`
  sit behind awkward combinations on many keyboard layouts outside the US.
  Where a key would clash with text editing or the system on one platform,
  use another there (the outline's moves, the sidebar's ⌃⌘S on a Mac and
  Ctrl+Shift+S elsewhere).
- **The identifier is `app.getbrock.brock`.** It names the data folder, so
  it must not change again. The vault of the app's old identifier is copied
  over once, on the first start (`carry_over` in `db.rs`). JSON exports say
  `"brock"`; `"mindmap"`, from before, is still read.
- **Copy and paste are keys, not clipboard events.** WebKit, the engine on a
  Mac, gives a page no copy or paste events without a text selection, which
  the map never has, and asks before a page reads the clipboard. So the map
  handles ⌘C, ⌘X and ⌘V itself and uses Tauri's clipboard plugin (text
  only; read on ⌘V only). Text fields keep the system's own copy and paste.
- **The window starts hidden.** It is created with `visible: false` and
  `main.ts` shows it once the page is made (`showWindow`), so it does not
  flash white in dark mode; the native side shows it after three seconds
  anyway (`SHOW_ANYWAY` in `lib.rs`), so a page that fails to load still
  shows its error. Anything that delays the first render delays the window.
- **Keys pressed in a dialog stay there.** `typingIn` in `keys.ts` treats
  anything inside `role="dialog"` like a text field, so the views leave it
  alone. Give every new dialog that role.
- **A new command goes in the menu bar too** (`app-menu.ts`), with its key,
  and in Windows' ☰ menu (`menu-items.ts`), which lists the same commands.
  Keys reach the page before the menu, so a menu item takes a key only
  where the page never needs it for text (not Tab, Enter, Space or the
  arrows); those items name their key in their text, and run by sending
  that key to what has the focus. Edit › Cut, Copy and Paste are the
  system's, for text fields; the map listens for their `copy`, `cut` and
  `paste` events, but WebKit may send none (see the rule on copy and
  paste above), so on the map they may do nothing; the keys always work.
- **Pictures are read off the map as drawn.** `capture` in `ui/picture.ts`
  walks the map's nodes and lines in the page and turns each box, line of
  text and curve into a shape (`core/picture.ts`), so a picture matches the
  screen without a second way of drawing it. A new part of a node is drawn
  without anything more; a part that is a control, not content, is left out
  in `skipped`. The PNG is drawn from the shapes on a canvas, not by drawing
  the SVG into one, which WebKit may then refuse to read back. SVG never
  holds HTML (no `foreignObject`), so other programs open it.
- **Agents see shared maps only, and change only maps shared to edit, through
  the window.** `core/agent.ts` answers from the vault in memory for the ids in
  the shared set; a map that is not shared is a closed portal in the one around
  it, and anything not shared, deleted or missing gets the same "not found".
  Check it with `isShared` and `holder` for reading and `editable` for every
  change, never by hand, for every new tool. A change is the vault's own edit
  (one step, so ⌘Z undoes it, and saved like any), reports what it changed in
  `changed` so the window can say so, and goes through `importInto`,
  `newBranch` and the like, not around them. Agents never delete, lower or clear a mark, and never
  make, move or restyle maps or rearrange the branches of a centre; keep it
  so, and say any widening in the README. Text an agent adds is stripped of
  maps, ids, links, colours and ways of drawing (`plain`). The sharing is kept
  per computer in the window's storage (`agents.svelte.ts`), not on the nodes,
  so it does not travel in a backup, export or sync. The door (`agent.rs`) is
  closed unless Settings › Agents is on, listens on loopback only, and wants
  the secret from `agent.json` (owner-only); it never learns what a request
  means. `mcp.rs` takes the tool's name from the call, never from its
  arguments, and writes nothing but protocol to standard output. It starts the
  app only when `agents-allowed`, a file beside the vault that `agent_enable`
  keeps (the switch itself is in the window's storage, which it cannot read),
  is there, and never a second copy: release builds have the single-instance
  plugin, and on a Mac it starts the app through `open -g`. A new tool is added
  in `core/agent.ts` (request, parse, answer) and `mcp-tools.json`.
- **Edits made for someone else are not steps for ⌘Z.** An agent's edits run
  inside `vault.as("agent", …)`: they are saved, shown and told to the listeners
  with that origin, which the saver passes to the store so the log says who made
  them (`source` in `ops`), but they do not go on the undo stack, so ⌘Z never
  takes back what the person did not do. The History tab (`core/activity.ts`) is
  how they, and the person's own steps, are taken back: `vault.revert`, which
  is a step like any other, only for nodes still as the step left them. Undo and redo put back only the fields their step changed
  (`#restore` in `vault.ts`), so what an agent changed in the same node since,
  such as a tick, stays. A new
  kind of helper that edits for the person uses `as` with its own name.
- **The mark is the person's to lower or clear.** A node's `flag` is "ok"
  (green), "attention" (orange) or "critical" (red); an agent may only raise
  it (`flag_node`, by `rank` in `attention.ts`) and no tool lowers or clears
  it, as the bell is how the person finds what an agent needs. The bell counts
  orange and red as asking and green apart, in grey. Marks made when it was a
  yes or no (`attention`) read as "attention" (`withDefaults`, migration 8).
  It is a field like any other: migration, both `Node`s, `withDefaults`.
- **Tidying the vault happens in the background and is never noticed.**
  `maintenance.rs` starts a while after the app, works on its own connection
  in small transactions with a pause between, and never holds the window's;
  anything new that is long must do the same, not run at startup or under the
  window's lock. It joins runs of typing in the log (`compact_log`; new typing
  is joined as it is written, `extend_typing` in `db.rs`) and gives free pages
  back. The one `VACUUM` it does turns on incremental vacuuming. SQLite's
  documentation says a `VACUUM` may renumber the rows of `nodes`, which the
  search index follows by number; a test here did not see it happen, but the
  index is rebuilt after it and checked every round (`heal_search_index`), so
  do the same after any other `VACUUM`. Entries of a step
  of several nodes, and changes of more than words, are never joined: the
  History tab and Revert read steps from the log.
- **A node with no title and nothing else is deleted when it is left.**
  `vault.sweepEmpty` (with `isUntitled`) deletes nodes with a blank title, no
  notes, no icon, no live children and not a map, but not the ones being worked
  on; `App.svelte` calls it for the nodes that stop being selected or edited
  and once on opening, so no view has to remember to clean up after itself.
  It runs as `as("tidy")`: no step for undo, and the nodes' steps are taken out
  of the undo and redo stacks, and `isNoise` keeps the empty nodes and their
  tidying out of the History tab; `trash()` leaves them out too. Anything that
  makes nodes from outside (agents, imports) should refuse a blank title rather
  than rely on the sweep. `cancelCreation` stays for Escape, which also goes
  back to where the node was made. Nothing is made under a node with no title
  (`canAddChild`, in both views and the agent's `add_nodes`), except under a
  map, so a second Tab pressed by accident makes nothing.
- **Saved changes are written in order.** The saver never writes an edit
  before an earlier one that failed; keep it that way.

## Testing

`test/*.test.ts` covers the core, the layout, the camera and the saver with Node's test runner;
`src-tauri/src/db.rs` has the database's tests. Neither drives the window.
GitHub runs the type check and both sets of tests on every push to `main`
and every pull request (`.github/workflows/test.yml`).
A change to the window should be tried in it, with `npm run dev` or `npm start`,
and said so. When driving the browser preview with a tool: text it types
arrives without key presses, so typing on a selected node to start editing
must be tried with key presses; and the preview keeps some ⌘ shortcuts for
itself, so send those to the page with `dispatchEvent`.

## The website

`site/` holds the website: a page with the downloads and a demo of the
app, and "What's new" (`changes.html`), made from the released part of
`CHANGELOG.md` by `scripts/changelog.mjs`. `scripts/build-site.mjs` builds
it into `_site/`: the page, with this
download links filled in (from `package.json` locally; in CI from the newest
published release, `SITE_VERSION`, since `package.json` is bumped before the
installers are built), and the demo, which
is the window built for a browser with `--mode demo`. It is published at
brock.clysuva.com by `.github/workflows/site.yml` on GitHub Pages, on every
push to `main` that changes the site, the demo or `CHANGELOG.md`, and when the release
workflow has put the installers on a release (it starts the site's build
itself, as a release made with its own token starts nothing); the
build writes the `CNAME` for that domain. Try it locally with `npm run site`.

- **What's new waits for the downloads.** It lists the releases up to the
  one the page links to (`SITE_VERSION`), so a version tagged but still
  being built appears with its installers. The app's update offer links to
  it, at the offered version (`whatsNew` in `updates.ts`).
- **The demo is the real window.** In demo mode `main.ts` keeps the map in
  the browser's storage under its own key (`src/demo/keys.ts`) and, when
  there is none yet, starts from the tour (`src/demo/tour.ts`) with the notes
  open, where its hints are, and the whole map in view. The page's Start over
  removes those keys.
- **The tour is made with the vault's own edits**, so it is a vault the app
  opens as it is; `test/tour.test.ts` checks that, and its links. When the app
  gains something worth showing, add a node for it there, with a short title
  and its hint in the notes.
- **The app has the tour too.** A new vault's first start adds it as a map
  under the top and opens it (`welcome` in `src/ui/tour.ts`), as the app's
  own doing, which ⌘Z does not undo (`forgetUndo`). Whether it was offered,
  and which map it is, are kept in the window's storage, so a vault emptied
  later never gets it again. Help › Show the Tour and Remove the Tour are in
  the menu bar and the ⋯ menu. Its wording differs where a browser and the
  app differ (`place` in `tour.ts`).
- **A map opened by itself is fitted as it settles.** `fitWhenOpened` in
  `MapView.svelte` keeps the next map drawn whole while its nodes' sizes
  come in, and stops at the first key, click or scroll; one fit at the start
  would be off by the sizes still to come.
- **A browser keeps some keys for itself:** ⌘T, ⌘N, ⌘W and ⌘1 to ⌘5 never
  reach the page. The tour gives those as keys of the app and shows the way
  that works in a browser.
- **The demo sits under a cover** until it is clicked, so that scrolling the
  page over it does not move the map instead.
- **Phones get a picture**, `site/demo.png` and `demo-dark.png`, in place of
  the demo. `node scripts/build-site.mjs --pictures` takes them again with
  Chrome; do it when the window or the tour changes, and look at them.

## Releasing a version

The version lives in `package.json`; `tauri.conf.json` reads it from there,
and `npm version` also writes it into `Cargo.toml` and `Cargo.lock`
(`scripts/sync-version.mjs`), turns "Not released yet" in `CHANGELOG.md`
into the new version, dated (`scripts/changelog.mjs release`), commits and
makes the tag. Pushing the tag makes GitHub build the installers and
publish them as a release (`.github/workflows/release.yml`), with that
version's section of `CHANGELOG.md` as its notes, which `latest.json`
carries too.

```bash
npm version minor -m "Release %s"   # or: patch, major, or an exact number
git push --follow-tags
```

- The working folder has to be clean first, and `CHANGELOG.md` has to have
  something under "Not released yet": `npm version` stops without it,
  before the version is raised. Read
  it over first; it is what people see on the website and on GitHub.
- Use `minor` for new features and `patch` for fixes only.
- The release workflow can be run by hand from the Actions tab, which builds
  the installers without publishing anything, kept with the run.
- **Updates are signed.** Installed copies read `latest.json` from the newest
  release (`plugins.updater` in `tauri.conf.json`), which the workflow makes
  with `scripts/latest-json.mjs`, and install a file only if its signature
  matches the public key there. The release builds sign with the private
  key in the `TAURI_SIGNING_PRIVATE_KEY` secret. The key made so far has no
  password, so there is no `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secret
  (GitHub refuses an empty one); a missing secret reaches the build as an
  empty password, which is what such a key needs. Its
  copy is kept off the repository, in `~/.tauri/brock.key` on the
  maintainer's Mac and a backup. Without it no release can update existing
  copies again, and a new key means everyone installs one version by hand.
  Never commit it, and never change the public key unless the old one is lost.
- The files the updater installs (`.app.tar.gz`, the Windows setup, the
  AppImage and the `.deb`) and their signatures are made only by the release workflow,
  through `src-tauri/tauri.updates.conf.json`, so that `npm run package`
  needs no key. To make them locally, pass that file with `--config` and set
  `TAURI_SIGNING_PRIVATE_KEY` to the key's path.
- `latest.json` is uploaded last, once the installers are on the release,
  so a copy that finds a new version can always download it. A release
  whose `latest.json` failed to upload is skipped by updates until the next.
- Nothing is signed. The Mac app is signed ad hoc (`signingIdentity: "-"`),
  without which a downloaded copy on Apple silicon is called damaged and
  will not open at all; macOS still asks before opening it.
- The repository and its releases are public: anyone can download the
  installers. A release takes about fifteen minutes, most of it the Mac's
  build.

## Working agreements

- Commit and push only when asked.
- Comments say why the code is the way it is. User-facing text avoids jargon.
- When a change makes something in the README, PLAN.md or this file untrue,
  fix the text in the same change.
- When a task in TASKS.md is done, remove it from there.
- When a change is something a person using the app would notice, add a line
  for it under "Not released yet" in `CHANGELOG.md`, written for them rather
  than for developers: what it does and how to use it, a bold lead for a
  larger change. The website's "What's new" page, each release's notes and
  the update offer's link all come from that file.
