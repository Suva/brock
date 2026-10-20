# Tasks

The milestones are in [PLAN.md](PLAN.md). Milestones 1 (core and storage) and
2 (one map) are done; these are what is next, and what was left on the way.

## Milestone 3: maps inside maps

- A transition when opening a map and coming back: zoom into the portal
  node, and out of it.
- The shortcut back to the parent map (not Escape). Until then, only the
  breadcrumbs lead back.
- Coming back selects the portal of the map just left.

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
