import { test } from "node:test";
import assert from "node:assert/strict";
import { mapTree, type MapEntry } from "../src/core/overview.ts";
import { Vault } from "../src/core/vault.ts";

const shape = (e: MapEntry): unknown => ({ [e.node.title]: e.size, maps: e.maps.map(shape) });

test("maps form a tree, each under the map it is drawn in", () => {
  let time = 1;
  const vault = new Vault([], { now: () => time++ });
  const work = vault.addChild(vault.rootId, { title: "Work" });
  const project = vault.addChild(work.id, { title: "Project" });
  vault.addChild(project.id, { title: "Task" });
  const research = vault.addChild(project.id, { title: "Research" });
  vault.addChild(research.id, { title: "Paper" });
  vault.addChild(vault.rootId, { title: "Home life" });
  vault.setMap(project.id, true);
  vault.setMap(research.id, true);
  const gone = vault.addChild(vault.rootId, { title: "Gone" });
  vault.setMap(gone.id, true);
  vault.delete(gone.id);

  const tree = mapTree(vault);
  assert.deepEqual(shape(tree), {
    Home: 3, // Work, Project, Home life
    maps: [{ Project: 2, maps: [{ Research: 1, maps: [] }] }],
  });

  const before = tree.maps[0].changedAt;
  vault.update(vault.children(research.id)[0].id, { title: "Paper 2" });
  const after = mapTree(vault);
  assert.equal(after.maps[0].changedAt, before, "a change inside a map inside does not count for the outer one");
  assert.ok(after.maps[0].maps[0].changedAt > before);
});
