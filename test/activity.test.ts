import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, reversible, revertStep, sameState, SAME_STEP_MS, stepsOf, type LogEntry } from "../src/core/activity.ts";
import { Vault } from "../src/core/vault.ts";

/** A vault whose changes are also written to a log, as the store does, at a time the test sets. */
function world() {
  const log: LogEntry[] = [];
  let seq = 0;
  let clock = 1; // the vault's own first node is written at 1
  let tick = 0;
  const v = new Vault([], {
    now: () => ++tick,
    onChange: (changes, origin) => {
      for (const c of changes) log.push({ seq: ++seq, at: clock, source: origin, before: c.before, after: c.after });
    },
  });
  const at = (ms: number) => (clock = ms);
  return { v, log, at, advance: (ms: number) => (clock += ms), steps: () => stepsOf(log) };
}

test("a step is what was written together, newest first, and each hand's are apart", () => {
  const w = world();
  w.at(10_000_000);
  const a = w.v.addChild(w.v.rootId, { title: "A" });
  w.at(10_100_000);
  w.v.as("agent", () => w.v.addChild(w.v.rootId, { title: "B" }));
  w.v.update(a.id, { priority: 1 });
  const steps = w.steps().filter((s) => s.at >= 10_000_000);
  assert.deepEqual(steps.map((s) => [s.source, describe(s)]), [
    ["user", "Changed “A”"],
    ["agent", "Added “B”"],
    ["user", "Added “A”"],
  ]);
});

test("two hands writing at the same moment are two steps", () => {
  const w = world();
  w.at(5_000_000);
  w.v.addChild(w.v.rootId, { title: "Mine" });
  w.v.as("agent", () => w.v.addChild(w.v.rootId, { title: "Theirs" }));
  assert.equal(w.steps().filter((s) => s.at === 5_000_000).length, 2);
});

test("typing in one node, soon after soon, is one step; a pause or another change is not", () => {
  const w = world();
  w.at(1_000_000);
  const n = w.v.addChild(w.v.rootId, { title: "" });
  for (const [i, text] of ["H", "He", "Hello"].entries()) {
    w.at(2_000_000 + i * 1000);
    w.v.update(n.id, { title: text });
  }
  const typed = w.steps()[0];
  assert.equal(describe(typed), "Renamed “Untitled” to “Hello”");
  assert.equal(typed.changes[0].before!.title, "");
  assert.equal(w.steps().length >= 2, true);

  w.at(2_002_000 + SAME_STEP_MS + 1);
  w.v.update(n.id, { title: "Hello again" });
  assert.equal(w.steps()[0].changes[0].before!.title, "Hello", "after a pause it is a step of its own");

  w.advance(1000);
  w.v.update(n.id, { priority: 2 });
  w.advance(1000);
  w.v.update(n.id, { title: "Hello once more" });
  assert.equal(w.steps()[0].changes[0].before!.title, "Hello again", "a change of something else came between");
});

test("steps are told in words", () => {
  const w = world();
  w.at(1_000_000);
  const n = w.v.addChild(w.v.rootId, { title: "Buy seeds", task: "open" });
  const said = (make: () => void) => {
    w.advance(10 * SAME_STEP_MS);
    make();
    return describe(w.steps()[0]);
  };
  assert.equal(said(() => w.v.tick(n.id, true)), "Ticked “Buy seeds”");
  assert.equal(said(() => w.v.tick(n.id, false)), "Unticked “Buy seeds”");
  assert.equal(said(() => w.v.update(n.id, { flag: "attention" })), "Marked “Buy seeds” as needing attention");
  assert.equal(said(() => w.v.update(n.id, { flag: "critical" })), "Marked “Buy seeds” as critical");
  assert.equal(said(() => w.v.update(n.id, { flag: "ok" })), "Marked “Buy seeds” as OK");
  assert.equal(said(() => w.v.update(n.id, { flag: null })), "Cleared the mark on “Buy seeds”");
  assert.equal(said(() => w.v.update(n.id, { body: "Peas" })), "Edited the notes of “Buy seeds”");
  assert.equal(said(() => w.v.update(n.id, { title: "Buy peas" })), "Renamed “Buy seeds” to “Buy peas”");
  assert.equal(said(() => w.v.update(n.id, { task: null })), "Made “Buy peas” an ordinary node");
  assert.equal(said(() => w.v.update(n.id, { task: "open" })), "Made “Buy peas” a task");
  assert.equal(said(() => w.v.update(n.id, { due: "2026-12-01" })), "Changed “Buy peas”");
  const other = w.v.addChild(w.v.rootId, { title: "Other" });
  assert.equal(said(() => w.v.move(n.id, other.id, 0)), "Moved “Buy peas”");
  assert.equal(said(() => w.v.delete(n.id)), "Deleted “Buy peas”");
  assert.equal(said(() => w.v.restore(n.id)), "Restored “Buy peas”");
  assert.equal(said(() => w.v.addChild(other.id, { title: "x".repeat(60) })), `Added “${"x".repeat(39)}…”`);
});

test("steps of several nodes are counted", () => {
  const w = world();
  w.at(1_000_000);
  w.v.transact(() => {
    w.v.addChild(w.v.rootId, { title: "One" });
    w.v.addChild(w.v.rootId, { title: "Two" });
    w.v.addChild(w.v.rootId, { title: "Three" });
  });
  assert.equal(describe(w.steps()[0]), "Added 3 nodes");
  const [one] = w.v.children(w.v.rootId);
  w.advance(10 * SAME_STEP_MS);
  w.v.transact(() => {
    w.v.update(one.id, { priority: 1 });
    w.v.delete(w.v.children(w.v.rootId)[1].id);
  });
  assert.equal(describe(w.steps()[0]), "Changed 2 nodes");
});

test("a step is taken back, as a step of its own that ⌘Z undoes", () => {
  const w = world();
  w.at(1_000_000);
  const n = w.v.addChild(w.v.rootId, { title: "Plan", body: "Old notes" });
  w.advance(10 * SAME_STEP_MS);
  w.v.as("agent", () => w.v.update(n.id, { body: "New notes by an agent" }));
  const step = w.steps()[0];
  assert.equal(step.source, "agent");
  assert.deepEqual(reversible(w.v, step).clean.length, 1);

  assert.deepEqual(revertStep(w.v, step), { reverted: 1, left: 0 });
  assert.equal(w.v.get(n.id)!.body, "Old notes");
  w.v.undo();
  assert.equal(w.v.get(n.id)!.body, "New notes by an agent", "the revert was one step to undo");
});

test("taking back the making of a node marks it deleted and keeps it", () => {
  const w = world();
  w.at(1_000_000);
  const made = w.v.as("agent", () => w.v.addChild(w.v.rootId, { title: "Spam" }));
  const step = w.steps()[0];
  assert.deepEqual(revertStep(w.v, step), { reverted: 1, left: 0 });
  assert.equal(w.v.isLive(made.id), false);
  assert.ok(w.v.get(made.id)!.deletedAt !== null, "still in the vault, in the trash");
  assert.equal(w.v.trash().some((t) => t.node.id === made.id), true);
});

test("what changed since is left alone", () => {
  const w = world();
  w.at(1_000_000);
  const a = w.v.addChild(w.v.rootId, { title: "A" });
  const b = w.v.addChild(w.v.rootId, { title: "B" });
  w.advance(10 * SAME_STEP_MS);
  w.v.as("agent", () => {
    w.v.update(a.id, { title: "A by agent" });
    w.v.update(b.id, { title: "B by agent" });
  });
  const step = w.steps()[0];
  w.v.update(b.id, { title: "B by me" });

  assert.equal(reversible(w.v, step).clean.length, 1);
  assert.deepEqual(revertStep(w.v, step), { reverted: 1, left: 1 });
  assert.equal(w.v.get(a.id)!.title, "A");
  assert.equal(w.v.get(b.id)!.title, "B by me");
  assert.deepEqual(revertStep(w.v, step), { reverted: 0, left: 2 }, "and a second time there is nothing to do");
});

test("a move is taken back to where it was, unless that place is gone or would make a loop", () => {
  const w = world();
  w.at(1_000_000);
  const a = w.v.addChild(w.v.rootId, { title: "A" });
  const b = w.v.addChild(a.id, { title: "B" });
  const c = w.v.addChild(w.v.rootId, { title: "C" });

  w.advance(10 * SAME_STEP_MS);
  w.v.move(b.id, c.id, 0);
  assert.deepEqual(revertStep(w.v, w.steps()[0]), { reverted: 1, left: 0 });
  assert.equal(w.v.get(b.id)!.parentId, a.id, "back under A");

  // B leaves A for the top; then A goes under B. Back under A would be a loop.
  w.advance(10 * SAME_STEP_MS);
  w.v.move(b.id, w.v.rootId, 0);
  const step = w.steps()[0];
  w.v.move(a.id, b.id, 0);
  assert.deepEqual(revertStep(w.v, step), { reverted: 0, left: 1 });
  assert.equal(w.v.get(b.id)!.parentId, w.v.rootId);

  // Or A is gone for good.
  w.v.move(a.id, w.v.rootId, 0);
  w.advance(10 * SAME_STEP_MS);
  w.v.move(b.id, a.id, 0);
  const into = w.steps()[0];
  w.v.move(b.id, w.v.rootId, 0);
  w.v.move(b.id, a.id, 0);
  w.v.move(b.id, c.id, 0);
  w.v.delete(a.id);
  w.v.emptyTrash();
  assert.deepEqual(revertStep(w.v, into), { reverted: 0, left: 1 });
});

test("sameState ignores when, and nothing else", () => {
  const w = world();
  const n = w.v.addChild(w.v.rootId, { title: "N", links: [] });
  assert.equal(sameState(n, { ...n, updatedAt: 5 }), true);
  assert.equal(sameState(n, { ...n, title: "M" }), false);
  assert.equal(sameState(n, { ...n, flag: "ok" }), false);
  assert.equal(sameState({ ...n, links: ["a"] }, { ...n, links: ["a"] }), true);
  assert.equal(sameState({ ...n, links: ["a"] }, { ...n, links: ["b"] }), false);
});

// ---- The vault side ----------------------------------------------------------

test("what is done for someone else is not a step for ⌘Z, and the listeners are told who", () => {
  const origins: string[] = [];
  const v = new Vault([], { onChange: (_changes, origin) => origins.push(origin) });
  v.forgetUndo();
  origins.length = 0;

  const mine = v.addChild(v.rootId, { title: "Mine" });
  const theirs = v.as("agent", () => v.addChild(v.rootId, { title: "Theirs" }));
  assert.deepEqual(origins, ["user", "agent"]);

  v.undo();
  assert.equal(v.isLive(mine.id), false, "undo takes back my step");
  assert.equal(v.isLive(theirs.id), true, "and leaves theirs");
  assert.equal(v.canUndo, false);

  v.as("agent", () => v.update(theirs.id, { title: "Renamed" }));
  assert.equal(v.canUndo, false);
  v.update(theirs.id, { title: "Mine again" });
  assert.deepEqual(origins.at(-1), "user", "and the hand goes back to the person afterwards");
});

test("a node's mark is a field like any other", () => {
  const v = new Vault([]);
  const n = v.addChild(v.rootId, { title: "N" });
  assert.equal(n.flag, null);
  v.update(n.id, { flag: "critical" });
  assert.equal(v.get(n.id)!.flag, "critical");
  v.undo();
  assert.equal(v.get(n.id)!.flag, null);
});

test("nodes saved before the mark, or when it was a yes or no, come back with the right one", () => {
  const v = new Vault([]);
  const base = { ...v.get(v.rootId)! } as Record<string, unknown>;
  delete base.flag;
  assert.equal(new Vault([base as never]).get(v.rootId)!.flag, null);
  assert.equal(new Vault([{ ...base, attention: true } as never]).get(v.rootId)!.flag, "attention");
  assert.equal(new Vault([{ ...base, attention: false } as never]).get(v.rootId)!.flag, null);
});
