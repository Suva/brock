import { test } from "node:test";
import assert from "node:assert/strict";
import { ROOT_TITLE, Vault } from "../src/core/vault.ts";
import type { Change, Node } from "../src/core/node.ts";

/** A vault with a clock that moves on a millisecond each time it is read, and every change kept. */
function open(nodes: Node[] = []) {
  let time = 1_000_000;
  const saved: Change[][] = [];
  const vault = new Vault(nodes, { now: () => time++, onChange: (c) => saved.push(c) });
  return { vault, saved };
}

const titles = (nodes: readonly Node[]) => nodes.map((n) => n.title);

function node(id: string, parentId: string | null, fields: Partial<Node> = {}): Node {
  return {
    id,
    parentId,
    sortKey: "a0",
    side: null,
    title: id,
    body: "",
    isMap: parentId === null,
    collapsed: false,
    color: null,
    icon: null,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    ...fields,
  };
}

test("an empty vault starts with one node, which is a map, and saves it", () => {
  const { vault, saved } = open();
  const root = vault.get(vault.rootId)!;
  assert.equal(root.title, ROOT_TITLE);
  assert.equal(root.isMap, true);
  assert.equal(root.parentId, null);
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0].after.id, root.id);
  assert.equal(vault.canUndo, false, "the first node is not an edit to undo");
});

test("children and siblings go where they are asked", () => {
  const { vault } = open();
  const a = vault.addChild(vault.rootId, { title: "a" });
  const c = vault.addChild(vault.rootId, { title: "c" });
  vault.addSibling(a.id, { title: "b" });
  vault.addSibling(a.id, { title: "first" }, true);
  vault.addChild(vault.rootId, { title: "zero" }, 0);
  assert.deepEqual(titles(vault.children(vault.rootId)), ["zero", "first", "a", "b", "c"]);
  assert.equal(vault.children(c.id).length, 0);
});

test("every edit is saved as it happens", () => {
  const { vault, saved } = open();
  saved.length = 0;
  const a = vault.addChild(vault.rootId);
  vault.update(a.id, { title: "Ideas" });
  assert.equal(saved.length, 2);
  assert.equal(saved[1][0].before?.title, "");
  assert.equal(saved[1][0].after.title, "Ideas");
  vault.update(a.id, { title: "Ideas" });
  assert.equal(saved.length, 2, "an edit that changes nothing is not saved");
});

test("moving reorders, reparents and refuses loops", () => {
  const { vault } = open();
  const a = vault.addChild(vault.rootId, { title: "a" });
  const b = vault.addChild(vault.rootId, { title: "b" });
  const c = vault.addChild(vault.rootId, { title: "c" });
  vault.move(c.id, vault.rootId, 0);
  assert.deepEqual(titles(vault.children(vault.rootId)), ["c", "a", "b"]);
  vault.move(c.id, vault.rootId, 2);
  assert.deepEqual(titles(vault.children(vault.rootId)), ["a", "b", "c"]);

  vault.update(b.id, { side: "left" });
  vault.move(b.id, a.id, 0);
  assert.deepEqual(titles(vault.children(a.id)), ["b"]);
  assert.equal(vault.get(b.id)!.side, null, "a node given a new parent forgets its side");

  assert.throws(() => vault.move(a.id, b.id, 0), /under itself/);
  assert.throws(() => vault.move(a.id, a.id, 0), /under itself/);
  assert.throws(() => vault.move(vault.rootId, a.id, 0));
});

test("deleting takes the branch away and restoring brings it back", () => {
  const { vault } = open();
  const a = vault.addChild(vault.rootId, { title: "a" });
  const b = vault.addChild(a.id, { title: "b" });
  vault.delete(a.id);
  assert.deepEqual(vault.children(vault.rootId), []);
  assert.equal(vault.isLive(a.id), false);
  assert.equal(vault.isLive(b.id), false, "the nodes under a deleted node go with it");
  assert.equal(vault.get(b.id)!.deletedAt, null, "but only the deleted node is marked");
  assert.throws(() => vault.addChild(b.id));
  vault.restore(a.id);
  assert.equal(vault.isLive(b.id), true);
  assert.throws(() => vault.delete(vault.rootId));
});

test("undo and redo step through edits, and are saved too", () => {
  const { vault, saved } = open();
  const a = vault.addChild(vault.rootId, { title: "a" });
  vault.update(a.id, { title: "renamed" });
  vault.delete(a.id);

  saved.length = 0;
  vault.undo();
  assert.equal(vault.isLive(a.id), true);
  assert.equal(saved.length, 1);
  vault.undo();
  assert.equal(vault.get(a.id)!.title, "a");
  vault.undo();
  assert.equal(vault.isLive(a.id), false, "undoing a new node deletes it");
  assert.ok(vault.get(a.id), "but keeps it, marked deleted");
  assert.equal(vault.undo(), null);

  vault.redo();
  vault.redo();
  assert.equal(vault.get(a.id)!.title, "renamed");
  assert.equal(vault.isLive(a.id), true);

  vault.addChild(vault.rootId);
  assert.equal(vault.canRedo, false, "a new edit ends what could be redone");
});

test("a transaction is one step", () => {
  const { vault, saved } = open();
  saved.length = 0;
  vault.transact(() => {
    const a = vault.addChild(vault.rootId, { title: "a" });
    vault.addChild(a.id, { title: "b" });
    vault.update(a.id, { title: "A" });
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].length, 2, "two nodes, each changed once");
  vault.undo();
  assert.deepEqual(vault.children(vault.rootId), []);
});

test("a transaction that fails changes nothing", () => {
  const { vault, saved } = open();
  const a = vault.addChild(vault.rootId, { title: "a" });
  saved.length = 0;
  assert.throws(() =>
    vault.transact(() => {
      vault.update(a.id, { title: "changed" });
      vault.addChild(a.id, { title: "child" });
      vault.move(a.id, a.id, 0);
    }),
  );
  assert.equal(vault.get(a.id)!.title, "a");
  assert.deepEqual(vault.children(a.id), []);
  assert.equal(saved.length, 0);
});

test("typing in a row is undone at once", () => {
  const { vault } = open();
  const a = vault.addChild(vault.rootId);
  for (const text of ["I", "Id", "Ide", "Idea"]) vault.update(a.id, { title: text }, `title:${a.id}`);
  vault.undo();
  assert.equal(vault.get(a.id)!.title, "");
  vault.undo();
  assert.equal(vault.isLive(a.id), false);
});

test("maps: making, finding and leaving them", () => {
  const { vault } = open();
  const work = vault.addChild(vault.rootId, { title: "Work" });
  const project = vault.addChild(work.id, { title: "Project" });
  const task = vault.addChild(project.id, { title: "Task" });
  vault.addChild(vault.rootId, { title: "Home life" });

  assert.equal(vault.mapOf(task.id), vault.rootId);
  vault.setMap(project.id, true);
  assert.equal(vault.mapOf(task.id), project.id);
  assert.equal(vault.mapOf(project.id), vault.rootId, "a map is shown in its parent's map");
  assert.equal(vault.mapOf(vault.rootId), null);
  assert.deepEqual(titles(vault.mapPath(project.id)), [ROOT_TITLE, "Project"]);
  assert.deepEqual(titles(vault.mapNodes(vault.rootId)), [ROOT_TITLE, "Work", "Project", "Home life"]);
  assert.deepEqual(titles(vault.mapNodes(project.id)), ["Project", "Task"]);

  vault.setMap(project.id, false);
  assert.deepEqual(titles(vault.mapNodes(vault.rootId)), [ROOT_TITLE, "Work", "Project", "Task", "Home life"]);
  assert.throws(() => vault.setMap(vault.rootId, false));
});

test("an opened vault has its nodes in order", () => {
  const nodes = [node("root", null), node("b", "root", { sortKey: "a2" }), node("a", "root", { sortKey: "a1" })];
  const { vault, saved } = open(nodes);
  assert.equal(vault.rootId, "root");
  assert.deepEqual(titles(vault.children("root")), ["a", "b"]);
  assert.equal(saved.length, 0, "nothing to repair, nothing saved");
});

test("siblings with the same key keep a stable order and can be added between", () => {
  const nodes = [node("root", null), node("y", "root", { sortKey: "a1" }), node("x", "root", { sortKey: "a1" })];
  const { vault } = open(nodes);
  assert.deepEqual(titles(vault.children("root")), ["x", "y"]);
  vault.addChild("root", { title: "between" }, 1);
  assert.deepEqual(titles(vault.children("root")), ["x", "between", "y"]);
});

test("a broken vault is repaired when it opens", () => {
  const nodes = [
    node("root", null, { createdAt: 1 }),
    node("second top", null, { createdAt: 2 }),
    node("orphan", "missing"),
    node("orphan's child", "orphan"),
    node("loop a", "loop b"),
    node("loop b", "loop a"),
    node("on the loop", "loop a"),
  ];
  const { vault, saved } = open(nodes);
  assert.equal(vault.rootId, "root");
  const moved = saved[0].map((c) => c.after.id).sort();
  assert.deepEqual(moved, ["loop a", "orphan", "second top"]);
  for (const n of nodes) assert.equal(vault.isLive(n.id), true, n.id);
  assert.equal(vault.get("orphan's child")!.parentId, "orphan");
  assert.equal(vault.canUndo, false);
});

test("a vault whose top node was deleted gets it back", () => {
  const { vault } = open([node("root", null, { deletedAt: 5, isMap: false }), node("a", "root")]);
  assert.equal(vault.isLive("a"), true);
  assert.equal(vault.get("root")!.isMap, true);
});
