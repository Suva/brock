<!--
  The window: the breadcrumbs of the open map, the map drawn as a map or as an
  outline, the selected node's notes, and whether everything is saved.
-->
<script lang="ts">
  import { typingIn } from "./keys.ts";
  import type { Live } from "./live.svelte.ts";
  import MapView from "./MapView.svelte";
  import NotesPanel from "./NotesPanel.svelte";
  import Palette from "./Palette.svelte";
  import OutlineView from "./OutlineView.svelte";

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
  let searching = $state(false);

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
    } else if (key === "k" && !event.shiftKey) {
      editing = null;
      searching = !searching;
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
    <nav aria-label="Maps">
      {#each breadcrumbs as map, i (map.id)}
        {#if i > 0}<span class="sep">›</span>{/if}
        <button class="crumb" class:current={map.id === mapId} onclick={() => open(map.id)}>
          {map.title || "Untitled"}
        </button>
      {/each}
    </nav>
    <div class="tools">
      <div class="switch" role="group" aria-label="View">
        <button class:on={view === "map"} onclick={() => (view = "map")} title="Map (⌘1)">Map</button>
        <button class:on={view === "outline"} onclick={() => (view = "outline")} title="Outline (⌘2)">Outline</button>
      </div>
      <button onclick={() => (searching = true)} title="Search everything (⌘K)">Search</button>
      <button class:on={notesOpen} onclick={() => (notesOpen = !notesOpen)} title="Notes (⇧⌘N)">Notes</button>
      <button onclick={() => undo()} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
      <button onclick={() => undo(true)} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
    </div>
  </header>

  <div class="body">
    <main>
      {#if view === "map"}
        <MapView {live} {mapId} bind:selected bind:editing onOpen={open} />
      {:else}
        <OutlineView {live} {mapId} bind:selected onOpen={open} onUp={up} />
      {/if}
    </main>
    {#if notesOpen}
      <NotesPanel {live} nodeId={selected ?? mapId} onClose={() => (notesOpen = false)} />
    {/if}
  </div>

  {#if searching}
    <Palette {live} {mapId} onChoose={goTo} onClose={() => (searching = false)} />
  {/if}

  <footer class:failed={live.saveStatus === "failed"}>
    {#if live.saveStatus === "failed"}
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

  nav {
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
