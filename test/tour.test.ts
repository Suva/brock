import { test } from "node:test";
import assert from "node:assert/strict";
import { tour } from "../src/demo/tour.ts";
import { groupDone, tasksUnder } from "../src/core/tasks.ts";
import { Vault } from "../src/core/vault.ts";

test("the demo's tour is a vault the app opens as it is", () => {
  const now = new Date(2026, 9, 21, 15).getTime();
  const nodes = tour(now);
  const changes: unknown[] = [];
  const vault = new Vault(nodes, { onChange: (c) => changes.push(...c) });
  assert.equal(changes.length, 0, "nothing to repair");
  assert.equal(vault.get(vault.rootId)!.title, "Welcome to Brock");

  const maps = [...vault.children(vault.rootId)].find((n) => n.title === "Maps inside maps")!;
  assert.ok(maps.isMap);
  assert.ok(vault.children(maps.id).some((n) => n.isMap), "a map inside it, to go deeper");

  // Every link, on a node or in its notes, leads to a node of the tour.
  for (const node of nodes) {
    for (const id of node.links) assert.ok(vault.isLive(id), `${node.title} links to a node`);
    for (const [, id] of node.body.matchAll(/\(node:([^)]+)\)/g)) assert.ok(vault.isLive(id), `${node.title}'s notes`);
  }

  const done = tasksUnder(vault, vault.rootId).done;
  assert.deepEqual(
    groupDone(done, now).map((g) => g.label),
    ["Today", "Yesterday", "Earlier"],
    "the Tasks tab shows its groups",
  );
});
