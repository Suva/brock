<!--
  The selected node beside the map: whether it is a task, its priority and
  the day it is due, its colour and icon; on the centre of the open map, how
  that map is drawn; its notes, edited where their Markdown is drawn or as
  its source (saved as typed, undone a run of typing at a time); and the
  nodes it links to and those linking to it, each a way there.
  Links in the notes go to nodes, open web addresses, files or the window's panels; ⌘L while writing puts
  in a link to a node chosen as in search. Files and folders dropped on it
  from Finder or Explorer are linked in the notes, where the cursor is while
  writing or at the end.
-->
<script lang="ts">
  import { tick } from "svelte";
  import { PALETTE } from "../core/branches.ts";
  import { COMMANDS, fileLink, filePath, nodeLink, type Command, type LinkTarget } from "../core/markdown.ts";
  import type { Node } from "../core/node.ts";
  import { findByTitle } from "../core/search.ts";
  import { PRIORITIES, setPriority } from "../core/tasks.ts";
  import PriorityBadge from "./PriorityBadge.svelte";
  import type { Live } from "./live.svelte.ts";
  import NoteEditor from "./NoteEditor.svelte";
  import { watchFileDrops } from "./file-drop.ts";
  import { openFile, openUrl, opensFiles } from "./open-url.ts";
  import Palette from "./Palette.svelte";

  let {
    live,
    nodeId,
    centre,
    onClose,
    onGoTo,
    onCommand,
    onProblem,
    source,
    onToggleSource,
    width,
  }: {
    live: Live;
    nodeId: string;
    /** Whether the node is the centre of the open map, which has no colour of its own. */
    centre: boolean;
    onClose: () => void;
    onGoTo: (id: string) => void;
    /** A brock: link in the notes was clicked. */
    onCommand: (command: Command) => void;
    /** Something went wrong that the person should hear of, such as a linked file not being there. */
    onProblem: (text: string) => void;
    /** Notes shown as their Markdown source, with nothing drawn. */
    source: boolean;
    onToggleSource: () => void;
    width: number;
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
  /** Whether the notes have the keyboard. */
  let writing = $state(false);
  /** Choosing a node to link to from the notes, and what was chosen in them. */
  let picking = $state<{ start: number; end: number } | null>(null);
  let editor = $state<ReturnType<typeof NoteEditor>>();

  $effect(() => {
    void nodeId;
    picking = null;
  });

  /** Puts the cursor in the notes, once the text just saved has reached them. */
  async function write(caret?: number) {
    await tick();
    editor?.focus(caret);
  }

  const save = (body: string) => vault.update(nodeId, { body }, `body:${nodeId}`);

  /** Typing a date changes it digit by digit: one step to undo, like typing in the notes. */
  function changeDue(input: HTMLInputElement) {
    // A date half typed reads as empty, which must not take the old one away.
    if (input.validity.badInput) return;
    vault.update(nodeId, { due: input.value || null }, `due:${nodeId}`);
  }

  /** The node a link in the notes leads to, if it is there. */
  function nodeOf(to: LinkTarget): Node | null {
    if (to.kind === "node") return vault.isLive(to.id) ? vault.get(to.id)! : null;
    if (to.kind === "title") return findByTitle(vault, to.title, vault.mapOf(nodeId) ?? nodeId);
    return null;
  }

  function follow(to: LinkTarget) {
    if (to.kind === "web") openUrl(to.url);
    else if (to.kind === "file") openFile(to.url).catch((e) => onProblem(String(e)));
    else if (to.kind === "command") onCommand(to.command);
    else {
      const target = nodeOf(to);
      if (target) onGoTo(target.id);
    }
  }

  const found = (to: LinkTarget) => to.kind === "web" || to.kind === "command" || (to.kind === "file" && opensFiles()) || nodeOf(to) !== null;

  function describe(to: LinkTarget): string {
    if (to.kind === "web") return `Open ${to.url} in the browser`;
    if (to.kind === "command") return COMMANDS[to.command];
    if (to.kind === "file") return found(to) ? `Open ${filePath(to.url)}` : "Files open in the app, not in a browser";
    if (!found(to)) return to.kind === "title" ? `No node is called “${to.title}”` : "That node is gone";
    return "Go there";
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

  let panel = $state<HTMLElement>();
  /** Files are being dragged over the panel. */
  let dropping = $state(false);

  $effect(() =>
    watchFileDrops({
      over: (under) => (dropping = !!under && !!panel?.contains(under)),
      drop: (paths, under) => {
        if (!node || !paths.length || !under || !panel?.contains(under)) return;
        const links = paths.map(fileLink);
        // Its own step to undo, not part of the typing around it.
        if (writing && editor) {
          const { from: start, to: end } = editor.selection();
          const text = links.join("\n");
          vault.update(nodeId, { body: node.body.slice(0, start) + text + node.body.slice(end) });
          write(start + text.length);
        } else {
          const text = links.length > 1 ? links.map((l) => `- ${l}`).join("\n") : links[0];
          const before = node.body.trimEnd();
          vault.update(nodeId, { body: before ? `${before}\n\n${text}` : text });
        }
      },
    }),
  );

  /** Where a node is, for telling apart nodes of the same name. */
  function where(n: Node): string {
    const map = vault.mapOf(n.id);
    return map ? vault.get(map)?.title || "Untitled" : "";
  }
</script>

<aside aria-label="Notes" style:width="{width}px" bind:this={panel} class:dropping>
  <div class="head">
    <h2>{node?.title || "Untitled"}</h2>
    <button class="close" onclick={onClose} title="Hide notes (⇧⌘N)" aria-label="Hide notes">›</button>
  </div>
  {#if node}
    <!-- The mouse's way to what ⌘T and ⌘1 to ⌘5 do, which a browser keeps for itself. -->
    <div class="task-row">
      <button
        class="task-toggle"
        class:on={node.task !== null}
        aria-pressed={node.task !== null}
        onclick={() => vault.toggleTask(nodeId)}
        title={node.task === null ? "Make it a task, with a checkbox (⌘T)" : "Make it an ordinary node again (⌘T)"}
      >
        <span class="box" class:done={node.task === "done"}>{node.task === "done" ? "✓" : ""}</span>
        Task
      </button>
      <div class="priorities" role="radiogroup" aria-label="Priority">
        {#each PRIORITIES as p (p)}
          <button
            role="radio"
            aria-checked={node.priority === p}
            class:on={node.priority === p}
            onclick={() => setPriority(vault, [nodeId], p)}
            title={node.priority === p
              ? `Take priority ${p} away (⌘${p})`
              : `Priority ${p}${p <= 3 ? ", before what has none" : ", after what has none"} (⌘${p})`}
            aria-label="Priority {p}"
          >
            <PriorityBadge priority={p} described={false} />
          </button>
        {/each}
      </div>
    </div>
    <div class="due">
      <label>
        Due
        <input
          type="date"
          value={node.due ?? ""}
          onchange={(e) => changeDue(e.currentTarget)}
          onkeydown={(e) => {
            if (e.key === "Escape" || e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      {#if node.due}
        <button class="remove" onclick={() => vault.update(nodeId, { due: null })} title="Take the due date away" aria-label="Take the due date away">×</button>
      {/if}
    </div>
    {#if centre}
      <div class="row">
        <span id="map-style">Style</span>
        <div class="choice" role="radiogroup" aria-labelledby="map-style">
          <button role="radio" aria-checked={node.layout === null} class:on={node.layout === null} onclick={() => vault.update(nodeId, { layout: null })} title="Out to both sides of the centre (⌥⌘3)">Mind map</button>
          <button role="radio" aria-checked={node.layout === "org"} class:on={node.layout === "org"} onclick={() => vault.update(nodeId, { layout: "org" })} title="Downwards from the centre, each level in a row (⌥⌘3)">Org chart</button>
        </div>
      </div>
    {/if}
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
      <!-- Leaves the focus in the notes, if they had it. -->
      <button
        class="source-toggle"
        class:on={source}
        aria-pressed={source}
        onmousedown={(e) => e.preventDefault()}
        onclick={onToggleSource}
        title={source ? "Draw the notes again (⌘E)" : "Show the notes' Markdown source (⌘E)"}
        aria-label="Markdown source">M↓</button
      >
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
    <!-- A fresh editor for each node, so its notes start at the top. -->
    {#key nodeId}
      <NoteEditor
        bind:this={editor}
        value={node.body}
        {source}
        hooks={{ found, describe, follow }}
        version={live.version}
        onChange={save}
        onPick={(start, end) => (picking = { start, end })}
        onFocus={(focused) => (writing = focused)}
      />
    {/key}
    {#if writing}
      <p class="hint">
        **bold** (⌘B), *italic* (⌘I), # heading, - list, - [ ] to do, [[a node's title]].
        ⌘L puts in a link to a node; Escape hands the keys back to the map.
      </p>
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
    flex: none;
    padding: 0.75rem 1rem 1rem;
    border-left: 1px solid var(--line);
    min-height: 0;
    overflow-y: auto;
  }

  /* Files dragged over the panel: they will be linked in the notes. */
  aside.dropping {
    background: var(--accent-soft);
    outline: 2px dashed var(--accent);
    outline-offset: -4px;
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

  .task-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .task-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.15rem 0.5rem 0.15rem 0.35rem;
    border: 1px solid var(--line);
    font-size: 0.85rem;
    color: var(--muted);
  }

  .task-toggle.on {
    color: var(--fg);
    border-color: var(--accent);
  }

  .box {
    display: inline-grid;
    place-items: center;
    width: 0.95em;
    height: 0.95em;
    border: 1.5px solid currentColor;
    border-radius: 3px;
    font-size: 0.8rem;
    line-height: 1;
  }

  .box.done {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }

  .priorities {
    display: flex;
    gap: 1px;
    margin-left: auto;
  }

  .priorities button {
    padding: 0.2rem;
    font-size: 1rem;
    line-height: 1;
    opacity: 0.4;
  }

  .priorities button:hover {
    opacity: 0.8;
  }

  .priorities button.on {
    opacity: 1;
    background: var(--accent-soft);
  }

  .due {
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }

  .due label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .due input {
    font: inherit;
    color: var(--fg);
    background: none;
    padding: 0.1rem 0.3rem;
    border: 1px solid var(--line);
    border-radius: 6px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    color: var(--muted);
  }

  .choice {
    display: inline-flex;
    padding: 2px;
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .choice button {
    padding: 0.05rem 0.5rem;
  }

  .choice button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .style {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .source-toggle {
    padding: 0.1rem 0.4rem;
    font-size: 0.8rem;
    color: var(--muted);
    border-radius: 6px;
  }

  .source-toggle.on {
    color: var(--accent);
    background: var(--accent-soft);
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

  /* Kept at the right, beside M↓, also on the centre, which has no
     swatches to take the room. */
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
