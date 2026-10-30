# Tasks

The milestones are in [PLAN.md](PLAN.md). Milestones 1 to 7 are done; these are what is next, and what was left on the way.

## Milestone 8: releases

- The app's own updates are made but not yet tried from a real release: the
  first release with them (after 0.3.1) is installed by hand once; the next
  one after it is the first an installed copy can update to. Try that on
  each system, Windows and Linux included.
- Signing: an Apple Developer ID and notarisation, so macOS opens the app
  without asking; a certificate for Windows, against SmartScreen.
- The installers were only built here for the Mac; the Windows and Linux
  ones have not been installed on a real machine.
- Before the first release, search the Mac App Store and Microsoft Store
  for apps called Brock, and the US and EU trademark registers for "Brock"
  in software: the web search done when choosing the name found none, but
  could not reach the registers. Avoid "Brock Maps" (Brock University's
  campus map is brockmaps.com).

## A locked vault

A password that encrypts the vault, so its file is unreadable without it:
for a shared computer, backups such as Time Machine, or a vault kept in a
synced folder. Disk encryption (FileVault, BitLocker) already covers a
stolen laptop. A few days' work:

- Build rusqlite with SQLCipher (`bundled-sqlcipher`), which encrypts the
  whole file, its search index and write-ahead log included, with a key
  made from the password.
- An unlock screen before the vault opens; optionally "remember on this
  computer", keeping the key in the macOS Keychain or Windows Credential
  Manager. Lock after a while idle, perhaps.
- Turning a vault's password on, changing it (`PRAGMA rekey`) and turning
  it off, in Settings; an existing vault converted with `sqlcipher_export`
  and the plain file removed.
- The daily copies encrypted too, and the carry-over from the old
  identifier able to open an encrypted vault.
- A forgotten password loses the maps: say so plainly when one is set, and
  perhaps offer a recovery key to write down. Exports stay plain text; say
  so when exporting from a locked vault.
- While unlocked the maps are in memory as in any app; this protects the
  file, not the running app.

## Pictures of a map

- SVG and PNG open well in Affinity and Chrome; Figma, Inkscape, Keynote
  and Word were not tried. Exporting and copying work in the app on a Mac.
- A PNG goes to Rust as a list of numbers; a very large map makes a large
  list. Send the bytes as they are if that turns out slow.
- Only the open map; a whole tree of maps as pages, or PDF, if wanted.

## The window

- In a very narrow window the breadcrumbs shrink until the open map's own
  name is cut off; it should be the last to go.
- The title bar of our own on Windows lacks Windows 11's snap layouts on
  hovering the maximise button, and resizing at the window's edges has not
  been checked. Linux still has the system's title bar.

## Ways of drawing a map

- A timeline goes in the tree's order, evenly spaced: it does not read dates.
  Placing events by their due date, with the dates on the line, could come
  next if that is what is wanted.
- A board's columns are ordinary nodes: a week is seven of them, made by
  hand. A way to make a week at once, and a week that knows today, could come
  once boards are in use.

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

- Due dates show on the map and in the Tasks tab, and order tasks within a
  priority, but the outline does not show them. Add a view of what is due, once it is clear it is
  missed. Markdown and OPML exports leave them out; JSON keeps them.
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

- Near an edge, the map follows a dragged node; that was tried with
  pointer events sent by a script, not with a real mouse or trackpad. A node
  grabbed close to an edge starts the map moving at once.
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
- The `ops` log still grows with use, though typing is joined now. Decide
  how long to keep it once syncing is planned.
- Bodies are loaded with everything else. Measure a vault with long bodies;
  load them on demand if it is slow.
- The search command in Rust exists but nothing calls it: search runs in
  memory. Keep it for vaults too big for that, or for a web version.
- Try the app on Windows and Linux.

## The website

The page and its demo are published at brock.clysuva.com.

- Firefox edits titles in place only from version 136; phones and tablets
  have no pinch or on-screen keyboard editing yet. The demo was only tried
  in Chrome.
