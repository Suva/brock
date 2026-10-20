import { test } from "node:test";
import assert from "node:assert/strict";
import { fold, search } from "../src/core/search.ts";
import { Vault } from "../src/core/vault.ts";

function vault() {
  let time = 1000;
  const v = new Vault([], { now: () => time++ });
  const work = v.addChild(v.rootId, { title: "Work" });
  const project = v.addChild(work.id, { title: "Project Garden" });
  v.setMap(project.id, true);
  const plants = v.addChild(project.id, { title: "Plants", body: "Tomatoes along the south wall, basil in pots." });
  const cafe = v.addChild(v.rootId, { title: "Café menu" });
  const garden = v.addChild(v.rootId, { title: "Garden" });
  const gone = v.addChild(v.rootId, { title: "Old garden notes" });
  v.delete(gone.id);
  return { v, work, project, plants, cafe, garden };
}

const titles = (hits: { node: { title: string } }[]) => hits.map((h) => h.node.title);

test("every word must be found, in the title or the text", () => {
  const { v } = vault();
  assert.deepEqual(titles(search(v, "garden")), ["Garden", "Project Garden"]);
  assert.deepEqual(titles(search(v, "garden plants")), [], "no one node has both");
  assert.deepEqual(titles(search(v, "plants basil")), ["Plants"]);
  assert.deepEqual(titles(search(v, "zebra")), []);
});

test("case and accents do not matter", () => {
  const { v } = vault();
  assert.deepEqual(titles(search(v, "CAFE")), ["Café menu"]);
  assert.equal(fold("Ünïcödé"), "unicode");
});

test("an exact title comes first, then titles starting with it, then words inside", () => {
  const { v } = vault();
  v.addChild(v.rootId, { title: "Gardening tools" });
  v.addChild(v.rootId, { title: "Wintergarden" });
  assert.deepEqual(titles(search(v, "garden")), ["Garden", "Gardening tools", "Project Garden", "Wintergarden"]);
});

test("titles count for more than text", () => {
  const { v } = vault();
  v.addChild(v.rootId, { title: "Tomatoes" });
  assert.deepEqual(titles(search(v, "tomatoes")), ["Tomatoes", "Plants"]);
});

test("hits know their path, where the title matched, and a piece of the text", () => {
  const { v, plants } = vault();
  const [hit] = search(v, "basil");
  assert.equal(hit.node.id, plants.id);
  assert.deepEqual(hit.path.map((n) => n.title), ["Home", "Work", "Project Garden"]);
  assert.match(hit.snippet!, /basil/);
  assert.match(hit.snippet!, /^…\S*\s|^[^…]/, "a snippet starts at a word");
  assert.deepEqual(search(v, "den gar")[0].marks, [[0, 6]], "overlapping marks join");
});

test("deleted nodes are not found", () => {
  const { v } = vault();
  assert.ok(!titles(search(v, "old")).includes("Old garden notes"));
});

test("searching inside a map, and for maps only", () => {
  const { v, project } = vault();
  assert.deepEqual(titles(search(v, "garden", { kind: "within", mapId: project.id })), ["Project Garden"]);
  assert.deepEqual(titles(search(v, "", { kind: "maps" })).sort(), ["Home", "Project Garden"]);
  const centre = search(v, "", { kind: "within", mapId: project.id }).find((h) => h.node.id === project.id)!;
  assert.deepEqual(centre.path.map((n) => n.title), ["Home", "Work"], "paths start at the top of the vault");
});

test("with nothing typed, the most recently changed come first", () => {
  const { v, plants } = vault();
  v.update(plants.id, { title: "Plants and seeds" });
  assert.equal(search(v, "")[0].node.id, plants.id);
});

test("a large vault is searched quickly", () => {
  const v = new Vault([]);
  v.transact(() => {
    for (let b = 0; b < 100; b++) {
      const branch = v.addChild(v.rootId, { title: `Branch ${b}` });
      for (let i = 0; i < 1000; i++) v.addChild(branch.id, { title: `Idea ${b}-${i}`, body: "Some longer text about it." });
    }
  });
  search(v, "idea"); // folds every node once
  const start = performance.now();
  const hits = search(v, "idea 42-7");
  const ms = performance.now() - start;
  assert.equal(hits[0].node.title, "Idea 42-7");
  assert.ok(ms < 150, `${ms.toFixed(0)} ms for 100,000 nodes`);
});
