import { test } from "node:test";
import assert from "node:assert/strict";
import { answer, connectCommand, MAX_CHARS, parseRequest } from "../src/core/agent.ts";
import { Vault } from "../src/core/vault.ts";

// Home
// ├─ Garden (map, shared in most tests)
// │  ├─ Buy seeds (task, priority 2, due, notes)
// │  ├─ Plants
// │  │  └─ Tomatoes
// │  └─ Greenhouse (map, not shared)
// │     └─ Heater plans (secret)
// └─ Taxes (map, never shared)
//    └─ Receipts
function world() {
  let time = 1000;
  const v = new Vault([], { now: () => time++ });
  const garden = v.addChild(v.rootId, { title: "Garden" });
  v.setMap(garden.id, true);
  const seeds = v.addChild(garden.id, { title: "Buy seeds", task: "open", priority: 2, due: "2026-11-01", body: "Ask about **heirloom** ones." });
  const plants = v.addChild(garden.id, { title: "Plants" });
  const tomatoes = v.addChild(plants.id, { title: "Tomatoes" });
  const greenhouse = v.addChild(garden.id, { title: "Greenhouse" });
  v.setMap(greenhouse.id, true);
  const heater = v.addChild(greenhouse.id, { title: "Heater plans", body: "secret wiring" });
  const taxes = v.addChild(v.rootId, { title: "Taxes" });
  v.setMap(taxes.id, true);
  const receipts = v.addChild(taxes.id, { title: "Receipts", body: "tomatoes for the tax man" });
  return { v, garden, seeds, plants, tomatoes, greenhouse, heater, taxes, receipts };
}

const text = (r: ReturnType<typeof answer>) => {
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.text;
};

test("with nothing shared, an agent is told so and sees nothing", () => {
  const { v, garden } = world();
  assert.match(text(answer(v, new Set(), { tool: "list_maps" })), /No maps are shared/);
  assert.equal(answer(v, new Set(), { tool: "read_map", id: garden.id }).ok, false);
  assert.match(text(answer(v, new Set(), { tool: "search", query: "tomatoes" })), /Nothing found/);
});

test("list_maps names the shared maps only", () => {
  const { v, garden } = world();
  const out = text(answer(v, new Set([garden.id]), { tool: "list_maps" }));
  assert.match(out, /Garden \(id: /);
  assert.doesNotMatch(out, /Taxes|Greenhouse/);
});

test("a shared map is read as an outline with ids, tasks and notes", () => {
  const { v, garden, seeds, tomatoes } = world();
  const out = text(answer(v, new Set([garden.id]), { tool: "read_map", id: garden.id }));
  assert.match(out, /^# Garden/);
  assert.ok(out.includes(`- [ ] Buy seeds (id: ${seeds.id}, priority 2, due 2026-11-01)`));
  assert.ok(out.includes("  Ask about **heirloom** ones."), "notes under their item");
  assert.ok(out.includes(`\n  - Tomatoes (id: ${tomatoes.id})`), "children indented");
});

test("a map inside a shared map is a closed portal until it is shared too", () => {
  const { v, garden, greenhouse } = world();
  const out = text(answer(v, new Set([garden.id]), { tool: "read_map", id: garden.id }));
  assert.ok(out.includes("- Greenhouse (a map that is not shared)"));
  assert.doesNotMatch(out, /Heater|secret/);
  assert.ok(!out.includes(greenhouse.id), "its id is not given");

  const both = text(answer(v, new Set([garden.id, greenhouse.id]), { tool: "read_map", id: garden.id }));
  assert.ok(both.includes(`(a shared map, id: ${greenhouse.id}; read it with read_map)`));
});

test("what is not shared, deleted or missing all get the same answer", () => {
  const { v, garden, taxes, heater, receipts, plants } = world();
  const shared = new Set([garden.id]);
  const asked = [
    { tool: "read_map", id: taxes.id },
    { tool: "read_map", id: "nope" },
    { tool: "read_map", id: plants.id },
    { tool: "read_node", id: receipts.id },
    { tool: "read_node", id: heater.id },
    { tool: "read_node", id: "nope" },
  ] as const;
  const errors = new Set(asked.map((r) => JSON.stringify(answer(v, shared, r))));
  assert.equal(errors.size, 1, "an agent cannot tell a missing node from a closed one");
  assert.equal(answer(v, shared, asked[0]).ok, false);

  v.delete(plants.id);
  assert.equal(answer(v, shared, { tool: "read_node", id: plants.id }).ok, false, "deleted");
  v.delete(garden.id);
  assert.equal(answer(v, shared, { tool: "read_map", id: garden.id }).ok, false, "a deleted map is not shared any more");
  v.restore(garden.id);
  assert.equal(answer(v, shared, { tool: "read_map", id: garden.id }).ok, true, "and is again when it comes back");
});

test("the portal of a map that is not shared gives away nothing but its title", () => {
  const { v, garden, greenhouse } = world();
  assert.equal(answer(v, new Set([garden.id]), { tool: "read_node", id: greenhouse.id }).ok, false);
});

test("a shared map is readable though the map around it is not", () => {
  const { v, greenhouse, heater } = world();
  const out = text(answer(v, new Set([greenhouse.id]), { tool: "read_map", id: greenhouse.id }));
  assert.match(out, /Heater plans/);
  assert.match(text(answer(v, new Set([greenhouse.id]), { tool: "read_node", id: heater.id })), /secret wiring/);
});

test("a node's links and the nodes linking to it are shown only where they can be seen", () => {
  const { v, garden, seeds, tomatoes, receipts } = world();
  v.link(seeds.id, tomatoes.id);
  v.link(seeds.id, receipts.id);
  v.link(receipts.id, seeds.id);
  const out = text(answer(v, new Set([garden.id]), { tool: "read_node", id: seeds.id }));
  assert.match(out, /Links to:\n- Tomatoes/);
  assert.doesNotMatch(out, /Receipts/);
  assert.doesNotMatch(out, /Linked from/);
  assert.match(out, /Priority: 2/);
  assert.match(out, /Due: 2026-11-01/);
});

test("read_node lists what is under it, counting closed maps without naming them", () => {
  const { v, garden, plants, tomatoes } = world();
  const some = text(answer(v, new Set([garden.id]), { tool: "read_node", id: plants.id }));
  assert.ok(some.includes(`- Tomatoes (id: ${tomatoes.id})`));
  const centre = text(answer(v, new Set([garden.id]), { tool: "read_node", id: garden.id }));
  assert.match(centre, /1 map that is not shared/);
  assert.doesNotMatch(centre, /Greenhouse/);
});

test("search finds only what is shared, and the limit counts what is found", () => {
  const { v, garden, tomatoes } = world();
  const out = text(answer(v, new Set([garden.id]), { tool: "search", query: "tomatoes" }));
  assert.ok(out.includes(`Tomatoes (id: ${tomatoes.id} in Garden)`));
  assert.doesNotMatch(out, /Receipts|tax man/);

  for (let i = 0; i < 30; i++) v.addChild(v.rootId, { title: `Tomatoes of the tax year ${i}` });
  const again = text(answer(v, new Set([garden.id]), { tool: "search", query: "tomatoes", limit: 1 }));
  assert.match(again, /Tomatoes \(id: /, "the shared hit is not pushed out by the others");
});

test("a very long reply is cut with a note", () => {
  const { v, garden } = world();
  v.update(garden.id, { body: "x".repeat(MAX_CHARS * 2) });
  const out = text(answer(v, new Set([garden.id]), { tool: "read_map", id: garden.id }));
  assert.ok(out.length < MAX_CHARS + 300);
  assert.match(out, /Cut here/);
});

test("requests from outside are checked, and the reason is given", () => {
  assert.deepEqual(parseRequest({ tool: "list_maps" }), { tool: "list_maps" });
  assert.deepEqual(parseRequest({ tool: "read_map", id: "a" }), { tool: "read_map", id: "a" });
  assert.deepEqual(parseRequest({ tool: "search", query: "x", limit: 3 }), { tool: "search", query: "x", limit: 3 });
  assert.match(parseRequest({ tool: "read_map" }) as string, /"id" is needed/);
  assert.match(parseRequest({ tool: "read_node", id: 5 }) as string, /"id" is needed/);
  assert.match(parseRequest({ tool: "delete_everything" }) as string, /Unknown tool/);
  assert.equal(typeof parseRequest("list_maps"), "string");
  assert.equal(typeof parseRequest(null), "string");
  assert.deepEqual(parseRequest({ tool: "update_node", id: "a", append_notes: "x", priority: null, due: "2026-11-30" }), {
    tool: "update_node",
    id: "a",
    appendNotes: "x",
    priority: null,
    due: "2026-11-30",
  });
  assert.match(parseRequest({ tool: "update_node", id: "a", priority: "high" }) as string, /priority/);
  assert.match(parseRequest({ tool: "set_task", id: "a", state: "finished" }) as string, /open, done or none/);
  assert.match(parseRequest({ tool: "move_node", id: "a", parent: "b", position: 1.5 }) as string, /whole number/);
});

// ---- Changes ----------------------------------------------------------------

/** The world with the garden shared to edit, and the greenhouse inside it to read only. */
function editing() {
  const w = world();
  return { ...w, shared: new Set([w.garden.id, w.greenhouse.id]), writable: new Set([w.garden.id]) };
}

const reply = (r: ReturnType<typeof answer>) => (r.ok ? r.text : r.error);

test("a map shared to read cannot be changed, and one not shared cannot be told apart from a missing one", () => {
  const { v, garden, seeds, taxes, receipts } = world();
  const read = new Set([garden.id]);
  for (const request of [
    { tool: "add_nodes", parent: garden.id, outline: "- x" },
    { tool: "update_node", id: seeds.id, title: "x" },
    { tool: "set_task", id: seeds.id, state: "done" },
    { tool: "move_node", id: seeds.id, parent: garden.id },
  ] as const) {
    const r = answer(v, read, request);
    assert.equal(r.ok, false);
    assert.match(reply(r), /read only/);
  }
  assert.equal(v.get(seeds.id)!.title, "Buy seeds");

  const hidden = [
    answer(v, read, { tool: "add_nodes", parent: taxes.id, outline: "- x" }, read),
    answer(v, read, { tool: "update_node", id: receipts.id, title: "x" }, read),
    answer(v, read, { tool: "set_task", id: "nope", state: "done" }, read),
  ];
  assert.equal(new Set(hidden.map((r) => JSON.stringify(r))).size, 1);
  assert.equal(v.get(receipts.id)!.title, "Receipts");
});

test("a map can be written only if it is shared as well", () => {
  const { v, garden, seeds } = world();
  const r = answer(v, new Set(), { tool: "update_node", id: seeds.id, title: "x" }, new Set([garden.id]));
  assert.equal(r.ok, false, "listed to edit but not shared");
});

test("add_nodes adds an outline in one step, tasks and notes included, and says the new ids", () => {
  const { v, shared, writable, plants, garden } = editing();
  const r = answer(v, shared, { tool: "add_nodes", parent: plants.id, outline: "- [ ] Water\n  Every morning\n  - Hose\n- Weed" }, writable);
  assert.ok(r.ok);
  assert.equal(r.changed, "added 3 nodes to Garden");
  const water = v.children(plants.id).find((n) => n.title === "Water")!;
  assert.equal(water.task, "open");
  assert.equal(water.body, "Every morning");
  assert.deepEqual(v.children(water.id).map((n) => n.title), ["Hose"]);
  assert.ok(r.text.includes(`- [ ] Water (id: ${water.id})`));
  assert.ok(r.text.includes("  - Hose (id:"), "nested as written");

  v.undo();
  assert.deepEqual(v.children(plants.id).map((n) => n.title), ["Tomatoes"], "one undo takes it all back");
  assert.ok(v.isLive(garden.id));
});

test("nodes added to a map's centre get a side and a colour like any new branch", () => {
  const { v, shared, writable, garden } = editing();
  assert.ok(answer(v, shared, { tool: "add_nodes", parent: garden.id, outline: "- Compost" }, writable).ok);
  const compost = v.children(garden.id).find((n) => n.title === "Compost")!;
  assert.ok(compost.side !== null && compost.color !== null);
});

test("an outline cannot bring in maps, ids, links, colours or ways of drawing", () => {
  const { v, shared, writable, garden, seeds, receipts } = editing();
  const sneaky = JSON.stringify({
    format: "brock",
    version: 1,
    root: {
      title: "Sneaky", body: "", isMap: true, collapsed: true, color: "red", icon: "x", id: seeds.id,
      links: [receipts.id], task: null, doneAt: null, priority: null, due: null, layout: "board", children: [],
    },
  });
  assert.ok(answer(v, shared, { tool: "add_nodes", parent: garden.id, outline: sneaky }, writable).ok);
  const made = v.children(garden.id).find((n) => n.title === "Sneaky")!;
  assert.equal(made.isMap, false);
  assert.equal(made.layout, null);
  assert.deepEqual(made.links, []);
  assert.equal(made.collapsed, false);
  assert.notEqual(made.color, "red");
  assert.equal(v.get(seeds.id)!.title, "Buy seeds", "the id it gave is not taken");
});

test("add_nodes refuses nothing, too much, or a closed map", () => {
  const { v, shared, writable, garden, greenhouse } = editing();
  assert.match(reply(answer(v, shared, { tool: "add_nodes", parent: garden.id, outline: "  \n " }, writable)), /empty/);
  const many = Array.from({ length: 501 }, (_, i) => `- n${i}`).join("\n");
  assert.match(reply(answer(v, shared, { tool: "add_nodes", parent: garden.id, outline: many }, writable)), /at most 500/);
  assert.match(reply(answer(v, shared, { tool: "add_nodes", parent: garden.id, outline: `- ${"x".repeat(1001)}` }, writable)), /longer than/);
  assert.match(reply(answer(v, shared, { tool: "add_nodes", parent: greenhouse.id, outline: "- x" }, writable)), /read only/);
  assert.equal(v.children(garden.id).length, 3, "nothing was added");
});

test("update_node changes a title, notes, priority and due date, each checked", () => {
  const { v, shared, writable, seeds } = editing();
  const update = (fields: object) => answer(v, shared, { tool: "update_node", id: seeds.id, ...fields } as never, writable);

  const r = update({ title: "  Buy more seeds ", priority: 1, due: "2026-12-24" });
  assert.ok(r.ok);
  assert.match(r.changed!, /changed Buy more seeds in Garden/);
  const n = v.get(seeds.id)!;
  assert.deepEqual([n.title, n.priority, n.due], ["Buy more seeds", 1, "2026-12-24"]);

  assert.ok(update({ appendNotes: "Also peas." }).ok);
  assert.equal(v.get(seeds.id)!.body, "Ask about **heirloom** ones.\nAlso peas.");
  assert.ok(update({ notes: "Fresh." }).ok);
  assert.equal(v.get(seeds.id)!.body, "Fresh.");
  assert.ok(update({ priority: null, due: null }).ok);
  assert.deepEqual([v.get(seeds.id)!.priority, v.get(seeds.id)!.due], [null, null]);

  for (const [bad, why] of [
    [{}, /Nothing to change/],
    [{ title: " " }, /cannot be empty/],
    [{ priority: 6 }, /1 \(most important\) to 5/],
    [{ due: "30-11-2026" }, /like 2026-11-30/],
    [{ due: "2026-02-31" }, /like 2026-11-30/],
    [{ notes: "a", appendNotes: "b" }, /not both/],
  ] as const) assert.match(reply(update(bad)), why);
});

test("one update is one step to undo", () => {
  const { v, shared, writable, seeds } = editing();
  answer(v, shared, { tool: "update_node", id: seeds.id, title: "X", priority: 3 }, writable);
  v.undo();
  assert.deepEqual([v.get(seeds.id)!.title, v.get(seeds.id)!.priority], ["Buy seeds", 2]);
});

test("set_task ticks, unticks and makes or unmakes a task", () => {
  const { v, shared, writable, seeds, plants } = editing();
  const set = (id: string, state: "open" | "done" | "none") => answer(v, shared, { tool: "set_task", id, state }, writable);

  assert.ok(set(seeds.id, "done").ok);
  assert.equal(v.get(seeds.id)!.task, "done");
  assert.ok(v.get(seeds.id)!.doneAt !== null);
  assert.ok(set(seeds.id, "open").ok);
  assert.deepEqual([v.get(seeds.id)!.task, v.get(seeds.id)!.doneAt], ["open", null]);

  assert.ok(set(plants.id, "done").ok, "a node that was no task becomes a done one");
  assert.equal(v.get(plants.id)!.task, "done");
  assert.ok(set(plants.id, "none").ok);
  assert.deepEqual([v.get(plants.id)!.task, v.get(plants.id)!.doneAt], [null, null]);
  assert.ok(set(plants.id, "none").ok, "and again does nothing");
});

test("move_node moves a card between columns and orders it", () => {
  const w = world();
  const { v, garden } = w;
  const todo = v.addChild(garden.id, { title: "Todo" });
  const doing = v.addChild(garden.id, { title: "Doing" });
  const a = v.addChild(todo.id, { title: "A" });
  const b = v.addChild(todo.id, { title: "B" });
  const c = v.addChild(doing.id, { title: "C" });
  const shared = new Set([garden.id]);
  const move = (id: string, parent: string, position?: number) => answer(v, shared, { tool: "move_node", id, parent, position }, shared);

  assert.ok(move(a.id, doing.id).ok);
  assert.deepEqual(v.children(doing.id).map((n) => n.title), ["C", "A"], "last if no place is given");
  assert.ok(move(b.id, doing.id, 0).ok);
  assert.deepEqual(v.children(doing.id).map((n) => n.title), ["B", "C", "A"]);
  assert.ok(move(a.id, doing.id, 1).ok, "within its own parent");
  assert.deepEqual(v.children(doing.id).map((n) => n.title), ["B", "A", "C"]);
  assert.ok(move(c.id, todo.id, 99).ok, "a place past the end is the end");
  assert.deepEqual(v.children(todo.id).map((n) => n.title), ["C"]);
});

test("move_node will not move maps, centre branches, nodes under themselves, or out of reach", () => {
  const { v, shared, writable, garden, plants, tomatoes, greenhouse, receipts } = editing();
  const move = (id: string, parent: string) => answer(v, shared, { tool: "move_node", id, parent }, writable);

  const both = new Set([garden.id, greenhouse.id]);
  assert.match(reply(answer(v, shared, { tool: "move_node", id: greenhouse.id, parent: plants.id }, both)), /Maps cannot be moved/);
  assert.match(reply(move(greenhouse.id, plants.id)), /read only/, "and a map shared to read is not the agent's to move at all");
  assert.match(reply(move(plants.id, garden.id)), /centre/, "to a centre");
  assert.match(reply(move(tomatoes.id, garden.id)), /centre/);
  const deep = v.addChild(tomatoes.id, { title: "Cherry" });
  assert.match(reply(move(tomatoes.id, deep.id)), /under itself/);
  assert.match(reply(move(tomatoes.id, receipts.id)), /Not found/);
  assert.match(reply(move(tomatoes.id, greenhouse.id)), /read only/);
  assert.equal(v.get(tomatoes.id)!.parentId, plants.id);
});

test("there is no way to delete", () => {
  assert.match(parseRequest({ tool: "delete_node", id: "a" }) as string, /Unknown tool/);
});

test("list_maps says which maps can be edited", () => {
  const { v, shared, writable } = editing();
  const out = text(answer(v, shared, { tool: "list_maps" }, writable));
  assert.match(out, /Garden \(id: \w+, \d+ nodes?, you can read and edit it\)/);
  assert.match(out, /Greenhouse \(id: \w+, \d+ nodes?, read only\)/);
});

test("flag_node marks a node, with the reason in its notes, and the person alone lowers or clears it", () => {
  const { v, shared, writable, seeds } = editing();
  const flag = (request: object) => answer(v, shared, { tool: "flag_node", id: seeds.id, ...request } as never, writable);

  const r = flag({ reason: "Which seeds do you want?" });
  assert.ok(r.ok);
  assert.match(r.changed!, /marked Buy seeds in Garden as needing your attention/);
  const n = v.get(seeds.id)!;
  assert.equal(n.flag, "attention");
  assert.equal(n.body, "Ask about **heirloom** ones.\n**Needs attention:** Which seeds do you want?");
  assert.match(text(answer(v, shared, { tool: "read_node", id: seeds.id })), /Mark: needs attention/);
  assert.match(text(answer(v, shared, { tool: "read_map", id: n.parentId! })), /needs attention/);

  assert.ok(flag({ level: "critical", reason: "Blocked" }).ok);
  assert.equal(v.get(seeds.id)!.flag, "critical");
  assert.match(text(answer(v, shared, { tool: "read_map", id: n.parentId! })), /critical/);
  assert.ok(flag({ level: "critical" }).ok, "the same level again is fine");

  for (const level of ["ok", "attention"]) {
    const refused = flag({ level });
    assert.equal(refused.ok, false);
    assert.match(reply(refused), /only raise a mark/);
  }
  assert.equal(v.get(seeds.id)!.flag, "critical");

  // Nor is there a way to clear it, or to slip a mark in with new nodes.
  assert.match(parseRequest({ tool: "unflag_node", id: seeds.id }) as string, /Unknown tool/);
  const made = answer(v, shared, { tool: "add_nodes", parent: n.parentId!, outline: '{"title":"Sneaky","flag":"critical"}' }, writable);
  assert.ok(made.ok);
  assert.equal(v.children(n.parentId!).find((c) => c.title === "Sneaky")?.flag ?? null, null);
});

test("an agent can mark finished work green, and green is below the rest", () => {
  const { v, shared, writable, seeds, plants } = editing();
  assert.ok(answer(v, shared, { tool: "flag_node", id: seeds.id, level: "ok", reason: "Done" }, writable).ok);
  assert.equal(v.get(seeds.id)!.flag, "ok");
  assert.equal(v.get(seeds.id)!.body, "Ask about **heirloom** ones.\n**OK:** Done");
  assert.match(text(answer(v, shared, { tool: "read_map", id: v.get(seeds.id)!.parentId! })), /marked OK/);
  assert.ok(answer(v, shared, { tool: "flag_node", id: seeds.id, level: "attention" }, writable).ok, "and up from green");
  assert.equal(v.get(plants.id)!.flag, null);
});

test("flag_node needs a map to edit, and checks its level", () => {
  const { v, shared, seeds } = editing();
  assert.match(reply(answer(v, shared, { tool: "flag_node", id: seeds.id }, new Set())), /read only/);
  assert.ok(answer(v, shared, { tool: "flag_node", id: seeds.id }, shared).ok);
  assert.equal(v.get(seeds.id)!.flag, "attention");
  assert.equal(v.get(seeds.id)!.body, "Ask about **heirloom** ones.", "no reason, no note");
  assert.deepEqual(parseRequest({ tool: "flag_node", id: "a", level: "ok", reason: "why" }), { tool: "flag_node", id: "a", level: "ok", reason: "why" });
  assert.deepEqual(parseRequest({ tool: "flag_node", id: "a" }), { tool: "flag_node", id: "a" });
  assert.match(parseRequest({ tool: "flag_node", id: "a", level: "red" }) as string, /ok, attention or critical/);
});

test("the command that connects Claude Code starts the app with --mcp, quoted for the shell it is typed in", () => {
  const mac = "/Applications/Brock.app/Contents/MacOS/brock";
  assert.equal(connectCommand(mac, false), `claude mcp add brock -- ${mac} --mcp`, "nothing to quote");
  assert.equal(
    connectCommand("/Users/me/My Apps/it's here/brock", false),
    "claude mcp add brock -- '/Users/me/My Apps/it'\\''s here/brock' --mcp",
    "spaces and a quote",
  );
  assert.equal(connectCommand("/tmp/$HOME/brock", false), "claude mcp add brock -- '/tmp/$HOME/brock' --mcp", "nothing is expanded");
  assert.equal(connectCommand(null, false), "claude mcp add brock -- /path/to/Brock.app/Contents/MacOS/brock --mcp");

  // Windows: double quotes, backslashes as they are, and no \\?\ in front.
  assert.equal(
    connectCommand("C:\\Program Files\\Brock\\Brock.exe", true),
    'claude mcp add brock -- "C:\\Program Files\\Brock\\Brock.exe" --mcp',
  );
  assert.equal(
    connectCommand("\\\\?\\C:\\Users\\me\\Brock\\Brock.exe", true),
    'claude mcp add brock -- "C:\\Users\\me\\Brock\\Brock.exe" --mcp',
  );
  assert.equal(
    connectCommand("\\\\server\\share\\Brock.exe", true),
    'claude mcp add brock -- "\\\\server\\share\\Brock.exe" --mcp',
    "a network path keeps its two backslashes",
  );
});
