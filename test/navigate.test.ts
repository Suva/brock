import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutMap } from "../src/core/layout.ts";
import { neighbour } from "../src/core/navigate.ts";
import { Vault } from "../src/core/vault.ts";

function map() {
  const vault = new Vault([]);
  const r = vault.addChild(vault.rootId, { title: "r", side: "right" });
  const r1 = vault.addChild(r.id, { title: "r1" });
  const r2 = vault.addChild(r.id, { title: "r2" });
  const r3 = vault.addChild(r.id, { title: "r3" });
  const s = vault.addChild(vault.rootId, { title: "s", side: "right" });
  const s1 = vault.addChild(s.id, { title: "s1" });
  const l = vault.addChild(vault.rootId, { title: "l", side: "left" });
  const l1 = vault.addChild(l.id, { title: "l1" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  return { vault, layout, r, r1, r2, r3, s, s1, l, l1 };
}

test("left and right go out to children and back to the parent", () => {
  const { vault, layout, r, r2, l, l1 } = map();
  const go = (id: string, d: "left" | "right") => neighbour(layout, id, d);
  assert.equal(go(r.id, "right"), r2.id, "the child level with the node");
  assert.equal(go(r2.id, "left"), r.id);
  assert.equal(go(r2.id, "right"), null, "no children");
  assert.equal(go(l.id, "left"), l1.id, "outwards on the left is leftwards");
  assert.equal(go(l1.id, "right"), l.id);
  assert.equal(go(l.id, "right"), vault.rootId);
  assert.equal(go(vault.rootId, "left"), l.id);
  assert.equal(go(vault.rootId, "right"), r.id, "the child nearest the middle");
});

test("up and down go to the next node on screen, across branches", () => {
  const { layout, r1, r2, r3, s1, s } = map();
  const go = (id: string, d: "up" | "down") => neighbour(layout, id, d);
  assert.equal(go(r2.id, "up"), r1.id);
  assert.equal(go(r2.id, "down"), r3.id);
  assert.equal(go(r3.id, "down"), s1.id, "into the next branch, in the same column");
  assert.equal(go(s1.id, "up"), r3.id);
  assert.equal(go(s.id, "down"), null);
});

test("up and down go to a sibling before a deeper node that sits nearer", () => {
  // The map of the screenshot this was reported with: the last branch's
  // first child sits a little above the branch, and its branch above is
  // further away.
  const vault = new Vault([]);
  const add = (parent: string, title: string) => vault.addChild(parent, { title, side: "right" });
  add(vault.rootId, "Something is wrong?");
  add(vault.rootId, "Something");
  const third = add(vault.rootId, "Test node 3");
  const thirdChild = add(third.id, "Something third");
  const last = add(vault.rootId, "Something else");
  const ohNo = add(last.id, "Oh no");
  for (const t of ["Add", "That's cool", "nodes", "Something something", "Oh that's beautiful", "Something else"]) {
    add(ohNo.id, t);
  }
  const more = add(last.id, "more");
  const layout = layoutMap(vault, vault.rootId, (n) => ({ width: 120, height: n.parentId === vault.rootId ? 40 : 24 }));

  assert.equal(neighbour(layout, last.id, "up"), third.id);
  assert.equal(neighbour(layout, more.id, "up"), ohNo.id, "a sibling");
  assert.equal(neighbour(layout, ohNo.id, "up"), thirdChild.id, "past the first sibling, the same depth");
  assert.equal(neighbour(layout, thirdChild.id, "down"), ohNo.id);
  assert.equal(neighbour(layout, last.id, "down"), null, "the last on its side");
});
