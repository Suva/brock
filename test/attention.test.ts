import { test } from "node:test";
import assert from "node:assert/strict";
import { byUrgency, counts, flagged, flagName, nextFlag, rank, setFlag } from "../src/core/attention.ts";
import { Vault } from "../src/core/vault.ts";

function world() {
  const v = new Vault([]);
  const garden = v.addChild(v.rootId, { title: "Garden" });
  v.setMap(garden.id, true);
  const seeds = v.addChild(garden.id, { title: "Seeds" });
  const beds = v.addChild(garden.id, { title: "Beds" });
  const home = v.addChild(v.rootId, { title: "Chores" });
  return { v, garden, seeds, beds, home };
}

test("the nodes marked are listed in the order of the tree, each with its level and map", () => {
  const { v, garden, seeds, beds, home } = world();
  assert.deepEqual(flagged(v), []);
  v.update(home.id, { flag: "ok" });
  v.update(beds.id, { flag: "critical" });
  v.update(garden.id, { flag: "attention" });
  assert.deepEqual(
    flagged(v).map((f) => [f.node.title, f.flag, f.mapId]),
    [
      ["Garden", "attention", v.rootId],
      ["Beds", "critical", garden.id],
      ["Chores", "ok", v.rootId],
    ],
  );
  assert.equal(v.get(seeds.id)!.flag, null);
});

test("deleted nodes, and what is under them, are not listed until they come back", () => {
  const { v, garden, beds } = world();
  v.update(beds.id, { flag: "attention" });
  v.delete(garden.id);
  assert.deepEqual(flagged(v), []);
  v.restore(garden.id);
  assert.equal(flagged(v).length, 1);
});

test("the most urgent come first, the rest in the order of the tree, and green ones are counted apart", () => {
  const { v, garden, seeds, beds, home } = world();
  v.update(garden.id, { flag: "ok" });
  v.update(seeds.id, { flag: "attention" });
  v.update(beds.id, { flag: "critical" });
  v.update(home.id, { flag: "attention" });
  const list = flagged(v);
  assert.deepEqual(byUrgency(list).map((f) => f.node.title), ["Beds", "Seeds", "Chores", "Garden"]);
  assert.deepEqual(counts(list), { critical: 1, attention: 2, ok: 1, asking: 3 });
  assert.deepEqual(counts([]), { critical: 0, attention: 0, ok: 0, asking: 0 });
});

test("setting marks is one step, and null clears them", () => {
  const { v, seeds, beds } = world();
  setFlag(v, [seeds.id, beds.id], "critical");
  assert.deepEqual(flagged(v).map((f) => f.flag), ["critical", "critical"]);
  setFlag(v, [seeds.id, beds.id], null);
  assert.deepEqual(flagged(v), []);
  v.undo();
  assert.equal(flagged(v).length, 2, "the clearing was one step");
});

test("a key press goes round the marks, and they are ranked and named", () => {
  assert.deepEqual([null, "attention", "critical", "ok"].map((f) => nextFlag(f as never)), ["attention", "critical", "ok", null]);
  assert.deepEqual([null, "ok", "attention", "critical"].map((f) => rank(f as never)), [0, 1, 2, 3]);
  assert.deepEqual((["ok", "attention", "critical"] as const).map(flagName), ["OK", "needs attention", "critical"]);
});
