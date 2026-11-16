import { test } from "node:test";
import assert from "node:assert/strict";
import { openingOn, readSession } from "../src/ui/session.ts";
import { one, split } from "../src/ui/tiling.ts";

test("a session from before panes comes back as one pane", () => {
  const s = readSession({ map: "m", node: "n", view: "outline", notesOpen: true });
  assert.deepEqual(s.panes, [{ map: "m", node: "n", view: "outline" }]);
  assert.equal(s.active, 0);
  assert.deepEqual(s.tiling, one);
  assert.equal(s.notesOpen, true);
});

test("nothing, or anything, stored comes back as one pane at the top", () => {
  for (const stored of [{}, null, "junk", 42, { panes: "no", active: "x", split: 3 }]) {
    const s = readSession(stored);
    assert.deepEqual(s.panes, [{ map: null, node: null, view: "map" }]);
    assert.equal(s.active, 0);
    assert.deepEqual(s.tiling, one);
  }
});

test("three panes come back with their tiling and the active one", () => {
  const tiling = split(split(one, 0, 1, "beside"), 1, 2, "below");
  const s = readSession({
    panes: [{ map: "a", node: "a1", view: "map" }, { map: "b", node: null, view: "outline" }, { map: "c" }],
    active: 2,
    tiling,
  });
  assert.deepEqual(s.panes.map((p) => p.map), ["a", "b", "c"]);
  assert.equal(s.panes[1].view, "outline");
  assert.equal(s.active, 2);
  assert.deepEqual(s.tiling, tiling);
});

test("two panes saved with one split, before a pane could be split again, come back as that split", () => {
  const s = readSession({ panes: [{ map: "a" }, { map: "b" }], active: 1, split: { direction: "below", share: 0.3 } });
  assert.deepEqual(s.tiling, { direction: "below", share: 0.3, first: { pane: 0 }, second: { pane: 1 } });
  assert.equal(s.active, 1);
  const odd = readSession({ panes: [{ map: "a" }, { map: "b" }], split: { direction: "beside", share: 0.99 } });
  assert.deepEqual(odd.tiling, { direction: "beside", share: 0.5, first: { pane: 0 }, second: { pane: 1 } }, "a divider out of bounds comes back in the middle");
});

test("panes with no sensible tiling come back as the active one alone", () => {
  const s = readSession({ panes: [{ map: "a" }, { map: "b" }, { map: "c" }], active: 1, tiling: { direction: "sideways" } });
  assert.deepEqual(s.panes.map((p) => p.map), ["b"]);
  assert.equal(s.active, 0);
  assert.deepEqual(s.tiling, one);
});

test("one pane never keeps a split, nor an active pane it does not have", () => {
  const s = readSession({ panes: [{ map: "a" }], active: 3, split: { direction: "beside", share: 0.5 } });
  assert.equal(s.panes.length, 1);
  assert.equal(s.active, 0);
  assert.deepEqual(s.tiling, one);
});

test("opening on a map leaves one pane on it, the rest as it was", () => {
  const before = readSession({ panes: [{ map: "a" }, { map: "b" }], active: 1, split: { direction: "beside", share: 0.5 }, sidebarOpen: true });
  const s = openingOn(before, "tour", true);
  assert.deepEqual(s.panes, [{ map: "tour", node: "tour", view: "map" }]);
  assert.equal(s.active, 0);
  assert.deepEqual(s.tiling, one);
  assert.equal(s.notesOpen, true);
  assert.equal(s.sidebarOpen, true);
});
