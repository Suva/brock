# What's new

The changes in each release of Brock that someone using it would notice.
The website shows this list, and the app links to it when it offers an
update; changes that are not yet in a release are under "Not released yet"
and appear there once they are.

## Not released yet

- Clicking away from a new node before typing anything now takes it back, instead of leaving an empty "Idea" behind.
- **Boards.** A map can be drawn in columns, its nodes as headings and what is under them as cards, for a weekly plan or a to-do board: choose Board under Style, or press ⌥⌘5. Drag a card to any column, or move it with ⌥← and ⌥→.
- **Timelines.** A map can also run along a straight line from its centre, its nodes by turns above and below it: choose Timeline under Style, or press ⌥⌘4. ⌥← and ⌥→ move a node along the line.
- **Org charts.** Any map can be drawn downwards from its centre, each level in a row, joined by straight lines: select its centre and choose Org chart under Style in the notes panel, or press ⌥⌘3. Each map keeps its own, and the arrow keys, ⌥ with the arrows and dragging follow the new shape.
- **Due dates.** Any node can have a date: set it under Due in the notes panel, and the × beside it takes it away. The date shows on the node itself and in the Tasks tab, in orange on the day and in red once it has passed, and within a priority the soonest due comes first.

## 0.6.1 — 29 October 2026

- Opening or closing the sidebar no longer shifts the map sideways; it stays where it is, and moves only if the sidebar would cover the selected node.
- Pasting text into a note no longer also adds it as a new node on the map.

## 0.6.0 — 24 October 2026

- **On Windows the header is the title bar.** Minimise, maximise and close
  are at its right, and the menus are under ☰ at its left: rest the pointer
  on File, Edit, Node, View or Help to open it, or press Alt or F10 to open
  the menu from the keyboard.
- **Drag rows in the outline.** Hold the ⠿ at the left of a row and drag it
  onto another row to put it under that one, or between two to put it
  there. Escape leaves it where it was.
- In the outline on a Mac, **⌥ and the arrows move rows**, as they move
  nodes on the map. Inside a title they no longer jump by word; ⌃⌘ and the
  arrows still move rows too.
- The notes show they are being written with one quiet border, in place of
  two bright boxes one inside the other.

## 0.5.0 — 23 October 2026

- **Notes are drawn as you write them.** Headings, bold, lists, quotes,
  code and tables look the way they will read while you type, and the marks
  around them (`**`, `#`, `>` and the like) show only where the cursor is.
  Tick a task's box right in the notes. **M↓** at the top of the notes, or
  ⌘E, shows the plain Markdown instead. ⌘B and ⌘I make text bold or italic,
  and Enter carries a list or a quote on to the next line.
- **Link files and folders from notes.** Drag them from Finder or Explorer
  onto the notes, or write a `file:///` address. A click opens folders,
  documents, pictures, sound and video in their own apps; anything that
  might be a program is only shown in Finder or Explorer, so a link can
  never start one.
- **Links in notes can open parts of Brock.** `[show the tasks](brock:tasks)`
  shows the tasks, and likewise `brock:maps`, `brock:search`,
  `brock:settings` and `brock:trash`. The tour uses them to show the way
  around.
- When an update is offered, **What's new** opens this list on the website.

## 0.4.0 — 22 October 2026

- **Brock updates itself.** It looks for a newer version now and then and
  offers it in a corner of the window; nothing is downloaded until you click
  Install and restart, after everything is saved. Settings can turn the
  looking off, or look right away.
- **Search finds more with less typing.** The first letters of a title's
  words find it: "pp" finds "Product plan". Results are ranked by where
  they are in the vault, the open map first, and by the nodes you go to
  most.

## 0.3.1 — 22 October 2026

- Long notes no longer spill over the links below them.

## 0.3.0 — 22 October 2026

- **Pictures of maps.** The ⋯ menu exports the open map as a picture, SVG
  or PNG, or copies it as one to paste elsewhere.
- **Tables in notes**, written as Markdown tables.
- **Side panels can be made wider or narrower** by dragging their edge, and
  closed by dragging it all the way in.
- Long notes no longer push the status bar off the window.

## 0.2.0 — 21 October 2026

- **A tour on the first start.** A new vault opens on a map that shows the
  way around Brock, one node a feature. Help › Remove the Tour takes it
  away, and Help › Show the Tour brings it back.
- **Tasks and priorities from the notes panel**, by mouse, as well as with
  ⌘T and ⌘1 to ⌘5.
- **Done tasks are grouped by when they were done** in the Tasks tab, and
  each group can be cleared on its own.
- Dragging a node near the edge of the window moves the map along.
- The selected node is marked with a box.
- A new icon: the badger.

## 0.1.0 — 21 October 2026

The first release.

- **Maps inside maps.** Any node can become a map of its own, which opens
  and comes back out of, with breadcrumbs, back and forward.
- **Made from the keyboard**: Tab and Enter add nodes, typing names them,
  the arrows move around, and ⌥ with the arrows moves nodes.
- **Notes in Markdown**, with links to web addresses and to other nodes.
- **Tasks**, with checkboxes, priorities and a list of them across the vault.
- Search (⌘K), an outline view, colours and icons, links between nodes.
- Everything is saved as you go, with undo, a trash and a copy of the vault
  every day. Maps export to Markdown, OPML and JSON, and OPML and JSON
  import.
