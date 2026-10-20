# Tasks

The milestones are in [PLAN.md](PLAN.md). Milestones 1 to 5 (core and storage,
one map, maps inside maps, search, overview) are done; these are what is next, and what was left on the way.

## Milestone 6: hints and links

- Dragging a node: across the centre sets its side, between siblings its
  place, onto another node makes it that node's child. The keyboard moves
  are done; this is the same with the mouse.
- Links between nodes: a dashed curve when both ends are in the same map,
  otherwise a sign on the node that goes to the other end.
- Web addresses in notes can be clicked, opening in the browser (Tauri's
  opener plugin; the privacy promise has to say so).

## Left from milestone 5

- The minimap of a very tall or wide map is a thin strip; give it a smallest
  width or height if that turns out hard to use.
- The sidebar is not reachable from the keyboard; ⌘K narrowed to maps is.
  Revisit if it is missed.
- Whether the sidebar is open is forgotten at each start.

## Left from milestone 4

- Results are not grouped by map; with many hits from one big map, the
  others are pushed down. See whether it matters in use.
- Going to a result unfolds the branches above it as an edit, which can be
  undone; decide whether that is right or whether it should not count.

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
- The search command in Rust exists but nothing calls it: search runs in
  memory. Keep it for vaults too big for that, or for a web version.
- Choose the name, then change `productName`, `identifier` (which moves the
  data folder), the window title and the README.
- Try the app on Windows and Linux.

## Later: a demo on the website

The window already runs in a browser, keeping the vault in local storage
(`npm run dev`), so the website can let people try it:

- A demo build that starts from an example vault when storage is empty, with
  a button to start over and a line saying nothing leaves the browser.
- Embedded in an iframe: the app takes the keyboard of its whole window, so
  mounted straight into a page it would take the page's arrows and Tab.
  A "click to try" cover hands the keyboard over.
- Other keys for what browsers keep for themselves: ⌘1 and ⌘2 switch tabs,
  ⇧⌘N opens a private window.
- Firefox edits titles in place only from version 136; phones and tablets
  have no pinch or on-screen keyboard editing yet.
