import { test } from "node:test";
import assert from "node:assert/strict";
import { addTour, tour, TOUR_TITLE } from "../src/demo/tour.ts";
import { removeTour, showTour, tourMap, welcome } from "../src/ui/tour.ts";
import { groupDone, tasksUnder } from "../src/core/tasks.ts";
import { inline } from "../src/core/markdown.ts";
import { search } from "../src/core/search.ts";
import { Vault } from "../src/core/vault.ts";

test("the demo's tour is a vault the app opens as it is", () => {
  const now = new Date(2026, 9, 21, 15).getTime();
  const nodes = tour(now);
  const changes: unknown[] = [];
  const vault = new Vault(nodes, { onChange: (c) => changes.push(...c) });
  assert.equal(changes.length, 0, "nothing to repair");
  assert.equal(vault.get(vault.rootId)!.title, "Welcome to Brock");

  const maps = [...vault.children(vault.rootId)].find((n) => n.title === "Maps inside maps")!;
  assert.ok(maps.isMap);
  assert.ok(vault.children(maps.id).some((n) => n.isMap), "a map inside it, to go deeper");

  // Every link, on a node or in its notes, leads to a node of the tour.
  for (const node of nodes) {
    for (const id of node.links) assert.ok(vault.isLive(id), `${node.title} links to a node`);
    for (const [, id] of node.body.matchAll(/\(node:([^)]+)\)/g)) assert.ok(vault.isLive(id), `${node.title}'s notes`);
    for (const [raw] of node.body.matchAll(/\(brock:\w+\)/g)) {
      const to = inline(`[x]${raw}`)[0];
      assert.ok(to.kind === "link" && to.to.kind === "command", `${node.title}: ${raw} is a command`);
    }
  }

  const done = tasksUnder(vault, vault.rootId).done;
  assert.deepEqual(
    groupDone(done, now).map((g) => g.label),
    ["Today", "Yesterday", "Earlier"],
    "the Tasks tab shows its groups",
  );

  const hint = nodes.find((n) => n.title === "First letters find it")!;
  const [, letters, title] = hint.body.match(/\*\*(\w+)\*\* finds \*([^*]+)\*/)!;
  assert.equal(search(vault, letters)[0]?.node.title, title, "the first letters it names find that node");
  assert.ok(nodes.every((n) => !n.body.includes("Check for Updates")), "updates are the app's alone");
});

test("in the app the tour is one map under the top, added as one step", () => {
  const vault = new Vault([]);
  const mine = vault.addChild(vault.rootId, { title: "Mine" });
  const id = addTour(vault, vault.rootId);
  const map = vault.get(id)!;
  assert.ok(map.isMap);
  assert.equal(map.parentId, vault.rootId);
  assert.equal(map.title, TOUR_TITLE);
  assert.ok(map.side && map.color, "a branch of the top, with its side and colour");
  assert.equal(vault.get(vault.rootId)!.title, "Home", "the top is left as it was");

  const bodies = [...vault.children(id)].flatMap((n) => [n.body, ...vault.children(n.id).map((c) => c.body)]);
  assert.ok(bodies.every((b) => !b.includes("browser")), "worded for the app");
  assert.ok(bodies.some((b) => b.includes("Remove the Tour")), "says how to remove it");
  assert.ok(bodies.some((b) => b.includes("Check for Updates")), "says how it updates");

  vault.undo();
  assert.equal(vault.isLive(id), false, "one step");
  assert.deepEqual(vault.children(vault.rootId).map((n) => n.title), [mine.title]);
});

test("a new vault gets the tour on its first start, and never again", () => {
  const stored = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
  };
  const vault = new Vault([]);
  const id = welcome(vault)!;
  assert.ok(id && vault.isLive(id));
  assert.equal(vault.canUndo, false, "the first ⌘Z does not take it away");
  assert.equal(welcome(vault), null, "once");

  assert.equal(removeTour(vault), true);
  assert.equal(vault.isLive(id), false);
  assert.equal(removeTour(vault), false, "nothing left to remove");
  vault.undo();
  assert.equal(tourMap(vault), id, "back from the trash with ⌘Z");

  removeTour(vault);
  const fresh = showTour(vault);
  assert.notEqual(fresh, id, "a fresh one");
  assert.equal(showTour(vault), fresh, "showing it again goes to that one");

  stored.clear();
  const used = new Vault([]);
  used.addChild(used.rootId, { title: "Work" });
  assert.equal(welcome(used), null, "a vault with anything in it gets none");
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
