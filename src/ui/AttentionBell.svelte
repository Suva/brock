<!--
  The bell in the header: the nodes marked for you, in three levels. A badge
  counts those that ask something of you, orange for needing attention and red
  if any is critical, and a grey one counts the green ones, which ask nothing
  and are there to review. Opened (⇧⌘B), it lists them, the critical first, then
  those needing attention, then the OK ones. A click goes to a node; the tick
  on one that asks marks it OK, the cross on an OK one clears the mark, and
  Clear OK clears them all. Marks are set in the notes panel or with ⇧⌘A, or
  by an agent, which can only raise one: lowering or clearing is yours.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { counts, flagged, flagGlyph, setFlag, type Flagged } from "../core/attention.ts";
  import type { Flag } from "../core/node.ts";
  import type { Live } from "./live.svelte.ts";

  let {
    live,
    open,
    onToggle,
    onClose,
    onGoTo,
  }: {
    live: Live;
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
    onGoTo: (id: string) => void;
  } = $props();

  const vault = $derived(live.vault);
  // Read again only when a mark may have come, gone or moved, not on every edit.
  const list = $derived.by(() => {
    void live.marks;
    return flagged(vault);
  });
  const n = $derived(counts(list));

  // While it is open a row stays in the group it was in when it opened, so that marking
  // one OK does not move the rows under the pointer; the badges and signs are live.
  let opened = $state<Map<string, Flag> | null>(null);
  $effect(() => {
    opened = open ? untrack(() => new Map(list.map((f) => [f.node.id, f.flag]))) : null;
  });
  const groupOf = (f: Flagged): Flag => opened?.get(f.node.id) ?? f.flag;

  const GROUPS: { flag: Flag; title: string }[] = [
    { flag: "critical", title: "Critical" },
    { flag: "attention", title: "Needs attention" },
    { flag: "ok", title: "OK" },
  ];
  const inGroup = (flag: Flag): Flagged[] => list.filter((f) => groupOf(f) === flag);

  // Titles are read live: the list itself is read again only when marks change.
  const mapTitle = (mapId: string | null) => {
    void live.version;
    return mapId ? vault.get(mapId)?.title || "Untitled" : "";
  };
  const titleOf = (id: string) => {
    void live.version;
    return vault.get(id)?.title || "Untitled";
  };

  const summary = $derived(
    [
      n.critical ? `${n.critical} critical` : "",
      n.attention ? `${n.attention} need${n.attention === 1 ? "s" : ""} attention` : "",
      n.ok ? `${n.ok} OK` : "",
    ]
      .filter(Boolean)
      .join(", ") || "Nothing is marked",
  );

  // Escape closes it wherever the focus is: the header's buttons leave it on the map.
  function onKey(e: KeyboardEvent) {
    if (open && e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  // Closes itself when the last mark is cleared.
  $effect(() => {
    if (open && list.length === 0) onClose();
  });
</script>

<svelte:window onkeydown={onKey} />

<div class="bell">
  <button
    class="icon-button"
    class:on={open}
    class:critical={n.critical > 0}
    class:asking={n.critical === 0 && n.attention > 0}
    aria-expanded={open}
    onclick={onToggle}
    title="{summary} (⇧⌘B)"
    aria-label={summary}
  >
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      <path
        d="M8 2.2c-2.3 0-3.7 1.7-3.7 3.9v2.1L3 10.6h10l-1.3-2.4V6.1C11.7 3.9 10.3 2.2 8 2.2Z M6.5 12.3a1.5 1.5 0 0 0 3 0"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    </svg>
    {#if n.asking}<span class="count asking" class:critical={n.critical > 0}>{n.asking > 9 ? "9+" : n.asking}</span>{/if}
    {#if n.ok}<span class="count ok">{n.ok > 9 ? "9+" : n.ok}</span>{/if}
  </button>
  {#if open && list.length}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="away" onclick={onClose}></div>
    <div class="panel" role="dialog" aria-label="Marked nodes">
      <div class="head">
        <h3>{summary}</h3>
        {#if n.ok}
          <button class="clear-all" onclick={() => setFlag(vault, inGroup("ok").map((f) => f.node.id), null)} title="Clear the mark on every OK node">Clear OK</button>
        {/if}
      </div>
      {#each GROUPS as { flag, title } (flag)}
        {@const group = inGroup(flag)}
        {#if group.length}
          <h4 class={flag}>{title}</h4>
          <ul>
            {#each group as { node, mapId, flag: now } (node.id)}
              <li>
                <span class="glyph {now}" aria-hidden="true">{flagGlyph(now)}</span>
                <button
                  class="go"
                  onclick={() => {
                    onGoTo(node.id);
                    onClose();
                  }}
                  title="Go to it"
                >
                  <span class="title">{titleOf(node.id)}</span>
                  {#if mapTitle(mapId)}<span class="map">{mapTitle(mapId)}</span>{/if}
                </button>
                {#if now === "ok"}
                  <button class="act" onclick={() => vault.update(node.id, { flag: null })} title="Clear the mark" aria-label="Clear the mark">×</button>
                {:else}
                  <button class="act" onclick={() => vault.update(node.id, { flag: "ok" })} title="Mark it OK: you have seen to it" aria-label="Mark it OK">✓</button>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .bell {
    position: relative;
  }

  .icon-button {
    position: relative;
    display: grid;
    place-items: center;
    padding: 0.3rem 0.45rem;
    border: 1px solid transparent;
    border-radius: 6px;
  }

  .icon-button:hover {
    background: var(--accent-soft);
  }

  .icon-button.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .icon-button.asking {
    color: var(--warning);
  }

  .icon-button.critical {
    color: var(--danger);
  }

  /* Orange or red at the top right for what asks; grey at the bottom right for what is OK. */
  .count {
    position: absolute;
    right: -4px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    box-sizing: border-box;
    border-radius: 7px;
    color: var(--bg);
    font-size: 0.65rem;
    font-weight: 700;
    line-height: 14px;
    text-align: center;
  }

  .count.asking {
    top: -3px;
    background: var(--warning);
  }

  .count.asking.critical {
    background: var(--danger);
  }

  .count.ok {
    bottom: -3px;
    background: var(--muted);
  }

  .away {
    position: fixed;
    inset: 0;
    z-index: 19;
  }

  .panel {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 20;
    width: 320px;
    max-height: 60vh;
    overflow-y: auto;
    padding-bottom: 0.25rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.25);
  }

  .head {
    display: flex;
    align-items: center;
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--line);
  }

  h3 {
    flex: 1;
    margin: 0;
    font-size: 0.8rem;
  }

  h4 {
    margin: 0.5rem 0.7rem 0.1rem;
    font-size: 0.68rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  h4.critical {
    color: var(--danger);
  }

  h4.attention {
    color: var(--warning);
  }

  h4.ok {
    color: var(--ok);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0 0.25rem;
  }

  li {
    display: flex;
    align-items: center;
    border-radius: 6px;
  }

  li:hover {
    background: var(--accent-soft);
  }

  .glyph {
    flex: none;
    width: 1.3rem;
    text-align: center;
    font-size: 0.85rem;
  }

  .glyph.ok {
    color: var(--ok);
  }

  .glyph.attention {
    color: var(--warning);
  }

  .glyph.critical {
    color: var(--danger);
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    cursor: pointer;
  }

  .go {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    text-align: left;
    padding: 0.3rem 0.3rem;
  }

  .title {
    font-size: 0.88rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .map {
    font-size: 0.75rem;
    color: var(--muted);
  }

  .act,
  .clear-all {
    color: var(--muted);
    border-radius: 6px;
    padding: 0.2rem 0.5rem;
  }

  .act:hover,
  .clear-all:hover {
    color: var(--accent);
  }

  .clear-all {
    font-size: 0.75rem;
  }
</style>
