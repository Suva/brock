<!--
  Every map of the vault as a tree, beside the open map (⌘\). The map open
  and the maps above it are shown unfolded; clicking a map opens it. It is
  worked with the mouse and never takes the keyboard, which stays with the
  map; ⌘K, narrowed to maps, is the way there from the keyboard.
-->
<script lang="ts">
  import { mapTree, type MapEntry } from "../core/overview.ts";
  import type { Live } from "./live.svelte.ts";

  let { live, mapId, onOpen }: { live: Live; mapId: string; onOpen: (id: string) => void } = $props();

  const tree = $derived.by(() => {
    void live.version;
    return mapTree(live.vault);
  });

  /** Maps whose maps are shown. The way to the open map is always unfolded. */
  let unfolded = $state(new Set<string>());
  const onTheWay = $derived(new Set(live.vault.mapPath(mapId).map((n) => n.id)));

  const rows = $derived.by(() => {
    const out: { entry: MapEntry; depth: number; open: boolean }[] = [];
    const add = (entry: MapEntry, depth: number) => {
      const open = depth === 0 || unfolded.has(entry.node.id) || onTheWay.has(entry.node.id);
      out.push({ entry, depth, open });
      if (open) for (const inner of entry.maps) add(inner, depth + 1);
    };
    add(tree, 0);
    return out;
  });

  function toggle(id: string) {
    const next = new Set(unfolded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    unfolded = next;
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside aria-label="Maps" onmousedown={(e) => e.preventDefault()}>
  <h2>Maps</h2>
  <ul role="tree" aria-label="Maps">
    {#each rows as { entry, depth, open } (entry.node.id)}
      <li
        role="treeitem"
        aria-selected={entry.node.id === mapId}
        aria-expanded={entry.maps.length ? open : undefined}
        class:current={entry.node.id === mapId}
        style:padding-left="{8 + depth * 14}px"
      >
        {#if entry.maps.length && depth > 0}
          <button
            class="twisty"
            tabindex="-1"
            aria-label={open ? "Fold" : "Unfold"}
            disabled={onTheWay.has(entry.node.id) && entry.node.id !== mapId}
            onclick={() => toggle(entry.node.id)}
          >
            {open ? "▾" : "▸"}
          </button>
        {:else}
          <span class="twisty"></span>
        {/if}
        <button class="name" tabindex="-1" onclick={() => onOpen(entry.node.id)} title="Open this map">
          {entry.node.title || "Untitled"}
        </button>
        <span class="size" title="{entry.size} {entry.size === 1 ? 'node' : 'nodes'}">{entry.size}</span>
      </li>
    {/each}
  </ul>
</aside>

<style>
  aside {
    width: 240px;
    padding: 0.6rem 0.4rem;
    border-right: 1px solid var(--line);
    overflow-y: auto;
    user-select: none;
    -webkit-user-select: none;
  }

  h2 {
    margin: 0 0 0.4rem;
    padding: 0 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    padding-right: 0.5rem;
    border-radius: 6px;
  }

  li:hover {
    background: var(--accent-soft);
  }

  li.current {
    background: var(--accent-soft);
  }

  li.current .name {
    color: var(--accent);
    font-weight: 600;
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }

  .twisty {
    flex: none;
    width: 16px;
    padding: 0;
    font-size: 0.7rem;
    color: var(--muted);
    text-align: center;
  }

  .twisty:disabled {
    cursor: default;
  }

  .name {
    flex: 1;
    min-width: 0;
    padding: 0.25rem 0.2rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .size {
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
