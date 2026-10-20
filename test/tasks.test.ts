import { test } from "node:test";
import assert from "node:assert/strict";
import { progressUnder, tasksUnder } from "../src/core/tasks.ts";
import { Vault } from "../src/core/vault.ts";

function trip() {
  let time = 1;
  const vault = new Vault([], { now: () => time++ });
  const plan = vault.addChild(vault.rootId, { title: "Plan" });
  const book = vault.addChild(plan.id, { title: "Book flights" });
  const pack = vault.addChild(plan.id, { title: "Pack" });
  const tokyo = vault.addChild(vault.rootId, { title: "Tokyo" });
  const ghibli = vault.addChild(tokyo.id, { title: "Ghibli tickets" });
  vault.setMap(tokyo.id, true);
  for (const n of [book, pack, ghibli]) vault.toggleTask(n.id);
  return { vault, plan, book, pack, tokyo, ghibli };
}

test("marking a task, ticking it, and back", () => {
  const { vault, book } = trip();
  assert.equal(vault.get(book.id)!.task, "open");
  vault.tick(book.id);
  assert.equal(vault.get(book.id)!.task, "done");
  assert.ok(vault.get(book.id)!.doneAt);
  vault.tick(book.id);
  assert.deepEqual([vault.get(book.id)!.task, vault.get(book.id)!.doneAt], ["open", null]);
  vault.tick(book.id, true);
  vault.toggleTask(book.id);
  assert.deepEqual([vault.get(book.id)!.task, vault.get(book.id)!.doneAt], [null, null], "no longer a task");
  vault.tick(book.id);
  assert.equal(vault.get(book.id)!.task, null, "ticking a node that is not a task does nothing");
  vault.undo();
  assert.equal(vault.get(book.id)!.task, "done");
});

test("progress counts the tasks under a node, maps inside included", () => {
  const { vault, plan, book, tokyo } = trip();
  vault.tick(book.id);
  const progress = progressUnder(vault, vault.rootId);
  assert.deepEqual(progress.get(plan.id), { done: 1, total: 2 });
  assert.deepEqual(progress.get(tokyo.id), { done: 0, total: 1 });
  assert.deepEqual(progress.get(vault.rootId), { done: 1, total: 3 });
  assert.equal(progress.has(book.id), false, "nothing under it");
});

test("tasks are grouped by the map they are in, done ones apart, latest first", () => {
  const { vault, book, pack, tokyo } = trip();
  vault.tick(pack.id);
  vault.tick(book.id);
  const all = tasksUnder(vault, vault.rootId);
  assert.deepEqual(
    all.groups.map((g) => [g.map.title, g.open.map((n) => n.title)]),
    [["Tokyo", ["Ghibli tickets"]]],
  );
  assert.deepEqual(
    all.done.map((d) => [d.node.title, d.map.title]),
    [
      ["Book flights", "Home"],
      ["Pack", "Home"],
    ],
  );
  const inTokyo = tasksUnder(vault, tokyo.id);
  assert.deepEqual(inTokyo.groups.map((g) => g.map.title), ["Tokyo"]);
  assert.equal(inTokyo.done.length, 0);
});

test("old nodes without tasks open as ordinary nodes", () => {
  const vault = new Vault([]);
  const { task: _t, doneAt: _d, ...old } = vault.get(vault.rootId)!;
  const again = new Vault([old as never]);
  assert.equal(again.get(vault.rootId)!.task, null);
});
