<!--
  The "⋯" menu in the header: exporting the open map, bringing an outline in
  under the selected node, the trash and settings. Arrow keys move through
  it, Enter chooses, Escape closes.
-->
<script lang="ts">
  type Item = { label: string; run: () => void; hint?: string } | "line";

  let {
    items,
    onClose,
    align = "right",
  }: { items: Item[]; onClose: () => void; /** Which edge of its button the menu lines up with. */ align?: "left" | "right" } = $props();

  let menu: HTMLDivElement;
  const buttons = () => [...menu.querySelectorAll<HTMLButtonElement>("button")];

  function onKey(e: KeyboardEvent) {
    const list = buttons();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  $effect(() => {
    buttons()[0]?.focus();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="away" onclick={onClose}></div>
<div class="menu" class:left={align === "left"} role="dialog" aria-label="More" tabindex="-1" bind:this={menu} onkeydown={onKey}>
  {#each items as item, i (i)}
    {#if item === "line"}
      <hr />
    {:else}
      <button
        onclick={() => {
          onClose();
          item.run();
        }}
      >
        <span>{item.label}</span>
        {#if item.hint}<span class="hint">{item.hint}</span>{/if}
      </button>
    {/if}
  {/each}
</div>

<style>
  .away {
    position: fixed;
    inset: 0;
    z-index: 9;
  }

  .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 10;
    min-width: 250px;
    padding: 0.3rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
    outline: none;
  }

  .menu.left {
    right: auto;
    left: 0;
  }

  button {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    text-align: left;
    cursor: pointer;
  }

  button:hover,
  button:focus-visible {
    background: var(--accent-soft);
    outline: none;
  }

  .hint {
    color: var(--muted);
    font-size: 0.85em;
  }

  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0.3rem 0.2rem;
  }
</style>
