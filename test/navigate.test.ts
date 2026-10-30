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

function chart() {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "org" });
  const a = vault.addChild(vault.rootId, { title: "a" });
  const a1 = vault.addChild(a.id, { title: "a1" });
  const a2 = vault.addChild(a.id, { title: "a2" });
  const b = vault.addChild(vault.rootId, { title: "b" });
  const b1 = vault.addChild(b.id, { title: "b1" });
  const c = vault.addChild(vault.rootId, { title: "c" });
  // With a child of its own, a1 keeps a's children in a row.
  vault.addChild(a1.id, { title: "below" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  return { vault, layout, a, a1, a2, b, b1, c };
}

test("drawn downwards, up and down follow the tree", () => {
  const { vault, layout, a, a1, b, b1 } = chart();
  assert.equal(neighbour(layout, vault.rootId, "up"), null);
  assert.equal(neighbour(layout, vault.rootId, "down"), b.id, "the child most nearly under it");
  assert.equal(neighbour(layout, b.id, "down"), b1.id);
  assert.equal(neighbour(layout, a1.id, "up"), a.id);
  assert.equal(neighbour(layout, a.id, "up"), vault.rootId);
  assert.equal(neighbour(layout, b1.id, "down"), null);
});

test("drawn downwards, left and right go along the row, across branches", () => {
  const { vault, layout, a, a1, a2, b, b1, c } = chart();
  assert.equal(neighbour(layout, a.id, "right"), b.id);
  assert.equal(neighbour(layout, c.id, "left"), b.id);
  assert.equal(neighbour(layout, a1.id, "right"), a2.id);
  assert.equal(neighbour(layout, a2.id, "right"), b1.id, "into the next branch");
  assert.equal(neighbour(layout, b1.id, "right"), c.id, "past the row's end, the row above");
  assert.equal(neighbour(layout, c.id, "right"), null);
  assert.equal(neighbour(layout, vault.rootId, "left"), null);
});

test("drawn downwards, a column goes up and down, and off to either side", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "org" });
  const a = vault.addChild(vault.rootId, { title: "a" });
  const [a1, a2] = [1, 2].map((n) => vault.addChild(a.id, { title: `a${n}` }));
  const b = vault.addChild(vault.rootId, { title: "b" });
  const [b1, b2] = [1, 2].map((n) => vault.addChild(b.id, { title: `b${n}` }));
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  assert.equal(neighbour(layout, a.id, "down"), a1.id, "into the top of the column");
  assert.equal(neighbour(layout, a1.id, "down"), a2.id);
  assert.equal(neighbour(layout, a2.id, "down"), null);
  assert.equal(neighbour(layout, a2.id, "up"), a1.id);
  assert.equal(neighbour(layout, a1.id, "up"), a.id);
  assert.equal(neighbour(layout, a2.id, "right"), b2.id, "the node level with it");
  assert.equal(neighbour(layout, b1.id, "left"), a1.id);
});

test("on a timeline left and right go along the line, up and down through a column", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "timeline" });
  const [one, two, three] = ["one", "two", "three"].map((title) => vault.addChild(vault.rootId, { title }));
  const under = vault.addChild(one.id, { title: "under" });
  const deeper = vault.addChild(under.id, { title: "deeper" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  assert.equal(neighbour(layout, vault.rootId, "right"), one.id);
  assert.equal(neighbour(layout, vault.rootId, "left"), null);
  assert.equal(neighbour(layout, vault.rootId, "down"), null);
  assert.equal(neighbour(layout, one.id, "right"), two.id, "the next in order, on the other side of the line");
  assert.equal(neighbour(layout, two.id, "right"), three.id);
  assert.equal(neighbour(layout, three.id, "right"), null);
  assert.equal(neighbour(layout, two.id, "left"), one.id);
  assert.equal(neighbour(layout, one.id, "left"), vault.rootId);
  assert.equal(neighbour(layout, one.id, "down"), under.id);
  assert.equal(neighbour(layout, under.id, "down"), deeper.id);
  assert.equal(neighbour(layout, deeper.id, "down"), null);
  assert.equal(neighbour(layout, deeper.id, "up"), under.id);
  assert.equal(neighbour(layout, one.id, "up"), null);
});

test("on a board down enters from the centre, and the columns run up and down", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "board" });
  const [mon, tue] = ["Mon", "Tue"].map((title) => vault.addChild(vault.rootId, { title }));
  const [m1, m2] = ["m1", "m2"].map((title) => vault.addChild(mon.id, { title }));
  const t1 = vault.addChild(tue.id, { title: "t1" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  assert.equal(neighbour(layout, vault.rootId, "down"), mon.id);
  assert.equal(neighbour(layout, vault.rootId, "right"), null);
  assert.equal(neighbour(layout, mon.id, "up"), vault.rootId);
  assert.equal(neighbour(layout, mon.id, "down"), m1.id);
  assert.equal(neighbour(layout, m1.id, "down"), m2.id);
  assert.equal(neighbour(layout, m2.id, "down"), null);
  assert.equal(neighbour(layout, mon.id, "right"), tue.id);
  assert.equal(neighbour(layout, mon.id, "left"), null);
  assert.equal(neighbour(layout, m1.id, "right"), t1.id, "across to the card level with it");
});

test("left and right leave a column, however long the titles in it", () => {
  for (const style of ["org", "board", "timeline"] as const) {
    const vault = new Vault([]);
    vault.update(vault.rootId, { layout: style });
    const a = vault.addChild(vault.rootId, { title: "a" });
    const [short, long] = ["short", "long"].map((title) => vault.addChild(a.id, { title }));
    const b = vault.addChild(vault.rootId, { title: "b" });
    const c = vault.addChild(vault.rootId, { title: "c" });
    const c1 = vault.addChild(c.id, { title: "c1" });
    const c2 = vault.addChild(c.id, { title: "c2" });
    void b;
    const layout = layoutMap(vault, vault.rootId, (n) => ({ width: n.id === long.id ? 200 : 60, height: 20 }));
    const right = neighbour(layout, short.id, "right");
    assert.notEqual(right, long.id, style);
    if (style !== "timeline") assert.ok(right === c1.id || right === c2.id || right === b.id, style);
  }
});
