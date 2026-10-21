import { test } from "node:test";
import assert from "node:assert/strict";
import { clearDone, doneToHide, priorityRank, progressUnder, setPriority, tasksUnder } from "../src/core/tasks.ts";
import { layoutMap } from "../src/core/layout.ts";
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

test("priorities: 1 to 3 before tasks without one, 4 and 5 after", () => {
  const vault = new Vault([]);
  const titles = ["none a", "p4", "p1", "none b", "p5", "p3"];
  const nodes = titles.map((t) => vault.addChild(vault.rootId, { title: t }));
  for (const n of nodes) vault.toggleTask(n.id);
  const [, p4, p1, , p5, p3] = nodes;
  setPriority(vault, [p4.id], 4);
  setPriority(vault, [p1.id], 1);
  setPriority(vault, [p5.id], 5);
  setPriority(vault, [p3.id], 3);
  const [group] = tasksUnder(vault, vault.rootId).groups;
  assert.deepEqual(
    group.open.map((n) => n.title),
    ["p1", "p3", "none a", "none b", "p4", "p5"],
    "and the tree's order among equals",
  );
  assert.ok(priorityRank(3) < priorityRank(null) && priorityRank(null) < priorityRank(4));
});

test("the same number again takes a priority off; several get it together", () => {
  const vault = new Vault([]);
  const a = vault.addChild(vault.rootId, { title: "a" });
  const b = vault.addChild(vault.rootId, { title: "b" });
  setPriority(vault, [a.id], 2);
  setPriority(vault, [a.id, b.id], 2);
  assert.deepEqual([vault.get(a.id)!.priority, vault.get(b.id)!.priority], [2, 2], "mixed: all get it");
  setPriority(vault, [a.id, b.id], 2);
  assert.deepEqual([vault.get(a.id)!.priority, vault.get(b.id)!.priority], [null, null], "all had it: off");
  vault.undo();
  assert.equal(vault.get(b.id)!.priority, 2, "one step");
});

function project() {
  let time = 1;
  const vault = new Vault([], { now: () => time++ });
  const add = (parent: string, title: string, task: "open" | "done" | null = null) => {
    const n = vault.addChild(parent, { title, task });
    return n;
  };
  const plan = add(vault.rootId, "Plan");
  const booked = add(plan.id, "Booked", "done");
  add(booked.id, "Receipt");
  const packed = add(plan.id, "Packing", "done");
  add(packed.id, "Charger", "open");
  const visa = add(plan.id, "Visa", "open");
  const city = add(vault.rootId, "City", "done");
  vault.setMap(city.id, true);
  add(city.id, "Museum", "done");
  return { vault, plan, booked, packed, visa, city };
}

test("hiding done leaves out done tasks, but never open work under them", () => {
  const { vault, booked, packed, visa, city } = project();
  const hide = doneToHide(vault, vault.rootId);
  assert.deepEqual(new Set(hide), new Set([booked.id, city.id]), "Packing has an open task under it, so it stays");
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }), hide);
  const drawn = layout.placed.map((p) => p.node.title);
  assert.ok(!drawn.includes("Booked") && !drawn.includes("Receipt"), "what is under a hidden task goes with it");
  assert.ok(drawn.includes("Packing") && drawn.includes("Charger") && drawn.includes("Visa"));
  assert.ok(!drawn.includes("City"));
  assert.ok(visa && packed);
});

test("inside a map, its own centre is never hidden", () => {
  const { vault, city } = project();
  assert.deepEqual([...doneToHide(vault, city.id)].map((id) => vault.get(id)!.title), ["Museum"]);
});

test("clearing done moves them to the trash, as one step", () => {
  const { vault, plan, booked } = project();
  assert.equal(clearDone(vault, plan.id), 1, "only under the top given");
  assert.equal(vault.isLive(booked.id), false);
  assert.deepEqual(vault.children(plan.id).map((n) => n.title), ["Packing", "Visa"]);
  assert.equal(vault.trash()[0].node.id, booked.id);
  vault.undo();
  assert.equal(vault.isLive(booked.id), true);
  assert.equal(clearDone(vault, vault.rootId), 2, "Booked and the done map");
});
