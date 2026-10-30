import { test } from "node:test";
import assert from "node:assert/strict";
import { sidesOf } from "../src/core/layout.ts";
import { indent, outdent, reorder, setSide, toColumn } from "../src/core/moves.ts";
import { Vault } from "../src/core/vault.ts";

const titles = (vault: Vault, id: string) => vault.children(id).map((n) => n.title);

function branch() {
  const vault = new Vault([]);
  const map = { centreId: vault.rootId, columns: true };
  const a = vault.addChild(vault.rootId, { title: "a", side: "right" });
  const [a1, a2, a3] = ["a1", "a2", "a3"].map((t) => vault.addChild(a.id, { title: t }));
  return { vault, map, a, a1, a2, a3 };
}

test("reordering moves one place among siblings, and stops at the ends", () => {
  const { vault, map, a, a1, a3 } = branch();
  assert.equal(reorder(vault, a3.id, -1, map), true);
  assert.deepEqual(titles(vault, a.id), ["a1", "a3", "a2"]);
  assert.equal(reorder(vault, a1.id, 1, map), true);
  assert.deepEqual(titles(vault, a.id), ["a3", "a1", "a2"]);
  assert.equal(reorder(vault, a3.id, -1, map), false);
  assert.equal(reorder(vault, vault.rootId, 1, map), false);
  vault.undo();
  assert.deepEqual(titles(vault, a.id), ["a1", "a3", "a2"], "each move is one undo step");
});

test("on the map, the centre's children move within their own column", () => {
  const vault = new Vault([]);
  const map = { centreId: vault.rootId, columns: true };
  // No sides set: they alternate right, left, right, left.
  const [r1, l1, r2, l2] = ["r1", "l1", "r2", "l2"].map((t) => vault.addChild(vault.rootId, { title: t }));
  assert.equal(reorder(vault, r2.id, -1, map), true);
  const kids = vault.children(vault.rootId);
  const right = kids.filter((_, i) => sidesOf(kids)[i] === "right").map((n) => n.title);
  const left = kids.filter((_, i) => sidesOf(kids)[i] === "left").map((n) => n.title);
  assert.deepEqual(right, ["r2", "r1"]);
  assert.deepEqual(left, ["l1", "l2"], "nothing crossed to the other side");
  assert.equal(reorder(vault, r1.id, 1, map), false, "the last on its side");
  assert.ok(l1 && l2);
});

test("in the outline, the centre's children are one list", () => {
  const vault = new Vault([]);
  const outline = { centreId: vault.rootId, columns: false };
  const [, l1] = ["r1", "l1", "r2"].map((t) => vault.addChild(vault.rootId, { title: t }));
  reorder(vault, l1.id, -1, outline);
  assert.deepEqual(titles(vault, vault.rootId), ["l1", "r1", "r2"]);
  assert.equal(vault.get(l1.id)!.side, "left", "but it keeps its side on the map");
});

test("indenting goes under the sibling above, at the end, unfolding it", () => {
  const { vault, map, a1, a2, a3 } = branch();
  vault.addChild(a1.id, { title: "a1x" });
  vault.update(a1.id, { collapsed: true });
  assert.equal(indent(vault, a2.id, map), true);
  assert.deepEqual(titles(vault, a1.id), ["a1x", "a2"]);
  assert.equal(vault.get(a1.id)!.collapsed, false);
  assert.equal(indent(vault, a1.id, map), false, "nothing above");
  vault.setMap(a1.id, true);
  assert.equal(indent(vault, a3.id, map), false, "not into a map, out of sight");
});

test("outdenting goes beside the parent, just after it", () => {
  const { vault, map, a, a1, a2 } = branch();
  const b = vault.addChild(vault.rootId, { title: "b", side: "left" });
  const deep = vault.addChild(a2.id, { title: "deep" });
  assert.equal(outdent(vault, deep.id, map), true);
  assert.deepEqual(titles(vault, a.id), ["a1", "a2", "deep", "a3"]);
  assert.equal(outdent(vault, a1.id, map), true);
  assert.deepEqual(titles(vault, vault.rootId), ["a", "a1", "b"]);
  assert.equal(vault.get(a1.id)!.side, "right", "a new child of the centre keeps its branch's side");
  assert.equal(outdent(vault, a.id, map), false, "a child of the centre stays");
  assert.ok(b);
});

test("a child of the centre crosses to the other side, the others stay", () => {
  const vault = new Vault([]);
  const [r1, l1, r2] = ["r1", "l1", "r2"].map((t) => vault.addChild(vault.rootId, { title: t }));
  assert.equal(setSide(vault, r2.id, "left", vault.rootId), true);
  assert.deepEqual(
    vault.children(vault.rootId).map((n) => n.side),
    ["right", "left", "left"],
  );
  assert.equal(setSide(vault, r1.id, "right", vault.rootId), false, "already there");
  assert.equal(setSide(vault, vault.addChild(l1.id).id, "right", vault.rootId), false, "not a child of the centre");
});

test("a card moves to the end of the next column, as far as there is one", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "board" });
  const [mon, tue] = ["Mon", "Tue"].map((title) => vault.addChild(vault.rootId, { title }));
  const card = vault.addChild(mon.id, { title: "card" });
  const there = vault.addChild(tue.id, { title: "there" });
  const under = vault.addChild(card.id, { title: "under" });
  assert.equal(toColumn(vault, card.id, 1, vault.rootId), true);
  assert.deepEqual(vault.children(tue.id).map((n) => n.id), [there.id, card.id]);
  assert.equal(toColumn(vault, card.id, 1, vault.rootId), false, "no column after the last");
  assert.equal(toColumn(vault, under.id, 1, vault.rootId), false, "only a column's own cards");
  assert.equal(toColumn(vault, tue.id, -1, vault.rootId), false, "not a heading");
  vault.undo();
  assert.equal(vault.get(card.id)!.parentId, mon.id, "one step to undo");
});
