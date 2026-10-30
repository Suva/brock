import { test } from "node:test";
import assert from "node:assert/strict";
import { describe as describeStep, isNoise, stepsOf, type LogEntry } from "../src/core/activity.ts";
import { copyOf, cut, isPlaceholder, pasteOver } from "../src/core/clipboard.ts";
import { canAddChild, isUntitled, settle, Vault } from "../src/core/vault.ts";

function world() {
  const v = new Vault([]);
  const plan = v.addChild(v.rootId, { title: "Plan" });
  v.forgetUndo();
  return { v, plan };
}

test("a node with no title and nothing else is deleted, and one with anything is kept", () => {
  const { v, plan } = world();
  const empty = v.addChild(plan.id);
  const spaces = v.addChild(plan.id, { title: "   " });
  const notes = v.addChild(plan.id, { body: "Only notes" });
  const icon = v.addChild(plan.id, { icon: "🎯" });
  const map = v.addChild(plan.id);
  v.setMap(map.id, true);
  const parent = v.addChild(plan.id);
  v.addChild(parent.id, { title: "Child" });
  const titled = v.addChild(plan.id, { title: "Titled" });

  assert.deepEqual(new Set(v.sweepEmpty()), new Set([empty.id, spaces.id]));
  assert.equal(v.isLive(empty.id), false);
  for (const kept of [notes, icon, map, parent, titled, plan]) assert.equal(v.isLive(kept.id), true, kept.title || kept.body || "untitled");
  assert.equal(v.isLive(v.rootId), true, "the top is never deleted");
});

test("a node being worked on is kept, and an empty chain goes whole once none is", () => {
  const { v, plan } = world();
  const a = v.addChild(plan.id);
  const b = v.addChild(a.id);
  const c = v.addChild(b.id);
  assert.deepEqual(v.sweepEmpty(new Set([c.id])), [], "the one being edited keeps its parents too");
  assert.deepEqual(new Set(v.sweepEmpty(new Set(), [c.id])), new Set([c.id, b.id, a.id]), "the chain goes, looking from the last");
  assert.equal(v.isLive(plan.id), true);
});

test("only the candidates are looked at when some are given", () => {
  const { v, plan } = world();
  const one = v.addChild(plan.id);
  const two = v.addChild(plan.id);
  assert.deepEqual(v.sweepEmpty(new Set(), [one.id]), [one.id]);
  assert.equal(v.isLive(two.id), true);
});

test("sweeping is not a step for undo, and leaves no step that lands on a deleted node", () => {
  const { v, plan } = world();
  const mine = v.addChild(plan.id, { title: "Mine" });
  const fresh = v.addChild(plan.id); // a step of its own, as making a node is
  v.update(mine.id, { title: "Mine, edited" });
  const origins: string[] = [];
  v.onChange((_c, origin) => origins.push(origin));

  assert.deepEqual(v.sweepEmpty(), [fresh.id]);
  assert.deepEqual(origins, ["tidy"]);
  assert.equal(v.trash().length, 0, "an empty node is not in the trash either");

  v.undo(); // takes back the edit
  assert.equal(v.get(mine.id)!.title, "Mine");
  v.undo(); // takes back making "Mine": the empty node's step is gone from between
  assert.equal(v.isLive(mine.id), false);
  assert.equal(v.canUndo, false);
});

test("a node whose title is emptied is deleted too, and what it had is not mourned in the history", () => {
  const entries: LogEntry[] = [];
  let seq = 0;
  const v = new Vault([], { onChange: (cs, origin) => cs.forEach((c) => entries.push({ seq: ++seq, at: seq * 1_000_000, source: origin, before: c.before, after: c.after })) });
  const n = v.addChild(v.rootId, { title: "Idea" });
  v.update(n.id, { title: "" });
  v.sweepEmpty();
  const noisy = stepsOf(entries).filter(isNoise);
  assert.ok(noisy.length >= 2, "the emptying and the tidying are left out of the history");
  assert.equal(isUntitled(v.get(n.id)!), true);
  assert.equal(stepsOf(entries).filter((s) => !isNoise(s)).length >= 1, true, "making the node with a title still is shown");
});

test("nothing is made under a node that has no title, except under a map", () => {
  const { v, plan } = world();
  const empty = v.addChild(plan.id);
  const spaces = v.addChild(plan.id, { title: "  " });
  const map = v.addChild(plan.id);
  v.setMap(map.id, true);
  assert.equal(canAddChild(plan), true);
  assert.equal(canAddChild(empty), false);
  assert.equal(canAddChild(spaces), false);
  assert.equal(canAddChild(v.get(map.id)!), true, "a map is made on purpose");
});

// ---- Paste onto an empty node --------------------------------------------------

function outlineWorld() {
  const v = new Vault([]);
  const plan = v.addChild(v.rootId, { title: "Plan" });
  const a = v.addChild(plan.id, { title: "A" });
  const empty = v.addChild(plan.id);
  const z = v.addChild(plan.id, { title: "Z" });
  const source = v.addChild(v.rootId, { title: "Source", body: "Notes" });
  const kid = v.addChild(source.id, { title: "Kid" });
  const other = v.addChild(v.rootId, { title: "Other" });
  return { v, plan, a, empty, z, source, kid, other };
}

test("pasting onto an empty node puts what is pasted in its place and deletes it", () => {
  const { v, plan, a, empty, z, source, other } = outlineWorld();
  assert.equal(isPlaceholder(v, empty.id), true);
  assert.equal(isPlaceholder(v, a.id), false);
  assert.equal(isPlaceholder(v, v.rootId), false);

  const pasted = pasteOver(v, copyOf(v, [source.id, other.id]), empty.id, plan.id);
  assert.deepEqual(v.children(plan.id).map((n) => n.title), ["A", "Source", "Other", "Z"], "between its neighbours, in order");
  assert.deepEqual(pasted.map((n) => n.title), ["Source", "Other"]);
  assert.equal(v.isLive(empty.id), false);
  assert.deepEqual(v.children(pasted[0].id).map((n) => n.title), ["Kid"], "with what was under it");
  assert.equal(z.title, "Z");
});

test("pasting onto an empty node is one step, and a cut is moved there", () => {
  const { v, plan, empty, source } = outlineWorld();
  v.forgetUndo();
  const clip = cut(v, [source.id]);
  v.forgetUndo();
  const [moved] = pasteOver(v, clip, empty.id, plan.id);
  assert.equal(moved.id, source.id, "the same node, so links to it hold");
  assert.deepEqual(v.children(plan.id).map((n) => n.title), ["A", "Source", "Z"]);
  v.undo();
  assert.equal(v.isLive(source.id), false, "one undo takes the paste back");
  assert.equal(v.isLive(empty.id), true, "and the empty node with it");
});

test("a step that replaced an empty node is worded for what it made", () => {
  const entries: LogEntry[] = [];
  let seq = 0;
  const v = new Vault([], { onChange: (cs, origin) => cs.forEach((c) => entries.push({ seq: ++seq, at: 5_000_000, source: origin, before: c.before, after: c.after })) });
  const plan = v.addChild(v.rootId, { title: "Plan" });
  const empty = v.addChild(plan.id);
  const src = v.addChild(v.rootId, { title: "Pasted" });
  entries.length = 0;
  pasteOver(v, copyOf(v, [src.id]), empty.id, plan.id);
  assert.equal(describeStep(stepsOf(entries)[0]), "Added “Pasted”");
});

test("undoing a paste onto an empty node does not bring the empty node back", () => {
  const { v, plan, empty, source } = outlineWorld();
  v.forgetUndo();
  pasteOver(v, copyOf(v, [source.id]), empty.id, plan.id);
  const select = settle(v, v.undo(), null);
  assert.equal(v.isLive(empty.id), false, "the empty node is swept, not selected");
  assert.notEqual(select, empty.id);
  assert.deepEqual(v.children(plan.id).map((n) => n.title), ["A", "Z"]);

  // And redo goes forward to the paste again, with nothing empty in the way.
  const again = settle(v, v.redo(), select);
  assert.deepEqual(v.children(plan.id).map((n) => n.title), ["A", "Source", "Z"]);
  assert.ok(["Source", "Kid"].includes(v.get(again!)!.title), "selected on what was pasted");
});

test("undoing the making of a node that ends up empty selects where it was and leaves nothing", () => {
  const { v, plan } = outlineWorld();
  v.forgetUndo();
  const made = v.addChild(plan.id);
  assert.equal(settle(v, v.undo(), plan.id), plan.id);
  assert.equal(v.isLive(made.id), false);
});
