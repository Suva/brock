# Brock: plan

A desktop mind-mapping app that starts with a single node. Any node can become
a map of its own, and you can move into it and back out to its parent. Everything
is saved as you go to a local database. It should be fast to navigate and search,
clean to look at, and give a good overview of everything in it.

The app is called Brock: a brock is a badger, which digs burrows of tunnels and
chambers. Its web address is brock.clysuva.com.

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
without having two parents. They are a list of ids on the node they start
from, saved, undone and synced with it.

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
  links        the ids of the nodes it links to, as a JSON list
  layout       how a map is drawn: org, timeline, board, or null for out to both sides
  task, done_at, priority
  due          the day it is due, as text: 2026-10-30
  created_at, updated_at
  deleted_at   soft delete: for undo, a trash and later syncing

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
- **Org charts**: a map can be drawn downwards from its centre instead, each
  level a row and the last level stacked under its parent, chosen per map and
  saved with it. Keys and dragging turn with it.
- **Timelines**: or along a straight line from its centre, its children in order
  by turns above and below it, in the same way.
- **Boards**: or in columns under its centre, its children the headings and all
  under them cards, for a weekly plan or a kanban. The columns are ordinary nodes.
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
3. **Map of maps**: only the map roots, as a tree in the sidebar (⌃⌘S), with how
   much each holds: what is in the vault at a glance.
4. **Zooming out hides detail**: deeper levels shrink to dots, and only the upper
   levels keep their labels.

## Search

- A palette (⌘K) that matches titles and bodies as you type. Each result shows
  its path; choosing one opens its map and selects it.
- Filters: only this map, only maps.
- Ranking: the words first, then the node's place (maps and branches before
  leaves, near the top or the open map before deep elsewhere), then use: the
  nodes gone to often lately, and the one chosen before for the same query.
  Use is kept on the computer, not in the vault, and fades with time.
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
6. **Hints and links** (done): dragging to set side, order and parent; links between
   nodes; clickable web addresses.
7. **Safety and finish** (done): trash, daily copies, export and import, colours and
   icons, settings.
8. **Releases**: installers for macOS, Windows and Linux built by GitHub, and
   updates.

Later: Markdown in bodies, images, more vaults, syncing and a web version, phones.

## Agents

Let AI agents read the vault, and later create and edit in the maps the user
shares with them, through an MCP server, `brock-mcp`.

**Built: reading and editing, with the app open.** The window answers, since it
holds the vault and is the only thing that edits it.

```
agent → brock-mcp (stdio) → loopback door (agent.rs) → window → core/agent.ts → answer
```

- **Sharing is per map and per computer.** Select a map's centre and choose
  Can read or Can edit under Agents in the notes; the ids are kept in the window's storage
  (`agents.svelte.ts`), not on the nodes, so they do not travel in backups,
  exports or sync. A map inside a shared one is a closed portal until shared.
  Settings › Agents is a master switch, off by default; the door exists only
  while it is on.
- **Reading:** `list_maps`, `read_map` (an outline with ids, tasks, priority,
  due dates and notes), `read_node` (notes, what is under it, links both ways)
  and `search`, all limited to the maps shared. What is not shared, deleted or
  missing all answer "not found".
- **Editing, in maps shared to edit:** `add_nodes` (an indented outline under a
  node, up to 500; tasks as `- [ ]`), `update_node` (title, notes or appended
  notes, priority, due), `set_task` (open, done, none) and `move_node` (under
  another node, at a place). Each is one edit of the vault, so one ⌘Z, and the
  footer says what an agent changed. No tool deletes, makes or moves maps, or
  rearranges the branches of a centre (which keep their sides and colours).
  Added text loses anything an outline can carry beyond text (maps, ids, links,
  colours).
- **The door** is a listener on 127.0.0.1 with a port of the system's choosing.
  `agent.json` beside the vault holds the port and a secret, readable by the
  owner only, and is removed when the door closes. Not a Unix socket or a
  named pipe, which would be two code paths and, on Windows, a new crate.
- **`brock-mcp.mjs`** holds no data and needs only Node; the app carries it as a
  resource and Settings shows the command to add it to Claude Code.
- **Not done:** a menu command for sharing (it is a setting in the notes
  panel); trying a packaged build (the script as a resource); other agents
  than Claude Code; a way to see what an agent has read.

- **History and attention (built).** Every change is in the log with who made it
  (`source`: you or `agent`); the sidebar's History tab shows the steps and takes
  one back for the nodes unchanged since. Agent edits are not on ⌘Z (`vault.as`).
  `flag_node` sets a mark in three levels, green (OK), orange (needs attention)
  or red (critical), that the bell in the header counts, the green ones apart in
  grey, and lists; an agent only raises a mark, and only the person lowers or
  clears it.

**Next:** `create_map` (the new map taking its parent's sharing), `add_link`,
moving the branches of a centre as the app does (`pinSides`), marking what an
agent added until the person accepts it, and, for boards, roles on columns and
the flag in the Boards section below.

**Later: with the app closed.** This would need a second reader of the
database, beside the window:

- `brock-mcp` as a standalone Rust binary sharing the database code (`db.rs`
  split into a small crate), opening the vault in WAL mode with a busy timeout.
- Writes as `{ before, after }` changes through `apply_changes`, refused when
  `before` no longer matches (it does not check today), and the window
  watching the log for outside changes, applying them as external changes (not
  in ⌘Z), with an unsaved edit on the same node taking the stored version.
- The share setting would have to be readable without the window: in the
  vault, or in a file beside it.
- Anyone able to read the file can bypass sharing, as the README says.

**For sync:** give each log entry a device id, a logical timestamp and a source
(user, agent, remote) while only agents write; the same path that applies an
agent's changes will apply another device's. Sibling order needs a tiebreak by
node id, as two devices can make equal sort keys. How conflicts merge (per node,
last writer wins, or a text merge for notes) is to be decided before the log
gains a field that assumes either.

## Boards that agents work (an idea, not started)

A board (the map style with columns) as a workflow: drag a card to Todo and an
agent picks it up, does it and moves it on. Builds on the Agents section above.

- **Columns have roles,** set once on the board's centre, not read from their
  titles, so renaming a column breaks nothing: *trigger* (Todo), *working*,
  *review* (User testing), *needs feedback*, *done*.
- **A card is the task:** its title is the request, its notes the detail, its
  children the steps or what counts as done.
- **The loop.** A card entering the trigger column is claimed by moving it to
  the working column; the write is refused if the card has moved since, so two
  runners never take one card. The agent writes what it did into the notes,
  adds children for results, and moves the card to review. When stuck it writes
  its question in the notes, flags the card and moves it to needs feedback; the
  user answers in the notes and drags it back to Todo, and the agent resumes
  with the whole thread. A failure, a limit hit or a refused tool ends the same
  way, with the reason on the card, so nothing stalls in working.
- **A flag.** A colour or icon can stand in at first; a real "needs attention"
  field (migration, `withDefaults`, both `Node`s) is better, as the agent and
  the window both read it.
- **A runner is needed,** as MCP only answers. A `brock-agent` command, run by
  hand first (`brock-agent run --board X`) and later as a helper that watches
  the log, reads the database as `brock-mcp` does, so it works with the app
  closed, and starts an agent headlessly (for Claude Code, `claude -p` with the
  Brock server attached and the card's id) for each card that enters a trigger
  column.
- **Permission profiles** say how much power an agent has on a board. The card
  says what to do; it never says how much power to use.
  - A profile holds: the working folder (a project checkout, or an empty
    scratch folder); the tools allowed (an allowlist, so no arbitrary shell,
    installing or `git push` unless named); the network (off, open, or named
    hosts); a budget per card (time, turns, spending) and a cap on cards in
    progress; what it may do in the vault (read this board, move cards between
    its columns, edit their notes, add children; never other maps, never
    delete, enforced by the sharing setting); and what to do on wanting more:
    stop, write the request in the notes, flag, move to needs feedback.
  - **It lives where a card cannot write.** The board's centre holds only a
    profile's name; the profiles are in the app's settings or a file beside the
    vault. In a note, anything able to write one (another agent, text pasted
    from a page) could raise the agent's power.
  - **The launcher enforces it,** not the agent: the allowed tools and folder are
    passed on the command line, and a mode that skips permission checks is never
    used. Nobody is there to click deny in an unattended run, so a tool not
    listed fails closed and the refusal lands on the card. For real isolation,
    run in a container or a macOS sandbox limited to the folder, which matters
    most for boards that run a project's scripts.
  - **A card is data, not authority.** Notes from outside (pasted pages,
    synced from another person) can be marked, so the runner uses a tighter
    profile for them or asks first.
  - **Start with three fixed profiles:** read-only (answers, adds notes),
    research (web and a scratch folder) and project (edits and tests in one
    folder, no network, no push). A board picks one; custom ones wait until
    someone needs them.
- **Order:** the sharing setting and a `brock-mcp` that reads and writes; a
  `move_card` tool with the claim-by-move rule; board roles and the flag; then
  the runner, by hand before it watches.
- **With a phone:** a card dragged to Todo on the phone is picked up by the
  computer when they next sync.

## Syncing devices (an idea, not started)

Take maps to a phone, or another computer, and bring them back, with no
service between the devices. Nothing leaves the computer unless the user pairs
a device or picks a place to share through.

- **Identity.** Each device makes a keypair on its first start; its public key
  is its identity. Trust is a list of paired devices, each with the maps it may
  receive; removing a key revokes the device.
- **Pairing by QR code.** One device shows a code holding its public key, its
  address on the network and a one-time secret; the other scans it. They then
  run a mutual handshake (Noise, with the `snow` crate), so nobody else on the
  network can stand in for either. Where there is no camera, a short code
  shown on both screens, compared by eye, does the same.
- **Same network.** Devices find each other by mDNS or the address in the code
  and connect over TCP inside the handshake. Each says what it has, as the
  highest log position seen from each device, and sends only the log entries
  the other lacks. It works offline and in both directions. Only the entries
  of maps the other device may receive are sent, so a phone can carry a few
  maps.
- **Over the internet, through services the user owns,** in the order worth
  trying: a folder that something else syncs (iCloud Drive, Dropbox,
  Syncthing), where each device appends its own encrypted log file and reads
  the others', so nothing has to run and no two writers touch a file; then a
  relay the user hosts (WebDAV, S3 or a small server) that holds only
  encrypted log segments; direct connections last, and probably left to a
  tunnel such as Tailscale.
- **Sharing a map with another person** is a step beyond one's own devices: the
  map gets its own key, encrypted for each recipient's public key, and
  revoking someone means a new key and encrypting again. After the first.
- **To decide first:** how conflicts merge (per node, last writer wins, which
  loses edits within notes, or a text merge for notes); how long the log is
  kept (until every paired device has seen an entry, then compacted; see
  TASKS.md); and what the phone holds. The log entries need a device id and a
  logical timestamp before any of this (see Agents).
- **Order:** the log entries' new fields and applying changes made elsewhere
  (shared with the agents work); pairing and the handshake; exchange over the
  network; then folders, then a relay.

## A phone app (an idea, not started)

Carry some maps on a phone, jot ideas down, tick tasks off, and bring the
changes back to the computer when the two are on the same network again. Not
a place for restructuring a map; the editing is meant to be small and quick.

- **Tauri mobile** (iOS and Android), reusing `src/core`, the stores' interface,
  the Rust database and sync code, and the Svelte parts that do not assume a
  keyboard. Start with a spike: whether the map's pan and zoom feel right in a
  phone's webview. A separate native app would duplicate the core in two more
  languages, and a web app cannot sync in the background or reach the local
  network.
- **Touch in place of keys.** Tap selects; a button or double tap edits; a long
  press drags or opens a menu; pinch zooms; two fingers pan. `camera.ts` should
  carry over; `MapView.svelte`'s pointer and key handling will not, so the phone
  gets its own view, and the outline (lists suit a small screen) may come first.
- **One thing on screen at a time:** the map or outline, with the maps list,
  notes and tasks as sheets or tabs. A toolbar over the keyboard has add child,
  add sibling, indent and outdent, which Tab and Enter do on a computer.
- **What it is for, in order:** reading a map; ticking tasks (small edits to
  nodes that already exist); a quick-add into one inbox map, which only creates
  nodes and so cannot conflict; then editing titles and notes.
- **Editing offline and syncing back** is the sync work above: the phone keeps
  its own log entries (device id, logical timestamp), and when it meets the
  computer the two exchange what the other lacks. Two devices changing the
  same node is the case the merge rule must settle; ticking a task is a good
  test of it, as it is one field of one node.
- **A phone holds a subset:** the maps chosen when pairing, plus the inbox.
  Nodes outside those maps are not sent, so links to them show as missing there.
- **Order:** the spike; a read-only phone app fed by pairing and exchange over the
  network; tasks and the inbox; then fuller editing. iOS needs an Apple
  developer account for anything beyond the user's own device, and the toolchain
  note in AGENTS.md may reach the iOS build too.

## Open questions

- Whether the top of the vault is a map like any other, or a special home view.
