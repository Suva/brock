<!--
  The open map as an indented list: the same nodes as the map, for reading
  through and restructuring quickly. Every title is a text field.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { branchBeside, newBranch } from "../core/branches.ts";
  import { doneToHide, setPriority } from "../core/tasks.ts";
  import { flagGlyph, flagName } from "../core/attention.ts";
  import PriorityBadge from "./PriorityBadge.svelte";
  import { indent, outdent, place, reorder } from "../core/moves.ts";
  import { outlineDropAt, type Drop, type Row } from "../core/drop.ts";
  import type { Node } from "../core/node.ts";
  import { typingIn } from "./keys.ts";
  import type { Live } from "./live.svelte.ts";

  let {
    live,
    mapId,
    hideDone = false,
    selected = $bindable(),
    onOpen,
    onUp,
  }: {
    live: Live;
    mapId: string;
    /** Done tasks left out, as on the map. */
    hideDone?: boolean;
    selected: string | null;
    onOpen: (id: string) => void;
    /** Back out to the map this one is in. */
    onUp: () => void;
  } = $props();

  const vault = $derived(live.vault);
  const centre = $derived.by(() => {
    void live.version;
    return vault.get(mapId)!;
  });

  const leaveOut = $derived.by(() => {
    void live.version;
    return hideDone ? doneToHide(vault, mapId) : new Set<string>();
  });

  function childrenOf(id: string, _version: number): readonly Node[] {
    // A copy: the vault changes its lists in place, and Svelte would take the
    // same list for no change.
    return vault.children(id).filter((n) => !leaveOut.has(n.id));
  }

  async function focusNode(id: string) {
    await tick();
    document.getElementById(`row-${id}`)?.focus();
  }

  function rows(): HTMLInputElement[] {
    // The title fields only, not the checkboxes of tasks.
    return [...document.querySelectorAll<HTMLInputElement>(".outline input:not([type='checkbox'])")];
  }

  /**
   * The row just made, and where it was made from: the row then, in the map
   * open then. Escape while it is still empty takes it back and returns there.
   */
  let fresh: { id: string; from: string; fromMap: string } | null = null;

  function made(added: Node, from: string, fromMap: string) {
    fresh = { id: added.id, from, fromMap };
    focusNode(added.id);
  }

  const mac = navigator.platform.startsWith("Mac");

  /**
   * The keys held to move a row with the arrows: ⌥ (Alt), as on the map. On
   * a Mac that takes ⌥← and ⌥→ from the titles, which jump by word with
   * them; titles are short, and ⌥⇧ still selects by word, as Shift is left
   * to the text. ⌃⌘, which moved rows on a Mac before, still does.
   */
  function moveKeys(e: KeyboardEvent): boolean {
    if (e.shiftKey) return false;
    const alt = e.altKey && !e.ctrlKey && !e.metaKey;
    return alt || (mac && e.ctrlKey && e.metaKey && !e.altKey);
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
    if (moveKeys(event) && moves[event.key]) {
      event.preventDefault();
      // The row is moved in the page, which can take the focus from it.
      if (moves[event.key]()) focusNode(node.id);
    } else if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault();
      if (outdent(vault, node.id, where)) focusNode(node.id);
    } else if (mod && !event.shiftKey && !event.altKey && /^Digit[1-5]$/.test(event.code)) {
      event.preventDefault();
      setPriority(vault, [node.id], Number(event.code.slice(5)));
    } else if (mod && !event.shiftKey && event.key.toLowerCase() === "t") {
      event.preventDefault();
      vault.toggleTask(node.id);
    } else if ((event.key === "Enter" || event.key === "ArrowDown") && mod) {
      event.preventDefault();
      if (node.isMap && !isCentre) onOpen(node.id);
    } else if (event.key === "ArrowUp" && mod) {
      event.preventDefault();
      onUp();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const added = isCentre
        ? vault.addChild(node.id, newBranch(vault.children(node.id)))
        : vault.addSibling(node.id, node.parentId === mapId ? branchBeside(vault.children(mapId), node) : {}, event.shiftKey);
      made(added, node.id, mapId);
    } else if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      if (node.isMap && !isCentre) {
        // A new node under a map goes into it: open the map and add it there.
        const from = mapId;
        onOpen(node.id);
        made(vault.addChild(node.id, newBranch(vault.children(node.id))), node.id, from);
        return;
      }
      made(vault.addChild(node.id, isCentre ? newBranch(vault.children(node.id)) : {}), node.id, mapId);
    } else if (event.key === "Escape" && fresh?.id === node.id && node.title === "") {
      event.preventDefault();
      const { from, fromMap } = fresh;
      fresh = null;
      if (!vault.cancelCreation(node.id)) return;
      // Made by going into a map: come back out, to the map gone into.
      if (fromMap !== mapId && vault.isLive(fromMap)) onOpen(fromMap);
      else focusNode(vault.isLive(from) ? from : mapId);
    } else if (event.key === "Backspace" && node.title === "" && !isCentre) {
      event.preventDefault();
      const list = rows();
      const previous = list[list.indexOf(event.currentTarget as HTMLInputElement) - 1];
      vault.delete(node.id);
      previous?.focus();
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !event.altKey && !event.shiftKey && !mod) {
      // With Shift held they stay with the text, selecting.
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

  /** Movement under this, in pixels, is a click on the handle, not a drag. */
  const DRAG_START_PX = 3;
  /** How near the top or bottom of the list a drag scrolls it along. */
  const EDGE_PX = 40;

  let scroller: HTMLDivElement;
  /** A row being dragged by its handle, and where it would land. */
  let dragging = $state<{ id: string; x: number; y: number; moved: boolean; drop: Drop | null } | null>(null);

  /** The rows as drawn now, read off the page. */
  function drawnRows(): Row[] {
    return [...scroller.querySelectorAll<HTMLElement>(".row")].map((el) => {
      const box = el.getBoundingClientRect();
      return {
        id: el.dataset.id!,
        parentId: el.dataset.parent || null,
        top: box.top,
        height: box.height,
        open: el.dataset.open === "true",
      };
    });
  }

  function grab(e: PointerEvent, node: Node) {
    if (e.button !== 0) return;
    // Keeps the focus, and the text, where they are.
    e.preventDefault();
    dragging = { id: node.id, x: e.clientX, y: e.clientY, moved: false, drop: null };
  }

  function drag(e: PointerEvent) {
    if (!dragging) return;
    if (!dragging.moved) {
      if (Math.hypot(e.clientX - dragging.x, e.clientY - dragging.y) < DRAG_START_PX) return;
      dragging.moved = true;
    }
    const box = scroller.getBoundingClientRect();
    if (e.clientY < box.top + EDGE_PX) scroller.scrollTop -= 12;
    else if (e.clientY > box.bottom - EDGE_PX) scroller.scrollTop += 12;
    dragging.drop = outlineDropAt(vault, drawnRows(), dragging.id, e.clientY);
  }

  function letGo() {
    const d = dragging;
    dragging = null;
    if (!d) return;
    if (d.moved && d.drop) place(vault, d.id, d.drop, mapId);
    selected = d.id;
    focusNode(d.id);
  }

  /** The rows that show where the dragged one would land, and how. */
  const target = $derived.by(() => {
    const drop = dragging?.drop;
    if (!drop) return { onto: null, before: null, after: null, under: false };
    return {
      onto: drop.onto,
      // After a row, first under it: the line is indented one step more.
      under: drop.beside?.id === drop.parentId,
      before: drop.beside && !drop.beside.after ? drop.beside.id : null,
      after: drop.beside?.after ? drop.beside.id : null,
    };
  });

  /** Whether `id` is the dragged row or under it, drawn faded. */
  function inDragged(id: string, _version: number): boolean {
    if (!dragging?.moved) return false;
    return id === dragging.id || vault.ancestors(id).some((n) => n.id === dragging!.id);
  }

  // Keys pressed with the focus elsewhere, after a click on a button say,
  // bring it back to the selected row rather than moving it around the window.
  function onWindowKey(e: KeyboardEvent) {
    if (dragging && e.key === "Escape") {
      // Leaves the row where it was.
      e.preventDefault();
      const id = dragging.id;
      dragging = null;
      focusNode(id);
      return;
    }
    if (e.defaultPrevented || typingIn(e.target) || e.metaKey || e.ctrlKey) return;
    if (!["Tab", "Enter", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    focusNode(selected ?? mapId);
  }
</script>

<!-- The whole window, as a quick drag leaves the handle at once. -->
<svelte:window
  onkeydown={onWindowKey}
  onpointermove={drag}
  onpointerup={letGo}
  onpointercancel={() => (dragging = null)}
/>

<div class="scroll" class:dragging={dragging?.moved} bind:this={scroller}>
  <ul class="outline">
    {@render row(centre, 0)}
  </ul>
</div>

{#snippet row(node: Node, depth: number)}
  {@const isCentre = node.id === mapId}
  {@const portal = node.isMap && !isCentre}
  <li class:moving={inDragged(node.id, live.version)}>
    <div
      class="row"
      class:centre={isCentre}
      class:portal
      class:onto={target.onto === node.id}
      class:before={target.before === node.id}
      class:after={target.after === node.id}
      class:under={target.after === node.id && target.under}
      data-id={node.id}
      data-parent={node.parentId ?? ""}
      data-open={!portal}
      style:--indent="{depth * 22}px"
    >
      {#if isCentre}
        <span class="grip-room"></span>
      {:else}
        <!-- Dragged, never focused: the keys stay with the row's title. -->
        <span
          class="grip"
          role="presentation"
          title={mac ? "Drag to move, or ⌥ and the arrows" : "Drag to move, or Alt and the arrows"}
          onpointerdown={(e) => grab(e, node)}
        >⠿</span>
      {/if}
      {#if node.task}
        <input
          type="checkbox"
          class="check"
          checked={node.task === "done"}
          aria-label="Done"
          tabindex="-1"
          onchange={(e) => vault.tick(node.id, e.currentTarget.checked)}
        />
      {/if}
      {#if node.priority}<span class="priority"><PriorityBadge priority={node.priority} /></span>{/if}
      {#if node.flag}<span class="flag {node.flag}" title={flagName(node.flag)} role="img" aria-label={flagName(node.flag)}>{flagGlyph(node.flag)}</span>{/if}
      {#if node.icon}<span class="icon" aria-hidden="true">{node.icon}</span>{/if}
      <input
        id="row-{node.id}"
        class="title"
        class:done={node.task === "done"}
        value={node.title}
        placeholder={isCentre ? "Main idea" : "Idea"}
        aria-label="Node title"
        oninput={(e) => vault.update(node.id, { title: e.currentTarget.value }, `title:${node.id}`)}
        onkeydown={(e) => onKey(e, node)}
        onfocus={() => (selected = node.id)}
      />
      {#if portal}
        <button class="open" onclick={() => onOpen(node.id)} title="Open this map (⌘↓)">Open map ›</button>
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
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding-left: var(--indent);
    border-radius: 6px;
  }

  /* The handle a row is dragged by, shown where the pointer is. */
  .grip,
  .grip-room {
    flex: none;
    width: 1rem;
    margin-right: -0.3rem;
    text-align: center;
  }

  .grip {
    color: var(--muted);
    cursor: grab;
    opacity: 0;
    touch-action: none;
    user-select: none;
  }

  .row:hover .grip,
  .row:focus-within .grip {
    opacity: 1;
  }

  .scroll.dragging,
  .scroll.dragging * {
    cursor: grabbing;
  }

  .scroll.dragging .grip {
    opacity: 0;
  }

  li.moving {
    opacity: 0.4;
  }

  .row.onto {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  /* A line where the row will go, from where its title would start. */
  .row.before::after,
  .row.after::after {
    content: "";
    position: absolute;
    left: calc(var(--indent) + 1rem);
    width: min(28rem, calc(100% - var(--indent) - 1rem));
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }

  .row.before::after {
    top: -1px;
  }

  .row.after::after {
    bottom: -1px;
  }

  .row.after.under::after {
    left: calc(var(--indent) + 22px + 1rem);
  }

  .icon,
  .priority {
    margin-left: 0.4rem;
  }

  .flag {
    flex: none;
    margin-left: 0.4rem;
    font-size: 0.85em;
  }

  .flag.ok {
    color: var(--ok);
  }

  .flag.attention {
    color: var(--warning);
  }

  .flag.critical {
    color: var(--danger);
  }

  .priority {
    display: flex;
  }

  /* The title fields only: a task's checkbox is an input too. */
  .row input.title {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.25rem 0.5rem;
    width: min(28rem, 100%);
  }

  .check {
    flex: none;
    margin: 0 0 0 0.5rem;
  }

  .row input.title.done {
    text-decoration: line-through;
    opacity: 0.55;
  }

  .row input.title:focus {
    outline: none;
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  .row.centre input.title {
    font-size: 1.3rem;
    font-weight: 600;
  }

  .row.portal input.title {
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
