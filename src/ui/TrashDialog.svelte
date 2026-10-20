<!--
  The trash: every branch deleted, the latest first, each to bring back where
  it was. Emptying it removes them for good, after asking.
-->
<script lang="ts">
  import type { Live } from "./live.svelte.ts";

  let { live, onClose, onGoTo }: { live: Live; onClose: () => void; onGoTo: (id: string) => void } = $props();

  const vault = $derived(live.vault);
  const items = $derived.by(() => {
    void live.version;
    return vault.trash();
  });
  let confirming = $state(false);

  const ago = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  function when(ms: number): string {
    const minutes = Math.round((ms - Date.now()) / 60000);
    if (minutes > -60) return ago.format(minutes, "minute");
    const hours = Math.round(minutes / 60);
    if (hours > -24) return ago.format(hours, "hour");
    return ago.format(Math.round(hours / 24), "day");
  }

  function where(id: string): string {
    const path = vault.ancestors(id).map((n) => n.title || "Untitled");
    return (path.length > 3 ? "… › " : "") + path.slice(-3).join(" › ");
  }

  function restore(id: string) {
    vault.restore(id);
    onGoTo(id);
  }

  function empty() {
    vault.emptyTrash();
    confirming = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (confirming) confirming = false;
      else onClose();
    }
  }

  function focus(el: HTMLElement) {
    el.focus();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div
    class="dialog"
    role="dialog"
    aria-label="Trash"
    tabindex="-1"
    use:focus
    onclick={(e) => e.stopPropagation()}
    onkeydown={onKey}
  >
    <div class="head">
      <h2>Trash</h2>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </div>
    {#if items.length}
      <ul>
        {#each items as { node, under } (node.id)}
          <li>
            <div class="what">
              <div class="title">
                {#if node.icon}<span class="icon">{node.icon}</span>{/if}{node.title || "Untitled"}
                {#if under}<span class="under">and {under} under it</span>{/if}
              </div>
              <div class="where">{where(node.id)} · deleted {when(node.deletedAt!)}</div>
            </div>
            <button class="restore" onclick={() => restore(node.id)} title="Put it back where it was">Restore</button>
          </li>
        {/each}
      </ul>
      <div class="foot">
        {#if confirming}
          <span>Delete all of this for good? It cannot be undone.</span>
          <button onclick={() => (confirming = false)}>Keep</button>
          <button class="danger" onclick={empty}>Delete for good</button>
        {:else}
          <button class="danger quiet" onclick={() => (confirming = true)}>Empty trash</button>
        {/if}
      </div>
    {:else}
      <p class="empty">Nothing has been deleted. Deleted branches wait here until the trash is emptied.</p>
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
    padding-top: 10vh;
    background: rgb(0 0 0 / 0.25);
  }

  .dialog {
    display: flex;
    flex-direction: column;
    width: min(560px, calc(100% - 32px));
    max-height: 72vh;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg);
    box-shadow: 0 16px 48px rgb(0 0 0 / 0.3);
    outline: none;
  }

  .head {
    display: flex;
    align-items: center;
    padding: 0.7rem 1rem;
    border-bottom: 1px solid var(--line);
  }

  h2 {
    flex: 1;
    margin: 0;
    font-size: 1rem;
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }

  button:hover {
    background: var(--accent-soft);
  }

  .close {
    font-size: 1.1rem;
    color: var(--muted);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0.4rem;
    overflow-y: auto;
  }

  li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.6rem;
    border-radius: 8px;
  }

  li:hover {
    background: var(--accent-soft);
  }

  .what {
    flex: 1;
    min-width: 0;
  }

  .title {
    font-weight: 550;
  }

  .icon {
    margin-right: 0.3rem;
  }

  .under,
  .where {
    font-size: 0.8rem;
    color: var(--muted);
    font-weight: normal;
  }

  .under {
    margin-left: 0.4rem;
  }

  .restore {
    color: var(--accent);
    border-color: var(--line);
  }

  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-top: 1px solid var(--line);
    font-size: 0.9rem;
  }

  .foot span {
    flex: 1;
  }

  .danger {
    color: var(--bg);
    background: var(--danger);
  }

  .danger:hover {
    background: var(--danger);
    opacity: 0.9;
  }

  .danger.quiet {
    color: var(--danger);
    background: none;
  }

  .danger.quiet:hover {
    background: var(--accent-soft);
    opacity: 1;
  }

  .empty {
    margin: 0;
    padding: 1.2rem 1rem;
    color: var(--muted);
  }
</style>
