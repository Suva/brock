<!--
  Search everything (⌘K): type, and the best matches across the vault are
  listed with where they are; choose one to go to it. Tab narrows the search
  to the open map, then to maps only. The same list picks the other end of a
  link (⌘L), with `purpose` saying so.
-->
<script lang="ts">
  import { search, type Hit, type Scope } from "../core/search.ts";
  import type { Live } from "./live.svelte.ts";

  let {
    live,
    mapId,
    onChoose,
    onClose,
    purpose = "go",
    exclude = null,
  }: {
    live: Live;
    mapId: string;
    onChoose: (id: string) => void;
    onClose: () => void;
    /** Going to a node, or choosing one to link to. */
    purpose?: "go" | "link";
    /** A node left out of the results: the one a link starts from. */
    exclude?: string | null;
  } = $props();

  const SCOPES = ["all", "within", "maps"] as const;
  const LABELS = { all: "Everything", within: "In this map", maps: "Maps" };

  let query = $state("");
  let scope = $state<(typeof SCOPES)[number]>("all");
  let active = $state(0);
  let list: HTMLUListElement;

  const hits: Hit[] = $derived.by(() => {
    void live.version;
    const s: Scope = scope === "within" ? { kind: "within", mapId } : { kind: scope };
    return search(live.vault, query, s).filter((h) => h.node.id !== exclude);
  });

  // A new search starts at its best match.
  $effect(() => {
    void hits;
    active = 0;
  });

  // Keep the active row in view while moving through the list with the keys.
  $effect(() => {
    list?.children[active]?.scrollIntoView({ block: "nearest" });
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (hits.length) active = (active + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (hits[active]) onChoose(hits[active].node.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
      const i = SCOPES.indexOf(scope);
      scope = SCOPES[(i + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length];
    }
  }

  /** The title in pieces, with the parts the search found marked. */
  function pieces(hit: Hit): { text: string; mark: boolean }[] {
    const title = hit.node.title || "Untitled";
    const out: { text: string; mark: boolean }[] = [];
    let at = 0;
    for (const [start, end] of hit.marks) {
      if (start > at) out.push({ text: title.slice(at, start), mark: false });
      out.push({ text: title.slice(start, end), mark: true });
      at = end;
    }
    if (at < title.length) out.push({ text: title.slice(at), mark: false });
    return out;
  }

  /** Where a node is: its ancestors, the nearest three, below the top. */
  function where(hit: Hit): string {
    const path = hit.path.slice(1).map((n) => n.title || "Untitled");
    if (hit.path.length === 0) return "";
    if (path.length === 0) return hit.path[0].title || "Untitled";
    return (path.length > 3 ? "… › " : "") + path.slice(-3).join(" › ");
  }

  function focus(el: HTMLElement) {
    el.focus();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div class="palette" role="dialog" aria-label={purpose === "link" ? "Link to" : "Search"} tabindex="-1" onclick={(e) => e.stopPropagation()}>
    <input
      use:focus
      bind:value={query}
      onkeydown={onKey}
      placeholder={purpose === "link" ? "Link to…" : "Search titles and notes"}
      aria-label={purpose === "link" ? "Link to" : "Search"}
      aria-controls="search-results"
      spellcheck="false"
      autocomplete="off"
    />
    <div class="scopes" role="tablist" aria-label="Search in">
      {#each SCOPES as s (s)}
        <button
          role="tab"
          aria-selected={scope === s}
          class:on={scope === s}
          tabindex="-1"
          onmousedown={(e) => e.preventDefault()}
          onclick={() => (scope = s)}
        >
          {LABELS[s]}
        </button>
      {/each}
      <span class="hint">Tab to change</span>
    </div>
    <ul id="search-results" bind:this={list} role="listbox" aria-label="Results">
      {#each hits as hit, i (hit.node.id)}
        <li
          role="option"
          aria-selected={i === active}
          class:active={i === active}
          onmousemove={() => (active = i)}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => onChoose(hit.node.id)}
        >
          <div class="title">
            {#if hit.node.isMap}<span class="map" title="A map">⧉</span>{/if}
            {#each pieces(hit) as piece, k (k)}
              {#if piece.mark}<mark>{piece.text}</mark>{:else}{piece.text}{/if}
            {/each}
          </div>
          {#if hit.snippet}
            <div class="snippet">{hit.snippet}</div>
          {/if}
          <div class="where">{where(hit)}</div>
        </li>
      {:else}
        <li class="empty">{query ? "Nothing found" : "Nothing yet"}</li>
      {/each}
    </ul>
    {#if !query}
      <div class="foot">Changed most recently</div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 12vh;
    background: rgb(0 0 0 / 0.25);
  }

  .palette {
    display: flex;
    flex-direction: column;
    width: min(600px, calc(100% - 32px));
    max-height: 70vh;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.3);
    overflow: hidden;
    outline: none;
  }

  input {
    font: inherit;
    font-size: 1.05rem;
    color: inherit;
    background: none;
    border: none;
    border-bottom: 1px solid var(--line);
    padding: 0.85rem 1rem;
    outline: none;
  }

  .scopes {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.4rem 0.75rem;
    border-bottom: 1px solid var(--line);
  }

  .scopes button {
    font: inherit;
    font-size: 0.8rem;
    color: var(--muted);
    background: none;
    border: 1px solid transparent;
    border-radius: 999px;
    padding: 0.1rem 0.6rem;
    cursor: pointer;
  }

  .scopes button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .hint {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.35rem;
    overflow-y: auto;
  }

  li {
    padding: 0.45rem 0.65rem;
    border-radius: 8px;
    cursor: pointer;
  }

  li.active {
    background: var(--accent-soft);
  }

  li.empty {
    color: var(--muted);
    cursor: default;
  }

  .title {
    font-weight: 550;
  }

  .map {
    color: var(--accent);
    margin-right: 0.3rem;
  }

  mark {
    color: inherit;
    background: none;
    text-decoration: underline;
    text-decoration-color: var(--accent);
    text-decoration-thickness: 2px;
    text-underline-offset: 2px;
  }

  .snippet {
    margin-top: 0.1rem;
    font-size: 0.85rem;
    color: var(--fg);
    opacity: 0.8;
  }

  .where {
    margin-top: 0.1rem;
    font-size: 0.78rem;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .foot {
    padding: 0.35rem 1rem;
    border-top: 1px solid var(--line);
    font-size: 0.75rem;
    color: var(--muted);
  }
</style>
