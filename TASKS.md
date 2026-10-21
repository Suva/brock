# Tasks

The milestones are in [PLAN.md](PLAN.md). Milestones 1 to 7 are done; these are what is next, and what was left on the way.

## Milestone 8: releases

- The app's own updates (Tauri's updater). It reads what is newest from the
  releases, which a private repository keeps from it: it waits until the
  repository is public, or the installers are put somewhere public.
- Signing: an Apple Developer ID and notarisation, so macOS opens the app
  without asking; a certificate for Windows, against SmartScreen.
- The installers were only built here for the Mac; the Windows and Linux
  ones have not been installed on a real machine.
- Before the first release, search the Mac App Store and Microsoft Store
  for apps called Brock, and the US and EU trademark registers for "Brock"
  in software: the web search done when choosing the name found none, but
  could not reach the registers. Avoid "Brock Maps" (Brock University's
  campus map is brockmaps.com).
- Register getbrock.app (and brockmap.app to hold), and put the website there.

## The window

- In a very narrow window the breadcrumbs shrink until the open map's own
  name is cut off; it should be the last to go.
- A title bar of our own on Windows (and Linux), as on the Mac: the
  minimise, maximise and close buttons drawn by the app, with Windows 11's
  snap layouts and resizing at the edges.

## Left from the menu bar

- The menu bar was only built and checked for errors on the Mac; its items
  were not clicked through there, and it was not seen on Windows or Linux,
  where Settings and Quit are in File. On those systems, whether a key the
  page handles also runs its menu item is not known: `fresh` in
  `app-menu.ts` guards against it running twice.
- Edit › Cut, Copy and Paste chosen with the mouse on the map: WebKit may
  send the page no clipboard events with no text selected, so they may do
  nothing or be greyed out there (⌘C, ⌘X and ⌘V work). If so, make them
  items of our own that copy branches on the map and run the system's
  command in a text field.

## Left from milestone 7

- Export and import were not clicked through while checking: the formats
  are tested, the dialogs only built. Try both in the app.
- Closing while a save is still under way was not tried; saves are too quick
  to catch.
- Copies are named by the date in UTC, so near midnight a day's copy can
  carry the date before or after.
- Settings holds little yet. Candidates: where the vault is, how many copies
  to keep, a different font size.

## Choosing several

- ⌥ with the arrows, making maps, colours and icons work on the selected
  node only; extend them to all chosen if that is missed.
- The outline chooses one row at a time.
- Copy and paste in the outline: its rows are text fields, which copy text.

## Tasks

- Due dates, and a view of what is due, once tasks have been used for a
  while and it is clear they are missed.
- `- [ ]` lines in notes are not tasks of the panel: they are text in a note.
  Revisit if people expect them there.
- OPML has no standard place for a task; exported, tasks lose their box
  there (Markdown and JSON keep it).

## Notes

- Typing `[[` could offer the titles that match, as ⌘L does.
- The Markdown has no nested lists, tables, images or links in titles; add
  what is missed.
- A `[[Title]]` link does not appear under "Linked from" on its node, as what
  it means can change; a `node:` link, put in with ⌘L, does.

## Left from milestone 6

- Dragging near the edge of the window does not move the map; a node can be
  dragged only as far as is on screen.
- Links have no labels. The old plan had them; add them if they are missed.
- Clicking a web address in the app opens the browser through Tauri's
  opener; that was not clicked while checking, only built and allowed.
- Links can only be made with ⌘L; dragging from a node to another with a
  key held would be quicker.

## Left from milestone 5

- The minimap of a very tall or wide map is a thin strip; give it a smallest
  width or height if that turns out hard to use.
- The sidebar is not reachable from the keyboard; ⌘K narrowed to maps is,
  and the map's ⌘T and Space for tasks.
  Revisit if it is missed.

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

- Undo lasts only until the app closes. Keep it across restarts, from the
  `ops` table, or decide it is not needed.
- The `ops` log grows forever. Decide how long to keep it once syncing is
  planned.
- Bodies are loaded with everything else. Measure a vault with long bodies;
  load them on demand if it is slow.
- The search command in Rust exists but nothing calls it: search runs in
  memory. Keep it for vaults too big for that, or for a web version.
- Try the app on Windows and Linux.

## The website

The page and its demo are made and tried locally (`npm run site`).

- Publish it: a workflow that builds `_site/` and puts it on GitHub Pages,
  for every release and every change to `site/`. Pages needs the repository
  to be public, or a paid GitHub plan for a private one; the download links
  only work for visitors once the releases are public too.
- Register getbrock.app and point it at the site.
- Other keys in the demo for what browsers keep for themselves (⌘T makes a
  task, ⌘1 to ⌘5 set priorities), or buttons for them in the notes panel, so
  that everything in the tour can be done there.
- Firefox edits titles in place only from version 136; phones and tablets
  have no pinch or on-screen keyboard editing yet. The demo was only tried
  in Chrome.
