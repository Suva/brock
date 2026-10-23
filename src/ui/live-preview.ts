// Notes drawn where they are written, as in Obsidian: the text being edited
// is the Markdown itself, and the marks around what it means (**, #, [](),
// > and the like) are hidden, and the result drawn, except where the cursor
// is, which shows them to edit. Nothing is ever rewritten, so a note stays as
// typed. Turned off, what is left is the Markdown source.
//
// What it draws follows markdown.ts, which reads notes everywhere else: the
// same headings, lists, checkboxes, quotes, code, rules and tables, and the
// same links (only web addresses, files, nodes and the panels' commands).

import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Facet, StateEffect, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { bareLinks, filePath, linkTarget, parse, type Found, type Inline, type LinkTarget } from "../core/markdown.ts";

/** What the editor asks the panel about links, and tells it. */
export interface LinkHooks {
  /** Whether a link's target is there to go to. */
  found: (to: LinkTarget) => boolean;
  describe: (to: LinkTarget) => string;
  follow: (to: LinkTarget) => void;
}

export const linkHooks = Facet.define<LinkHooks, LinkHooks>({
  combine: (all) => all[0] ?? { found: () => false, describe: () => "", follow: () => {} },
});

/** Draws the links again: whether their nodes are there may have changed outside the editor. */
export const redraw = StateEffect.define<null>();

interface Drawn {
  decorations: DecorationSet;
  /** The links drawn as links, not being edited: what a click follows. */
  links: Found[];
}

/** Whether the notes have the keyboard: the cursor shows marks only then. */
const focusChanged = StateEffect.define<boolean>();
const focused = StateField.define<boolean>({
  create: () => false,
  update: (on, tr) => tr.effects.find((e) => e.is(focusChanged))?.value ?? on,
});

const field = StateField.define<Drawn>({
  create: draw,
  update(drawn, tr) {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(redraw) || e.is(focusChanged))) return draw(tr.state);
    return drawn;
  },
  provide: (f) => EditorView.decorations.from(f, (d) => d.decorations),
});

/** Follows a link clicked where it is drawn as one. */
const clicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0 || event.shiftKey) return false;
    const el = (event.target as HTMLElement).closest?.(".cm-link");
    if (!el || !view.contentDOM.contains(el)) return false;
    const at = view.posAtDOM(el);
    const link = view.state.field(field).links.find((l) => at >= l.from && at <= l.to);
    const hooks = view.state.facet(linkHooks);
    if (!link) return false;
    event.preventDefault();
    if (hooks.found(link.target)) hooks.follow(link.target);
    return true;
  },
});

/** The live preview; leave it out for the source. */
export const livePreview = [focused, EditorView.focusChangeEffect.of((_, on) => focusChanged.of(on)), field, clicks];

function draw(state: EditorState): Drawn {
  const hooks = state.facet(linkHooks);
  const doc = state.doc;
  const tree = ensureSyntaxTree(state, doc.length, 100) ?? syntaxTree(state);
  const out: Range<Decoration>[] = [];
  const links: Found[] = [];
  /** Lines that hold code or a table drawn whole, which have no links of their own to find. */
  const skip = new Set<number>();

  const editing = state.field(focused, false) ?? false;
  const touches = (from: number, to: number) => editing && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  const lineTouched = (at: number) => {
    const line = doc.lineAt(at);
    return touches(line.from, line.to);
  };
  const hide = (from: number, to: number) => {
    if (to > from) out.push(Decoration.replace({}).range(from, to));
  };
  const mark = (cls: string, from: number, to: number, attributes?: Record<string, string>) => {
    if (to > from) out.push(Decoration.mark({ class: cls, attributes }).range(from, to));
  };
  const lines = (cls: string, from: number, to: number) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) out.push(Decoration.line({ class: cls }).range(doc.line(n).from));
  };
  /** A mark and the space after it, as in "# " and "> ". */
  const hideWithSpace = (m: SyntaxNode) => hide(m.from, doc.sliceString(m.to, m.to + 1) === " " ? m.to + 1 : m.to);
  const link = (target: LinkTarget, from: number, to: number, textFrom: number, textTo: number) => {
    const found = hooks.found(target);
    mark(found ? `cm-link ${target.kind}` : `cm-link ${target.kind} missing`, textFrom, textTo, { title: hooks.describe(target) });
    links.push({ from, to, target });
  };

  tree.iterate({
    enter(ref) {
      const node = ref.node;
      const name = node.name;
      const heading = /^ATXHeading(\d)$/.exec(name);
      if (heading) {
        lines(`cm-h${Math.min(Number(heading[1]), 3)}`, node.from, node.from);
        const first = node.firstChild;
        if (first?.name === "HeaderMark" && !lineTouched(node.from)) hideWithSpace(first);
      } else if (name === "StrongEmphasis" || name === "Emphasis") {
        mark(name === "StrongEmphasis" ? "cm-strong" : "cm-em", node.from, node.to);
        if (!touches(node.from, node.to)) for (const m of node.getChildren("EmphasisMark")) hide(m.from, m.to);
      } else if (name === "InlineCode") {
        mark("cm-code", node.from, node.to);
        if (!touches(node.from, node.to)) for (const m of node.getChildren("CodeMark")) hide(m.from, m.to);
        return false;
      } else if (name === "Link") {
        const marks = node.getChildren("LinkMark");
        const url = node.getChild("URL");
        const target = url && linkTarget(doc.sliceString(url.from, url.to).replace(/^<(.*)>$/, "$1").trim());
        if (!target || marks.length < 2) return;
        if (touches(node.from, node.to)) {
          mark(`cm-link ${target.kind} editing`, marks[0].to, marks[1].from);
        } else {
          link(target, node.from, node.to, marks[0].to, marks[1].from);
          hide(node.from, marks[0].to);
          hide(marks[1].from, node.to);
        }
      } else if (name === "Blockquote") {
        lines("cm-quote", node.from, node.to);
      } else if (name === "QuoteMark") {
        if (!lineTouched(node.from)) hideWithSpace(node);
      } else if (name === "FencedCode" || name === "CodeBlock") {
        lines("cm-codeblock", node.from, node.to);
        for (const m of node.getChildren("CodeMark")) lines("cm-fence", m.from, m.from);
        for (let n = doc.lineAt(node.from).number; n <= doc.lineAt(node.to).number; n++) skip.add(n);
        return false;
      } else if (name === "ListMark") {
        const item = node.parent;
        const task = item?.getChild("Task");
        if (touches(node.from, node.to + 1)) return;
        if (task) hideWithSpace(node);
        else if (item?.parent?.name === "BulletList") out.push(Decoration.replace({ widget: new Bullet() }).range(node.from, node.to));
      } else if (name === "TaskMarker") {
        const checked = /x/i.test(doc.sliceString(node.from, node.to));
        if (checked && node.parent) mark("cm-done", node.to, node.parent.to);
        if (!touches(node.from, node.to)) out.push(Decoration.replace({ widget: new Checkbox(checked, node.from) }).range(node.from, node.to));
      } else if (name === "HorizontalRule") {
        if (!lineTouched(node.from)) {
          lines("cm-hr", node.from, node.from);
          hide(node.from, node.to);
        }
      } else if (name === "Table" && node.parent?.name === "Document") {
        // Only a table of its own is drawn whole: markdown.ts, which draws
        // it, reads no tables inside quotes or lists.
        const from = doc.lineAt(node.from).from;
        const to = doc.lineAt(node.to).to;
        if (touches(from, to)) return;
        out.push(Decoration.replace({ widget: new Table(doc.sliceString(from, to)), block: true }).range(from, to));
        for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) skip.add(n);
        return false;
      }
    },
  });

  // [[Title]]s and addresses written out, which the syntax tree does not know.
  for (let n = 1; n <= doc.lines; n++) {
    if (skip.has(n)) continue;
    const line = doc.line(n);
    for (const f of bareLinks(line.text)) {
      const from = line.from + f.from;
      const to = line.from + f.to;
      if (touches(from, to)) {
        mark(`cm-link ${f.target.kind} editing`, from, to);
      } else if (f.target.kind === "title") {
        link(f.target, from, to, from + 2, to - 2);
        hide(from, from + 2);
        hide(to - 2, to);
      } else if (f.target.kind === "file") {
        // file:///Users/me/My%20Designs reads as /Users/me/My Designs.
        const found = hooks.found(f.target);
        const widget = new Text(filePath(f.target.url), `cm-link file${found ? "" : " missing"}`, hooks.describe(f.target));
        out.push(Decoration.replace({ widget }).range(from, to));
        links.push({ from, to, target: f.target });
      } else {
        link(f.target, from, to, from, to);
      }
    }
  }

  return { decorations: Decoration.set(out, true), links };
}

class Bullet extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    return span;
  }
}

class Text extends WidgetType {
  text: string;
  cls: string;
  title: string;
  constructor(text: string, cls: string, title: string) {
    super();
    this.text = text;
    this.cls = cls;
    this.title = title;
  }
  eq(other: Text) {
    return other.text === this.text && other.cls === this.cls && other.title === this.title;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = this.cls;
    span.title = this.title;
    span.textContent = this.text;
    return span;
  }
}

/** A task's [ ] or [x] as a box to tick, which writes the x or takes it away. */
class Checkbox extends WidgetType {
  checked: boolean;
  at: number;
  constructor(checked: boolean, at: number) {
    super();
    this.checked = checked;
    this.at = at;
  }
  eq(other: Checkbox) {
    return other.checked === this.checked && other.at === this.at;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-checkbox";
    box.checked = this.checked;
    box.ariaLabel = "Done";
    // The box keeps the cursor where it was, so the note goes on being read.
    box.addEventListener("mousedown", (e) => e.preventDefault());
    box.addEventListener("click", () => {
      view.dispatch({ changes: { from: this.at + 1, to: this.at + 2, insert: this.checked ? " " : "x" } });
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/** A table drawn whole, from markdown.ts; a click outside its links goes into its text, to edit it. */
class Table extends WidgetType {
  source: string;
  constructor(source: string) {
    super();
    this.source = source;
  }
  eq(other: Table) {
    return other.source === this.source;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-table";
    const block = parse(this.source)[0];
    if (block?.kind !== "table") {
      wrap.textContent = this.source;
      return wrap;
    }
    const table = wrap.appendChild(document.createElement("table"));
    const row = (cells: Inline[][], tag: "th" | "td", parent: HTMLElement) => {
      const tr = parent.appendChild(document.createElement("tr"));
      cells.forEach((cell, i) => {
        const td = tr.appendChild(document.createElement(tag));
        if (block.align[i]) td.style.textAlign = block.align[i]!;
        spans(cell, td, view);
      });
    };
    row(block.head, "th", table.appendChild(document.createElement("thead")));
    const body = table.appendChild(document.createElement("tbody"));
    for (const r of block.rows) row(r, "td", body);
    return wrap;
  }
  ignoreEvent(event: Event) {
    return (event.target as HTMLElement).closest?.(".cm-link") !== null;
  }
}

/** Spans of a table's cell, as elements: never as HTML. */
function spans(list: Inline[], parent: HTMLElement, view: EditorView): void {
  for (const span of list) {
    if (span.kind === "text") parent.append(span.text);
    else if (span.kind === "code") parent.appendChild(document.createElement("code")).textContent = span.text;
    else if (span.kind === "strong" || span.kind === "em") spans(span.children, parent.appendChild(document.createElement(span.kind)), view);
    else if (span.kind === "link") {
      const hooks = view.state.facet(linkHooks);
      const to = span.to;
      const a = parent.appendChild(document.createElement("span"));
      const found = hooks.found(to);
      a.className = `cm-link ${to.kind}${found ? "" : " missing"}`;
      a.title = hooks.describe(to);
      a.addEventListener("mousedown", (e) => e.preventDefault());
      a.addEventListener("click", () => found && hooks.follow(to));
      spans(span.children, a, view);
    }
  }
}
