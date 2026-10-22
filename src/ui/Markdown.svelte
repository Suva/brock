<!--
  A note's Markdown, drawn from the blocks and spans `markdown.ts` reads it
  into: never as HTML, so nothing in a note reaches the page as markup.
  Links are buttons that hand their target back; a link to a node that is
  not there is drawn struck through.
-->
<script lang="ts">
  import type { Block, Inline, LinkTarget } from "../core/markdown.ts";

  let {
    blocks,
    found,
    onLink,
    onCheck,
  }: {
    blocks: Block[];
    /** Whether a link's target is there to go to. */
    found: (to: LinkTarget) => boolean;
    onLink: (to: LinkTarget) => void;
    /** A checkbox on `line` of the text was ticked or cleared. */
    onCheck: (line: number, checked: boolean) => void;
  } = $props();

  function describe(to: LinkTarget): string {
    if (to.kind === "web") return `Open ${to.url} in the browser`;
    if (!found(to)) return to.kind === "title" ? `No node is called “${to.title}”` : "That node is gone";
    return "Go there";
  }
</script>

{#snippet spans(list: Inline[])}
  {#each list as span, i (i)}
    {#if span.kind === "text"}{span.text}{:else if span.kind === "code"}<code>{span.text}</code>{:else if span.kind === "strong"}<strong
        >{@render spans(span.children)}</strong
      >{:else if span.kind === "em"}<em>{@render spans(span.children)}</em>{:else if span.kind === "link"}<button
        type="button"
        class="link {span.to.kind}"
        class:missing={!found(span.to)}
        title={describe(span.to)}
        onclick={(e) => {
          e.stopPropagation();
          if (found(span.to)) onLink(span.to);
        }}>{#if span.to.kind !== "web"}<span class="arrow" aria-hidden="true">↗</span>{/if}{@render spans(
          span.children,
        )}</button
      >{/if}
  {/each}
{/snippet}

<div class="markdown">
  {#each blocks as block, i (i)}
    {#if block.kind === "heading"}
      {#if block.level === 1}<h1>{@render spans(block.children)}</h1>
      {:else if block.level === 2}<h2>{@render spans(block.children)}</h2>
      {:else}<h3>{@render spans(block.children)}</h3>{/if}
    {:else if block.kind === "paragraph"}
      <p>{@render spans(block.children)}</p>
    {:else if block.kind === "quote"}
      <blockquote>{@render spans(block.children)}</blockquote>
    {:else if block.kind === "code"}
      <pre><code>{block.text}</code></pre>
    {:else if block.kind === "rule"}
      <hr />
    {:else if block.kind === "table"}
      <div class="table">
        <table>
          <thead>
            <tr>
              {#each block.head as cell, c (c)}<th style:text-align={block.align[c]}>{@render spans(cell)}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each block.rows as row, r (r)}
              <tr>
                {#each row as cell, c (c)}<td style:text-align={block.align[c]}>{@render spans(cell)}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if block.kind === "list"}
      <svelte:element this={block.ordered ? "ol" : "ul"} class:checklist={block.items.some((it) => it.checked !== null)}>
        {#each block.items as item (item.line)}
          <li class:done={item.checked === true}>
            {#if item.checked !== null}
              <input
                type="checkbox"
                checked={item.checked}
                aria-label="Done"
                onclick={(e) => e.stopPropagation()}
                onchange={(e) => onCheck(item.line, e.currentTarget.checked)}
              />
            {/if}
            <span>{@render spans(item.children)}</span>
          </li>
        {/each}
      </svelte:element>
    {/if}
  {/each}
</div>

<style>
  .markdown {
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .markdown > :first-child {
    margin-top: 0;
  }

  .markdown > :last-child {
    margin-bottom: 0;
  }

  h1,
  h2,
  h3 {
    margin: 0.9em 0 0.3em;
    line-height: 1.25;
  }

  h1 {
    font-size: 1.25rem;
  }

  h2 {
    font-size: 1.1rem;
  }

  h3 {
    font-size: 1rem;
  }

  p,
  blockquote,
  pre,
  ul,
  ol {
    margin: 0.5em 0;
  }

  ul,
  ol {
    padding-left: 1.3em;
  }

  ul.checklist {
    list-style: none;
    padding-left: 0.1em;
  }

  ul.checklist li {
    display: flex;
    align-items: baseline;
    gap: 0.4em;
  }

  li.done > span {
    color: var(--muted);
    text-decoration: line-through;
  }

  blockquote {
    padding-left: 0.7em;
    border-left: 3px solid var(--line);
    color: var(--muted);
  }

  code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
    padding: 0.1em 0.3em;
    border-radius: 4px;
    background: var(--accent-soft);
  }

  pre {
    padding: 0.6em 0.7em;
    border-radius: 6px;
    background: var(--accent-soft);
    overflow-x: auto;
  }

  pre code {
    padding: 0;
    background: none;
  }

  /* A wide table scrolls in its own box instead of widening the panel. */
  .table {
    margin: 0.5em 0;
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    font-size: 0.92em;
  }

  th,
  td {
    padding: 0.25em 0.6em;
    border: 1px solid var(--line);
    text-align: left;
    overflow-wrap: normal;
  }

  th {
    background: var(--accent-soft);
    font-weight: 600;
  }

  hr {
    border: none;
    border-top: 1px solid var(--line);
    margin: 0.8em 0;
  }

  .link {
    display: inline;
    font: inherit;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    text-align: left;
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .link:hover {
    text-decoration-color: var(--accent);
  }

  .link.missing {
    color: var(--muted);
    text-decoration: line-through;
    cursor: default;
  }

  .arrow {
    font-size: 0.85em;
    margin-right: 0.1em;
    text-decoration: none;
    display: inline-block;
  }
</style>
