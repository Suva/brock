<!--
  Minimise, maximise and close, at the right end of the header, where the
  window has no title bar of its own (chrome.ts).
-->
<script lang="ts">
  import { getCurrentWindow } from "@tauri-apps/api/window";

  const win = getCurrentWindow();
  let maximized = $state(false);

  $effect(() => {
    const check = async () => (maximized = await win.isMaximized());
    check();
    const unlisten = win.onResized(check);
    return () => void unlisten.then((off) => off());
  });
</script>

<div class="buttons">
  <button onclick={() => win.minimize()} title="Minimise" aria-label="Minimise">
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M0 5.5h10" stroke="currentColor" /></svg>
  </button>
  <button onclick={() => win.toggleMaximize()} title={maximized ? "Restore" : "Maximise"} aria-label={maximized ? "Restore" : "Maximise"}>
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true">
      {#if maximized}
        <path d="M2.5 2.5v-2h7v7h-2M0.5 2.5h7v7h-7z" fill="none" stroke="currentColor" />
      {:else}
        <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" />
      {/if}
    </svg>
  </button>
  <button class="close" onclick={() => win.close()} title="Close" aria-label="Close">
    <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M0 0l10 10M10 0 0 10" stroke="currentColor" /></svg>
  </button>
</div>

<style>
  .buttons {
    display: flex;
    flex: none;
    align-self: stretch;
    /* Out to the header's edges, which have padding. */
    margin: -0.5rem -1rem -0.5rem 0;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 46px;
    padding: 0;
    border: none;
    border-radius: 0;
    background: none;
    color: inherit;
  }

  button:hover {
    background: var(--accent-soft);
  }

  .close:hover {
    background: #c42b1c;
    color: white;
  }
</style>
