<!--
  The selected node's longer text, beside the map. It is saved as it is typed,
  and typing in a row is undone at once.
-->
<script lang="ts">
  import type { Live } from "./live.svelte.ts";

  let { live, nodeId, onClose }: { live: Live; nodeId: string; onClose: () => void } = $props();

  const node = $derived.by(() => {
    void live.version;
    return live.vault.get(nodeId);
  });
</script>

<aside aria-label="Notes">
  <div class="head">
    <h2>{node?.title || "Untitled"}</h2>
    <button onclick={onClose} title="Hide notes (⇧⌘N)" aria-label="Hide notes">×</button>
  </div>
  {#if node}
    <textarea
      value={node.body}
      placeholder="Notes"
      aria-label="Notes"
      oninput={(e) => live.vault.update(nodeId, { body: e.currentTarget.value }, `body:${nodeId}`)}
      onkeydown={(e) => {
        // Escape hands the keyboard back to the map.
        if (e.key === "Escape") e.currentTarget.blur();
      }}
    ></textarea>
  {/if}
</aside>

<style>
  aside {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 320px;
    padding: 0.75rem 1rem 1rem;
    border-left: 1px solid var(--line);
    min-height: 0;
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

  .head button {
    font-size: 1.1rem;
    color: var(--muted);
    background: none;
    border: none;
    border-radius: 6px;
    padding: 0 0.4rem;
    cursor: pointer;
  }

  .head button:hover {
    background: var(--accent-soft);
  }

  textarea {
    flex: 1;
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
</style>
