<!--
  A node's notes, edited where they are drawn (`live-preview.ts`), or as their
  Markdown source. Either way the text is the Markdown itself, handed back
  as typed; a change from outside, such as an undo, is taken in without
  moving the cursor more than it must. It has no undo of its own: ⌘Z is the
  vault's, which undoes notes with everything else.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import { commonmarkLanguage, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
  import { Language, LanguageSupport } from "@codemirror/language";
  import { Annotation, Compartment, EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
  import { EditorView, keymap, placeholder, type Command } from "@codemirror/view";
  import { defaultKeymap } from "@codemirror/commands";
  import { Table, TaskList, type MarkdownParser } from "@lezer/markdown";
  import { linkHooks, livePreview, redraw, type LinkHooks } from "./live-preview.ts";

  let {
    value,
    source,
    hooks,
    version,
    onChange,
    onPick,
    onFocus,
  }: {
    value: string;
    /** The Markdown as it is, with nothing drawn. */
    source: boolean;
    hooks: LinkHooks;
    /** Changes when the vault does, so links to nodes are drawn again. */
    version: number;
    onChange: (text: string) => void;
    /** ⌘L: a link to a node, to put in from `from` to `to`. */
    onPick: (from: number, to: number) => void;
    onFocus: (focused: boolean) => void;
  } = $props();

  let host: HTMLDivElement;
  let view = $state.raw<EditorView>();
  const preview = new Compartment();
  /**
   * Markdown with tables and checkboxes, as markdown.ts reads it: not
   * GitHub's bare www. links or strikethrough, which it does not. Made from
   * CommonMark's language rather than with `markdown()`, which would bring
   * in HTML, CSS and JavaScript for code blocks, three times the editor's
   * size; sharing its language data keeps the list keys below working.
   */
  const notesMarkdown = new LanguageSupport(
    new Language(commonmarkLanguage.data, (commonmarkLanguage.parser as MarkdownParser).configure([Table, TaskList]), [], "markdown"),
  );

  /** Marks a change that came from outside, which is not handed back. */
  const outside = Annotation.define<boolean>();

  /** ⌘B and ⌘I: the marks around what is chosen, or a pair to type between. */
  const wrap =
    (marks: string): StateCommand =>
    ({ state, dispatch }) => {
      dispatch(
        state.update(
          state.changeByRange((r) => ({
            changes: [
              { from: r.from, insert: marks },
              { from: r.to, insert: marks },
            ],
            range: EditorSelection.range(r.from + marks.length, r.to + marks.length),
          })),
        ),
      );
      return true;
    };

  /**
   * Enter on an empty "> " ends the quote, as it ends a list; CodeMirror
   * would carry it on. A blank line is left after it, or Markdown would read
   * the next line as more of the quote.
   */
  const endQuote: Command = (v) => {
    const r = v.state.selection.main;
    const line = v.state.doc.lineAt(r.head);
    if (!r.empty || !/^\s*>\s?$/.test(line.text)) return false;
    v.dispatch({ changes: { from: line.from, to: line.to, insert: "\n" }, selection: { anchor: line.from + 1 } });
    return true;
  };

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          notesMarkdown,
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Notes" }),
          placeholder("Notes"),
          linkHooks.of({
            found: (to) => hooks.found(to),
            describe: (to) => hooks.describe(to),
            follow: (to) => hooks.follow(to),
          }),
          preview.of(source ? [] : livePreview),
          EditorView.domEventHandlers({
            keydown(e, v) {
              // ⌘L here links from the notes, not the node (⌘L elsewhere).
              if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "l") {
                e.preventDefault();
                e.stopPropagation();
                const r = v.state.selection.main;
                onPick(r.from, r.to);
                return true;
              }
              return false;
            },
          }),
          keymap.of([
            // Escape hands the keyboard back to the map.
            { key: "Escape", run: (v) => (v.contentDOM.blur(), true) },
            { key: "Mod-b", run: wrap("**") },
            { key: "Mod-i", run: wrap("*") },
            // Enter carries a list or quote on; Backspace takes its mark away.
            { key: "Enter", run: endQuote },
            { key: "Enter", run: insertNewlineContinueMarkup },
            { key: "Backspace", run: deleteMarkupBackward },
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((t) => t.annotation(outside))) onChange(u.state.doc.toString());
            if (u.focusChanged) onFocus(u.view.hasFocus);
          }),
        ],
      }),
    });
    return () => view?.destroy();
  });

  // Text changed outside, by an undo, a drop or another node: only what
  // differs is replaced, so the cursor stays where it was around it.
  $effect(() => {
    const text = value;
    if (!view) return;
    const old = view.state.doc.toString();
    if (old === text) return;
    let start = 0;
    while (start < old.length && start < text.length && old[start] === text[start]) start++;
    let end = 0;
    while (end < old.length - start && end < text.length - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end++;
    view.dispatch({
      changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
      annotations: outside.of(true),
    });
  });

  $effect(() => {
    view?.dispatch({ effects: preview.reconfigure(source ? [] : livePreview) });
  });

  $effect(() => {
    void version;
    view?.dispatch({ effects: redraw.of(null) });
  });

  /** Puts the cursor in the notes, at `at` or where it was. */
  export function focus(at?: number) {
    if (!view) return;
    view.focus();
    if (at !== undefined) view.dispatch({ selection: { anchor: Math.min(at, view.state.doc.length) }, scrollIntoView: true });
  }

  /** What is chosen in the notes, kept while the focus is elsewhere. */
  export function selection(): { from: number; to: number } {
    const r = view?.state.selection.main;
    return { from: r?.from ?? 0, to: r?.to ?? 0 };
  }
</script>

<div class="editor" class:source bind:this={host}></div>

<style>
  /* Grows with the text and never shrinks under it: the panel scrolls, so
     long notes do not spill over what comes below them. */
  .editor {
    flex: 1 0 auto;
    min-height: 8rem;
    display: flex;
    border: 1px solid transparent;
    border-radius: 8px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  .editor:hover {
    border-color: var(--line);
  }

  .editor:focus-within {
    border-color: var(--accent);
  }

  .editor :global(.cm-editor) {
    flex: 1;
    min-width: 0;
    background: none;
    color: inherit;
  }

  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }

  .editor :global(.cm-scroller) {
    font: inherit;
    line-height: inherit;
  }

  .editor :global(.cm-content) {
    padding: 0.6rem 0;
    caret-color: var(--accent);
  }

  .editor :global(.cm-line) {
    padding: 0 0.7rem;
  }

  .editor :global(.cm-placeholder) {
    color: var(--muted);
  }

  .editor :global(.cm-selectionBackground),
  .editor :global(.cm-content ::selection) {
    background: color-mix(in srgb, var(--accent) 25%, transparent) !important;
  }

  .source :global(.cm-scroller) {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
  }

  /* What the live preview draws. */
  .editor :global(.cm-h1),
  .editor :global(.cm-h2),
  .editor :global(.cm-h3) {
    font-weight: 600;
    line-height: 1.3;
    padding-top: 0.35em;
  }

  .editor :global(.cm-h1) {
    font-size: 1.25rem;
  }

  .editor :global(.cm-h2) {
    font-size: 1.1rem;
  }

  .editor :global(.cm-strong) {
    font-weight: 600;
  }

  .editor :global(.cm-em) {
    font-style: italic;
  }

  .editor :global(.cm-code),
  .editor :global(.cm-table code) {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
    padding: 0.1em 0.3em;
    border-radius: 4px;
    background: var(--accent-soft);
  }

  .editor :global(.cm-codeblock) {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
    background: var(--accent-soft);
  }

  .editor :global(.cm-fence) {
    color: var(--muted);
  }

  .editor :global(.cm-quote) {
    color: var(--muted);
    border-left: 3px solid var(--line);
    padding-left: calc(0.7rem - 3px + 0.7em);
  }

  .editor :global(.cm-hr) {
    background: linear-gradient(var(--line), var(--line)) center / calc(100% - 1.4rem) 1px no-repeat;
  }

  .editor :global(.cm-bullet) {
    color: var(--muted);
  }

  .editor :global(.cm-checkbox) {
    margin: 0 0.3em 0 0;
    vertical-align: -0.1em;
    cursor: pointer;
  }

  .editor :global(.cm-done) {
    color: var(--muted);
    text-decoration: line-through;
  }

  .editor :global(.cm-link) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .editor :global(.cm-link.editing) {
    cursor: text;
  }

  .editor :global(.cm-link.node:not(.editing))::before,
  .editor :global(.cm-link.title:not(.editing))::before {
    content: "↗";
    font-size: 0.85em;
    margin-right: 0.1em;
    display: inline-block;
  }

  .editor :global(.cm-link.missing) {
    color: var(--muted);
    text-decoration: line-through;
    cursor: default;
  }

  /* A file in a browser, which cannot open it: it may well be there. */
  .editor :global(.cm-link.file.missing) {
    text-decoration: none;
  }

  /* A wide table scrolls in its own box instead of widening the panel. */
  .editor :global(.cm-table) {
    padding: 0.2rem 0.7rem;
    overflow-x: auto;
    cursor: text;
  }

  .editor :global(.cm-table table) {
    border-collapse: collapse;
    font-size: 0.92em;
  }

  .editor :global(.cm-table th),
  .editor :global(.cm-table td) {
    padding: 0.25em 0.6em;
    border: 1px solid var(--line);
    text-align: left;
    overflow-wrap: normal;
  }

  .editor :global(.cm-table th) {
    background: var(--accent-soft);
    font-weight: 600;
  }
</style>
