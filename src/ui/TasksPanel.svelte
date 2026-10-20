<!--
  Tasks (⇧⌘T): the tasks still to do in the open map, maps inside it
  included, or in all of them, grouped by the map they are in; the ones done
  fold away at the bottom, the latest first. Ticking works here as on the
  map, and a click on a task goes to it. Worked with the mouse, it leaves
  the keyboard with the map.
-->
<script lang="ts">
  import type { Node } from "../core/node.ts";
  import { tasksUnder } from "../core/tasks.ts";
  import type { Live } from "./live.svelte.ts";

  let {
    live,
    mapId,
    onGoTo,
    onClose,
  }: { live: Live; mapId: string; onGoTo: (id: string) => void; onClose: () => void } = $props();

  let scope = $state<"map" | "all">("map");
  let showDone = $state(false);

  const vault = $derived(live.vault);
  const list = $derived.by(() => {
    void live.version;
    return tasksUnder(vault, scope === "map" ? mapId : vault.rootId);
  });
  const openCount = $derived(list.groups.reduce((n, g) => n + g.open.length, 0));

  /** What a task is under in its map, for telling tasks of the same name apart. */
  function under(node: Node, map: Node): string {
    if (node.parentId === null || node.parentId === map.id) return "";
    return vault.get(node.parentId)?.title ?? "";
  }

  const label = (n: Node) => (n.icon ? `${n.icon} ` : "") + (n.title || "Untitled");
</script>

{#snippet task(node: Node, map: Node)}
  <li class:done={node.task === "done"}>
    <input
      type="checkbox"
      checked={node.task === "done"}
      aria-label="Done"
      tabindex="-1"
      onchange={(e) => vault.tick(node.id, e.currentTarget.checked)}
    />
    <button class="title" tabindex="-1" onclick={() => onGoTo(node.id)} title="Go to it">
      {label(node)}
      {#if under(node, map)}<span class="under">{under(node, map)}</span>{/if}
    </button>
  </li>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside aria-label="Tasks" onmousedown={(e) => e.preventDefault()}>
  <div class="head">
    <h2>Tasks</h2>
    <div class="scope" role="radiogroup" aria-label="Show tasks of">
      <button role="radio" aria-checked={scope === "map"} class:on={scope === "map"} tabindex="-1" onclick={() => (scope = "map")}
        >This map</button
      >
      <button role="radio" aria-checked={scope === "all"} class:on={scope === "all"} tabindex="-1" onclick={() => (scope = "all")}
        >All maps</button
      >
    </div>
    <button class="close" onclick={onClose} tabindex="-1" title="Hide tasks (⇧⌘T)" aria-label="Hide tasks">×</button>
  </div>

  {#if openCount === 0 && list.done.length === 0}
    <p class="empty">No tasks {scope === "map" ? "in this map" : "yet"}. ⌘T makes the selected node a task, and Space ticks it.</p>
  {:else}
    {#if openCount === 0}
      <p class="empty">Everything here is done.</p>
    {/if}
    {#each list.groups as group (group.map.id)}
      <section>
        <button class="map" tabindex="-1" onclick={() => onGoTo(group.map.id)} title="Open this map">
          {label(group.map)} <span class="count">{group.open.length}</span>
        </button>
        <ul>
          {#each group.open as node (node.id)}
            {@render task(node, group.map)}
          {/each}
        </ul>
      </section>
    {/each}
    {#if list.done.length}
      <section class="done-section">
        <button class="map" tabindex="-1" onclick={() => (showDone = !showDone)} aria-expanded={showDone}>
          {showDone ? "▾" : "▸"} Done <span class="count">{list.done.length}</span>
        </button>
        {#if showDone}
          <ul>
            {#each list.done as { node, map } (node.id)}
              {@render task(node, map)}
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
</aside>

<style>
  aside {
    width: 300px;
    padding: 0.7rem 0.6rem 1rem;
    border-left: 1px solid var(--line);
    overflow-y: auto;
    user-select: none;
    -webkit-user-select: none;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
    padding-left: 0.4rem;
  }

  h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .scope {
    display: flex;
    margin-left: auto;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .scope button {
    font-size: 0.78rem;
    padding: 0.05rem 0.5rem;
    color: var(--muted);
  }

  .scope button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .close {
    color: var(--muted);
    font-size: 1.1rem;
    padding: 0 0.3rem;
  }

  section {
    margin-top: 0.6rem;
  }

  .map {
    width: 100%;
    padding: 0.15rem 0.4rem;
    text-align: left;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .map:hover {
    color: var(--fg);
  }

  .count {
    font-weight: normal;
    margin-left: 0.2rem;
  }

  ul {
    list-style: none;
    margin: 0.15rem 0 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0 0.4rem;
    border-radius: 6px;
  }

  li:hover {
    background: var(--accent-soft);
  }

  input {
    flex: none;
    margin: 0;
    cursor: pointer;
  }

  .title {
    flex: 1;
    min-width: 0;
    padding: 0.25rem 0.2rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  li.done .title {
    text-decoration: line-through;
    color: var(--muted);
  }

  .under {
    margin-left: 0.3rem;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .empty {
    margin: 0.4rem;
    color: var(--muted);
    line-height: 1.45;
  }
</style>
