// What an AI agent may read and change of the vault, and how it is told. The
// person shares maps one by one, to read or to edit; an agent sees those maps
// and nothing else, whatever ids it asks for. A map inside a shared one is
// shown there as a portal with its title, and stays closed until it is shared
// too. Answers are plain text (Markdown), as that is all a tool's reply carries.
//
// Changes are the vault's own edits, each one step that ⌘Z undoes, so they are
// saved, shown and undone like the person's. An agent can add nodes, change a
// node's title, notes, priority and due date, tick tasks, move nodes and mark a
// node for the person, green, orange or red (an agent only raises a mark; the
// person lowers or clears it); it
// cannot delete, make or move maps, or touch the branches of a map's centre
// except to add to them.
//
// Everything here is a question put to the vault in memory, so it runs in the
// window; the native side only carries requests in and answers out.

import { fromText, importInto, type Outline } from "./exchange.ts";
import { search } from "./search.ts";
import { flagName, rank } from "./attention.ts";
import type { Flag, Node } from "./node.ts";
import type { Vault } from "./vault.ts";

export type TaskState = "open" | "done" | "none";

export type AgentRequest =
  | { tool: "list_maps" }
  | { tool: "read_map"; id: string }
  | { tool: "read_node"; id: string }
  | { tool: "search"; query: string; limit?: number }
  | { tool: "add_nodes"; parent: string; outline: string }
  | { tool: "update_node"; id: string; title?: string; notes?: string; appendNotes?: string; priority?: number | null; due?: string | null }
  | { tool: "set_task"; id: string; state: TaskState }
  | { tool: "move_node"; id: string; parent: string; position?: number }
  | { tool: "flag_node"; id: string; level?: Flag; reason?: string };

/** `changed` says in a few words what a request changed, for the person to see; absent when nothing was. */
export type AgentReply = { ok: true; text: string; changed?: string } | { ok: false; error: string };

/** The ids of the maps shared with agents, to read or to edit. */
export type Shared = ReadonlySet<string>;

/** What was asked for is missing or not shared, and an agent cannot tell which. */
const NOT_FOUND = "Not found. Use list_maps to see the maps shared with you.";

/** A reply is cut here, with a note, so one huge map cannot fill an agent's context. */
export const MAX_CHARS = 100_000;
const DEFAULT_HITS = 20;
const MAX_HITS = 50;
/** The most nodes one request may add, and the longest title. */
const MAX_NODES = 500;
const MAX_TITLE = 1000;

/** Whether `id` is a live map that is shared. */
export function isShared(vault: Vault, shared: Shared, id: string): boolean {
  return shared.has(id) && vault.isLive(id) && vault.get(id)!.isMap;
}

/**
 * The shared map that holds a node an agent may see, or null. A shared map's
 * centre is in its own map; a map that is not shared is only a portal in the
 * one around it, and so is not visible itself.
 */
function holder(vault: Vault, shared: Shared, id: string): string | null {
  const node = vault.get(id);
  if (!node || !vault.isLive(id)) return null;
  if (node.isMap) return isShared(vault, shared, id) ? id : null;
  const map = vault.mapOf(id);
  return map !== null && isShared(vault, shared, map) ? map : null;
}

/**
 * Answers a request from the vault as it is now, for the maps shared. `writable`
 * are the shared maps an agent may also change.
 */
export function answer(vault: Vault, shared: Shared, request: AgentRequest, writable: Shared = new Set()): AgentReply {
  switch (request.tool) {
    case "list_maps":
      return ok(listMaps(vault, shared, writable));
    case "read_map":
      return isShared(vault, shared, request.id) ? ok(readMap(vault, shared, request.id)) : fail(NOT_FOUND);
    case "read_node":
      return holder(vault, shared, request.id) !== null ? ok(readNode(vault, shared, vault.get(request.id)!)) : fail(NOT_FOUND);
    case "search":
      return ok(searchShared(vault, shared, request.query, request.limit));
    case "add_nodes":
      return addNodes(vault, shared, writable, request);
    case "update_node":
      return updateNode(vault, shared, writable, request);
    case "set_task":
      return setTask(vault, shared, writable, request);
    case "move_node":
      return moveNode(vault, shared, writable, request);
    case "flag_node":
      return flagNode(vault, shared, writable, request);
  }
}

/**
 * A request as it arrives from outside: checked to be one of the above, or the
 * reason it is not, to tell the agent.
 */
export function parseRequest(raw: unknown): AgentRequest | string {
  if (typeof raw !== "object" || raw === null) return "The request is not an object.";
  const r = raw as Record<string, unknown>;
  const text = (key: string, required = true): string | undefined => {
    const v = r[key];
    if (typeof v === "string") return v;
    if (v === undefined && !required) return undefined;
    throw new Error(required ? `"${key}" is needed, as text.` : `"${key}" must be text.`);
  };
  try {
    switch (r.tool) {
      case "list_maps":
        return { tool: "list_maps" };
      case "read_map":
      case "read_node":
        return { tool: r.tool, id: text("id")! };
      case "search": {
        const limit = r.limit;
        if (limit !== undefined && typeof limit !== "number") throw new Error('"limit" must be a number.');
        return { tool: "search", query: text("query")!, limit };
      }
      case "add_nodes":
        return { tool: "add_nodes", parent: text("parent")!, outline: text("outline")! };
      case "update_node": {
        const request: AgentRequest = { tool: "update_node", id: text("id")! };
        const title = text("title", false);
        const notes = text("notes", false);
        const appendNotes = text("append_notes", false);
        if (title !== undefined) request.title = title;
        if (notes !== undefined) request.notes = notes;
        if (appendNotes !== undefined) request.appendNotes = appendNotes;
        if ("priority" in r) {
          if (r.priority !== null && (typeof r.priority !== "number" || !Number.isInteger(r.priority))) {
            throw new Error('"priority" must be a whole number from 1 to 5, or null to take it away.');
          }
          request.priority = r.priority as number | null;
        }
        if ("due" in r) {
          if (r.due !== null && typeof r.due !== "string") throw new Error('"due" must be a date like 2026-11-30, or null to take it away.');
          request.due = r.due as string | null;
        }
        return request;
      }
      case "set_task": {
        const state = text("state");
        if (state !== "open" && state !== "done" && state !== "none") throw new Error('"state" must be open, done or none.');
        return { tool: "set_task", id: text("id")!, state };
      }
      case "move_node": {
        const position = r.position;
        if (position !== undefined && (typeof position !== "number" || !Number.isInteger(position))) {
          throw new Error('"position" must be a whole number.');
        }
        return { tool: "move_node", id: text("id")!, parent: text("parent")!, position };
      }
      case "flag_node": {
        const request: AgentRequest = { tool: "flag_node", id: text("id")! };
        const level = text("level", false);
        if (level !== undefined) {
          if (level !== "ok" && level !== "attention" && level !== "critical") throw new Error('"level" must be ok, attention or critical.');
          request.level = level;
        }
        const reason = text("reason", false);
        if (reason !== undefined) request.reason = reason;
        return request;
      }
      default:
        return `Unknown tool: ${String(r.tool)}.`;
    }
  } catch (e) {
    return (e as Error).message;
  }
}

const ok = (text: string): AgentReply => ({ ok: true, text: cut(text) });
const fail = (error: string): AgentReply => ({ ok: false, error });

function cut(text: string): string {
  return text.length <= MAX_CHARS ? text : text.slice(0, MAX_CHARS) + "\n\n[Cut here: the reply was too long. Read a smaller map, or one node at a time with read_node.]\n";
}

// ---- The maps shared -------------------------------------------------------

function listMaps(vault: Vault, shared: Shared, writable: Shared): string {
  const maps = [...shared].filter((id) => isShared(vault, shared, id)).map((id) => vault.get(id)!);
  if (maps.length === 0) {
    return "No maps are shared with agents. In Brock, select a map's centre and turn on Share with agents.\n";
  }
  const lines = ["Maps shared with you:", ""];
  for (const map of maps.sort((a, b) => a.title.localeCompare(b.title))) {
    const size = vault.mapNodes(map.id).length - 1;
    lines.push(`- ${label(map)} (id: ${map.id}, ${size} ${size === 1 ? "node" : "nodes"}, ${writable.has(map.id) ? "you can read and edit it" : "read only"})`);
  }
  return lines.join("\n") + "\n";
}

// ---- A map as an outline ---------------------------------------------------

function readMap(vault: Vault, shared: Shared, id: string): string {
  const map = vault.get(id)!;
  const lines = [`# ${label(map)}`, "", `Map id: ${map.id}`];
  if (map.layout) lines.push(`Drawn as: ${map.layout}${map.layout === "board" ? " (each item just under the centre is a column)" : ""}`);
  if (map.body.trim()) lines.push("", map.body.trim());
  lines.push("");
  const item = (node: Node, depth: number) => {
    const indent = "  ".repeat(depth);
    if (node.isMap) {
      // A map inside this one is a portal: its title, and how to open it if it is shared.
      lines.push(
        isShared(vault, shared, node.id)
          ? `${indent}- ${label(node)} (a shared map, id: ${node.id}; read it with read_map)`
          : `${indent}- ${label(node)} (a map that is not shared)`,
      );
      return;
    }
    lines.push(`${indent}- ${box(node)}${label(node)} (${details(node)})`);
    for (const line of node.body.trim() ? node.body.trim().split("\n") : []) lines.push(line ? `${indent}  ${line}` : "");
    for (const child of vault.children(node.id)) item(child, depth + 1);
  };
  for (const child of vault.children(id)) item(child, 0);
  return lines.join("\n") + "\n";
}

// ---- One node --------------------------------------------------------------

function readNode(vault: Vault, shared: Shared, node: Node): string {
  const map = vault.get(holder(vault, shared, node.id)!)!;
  const lines = [`# ${label(node)}`, "", `Id: ${node.id}`, `In the map: ${label(map)} (id: ${map.id})`];
  if (node.task) lines.push(`Task: ${node.task}${node.doneAt ? `, done ${new Date(node.doneAt).toISOString().slice(0, 10)}` : ""}`);
  if (node.priority !== null) lines.push(`Priority: ${node.priority} (1 is the most important)`);
  if (node.due) lines.push(`Due: ${node.due}`);
  if (node.flag) lines.push(`Mark: ${flagName(node.flag)}`);
  if (node.body.trim()) lines.push("", node.body.trim());

  const inside = vault.children(node.id).filter((c) => !c.isMap || isShared(vault, shared, c.id));
  const hidden = vault.children(node.id).length - inside.length;
  if (inside.length || hidden) {
    lines.push("", "Under it:");
    for (const child of inside) lines.push(`- ${box(child)}${label(child)} (id: ${child.id})`);
    if (hidden) lines.push(`- ${hidden} ${hidden === 1 ? "map" : "maps"} that ${hidden === 1 ? "is" : "are"} not shared`);
  }

  const links = node.links.filter((l) => holder(vault, shared, l) !== null);
  if (links.length) {
    lines.push("", "Links to:");
    for (const l of links) lines.push(`- ${label(vault.get(l)!)} (id: ${l})`);
  }
  const linking = vault.linksTo(node.id).filter((n) => holder(vault, shared, n.id) !== null);
  if (linking.length) {
    lines.push("", "Linked from:");
    for (const n of linking) lines.push(`- ${label(n)} (id: ${n.id})`);
  }
  return lines.join("\n") + "\n";
}

// ---- Search ----------------------------------------------------------------

function searchShared(vault: Vault, shared: Shared, query: string, limit = DEFAULT_HITS): string {
  const words = query.trim();
  if (!words) return "Give some words to search for.\n";
  const wanted = Math.max(1, Math.min(MAX_HITS, Math.floor(limit) || DEFAULT_HITS));
  // Search the whole vault and keep what an agent may see: cutting to the
  // limit first could leave nothing of what is shared.
  const hits = search(vault, words, { kind: "all" }, {}, Number.POSITIVE_INFINITY)
    .filter((h) => holder(vault, shared, h.node.id) !== null)
    .slice(0, wanted);
  if (hits.length === 0) return `Nothing found for "${words}" in the shared maps.\n`;
  const lines = [`Found in the shared maps for "${words}":`, ""];
  for (const { node, snippet } of hits) {
    const map = vault.get(holder(vault, shared, node.id)!)!;
    const where = map.id === node.id ? "" : ` in ${label(map)}`;
    lines.push(`- ${label(node)} (id: ${node.id}${where})${snippet ? `: ${snippet.replace(/\s+/g, " ")}` : ""}`);
  }
  return lines.join("\n") + "\n";
}

// ---- Changes ---------------------------------------------------------------

/** The shared map an agent may change the node `id` in, or what to tell it if it may not. */
function editable(vault: Vault, shared: Shared, writable: Shared, id: string): Node | string {
  const mapId = holder(vault, shared, id);
  if (mapId === null) return NOT_FOUND;
  const map = vault.get(mapId)!;
  return writable.has(mapId) ? map : `The map "${label(map)}" is shared to read only. The person can let you edit it in Brock's notes panel, under Agents.`;
}

/** Runs an edit, turning what the vault refuses into an answer. */
function edit(run: () => AgentReply): AgentReply {
  try {
    return run();
  } catch (e) {
    return fail((e as Error).message);
  }
}

const countOf = (outlines: Outline[]): number => outlines.reduce((n, o) => n + 1 + countOf(o.children), 0);

/**
 * Text read as an outline can carry more than an agent may make (maps, ids,
 * links, colours, a way of drawing), when it is OPML or JSON; keep only what it says.
 */
const plain = (o: Outline): Outline => ({
  ...o,
  isMap: false,
  layout: null,
  id: null,
  links: [],
  color: null,
  icon: null,
  collapsed: false,
  flag: null,
  children: o.children.map(plain),
});

function addNodes(vault: Vault, shared: Shared, writable: Shared, { parent, outline }: { parent: string; outline: string }): AgentReply {
  const map = editable(vault, shared, writable, parent);
  if (typeof map === "string") return fail(map);
  if (outline.length > MAX_CHARS) return fail("That outline is too long.");
  const outlines = fromText(outline).map(plain);
  const count = countOf(outlines);
  if (count === 0) return fail("The outline is empty. Give one node a line, indented under the node it belongs to.");
  if (count > MAX_NODES) return fail(`That is ${count} nodes; add at most ${MAX_NODES} at a time.`);
  if (outlines.some(function tooLong(o: Outline): boolean { return o.title.length > MAX_TITLE || o.children.some(tooLong); })) {
    return fail(`A title is longer than ${MAX_TITLE} characters; put the rest in the notes.`);
  }
  return edit(() => {
    const made = importInto(vault, parent, outlines, map.id);
    const lines = [`Added ${count} ${count === 1 ? "node" : "nodes"} under ${label(vault.get(parent)!)}:`, ""];
    const show = (node: Node, depth: number) => {
      lines.push(`${"  ".repeat(depth)}- ${box(node)}${label(node)} (id: ${node.id})`);
      for (const child of vault.children(node.id)) show(child, depth + 1);
    };
    for (const node of made) show(node, 0);
    return { ok: true, text: lines.join("\n") + "\n", changed: `added ${count} ${count === 1 ? "node" : "nodes"} to ${label(map)}` };
  });
}

function updateNode(vault: Vault, shared: Shared, writable: Shared, request: Extract<AgentRequest, { tool: "update_node" }>): AgentReply {
  const map = editable(vault, shared, writable, request.id);
  if (typeof map === "string") return fail(map);
  const node = vault.get(request.id)!;
  const fields: Partial<Pick<Node, "title" | "body" | "priority" | "due">> = {};
  if (request.title !== undefined) {
    const title = request.title.trim();
    if (!title) return fail("A title cannot be empty.");
    if (title.length > MAX_TITLE) return fail(`A title is at most ${MAX_TITLE} characters; put the rest in the notes.`);
    fields.title = title;
  }
  if (request.notes !== undefined && request.appendNotes !== undefined) return fail("Give notes or append_notes, not both.");
  if (request.notes !== undefined) fields.body = request.notes;
  if (request.appendNotes !== undefined) fields.body = node.body ? `${node.body}\n${request.appendNotes}` : request.appendNotes;
  if (fields.body !== undefined && fields.body.length > MAX_CHARS) return fail("The notes would be too long.");
  if (request.priority !== undefined) {
    if (request.priority !== null && (request.priority < 1 || request.priority > 5)) return fail("Priority is from 1 (most important) to 5.");
    fields.priority = request.priority;
  }
  if (request.due !== undefined) {
    if (request.due !== null && !validDay(request.due)) return fail("A due date is written like 2026-11-30.");
    fields.due = request.due;
  }
  if (Object.keys(fields).length === 0) return fail("Nothing to change: give a title, notes, append_notes, priority or due.");
  return edit(() => {
    vault.update(request.id, fields);
    return { ok: true, text: readNode(vault, shared, vault.get(request.id)!), changed: `changed ${label(vault.get(request.id)!)} in ${label(map)}` };
  });
}

function setTask(vault: Vault, shared: Shared, writable: Shared, { id, state }: { id: string; state: TaskState }): AgentReply {
  const map = editable(vault, shared, writable, id);
  if (typeof map === "string") return fail(map);
  return edit(() => {
    vault.transact(() => {
      const node = vault.get(id)!;
      if (state === "none") {
        if (node.task !== null) vault.update(id, { task: null, doneAt: null });
        return;
      }
      if (node.task === null) vault.update(id, { task: "open" });
      vault.tick(id, state === "done");
    });
    const node = vault.get(id)!;
    const what = state === "none" ? "is not a task now" : state === "done" ? "is done" : "is an open task";
    return { ok: true, text: `${label(node)} ${what}.\n`, changed: `${state === "done" ? "ticked" : "changed"} ${label(node)} in ${label(map)}` };
  });
}

function moveNode(vault: Vault, shared: Shared, writable: Shared, { id, parent, position }: { id: string; parent: string; position?: number }): AgentReply {
  const from = editable(vault, shared, writable, id);
  if (typeof from === "string") return fail(from);
  const to = editable(vault, shared, writable, parent);
  if (typeof to === "string") return fail(to);
  const node = vault.get(id)!;
  if (node.isMap) return fail("Maps cannot be moved by an agent.");
  // The sides and colours of a map's branches are kept when the person moves them; an agent adds to the centre but does not rearrange it.
  if (vault.get(parent)!.isMap || (node.parentId !== null && vault.get(node.parentId)?.isMap)) {
    return fail("The branches of a map's centre cannot be moved by an agent. Move nodes between and under them.");
  }
  const others = vault.children(parent).filter((c) => c.id !== id).length;
  const index = Math.max(0, Math.min(others, position ?? others));
  return edit(() => {
    vault.move(id, parent, index);
    return { ok: true, text: `Moved ${label(node)} under ${label(vault.get(parent)!)}, as number ${index + 1}.\n`, changed: `moved ${label(node)} in ${label(to)}` };
  });
}

const MARK_LABEL: Record<Flag, string> = { ok: "OK", attention: "Needs attention", critical: "Critical" };

function flagNode(
  vault: Vault,
  shared: Shared,
  writable: Shared,
  { id, level = "attention", reason }: { id: string; level?: Flag; reason?: string },
): AgentReply {
  const map = editable(vault, shared, writable, id);
  if (typeof map === "string") return fail(map);
  const node = vault.get(id)!;
  if (rank(level) < rank(node.flag)) {
    return fail(`It is marked ${flagName(node.flag!)} already. An agent can only raise a mark; the person lowers or clears it.`);
  }
  const why = reason?.trim();
  if (why && why.length > MAX_TITLE * 3) return fail("Say why in a few words; put more in the notes with update_node.");
  return edit(() => {
    // The reason goes in the notes, where the person will look for it; the mark
    // brings them there.
    const note = why ? `${node.body ? node.body + "\n" : ""}**${MARK_LABEL[level]}:** ${why}` : node.body;
    vault.update(id, { flag: level, body: note });
    return {
      ok: true,
      text: `${label(node)} is marked ${flagName(level)} for the person${why ? ", with your reason in its notes" : ""}. Only they can lower or clear the mark.\n`,
      changed: `marked ${label(node)} in ${label(map)} as ${level === "ok" ? "OK" : level === "critical" ? "critical" : "needing your attention"}`,
    };
  });
}

/** Whether `day` is a real date written as 2026-11-30. */
function validDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const date = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
}

// ---- Small things ----------------------------------------------------------

const label = (node: Node) => node.title.trim() || "(untitled)";
const box = (node: Node) => (node.task === "done" ? "[x] " : node.task === "open" ? "[ ] " : "");

function details(node: Node): string {
  const parts = [`id: ${node.id}`];
  if (node.priority !== null) parts.push(`priority ${node.priority}`);
  if (node.due) parts.push(`due ${node.due}`);
  if (node.flag) parts.push(node.flag === "ok" ? "marked OK" : flagName(node.flag));
  return parts.join(", ");
}
