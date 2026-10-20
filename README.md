# Mind Map

*A working name: the app's real name is still to be chosen.*

A desktop mind-mapping app. It starts with a single node; any node can become
a map of its own, which you open and come back out of. Everything is saved as
you go, to a database on your computer. There is no Save command.

It is at an early stage: maps can be made, drawn, edited from the keyboard,
opened and left again, searched, with notes, undo and saving. An overview of
the whole vault is next. See
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
| Typing, Space or F2 | Edits the title; typing replaces it, Space and F2 keep it |
| Enter or Escape while editing | Finishes editing; Tab adds a node under it |
| Escape on a new node left empty | Takes it away again and goes back to the node you started from |
| ← → | Moves to the parent, or the child level with the node |
| ↑ ↓ | Moves to the sibling above or below, then on to the same level of the next branch |
| ⌥↑ ⌥↓ | Moves the node up or down among its siblings |
| ⌥ with ← or → | Moves the node outwards, under the sibling above it, or inwards, beside its parent; a branch of the centre moved inwards crosses to the other side |
| Delete or Backspace | Deletes the node and what is under it |
| ⇧⌘M | Makes the node a map of its own, or an ordinary node again |
| ⌘↓, ⌘↵ or a double click | Opens a map |
| ⌘↑ | Back out to the map this one is in, with the map you left selected |
| ⌘/ | Folds a branch away, or shows it again |
| ⌘+, ⌘−, ⌘0 | Zooms in, out, or to the whole map |
| ⌘K | Searches every title and note in the vault; Tab narrows it to the open map, then to maps |
| ⌘1, ⌘2 | The map, or the same map as an outline |
| ⇧⌘N | Shows the selected node's notes |
| ⌘Z, ⇧⌘Z | Undo, redo |

The outline has the same ⌥ keys, ← for out and → for in. There they take the
place of jumping a word at a time in a title.

Drag the background or scroll to move around; pinch, or scroll with ⌘ held,
to zoom. The breadcrumbs at the top lead back to the maps above.

## Where the vault is kept

One SQLite file, `vault.sqlite`, in the app's data folder:
`~/Library/Application Support/com.jaanpullerits.mindmap` on macOS,
`%APPDATA%\com.jaanpullerits.mindmap` on Windows and
`~/.local/share/com.jaanpullerits.mindmap` on Linux. Set `MINDMAP_DATA` to a
folder to use a vault there instead.
