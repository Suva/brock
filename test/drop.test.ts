import { test } from "node:test";
import assert from "node:assert/strict";
import { dropAt, outlineDropAt, type Row } from "../src/core/drop.ts";
import { layoutMap, type Layout } from "../src/core/layout.ts";
import { place } from "../src/core/moves.ts";
import { Vault } from "../src/core/vault.ts";

const SIZE = { width: 100, height: 30 };

function map() {
  const vault = new Vault([]);
  const add = (parent: string, title: string, side: "left" | "right" | null = null) =>
    vault.addChild(parent, side ? { title, side } : { title });
  const r1 = add(vault.rootId, "r1", "right");
  const l1 = add(vault.rootId, "l1", "left");
  const r2 = add(vault.rootId, "r2", "right");
  const [a, b, c] = ["a", "b", "c"].map((t) => add(r1.id, t));
  const deep = add(a.id, "deep");
  const layout = () => layoutMap(vault, vault.rootId, () => SIZE);
  return { vault, layout, r1, l1, r2, a, b, c, deep };
}

const middle = (layout: Layout, id: string) => {
  const p = layout.byId.get(id)!;
  return [p.x + p.width / 2, p.y + p.height / 2] as const;
};
const titles = (vault: Vault, id: string) => vault.children(id).map((n) => n.title);

test("dropped on a node, it becomes its last child", () => {
  const { vault, layout, r2, c } = map();
  const drop = dropAt(vault, layout(), c.id, ...middle(layout(), r2.id))!;
  assert.deepEqual([drop.parentId, drop.index, drop.onto], [r2.id, 0, r2.id]);
  assert.equal(place(vault, c.id, drop, vault.rootId), true);
  assert.deepEqual(titles(vault, r2.id), ["c"]);
});

test("dropped near a node, it goes before or after it", () => {
  const { vault, layout, r1, a, c } = map();
  const l = layout();
  const pa = l.byId.get(a.id)!;
  assert.equal(dropAt(vault, l, c.id, pa.x + 10, pa.y + pa.height / 2)!.onto, a.id, "the middle of a node is onto it");
  assert.deepEqual(dropAt(vault, l, c.id, pa.x + 10, pa.y - 3)!.beside, { id: a.id, after: false }, "just above it");
  const before = dropAt(vault, l, c.id, pa.x + 10, pa.y + 2)!;
  assert.deepEqual(before.beside, { id: a.id, after: false }, "its top quarter is before it");
  place(vault, c.id, before, vault.rootId);
  assert.deepEqual(titles(vault, r1.id), ["c", "a", "b"]);
});

test("a node cannot go into its own branch", () => {
  const { vault, layout, a, deep } = map();
  const l = layout();
  const drop = dropAt(vault, l, a.id, ...middle(l, deep.id));
  assert.notEqual(drop?.onto, deep.id);
  assert.notEqual(drop?.parentId, deep.id);
});

test("dropped on the centre, it becomes a branch on the side it was dropped", () => {
  const { vault, layout, b } = map();
  const l = layout();
  const centre = l.byId.get(vault.rootId)!;
  const drop = dropAt(vault, l, b.id, centre.x + 5, centre.y + 5)!;
  assert.deepEqual([drop.parentId, drop.side], [vault.rootId, "left"]);
  place(vault, b.id, drop, vault.rootId);
  const moved = vault.get(b.id)!;
  assert.equal(moved.side, "left");
  assert.ok(moved.color, "a new branch gets a colour");
});

test("dropped beside a branch on the other side, it crosses the centre", () => {
  const { vault, layout, l1, r2 } = map();
  const l = layout();
  const pl = l.byId.get(l1.id)!;
  const drop = dropAt(vault, l, r2.id, pl.x + 10, pl.y + pl.height + 4)!;
  assert.deepEqual(drop.beside, { id: l1.id, after: true });
  assert.equal(drop.side, "left");
  place(vault, r2.id, drop, vault.rootId);
  assert.equal(vault.get(r2.id)!.side, "left");
  assert.equal(vault.get(l1.id)!.side, "left", "the others keep their sides");
});

test("far from everything, it goes nowhere; a drop where it is changes nothing", () => {
  const { vault, layout, b } = map();
  const l = layout();
  assert.equal(dropAt(vault, l, b.id, 5000, 5000), null);
  const pb = l.byId.get(b.id)!;
  const here = dropAt(vault, l, b.id, pb.x + 10, pb.y - 3)!;
  assert.equal(place(vault, b.id, here, vault.rootId), false);
  assert.equal(vault.canUndo, true);
});

test("a dropped node goes into a folded node, which opens", () => {
  const { vault, layout, r2, a, c } = map();
  vault.update(a.id, { collapsed: true });
  const l = layout();
  const drop = dropAt(vault, l, r2.id, ...middle(l, a.id))!;
  assert.equal(drop.index, 1, "after what the folded node holds");
  place(vault, r2.id, drop, vault.rootId);
  assert.equal(vault.get(a.id)!.collapsed, false);
  assert.deepEqual(titles(vault, a.id), ["deep", "r2"]);
  assert.ok(c);
});

/** The map's rows as the outline draws them, each 20 high, the centre first. */
function rows(vault: Vault): Row[] {
  const out: Row[] = [];
  const walk = (id: string) => {
    const node = vault.get(id)!;
    out.push({ id, parentId: node.parentId, top: out.length * 20, height: 20, open: true });
    for (const child of vault.children(id)) walk(child.id);
  };
  walk(vault.rootId);
  return out;
}
const at = (list: Row[], id: string, part: number) => {
  const row = list.find((r) => r.id === id)!;
  return row.top + row.height * part;
};

test("in the outline, a row dropped on the middle of another goes under it, last", () => {
  const { vault, r2, a } = map();
  const list = rows(vault);
  const drop = outlineDropAt(vault, list, a.id, at(list, r2.id, 0.5))!;
  assert.deepEqual([drop.parentId, drop.index, drop.onto], [r2.id, 0, r2.id]);
  assert.equal(place(vault, a.id, drop, vault.rootId), true);
  assert.deepEqual(titles(vault, r2.id), ["a"]);
  assert.deepEqual(titles(vault, a.id), ["deep"]);
});

test("in the outline, a row dropped on the top or bottom of another goes before or after it", () => {
  const { vault, r1, b, c } = map();
  const list = rows(vault);
  const before = outlineDropAt(vault, list, c.id, at(list, b.id, 0.1))!;
  assert.deepEqual([before.parentId, before.index, before.beside], [r1.id, 1, { id: b.id, after: false }]);
  place(vault, c.id, before, vault.rootId);
  assert.deepEqual(titles(vault, r1.id), ["a", "c", "b"]);
});

test("in the outline, the bottom of a row with children shown puts it first under that row", () => {
  const { vault, a, c, deep } = map();
  const list = rows(vault);
  const drop = outlineDropAt(vault, list, c.id, at(list, a.id, 0.9))!;
  assert.deepEqual([drop.parentId, drop.index], [a.id, 0]);
  place(vault, c.id, drop, vault.rootId);
  assert.deepEqual(vault.children(a.id).map((n) => n.id), [c.id, deep.id]);
});

test("in the outline, a row cannot go into itself or under itself", () => {
  const { vault, a, deep } = map();
  const list = rows(vault);
  assert.equal(outlineDropAt(vault, list, a.id, at(list, a.id, 0.5)), null);
  assert.equal(outlineDropAt(vault, list, a.id, at(list, deep.id, 0.5)), null);
});

test("in the outline, a row beside a branch of the centre takes that branch's side", () => {
  const { vault, l1, c } = map();
  const list = rows(vault);
  const drop = outlineDropAt(vault, list, c.id, at(list, l1.id, 0.1))!;
  assert.equal(drop.side, "left");
  place(vault, c.id, drop, vault.rootId);
  assert.equal(vault.get(c.id)!.side, "left");
});

test("in the outline, a row dropped on the centre keeps the other branches' sides", () => {
  const { vault, r1, l1, r2, deep } = map();
  const list = rows(vault);
  const drop = outlineDropAt(vault, list, deep.id, at(list, vault.rootId, 0.9))!;
  assert.equal(drop.parentId, vault.rootId);
  place(vault, deep.id, drop, vault.rootId);
  assert.deepEqual([r1, l1, r2].map((n) => vault.get(n.id)!.side), ["right", "left", "right"]);
  assert.notEqual(vault.get(deep.id)!.side, null);
});

test("drawn downwards, the ends of a node mean beside it, to its left or right", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "org" });
  const a = vault.addChild(vault.rootId, { title: "a" });
  const b = vault.addChild(vault.rootId, { title: "b" });
  const c = vault.addChild(vault.rootId, { title: "c" });
  const d = vault.addChild(c.id, { title: "d" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  const p = layout.byId.get(b.id)!;
  const y = p.y + 10;

  const onto = dropAt(vault, layout, d.id, p.x + 40, y)!;
  assert.equal(onto.onto, b.id);
  assert.equal(onto.side, null);

  const before = dropAt(vault, layout, d.id, p.x + 4, y)!;
  assert.deepEqual([before.parentId, before.index, before.beside], [vault.rootId, 1, { id: b.id, after: false }]);
  assert.equal(before.side, null, "no sides to carry it to");

  const after = dropAt(vault, layout, d.id, p.x + 76, y)!;
  assert.deepEqual([after.index, after.beside], [2, { id: b.id, after: true }]);

  const centre = layout.byId.get(vault.rootId)!;
  assert.equal(dropAt(vault, layout, d.id, centre.x + 2, centre.y + 2)!.side, null);
  assert.equal(a.parentId, vault.rootId);
});

test("drawn downwards, nodes in a column go before and after by height, as on a mind map", () => {
  const vault = new Vault([]);
  vault.update(vault.rootId, { layout: "org" });
  const a = vault.addChild(vault.rootId, { title: "a" });
  const [a1, a2] = [1, 2].map((n) => vault.addChild(a.id, { title: `a${n}` }));
  const b = vault.addChild(vault.rootId, { title: "b" });
  const layout = layoutMap(vault, vault.rootId, () => ({ width: 80, height: 20 }));
  const p = layout.byId.get(a2.id)!;
  const above = dropAt(vault, layout, b.id, p.x + 40, p.y + 2)!;
  assert.deepEqual([above.parentId, above.index, above.beside], [a.id, 1, { id: a2.id, after: false }]);
  assert.equal(dropAt(vault, layout, b.id, p.x + 40, p.y + 10)!.onto, a2.id);
  void a1;
});
