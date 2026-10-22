<!--
  The open map, drawn as a map: nodes placed by the layout, the lines between
  them, panning and zooming, and editing from the keyboard. Each node's size
  is measured in the page and handed to the layout, which places it.
-->
<script lang="ts" module>
  import type { Camera } from "./camera.ts";
  import type { Clip } from "../core/clipboard.ts";
  import type { Picture } from "../core/picture.ts";

  /**
   * What was copied or cut last, with all it carries. The system's clipboard
   * gets its text; a paste whose text is the same is this clip, and comes in
   * whole. Kept here so that it outlives a turn in the outline.
   */
  let clip: Clip | null = null;

  // Each map keeps where it was looked at, for coming back to it, also after
  // a turn in the outline.
  const cameras = new Map<string, Camera>();

  let fitNextMap = false;

  let pictureMaker: ((clear: boolean) => Promise<Picture>) | null = null;

  /** A picture of the open map, with the page's background or a clear one; null when no map is drawn. */
  export function pictureOfMap(clear: boolean): Promise<Picture> | null {
    return pictureMaker?.(clear) ?? null;
  }

  /** Shows the next map drawn whole, as its nodes' sizes come in: the tour, when it opens by itself. */
  export function fitWhenOpened(): void {
    fitNextMap = true;
  }
</script>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { branchBeside, branchColour, newBranch } from "../core/branches.ts";
  import { copyOf, cut as cutBranches, paste } from "../core/clipboard.ts";
  import { fromText } from "../core/exchange.ts";
  import { dropAt, type Drop } from "../core/drop.ts";
  import { layoutMap, SPACING, type Layout, type Placed } from "../core/layout.ts";
  import type { Node, NodeFields } from "../core/node.ts";
  import { indent, outdent, place, placeAll, reorder, setSide, topmost } from "../core/moves.ts";
  import { neighbour, type Direction } from "../core/navigate.ts";
  import { doneToHide, progressUnder, setPriority, tickAll, toggleTasks } from "../core/tasks.ts";
  import { centreOn, fit, reveal, zoomAt } from "./camera.ts";
  import { typingIn } from "./keys.ts";
  import { capture } from "./picture.ts";
  import { readText, writeText } from "./system-clipboard.ts";
  import type { Live } from "./live.svelte.ts";
  import PriorityBadge from "./PriorityBadge.svelte";

  let {
    live,
    mapId,
    hideDone = false,
    selected = $bindable(),
    editing = $bindable(),
    onOpen,
    onGoTo,
    onShowNotes,
    onUp,
  }: {
    live: Live;
    mapId: string;
    /** Done tasks left out, with what is under them, unless open work is. */
    hideDone?: boolean;
    selected: string | null;
    editing: string | null;
    onOpen: (id: string) => void;
    /** Goes to a node anywhere in the vault, as choosing it in search does. */
    onGoTo: (id: string) => void;
    /** Shows the selected node's notes, where its links are listed. */
    onShowNotes: () => void;
    /** Back out to the map this one is in. */
    onUp: () => void;
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

  const leaveOut = $derived.by(() => {
    void live.version;
    return hideDone ? doneToHide(vault, mapId) : new Set<string>();
  });

  const layout = $derived.by(() => {
    void live.version;
    void sizesVersion;
    return layoutMap(vault, mapId, (n) => sizes.get(n.id) ?? estimate(n), leaveOut);
  });

  /**
   * Each node's colour: its own, or else its parent's, down from the
   * branches of the centre, which have one of their own or one by their
   * place. The centre has none. Parents are placed before their children,
   * so one pass over the layout is enough.
   */
  const colours = $derived.by(() => {
    const byNode = new Map<string, string>();
    const branches = vault.children(mapId);
    for (const p of layout.placed) {
      if (p.depth === 0) continue;
      const inherited = p.depth === 1 ? branchColour(branches, p.branch) : byNode.get(p.node.parentId!);
      byNode.set(p.node.id, p.node.color ?? inherited ?? "var(--fg)");
    }
    return byNode;
  });

  /** How far along the tasks under each node of the map are. */
  const progress = $derived.by(() => {
    void live.version;
    return progressUnder(vault, mapId);
  });

  // ---- Selecting several -----------------------------------------------------
  //
  // `selected` is the node the keyboard and the notes work on; `others` are
  // the nodes chosen with it. Deleting, ⌘T, Space and dragging act on all of
  // them; editing a title, the notes panel and ⌥ with the arrows on
  // `selected` alone.

  let others = $state(new Set<string>());

  /** Every node chosen and drawn: `selected` and the others. */
  const chosen = $derived.by(() => {
    const out = new Set<string>();
    for (const id of [selected, ...others]) if (id && layout.byId.has(id)) out.add(id);
    return out;
  });

  /** The chosen nodes that act on their own: a branch goes with its top. */
  const acting = () => topmost(vault, chosen, mapId);

  const single = () => {
    if (others.size) others = new Set();
  };

  // Another map starts with one node chosen; the selected node is never also an other.
  $effect(() => {
    void mapId;
    untrack(single);
  });
  $effect(() => {
    if (selected && untrack(() => others.has(selected!))) {
      const next = new Set(untrack(() => others));
      next.delete(selected);
      others = next;
    }
  });

  /** Adds to the chosen nodes and makes `id` the selected one. */
  function choose(id: string, more: Iterable<string> = []) {
    const next = new Set([...others, ...more]);
    if (selected) next.add(selected);
    next.delete(id);
    others = next;
    selected = id;
  }

  /** A click on a node: alone, or with ⌘ to add or take it out, or with Shift for the siblings between. */
  function clickNode(e: MouseEvent, id: string) {
    if (e.metaKey || e.ctrlKey) {
      if (id === selected) {
        // Taking out the selected node: the last chosen before it takes its place.
        const rest = [...others];
        if (rest.length) {
          selected = rest.at(-1)!;
          others = new Set(rest.slice(0, -1));
        }
      } else if (others.has(id)) {
        const next = new Set(others);
        next.delete(id);
        others = next;
      } else {
        choose(id);
      }
    } else if (e.shiftKey && selected && selected !== id) {
      choose(id, siblingsBetween(selected, id));
    } else {
      // A plain click on a node already chosen keeps the others, to drag
      // them all; letting go without dragging leaves it alone.
      if (!chosen.has(id)) single();
      selected = id;
    }
  }

  /** The siblings shown between two nodes, both included; just `b` if they are not siblings. */
  function siblingsBetween(a: string, b: string): string[] {
    const pa = layout.byId.get(a);
    const pb = layout.byId.get(b);
    if (!pa || !pb || pa.node.parentId !== pb.node.parentId || pa.side !== pb.side) return [b];
    const row = layout.placed.filter((p) => p.node.parentId === pa.node.parentId && p.side === pa.side);
    const [i, j] = [row.indexOf(pa), row.indexOf(pb)].sort((x, y) => x - y);
    return row.slice(i, j + 1).map((p) => p.node.id);
  }

  // Shift and a drag on the background draws a box; what it touches is chosen.
  let box = $state<{ x0: number; y0: number; x1: number; y1: number; before: Set<string> } | null>(null);

  function boxChoose() {
    const b = box!;
    const toMap = (x: number, y: number) => [(x - camera.x) / camera.zoom, (y - camera.y) / camera.zoom];
    const [l, t] = toMap(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1));
    const [r, btm] = toMap(Math.max(b.x0, b.x1), Math.max(b.y0, b.y1));
    const hit = layout.placed
      .filter((p) => p.depth > 0 && p.x < r && p.x + p.width > l && p.y < btm && p.y + p.height > t)
      .map((p) => p.node.id);
    const next = new Set([...b.before, ...hit]);
    if (!selected || !next.has(selected)) {
      const first = hit[0] ?? [...b.before][0];
      if (first) selected = first;
    }
    if (selected) next.delete(selected);
    others = next;
  }

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
          colour: colours.get(p.node.id),
          width: p.depth === 1 ? 3 : 2,
        };
      }),
  );

  /**
   * Links: a dashed curve where both ends are drawn on this map, and the ends
   * that are elsewhere (another map, or folded away), for a sign on the node.
   */
  const links = $derived.by(() => {
    const curves: { id: string; d: string }[] = [];
    const away = new Map<string, string[]>();
    for (const p of layout.placed) {
      for (const to of p.node.links) {
        if (!vault.isLive(to)) continue;
        const q = layout.byId.get(to);
        if (q) curves.push({ id: `${p.node.id}>${to}`, d: linkCurve(p, q) });
        else away.set(p.node.id, [...(away.get(p.node.id) ?? []), to]);
      }
    }
    return { curves, away };
  });

  /**
   * A curve from one node to another: from the facing edges when they are
   * apart sideways, and around the outside when one is above the other.
   */
  function linkCurve(p: Placed, q: Placed): string {
    const y1 = p.y + p.height / 2;
    const y2 = q.y + q.height / 2;
    const pc = p.x + p.width / 2;
    const qc = q.x + q.width / 2;
    if (Math.abs(pc - qc) < (p.width + q.width) / 2) {
      const left = p.side === "left";
      const x1 = left ? p.x : p.x + p.width;
      const x2 = left ? q.x : q.x + q.width;
      const out = left ? Math.min(x1, x2) - 60 : Math.max(x1, x2) + 60;
      return `M${x1},${y1} C${out},${y1} ${out},${y2} ${x2},${y2}`;
    }
    const right = qc > pc;
    const x1 = right ? p.x + p.width : p.x;
    const x2 = right ? q.x : q.x + q.width;
    const dx = Math.max(40, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
    // Bowed away from the centre, above it or below, so that a link across
    // the map does not run along the branches through the middle.
    const bow = Math.min(220, Math.abs(x2 - x1) * 0.35) * ((y1 + y2) / 2 < 0 ? -1 : 1);
    return `M${x1},${y1} C${x1 + dx},${y1 + bow} ${x2 - dx},${y2 + bow} ${x2},${y2}`;
  }

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
    if (e.button !== 0 || (e.target as Element).closest(".node, .zoom, .minimap")) return;
    if (e.shiftKey) {
      const r = viewport.getBoundingClientRect();
      const [x, y] = [e.clientX - r.left, e.clientY - r.top];
      box = { x0: x, y0: y, x1: x, y1: y, before: new Set(chosen) };
      viewport.setPointerCapture(e.pointerId);
      return;
    }
    drag = { x: e.clientX, y: e.clientY, from: camera, moved: false };
  }

  function onPointerMove(e: PointerEvent) {
    if (moving) return dragTo(e);
    if (box) {
      const r = viewport.getBoundingClientRect();
      box.x1 = e.clientX - r.left;
      box.y1 = e.clientY - r.top;
      return boxChoose();
    }
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
    if (moving) return dropNode(e);
    if (box) {
      box = null;
      viewport.releasePointerCapture(e.pointerId);
      return;
    }
    if (!drag) return;
    if (drag.moved) viewport.releasePointerCapture(e.pointerId);
    // A click on the background goes back to one node chosen.
    else single();
    drag = null;
  }

  // ---- Dragging a node -------------------------------------------------------
  //
  // A node dragged follows the pointer as a label, its branch fades, and the
  // map shows where it would land: the node it would go onto, outlined, or a
  // line where it would go beside one (see drop.ts). Letting go puts it
  // there; Escape, or letting go far from everything, leaves it. Near an edge
  // of the view, the map moves by itself, so a node can go anywhere on it.

  /** How near an edge, in pixels, the map starts to follow a dragged node. */
  const EDGE_PX = 48;
  /** How fast it moves with the pointer at the edge or past it, in pixels a second. */
  const EDGE_SPEED = 900;

  let moving = $state<{
    id: string;
    /** All the nodes dragged: the one grabbed, or every chosen one with it. */
    ids: string[];
    /** Whether a plain click on a chosen node, if it ends without a drag, leaves it alone. */
    alone: boolean;
    x: number;
    y: number;
    moved: boolean;
    /** The pointer, in the view. */
    at: { x: number; y: number };
    drop: Drop | null;
  } | null>(null);

  function startMove(e: PointerEvent, node: Node) {
    if (e.button !== 0 || editing === node.id || e.shiftKey || e.metaKey || e.ctrlKey) return;
    if ((e.target as Element).closest(".fold, .editing")) return;
    const group = chosen.has(node.id) && chosen.size > 1;
    // The centre stays; dragging it with others moves the others.
    const ids = group ? acting() : [node.id];
    if (ids.length === 0 || (!group && node.id === mapId)) return;
    moving = {
      id: ids.includes(node.id) ? node.id : ids[0],
      ids,
      alone: group,
      x: e.clientX,
      y: e.clientY,
      moved: false,
      at: { x: 0, y: 0 },
      drop: null,
    };
  }

  function dragTo(e: PointerEvent) {
    const m = moving!;
    if (!m.moved) {
      if (Math.hypot(e.clientX - m.x, e.clientY - m.y) < DRAG_START_PX) return;
      m.moved = true;
      editing = null;
      viewport.setPointerCapture(e.pointerId);
    }
    const r = viewport.getBoundingClientRect();
    m.at = { x: e.clientX - r.left, y: e.clientY - r.top };
    aimDrop(m);
    followEdges();
  }

  /** Where the dragged nodes would land, under the pointer. */
  function aimDrop(m: NonNullable<typeof moving>) {
    m.drop = dropAt(vault, layout, m.ids, (m.at.x - camera.x) / camera.zoom, (m.at.y - camera.y) / camera.zoom);
  }

  /**
   * How hard the pointer pushes against each edge, from -1 to 1: 0 away from
   * the edges, growing to 1 at an edge and past it.
   */
  function edgePush(at: { x: number; y: number }): [number, number] {
    const push = (pos: number, size: number) =>
      pos < EDGE_PX ? Math.min(1, (EDGE_PX - pos) / EDGE_PX) : pos > size - EDGE_PX ? -Math.min(1, (pos - size + EDGE_PX) / EDGE_PX) : 0;
    return [push(at.x, width), push(at.y, height)];
  }

  let edgeFrame = 0;

  /** Moves the map, a frame at a time, while a dragged node is held near an edge. */
  function followEdges() {
    if (edgeFrame) return;
    let last = performance.now();
    const step = (now: number) => {
      const m = moving;
      const [px, py] = m?.moved ? edgePush(m.at) : [0, 0];
      if (!m || (px === 0 && py === 0)) {
        edgeFrame = 0;
        return;
      }
      // By the time passed, so that it moves as fast on any screen; a long
      // pause (the window hidden) does not jump.
      const seconds = Math.min(now - last, 50) / 1000;
      last = now;
      setCamera({ ...camera, x: camera.x + px * EDGE_SPEED * seconds, y: camera.y + py * EDGE_SPEED * seconds });
      aimDrop(m);
      edgeFrame = requestAnimationFrame(step);
    };
    edgeFrame = requestAnimationFrame(step);
  }

  function dropNode(e: PointerEvent) {
    const m = moving!;
    moving = null;
    if (!m.moved) {
      // A click on one of several chosen: it alone is chosen now.
      if (m.alone) single();
      return;
    }
    viewport.releasePointerCapture(e.pointerId);
    if (!m.drop) return;
    const moved = m.ids.length > 1 ? placeAll(vault, m.ids, m.drop, mapId) : place(vault, m.id, m.drop, mapId);
    if (!moved) return;
    // All that moved stay chosen, the one grabbed selected.
    others = new Set(m.ids.filter((id) => id !== m.id));
    selected = m.id;
  }

  /** The dragged node and everything under it, drawn faded while it moves. */
  const movingBranch = $derived.by(() => {
    const out = new Set<string>();
    if (!moving?.moved) return out;
    for (const p of layout.placed) {
      for (let q = p.node; ; ) {
        if (moving.ids.includes(q.id)) {
          out.add(p.node.id);
          break;
        }
        const up = q.parentId ? layout.byId.get(q.parentId)?.node : undefined;
        if (!up) break;
        q = up;
      }
    }
    return out;
  });

  /** Where the line goes when a dragged node would land beside another. */
  const dropLine = $derived.by(() => {
    const beside = moving?.drop?.beside;
    const p = beside && layout.byId.get(beside.id);
    if (!p) return null;
    const gap = (p.depth === 1 ? SPACING.centreBetween : SPACING.between) / 2;
    return { x: p.x, y: beside.after ? p.y + p.height + gap : p.y - gap, width: p.width };
  });

  function zoomBy(factor: number) {
    setCamera(zoomAt(camera, factor, width / 2, height / 2), true);
  }

  // ---- The minimap ---------------------------------------------------------
  //
  // The whole map small, in a corner, with the part on screen outlined. It is
  // shown only when the map does not fit on screen. Clicking or dragging in
  // it brings that part of the map to the middle.

  const MINIMAP = { width: 180, height: 120, margin: 24 };

  /**
   * Below this zoom, nodes past the first level are drawn as bars in their
   * branch's colour: their text is too small to read, and bars keep the
   * shape of the map clear.
   */
  const FAR_ZOOM = 0.55;

  /**
   * Zoomed out, the centre and its branches are drawn larger, up to almost
   * twice, so that their names can still be read. Only the drawing grows; the
   * layout keeps their sizes, and nothing else moves.
   */
  const labelScale = $derived(camera.zoom < FAR_ZOOM ? Math.min(1.8, FAR_ZOOM / camera.zoom) : 1);

  const minimap = $derived.by(() => {
    const b = layout.bounds;
    const m = MINIMAP.margin;
    const box = { x: b.left - m, y: b.top - m, width: b.right - b.left + 2 * m, height: b.bottom - b.top + 2 * m };
    const scale = Math.min(MINIMAP.width / box.width, MINIMAP.height / box.height);
    const view = {
      x: -camera.x / camera.zoom,
      y: -camera.y / camera.zoom,
      width: width / camera.zoom,
      height: height / camera.zoom,
    };
    const fits =
      b.left >= view.x && b.right <= view.x + view.width && b.top >= view.y && b.bottom <= view.y + view.height;
    return { box, scale, view, shown: !fits && width > 0 };
  });

  function onMinimap(e: PointerEvent) {
    if (e.type === "pointerdown") {
      if (e.button !== 0) return;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } else if (!(e.buttons & 1)) {
      return;
    }
    const r = (e.currentTarget as Element).getBoundingClientRect();
    const { box, scale } = minimap;
    const mx = box.x + (e.clientX - r.left) / scale;
    const my = box.y + (e.clientY - r.top) / scale;
    setCamera(centreOn(mx, my, camera.zoom, width, height), e.type === "pointerdown");
  }

  // ---- A picture of the map ---------------------------------------------------

  /**
   * The map's shapes, read off the page. Zoomed far out the map draws bars in
   * place of titles, so it is drawn at its full size for a moment; any glide
   * is ended, so that nothing is caught half way.
   */
  async function makePicture(clear: boolean): Promise<Picture> {
    const before = camera;
    const far = camera.zoom < FAR_ZOOM;
    setCamera(far ? { ...camera, zoom: 1 } : camera);
    await tick();
    // A frame, for the page to draw the change; a hidden window gets none, so not for long.
    await new Promise((r) => {
      requestAnimationFrame(r);
      setTimeout(r, 50);
    });
    try {
      const background = clear ? null : getComputedStyle(viewport).getPropertyValue("--bg").trim() || "#ffffff";
      return capture(layer, camera.zoom, layout.bounds, background);
    } finally {
      if (far) setCamera(before);
    }
  }
  $effect(() => {
    pictureMaker = makePicture;
    return () => {
      if (pictureMaker === makePicture) pictureMaker = null;
    };
  });

  function fitAll() {
    const b = layout.bounds;
    setCamera(fit({ x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top }, width, height), true);
  }

  // Asked for (`fitWhenOpened`): the whole map in view, fitted again as its
  // nodes are measured and the layout settles, until anything is pressed or a
  // moment has passed. A fit made once would be off by the sizes still to come.
  const FIT_FOR_MS = 1500;
  let fitting = $state(fitNextMap);
  fitNextMap = false;
  $effect(() => {
    if (!fitting) return;
    const stop = () => (fitting = false);
    const timer = setTimeout(stop, FIT_FOR_MS);
    const events = ["pointerdown", "keydown", "wheel"];
    for (const type of events) window.addEventListener(type, stop, true);
    return () => {
      clearTimeout(timer);
      for (const type of events) window.removeEventListener(type, stop, true);
    };
  });
  $effect(() => {
    void layout;
    if (fitting && width > 0 && height > 0) untrack(fitAll);
  });

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

  /** Deletes every chosen branch, as one step, and chooses what is left beside the first. */
  function removeChosen() {
    const ids = acting();
    if (ids.length <= 1) return remove(ids[0] ?? selected ?? mapId);
    const next = leftBeside(ids);
    vault.transact(() => ids.forEach((id) => vault.delete(id)));
    others = new Set();
    selected = next;
  }

  /** What to choose once `ids` are gone: a sibling left beside the first, or its parent. */
  function leftBeside(ids: string[]): string {
    const gone = new Set(ids);
    const first = vault.get(ids[0])!;
    const siblings = vault.children(first.parentId!);
    const i = siblings.indexOf(first);
    return (
      siblings.slice(i).find((n) => !gone.has(n.id)) ??
      siblings.slice(0, i).reverse().find((n) => !gone.has(n.id)) ??
      vault.get(first.parentId!)!
    ).id;
  }

  // ---- Copy, cut and paste --------------------------------------------------

  /**
   * Copies the chosen branches, everything under them included; with only
   * the centre chosen, the whole map. Cut takes them away too, to be moved
   * by a paste. The clipboard gets them as an indented list for other apps.
   */
  function copyChosen(cutting: boolean) {
    let ids = acting();
    if (ids.length === 0) {
      if (cutting) return;
      ids = [mapId];
    }
    const next = cutting ? leftBeside(ids) : null;
    clip = cutting ? cutBranches(vault, ids) : copyOf(vault, ids);
    if (next) {
      others = new Set();
      selected = next;
    }
    writeText(clip.text).catch(() => {
      // Without the system's clipboard, a paste in the app still has the clip.
    });
  }

  /**
   * Pastes under the selected node: inside it, if it is a map, and as
   * branches with a side and colour on the centre. What is pasted is chosen.
   * Text from other apps comes in as outlines; a cut is moved, once.
   */
  async function pasteHere() {
    let text = "";
    try {
      text = await readText();
    } catch {
      // No access to the system's clipboard: paste what was copied here.
      text = clip?.text ?? "";
    }
    const from = clip && clip.text === text ? clip : text.trim() ? { text, outlines: fromText(text), cut: null } : null;
    if (!from || from.outlines.length === 0) return;
    const target = selected && layout.byId.has(selected) ? selected : mapId;
    const node = vault.get(target)!;
    const portal = node.isMap && target !== mapId;
    const pasted = vault.transact(() => {
      if (node.collapsed) vault.update(target, { collapsed: false });
      return paste(vault, from, target, portal ? target : mapId);
    });
    // A cut moves once; pasting it again makes copies.
    if (from === clip && clip.cut) clip = { ...clip, cut: null };
    if (portal || pasted.length === 0) return;
    others = new Set(pasted.slice(1).map((n) => n.id));
    selected = pasted[0].id;
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

  /**
   * Edit › Cut, Copy and Paste in the menu bar, which reach the page as these
   * events rather than as keys: on the map they copy and paste branches. The
   * "before" events, cancelled, tell the system the commands can run here.
   */
  function onClipboard(e: ClipboardEvent) {
    if (editing !== null || moving || typingIn(e.target)) return;
    // Text selected on the page, in the notes say, is copied as text.
    if (e.type !== "paste" && e.type !== "beforepaste" && !(window.getSelection()?.isCollapsed ?? true)) return;
    e.preventDefault();
    if (e.type === "copy" || e.type === "cut") copyChosen(e.type === "cut");
    else if (e.type === "paste") pasteHere();
  }
  $effect(() => {
    const before = ["beforecopy", "beforecut", "beforepaste"];
    before.forEach((type) => window.addEventListener(type, onClipboard as EventListener));
    return () => before.forEach((type) => window.removeEventListener(type, onClipboard as EventListener));
  });

  // The map takes the window's keys, not only its own, so that the keys work
  // wherever the focus is: Tab would otherwise move the focus between buttons.
  function onKey(e: KeyboardEvent) {
    if (moving && e.key === "Escape") {
      // Leaves the dragged node where it was.
      moving = null;
      e.preventDefault();
      return;
    }
    if (e.key === "Escape" && others.size && editing === null) {
      // Back to one node chosen.
      single();
      e.preventDefault();
      return;
    }
    if (editing !== null || e.defaultPrevented || typingIn(e.target)) return;
    const id = selected ?? mapId;
    const node = vault.get(id);
    if (!node) return;
    const mod = e.metaKey || e.ctrlKey;
    const isCentre = id === mapId;
    const portal = node.isMap && !isCentre;
    const arrows: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

    if (arrows[e.key] && e.shiftKey && !e.altKey && !mod) {
      // Shift with an arrow adds the next node that way to those chosen.
      const next = neighbour(layout, id, arrows[e.key]);
      if (next) choose(next);
    } else if (mod && !e.shiftKey && !e.altKey && /^Digit[1-5]$/.test(e.code)) {
      // ⌘1 to ⌘5, by the key's place, so that layouts where digits need Shift work too.
      setPriority(vault, [...chosen], Number(e.code.slice(5)));
    } else if (mod && !e.shiftKey && !e.altKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
      copyChosen(e.key.toLowerCase() === "x");
    } else if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "v") {
      pasteHere();
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "a") {
      // Everything in the map but its centre.
      const all = layout.placed.filter((p) => p.depth > 0).map((p) => p.node.id);
      if (all.length) choose(id !== mapId && all.includes(id) ? id : all[0], all);
    } else if (arrows[e.key] && e.altKey && !mod) {
      moveNode(id, arrows[e.key]);
    } else if (arrows[e.key] && !mod) {
      single();
      const next = neighbour(layout, id, arrows[e.key]);
      if (next) selected = next;
    } else if ((e.key === "Enter" || e.key === "ArrowDown") && mod) {
      if (portal) onOpen(id);
    } else if (e.key === "Enter") {
      addSibling(id, e.shiftKey);
    } else if (e.key === "Tab" && !e.shiftKey && !mod) {
      addChild(id);
    } else if ((e.key === "Backspace" || e.key === "Delete") && !mod) {
      removeChosen();
    } else if (e.key === " " && !mod && chosen.size > 1) {
      tickAll(vault, [...chosen]);
    } else if (e.key === " " && !mod && node.task) {
      // Space ticks a task, as it ticks a checkbox; typing or F2 still edits it.
      vault.tick(id);
    } else if ((e.key === "F2" || e.key === " ") && !mod) {
      startEdit(id, node.title);
    } else if (mod && !e.shiftKey && e.key.toLowerCase() === "t") {
      if (chosen.size > 1) toggleTasks(vault, [...chosen]);
      else vault.toggleTask(id);
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
    // Focus inside a frame scrolls the page around it to the frame, which
    // would carry the website down to its demo as it loads; the cover's
    // click gives the demo the focus instead.
    if (window.parent === window) viewport.focus();
  });
</script>

<svelte:window
  onkeydown={onKey}
  oncopy={onClipboard}
  oncut={onClipboard}
  onpaste={onClipboard}
/>

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
    class:far={camera.zoom < FAR_ZOOM}
    style:transform="translate({camera.x}px, {camera.y}px) scale({camera.zoom})"
  >
    <svg class="edges" aria-hidden="true">
      <defs>
        <marker id="link-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0,1 L9,5 L0,9 z" class="link-arrow" />
        </marker>
      </defs>
      {#each links.curves as link (link.id)}
        <path d={link.d} class="link" marker-end="url(#link-arrow)" />
      {/each}
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
        class:own-colour={node.color !== null}
        class:done={node.task === "done"}
        class:selected={chosen.has(node.id)}
        class:primary={selected === node.id && chosen.size > 1}
        class:left={p.side === "left"}
        class:moving={movingBranch.has(node.id)}
        class:drop-onto={moving?.drop?.onto === node.id}
        data-id={node.id}
        use:measure
        style:transform="translate({Math.round(p.x)}px, {Math.round(p.y)}px){p.depth <= 1 && labelScale > 1
          ? ` scale(${labelScale})`
          : ''}"
        style:--branch={colours.get(node.id) ?? "var(--fg)"}
        onmousedown={(e) => clickNode(e, node.id)}
        onpointerdown={(e) => startMove(e, node)}
        ondblclick={() => (portal ? onOpen(node.id) : startEdit(node.id, node.title))}
        role="treeitem"
        aria-selected={selected === node.id}
        tabindex="-1"
      >
        {#if isCentre && node.parentId !== null}
          {@const outer = vault.mapOf(node.id)}
          <button
            class="up"
            tabindex="-1"
            title="Back to {(outer && vault.get(outer)?.title) || 'the map around it'} (⌘↑)"
            aria-label="Back to the map around it"
            onmousedown={(e) => e.preventDefault()}
            onpointerdown={(e) => e.stopPropagation()}
            ondblclick={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              onUp();
            }}
          >
            <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
              <path d="M6 10V2.5M2.8 5.5 6 2.3l3.2 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        {/if}
        {#if node.task}
          <button
            class="check"
            class:ticked={node.task === "done"}
            role="checkbox"
            aria-checked={node.task === "done"}
            tabindex="-1"
            title={node.task === "done" ? "Done: click to undo (Space)" : "Tick it done (Space)"}
            onmousedown={(e) => e.preventDefault()}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              vault.tick(node.id);
            }}>{node.task === "done" ? "✓" : ""}</button
          >
        {/if}
        {#if node.priority}<PriorityBadge priority={node.priority} />{/if}
        {#if node.icon}<span class="icon" aria-hidden="true">{node.icon}</span>{/if}
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
        {#if progress.has(node.id)}
          {@const p = progress.get(node.id)!}
          <span class="progress" class:all-done={p.done === p.total} title="{p.done} of {p.total} tasks under it done"
            >{p.done}/{p.total}</span
          >
        {/if}
        {#if node.body.trim()}
          <button
            class="note"
            tabindex="-1"
            title="Show its notes (⇧⌘N)"
            aria-label="Show its notes"
            onmousedown={(e) => e.preventDefault()}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              selected = node.id;
              onShowNotes();
            }}>≡</button
          >
        {/if}
        {#if links.away.has(node.id)}
          {@const targets = links.away.get(node.id)!}
          <button
            class="away"
            tabindex="-1"
            title={targets.length === 1
              ? `Go to “${vault.get(targets[0])?.title || "Untitled"}”`
              : `${targets.length} links elsewhere: show them`}
            onmousedown={(e) => e.preventDefault()}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={(e) => {
              e.stopPropagation();
              if (targets.length === 1) onGoTo(targets[0]);
              else {
                selected = node.id;
                onShowNotes();
              }
            }}
          >
            ↗{targets.length > 1 ? ` ${targets.length}` : ""}
          </button>
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

    {#if dropLine}
      <div
        class="drop-line"
        style:transform="translate({dropLine.x}px, {dropLine.y - 1.5}px)"
        style:width="{dropLine.width}px"
      ></div>
    {/if}
  </div>

  {#if moving?.moved}
    <div class="drag-label" style:transform="translate({moving.at.x + 12}px, {moving.at.y + 8}px)">
      {vault.get(moving.id)?.title || "Idea"}{moving.ids.length > 1 ? ` and ${moving.ids.length - 1} more` : ""}
    </div>
  {/if}

  {#if box}
    <div
      class="box"
      style:left="{Math.min(box.x0, box.x1)}px"
      style:top="{Math.min(box.y0, box.y1)}px"
      style:width="{Math.abs(box.x1 - box.x0)}px"
      style:height="{Math.abs(box.y1 - box.y0)}px"
    ></div>
  {/if}

  {#if minimap.shown}
    {@const { box, scale, view } = minimap}
    <svg
      class="minimap"
      width={box.width * scale}
      height={box.height * scale}
      viewBox="{box.x} {box.y} {box.width} {box.height}"
      role="img"
      aria-label="The whole map, with the part on screen outlined"
      onpointerdown={onMinimap}
      onpointermove={onMinimap}
    >
      {#each layout.placed as p (p.node.id)}
        <rect
          x={p.x}
          y={p.y}
          width={p.width}
          height={p.height}
          rx={p.height / 2}
          fill={p.depth === 0 ? "var(--fg)" : (colours.get(p.node.id) ?? "var(--muted)")}
          opacity={p.depth === 0 ? 0.9 : p.depth === 1 ? 0.8 : 0.45}
        />
      {/each}
      <rect
        class="seen"
        x={view.x}
        y={view.y}
        width={view.width}
        height={view.height}
        vector-effect="non-scaling-stroke"
      />
    </svg>
  {/if}

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

  .node.leaf.own-colour .text {
    color: var(--branch);
  }

  .icon {
    flex: none;
  }

  /* The selection ring, 2px outside the border. It is a box of its own rather
     than an outline: WebKit, at zooms that are not whole numbers, left bits of
     an outline behind as a node grew while its title was typed. */
  .node.selected::after {
    content: "";
    position: absolute;
    /* The border (2px), a gap (2px) and the ring (2px), outside the padding box. */
    inset: -6px;
    border: 2px solid var(--accent);
    border-radius: 11px;
    pointer-events: none;
  }

  /* A node clicked keeps the page's focus while the arrow keys move the
     selection, and the browser rings it once a key is pressed. The map draws
     its own selection and takes the keys for the whole window, so a node
     never shows the browser's focus ring. */
  .node:focus {
    outline: none;
  }

  .node.leaf:hover:not(.selected) {
    background: var(--accent-soft);
  }

  /* Zoomed out: the text keeps its place, so sizes and the layout stay the same. */
  .layer.far .node.leaf {
    background: var(--branch);
    opacity: 0.45;
  }

  .layer.far .node.leaf > :global(*) {
    visibility: hidden;
  }

  .layer.far .node.centre,
  .layer.far .node.branch {
    z-index: 1;
  }

  .layer.far .node.leaf.selected {
    opacity: 0.9;
  }

  .node.moving {
    opacity: 0.3;
  }

  .node.drop-onto {
    outline: 2px dashed var(--accent);
    outline-offset: 3px;
  }

  .drop-line {
    position: absolute;
    left: 0;
    top: 0;
    height: 3px;
    border-radius: 2px;
    background: var(--accent);
    pointer-events: none;
  }

  .node.primary {
    box-shadow: 0 0 0 5px var(--accent-soft);
  }

  .box {
    position: absolute;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    pointer-events: none;
  }

  .drag-label {
    position: absolute;
    left: 0;
    top: 0;
    max-width: 240px;
    padding: 3px 9px;
    border-radius: 7px;
    background: var(--accent);
    color: var(--bg);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.25);
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

  .edges .link {
    fill: none;
    stroke: var(--accent);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
    opacity: 0.8;
  }

  .edges .link-arrow {
    fill: var(--accent);
  }

  .away {
    font: inherit;
    font-size: 0.8em;
    color: var(--accent);
    background: none;
    border: none;
    border-radius: 4px;
    padding: 0 0.2rem;
    cursor: pointer;
  }

  .away:hover {
    background: var(--accent-soft);
  }

  /* On the centre of a map inside another: the way back out, by mouse. */
  .up {
    flex: none;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    margin-left: -8px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--bg) 18%, transparent);
    color: var(--bg);
    cursor: pointer;
  }

  .up:hover {
    background: color-mix(in srgb, var(--bg) 32%, transparent);
  }

  .check {
    flex: none;
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    padding: 0;
    border: 1.5px solid var(--branch);
    border-radius: 4px;
    background: var(--bg);
    color: var(--bg);
    font: 700 10px/1 system-ui, sans-serif;
    cursor: pointer;
  }

  .check.ticked {
    background: var(--branch);
  }

  .node.centre .check {
    border-color: var(--bg);
  }

  .node.done .text {
    text-decoration: line-through;
    opacity: 0.55;
  }

  .progress {
    font-size: 0.75em;
    font-variant-numeric: tabular-nums;
    padding: 0 0.3em;
    border-radius: 999px;
    border: 1px solid currentColor;
    opacity: 0.55;
    white-space: nowrap;
  }

  .progress.all-done {
    opacity: 0.35;
  }

  .inside {
    font-size: 0.8em;
    opacity: 0.6;
    white-space: nowrap;
  }

  .note {
    font: inherit;
    font-size: 0.8em;
    color: inherit;
    opacity: 0.6;
    background: none;
    border: none;
    border-radius: 4px;
    padding: 0 0.2rem;
    cursor: pointer;
  }

  .note:hover {
    opacity: 1;
    background: var(--accent-soft);
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

  .minimap {
    position: absolute;
    left: 12px;
    bottom: 12px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg);
    cursor: pointer;
    touch-action: none;
  }

  .minimap .seen {
    fill: var(--accent);
    fill-opacity: 0.08;
    stroke: var(--accent);
    stroke-width: 1.5;
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
