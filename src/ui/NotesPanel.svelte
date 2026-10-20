<!--
  The selected node beside the map: its longer text, saved as it is typed and
  undone a run of typing at a time; the nodes it links to and those linking
  to it, each a way there; and the web addresses in the text, to open.
-->
<script lang="ts">
  import type { Node } from "../core/node.ts";
  import { webAddresses } from "../core/urls.ts";
  import type { Live } from "./live.svelte.ts";
  import { openUrl } from "./open-url.ts";

  let {
    live,
    nodeId,
    onClose,
    onGoTo,
  }: { live: Live; nodeId: string; onClose: () => void; onGoTo: (id: string) => void } = $props();

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
  const addresses = $derived(webAddresses(node?.body ?? ""));

  /** Where a node is, for telling apart nodes of the same name. */
  function where(n: Node): string {
    const map = vault.mapOf(n.id);
    return map ? vault.get(map)?.title || "Untitled" : "";
  }
</script>

<aside aria-label="Notes">
  <div class="head">
    <h2>{node?.title || "Untitled"}</h2>
    <button class="close" onclick={onClose} title="Hide notes (⇧⌘N)" aria-label="Hide notes">×</button>
  </div>
  {#if node}
    <textarea
      value={node.body}
      placeholder="Notes"
      aria-label="Notes"
      oninput={(e) => vault.update(nodeId, { body: e.currentTarget.value }, `body:${nodeId}`)}
      onkeydown={(e) => {
        // Escape hands the keyboard back to the map.
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    ></textarea>

    {#if addresses.length}
      <section>
        <h3>Web addresses</h3>
        <ul>
          {#each addresses as url (url)}
            <li>
              <button class="go url" onclick={() => openUrl(url)} title="Open in the browser">{url}</button>
            </li>
          {/each}
        </ul>
      </section>
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

  .url {
    color: var(--accent);
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
