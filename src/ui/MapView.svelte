<!--
  The open map, drawn as a map: nodes placed by the layout, the lines between
  them, panning and zooming, and editing from the keyboard. Each node's size
  is measured in the page and handed to the layout, which places it.
-->
<script lang="ts" module>
  import type { Camera } from "./camera.ts";

  // Each map keeps where it was looked at, for coming back to it, also after
  // a turn in the outline.
  const cameras = new Map<string, Camera>();
</script>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { branchBeside, branchColour, newBranch } from "../core/branches.ts";
  import { layoutMap, type Layout } from "../core/layout.ts";
  import type { Node, NodeFields } from "../core/node.ts";
  import { indent, outdent, reorder, setSide } from "../core/moves.ts";
  import { neighbour, type Direction } from "../core/navigate.ts";
  import { centreOn, fit, reveal, zoomAt } from "./camera.ts";
  import { typingIn } from "./keys.ts";
  import type { Live } from "./live.svelte.ts";

  let {
    live,
    mapId,
    selected = $bindable(),
    editing = $bindable(),
    onOpen,
  }: {
    live: Live;
    mapId: string;
    selected: string | null;
    editing: string | null;
    onOpen: (id: string) => void;
  } = $props();

  const vault = $derived(live.vault);

  /** Movement under this is a click, not a drag. */
  const DRAG_START_PX = 3;

  // ---- Sizes and layout ----------------------------------------------------

  const sizes = new Map<string, { width: number; height: number }>();
  let sizesVersion = $state(0);
  const observer = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const id = el.dataset.id!;
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      const old = sizes.get(id);
      if (!old || old.width !== size.width || old.height !== size.height) {
        sizes.set(id, size);
        changed = true;
      }
    }
    if (changed) sizesVersion++;
  });

  function measure(el: HTMLElement) {
    observer.observe(el);
    return { destroy: () => observer.unobserve(el) };
  }

  /** A guess at a node's size until it has been measured, so it starts near its place. */
  function estimate(node: Node) {
    const chars = Math.max(4, node.title.length);
    return node.id === mapId
      ? { width: Math.min(360, chars * 11 + 40), height: 46 }
      : { width: Math.min(280, chars * 8 + 26), height: 30 };
  }

  const layout = $derived.by(() => {
    void live.version;
    void sizesVersion;
    return layoutMap(vault, mapId, (n) => sizes.get(n.id) ?? estimate(n));
  });

  const colours = $derived.by(() => {
    const byBranch = new Map<number, string>();
    for (const p of layout.placed) {
      if (p.depth === 1) byBranch.set(p.branch, branchColour(vault.children(mapId), p.branch));
    }
    return byBranch;
  });

  /** A curve from each parent's outer edge to its child's inner edge. */
  const edges = $derived(
    layout.placed
      .filter((p) => p.depth > 0)
      .map((p) => {
        const parent = layout.byId.get(p.node.parentId!)!;
        const right = p.side === "right";
        const x1 = right ? parent.x + parent.width : parent.x;
        const y1 = parent.y + parent.height / 2;
        const x2 = right ? p.x : p.x + p.width;
        const y2 = p.y + p.height / 2;
        const mx = (x1 + x2) / 2;
        return {
          id: p.node.id,
          d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`,
          colour: colours.get(p.branch),
          width: p.depth === 1 ? 3 : 2,
        };
      }),
  );

  // ---- The camera ----------------------------------------------------------

  let viewport: HTMLDivElement;
  let width = $state(0);
  let height = $state(0);
  let camera = $state<Camera>({ x: 0, y: 0, zoom: 1 });
  /** Set while the camera moves by itself, so it glides there. */
  let gliding = $state(false);
  let glideTimer: ReturnType<typeof setTimeout> | undefined;

  function setCamera(next: Camera, glide = false) {
    camera = next;
    clearTimeout(glideTimer);
    gliding = glide;
    if (glide) glideTimer = setTimeout(() => (gliding = false), 260);
  }

  let cameraOf: string | null = null;
  $effect(() => {
    const id = mapId;
    if (width === 0 || height === 0) return;
    untrack(() => {
      if (cameraOf === id) return;
      if (cameraOf !== null) cameras.set(cameraOf, camera);
      cameraOf = id;
      setCamera(cameras.get(id) ?? centreOn(0, 0, 1, width, height));
      if (entering) enter(entering);
      entering = null;
    });
  });

  /** A map opened to add a node in it; the node is added once the map is open. */
  let addOnOpen: { mapId: string; from: string; fromMap: string } | null = null;
  $effect(() => {
    const id = mapId;
    untrack(() => {
      if (addOnOpen?.mapId !== id) return;
      const { from, fromMap } = addOnOpen;
      addOnOpen = null;
      const node = vault.transact(() => {
        if (vault.get(id)!.collapsed) vault.update(id, { collapsed: false });
        return vault.addChild(id, newBranch(vault.children(id)));
      });
      editFresh(node.id, { from, fromMap });
    });
  });

  // Leaving for the outline keeps where this map was looked at.
  $effect(() => () => {
    if (cameraOf !== null) cameras.set(cameraOf, untrack(() => camera));
  });

  // ---- Going into a map and back out -----------------------------------------
  //
  // Opening a map zooms into its portal while the map it was in fades away,
  // and the new map grows into view. Going back zooms out of the map left
  // while the map around it settles in, from its portal outwards. The map
  // left is a copy of its picture, taken just before the page changes.

  const TRANSITION_MS = 320;
  let layer: HTMLDivElement;
  /** What is on screen, kept for the moment the map changes. */
  let shown: { mapId: string; layout: Layout; camera: Camera } | null = null;
  /** How the next map comes in: grown into from its portal, or out of one of its own. */
  let entering: { kind: "in" } | { kind: "out"; portalId: string } | null = null;

  $effect(() => {
    shown = { mapId, layout, camera };
  });

  const transform = (c: Camera) => `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`;
  const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** The middle of a node on screen. */
  function screenMiddle(layout: Layout, id: string, c: Camera): [number, number] {
    const p = layout.byId.get(id);
    if (!p) return [width / 2, height / 2];
    return [(p.x + p.width / 2) * c.zoom + c.x, (p.y + p.height / 2) * c.zoom + c.y];
  }

  $effect.pre(() => {
    const next = mapId;
    untrack(() => {
      const from = shown;
      if (!from || from.mapId === next || !layer || width === 0 || reducedMotion()) return;
      const goingIn = vault.portalToward(from.mapId, next);
      const goingOut = vault.portalToward(next, from.mapId);

      // The map being left, as it looks now, zoomed into the portal or away.
      const ghost = layer.cloneNode(true) as HTMLElement;
      ghost.classList.remove("gliding");
      ghost.classList.add("ghost");
      viewport.appendChild(ghost);
      const to = goingIn
        ? zoomAt(from.camera, 3, ...screenMiddle(from.layout, goingIn, from.camera))
        : zoomAt(from.camera, 0.4, width / 2, height / 2);
      ghost
        .animate([{ transform: transform(from.camera), opacity: 1 }, { transform: transform(to), opacity: 0 }], {
          duration: TRANSITION_MS,
          easing: "ease-in",
        })
        .finished.finally(() => ghost.remove());

      entering = goingIn ? { kind: "in" } : goingOut ? { kind: "out", portalId: goingOut } : { kind: "in" };
    });
  });

  /** Brings the new map in, once its camera is set. */
  function enter(how: NonNullable<typeof entering>) {
    const target = camera;
    const start =
      how.kind === "in"
        ? zoomAt(target, 0.5, width / 2, height / 2)
        : zoomAt(target, 3, ...screenMiddle(layout, how.portalId, target));
    layer.animate([{ transform: transform(start), opacity: 0 }, { transform: transform(target), opacity: 1 }], {
      duration: TRANSITION_MS,
      easing: "ease-out",
    });
  }

  // Keep the selected node in view, as it changes and as the map moves around it.
  $effect(() => {
    const p = layout.byId.get(selected ?? "");
    if (!p || width === 0) return;
    const current = untrack(() => camera);
    const next = reveal(current, p, width, height);
    if (next !== current) setCamera(next, true);
  });

  // The selection falls back to the centre when its node is no longer drawn.
  $effect(() => {
    if (!selected || !layout.byId.has(selected)) selected = mapId;
  });

  $effect(() => {
    const el = viewport;
    const at = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    // Pinching a trackpad comes as a wheel with Ctrl held in Chromium.
    // Wheels and trackpads otherwise pan.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        setCamera(zoomAt(camera, Math.exp(-e.deltaY * unit * 0.01), ...at(e)));
      } else {
        setCamera({ ...camera, x: camera.x - e.deltaX * unit, y: camera.y - e.deltaY * unit });
      }
    };
    // ...and as gestures in WebKit, the engine on macOS and Linux.
    let scale = 1;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      scale = 1;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      setCamera(zoomAt(camera, g.scale / scale, ...at(g)));
      scale = g.scale;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  });

  // Dragging the background pans.
  let drag: { x: number; y: number; from: Camera; moved: boolean } | null = null;

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || (e.target as Element).closest(".node, .zoom")) return;
    drag = { x: e.clientX, y: e.clientY, from: camera, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_START_PX) return;
      // Captured only now, so that a click stays a click.
      drag.moved = true;
      viewport.setPointerCapture(e.pointerId);
    }
    setCamera({ ...drag.from, x: drag.from.x + dx, y: drag.from.y + dy });
  }

  function onPointerUp(e: PointerEvent) {
    if (!drag) return;
    if (drag.moved) viewport.releasePointerCapture(e.pointerId);
    drag = null;
  }

  function zoomBy(factor: number) {
    setCamera(zoomAt(camera, factor, width / 2, height / 2), true);
  }

  function fitAll() {
    const b = layout.bounds;
    setCamera(fit({ x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }, width, height), true);
  }

  // ---- Editing -------------------------------------------------------------

  /** The text a title editor starts with: the title, or the key that started it. */
  let editStart = "";

  function select(id: string) {
    selected = id;
  }

  /**
   * The node just made and being given its first title, and where the making
   * started: the node selected then, in the map open then. Escape while it is
   * still empty takes it back and returns there.
   */
  let fresh: { id: string; from: string; fromMap: string } | null = null;

  function startEdit(id: string, text: string) {
    const node = vault.get(id);
    if (!node) return;
    if (fresh?.id !== id) fresh = null;
    if (text !== node.title) vault.update(id, { title: text }, `title:${id}`);
    editStart = text;
    selected = id;
    editing = id;
  }

  async function stopEditing() {
    if (editing === null) return;
    editing = null;
    fresh = null;
    await tick();
    viewport?.focus();
  }

  /** Puts the text in a title editor, focuses it and the caret at its end. */
  function editor(el: HTMLElement) {
    el.textContent = editStart;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function onEditInput(e: Event, id: string) {
    const text = ((e.currentTarget as HTMLElement).textContent ?? "").replace(/\n/g, " ");
    vault.update(id, { title: text }, `title:${id}`);
  }

  /** Takes back a new node left empty, and goes back to where it was started from. */
  function cancelFresh(id: string): boolean {
    const made = fresh;
    if (made?.id !== id || vault.get(id)?.title !== "" || !vault.cancelCreation(id)) return false;
    fresh = null;
    if (made.fromMap !== mapId && vault.isLive(made.fromMap)) {
      // Made by going into a map: come back out, to the map gone into.
      editing = null;
      onOpen(made.fromMap);
    } else {
      selected = vault.isLive(made.from) ? made.from : mapId;
      stopEditing();
    }
    return true;
  }

  function onEditKey(e: KeyboardEvent, node: Node) {
    if (e.key === "Escape" && cancelFresh(node.id)) {
      e.preventDefault();
    } else if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      stopEditing();
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      addChild(node.id);
    }
  }

  function addChild(parentId: string) {
    const parent = vault.get(parentId)!;
    if (parent.isMap && parentId !== mapId) {
      // A new node under a map goes into it: open the map, then add it there.
      addOnOpen = { mapId: parentId, from: selected ?? parentId, fromMap: mapId };
      onOpen(parentId);
      return;
    }
    const fields: Partial<NodeFields> = parentId === mapId ? newBranch(vault.children(parentId)) : {};
    const node = vault.transact(() => {
      if (parent.collapsed) vault.update(parentId, { collapsed: false });
      return vault.addChild(parentId, fields);
    });
    editFresh(node.id, { from: selected ?? parentId, fromMap: mapId });
  }

  /** Starts the first title of a node just made. */
  function editFresh(id: string, origin: { from: string; fromMap: string }) {
    fresh = { id, ...origin };
    startEdit(id, "");
  }

  function addSibling(id: string, before: boolean) {
    const node = vault.get(id)!;
    if (id === mapId) return addChild(id);
    // A sibling of a branch of the centre goes on the same side.
    const fields = node.parentId === mapId ? branchBeside(vault.children(mapId), node) : {};
    editFresh(vault.addSibling(id, fields, before).id, { from: id, fromMap: mapId });
  }

  function remove(id: string) {
    const node = vault.get(id)!;
    if (id === mapId || node.parentId === null) return;
    const siblings = vault.children(node.parentId);
    const i = siblings.indexOf(node);
    const next = siblings[i + 1] ?? siblings[i - 1] ?? vault.get(node.parentId)!;
    vault.delete(id);
    selected = next.id;
  }

  function toggleFold(node: Node) {
    if (node.id === mapId || vault.children(node.id).length === 0) return;
    vault.update(node.id, { collapsed: !node.collapsed });
  }

  /** Alt with the arrow keys moves the selected node instead of the selection. */
  function moveNode(id: string, direction: Direction) {
    const where = { centreId: mapId, columns: true };
    if (direction === "up" || direction === "down") return reorder(vault, id, direction === "up" ? -1 : 1, where);
    const side = layout.byId.get(id)?.side;
    if (!side) return false;
    // Outwards is away from the centre: right on the right side, left on the left.
    if (direction === side) return indent(vault, id, where);
    // Inwards from a child of the centre crosses to the other side.
    if (vault.get(id)!.parentId === mapId) return setSide(vault, id, direction, mapId);
    return outdent(vault, id, where);
  }

  // The map takes the window's keys, not only its own, so that the keys work
  // wherever the focus is: Tab would otherwise move the focus between buttons.
  function onKey(e: KeyboardEvent) {
    if (editing !== null || e.defaultPrevented || typingIn(e.target)) return;
    const id = selected ?? mapId;
    const node = vault.get(id);
    if (!node) return;
    const mod = e.metaKey || e.ctrlKey;
    const isCentre = id === mapId;
    const portal = node.isMap && !isCentre;
    const arrows: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

    if (arrows[e.key] && e.altKey && !mod) {
      moveNode(id, arrows[e.key]);
    } else if (arrows[e.key] && !mod) {
      const next = neighbour(layout, id, arrows[e.key]);
      if (next) selected = next;
    } else if ((e.key === "Enter" || e.key === "ArrowDown") && mod) {
      if (portal) onOpen(id);
    } else if (e.key === "Enter") {
      addSibling(id, e.shiftKey);
    } else if (e.key === "Tab" && !e.shiftKey && !mod) {
      addChild(id);
    } else if ((e.key === "Backspace" || e.key === "Delete") && !mod) {
      remove(id);
    } else if ((e.key === "F2" || e.key === " ") && !mod) {
      startEdit(id, node.title);
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "m") {
      if (!isCentre) vault.setMap(id, !node.isMap);
    } else if (mod && e.key === "/") {
      toggleFold(node);
    } else if (mod && (e.key === "=" || e.key === "+")) {
      zoomBy(1.25);
    } else if (mod && e.key === "-") {
      zoomBy(0.8);
    } else if (mod && e.key === "0") {
      fitAll();
    } else if (e.key.length === 1 && !mod && !e.altKey) {
      // Typing on a selected node replaces its title, as in a spreadsheet.
      startEdit(id, e.key);
    } else {
      return;
    }
    e.preventDefault();
  }

  $effect(() => {
    viewport.focus();
  });
</script>

<svelte:window onkeydown={onKey} />

<div
  class="viewport"
  bind:this={viewport}
  bind:clientWidth={width}
  bind:clientHeight={height}
  tabindex="0"
  role="tree"
  aria-label="Mind map"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
>
  <div
    class="layer"
    bind:this={layer}
    class:gliding
    style:transform="translate({camera.x}px, {camera.y}px) scale({camera.zoom})"
  >
    <svg class="edges" aria-hidden="true">
      {#each edges as edge (edge.id)}
        <path d={edge.d} stroke={edge.colour} stroke-width={edge.width} fill="none" stroke-linecap="round" />
      {/each}
    </svg>

    {#each layout.placed as p (p.node.id)}
      {@const node = p.node}
      {@const isCentre = p.depth === 0}
      {@const portal = node.isMap && !isCentre}
      {@const kids = isCentre || portal ? 0 : vault.children(node.id).length}
      <div
        class="node"
        class:centre={isCentre}
        class:branch={p.depth === 1}
        class:leaf={p.depth >= 2}
        class:portal
        class:selected={selected === node.id}
        class:left={p.side === "left"}
        data-id={node.id}
        use:measure
        style:transform="translate({Math.round(p.x)}px, {Math.round(p.y)}px)"
        style:--branch={colours.get(p.branch) ?? "var(--fg)"}
        onmousedown={() => select(node.id)}
        ondblclick={() => (portal ? onOpen(node.id) : startEdit(node.id, node.title))}
        role="treeitem"
        aria-selected={selected === node.id}
        tabindex="-1"
      >
        {#if editing === node.id}
          <span
            class="text editing"
            contenteditable="plaintext-only"
            role="textbox"
            tabindex="0"
            spellcheck="false"
            use:editor
            oninput={(e) => onEditInput(e, node.id)}
            onkeydown={(e) => onEditKey(e, node)}
            onblur={() => {
              // Moving on to a new node's editor takes the focus from this one
              // after the new one has started; that must not end it.
              if (editing === node.id) stopEditing();
            }}
          ></span>
        {:else}
          <span class="text" class:placeholder={!node.title}>{node.title || (isCentre ? "Main idea" : "Idea")}</span>
        {/if}
        {#if node.body.trim()}
          <span class="note" title="Has notes">≡</span>
        {/if}
        {#if portal}
          <span class="inside" title="A map with {p.hidden} {p.hidden === 1 ? 'node' : 'nodes'} under its centre">
            ⧉ {p.hidden}
          </span>
        {/if}
        {#if kids > 0}
          <button
            class="fold"
            class:folded={node.collapsed}
            tabindex="-1"
            title={node.collapsed ? `Show ${kids} hidden (⌘/)` : "Fold away (⌘/)"}
            aria-label={node.collapsed ? "Unfold" : "Fold"}
            onmousedown={(e) => e.preventDefault()}
            onclick={(e) => {
              e.stopPropagation();
              toggleFold(node);
            }}
          >
            {node.collapsed ? kids : ""}
          </button>
        {/if}
      </div>
    {/each}
  </div>

  <div class="zoom">
    <button onclick={() => zoomBy(0.8)} title="Zoom out (⌘−)" aria-label="Zoom out">−</button>
    <button onclick={fitAll} title="Show the whole map (⌘0)">{Math.round(camera.zoom * 100)}%</button>
    <button onclick={() => zoomBy(1.25)} title="Zoom in (⌘+)" aria-label="Zoom in">+</button>
  </div>
</div>

<style>
  .viewport {
    position: relative;
    overflow: hidden;
    height: 100%;
    outline: none;
    cursor: default;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
  }

  .layer {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 0 0;
  }

  :global(.layer.ghost) {
    pointer-events: none;
  }

  .layer.gliding {
    transition: transform 0.25s ease;
  }

  .edges {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    overflow: visible;
    pointer-events: none;
  }

  .node {
    position: absolute;
    left: 0;
    top: 0;
    /* Absolute elements otherwise shrink to the layer, which has no width. */
    width: max-content;
    max-width: 280px;
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 4px 9px;
    border-radius: 7px;
    border: 2px solid transparent;
    background: var(--bg);
    font-size: 14px;
    line-height: 1.35;
    overflow-wrap: anywhere;
    cursor: default;
  }

  .node.centre {
    max-width: 360px;
    padding: 10px 20px;
    border-radius: 14px;
    background: var(--fg);
    color: var(--bg);
    font-size: 18px;
    font-weight: 650;
  }

  .node.branch {
    padding: 5px 12px;
    border-color: var(--branch);
    font-size: 15px;
    font-weight: 600;
  }

  .node.portal {
    /* A stack of cards: there is more inside. */
    box-shadow:
      3px 3px 0 -1px var(--bg),
      3px 3px 0 1px var(--branch),
      6px 6px 0 -1px var(--bg),
      6px 6px 0 1px var(--branch);
    border-color: var(--branch);
  }

  .node.leaf.portal {
    font-weight: 600;
  }

  .node.selected {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .node.leaf:hover:not(.selected) {
    background: var(--accent-soft);
  }

  .text {
    min-width: 1ch;
    white-space: pre-wrap;
  }

  .text.placeholder {
    opacity: 0.45;
  }

  .text.editing {
    outline: none;
    cursor: text;
    user-select: text;
    -webkit-user-select: text;
  }

  .note,
  .inside {
    font-size: 0.8em;
    opacity: 0.6;
    white-space: nowrap;
  }

  .fold {
    position: absolute;
    left: 100%;
    margin-left: 4px;
    top: 50%;
    transform: translateY(-50%);
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    border: 1.5px solid var(--branch);
    background: var(--bg);
    color: var(--fg);
    font: 600 9px/1 system-ui, sans-serif;
    cursor: pointer;
    opacity: 0;
  }

  .node.left .fold {
    left: auto;
    right: 100%;
    margin-left: 0;
    margin-right: 4px;
  }

  .node:hover .fold,
  .node.selected .fold,
  .fold.folded {
    opacity: 1;
  }

  .zoom {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
  }

  .zoom button {
    font: inherit;
    font-size: 12px;
    color: var(--fg);
    background: none;
    border: none;
    border-radius: 6px;
    padding: 3px 8px;
    min-width: 28px;
    cursor: pointer;
  }

  .zoom button:hover {
    background: var(--accent-soft);
  }
</style>
