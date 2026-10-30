import { test } from "node:test";
import assert from "node:assert/strict";
import { clearDone, doneToHide, doneWhen, dueLabel, groupDone, priorityRank, progressUnder, setPriority, tasksUnder } from "../src/core/tasks.ts";
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

test("within a priority the soonest due comes first, and what has no date last", () => {
  const vault = new Vault([]);
  const add = (title: string, priority: number | null, due: string | null) => {
    const node = vault.addChild(vault.rootId, { title, priority, due });
    vault.toggleTask(node.id);
  };
  add("no date", null, null);
  add("later", null, "2026-12-01");
  add("sooner", null, "2026-11-01");
  add("same day, second", null, "2026-12-01");
  add("low but overdue", 4, "2020-01-01");
  add("urgent, no date", 1, null);
  add("urgent, dated", 1, "2026-12-31");
  const [group] = tasksUnder(vault, vault.rootId).groups;
  assert.deepEqual(
    group.open.map((n) => n.title),
    ["urgent, dated", "urgent, no date", "sooner", "later", "same day, second", "no date", "low but overdue"],
    "priority still comes first",
  );
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

test("done tasks are grouped by the day they were done, in local time", () => {
  // Wednesday 21 October 2026, half past three in the afternoon.
  const now = new Date(2026, 9, 21, 15, 30).getTime();
  const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
  assert.equal(doneWhen(at(21, 0), now), "today", "just after midnight");
  assert.equal(doneWhen(now + 60_000, now), "today", "a clock a little behind");
  assert.equal(doneWhen(at(20, 23), now), "yesterday");
  assert.equal(doneWhen(at(19, 9), now), "week", "Monday");
  assert.equal(doneWhen(at(18), now), "earlier", "Sunday is last week");
  assert.equal(doneWhen(at(18), now, 0), "week", "unless weeks start on Sunday");
  assert.equal(doneWhen(null, now), "earlier", "done before times were kept");

  // On a Monday, yesterday is last week, and this week holds only today.
  const monday = new Date(2026, 9, 19, 10).getTime();
  assert.equal(doneWhen(at(18), monday), "yesterday");
  assert.equal(doneWhen(at(17), monday), "earlier");

  const vault = new Vault([]);
  const task = (title: string, doneAt: number) => ({
    node: { ...vault.addChild(vault.rootId, { title, task: "done" }), doneAt },
  });
  const groups = groupDone([task("A", at(21)), task("B", at(10)), task("C", at(21, 9))], now);
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((i) => i.node.title)]),
    [["Today", ["A", "C"]], ["Earlier", ["B"]]],
    "in order, empty groups left out, the order within kept",
  );
});

test("due dates read as days near today, and overdue once they have passed", () => {
  const now = new Date(2026, 9, 30, 15).getTime();
  const label = (due: string | null, task: "open" | "done" = "open") => dueLabel({ due, task }, now, "en-GB");
  assert.equal(label(null), null);
  assert.deepEqual(label("2026-10-30"), { text: "Today", overdue: false, today: true });
  assert.deepEqual(label("2026-10-31"), { text: "Tomorrow", overdue: false, today: false });
  assert.deepEqual(label("2026-10-29"), { text: "Yesterday", overdue: true, today: false });
  assert.deepEqual(label("2026-11-02"), { text: "2 Nov", overdue: false, today: false });
  assert.deepEqual(label("2026-10-01"), { text: "1 Oct", overdue: true, today: false });
  assert.deepEqual(label("2027-01-15"), { text: "15 Jan 2027", overdue: false, today: false });
  assert.equal(label("2026-10-01", "done")!.overdue, false, "done is done");
  assert.equal(label("2026-10-30", "done")!.today, false);
});

test("clearing one group of done tasks leaves the others", () => {
  const vault = new Vault([]);
  const add = (parent: string, title: string) => vault.addChild(parent, { title, task: "open" });
  const old = add(vault.rootId, "Last week");
  const recent = add(vault.rootId, "Today");
  const parent = add(vault.rootId, "Old, with a new one under it");
  const child = add(parent.id, "New");
  for (const n of [old, recent, parent, child]) vault.tick(n.id);
  const lastWeek = new Set([old.id, parent.id]);
  assert.equal(clearDone(vault, vault.rootId, (n) => lastWeek.has(n.id)), 1);
  assert.equal(vault.isLive(old.id), false);
  assert.equal(vault.isLive(recent.id), true);
  assert.equal(vault.isLive(parent.id), true, "a done task stays while one not cleared is under it");
  assert.equal(vault.isLive(child.id), true);
});
