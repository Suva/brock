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
| `src/core/layout.ts` | Where each node of a map goes, from the sizes the window measures |
| `src/core/navigate.ts` | Which node an arrow key moves to |
| `src/core/branches.ts` | The side and colour a new branch of a map's centre is given, and the palette |
| `src/core/search.ts` | Searching titles and notes, in memory, and ranking what is found |
| `src/core/usage.ts` | What search learns from use: nodes gone to often, and the one chosen for a query |
| `src/core/overview.ts` | The vault's maps as a tree, with what each holds |
| `src/core/drop.ts` | Where a node dragged on a map would land |
| `src/core/urls.ts` | Web addresses in text, and trimming the sentence off them |
| `src/core/markdown.ts` | Notes' Markdown read into blocks and spans, never HTML |
| `src/core/exchange.ts` | Export to JSON, Markdown and OPML; reading OPML and JSON back in |
| `src/core/tasks.ts` | Tasks across the vault: progress under a node, the lists of the tasks panel, done tasks by the day they were done, clearing them |
| `src/core/history.ts` | The maps visited, for back and forward |
| `src/core/clipboard.ts` | Copy, cut and paste of branches: copies as outlines, cuts moved whole |
| `src/core/picture.ts` | A picture of a map as plain shapes, and writing it as SVG |
| `src/core/moves.ts` | Moving a node from the keyboard: up and down, in and out, across the centre |
| `src/store/store.ts` | What a store does: load everything, save changes |
| `src/store/tauri-store.ts` | The store in the app, through Tauri commands |
| `src/store/memory-store.ts` | The store in tests, and in a browser (`npm run dev`) |
| `src/store/saver.ts` | Writes changes in order, one write at a time, retrying failures |
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
| `src/ui/TrashDialog.svelte` | The trash: restoring, emptying for good |
| `src/ui/Settings.svelte` | Settings (⌘,): appearance, the daily copies |
| `src/ui/usage.ts` | Search's usage, kept in the window's storage |
| `src/ui/session.ts` | Where the window was left (map, node, view, panels), to start there |
| `src/ui/theme.ts` | Light, dark or as the system, kept in the window's storage |
| `src/ui/system-clipboard.ts` | The system's clipboard as text: Tauri's plugin in the app, the browser's elsewhere |
| `src/ui/PriorityBadge.svelte` | A priority, 1 to 5, as a numbered circle |
| `src/ui/open-url.ts` | Opens a web address in the browser, never in the app |
| `src/ui/keys.ts` | Whether a key is typing, which the views leave alone |
| `src/ui/OutlineView.svelte` | The same map as an indented list |
| `src/ui/NotesPanel.svelte` | The selected node's notes, read or written, its links and the nodes linking to it |
| `src/ui/Markdown.svelte` | Draws notes from `markdown.ts`'s blocks; links are buttons |
| `src/ui/Sidebar.svelte` | The sidebar on the left, with the Maps and Tasks tabs; places to go in the vault |
| `src/ui/MapsList.svelte` | The sidebar's Maps tab: every map of the vault as a tree |
| `src/ui/Resizer.svelte` | The handle that drags a side panel's edge to change its width; widths are kept in the session |
| `src/ui/Palette.svelte` | Search (⌘K): the field, the results and going to one |
| `src/demo/tour.ts` | The tour map: the whole vault of the website's demo, and a map the app adds to a new vault |
| `src/ui/tour.ts` | The tour in the app: added on a new vault's first start, shown and removed from the Help menu |
| `site/` | The website's page; `scripts/build-site.mjs` builds it, with the demo, into `_site/` |
| `src-tauri/src/db.rs` | The SQLite database: schema and its migrations, saving, loading, a full-text search not used yet |
| `src-tauri/src/lib.rs` | The app: where the vault is, the commands the window calls, the dialogs of export and import, the opener for web addresses |
| `brand/` | The logo and the icon, kept out of the app's package. `brock-logo.svg` and `brock-logo-plain.svg` are the logo with its wordmark, on a tile with a grey surround and on plain black. `brock-icon.svg` is the app icon: the logo without the wordmark, with two more branches where the word was. Every size is made from it with `npx tauri icon brand/brock-icon.svg -o src-tauri/icons`; delete the `android` and `ios` folders that makes, and copy `64x64.png` to `static/favicon.png` |
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
- **Number keys are matched by `e.code`, not `e.key`.** ⌘1 to ⌘5 and ⌥⌘1
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
- **A new command goes in the menu bar too** (`app-menu.ts`), with its key.
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

`site/` holds the website: one page, with the downloads and a demo of the
app. `scripts/build-site.mjs` builds it into `_site/`: the page, with this
download links filled in (from `package.json` locally; in CI from the newest
published release, `SITE_VERSION`, since `package.json` is bumped before the
installers are built), and the demo, which
is the window built for a browser with `--mode demo`. It is published at
brock.clysuva.com by `.github/workflows/site.yml` on GitHub Pages, on every
push to `main` that changes the site or the demo, and when the release
workflow has put the installers on a release (it starts the site's build
itself, as a release made with its own token starts nothing); the
build writes the `CNAME` for that domain. Try it locally with `npm run site`.

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
(`scripts/sync-version.mjs`), commits and makes the tag. Pushing the tag
makes GitHub build the installers and publish them as a release
(`.github/workflows/release.yml`), with notes made from the commits since
the last one.

```bash
npm version minor -m "Release %s"   # or: patch, major, or an exact number
git push --follow-tags
```

- The working folder has to be clean first.
- Use `minor` for new features and `patch` for fixes only.
- The release workflow can be run by hand from the Actions tab, which builds
  the installers without publishing anything, kept with the run.
- Nothing is signed. The Mac app is signed ad hoc (`signingIdentity: "-"`),
  without which a downloaded copy on Apple silicon is called damaged and
  will not open at all; macOS still asks before opening it.
- While the repository is private, so are its releases: only people with
  access to it can download them. Building on macOS uses ten times the
  Actions minutes of Linux; a release takes about fifteen minutes there.

## Working agreements

- Commit and push only when asked.
- Comments say why the code is the way it is. User-facing text avoids jargon.
- When a change makes something in the README, PLAN.md or this file untrue,
  fix the text in the same change.
- When a task in TASKS.md is done, remove it from there.
