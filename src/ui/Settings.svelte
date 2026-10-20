<!--
  Settings (⌘,): how the app looks, and the daily copies of the vault: where
  they are, which there are, and making one now.
-->
<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { inTauri } from "../store/tauri-store.ts";
  import { applyTheme, savedTheme, type Theme } from "./theme.ts";

  let { onClose }: { onClose: () => void } = $props();

  interface Backups {
    folder: string;
    keep: number;
    copies: { name: string; bytes: number; madeAt: number }[];
  }

  let theme = $state<Theme>(savedTheme());
  let backups = $state<Backups | null>(null);
  let working = $state(false);
  let problem = $state<string | null>(null);
  const app = inTauri();

  $effect(() => {
    if (app) invoke<Backups>("list_backups").then((b) => (backups = b), (e) => (problem = String(e)));
  });

  function choose(t: Theme) {
    theme = t;
    applyTheme(t);
  }

  async function copyNow() {
    working = true;
    problem = null;
    try {
      backups = await invoke<Backups>("back_up_now");
    } catch (e) {
      problem = String(e);
    } finally {
      working = false;
    }
  }

  const size = (bytes: number) =>
    bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const day = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const showLabel = navigator.platform.startsWith("Mac") ? "Show in Finder" : "Show the folder";

  function focus(el: HTMLElement) {
    el.focus();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onClose}>
  <div
    class="dialog"
    role="dialog"
    aria-label="Settings"
    tabindex="-1"
    use:focus
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }}
  >
    <div class="head">
      <h2>Settings</h2>
      <button class="close" onclick={onClose} aria-label="Close">×</button>
    </div>

    <section>
      <h3>Appearance</h3>
      <div class="choices" role="radiogroup" aria-label="Appearance">
        {#each [["system", "As the system"], ["light", "Light"], ["dark", "Dark"]] as [value, label] (value)}
          <button role="radio" aria-checked={theme === value} class:on={theme === value} onclick={() => choose(value as Theme)}>
            {label}
          </button>
        {/each}
      </div>
    </section>

    <section>
      <h3>Copies of the vault</h3>
      {#if !app}
        <p class="muted">In a browser, the vault is kept in the browser's storage. The desktop app makes a copy of it every day.</p>
      {:else if backups}
        <p class="muted">
          A copy is made every day the app is used, and the last {backups.keep} are kept. To go back to one, quit the app and
          put it in place of <code>vault.sqlite</code>, beside the folder.
        </p>
        <p class="folder">{backups.folder}</p>
        {#if backups.copies.length}
          <ul>
            {#each backups.copies as copy (copy.name)}
              <li><span>{day(copy.madeAt)}</span><span class="muted">{size(copy.bytes)}</span></li>
            {/each}
          </ul>
        {/if}
        <div class="actions">
          <button onclick={copyNow} disabled={working}>{working ? "Copying…" : "Make a copy now"}</button>
          <button onclick={() => invoke("show_backups").catch((e) => (problem = String(e)))}>{showLabel}</button>
        </div>
      {/if}
      {#if problem}<p class="problem">{problem}</p>{/if}
    </section>
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
    width: min(520px, calc(100% - 32px));
    max-height: 76vh;
    overflow-y: auto;
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

  section {
    padding: 0.8rem 1rem;
  }

  section + section {
    border-top: 1px solid var(--line);
  }

  h3 {
    margin: 0 0 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.25rem 0.7rem;
    cursor: pointer;
  }

  button:hover:not(:disabled) {
    background: var(--accent-soft);
  }

  button:disabled {
    color: var(--muted);
  }

  .close {
    border: none;
    font-size: 1.1rem;
    color: var(--muted);
  }

  .choices {
    display: flex;
    gap: 0.4rem;
  }

  .choices button.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  p {
    margin: 0 0 0.6rem;
    line-height: 1.45;
  }

  .muted {
    color: var(--muted);
  }

  .folder {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }

  code {
    font-size: 0.9em;
  }

  ul {
    list-style: none;
    margin: 0 0 0.6rem;
    padding: 0;
    font-size: 0.9rem;
  }

  li {
    display: flex;
    justify-content: space-between;
    padding: 0.15rem 0;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .problem {
    margin-top: 0.6rem;
    color: var(--danger);
  }
</style>
