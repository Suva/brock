<!--
  The sidebar on the left: lists of places in the vault to go to, as tabs,
  the maps (⌃⌘S) and the tasks (⇧⌘T). The right side is for the selected
  node; this side is for the vault. It is worked with the mouse and leaves
  the keyboard with the map.
-->
<script lang="ts">
  import type { Live } from "./live.svelte.ts";
  import MapsList from "./MapsList.svelte";
  import TasksList from "./TasksList.svelte";

  export type Tab = "maps" | "tasks";

  let {
    live,
    mapId,
    width,
    tab,
    onTab,
    onClose,
    onOpen,
    onGoTo,
  }: {
    live: Live;
    mapId: string;
    width: number;
    tab: Tab;
    onTab: (tab: Tab) => void;
    onClose: () => void;
    onOpen: (id: string) => void;
    onGoTo: (id: string) => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside aria-label="Sidebar" style:width="{width}px" onmousedown={(e) => e.preventDefault()}>
  <div class="tabs" role="tablist" aria-label="Show">
    <button role="tab" aria-selected={tab === "maps"} class:on={tab === "maps"} tabindex="-1" onclick={() => onTab("maps")} title="All maps (⌃⌘S)"
      >Maps</button
    >
    <button role="tab" aria-selected={tab === "tasks"} class:on={tab === "tasks"} tabindex="-1" onclick={() => onTab("tasks")} title="Tasks (⇧⌘T)"
      >Tasks</button
    >
    <button class="close" tabindex="-1" onclick={onClose} title="Hide the sidebar (⌃⌘S)" aria-label="Hide the sidebar">‹</button>
  </div>
  <div class="content" role="tabpanel">
    {#if tab === "maps"}
      <MapsList {live} {mapId} {onOpen} />
    {:else}
      <TasksList {live} {mapId} {onGoTo} />
    {/if}
  </div>
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    flex: none;
    border-right: 1px solid var(--line);
    min-height: 0;
    user-select: none;
    -webkit-user-select: none;
  }

  .tabs {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.5rem 0.5rem 0.4rem;
  }

  button {
    font: inherit;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 6px;
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }

  button:hover {
    color: var(--fg);
  }

  button.on {
    color: var(--accent);
    background: var(--accent-soft);
    font-weight: 600;
  }

  .close {
    margin-left: auto;
    font-size: 1.1rem;
    padding: 0 0.4rem;
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 0.4rem 1rem;
  }
</style>
