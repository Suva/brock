<!--
  The open map as an indented list: the same nodes as the map, for reading
  through and restructuring quickly. Every title is a text field.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { indent, outdent, reorder } from "../core/moves.ts";
  import type { Node } from "../core/node.ts";
  import { typingIn } from "./keys.ts";
  import type { Live } from "./live.svelte.ts";

  let {
    live,
    mapId,
    selected = $bindable(),
    onOpen,
  }: { live: Live; mapId: string; selected: string | null; onOpen: (id: string) => void } = $props();

  const vault = $derived(live.vault);
  const centre = $derived.by(() => {
    void live.version;
    return vault.get(mapId)!;
  });

  function childrenOf(id: string, _version: number): readonly Node[] {
    // A copy: the vault changes its lists in place, and Svelte would take the
    // same list for no change.
    return [...vault.children(id)];
  }

  async function focusNode(id: string) {
    await tick();
    document.getElementById(`row-${id}`)?.focus();
  }

  function rows(): HTMLInputElement[] {
    return [...document.querySelectorAll<HTMLInputElement>(".outline input")];
  }

  function onKey(event: KeyboardEvent, node: Node) {
    const isCentre = node.id === mapId;
    const mod = event.metaKey || event.ctrlKey;
    const where = { centreId: mapId, columns: false };
    const moves: Record<string, () => boolean> = {
      ArrowUp: () => reorder(vault, node.id, -1, where),
      ArrowDown: () => reorder(vault, node.id, 1, where),
      ArrowLeft: () => outdent(vault, node.id, where),
      ArrowRight: () => indent(vault, node.id, where),
    };
    if (event.altKey && !mod && moves[event.key]) {
      event.preventDefault();
      // The row is moved in the page, which can take the focus from it.
      if (moves[event.key]()) focusNode(node.id);
    } else if (event.key === "Enter" && mod) {
      event.preventDefault();
      if (node.isMap && !isCentre) onOpen(node.id);
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
      if (!isCentre) vault.setMap(node.id, !node.isMap);
      focusNode(node.id);
    }
  }

  $effect(() => {
    focusNode(selected ?? mapId);
  });

  // Keys pressed with the focus elsewhere, after a click on a button say,
  // bring it back to the selected row rather than moving it around the window.
  function onWindowKey(e: KeyboardEvent) {
    if (e.defaultPrevented || typingIn(e.target) || e.metaKey || e.ctrlKey) return;
    if (!["Tab", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    focusNode(selected ?? mapId);
  }
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="scroll">
  <ul class="outline">
    {@render row(centre, 0)}
  </ul>
</div>

{#snippet row(node: Node, depth: number)}
  {@const isCentre = node.id === mapId}
  {@const portal = node.isMap && !isCentre}
  <li>
    <div class="row" class:centre={isCentre} class:portal style:padding-left="{depth * 22}px">
      <input
        id="row-{node.id}"
        value={node.title}
        placeholder={isCentre ? "Main idea" : "Idea"}
        aria-label="Node title"
        oninput={(e) => vault.update(node.id, { title: e.currentTarget.value }, `title:${node.id}`)}
        onkeydown={(e) => onKey(e, node)}
        onfocus={() => (selected = node.id)}
      />
      {#if portal}
        <button class="open" onclick={() => onOpen(node.id)} title="Open this map (⌘↵)">Open map ›</button>
      {/if}
    </div>
    {#if !portal}
      {@const children = childrenOf(node.id, live.version)}
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
  .scroll {
    height: 100%;
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

  .open {
    font: inherit;
    font-size: 0.85rem;
    color: var(--accent);
    background: none;
    border: none;
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
    cursor: pointer;
  }

  .open:hover {
    background: var(--accent-soft);
  }
</style>
