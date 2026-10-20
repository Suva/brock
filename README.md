# Mind Map

*A working name: the app's real name is still to be chosen.*

A desktop mind-mapping app. It starts with a single node; any node can become
a map of its own, which you open and come back out of. Everything is saved as
you go, to a database on your computer. There is no Save command.

It is at an early stage: the vault, its storage and undo work, and the window
shows the open map as an outline to try them. Drawing it as a map is next. See
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

In the outline:

| Key | Does |
|---|---|
| Enter | A new node after this one (under the centre, when on the centre) |
| Shift+Enter | A new node before this one |
| Tab | A new node under this one |
| ↑ ↓ | The node above or below |
| Backspace in an empty node | Deletes it |
| ⇧⌘M | Makes the node a map of its own, or an ordinary node again |
| ⌘↵ | Opens a map |
| ⌘Z, ⇧⌘Z | Undo, redo |

The breadcrumbs at the top lead back to the maps above.

## Where the vault is kept

One SQLite file, `vault.sqlite`, in the app's data folder:
`~/Library/Application Support/com.jaanpullerits.mindmap` on macOS,
`%APPDATA%\com.jaanpullerits.mindmap` on Windows and
`~/.local/share/com.jaanpullerits.mindmap` on Linux. Set `MINDMAP_DATA` to a
folder to use a vault there instead.
