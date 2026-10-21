// Taking a map out of the vault and bringing outlines in.
//
// Out: JSON keeps everything (maps, links, colours, icons) and comes back in
// whole; Markdown is a nested list with the notes under each item, for
// reading anywhere; OPML is the outline format that other outliners and mind
// map apps read and write.
//
// In: OPML, from those apps, and this app's own JSON. What comes in is added
// under one node, as one step that can be undone.

import { newBranch } from "./branches.ts";
import type { Node } from "./node.ts";
import type { Vault } from "./vault.ts";

/** A branch as it goes out and comes in, independent of the vault's ids. */
export interface Outline {
  title: string;
  body: string;
  isMap: boolean;
  collapsed: boolean;
  color: string | null;
  icon: string | null;
  /** Its id in the vault it came from, so that links between nodes can be made again. */
  id: string | null;
  links: string[];
  task: "open" | "done" | null;
  doneAt: number | null;
  priority: number | null;
  children: Outline[];
}

const FORMAT = "brock";
/** The format's name before the app was called Brock: files exported then still come in. */
const OLD_FORMATS = ["mindmap"];
const FORMAT_VERSION = 1;

/** The branch from `id` down, without what is deleted. */
export function outlineOf(vault: Vault, id: string): Outline {
  const node = vault.get(id)!;
  return {
    title: node.title,
    body: node.body,
    isMap: node.isMap,
    collapsed: node.collapsed,
    color: node.color,
    icon: node.icon,
    id: node.id,
    links: node.links.filter((l) => vault.isLive(l)),
    task: node.task,
    doneAt: node.doneAt,
    priority: node.priority,
    children: vault.children(id).map((child) => outlineOf(vault, child.id)),
  };
}

// ---- Out ---------------------------------------------------------------------

export function toJSON(vault: Vault, id: string, now = Date.now()): string {
  const file = { format: FORMAT, version: FORMAT_VERSION, exportedAt: new Date(now).toISOString(), root: outlineOf(vault, id) };
  return JSON.stringify(file, null, 2) + "\n";
}

export function toMarkdown(vault: Vault, id: string): string {
  const root = outlineOf(vault, id);
  const lines: string[] = [`# ${label(root)}`, ""];
  if (root.body.trim()) lines.push(root.body.trim(), "");
  return lines.join("\n") + "\n" + markdownList(root.children);
}

/**
 * Outlines as a nested Markdown list: an item for each, `[ ]` or `[x]` for
 * tasks, notes indented under their item. What a copy puts on the clipboard
 * for other apps, and the body of a Markdown export.
 */
export function markdownList(outlines: Outline[]): string {
  const lines: string[] = [];
  const item = (o: Outline, depth: number) => {
    const indent = "  ".repeat(depth);
    const box = o.task === "done" ? "[x] " : o.task === "open" ? "[ ] " : "";
    lines.push(`${indent}- ${box}${label(o)}`);
    // Notes go under their item, indented to stay part of it.
    for (const line of o.body.trim() ? o.body.trim().split("\n") : []) lines.push(line ? `${indent}  ${line}` : "");
    for (const child of o.children) item(child, depth + 1);
  };
  for (const o of outlines) item(o, 0);
  return lines.join("\n") + (lines.length ? "\n" : "");
}

/**
 * Text pasted from elsewhere, read as outlines: OPML, this app's JSON, or
 * lines of text. In lines, indentation nests them; Markdown bullets and
 * checkboxes are understood, and when there are bullets, lines without one
 * are the notes of the item above.
 */
export function fromText(text: string): Outline[] {
  const start = text.trimStart();
  if (start.startsWith("<")) {
    try {
      return fromOPML(start);
    } catch {
      // Not OPML after all: read it as lines.
    }
  }
  if (start.startsWith("{")) {
    try {
      return [fromJSON(start)];
    } catch {
      // Not ours: read it as lines.
    }
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  const bullet = /^(?:[-*+]|\d+[.)])\s+/;
  const anyBullets = lines.some((l) => bullet.test(l.trim()));
  const top: Outline[] = [];
  const open: { outline: Outline; indent: number }[] = [];
  const indentOf = (l: string) => l.match(/^[ \t]*/)![0].replace(/\t/g, "    ").length;
  for (const line of lines) {
    const indent = indentOf(line);
    let rest = line.trim();
    if (anyBullets && !bullet.test(rest) && !rest.startsWith("#") && open.length) {
      // A line without a bullet belongs to the item above, as its notes.
      const last = open.at(-1)!.outline;
      last.body = last.body ? `${last.body}\n${rest}` : rest;
      continue;
    }
    rest = rest.replace(bullet, "").replace(/^#+\s*/, "");
    const box = /^\[([ xX])\]\s+/.exec(rest);
    if (box) rest = rest.slice(box[0].length);
    const outline: Outline = {
      title: rest,
      body: "",
      isMap: false,
      collapsed: false,
      color: null,
      icon: null,
      id: null,
      links: [],
      task: box ? (box[1] === " " ? "open" : "done") : null,
      doneAt: null,
      priority: null,
      children: [],
    };
    while (open.length && open.at(-1)!.indent >= indent) open.pop();
    (open.at(-1)?.outline.children ?? top).push(outline);
    open.push({ outline, indent });
  }
  return top;
}

export function toOPML(vault: Vault, id: string): string {
  const root = outlineOf(vault, id);
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<opml version="2.0">', "  <head>", `    <title>${escape(root.title)}</title>`, "  </head>", "  <body>"];
  const outline = (o: Outline, depth: number) => {
    const indent = "  ".repeat(depth + 2);
    const attrs = `text="${escape(label(o))}"${o.body ? ` _note="${escape(o.body)}"` : ""}`;
    if (o.children.length === 0) out.push(`${indent}<outline ${attrs}/>`);
    else {
      out.push(`${indent}<outline ${attrs}>`);
      for (const child of o.children) outline(child, depth + 1);
      out.push(`${indent}</outline>`);
    }
  };
  outline(root, 0);
  out.push("  </body>", "</opml>");
  return out.join("\n") + "\n";
}

/** A title with its icon, for formats that have no place for an icon. */
function label(o: Outline): string {
  return (o.icon ? `${o.icon} ` : "") + (o.title || "Untitled");
}

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\n/g, "&#10;");
}

// ---- In ----------------------------------------------------------------------

/** The outlines of a file, read by what it looks like; an error says what is wrong with it. */
export function readOutlines(text: string): Outline[] {
  const start = text.trimStart();
  if (start.startsWith("{")) return [fromJSON(start)];
  if (start.startsWith("<")) return fromOPML(start);
  throw new Error("This is not an OPML file or one exported from this app.");
}

export function fromJSON(text: string): Outline {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const f = file as { format?: unknown; version?: unknown; root?: unknown };
  if (f.format !== FORMAT && !OLD_FORMATS.includes(f.format as string)) {
    throw new Error("This JSON was not exported from this app.");
  }
  if (typeof f.version !== "number" || f.version > FORMAT_VERSION) {
    throw new Error("This file is from a newer version of the app. Update the app to bring it in.");
  }
  return checked(f.root);
}

/** An outline read from a file, checked field by field: a file can hold anything. */
function checked(raw: unknown): Outline {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    title: str(o.title) ?? "",
    body: str(o.body) ?? "",
    isMap: o.isMap === true,
    collapsed: o.collapsed === true,
    color: str(o.color),
    icon: str(o.icon),
    id: str(o.id),
    links: Array.isArray(o.links) ? o.links.filter((l): l is string => typeof l === "string") : [],
    task: o.task === "open" || o.task === "done" ? o.task : null,
    doneAt: typeof o.doneAt === "number" ? o.doneAt : null,
    priority: typeof o.priority === "number" && o.priority >= 1 && o.priority <= 5 ? Math.round(o.priority) : null,
    children: Array.isArray(o.children) ? o.children.map(checked) : [],
  };
}

/** The outlines in an OPML file's body. Only <outline> elements are read. */
export function fromOPML(xml: string): Outline[] {
  const top: Outline[] = [];
  const open: Outline[] = [];
  let inBody = false;
  const tag = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[?!][^>]*>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  for (const m of xml.matchAll(tag)) {
    const [, closing, name, attrText, selfClosing] = m;
    if (!name) continue;
    const lower = name.toLowerCase();
    if (lower === "body") inBody = !closing;
    if (lower !== "outline" || !inBody) continue;
    if (closing) {
      open.pop();
      continue;
    }
    const attrs = attributes(attrText ?? "");
    const outline: Outline = {
      title: attrs.text ?? attrs.title ?? "",
      body: attrs._note ?? attrs.note ?? "",
      isMap: false,
      collapsed: false,
      color: null,
      icon: null,
      id: null,
      links: [],
      task: null,
      doneAt: null,
      priority: null,
      children: [],
    };
    (open.at(-1)?.children ?? top).push(outline);
    if (!selfClosing) open.push(outline);
  }
  if (!xml.includes("<opml")) throw new Error("This is not an OPML file.");
  return top;
}

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = entities(m[2] ?? m[3] ?? "");
  return out;
}

function entities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, e: string) => {
    const lower = e.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[lower] ?? whole;
  });
}

/**
 * Adds outlines as children of `parentId`, last, in one step, and returns
 * the nodes made for them. Links among them are made again between the new
 * nodes; links to nodes not brought in are dropped, unless `keepLinks` says
 * the node is there to link to, as when pasting a copy in the same vault. A
 * child of the centre `centreId` is given a side and colour like any new
 * branch.
 */
export function importInto(
  vault: Vault,
  parentId: string,
  outlines: Outline[],
  centreId: string,
  keepLinks: (id: string) => boolean = () => false,
): Node[] {
  return vault.transact(() => {
    const newId = new Map<string, string>();
    const made: { node: Node; links: string[] }[] = [];
    const add = (o: Outline, parent: string): Node => {
      const branch = parent === centreId ? newBranch(vault.children(parent)) : {};
      const node = vault.addChild(parent, {
        ...branch,
        title: o.title,
        body: o.body,
        collapsed: o.collapsed,
        icon: o.icon,
        task: o.task,
        doneAt: o.task === "done" ? o.doneAt : null,
        priority: o.priority,
        ...(o.color ? { color: o.color } : {}),
      });
      if (o.id) newId.set(o.id, node.id);
      made.push({ node, links: o.links });
      for (const child of o.children) add(child, node.id);
      if (o.isMap) vault.setMap(node.id, true);
      return node;
    };
    const tops = outlines.map((o) => add(o, parentId));
    for (const { node, links } of made) {
      for (const old of links) {
        const to = newId.get(old) ?? (keepLinks(old) ? old : undefined);
        if (to) vault.link(node.id, to);
      }
    }
    return tops.map((n) => vault.get(n.id)!);
  });
}
