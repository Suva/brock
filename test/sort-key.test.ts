import { test } from "node:test";
import assert from "node:assert/strict";
import { keyBetween, keysBetween } from "../src/core/sort-key.ts";

test("a key falls between its neighbours", () => {
  const first = keyBetween(null, null);
  const after = keyBetween(first, null);
  const before = keyBetween(null, first);
  const middle = keyBetween(before, first);
  assert.ok(before < middle && middle < first && first < after);
});

test("keys stay in order when always added at the same place", () => {
  for (const where of ["start", "end", "middle"] as const) {
    const keys = [keyBetween(null, null), keyBetween(keyBetween(null, null), null)];
    for (let i = 0; i < 2000; i++) {
      if (where === "start") keys.unshift(keyBetween(null, keys[0]));
      else if (where === "end") keys.push(keyBetween(keys.at(-1)!, null));
      else keys.splice(1, 0, keyBetween(keys[0], keys[1]));
    }
    const sorted = [...keys].sort();
    assert.deepEqual(keys, sorted, where);
    assert.equal(new Set(keys).size, keys.length, where);
  }
});

test("keys added at either end stay short", () => {
  let last = keyBetween(null, null);
  let first = last;
  for (let i = 0; i < 100000; i++) {
    last = keyBetween(last, null);
    first = keyBetween(null, first);
  }
  assert.ok(last.length <= 4, last);
  assert.ok(first.length <= 4, first);
});

test("several keys at once are in order and between the limits", () => {
  const keys = keysBetween("a1", "a2", 50);
  assert.equal(keys.length, 50);
  assert.deepEqual(keys, [...keys].sort());
  assert.ok(keys[0] > "a1" && keys.at(-1)! < "a2");
  assert.deepEqual(keysBetween(null, null, 3), [...keysBetween(null, null, 3)].sort());
});

test("keys in the wrong order or invalid are refused", () => {
  assert.throws(() => keyBetween("a2", "a1"));
  assert.throws(() => keyBetween("a1", "a1"));
  assert.throws(() => keyBetween("a10", null), "a fraction ending in 0");
  assert.throws(() => keyBetween("a!", null), "a character that is not a digit");
  assert.throws(() => keyBetween("b1", null), "an integer part too short");
  assert.throws(() => keyBetween("", null));
});
