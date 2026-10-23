// The Markdown of a node's notes, read into blocks and spans for the window
// to draw. It is never turned into HTML, so nothing written in a note can
// put markup or scripts in the window.
//
// What it knows: headings (#, ##, ###), paragraphs, lists (-, *, 1.) with
// checkboxes ([ ] and [x]), quotes (>), code blocks (```), rules (---), tables
// (| a | b | over a |---|---| line), and
// in a line: **bold**, *italic* or _italic_, `code`, [text](address), web
// addresses written out, files and folders on this computer as file:///path,
// written out or as [text](<file:///a path with spaces>), links to nodes, as
// [text](node:id) or [[Title]], and links to the window's own panels, as
// [text](brock:tasks).

import { trimUrl } from "./urls.ts";

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong" | "em"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; to: LinkTarget; children: Inline[] };

export type LinkTarget =
  | { kind: "web"; url: string }
  /** A file or folder on this computer, as a file: address; opened only through the app's own rules. */
  | { kind: "file"; url: string }
  /** A node by its id: stays right when the node is renamed. */
  | { kind: "node"; id: string }
  /** A node by its title, as typed in [[ ]]; found when drawn. */
  | { kind: "title"; title: string }
  /** One of the window's panels, from a fixed list: a note can show a way around the app, never run anything else. */
  | { kind: "command"; command: Command };

/** What a brock: link opens, by the name written after it. */
export const COMMANDS = {
  tasks: "Show the tasks in the sidebar",
  maps: "Show every map in the sidebar",
  search: "Search everything",
  settings: "Open the settings",
  trash: "Open the trash",
} as const;

export type Command = keyof typeof COMMANDS;

const isCommand = (name: string): name is Command => Object.hasOwn(COMMANDS, name);

export interface ListItem {
  children: Inline[];
  /** True or false for a checkbox, null without one. */
  checked: boolean | null;
  /** The line of the text it is on, for ticking its box. */
  line: number;
}

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "list"; ordered: boolean; items: ListItem[] }
  | { kind: "quote"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "rule" }
  | { kind: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] };

const LIST_ITEM = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const CHECKBOX = /^\[([ xX])\]\s+(.*)$/;

export function parse(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
    } else if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) code.push(lines[i++]);
      i++; // The closing fence, if there is one.
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (isTableStart(lines, i)) {
      const align = cells(lines[i + 1]).map(alignment);
      const head = cells(line).map(inline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        const row = cells(lines[i++]).map(inline);
        // Rows are made as wide as the header: short ones padded, long ones cut.
        while (row.length < head.length) row.push([]);
        rows.push(row.slice(0, head.length));
      }
      blocks.push({ kind: "table", align, head, rows });
    } else if (/^#{1,3}\s/.test(line)) {
      const level = line.match(/^#+/)![0].length as 1 | 2 | 3;
      blocks.push({ kind: "heading", level, children: inline(line.slice(level).trim()) });
      i++;
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
    } else if (line.trimStart().startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith(">")) {
        quote.push(lines[i++].trimStart().replace(/^>\s?/, ""));
      }
      blocks.push({ kind: "quote", children: inline(quote.join(" ")) });
    } else if (LIST_ITEM.test(line)) {
      const ordered = LIST_ITEM.exec(line)![2] !== undefined;
      const items: ListItem[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i]);
        if (!m || (m[2] !== undefined) !== ordered) break;
        const box = CHECKBOX.exec(m[3]);
        items.push({
          children: inline(box ? box[2] : m[3]),
          checked: box ? box[1] !== " " : null,
          line: i,
        });
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i].trim() !== "" && !startsBlock(lines[i]) && !isTableStart(lines, i)) para.push(lines[i++].trim());
      blocks.push({ kind: "paragraph", children: inline(para.join(" ")) });
    }
  }
  return blocks;
}

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/** A table starts with a line of cells, then a line of dashes with as many. */
function isTableStart(lines: string[], i: number): boolean {
  const next = lines[i + 1];
  if (next === undefined || !lines[i].includes("|") || !next.includes("-") || !TABLE_RULE.test(next)) return false;
  return cells(lines[i]).length === cells(next).length;
}

/** The text of each cell of a table's line; a \| is a bar in the text. */
function cells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function alignment(rule: string): Align {
  const left = rule.startsWith(":");
  const right = rule.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

function startsBlock(line: string): boolean {
  return /^#{1,3}\s/.test(line) || LIST_ITEM.test(line) || /^\s*(>|```)/.test(line);
}

// Code is taken out of a line first, so that nothing around it can reach in.
// The rest is one pattern, tried left to right: what comes first wins.
const INLINE = new RegExp(
  [
    /\[\[([^\]]+)\]\]/.source, // 1: [[Title]]
    /\[([^\]]+)\]\((?:<([^<>]+)>|([^)\s]+))\)/.source, // 2, 3 or 4: [text](<target>) or [text](target)
    /\*\*(.+?)\*\*/.source, // 5: bold
    /\*(.+?)\*/.source, // 6: italic
    /(?<![\p{L}\p{N}])_(.+?)_(?![\p{L}\p{N}])/u.source, // 7: italic, not inside words like snake_case
    /((?:https?|file):\/\/[^\s<>"'`]+)/.source, // 8: an address written out
  ].join("|"),
  "gu",
);

export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const parts = text.split(/`([^`]+)`/);
  parts.forEach((part, i) => {
    // Every other piece of the split is the inside of a code span.
    if (i % 2 === 1) out.push({ kind: "code", text: part });
    else for (const span of spans(part)) append(out, span);
  });
  return out;
}

/** Adds a span, joining text to text before it. */
function append(out: Inline[], span: Inline): void {
  const last = out.at(-1);
  if (span.kind === "text" && last?.kind === "text") last.text += span.text;
  else if (span.kind !== "text" || span.text) out.push(span);
}

function spans(text: string): Inline[] {
  const out: Inline[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    append(out, { kind: "text", text: text.slice(at, m.index) });
    at = m.index + m[0].length;
    if (m[1] !== undefined) {
      const title = m[1].trim();
      out.push({ kind: "link", to: { kind: "title", title }, children: [{ kind: "text", text: title }] });
    } else if (m[2] !== undefined) {
      const to = linkTarget((m[3] ?? m[4]).trim());
      if (to) out.push({ kind: "link", to, children: inline(m[2]) });
      else append(out, { kind: "text", text: m[0] });
    } else if (m[5] !== undefined) out.push({ kind: "strong", children: inline(m[5]) });
    else if (m[6] !== undefined || m[7] !== undefined) out.push({ kind: "em", children: inline(m[6] ?? m[7]) });
    else if (m[8] !== undefined) {
      // Punctuation after an address is the sentence's: give it back.
      const url = trimUrl(m[8]);
      const to = linkTarget(url)!;
      out.push({ kind: "link", to, children: [{ kind: "text", text: to.kind === "file" ? filePath(url) : url }] });
      at -= m[8].length - url.length;
    }
  }
  append(out, { kind: "text", text: text.slice(at) });
  return out;
}

/** What a [text](target) leads to; null for anything but web addresses, files, nodes and the commands known. */
export function linkTarget(raw: string): LinkTarget | null {
  if (/^https?:\/\//i.test(raw)) return { kind: "web", url: raw };
  if (/^file:\/\/\S/i.test(raw)) return { kind: "file", url: raw };
  if (raw.startsWith("node:") && raw.length > 5) return { kind: "node", id: raw.slice(5) };
  const command = raw.match(/^brock:(\w+)$/i)?.[1].toLowerCase();
  if (command && isCommand(command)) return { kind: "command", command };
  return null;
}

export interface Found {
  from: number;
  to: number;
  target: LinkTarget;
}

/**
 * Where `text` has links that are not [text](target): [[Title]]s and
 * addresses written out, by their place in it, for the notes' editor to draw
 * them where they are. Code spans hold none.
 */
export function bareLinks(text: string): Found[] {
  const found: Found[] = [];
  const code = [...text.matchAll(/`[^`]+`/g)].map((m) => [m.index, m.index + m[0].length]);
  const inCode = (at: number) => code.some(([from, to]) => at >= from && at < to);
  for (const m of text.matchAll(/\[\[([^\]]+)\]\]|(?:https?|file):\/\/[^\s<>"'`]+/gu)) {
    if (inCode(m.index)) continue;
    // An address in a [text](address) is the link's, not one of its own.
    if (m[1] === undefined && text[m.index - 1] === "(" && text[m.index - 2] === "]") continue;
    if (m[1] === undefined && text[m.index - 1] === "<" && text[m.index - 2] === "(") continue;
    if (m[1] !== undefined) {
      found.push({ from: m.index, to: m.index + m[0].length, target: { kind: "title", title: m[1].trim() } });
    } else {
      const url = trimUrl(m[0]);
      found.push({ from: m.index, to: m.index + url.length, target: linkTarget(url)! });
    }
  }
  return found;
}

/**
 * The path a file: address names, to show in place of the address:
 * file:///Users/me/My%20Designs is /Users/me/My Designs.
 */
export function filePath(url: string): string {
  const path = url.replace(/^file:\/\/(localhost)?/i, "").replace(/^\/([A-Za-z]:)/, "$1");
  try {
    return decodeURIComponent(path);
  } catch {
    return path; // A % that starts no escape: show it as written.
  }
}

/** A link to a node, to put in notes: [Title](node:id). */
export function nodeLink(title: string, id: string): string {
  const text = (title || "Untitled").replace(/[[\]]/g, "");
  return `[${text}](node:${id})`;
}

/**
 * A link to a file or folder on this computer, to put in notes, named after
 * it: /Users/me/The brief.pdf is [The brief.pdf](file:///Users/me/The%20brief.pdf).
 * Windows paths have their backslashes turned. Spaces and brackets are
 * escaped, so the address also reads back written out, without the link.
 */
export function fileLink(path: string): string {
  const parts = path.replace(/\\/g, "/").replace(/\/+$/, "").split("/");
  const name = (parts.at(-1) || path).replace(/[[\]]/g, "");
  // A drive's colon (C:) stays as it is; everything else is escaped.
  const escaped = parts.map((p, i) => (i === 0 && /^[A-Za-z]:$/.test(p) ? p : encodeURIComponent(p).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)));
  const url = `file://${escaped[0] === "" ? "" : "/"}${escaped.join("/")}`;
  return `[${name}](${url})`;
}
