<!--
  History, in the sidebar's History tab (⇧⌘Y): what was changed, newest first,
  by whom (you, or an agent), and when. A step can be taken back for the nodes
  still as it left them; that is a step of its own, which ⌘Z undoes. Nodes
  changed since are left alone, and the row says so. Steps are read from the
  log the store keeps, so they are there after a restart.
-->
<script lang="ts">
  import { untrack } from "svelte";
  import { aboutNode, describe, reversible, revertStep, stepsOf, type Step } from "../core/activity.ts";
  import type { Live } from "./live.svelte.ts";

  let { live, onGoTo, onTell }: { live: Live; onGoTo: (id: string) => void; onTell: (text: string) => void } = $props();

  /** The steps to read at most, and to show. */
  const READ = 1500;
  const SHOWN = 150;

  let steps = $state<Step[]>([]);
  let loaded = $state(false);
  let failed = $state<string | null>(null);
  let only = $state<"all" | "agent">("all");

  const vault = $derived(live.vault);
  const shown = $derived(steps.filter((s) => only === "all" || s.source !== "user").slice(0, SHOWN));

  // Read again when the vault changes, a moment after the last change.
  let timer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    void live.version;
    clearTimeout(timer);
    timer = setTimeout(load, untrack(() => loaded) ? 400 : 0);
    return () => clearTimeout(timer);
  });

  async function load() {
    try {
      steps = stepsOf(await live.history(READ));
      failed = null;
    } catch (e) {
      failed = String(e);
    }
    loaded = true;
  }

  function status(step: Step) {
    void live.version;
    const { clean, total, back } = reversible(vault, step);
    return { clean: clean.length, total, back };
  }

  function revert(step: Step) {
    const { reverted, left } = revertStep(vault, step);
    onTell(
      reverted === 0
        ? "Nothing to take back: it has changed since."
        : left > 0
          ? `Took back ${reverted} of ${reverted + left}; the rest has changed since. ⌘Z undoes it.`
          : "Took it back. ⌘Z undoes that.",
    );
  }

  const who = (source: string) => (source === "user" ? "You" : source === "agent" ? "Agent" : source);
  const clock = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  /** The day a step was made, as a heading: Today, Yesterday, or the date. */
  function day(at: number): string {
    const d = new Date(at);
    const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.round((midnight(new Date()) - midnight(d)) / 86_400_000);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  }

  /** The map a step's node is in, to say where. */
  function where(step: Step): string {
    const node = aboutNode(step);
    const map = vault.isLive(node.id) ? vault.mapOf(node.id) : null;
    return map ? vault.get(map)?.title || "Untitled" : "";
  }

  const exists = (step: Step) => vault.isLive(aboutNode(step).id);
</script>

<div class="filters" role="radiogroup" aria-label="Show">
  <button role="radio" aria-checked={only === "all"} class:on={only === "all"} onclick={() => (only = "all")}>Everything</button>
  <button role="radio" aria-checked={only === "agent"} class:on={only === "agent"} onclick={() => (only = "agent")}>Agents</button>
</div>

{#if failed}
  <p class="muted problem">The history could not be read: {failed}</p>
{:else if loaded && shown.length === 0}
  <p class="muted">{only === "agent" ? "Agents have changed nothing yet." : "Nothing has changed yet."}</p>
{/if}

<ul>
  {#each shown as step, i (step.seq)}
    {@const s = status(step)}
    {#if i === 0 || day(shown[i - 1].at) !== day(step.at)}
      <li class="day">{day(step.at)}</li>
    {/if}
    <li class="step">
      <button class="what" disabled={!exists(step)} onclick={() => onGoTo(aboutNode(step).id)} title={exists(step) ? "Go to it" : "It is in the trash"}>
        <span class="text">{describe(step)}</span>
        <span class="meta">
          <span class="clock">{clock(step.at)}</span>
          <span class="who" class:agent={step.source !== "user"}>{who(step.source)}</span>
          {#if where(step)}<span class="map">{where(step)}</span>{/if}
        </span>
      </button>
      {#if s.clean > 0}
        <button class="revert" onclick={() => revert(step)} title="Put it back as it was before this step">
          {s.clean === s.total ? "Revert" : `Revert ${s.clean} of ${s.total}`}
        </button>
      {:else}
        {#if s.back === s.total}
          <span class="changed" title="Everything this step changed is as it was before it">As it was</span>
        {:else}
          <span class="changed" title="Every node of this step has been changed since">Changed since</span>
        {/if}
      {/if}
    </li>
  {/each}
</ul>

<style>
  .filters {
    display: flex;
    gap: 0.3rem;
    padding: 0 0.3rem 0.5rem;
  }

  .filters button {
    font: inherit;
    font-size: 0.8rem;
    color: var(--muted);
    background: none;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.1rem 0.5rem;
    cursor: pointer;
  }

  .filters button.on {
    color: var(--accent);
    border-color: var(--accent);
    background: var(--accent-soft);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .day {
    padding: 0.7rem 0.3rem 0.2rem;
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .step {
    display: flex;
    align-items: flex-start;
    gap: 0.3rem;
    border-radius: 6px;
  }

  .step:hover {
    background: var(--accent-soft);
  }

  .what {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    text-align: left;
    font: inherit;
    color: var(--fg);
    background: none;
    border: none;
    padding: 0.3rem;
    cursor: pointer;
  }

  .what:disabled {
    color: var(--muted);
    cursor: default;
  }

  .text {
    font-size: 0.88rem;
    overflow-wrap: anywhere;
  }

  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 0.1rem 0.5rem;
    font-size: 0.75rem;
    color: var(--muted);
  }

  .who.agent {
    color: var(--accent);
    font-weight: 600;
  }

  .map {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 10em;
  }

  .revert,
  .changed {
    flex: none;
    margin-top: 0.3rem;
    font: inherit;
    font-size: 0.75rem;
  }

  .revert {
    color: var(--fg);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.1rem 0.5rem;
    cursor: pointer;
  }

  .revert:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .changed {
    color: var(--muted);
    padding: 0.15rem 0.3rem;
  }

  .muted {
    color: var(--muted);
    font-size: 0.85rem;
    padding: 0 0.3rem;
  }

  .problem {
    color: var(--danger);
  }
</style>
