# Mind Map

*A working name: the app's real name is still to be chosen.*

A desktop mind-mapping app. It starts with a single node; any node can become
a map of its own, which you open and come back out of. Everything is saved as
you go, to a database on your computer. There is no Save command.

It is at an early stage: maps can be made, drawn, edited from the keyboard,
opened and left again, searched, overseen and linked, with tasks, notes,
colours and icons, undo, a trash, daily copies, and export and import. Installers are
next. See
[PLAN.md](PLAN.md) for where it is going and [TASKS.md](TASKS.md) for what is
next.

## Running it

You need Node 24 or newer, Rust (from [rustup.rs](https://rustup.rs)), and on a
Mac the Xcode command line tools.

```bash
npm install
npm start
```

`npm start` builds and opens the app. The first build of the Rust side takes a
few minutes; later ones take seconds.

`npm run dev` opens just the window in a browser, at http://127.0.0.1:1420,
with the vault kept in the browser's storage. It is quicker for working on the
interface.

## Trying it

The open map is drawn around its centre. Select a node by clicking it or with
the arrow keys, then:

| Key | Does |
|---|---|
| Tab | A new node under this one; on a map, it opens the map and starts a new node in it |
| Enter | A new node after this one (under the centre, when on the centre) |
| Shift+Enter | A new node before this one |
| Typing, Space or F2 | Edits the title; typing replaces it, Space and F2 keep it. On a task, Space ticks it instead |
| ⌘T | Makes the node a task, with a checkbox, or an ordinary node again |
| Enter or Escape while editing | Finishes editing; Tab adds a node under it |
| Escape on a new node left empty | Takes it away again and goes back to the node you started from |
| ← → | Moves to the parent, or the child level with the node |
| ↑ ↓ | Moves to the sibling above or below, then on to the same level of the next branch |
| ⌘-click, Shift-click | Adds a node to those chosen, or the siblings between |
| Shift with ← → ↑ ↓ | Adds the next node that way to those chosen |
| ⌘A | Chooses everything in the map |
| ⌘C, ⌘X, ⌘V | Copies, cuts and pastes the chosen branches, with everything under them |
| Escape | Back to one node chosen |
| ⌥↑ ⌥↓ | Moves the node up or down among its siblings |
| ⌥ with ← or → | Moves the node outwards, under the sibling above it, or inwards, beside its parent; a branch of the centre moved inwards crosses to the other side |
| Delete or Backspace | Deletes the node and what is under it |
| ⇧⌘M | Makes the node a map of its own, or an ordinary node again |
| ⌘↓, ⌘↵ or a double click | Opens a map |
| ⌘↑ | Back out to the map this one is in, with the map you left selected |
| ⌘← ⌘→, or ⌘[ ⌘] | Back and forward through the maps visited, as in a browser |
| ⌘/ | Folds a branch away, or shows it again |
| ⌘+, ⌘−, ⌘0 | Zooms in, out, or to the whole map |
| ⌃⌘S | Shows or hides the sidebar on the left: every map of the vault as a tree, or the tasks |
| ⇧⌘T | Shows the tasks of the open map, or of all maps, in the sidebar |
| ⌘L | Links the selected node to any other, chosen as in search |
| ⌘K | Searches every title and note in the vault; Tab narrows it to the open map, then to maps |
| ⌘1 to ⌘5 | Gives the node a priority, 1 to 5; the same number again takes it off |
| ⌥⌘1, ⌥⌘2 | The map, or the same map as an outline |
| ⌘, | Settings: light, dark or as the system; the daily copies |
| ⇧⌘N | Shows the selected node's notes |
| ⌘Z, ⇧⌘Z | Undo, redo |

In the outline every row is a text field, and ⌥ with the arrows edits text as
anywhere else. Rows move with ⌃⌘ and the arrows instead (Alt and the arrows on
Windows and Linux): ↑ and ↓ among their siblings, → in under the row above,
← out beside the parent, as ⇧Tab also does.

Several nodes can be chosen at once: ⌘-click, Shift-click, Shift with the
arrows, ⌘A, or Shift and a drag on the background to draw a box. Deleting,
⌘T, Space and dragging then act on all of them, as one step to undo.

Copying takes a branch with everything under it: maps inside, notes, tasks,
colours, icons and links. Paste puts it under the selected node, inside it if
it is a map. Cut and paste moves the branch itself, so links to it still lead
to it. Copied branches also paste into other apps as an indented list, and an
outline copied from another app (an indented list, Markdown, OPML) pastes in
as nodes.

Drag a node to move it: onto another node to put it under that one (into it,
if it is a map), or between two to put it there; near a branch on the other
side, it crosses the centre. A line or an outline shows where it will land;
Escape leaves it where it was.

Links between nodes are dashed arrows when both ends are on the open map; a
link to somewhere else shows as ↗ on the node, which goes there.

The notes panel on the right, opened by the small tab on the right edge or
⇧⌘N, shows the selected node's notes, written in Markdown:
`# headings`, `**bold**`, `*italic*`, `` `code` ``, lists, `- [ ]` to-dos you
can tick, `> quotes`. Click them, or press Enter on them, to write; Escape
shows them formatted again. Web addresses in them open in your browser.
Links to nodes and maps go there: press ⌘L while writing to choose a node, or
type `[[a node's title]]`. Under the notes are the node's links and the nodes
linking to it.

Drag the background or scroll to move around; pinch, or scroll with ⌘ held,
to zoom. Zoomed out, the deeper levels turn into bars in their branch's colour,
and a map too big for the window gets a small picture of itself in a corner:
click or drag in it to move there. The breadcrumbs at the top lead back to the
maps above. On a deep map the ones in the middle fold into a "…",
which lists them.

A node with tasks under it shows how many are done, as 2/5.

Any node can have a priority, from 1 to 5, shown as a numbered circle before
its title. In the tasks list, priorities 1 to 3 come before tasks that have
none, and 4 and 5 after them.

The sidebar on the left, opened by the small tab on the left edge or ⌃⌘S,
lists places in the vault to go to, as two tabs:
Maps, every map as a tree with what each holds, and Tasks, what is still to
do, grouped by map, with what is done folded away at the bottom. Tick tasks
there, or click one to go to it. The panel on the right is about the selected
node, so a task's notes show beside the list.

The notes panel also sets a node's colour, which carries down everything
under it, and an icon shown before its title.

The ⋯ menu at the top right exports the open map, with everything under it,
as Markdown, OPML (which other outliners and mind map apps read) or JSON
(everything, to bring back into this app), and imports OPML or JSON under the
selected node. It also opens the trash, where deleted branches wait to be put
back until the trash is emptied, and Settings.

The app starts where you left it: the same map and node, view and panels.

## Nothing leaves your computer

The app works without a network. The only thing that reaches outside it is a
web address in your notes that you click, which opens in your browser. The
clipboard is read only when you paste.

## Where the vault is kept

One SQLite file, `vault.sqlite`, in the app's data folder:
`~/Library/Application Support/com.jaanpullerits.mindmap` on macOS,
`%APPDATA%\com.jaanpullerits.mindmap` on Windows and
`~/.local/share/com.jaanpullerits.mindmap` on Linux. Set `MINDMAP_DATA` to a
folder to use a vault there instead.

Every day the app is used, a copy of the vault is made in the `Backups` folder
beside it, and the last seven are kept. Settings shows them and makes one on
request. To go back to a copy, quit the app and put the copy in place of
`vault.sqlite`.
