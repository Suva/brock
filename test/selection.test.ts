import { test } from "node:test";
import assert from "node:assert/strict";
import { placeAll, topmost } from "../src/core/moves.ts";
import { tickAll, toggleTasks } from "../src/core/tasks.ts";
import { Vault } from "../src/core/vault.ts";

function map() {
  const vault = new Vault([]);
  const add = (parent: string, title: string) => vault.addChild(parent, { title, side: parent === vault.rootId ? "right" : null });
  const a = add(vault.rootId, "a");
  const [a1, a2, a3] = ["a1", "a2", "a3"].map((t) => add(a.id, t));
  const a2x = add(a2.id, "a2x");
  const b = add(vault.rootId, "b");
  const b1 = add(b.id, "b1");
  return { vault, a, a1, a2, a3, a2x, b, b1 };
}

const titles = (vault: Vault, id: string) => vault.children(id).map((n) => n.title);

test("a selection acts by its topmost nodes, in the tree's order, without the centre", () => {
  const { vault, a, a1, a2x, b1 } = map();
  const ids = topmost(vault, [b1.id, a2x.id, a1.id, vault.rootId, a.id], vault.rootId);
  assert.deepEqual(
    ids.map((id) => vault.get(id)!.title),
    ["a", "b1"],
    "a1 and a2x go with a",
  );
});

test("several nodes land together, in order, beside a node or onto one", () => {
  const { vault, a, a1, a3, b, b1 } = map();
  assert.equal(placeAll(vault, [a1.id, a3.id], { parentId: b.id, index: 0, side: null, beside: { id: b1.id, after: false } }, vault.rootId), true);
  assert.deepEqual(titles(vault, b.id), ["a1", "a3", "b1"]);
  assert.deepEqual(titles(vault, a.id), ["a2"]);
  vault.undo();
  assert.deepEqual(titles(vault, a.id), ["a1", "a2", "a3"], "one step");

  placeAll(vault, [a3.id, b1.id], { parentId: a.id, index: 0, side: null, beside: null }, vault.rootId);
  assert.deepEqual(titles(vault, a.id), ["a1", "a2", "a3", "b1"], "onto a node, they go last");
});

test("a node cannot land beside itself or inside one of those moving", () => {
  const { vault, a, a1, a2, a2x } = map();
  assert.equal(placeAll(vault, [a1.id, a2.id], { parentId: a.id, index: 0, side: null, beside: { id: a2.id, after: true } }, vault.rootId), false);
  assert.equal(placeAll(vault, [a.id], { parentId: a2x.id, index: 0, side: null, beside: null }, vault.rootId), false);
});

test("tasks for several at once: made or unmade together, ticked together", () => {
  const { vault, a1, a2, a3 } = map();
  vault.toggleTask(a1.id);
  toggleTasks(vault, [a1.id, a2.id]);
  assert.deepEqual([a1, a2].map((n) => vault.get(n.id)!.task), ["open", "open"], "a mixed selection all becomes tasks");
  toggleTasks(vault, [a1.id, a2.id]);
  assert.deepEqual([a1, a2].map((n) => vault.get(n.id)!.task), [null, null], "and back when all were");
  toggleTasks(vault, [a1.id, a2.id]);
  vault.tick(a1.id);
  tickAll(vault, [a1.id, a2.id, a3.id]);
  assert.deepEqual([a1, a2, a3].map((n) => vault.get(n.id)!.task), ["done", "done", null], "any open: all done; a3 is no task");
  tickAll(vault, [a1.id, a2.id]);
  assert.deepEqual([a1, a2].map((n) => vault.get(n.id)!.task), ["open", "open"]);
});
