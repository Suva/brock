<!--
  The window: the breadcrumbs of the open map, the map drawn as a map or as an
  outline, the selected node's notes, and whether everything is saved.
-->
<script lang="ts">
  import { importInto, readOutlines, toJSON, toMarkdown, toOPML } from "../core/exchange.ts";
  import { openText, saveText, type FileKind } from "./files.ts";
  import { typingIn } from "./keys.ts";
  import type { Live } from "./live.svelte.ts";
  import MapsSidebar from "./MapsSidebar.svelte";
  import MapView from "./MapView.svelte";
  import NotesPanel from "./NotesPanel.svelte";
  import Palette from "./Palette.svelte";
  import OutlineView from "./OutlineView.svelte";
  import MoreMenu from "./MoreMenu.svelte";
  import Settings from "./Settings.svelte";
  import TrashDialog from "./TrashDialog.svelte";

  let { live }: { live: Live } = $props();
  const vault = $derived(live.vault);
  const version = $derived(live.version);

  // Null until a map is opened: the top of the vault.
  let openedMap = $state<string | null>(null);
  let selected = $state<string | null>(null);
  /** The node whose title is being edited on the map. */
  let editing = $state<string | null>(null);
  let view = $state<"map" | "outline">("map");
  let notesOpen = $state(false);
  /** The search palette, open to go somewhere or to link the selected node. */
  let searching = $state<false | "go" | "link">(false);
  let sidebarOpen = $state(false);
  let moreOpen = $state(false);
  let trashOpen = $state(false);
  let settingsOpen = $state(false);
  /** A line in the footer for a few seconds: what an export or import did. */
  let notice = $state<{ text: string; bad: boolean } | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;

  function tell(text: string, bad = false) {
    notice = { text, bad };
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (notice = null), bad ? 8000 : 4000);
  }

  const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

  /** Exports the open map, everything under it included. */
  async function exportMap(kind: FileKind) {
    const title = vault.get(mapId)?.title || "Mind map";
    const content = kind === "json" ? toJSON(vault, mapId) : kind === "md" ? toMarkdown(vault, mapId) : toOPML(vault, mapId);
    try {
      const saved = await saveText(title, content, kind);
      if (saved) tell(`Exported as ${saved}`);
    } catch (error) {
      tell(`Not exported: ${reason(error)}`, true);
    }
  }

  /** Brings an OPML or JSON file in, under the selected node. */
  async function importFile() {
    try {
      const text = await openText();
      if (text === null) return;
      const outlines = readOutlines(text);
      if (outlines.length === 0) return tell("The file holds no outline to bring in.", true);
      const parent = selected && vault.isLive(selected) ? selected : mapId;
      const target = vault.get(parent)!;
      // Under a map shown as a portal, it goes in, and the map opens.
      const made = importInto(vault, parent, outlines, target.isMap ? parent : mapId);
      if (target.isMap && parent !== mapId) open(parent);
      selected = made[0].id;
      tell(`Brought in ${made.length === 1 ? `“${made[0].title || "Untitled"}”` : `${made.length} branches`}. ⌘Z takes it out again.`);
    } catch (error) {
      tell(`Not brought in: ${reason(error)}`, true);
    }
  }

  const moreItems = $derived([
    { label: "Export this map as Markdown…", run: () => exportMap("md") },
    { label: "Export this map as OPML…", run: () => exportMap("opml") },
    { label: "Export this map as JSON…", run: () => exportMap("json"), hint: "everything" },
    "line" as const,
    { label: "Import OPML or JSON…", run: importFile, hint: "under the selected node" },
    "line" as const,
    { label: "Trash", run: () => (trashOpen = true) },
    { label: "Settings", run: () => (settingsOpen = true), hint: "⌘," },
  ]);

  /** The map on screen: the one opened, or the nearest map above it if an edit took it away. */
  const mapId = $derived.by(() => {
    void version;
    let node = vault.get(openedMap ?? vault.rootId);
    while (node) {
      if (node.isMap && vault.isLive(node.id)) return node.id;
      node = node.parentId === null ? undefined : vault.get(node.parentId);
    }
    return vault.rootId;
  });
  const canUndo = $derived.by(() => {
    void version;
    return vault.canUndo;
  });
  const canRedo = $derived.by(() => {
    void version;
    return vault.canRedo;
  });
  const breadcrumbs = $derived.by(() => {
    void version;
    return vault.mapPath(mapId);
  });

  function open(id: string) {
    editing = null;
    // Coming back out selects the portal that was gone in by.
    selected = vault.portalToward(id, mapId) ?? id;
    openedMap = id;
  }

  /**
   * Goes to a node found by searching: a map opens; any other node is
   * selected in the map it is in, with the branches above it unfolded.
   */
  function goTo(id: string) {
    searching = false;
    const node = vault.get(id);
    if (!node || !vault.isLive(id)) return;
    if (node.isMap) return open(id);
    const map = vault.mapOf(id)!;
    const above = vault.ancestors(id);
    const folded = above.slice(above.findIndex((n) => n.id === map) + 1).filter((n) => n.collapsed);
    if (folded.length) vault.transact(() => folded.forEach((n) => vault.update(n.id, { collapsed: false })));
    editing = null;
    openedMap = map;
    selected = id;
  }

  /** Links the selected node to `id`, chosen in the palette. */
  function linkTo(id: string) {
    searching = false;
    vault.link(selected ?? mapId, id);
  }

  /** Back out to the map this one is in. */
  function up() {
    const parent = vault.mapOf(mapId);
    if (parent) open(parent);
  }

  function undo(redo = false) {
    // A title being edited is finished first; what was typed is then undone.
    editing = null;
    const changes = redo ? vault.redo() : vault.undo();
    const last = changes?.at(-1)?.after;
    if (last && vault.isLive(last.id)) selected = last.id;
  }

  function onWindowKey(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      // The vault's undo, not a text field's own.
      undo(event.shiftKey);
    } else if (event.key === "ArrowUp" && !event.shiftKey && !event.altKey && !typingIn(event.target)) {
      up();
    } else if (event.key === "\\" && !event.shiftKey) {
      sidebarOpen = !sidebarOpen;
    } else if (event.key === "," && !event.shiftKey) {
      settingsOpen = !settingsOpen;
    } else if (key === "k" && !event.shiftKey) {
      editing = null;
      searching = searching ? false : "go";
    } else if (key === "l" && !event.shiftKey) {
      editing = null;
      searching = searching ? false : "link";
    } else if (key === "n" && event.shiftKey) {
      notesOpen = !notesOpen;
    } else if (key === "1" && !event.shiftKey) {
      view = "map";
    } else if (key === "2" && !event.shiftKey) {
      view = "outline";
    } else {
      return;
    }
    event.preventDefault();
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="app">
  <!-- Clicking a button here leaves the focus where it was, so the map keeps the keyboard. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <header onmousedown={(e) => (e.target as Element).closest("button") && e.preventDefault()}>
    <button class="sidebar-toggle" class:on={sidebarOpen} onclick={() => (sidebarOpen = !sidebarOpen)} title="All maps (⌘\)">
      Maps
    </button>
    <nav aria-label="Breadcrumbs">
      {#each breadcrumbs as map, i (map.id)}
        {#if i > 0}<span class="sep">›</span>{/if}
        <button class="crumb" class:current={map.id === mapId} onclick={() => open(map.id)}>
          {#if map.icon}{map.icon}&nbsp;{/if}{map.title || "Untitled"}
        </button>
      {/each}
    </nav>
    <div class="tools">
      <div class="switch" role="group" aria-label="View">
        <button class:on={view === "map"} onclick={() => (view = "map")} title="Map (⌘1)">Map</button>
        <button class:on={view === "outline"} onclick={() => (view = "outline")} title="Outline (⌘2)">Outline</button>
      </div>
      <button onclick={() => (searching = "go")} title="Search everything (⌘K)">Search</button>
      <button class:on={notesOpen} onclick={() => (notesOpen = !notesOpen)} title="Notes (⇧⌘N)">Notes</button>
      <button onclick={() => undo()} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
      <button onclick={() => undo(true)} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
      <div class="more">
        <button class:on={moreOpen} onclick={() => (moreOpen = !moreOpen)} title="Export, import, trash, settings" aria-label="More">⋯</button>
        {#if moreOpen}
          <MoreMenu items={moreItems} onClose={() => (moreOpen = false)} />
        {/if}
      </div>
    </div>
  </header>

  <div class="body">
    {#if sidebarOpen}
      <MapsSidebar {live} {mapId} onOpen={open} />
    {/if}
    <main>
      {#if view === "map"}
        <MapView {live} {mapId} bind:selected bind:editing onOpen={open} onGoTo={goTo} onShowNotes={() => (notesOpen = true)} />
      {:else}
        <OutlineView {live} {mapId} bind:selected onOpen={open} onUp={up} />
      {/if}
    </main>
    {#if notesOpen}
      <NotesPanel
        {live}
        nodeId={selected ?? mapId}
        centre={(selected ?? mapId) === mapId}
        onClose={() => (notesOpen = false)}
        onGoTo={goTo}
      />
    {/if}
  </div>

  {#if searching}
    <Palette
      {live}
      {mapId}
      purpose={searching}
      exclude={searching === "link" ? (selected ?? mapId) : null}
      onChoose={searching === "link" ? linkTo : goTo}
      onClose={() => (searching = false)}
    />
  {/if}

  {#if trashOpen}
    <TrashDialog {live} onClose={() => (trashOpen = false)} onGoTo={(id) => {
        trashOpen = false;
        goTo(id);
      }} />
  {/if}
  {#if settingsOpen}
    <Settings onClose={() => (settingsOpen = false)} />
  {/if}

  <footer class:failed={live.saveStatus === "failed" || notice?.bad}>
    {#if notice}
      {notice.text}
    {:else if live.saveStatus === "failed"}
      Not saved: {live.saveError}. Trying again…
    {:else if live.saveStatus === "saving"}
      Saving…
    {:else}
      Saved
    {/if}
  </footer>
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--line);
  }

  .sidebar-toggle {
    flex: none;
  }

  nav {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    overflow: hidden;
  }

  .sep {
    color: var(--muted);
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.2rem 0.55rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--accent-soft);
  }

  button:disabled {
    color: var(--muted);
    cursor: default;
  }

  button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .crumb {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crumb.current {
    font-weight: 600;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .more {
    position: relative;
  }

  .switch {
    display: flex;
    padding: 2px;
    margin-right: 0.5rem;
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .switch button {
    padding: 0.1rem 0.6rem;
  }

  .body {
    display: flex;
    min-height: 0;
  }

  main {
    flex: 1;
    min-width: 0;
  }

  footer {
    padding: 0.3rem 1rem;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.8rem;
  }

  footer.failed {
    color: var(--danger);
  }
</style>
