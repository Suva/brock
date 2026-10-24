<!--
  The ☰ menu at the left of the header, where the window has no menu bar of
  its own (chrome.ts): File, Edit, Node, View and Help, each opening to the
  side as the pointer rests on it, as in other Windows apps. Alt on its own, or
  F10, opens and closes it. Arrow keys move through it (→ opens a menu, ← goes
  back), Enter chooses, Escape closes.
-->
<script lang="ts">
  import { tick } from "svelte";
  import type { Item } from "./menu-items.ts";

  let { items }: { items: Item[] } = $props();

  let open = $state(false);
  /** The deepest menu open to the side, by its place in the lists: "/1/4" is the fifth item of the second. */
  let trail = $state("");
  let root: HTMLDivElement;
  /** Where the focus was, to give back when something is chosen: commands about nodes go to what has it. */
  let before: HTMLElement | null = null;

  const shows = (path: string) => trail === path || trail.startsWith(`${path}/`);
  const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const menuAt = (path: string) => root.querySelector<HTMLElement>(`.menu[data-path="${path}"]`);
  const buttonsOf = (menu: Element | null) => [...(menu?.querySelectorAll<HTMLButtonElement>(":scope > .entry > button") ?? [])];

  async function toggle() {
    if (open) return close();
    before = document.activeElement as HTMLElement | null;
    open = true;
    trail = "";
    await tick();
    buttonsOf(menuAt(""))[0]?.focus();
  }

  function close() {
    open = false;
    trail = "";
  }

  function choose(run: () => void) {
    close();
    before?.focus();
    run();
  }

  /** Opens the menu at `path` to the side, and with the keyboard goes into it. */
  async function openMenu(path: string, enter: boolean) {
    trail = path;
    if (!enter) return;
    await tick();
    buttonsOf(menuAt(path))[0]?.focus();
  }

  /** Alt is down and nothing else has been pressed with it: letting it go opens or closes the menu, as in Windows. */
  let altAlone = false;

  function onWindowKeyDown(e: KeyboardEvent) {
    altAlone = e.key === "Alt" && !e.ctrlKey && !e.shiftKey && !e.metaKey && !e.repeat ? true : e.key === "Alt" && altAlone;
    if (e.key === "F10" && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      e.preventDefault();
      toggleByKey();
    }
  }

  function onWindowKeyUp(e: KeyboardEvent) {
    if (e.key !== "Alt" || !altAlone) return;
    altAlone = false;
    e.preventDefault();
    toggleByKey();
  }

  function toggleByKey() {
    if (!open) return toggle();
    close();
    before?.focus();
  }

  function onKey(e: KeyboardEvent) {
    const button = document.activeElement as HTMLButtonElement;
    const menu = button?.closest<HTMLElement>(".menu");
    if (!menu) return;
    const path = menu.dataset.path!;
    const list = buttonsOf(menu);
    const i = list.indexOf(button);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      list[(i + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length]?.focus();
    } else if (e.key === "ArrowRight" && button.dataset.opens) {
      openMenu(button.dataset.opens, true);
    } else if (e.key === "ArrowLeft" && path !== "") {
      trail = parentOf(path);
      root.querySelector<HTMLButtonElement>(`button[data-opens="${path}"]`)?.focus();
    } else if (e.key === "Escape") {
      close();
      before?.focus();
    } else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onWindowKeyDown} onkeyup={onWindowKeyUp} onmousedown={() => (altAlone = false)} onblur={() => (altAlone = false)} />

{#snippet menu(list: Item[], path: string)}
  <div class="menu" class:side={path !== ""} role="menu" data-path={path}>
    {#each list as item, i (i)}
      {#if item === "line"}
        <hr />
      {:else if "items" in item}
        {@const opens = `${path}/${i}`}
        <div class="entry" class:open={shows(opens)}>
          <button
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={shows(opens)}
            data-opens={opens}
            onmouseenter={(e) => {
              e.currentTarget.focus();
              openMenu(opens, false);
            }}
            onclick={(e) => openMenu(opens, e.detail === 0)}
          >
            <span>{item.label}</span>
            <span class="hint">›</span>
          </button>
          {#if shows(opens)}{@render menu(item.items, opens)}{/if}
        </div>
      {:else}
        <div class="entry">
          <button
            role="menuitem"
            onmouseenter={(e) => {
              e.currentTarget.focus();
              trail = path;
            }}
            onclick={() => choose(item.run)}
          >
            <span><span class="check">{item.checked ? "✓" : ""}</span>{item.label}</span>
            {#if item.hint}<span class="hint">{item.hint}</span>{/if}
          </button>
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

<div class="app-menu" bind:this={root}>
  <button class="burger" class:on={open} onclick={toggle} title="Menu (Alt)"aria-label="Menu" aria-haspopup="menu" aria-expanded={open}>
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
    </svg>
  </button>
  {#if open}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="away" onclick={close}></div>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div onkeydown={onKey}>{@render menu(items, "")}</div>
  {/if}
</div>

<style>
  .app-menu {
    position: relative;
    flex: none;
    margin-left: -0.4rem;
  }

  /* As the header's other icon buttons (App.svelte), whose styles do not reach in here. */
  .burger {
    display: grid;
    place-items: center;
    padding: 0.3rem 0.45rem;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
  }

  .burger:hover,
  .burger.on {
    background: var(--accent-soft);
  }

  .burger.on {
    color: var(--accent);
  }

  .away {
    position: fixed;
    inset: 0;
    z-index: 9;
  }

  .menu {
    position: absolute;
    left: 0;
    top: calc(100% + 4px);
    z-index: 10;
    min-width: 220px;
    padding: 0.3rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
  }

  /* A menu opening to the side, level with the item that opens it. */
  .menu.side {
    left: calc(100% + 0.3rem);
    top: calc(-0.3rem - 1px);
  }

  .entry {
    position: relative;
  }

  .entry button {
    display: flex;
    justify-content: space-between;
    gap: 1.5rem;
    width: 100%;
    font: inherit;
    color: inherit;
    white-space: nowrap;
    background: none;
    border: none;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    text-align: left;
    cursor: default;
  }

  .entry button:focus,
  .entry.open > button {
    background: var(--accent-soft);
    outline: none;
  }

  .check {
    display: inline-block;
    width: 1.2em;
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
