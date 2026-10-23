<!--
  A newer version, offered in a corner of the window without stopping
  anything: installing it, then starting again, waits until it is clicked.
  Worked by mouse, like the sidebar, and it keeps the focus where it was, so
  the map's keys go on working. What's new opens the website's list of
  changes at that version, in the browser.
-->
<script lang="ts">
  import { openUrl } from "./open-url.ts";
  import { installUpdate, whatsNew, type Update } from "./updates.ts";

  let { update, saved, onLater }: { update: Update; /** Waits until everything is saved. */ saved: () => Promise<void>; onLater: () => void } = $props();

  let stage = $state<"offered" | "installing" | "failed">("offered");
  let share = $state<number | null>(null);
  let problem = $state("");

  async function install() {
    stage = "installing";
    share = null;
    try {
      await installUpdate(update, saved, (s) => (share = s));
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
      stage = "failed";
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<aside class="offer" aria-label="Update" onmousedown={(e) => (e.target as Element).closest("button") && e.preventDefault()}>
  {#if stage === "installing"}
    <p>
      {share === null ? "Getting" : share < 1 ? `Getting ${Math.round(share * 100)}% of` : "Installing"} Brock {update.version}…
      Brock starts again when it is in place.
    </p>
  {:else}
    <p>
      {#if stage === "failed"}
        <span class="problem">Brock {update.version} could not be installed: {problem}</span>
      {:else}
        Brock {update.version} is out. You have {update.currentVersion}.
      {/if}
    </p>
    <div class="actions">
      <button class="primary" onclick={install}>{stage === "failed" ? "Try again" : "Install and restart"}</button>
      <button onclick={() => openUrl(whatsNew(update.version))} title="Open the list of changes on the website">What's new</button>
      <button onclick={onLater}>Later</button>
    </div>
  {/if}
</aside>

<style>
  .offer {
    position: fixed;
    right: 16px;
    bottom: 40px;
    z-index: 8;
    width: min(360px, calc(100% - 32px));
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--bg);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.25);
    font-size: 0.9rem;
  }

  p {
    margin: 0 0 0.6rem;
    line-height: 1.4;
  }

  p:last-child {
    margin: 0;
  }

  .problem {
    color: var(--danger);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
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

  button:hover {
    background: var(--accent-soft);
  }

  button.primary {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
