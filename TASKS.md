# Tasks

The milestones are in [PLAN.md](PLAN.md). Milestones 1 to 3 (core and storage,
one map, maps inside maps) are done; these are what is next, and what was left on the way.

## Milestone 4: search

- A palette (⌘K) that matches titles as they are typed, from the vault in
  memory, and bodies through the FTS5 index (the `search` command in Rust
  is there already).
- Each result shows its path; choosing one opens its map and selects it.
- Filters: only this map, only maps.

## Left from milestone 3

- Watch the zoom into and out of maps in the app: the browser preview's
  pictures could not show it moving. Check its speed and easing feel right.

## Left from milestone 2

- Moving nodes by dragging them (milestone 6); the keyboard moves are done.
- Branches made before their colour was saved with them still take theirs
  from their place, and change colour when moved. Only test vaults have them.
- Nodes jump to their new places; animate them there, lines included.
- Every edit redraws every node of the map: about 10–35 ms on a map of 500
  nodes. Draw only nodes whose place or content changed, and nothing off
  screen, before maps get much larger.
- Typing in the editor and the layout disagree for one frame while a node
  grows; check it looks right in the app, on the left side especially.
- Try trackpad pinching in the app (it comes as gesture events in WebKit,
  handled but not tried yet) and every key on a real keyboard.
- The selection is drawn with the focus ring colour on every node; check it
  reads well beside the branch colours.

## Left from milestone 1

- Write what is still being saved before the window closes: listen for
  Tauri's close request and wait for `saver.flush()`.
- Undo lasts only until the app closes. Keep it across restarts, from the
  `ops` table, or decide it is not needed.
- The `ops` log grows forever. Decide how long to keep it once syncing is
  planned.
- Bodies are loaded with everything else. Measure a vault with long bodies;
  load them on demand if it is slow.
- The search command in Rust exists but nothing calls it yet (milestone 4).
- Choose the name, then change `productName`, `identifier` (which moves the
  data folder), the window title and the README.
- Try the app on Windows and Linux.
