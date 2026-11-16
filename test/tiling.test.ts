import { test } from "node:test";
import assert from "node:assert/strict";
import { close, dividers, one, order, readTiling, setShare, split, tiles, type Tiling } from "../src/ui/tiling.ts";

const round = (n: number) => Math.round(n * 1000) / 1000;
const where = (t: Tiling) => tiles(t).map((r) => [r.pane, round(r.x), round(r.y), round(r.width), round(r.height)]);

test("one pane has the whole room", () => {
  assert.deepEqual(where(one), [[0, 0, 0, 1, 1]]);
  assert.deepEqual(dividers(one), []);
});

test("splitting a half again divides only that half", () => {
  // Side by side, then the right one above and below.
  const t = split(split(one, 0, 1, "beside"), 1, 2, "below");
  assert.deepEqual(where(t), [
    [0, 0, 0, 0.5, 1],
    [1, 0.5, 0, 0.5, 0.5],
    [2, 0.5, 0.5, 0.5, 0.5],
  ]);
  assert.deepEqual(order(t), [0, 1, 2], "left to right, top to bottom");
  const lines = dividers(t);
  assert.deepEqual(lines.map((d) => [d.path, d.direction]), [["", "beside"], ["s", "below"]]);
  assert.deepEqual(lines[1].at, { x: 0.5, y: 0.5, width: 0.5, height: 0 }, "the second line runs across the right half only");
});

test("closing a pane gives its room to the other side of its split, and the panes after it move up", () => {
  const t = split(split(one, 0, 1, "beside"), 1, 2, "below");
  const without1 = close(t, 1)!;
  assert.deepEqual(where(without1), [
    [0, 0, 0, 0.5, 1],
    [1, 0.5, 0, 0.5, 1],
  ], "pane 2 takes the right half, and is the second pane now");
  const without0 = close(t, 0)!;
  assert.deepEqual(order(without0), [0, 1]);
  assert.deepEqual(where(without0)[0], [0, 0, 0, 1, 0.5], "the right half's split takes the whole room");
  assert.equal(close(one, 0), null, "the last pane cannot go");
});

test("a divider's share stays within bounds", () => {
  const t = split(split(one, 0, 1, "beside"), 1, 2, "below");
  const moved = setShare(t, "s", 0.95);
  assert.equal(round(where(moved)[1][4] as number), 0.8, "the right half's top pane: at most 0.8 of the half's height");
  assert.equal(round(where(setShare(t, "", 0.3))[0][3] as number), 0.3);
});

test("a stored tiling must name every pane once", () => {
  const t = split(split(one, 0, 1, "beside"), 1, 2, "below");
  assert.deepEqual(readTiling(JSON.parse(JSON.stringify(t)), 3), t);
  assert.equal(readTiling(t, 2), null, "a pane it names that is not there");
  assert.equal(readTiling(t, 4), null, "a pane it leaves out");
  assert.equal(readTiling({ direction: "beside", share: 0.5, first: { pane: 0 }, second: { pane: 0 } }, 2), null, "one pane twice");
  assert.equal(readTiling({ direction: "sideways", first: { pane: 0 }, second: { pane: 1 } }, 2), null);
  assert.equal(readTiling("junk", 1), null);
  const odd = readTiling({ direction: "beside", share: 3, first: { pane: 0 }, second: { pane: 1 } }, 2);
  assert.deepEqual(odd, { direction: "beside", share: 0.5, first: { pane: 0 }, second: { pane: 1 } });
});
