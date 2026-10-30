import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answer, parseRequest } from "../src/core/agent.ts";
import { Vault } from "../src/core/vault.ts";

const SCRIPT = new URL("../scripts/brock-mcp.mjs", import.meta.url).pathname;
const TOKEN = "s3cret";

/** A stand-in for the app: the same door's protocol, answered by the core from a small vault. */
async function fakeApp(folder: string) {
  const v = new Vault([]);
  const garden = v.addChild(v.rootId, { title: "Garden" });
  v.setMap(garden.id, true);
  v.addChild(garden.id, { title: "Buy seeds", task: "open" });
  const taxes = v.addChild(v.rootId, { title: "Taxes" });
  v.setMap(taxes.id, true);
  const shared = new Set([garden.id]);
  const seen: unknown[] = [];
  const writable = new Set([garden.id]);

  const server = createServer((socket) => {
    let line = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      line += chunk;
      if (!line.includes("\n")) return;
      const message = JSON.parse(line);
      seen.push(message.request);
      const request = message.token === TOKEN ? parseRequest(message.request) : "Not allowed.";
      const reply = typeof request === "string" ? { ok: false, error: request } : answer(v, shared, request, writable);
      socket.end(JSON.stringify(reply) + "\n");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  writeFileSync(join(folder, "agent.json"), JSON.stringify({ port, token: TOKEN }));
  return { v, garden, taxes, seen, close: () => server.close() };
}

/** Runs the script, sends it these messages, and gives back what it answers when its input closes. */
function talk(folder: string, messages: object[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env: { ...process.env, BROCK_DATA: folder } });
    let out = "";
    child.stdout.setEncoding("utf8").on("data", (c) => (out += c));
    child.on("error", reject);
    child.on("close", () =>
      resolve(
        out
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l)),
      ),
    );
    for (const m of messages) child.stdin.write(JSON.stringify(m) + "\n");
    child.stdin.end();
  });
}

const call = (id: number, name: string, args: object = {}) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

test("an agent can list the shared maps, read one and search, through the door", async () => {
  const folder = mkdtempSync(join(tmpdir(), "brock-mcp-"));
  const app = await fakeApp(folder);
  try {
    const replies = await talk(folder, [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {} } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      call(3, "list_maps"),
      call(4, "read_map", { id: app.garden.id }),
      call(5, "read_map", { id: app.taxes.id }),
      call(6, "search", { query: "seeds" }),
    ]);
    const byId = new Map(replies.map((r) => [r.id, r]));

    assert.equal(byId.get(1).result.protocolVersion, "2025-03-26", "the client's version is answered in kind");
    assert.deepEqual(byId.get(2).result.tools.map((t: { name: string }) => t.name), ["list_maps", "read_map", "read_node", "search", "add_nodes", "update_node", "set_task", "move_node", "flag_node"]);
    assert.match(byId.get(3).result.content[0].text, /Garden/);
    assert.doesNotMatch(byId.get(3).result.content[0].text, /Taxes/);
    assert.match(byId.get(4).result.content[0].text, /\[ \] Buy seeds/);
    assert.equal(byId.get(4).result.isError, false);
    assert.equal(byId.get(5).result.isError, true, "a map that is not shared is not found");
    assert.match(byId.get(6).result.content[0].text, /Buy seeds/);
    assert.equal(replies.length, 6, "a notification gets no answer");
  } finally {
    app.close();
    rmSync(folder, { recursive: true });
  }
});

test("the tool's name cannot be changed by its arguments", async () => {
  const folder = mkdtempSync(join(tmpdir(), "brock-mcp-"));
  const app = await fakeApp(folder);
  try {
    await talk(folder, [call(1, "list_maps", { tool: "read_node", id: app.taxes.id })]);
    assert.deepEqual(app.seen[0], { tool: "list_maps", id: app.taxes.id });
  } finally {
    app.close();
    rmSync(folder, { recursive: true });
  }
});

test("with the app closed, the agent is told how to open it", async () => {
  const folder = mkdtempSync(join(tmpdir(), "brock-mcp-"));
  try {
    const [reply] = await talk(folder, [call(1, "list_maps")]);
    assert.equal(reply.result.isError, true);
    assert.match(reply.result.content[0].text, /Open Brock/);
  } finally {
    rmSync(folder, { recursive: true });
  }
});

test("unknown tools and methods are errors, and bad lines do not stop it", async () => {
  const folder = mkdtempSync(join(tmpdir(), "brock-mcp-"));
  try {
    const replies = await talk(folder, [
      call(1, "delete_everything"),
      { jsonrpc: "2.0", id: 2, method: "resources/list" },
      { jsonrpc: "2.0", id: 3, method: "ping" },
    ]);
    assert.equal(replies[0].error.code, -32602);
    assert.equal(replies[1].error.code, -32601);
    assert.deepEqual(replies[2].result, {});
  } finally {
    rmSync(folder, { recursive: true });
  }
});

test("an agent can add nodes, change one and tick a task, through the door", async () => {
  const folder = mkdtempSync(join(tmpdir(), "brock-mcp-"));
  const app = await fakeApp(folder);
  try {
    const seeds = app.v.children(app.garden.id)[0];
    const replies = await talk(folder, [
      call(1, "add_nodes", { parent: app.garden.id, outline: "- [ ] Water\n  - Hose" }),
      call(2, "update_node", { id: seeds.id, title: "Buy more seeds", append_notes: "Peas", priority: 1 }),
      call(3, "set_task", { id: seeds.id, state: "done" }),
      call(4, "add_nodes", { parent: app.taxes.id, outline: "- x" }),
      call(5, "update_node", { id: seeds.id, priority: 9 }),
      call(6, "update_node", { id: seeds.id, title: 5 }),
    ]);
    const by = new Map(replies.map((r) => [r.id, r.result]));
    assert.equal(by.get(1).isError, false);
    assert.match(by.get(1).content[0].text, /Added 2 nodes/);
    assert.equal(by.get(2).isError, false);
    assert.equal(by.get(3).isError, false);
    assert.equal(by.get(4).isError, true, "a map that is not shared cannot be written");
    assert.equal(by.get(5).isError, true);
    assert.match(by.get(6).content[0].text, /"title" must be text/);

    const node = app.v.get(seeds.id)!;
    assert.deepEqual([node.title, node.body, node.priority, node.task], ["Buy more seeds", "Peas", 1, "done"]);
    assert.ok(app.v.children(app.garden.id).some((n) => n.title === "Water" && n.task === "open"));
    assert.equal(app.v.children(app.taxes.id).length, 0);
  } finally {
    app.close();
    rmSync(folder, { recursive: true });
  }
});
