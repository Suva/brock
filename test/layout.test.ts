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
