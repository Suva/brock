import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutMap, sideForNewChild, sidesOf, SPACING, type Layout } from "../src/core/layout.ts";
import { Vault } from "../src/core/vault.ts";
import type { Node } from "../src/core/node.ts";

// Every node 100 by 20, the centre 120 by 40.
const size = (vault: Vault) => (n: Node) => (n.id === vault.rootId ? { width: 120, height: 40 } : { width: 100, height: 20 });

function at(layout: Layout, vault: Vault, title: string) {
  const p = layout.placed.find((p) => p.node.title === title);
  assert.ok(p, `no node "${title}" drawn`);
  return p;
}

const middle = (p: { y: number; height: number }) => p.y + p.height / 2;

test("the centre is in the middle and its children alternate sides", () => {
  const vault = new Vault([]);
  for (const t of ["a", "b", "c", "d", "e"]) vault.addChild(vault.rootId, { title: t });
  const layout = layoutMap(vault, vault.rootId, size(vault));
  const centre = layout.byId.get(vault.rootId)!;
  assert.deepEqual([centre.x, centre.y], [-60, -20]);
  assert.deepEqual(
    ["a", "b", "c", "d", "e"].map((t) => at(layout, vault, t).side),
    ["right", "left", "right", "left", "right"],
  );
  const a = at(layout, vault, "a");
  assert.equal(a.x, 60 + SPACING.centreAcross);
  const b = at(layout, vault, "b");
  assert.equal(b.x + b.width, -60 - SPACING.centreAcross);
});

test("a side chosen sticks, and the others balance around it", () => {
  const vault = new Vault([]);
  vault.addChild(vault.rootId, { title: "a", side: "left" });
  vault.addChild(vault.rootId, { title: "b", side: "left" });
  vault.addChild(vault.rootId, { title: "c" });
  vault.addChild(vault.rootId, { title: "d" });
  vault.addChild(vault.rootId, { title: "e" });
  assert.deepEqual(sidesOf(vault.children(vault.rootId)), ["left", "left", "right", "right", "right"]);
  assert.equal(sideForNewChild(vault.children(vault.rootId)), "left");
});

test("each side's column is centred on the centre, in order from the top", () => {
  const vault = new Vault([]);
  for (const t of ["a", "b", "c"]) vault.addChild(vault.rootId, { title: t, side: "right" });
  const layout = layoutMap(vault, vault.rootId, size(vault));
  const [a, b, c] = ["a", "b", "c"].map((t) => at(layout, vault, t));
  assert.ok(a.y < b.y && b.y < c.y);
  assert.equal(middle(b), 0);
  assert.equal(b.y - (a.y + a.height), SPACING.centreBetween);
});

test("a parent sits halfway down its children, and branches never overlap", () => {
  const vault = new Vault([]);
  const a = vault.addChild(vault.rootId, { title: "a", side: "right" });
  for (const t of ["a1", "a2", "a3", "a4"]) vault.addChild(a.id, { title: t });
  const b = vault.addChild(vault.rootId, { title: "b", side: "right" });
  vault.addChild(b.id, { title: "b1" });
  const layout = layoutMap(vault, vault.rootId, size(vault));
  const pa = at(layout, vault, "a");
  assert.equal(middle(pa), (middle(at(layout, vault, "a1")) + middle(at(layout, vault, "a4"))) / 2);
  assert.equal(at(layout, vault, "a1").x, pa.x + pa.width + SPACING.across);
  assert.equal(at(layout, vault, "a1").depth, 2);
  // The lowest of a's children is above b's whole branch.
  const a4 = at(layout, vault, "a4");
  assert.ok(a4.y + a4.height <= at(layout, vault, "b1").y);
  assert.ok(a4.y + a4.height <= at(layout, vault, "b").y);
});

test("on the left, branches grow leftwards", () => {
  const vault = new Vault([]);
  const a = vault.addChild(vault.rootId, { title: "a", side: "left" });
  vault.addChild(a.id, { title: "a1" });
  const layout = layoutMap(vault, vault.rootId, size(vault));
  const pa = at(layout, vault, "a");
  const a1 = at(layout, vault, "a1");
  assert.equal(a1.x + a1.width, pa.x - SPACING.across);
  assert.equal(a1.side, "left");
  assert.equal(a1.branch, 0);
});

test("folded nodes and maps inside the map hide what is under them", () => {
  const vault = new Vault([]);
  const folded = vault.addChild(vault.rootId, { title: "folded", collapsed: true });
  vault.addChild(folded.id, { title: "hidden 1" });
  vault.addChild(folded.id, { title: "hidden 2" });
  const portal = vault.addChild(vault.rootId, { title: "portal" });
  vault.addChild(portal.id, { title: "inside" });
  vault.setMap(portal.id, true);

  const layout = layoutMap(vault, vault.rootId, size(vault));
  assert.deepEqual(
    layout.placed.map((p) => p.node.title),
    ["Home", "folded", "portal"],
  );
  assert.equal(at(layout, vault, "folded").hidden, 2);
  assert.equal(at(layout, vault, "portal").hidden, 1);

  const inside = layoutMap(vault, portal.id, size(vault));
  assert.deepEqual(
    inside.placed.map((p) => p.node.title),
    ["portal", "inside"],
  );
});

test("the bounds hold every node", () => {
  const vault = new Vault([]);
  for (let i = 0; i < 6; i++) vault.addChild(vault.rootId, { title: String(i) });
  const layout = layoutMap(vault, vault.rootId, size(vault));
  for (const p of layout.placed) {
    assert.ok(p.x >= layout.bounds.left && p.x + p.width <= layout.bounds.right);
    assert.ok(p.y >= layout.bounds.top && p.y + p.height <= layout.bounds.bottom);
  }
});

function chart() {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "org" });
  const a = vault.addChild(vault.rootId, { title: "a" });
  const a1 = vault.addChild(a.id, { title: "a1" });
  const a2 = vault.addChild(a.id, { title: "a2" });
  const b = vault.addChild(vault.rootId, { title: "b" });
  // With a child of its own, a1 keeps a and its siblings in a row.
  vault.addChild(a1.id, { title: "below" });
  return { vault, a, a1, a2, b };
}

test("drawn downwards, each level is a row and a node is centred over its children", () => {
  const { vault, a, a1, a2, b } = chart();
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  assert.equal(layout.down, true);
  const at = (id: string) => layout.byId.get(id)!;
  const centre = at(vault.rootId);
  assert.deepEqual([centre.x + centre.width / 2, centre.y + centre.height / 2], [0, 0], "the centre stays at the origin");
  assert.equal(at(a.id).y, at(b.id).y, "a row");
  assert.ok(at(a.id).y > centre.y + centre.height);
  assert.equal(at(a1.id).y, at(a2.id).y);
  assert.ok(at(a1.id).y > at(a.id).y + at(a.id).height);
  assert.ok(at(a2.id).x >= at(a1.id).x + 80, "side by side, without touching");
  assert.ok(at(b.id).x >= at(a2.id).x + 80, "a branch keeps clear of the next");
  assert.equal(at(a.id).x + 40, (at(a1.id).x + at(a2.id).x + 80) / 2);
  assert.ok(layout.placed.every((p) => p.side === null), "no sides");
});

test("drawn downwards, the tallest node of a level sets its row for every branch", () => {
  const { vault, a, a1, b } = chart();
  const b1 = vault.addChild(b.id, { title: "b1" });
  const layout = layoutMap(vault, vault.rootId, (n) => ({ width: 80, height: n.id === a.id ? 60 : 20 }));
  assert.equal(layout.byId.get(a1.id)!.y, layout.byId.get(b1.id)!.y);
});

test("a map drawn downwards still leaves folded branches and maps inside out", () => {
  const { vault, a, a1 } = chart();
  vault.update(a.id, { collapsed: true });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  assert.equal(layout.byId.has(a1.id), false);
  assert.equal(layout.byId.get(a.id)!.hidden, 2);
});

test("drawn downwards, leaves stack in a column under their parent", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "org" });
  const a = vault.addChild(vault.rootId, { title: "a" });
  const leaves = [1, 2, 3].map((n) => vault.addChild(a.id, { title: `leaf ${n}` }));
  const only = vault.addChild(vault.rootId, { title: "only" });
  const single = vault.addChild(only.id, { title: "single" });
  const lone = vault.addChild(vault.rootId, { title: "lone" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  const at = (id: string) => layout.byId.get(id)!;

  const column = leaves.map((n) => at(n.id));
  assert.ok(column.every((p) => p.stacked && p.x === column[0].x && p.depth === 2));
  assert.ok(column[1].y >= column[0].y + 20 && column[2].y >= column[1].y + 20, "one under the other");
  assert.ok(column[0].y > at(a.id).y + 20);
  assert.equal(at(single.id).stacked, false, "a single child sits right under its parent");
  assert.equal(at(lone.id).stacked, false, "the centre's branches stay in a row");
  assert.ok(at(only.id).x >= column[0].x + 80, "the next branch keeps clear of the column");
});

test("a column makes room in its row for what is deeper elsewhere", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "org" });
  const a = vault.addChild(vault.rootId, { title: "a" });
  const [l1, l2, l3] = [1, 2, 3].map((n) => vault.addChild(a.id, { title: `leaf ${n}` }));
  const b = vault.addChild(vault.rootId, { title: "b" });
  const b1 = vault.addChild(b.id, { title: "b1" });
  const b2 = vault.addChild(b1.id, { title: "b2" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  const at = (id: string) => layout.byId.get(id)!;
  assert.equal(at(l1.id).y, at(b1.id).y, "the column starts with the row");
  assert.ok(at(b2.id).y > at(l3.id).y + 20, "the next row starts under the column");
  void l2;
});

function timeline() {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "timeline" });
  const events = ["one", "two", "three", "four"].map((title) => vault.addChild(vault.rootId, { title }));
  const under = vault.addChild(events[0].id, { title: "under" });
  const deeper = vault.addChild(under.id, { title: "deeper" });
  return { vault, events, under, deeper };
}

test("a timeline runs from its centre, by turns above and below the line", () => {
  const { vault, events } = timeline();
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  assert.deepEqual([layout.timeline, layout.down], [true, true]);
  const at = (id: string) => layout.byId.get(id)!;
  const centre = at(vault.rootId);
  assert.deepEqual([centre.x + centre.width / 2, centre.y + centre.height / 2], [0, 0]);

  const placed = events.map((e) => at(e.id));
  assert.ok(placed[0].y + 20 < 0 && placed[2].y + 20 < 0, "the first and third above the line");
  assert.ok(placed[1].y > 0 && placed[3].y > 0, "the second and fourth below it");
  assert.ok(placed[0].x > centre.x + centre.width, "after the centre");
  for (let i = 1; i < 4; i++) assert.ok(placed[i].x > placed[i - 1].x, "in order along the line");
  assert.ok(placed[2].x >= placed[0].x + 80, "each side keeps clear of itself");
  assert.ok(placed.every((p) => !p.stacked));
});

test("on a timeline an event's title is on top, with all under it in a column", () => {
  const { vault, events, under, deeper } = timeline();
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  const at = (id: string) => layout.byId.get(id)!;
  assert.ok(at(under.id).y > at(events[0].id).y, "reading downwards, above the line too");
  assert.ok(at(deeper.id).y > at(under.id).y);
  assert.ok(at(deeper.id).y + 20 < 0, "and all of it above the line");
  assert.ok(at(under.id).stacked && at(deeper.id).stacked);
  assert.ok(at(under.id).x > at(events[0].id).x && at(deeper.id).x > at(under.id).x, "stepped in by level");
  assert.equal(at(deeper.id).branch, 0);
});

test("a wide column pushes the next event on its side along the line", () => {
  const { vault, events } = timeline();
  const layout = layoutMap(vault, vault.rootId, (n) => ({ width: n.id === events[0].id ? 500 : 80, height: 20 }));
  assert.ok(layout.byId.get(events[2].id)!.x >= layout.byId.get(events[0].id)!.x + 500);
  assert.ok(layout.byId.get(events[1].id)!.x < layout.byId.get(events[2].id)!.x);
});
