import { test } from "node:test";
import assert from "node:assert/strict";
import { openingOn, readSession } from "../src/ui/session.ts";

test("a session from before panes comes back as one pane", () => {
  const s = readSession({ map: "m", node: "n", view: "outline", notesOpen: true });
  assert.deepEqual(s.panes, [{ map: "m", node: "n", view: "outline" }]);
  assert.equal(s.active, 0);
  assert.equal(s.split, null);
  assert.equal(s.notesOpen, true);
});

test("nothing, or anything, stored comes back as one pane at the top", () => {
  for (const stored of [{}, null, "junk", 42, { panes: "no", active: "x", split: 3 }]) {
    const s = readSession(stored);
    assert.deepEqual(s.panes, [{ map: null, node: null, view: "map" }]);
    assert.equal(s.active, 0);
    assert.equal(s.split, null);
  }
});

test("two panes come back with their split and the active one", () => {
  const s = readSession({
    panes: [{ map: "a", node: "a1", view: "map" }, { map: "b", node: null, view: "outline" }],
    active: 1,
    split: { direction: "below", share: 0.3 },
  });
  assert.deepEqual(s.panes.map((p) => p.map), ["a", "b"]);
  assert.equal(s.panes[1].view, "outline");
  assert.equal(s.active, 1);
  assert.deepEqual(s.split, { direction: "below", share: 0.3 });
});

test("a divider out of bounds comes back in the middle", () => {
  const s = readSession({ panes: [{ map: "a" }, { map: "b" }], split: { direction: "beside", share: 0.99 } });
  assert.deepEqual(s.split, { direction: "beside", share: 0.5 });
});

test("two panes with no sensible split come back as the active one alone", () => {
  const s = readSession({ panes: [{ map: "a" }, { map: "b" }], active: 1, split: { direction: "sideways" } });
  assert.deepEqual(s.panes.map((p) => p.map), ["b"]);
  assert.equal(s.active, 0);
  assert.equal(s.split, null);
});

test("one pane never keeps a split, nor an active pane it does not have", () => {
  const s = readSession({ panes: [{ map: "a" }], active: 3, split: { direction: "beside", share: 0.5 } });
  assert.equal(s.panes.length, 1);
  assert.equal(s.active, 0);
  assert.equal(s.split, null);
});

test("opening on a map leaves one pane on it, the rest as it was", () => {
  const before = readSession({ panes: [{ map: "a" }, { map: "b" }], active: 1, split: { direction: "beside", share: 0.5 }, sidebarOpen: true });
  const s = openingOn(before, "tour", true);
  assert.deepEqual(s.panes, [{ map: "tour", node: "tour", view: "map" }]);
  assert.equal(s.active, 0);
  assert.equal(s.split, null);
  assert.equal(s.notesOpen, true);
  assert.equal(s.sidebarOpen, true);
});
