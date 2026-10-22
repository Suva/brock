import { test } from "node:test";
import assert from "node:assert/strict";
import { findByTitle, fold, search } from "../src/core/search.ts";
import { Usage } from "../src/core/usage.ts";
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

test("the first letters of a title's words find it, before letters inside a word", () => {
  const { v } = vault();
  v.addChild(v.rootId, { title: "Product plan" });
  v.addChild(v.rootId, { title: "The big product plan" });
  v.addChild(v.rootId, { title: "Apps", body: "Shopping lists" });
  const pp = search(v, "pp");
  assert.deepEqual(titles(pp), ["Product plan", "The big product plan", "Apps"], "all the words, then some of them, then inside a word");
  assert.deepEqual(pp[0].marks, [[0, 1], [8, 9]], "the letters found are marked");
  assert.deepEqual(titles(search(v, "bpp")), ["The big product plan"]);
  assert.deepEqual(titles(search(v, "pz")), [], "letters in a row only");
  assert.deepEqual(titles(search(v, "pg plants")), [], "every word must still be found");
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
  const garden = search(v, "den gar").find((h) => h.node.title === "Garden")!;
  assert.deepEqual(garden.marks, [[0, 6]], "overlapping marks join");
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

test("among matches alike, maps come before other nodes, and nodes near the top before deep ones", () => {
  const { v, work } = vault();
  const deep = v.addChild(work.id, { title: "Deep" });
  const notes = v.addChild(deep.id, { title: "Notes" });
  const map = v.addChild(v.rootId, { title: "Notes" });
  v.setMap(map.id, true);
  const shallow = v.addChild(v.rootId, { title: "Notes" });
  assert.deepEqual(search(v, "notes").map((h) => h.node.id), [map.id, shallow.id, notes.id]);
});

test("nodes in the open map, then in the maps just under it, come first among equals", () => {
  const { v, project } = vault();
  const elsewhere = v.addChild(v.rootId, { title: "Seeds" });
  const sub = v.addChild(project.id, { title: "Beds" });
  v.setMap(sub.id, true);
  const under = v.addChild(sub.id, { title: "Seeds" });
  const inside = v.addChild(project.id, { title: "Seeds" });
  const ids = (here: string) => search(v, "seeds", { kind: "all" }, { here }).map((h) => h.node.id);
  assert.deepEqual(ids(project.id), [inside.id, under.id, elsewhere.id]);
  assert.equal(ids(v.rootId)[0], elsewhere.id);
});

test("the words still decide first: a map matched in its text comes after a title", () => {
  const { v } = vault();
  const map = v.addChild(v.rootId, { title: "Holidays", body: "Remember the passports." });
  v.setMap(map.id, true);
  v.addChild(v.rootId, { title: "Passports" });
  assert.deepEqual(titles(search(v, "passports")), ["Passports", "Holidays"]);
});

test("a node chosen for a query comes first the next time, and for queries it starts", () => {
  const { v } = vault();
  let time = 0;
  const usage = new Usage(undefined, () => time);
  const plot = v.addChild(v.rootId, { title: "Garden plot" });
  const ranked = (q: string) => titles(search(v, q, { kind: "all" }, { boost: usage.boostFor(q) }));
  assert.equal(ranked("garden")[0], "Garden");
  usage.pick("garden", plot.id);
  usage.pick("Garden ", plot.id);
  assert.equal(ranked("garden")[0], "Garden plot", "chosen twice, it passes the exact title");
  assert.equal(ranked("gard")[0], "Garden plot", "a shorter query takes it too");
  time += 365 * 24 * 60 * 60 * 1000;
  assert.equal(ranked("garden")[0], "Garden", "a year later the choice has faded");
});

test("with nothing typed, the nodes gone to lately come first", () => {
  const { v, cafe, plants } = vault();
  const usage = new Usage();
  usage.visit(cafe.id);
  v.update(plants.id, { title: "Plants and seeds" });
  const hits = search(v, "", { kind: "all" }, { boost: usage.boostFor("") });
  assert.deepEqual([hits[0].node.id, hits[1].node.id], [cafe.id, plants.id]);
});

test("usage read back from storage keeps what makes sense, and stays small", () => {
  const usage = new Usage({ visits: { a: { count: 2, last: 5 }, b: "nonsense" }, picks: { x: { a: { count: 1 } } } });
  assert.deepEqual(usage.toJSON(), { visits: { a: { count: 2, last: 5 } }, picks: {} });
  assert.deepEqual(new Usage("garbage").toJSON(), { visits: {}, picks: {} });
  let time = 0;
  const many = new Usage(undefined, () => time++);
  for (let i = 0; i < 1000; i++) many.visit(`n${i}`);
  many.visit("n999");
  const kept = Object.keys(many.toJSON().visits);
  assert.equal(kept.length, 300);
  assert.ok(kept.includes("n999") && !kept.includes("n0"), "the oldest go first");
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

test("a [[Title]] means the node of that title, in the same map first", () => {
  const { v, project, garden } = vault();
  const inside = v.addChild(project.id, { title: "garden" });
  assert.equal(findByTitle(v, "Garden", v.rootId)?.id, garden.id, "nearest the top");
  assert.equal(findByTitle(v, "GARDEN", project.id)?.id, inside.id, "in the map the note is in");
  assert.equal(findByTitle(v, "Cafe menu", null)?.title, "Café menu");
  assert.equal(findByTitle(v, "Nowhere", null), null);
  assert.equal(findByTitle(v, "Old garden notes", null), null, "not deleted ones");
});
