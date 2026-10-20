import { test } from "node:test";
import assert from "node:assert/strict";
import { dropAt } from "../src/core/drop.ts";
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
