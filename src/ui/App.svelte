<!--
  The window, for now: the open map as an outline, its breadcrumbs, and
  whether everything is saved. It is here to try the vault and its storage
  from end to end; the map itself, drawn as a map, is the next milestone.
-->
<script lang="ts">
  import { tick } from "svelte";
  import type { Node } from "../core/node.ts";
  import type { Live } from "./live.svelte.ts";

  let { live }: { live: Live } = $props();
  const vault = $derived(live.vault);
  const version = $derived(live.version);

  // Null until a map is opened: the top of the vault.
  let openedMap = $state<string | null>(null);

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
  const centre = $derived.by(() => {
    void version;
    return vault.get(mapId)!;
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

  function childrenOf(id: string, _version: number): readonly Node[] {
    // A copy: the vault changes its lists in place, and Svelte would take the
    // same list for no change.
    return [...vault.children(id)];
  }

  async function focusNode(id: string) {
    await tick();
    document.getElementById(`node-${id}`)?.focus();
  }

  function rows(): HTMLInputElement[] {
    return [...document.querySelectorAll<HTMLInputElement>(".outline input")];
  }

  function open(id: string) {
    openedMap = id;
    focusNode(id);
  }

  function toggleMap(node: Node) {
    if (node.parentId === null) return;
    vault.setMap(node.id, !node.isMap);
    focusNode(node.id);
  }

  function onKey(event: KeyboardEvent, node: Node) {
    const isCentre = node.id === mapId;
    const mod = event.metaKey || event.ctrlKey;
    if (event.key === "Enter" && mod) {
      event.preventDefault();
      if (node.isMap && !isCentre) open(node.id);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const added = isCentre ? vault.addChild(node.id) : vault.addSibling(node.id, {}, event.shiftKey);
      focusNode(added.id);
    } else if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      if (node.isMap && !isCentre) return;
      focusNode(vault.addChild(node.id).id);
    } else if (event.key === "Backspace" && node.title === "" && !isCentre) {
      event.preventDefault();
      const list = rows();
      const previous = list[list.indexOf(event.currentTarget as HTMLInputElement) - 1];
      vault.delete(node.id);
      previous?.focus();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const list = rows();
      const i = list.indexOf(event.currentTarget as HTMLInputElement);
      list[event.key === "ArrowUp" ? i - 1 : i + 1]?.focus();
    } else if (mod && event.shiftKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      toggleMap(node);
    }
  }

  function onWindowKey(event: KeyboardEvent) {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod || event.key.toLowerCase() !== "z") return;
    // The vault's undo, not the text field's own.
    event.preventDefault();
    const changes = event.shiftKey ? vault.redo() : vault.undo();
    const last = changes?.at(-1)?.after;
    if (last && vault.isLive(last.id)) focusNode(last.id);
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="app">
  <header>
    <nav aria-label="Maps">
      {#each breadcrumbs as map, i (map.id)}
        {#if i > 0}<span class="sep">›</span>{/if}
        <button class="crumb" class:current={map.id === mapId} onclick={() => open(map.id)}>
          {map.title || "Untitled"}
        </button>
      {/each}
    </nav>
    <div class="tools">
      <button onclick={() => vault.undo()} disabled={!canUndo} title="Undo (⌘Z)">Undo</button>
      <button onclick={() => vault.redo()} disabled={!canRedo} title="Redo (⇧⌘Z)">Redo</button>
    </div>
  </header>

  <main>
    <ul class="outline">
      {@render row(centre, 0)}
    </ul>
  </main>

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

{#snippet row(node: Node, depth: number)}
  {@const isCentre = node.id === mapId}
  {@const portal = node.isMap && !isCentre}
  <li>
    <div class="row" class:centre={isCentre} class:portal style:padding-left="{depth * 22}px">
      <input
        id="node-{node.id}"
        value={node.title}
        placeholder={isCentre ? "Main idea" : "Idea"}
        aria-label="Node title"
        oninput={(e) => vault.update(node.id, { title: e.currentTarget.value }, `title:${node.id}`)}
        onkeydown={(e) => onKey(e, node)}
      />
      {#if portal}
        <button class="open" onclick={() => open(node.id)} title="Open this map (⌘↵)">
          Open map ›
        </button>
      {/if}
      {#if node.parentId !== null && !isCentre}
        <button
          class="make-map"
          onclick={() => toggleMap(node)}
          title={node.isMap ? "Make an ordinary node again (⇧⌘M)" : "Make into a map (⇧⌘M)"}
        >
          {node.isMap ? "Unmap" : "Make map"}
        </button>
      {/if}
    </div>
    {#if !portal}
      {@const children = childrenOf(node.id, version)}
      {#if children.length > 0}
        <ul>
          {#each children as child (child.id)}
            {@render row(child, depth + 1)}
          {/each}
        </ul>
      {/if}
    {/if}
  </li>
{/snippet}

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
    padding: 0.6rem 1rem;
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
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--accent-soft);
  }

  button:disabled {
    color: var(--muted);
    cursor: default;
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
    gap: 0.25rem;
  }

  main {
    overflow: auto;
    padding: 1rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .row input {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.25rem 0.5rem;
    width: min(28rem, 100%);
  }

  .row input:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .row.centre input {
    font-size: 1.3rem;
    font-weight: 600;
  }

  .row.portal input {
    font-weight: 600;
  }

  .row .make-map {
    color: var(--muted);
    font-size: 0.85rem;
    visibility: hidden;
  }

  .row:hover .make-map,
  .row:focus-within .make-map {
    visibility: visible;
  }

  .open {
    color: var(--accent);
    font-size: 0.85rem;
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
