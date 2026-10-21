<!--
  Tasks, in the sidebar's Tasks tab (⇧⌘T): the tasks still to do in the open
  map, maps inside it included, or in all of them, grouped by the map they
  are in; the ones done fold away at the bottom, grouped by when they were
  done (today, yesterday, this week, earlier), each group with its own Clear.
  Ticking works here as on the map, and a click on a task goes to it.
-->
<script lang="ts">
  import type { Node } from "../core/node.ts";
  import { onMount } from "svelte";
  import { clearDone, groupDone, tasksUnder, type DoneWhen } from "../core/tasks.ts";
  import PriorityBadge from "./PriorityBadge.svelte";
  import type { Live } from "./live.svelte.ts";

  let {
    live,
    mapId,
    onGoTo,
  }: { live: Live; mapId: string; onGoTo: (id: string) => void } = $props();

  let scope = $state<"map" | "all">("map");
  let showDone = $state(false);

  const vault = $derived(live.vault);
  const list = $derived.by(() => {
    void live.version;
    return tasksUnder(vault, scope === "map" ? mapId : vault.rootId);
  });
  const openCount = $derived(list.groups.reduce((n, g) => n + g.open.length, 0));

  // The time the groups are reckoned from, moved on every minute so that
  // today's tasks become yesterday's at midnight without anything else changing.
  let now = $state(Date.now());
  onMount(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });
  const doneGroups = $derived(groupDone(list.done, now, weekStart()));

  /** The day weeks start on where this computer is set up: Monday in most of the world. */
  function weekStart(): number {
    try {
      const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
        getWeekInfo?: () => { firstDay: number };
        weekInfo?: { firstDay: number };
      };
      // 1 for Monday to 7 for Sunday; Date counts Sunday as 0.
      const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
      return first ? first % 7 : 1;
    } catch {
      return 1;
    }
  }

  const top = () => (scope === "map" ? mapId : vault.rootId);
  const where = () => (scope === "map" ? "of this map" : "of all maps");

  /** Clears the done tasks of one group, or all of them. */
  function clear(when?: DoneWhen) {
    const ids = new Set((when ? doneGroups.find((g) => g.when === when)?.items ?? [] : list.done).map((d) => d.node.id));
    clearDone(vault, top(), (node) => ids.has(node.id));
  }

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
      {#if node.priority}<PriorityBadge priority={node.priority} />{/if}
      {label(node)}
      {#if under(node, map)}<span class="under">{under(node, map)}</span>{/if}
    </button>
  </li>
{/snippet}

<div class="tasks">
  <div class="scope" role="radiogroup" aria-label="Show tasks of">
      <button role="radio" aria-checked={scope === "map"} class:on={scope === "map"} tabindex="-1" onclick={() => (scope = "map")}
        >This map</button
      >
      <button role="radio" aria-checked={scope === "all"} class:on={scope === "all"} tabindex="-1" onclick={() => (scope = "all")}
        >All maps</button
      >
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
        <div class="done-head">
          <button class="map" tabindex="-1" onclick={() => (showDone = !showDone)} aria-expanded={showDone}>
            {showDone ? "▾" : "▸"} Done <span class="count">{list.done.length}</span>
          </button>
          <button
            class="clear"
            tabindex="-1"
            onclick={() => clear()}
            title="Move all the done tasks {where()} to the trash; ⌘Z brings them back. Done tasks with open ones under them stay."
            >Clear all</button
          >
        </div>
        {#if showDone}
          {#each doneGroups as group (group.when)}
            <div class="when">
              <h3>{group.label} <span class="count">{group.items.length}</span></h3>
              <button
                class="clear"
                tabindex="-1"
                onclick={() => clear(group.when)}
                title="Move the tasks {where()} done {group.label === 'Earlier' ? 'before this week' : group.label.toLowerCase()} to the trash; ⌘Z brings them back. A done task stays while one done at another time, or an open one, is under it."
                >Clear</button
              >
            </div>
            <ul>
              {#each group.items as { node, map } (node.id)}
                {@render task(node, map)}
              {/each}
            </ul>
          {/each}
        {/if}
      </section>
    {/if}
  {/if}
</div>

<style>
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  .scope {
    display: inline-flex;
    margin: 0 0.4rem 0.2rem;
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

  .done-head {
    display: flex;
    align-items: center;
  }

  .done-head .map {
    flex: 1;
    width: auto;
  }

  .clear {
    flex: none;
    margin-right: 0.3rem;
    padding: 0.1rem 0.45rem;
    font-size: 0.75rem;
    color: var(--muted);
  }

  .when {
    display: flex;
    align-items: center;
    margin-top: 0.4rem;
  }

  h3 {
    flex: 1;
    margin: 0;
    padding: 0.1rem 0.4rem 0.1rem 1.2rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted);
  }

  .clear:hover {
    color: var(--danger);
    background: var(--accent-soft);
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
