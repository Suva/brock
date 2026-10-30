#!/usr/bin/env node
// brock-mcp: lets an AI agent read, and where the person allows it edit, the
// maps shared with it in Brock.
//
// It speaks MCP (JSON-RPC, a message to a line) on its standard input and
// output, and passes each tool call to the running app over the loopback
// door the app opens while agents are allowed (src-tauri/src/agent.rs). The
// app answers from the vault it holds, for the maps the person has shared;
// this script reads no vault and holds no data. It needs Node 18 or newer
// and nothing installed.
//
//   claude mcp add brock -- node /path/to/brock-mcp.mjs

import { readFileSync } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const IDENTIFIER = "app.getbrock.brock";
const NEWEST_PROTOCOL = "2025-06-18";
const SERVER = { name: "brock", version: "0.1.0" };
/** A little over the app's own wait for the window, so its answer is the one heard. */
const WAIT_MS = 20_000;

/** The folder the app keeps its vault in, which holds `agent.json` while agents are allowed. */
export function dataFolder(env = process.env, platform = process.platform) {
  if (env.BROCK_DATA) return env.BROCK_DATA;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", IDENTIFIER);
  if (platform === "win32") return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), IDENTIFIER);
  return join(env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), IDENTIFIER);
}

const id = (what) => ({ type: "string", description: what });

const TOOLS = [
  {
    name: "list_maps",
    description:
      "Lists the maps in Brock that the person has shared with you, with their ids and whether you may edit each. Start here; you can reach nothing else.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_map",
    description:
      "Reads a shared map as an indented outline: every node with its id, tasks as [ ] and [x], priority, due date and notes. A map inside it that is not shared shows as a closed portal.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The map's id, from list_maps." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_node",
    description: "Reads one node of a shared map: its notes, what is under it, and what it links to and is linked from.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "The node's id, from read_map or search." } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "search",
    description: "Searches the titles and notes of the shared maps. Every word must be found; case and accents do not matter.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "How many results at most; 20 if not given." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "add_nodes",
    description:
      "Adds nodes under a node of a map you may edit. The outline is lines of text, one node each, indented to nest; start a line with - [ ] for a task. Lines without a bullet under bulleted ones become the notes of the node above. Returns the new nodes with their ids. One step that the person can undo.",
    inputSchema: {
      type: "object",
      properties: {
        parent: id("The node to add under: a map's id from list_maps, or a node's id from read_map."),
        outline: { type: "string", description: "For example:\n- [ ] Buy seeds\n  - Tomatoes\n  - Basil\n- Plan the beds" },
      },
      required: ["parent", "outline"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "update_node",
    description:
      "Changes a node of a map you may edit: its title, its notes (notes replaces them, append_notes adds on a new line), priority (1 most important to 5, or null to take it away) or due date (2026-11-30, or null). Give only what changes. Replacing notes loses the old ones for you, though the person can undo.",
    inputSchema: {
      type: "object",
      properties: {
        id: id("The node's id."),
        title: { type: "string" },
        notes: { type: "string" },
        append_notes: { type: "string" },
        priority: { type: ["integer", "null"], minimum: 1, maximum: 5 },
        due: { type: ["string", "null"], description: "A day written 2026-11-30." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "set_task",
    description: "Makes a node of a map you may edit an open task, a done task, or an ordinary node again (none).",
    inputSchema: {
      type: "object",
      properties: { id: id("The node's id."), state: { type: "string", enum: ["open", "done", "none"] } },
      required: ["id", "state"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "move_node",
    description:
      "Moves a node, with what is under it, to be a child of another node, in maps you may edit: from one column of a board to another, say. It cannot move maps or the branches of a map's centre.",
    inputSchema: {
      type: "object",
      properties: {
        id: id("The node to move."),
        parent: id("The node to move it under."),
        position: { type: "integer", minimum: 0, description: "Its place among the parent's children, counting from 0." },
      },
      required: ["id", "parent"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "flag_node",
    description:
      "Marks a node of a map you may edit for the person, in a colour: attention (orange, the default) when you need an answer, a decision or a review; critical (red) when you are blocked or something cannot wait; ok (green) when it is done or ready for a look, which asks nothing of them. It shows on the node and under the bell in Brock's header. Give a short reason: it is added to the node's notes. You can only raise a mark, never lower or clear one; the person does that. Usually also move the node somewhere that shows it is waiting.",
    inputSchema: {
      type: "object",
      properties: {
        id: id("The node's id."),
        level: { type: "string", enum: ["ok", "attention", "critical"], description: "attention if not given." },
        reason: { type: "string", description: "What you need, or what is done, in a sentence or two." },
      },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

/** Asks the app one thing. Resolves to `{ ok: true, text }` or `{ ok: false, error }`; never rejects. */
export function ask(request, folder = dataFolder()) {
  return new Promise((resolve) => {
    const fail = (error) => resolve({ ok: false, error });
    let door;
    try {
      door = JSON.parse(readFileSync(join(folder, "agent.json"), "utf8"));
    } catch {
      return fail("Brock is not open, or agents are not allowed in it. Open Brock and turn on Settings › Agents.");
    }
    const socket = createConnection({ host: "127.0.0.1", port: door.port });
    let received = "";
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    // Text, not bytes: a character split between two chunks must not be broken.
    socket.setEncoding("utf8");
    socket.setTimeout(WAIT_MS, () => finish({ ok: false, error: "Brock did not answer in time." }));
    socket.on("connect", () => socket.write(JSON.stringify({ token: door.token, request }) + "\n"));
    socket.on("data", (chunk) => {
      received += chunk;
      const end = received.indexOf("\n");
      if (end < 0) return;
      try {
        finish(JSON.parse(received.slice(0, end)));
      } catch {
        finish({ ok: false, error: "Brock gave an answer that could not be read." });
      }
    });
    socket.on("error", () => finish({ ok: false, error: "Brock is not open. Open it and try again." }));
    socket.on("close", () => finish({ ok: false, error: "Brock closed the connection." }));
  });
}

/** One JSON-RPC message in; the message to send back, or null for none. */
export async function handle(message, folder) {
  const { id, method, params } = message;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const error = (code, text) => ({ jsonrpc: "2.0", id, error: { code, message: text } });
  // Notifications have no id and are not answered.
  if (id === undefined || id === null) return null;

  switch (method) {
    case "initialize":
      return reply({
        protocolVersion: typeof params?.protocolVersion === "string" ? params.protocolVersion : NEWEST_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions:
          "Brock is a mind map app. You can reach only the maps the person has shared: start with list_maps, which says which you may edit. Ids come from the outlines. You cannot delete anything.",
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return error(-32602, `Unknown tool: ${params?.name}`);
      const answer = await ask({ ...(params.arguments ?? {}), tool: tool.name }, folder);
      return reply({
        content: [{ type: "text", text: answer.ok ? answer.text : answer.error }],
        isError: !answer.ok,
      });
    }
    default:
      return error(-32601, `Method not found: ${method}`);
  }
}

/** Reads messages from stdin until it closes. */
export function serve(input = process.stdin, output = process.stdout, folder) {
  const lines = createInterface({ input });
  const pending = new Set();
  lines.on("line", (line) => {
    if (!line.trim()) return;
    const work = (async () => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        output.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }) + "\n");
        return;
      }
      const response = await handle(message, folder);
      if (response) output.write(JSON.stringify(response) + "\n");
    })();
    pending.add(work);
    work.finally(() => pending.delete(work));
  });
  // Answer what is under way before the process ends.
  lines.on("close", () => Promise.all(pending).then(() => process.exit(0)));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("brock-mcp.mjs")) serve();
