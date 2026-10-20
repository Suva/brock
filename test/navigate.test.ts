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
