<!--
  A thin handle on the inner edge of a side panel, placed in the body that
  holds both: drag it to change the panel's width, arrow keys do the same.
  `edge` is the side of the body the panel is on, which says where the handle
  goes and which way a drag makes it wider.
-->
<script lang="ts">
  let {
    width,
    edge,
    min = 220,
    max = 640,
    onResize,
    onClose,
  }: {
    width: number;
    edge: "left" | "right";
    min?: number;
    max?: number;
    onResize: (width: number) => void;
    /** Dragged well past the narrowest the panel goes: it is put away. */
    onClose: () => void;
  } = $props();

  /** How far under the narrowest width a drag goes before it closes the panel. */
  const CLOSE_BEYOND = 60;

  let dragging = $state(false);
  let from = { x: 0, width: 0 };

  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));

  function down(e: PointerEvent) {
    from = { x: e.clientX, width };
    dragging = true;
    e.currentTarget instanceof HTMLElement && e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function move(e: PointerEvent) {
    if (!dragging) return;
    // Placed from the window's left edge (the sidebar), going right widens; from the right edge (the notes), going left does.
    const dx = e.clientX - from.x;
    const wanted = from.width + (edge === "left" ? dx : -dx);
    if (wanted < min - CLOSE_BEYOND) {
      dragging = false;
      onClose();
    } else onResize(clamp(wanted));
  }

  function key(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    e.stopPropagation();
    const wider = (e.key === "ArrowRight") === (edge === "left");
    onResize(clamp(width + (wider ? 16 : -16)));
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="resizer"
  style="{edge}: {width - 4}px"
  class:dragging
  role="separator"
  aria-orientation="vertical"
  aria-label="Resize the panel"
  aria-valuenow={width}
  aria-valuemin={min}
  aria-valuemax={max}
  tabindex="-1"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  onkeydown={key}
></div>

<style>
  .resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    z-index: 3;
    cursor: col-resize;
    touch-action: none;
  }

  
  .resizer::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 3px;
    width: 1px;
    background: transparent;
  }

  .resizer:hover::after,
  .resizer.dragging::after {
    background: var(--accent);
    width: 2px;
    left: 2px;
  }
</style>
