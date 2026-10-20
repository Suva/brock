# Tasks

The milestones are in [PLAN.md](PLAN.md). Milestone 1 (core and storage) is
done; these are what is next, and what was left on the way.

## Milestone 2: one map

- Draw the open map as a map: the centre, branches left and right, lines
  between them, with an automatic tidy-tree layout in `src/core/layout.ts`
  (pure, tested), honouring each centre child's `side`.
- Pan and zoom the canvas; keep the selected node in view.
- The same keyboard as the outline, plus arrow keys that move by direction on
  the map (left goes towards the centre on the right side, and so on).
- Edit a title in place on the node; open the body in a side panel.
- Keep the outline as a second view of the same map (Plan: "Outline view").

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
- Choose the shortcut back to the parent map.
- Try the app on Windows and Linux.
