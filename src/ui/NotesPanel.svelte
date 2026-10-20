<!--
  The selected node beside the map: its notes, drawn from their Markdown and
  edited as text on a click (saved as typed, undone a run of typing at a
  time); and the nodes it links to and those linking to it, each a way there.
  Links in the notes go to nodes or open web addresses; ⌘L while writing puts
  in a link to a node chosen as in search.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { PALETTE } from "../core/branches.ts";
  import { nodeLink, parse, setChecked, type LinkTarget } from "../core/markdown.ts";
  import type { Node } from "../core/node.ts";
  import { findByTitle } from "../core/search.ts";
  import type { Live } from "./live.svelte.ts";
  import Markdown from "./Markdown.svelte";
  import { openUrl } from "./open-url.ts";
  import Palette from "./Palette.svelte";

  let {
    live,
    nodeId,
    centre,
    onClose,
    onGoTo,
  }: {
    live: Live;
    nodeId: string;
    /** Whether the node is the centre of the open map, which has no colour of its own. */
    centre: boolean;
    onClose: () => void;
    onGoTo: (id: string) => void;
  } = $props();

  /** Icons to choose from: a short list that covers what notes usually mark. */
  const ICONS = ["⭐", "✅", "❗", "❓", "💡", "📌", "🔥", "⚠️", "🎯", "📅", "⏳", "💰", "📚", "🧠", "🛠️", "🏠", "✈️", "❤️", "🚀", "🔒", "📝", "👍", "👎", "🎉"];
  let choosingIcon = $state(false);

  const vault = $derived(live.vault);
  const node = $derived.by(() => {
    void live.version;
    return vault.get(nodeId);
  });
  const linksOut = $derived.by(() => {
    void live.version;
    return (node?.links ?? []).filter((id) => vault.isLive(id)).map((id) => vault.get(id)!);
  });
  const linksIn = $derived.by(() => {
    void live.version;
    return vault.linksTo(nodeId);
  });
  const blocks = $derived(parse(node?.body ?? ""));

  /** Whether the notes are being written, as text, rather than read. */
  let writing = $state(false);
  /** Choosing a node to link to from the notes, and where the caret was. */
  let picking = $state<{ start: number; end: number } | null>(null);
  let textarea = $state<HTMLTextAreaElement>();

  // Another node's notes start out read.
  $effect(() => {
    void nodeId;
    writing = false;
    picking = null;
  });

  async function write(caret?: number) {
    writing = true;
    await tick();
    textarea?.focus();
    if (textarea && caret !== undefined) textarea.setSelectionRange(caret, caret);
  }

  const save = (body: string) => vault.update(nodeId, { body }, `body:${nodeId}`);

  /** The node a link in the notes leads to, if it is there. */
  function nodeOf(to: LinkTarget): Node | null {
    if (to.kind === "node") return vault.isLive(to.id) ? vault.get(to.id)! : null;
    if (to.kind === "title") return findByTitle(vault, to.title, vault.mapOf(nodeId) ?? nodeId);
    return null;
  }

  function follow(to: LinkTarget) {
    if (to.kind === "web") openUrl(to.url);
    else {
      const target = nodeOf(to);
      if (target) onGoTo(target.id);
    }
  }

  function onWriteKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      // Escape shows the notes read, and hands the keyboard back to the map.
      e.currentTarget && (e.currentTarget as HTMLElement).blur();
    } else if (mod && e.key.toLowerCase() === "l" && !e.shiftKey) {
      // A link to a node, put in here: not the node's own link (⌘L elsewhere).
      e.preventDefault();
      e.stopPropagation();
      const t = e.currentTarget as HTMLTextAreaElement;
      picking = { start: t.selectionStart, end: t.selectionEnd };
    }
  }

  function insertLink(id: string) {
    const where = picking;
    picking = null;
    const target = vault.get(id);
    if (!where || !target || !node) return write();
    const link = nodeLink(target.title, id);
    save(node.body.slice(0, where.start) + link + node.body.slice(where.end));
    write(where.start + link.length);
  }

  /** Where a node is, for telling apart nodes of the same name. */
  function where(n: Node): string {
    const map = vault.mapOf(n.id);
    return map ? vault.get(map)?.title || "Untitled" : "";
  }
</script>

<aside aria-label="Notes">
  <div class="head">
    <h2>{node?.title || "Untitled"}</h2>
    <button class="close" onclick={onClose} title="Hide notes (⇧⌘N)" aria-label="Hide notes">›</button>
  </div>
  {#if node}
    <div class="style">
      {#if !centre}
        <div class="swatches" role="radiogroup" aria-label="Colour">
          <button
            class="swatch none"
            role="radio"
            aria-checked={node.color === null}
            class:on={node.color === null}
            title="No colour of its own"
            aria-label="No colour of its own"
            onclick={() => vault.update(nodeId, { color: null })}
          ></button>
          {#each PALETTE as colour (colour)}
            <button
              class="swatch"
              role="radio"
              aria-checked={node.color === colour}
              class:on={node.color === colour}
              style:background={colour}
              title="This colour, for it and what is under it"
              aria-label="Colour {colour}"
              onclick={() => vault.update(nodeId, { color: colour })}
            ></button>
          {/each}
        </div>
      {/if}
      <button class="icon-button" onclick={() => (choosingIcon = !choosingIcon)} title="Icon" aria-expanded={choosingIcon}>
        {node.icon ?? "☺︎"}
      </button>
    </div>
    {#if choosingIcon}
      <div class="icons" role="radiogroup" aria-label="Icon">
        {#each ICONS as icon (icon)}
          <button
            role="radio"
            aria-checked={node.icon === icon}
            class:on={node.icon === icon}
            onclick={() => {
              vault.update(nodeId, { icon });
              choosingIcon = false;
            }}>{icon}</button
          >
        {/each}
        <button
          class="clear"
          onclick={() => {
            vault.update(nodeId, { icon: null });
            choosingIcon = false;
          }}>None</button
        >
      </div>
    {/if}
    {#if writing}
      <textarea
        bind:this={textarea}
        value={node.body}
        placeholder="Notes, in Markdown"
        aria-label="Notes"
        oninput={(e) => save(e.currentTarget.value)}
        onkeydown={onWriteKey}
        onblur={() => {
          // Choosing a link takes the focus for a moment; that is not leaving.
          if (!picking) writing = false;
        }}
      ></textarea>
      <p class="hint">
        **bold**, *italic*, # heading, - list, - [ ] to do, [[a node's title]].
        ⌘L puts in a link to a node; Escape shows the notes.
      </p>
    {:else}
      <!-- A click anywhere but on a link starts writing; Enter does from the keyboard. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <div
        class="read"
        class:empty={!node.body.trim()}
        role="document"
        tabindex="0"
        title="Click to write"
        onclick={() => write(node!.body.length)}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            write(node!.body.length);
          }
        }}
      >
        {#if node.body.trim()}
          <Markdown
            {blocks}
            found={(to) => to.kind === "web" || nodeOf(to) !== null}
            onLink={follow}
            onCheck={(line, checked) => save(setChecked(node!.body, line, checked))}
          />
        {:else}
          Notes
        {/if}
      </div>
    {/if}

    <section>
      <h3>Links</h3>
      {#if linksOut.length}
        <ul>
          {#each linksOut as target (target.id)}
            <li>
              <button class="go" onclick={() => onGoTo(target.id)} title="Go there">
                ↗ {target.title || "Untitled"}
                <span class="where">{where(target)}</span>
              </button>
              <button
                class="remove"
                onclick={() => vault.unlink(nodeId, target.id)}
                title="Remove this link"
                aria-label="Remove the link to {target.title || 'Untitled'}"
              >
                ×
              </button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint">⌘L links this node to any other.</p>
      {/if}
    </section>

    {#if linksIn.length}
      <section>
        <h3>Linked from</h3>
        <ul>
          {#each linksIn as source (source.id)}
            <li>
              <button class="go" onclick={() => onGoTo(source.id)} title="Go there">
                ↙ {source.title || "Untitled"}
                <span class="where">{where(source)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</aside>

{#if picking}
  <Palette {live} mapId={vault.mapOf(nodeId) ?? nodeId} purpose="link" exclude={nodeId} onChoose={insertLink} onClose={() => {
      picking = null;
      write();
    }} />
{/if}

<style>
  aside {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: 320px;
    padding: 0.75rem 1rem 1rem;
    border-left: 1px solid var(--line);
    min-height: 0;
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  h3 {
    margin: 0 0 0.2rem;
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-soft);
  }

  .close {
    font-size: 1.1rem;
    color: var(--muted);
    padding: 0 0.4rem;
  }

  .style {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .swatches {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    flex: 1;
  }

  .swatch {
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    border: 2px solid transparent;
  }

  .swatch.on {
    outline: 2px solid var(--fg);
    outline-offset: 1px;
  }

  .swatch.none {
    border-color: var(--line);
    background: linear-gradient(135deg, transparent 45%, var(--muted) 45% 55%, transparent 55%);
  }

  .icon-button {
    margin-left: auto;
    min-width: 30px;
    border: 1px solid var(--line);
    font-size: 1rem;
    color: var(--muted);
  }

  .icons {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 2px;
  }

  .icons button {
    font-size: 1.05rem;
    padding: 0.15rem;
  }

  .icons button.on {
    background: var(--accent-soft);
  }

  .icons .clear {
    grid-column: span 2;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .read {
    flex: 1;
    min-height: 8rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid transparent;
    border-radius: 8px;
    cursor: text;
    outline: none;
  }

  .read:hover,
  .read:focus-visible {
    border-color: var(--line);
  }

  .read.empty {
    color: var(--muted);
  }

  textarea {
    flex: 1;
    min-height: 8rem;
    resize: none;
    font: inherit;
    line-height: 1.5;
    color: inherit;
    background: none;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.6rem 0.7rem;
  }

  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: flex;
    align-items: center;
  }

  .go {
    flex: 1;
    min-width: 0;
    padding: 0.2rem 0.4rem;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .where {
    margin-left: 0.3rem;
    font-size: 0.8rem;
    color: var(--muted);
  }

  .remove {
    color: var(--muted);
    padding: 0 0.4rem;
  }

  .hint {
    margin: 0;
    font-size: 0.85rem;
    color: var(--muted);
  }
</style>
