import { test } from "node:test";
import assert from "node:assert/strict";
import { Vault } from "../src/core/vault.ts";
import { MemoryStore } from "../src/store/memory-store.ts";
import { Saver } from "../src/store/saver.ts";

async function openVault(store: MemoryStore, saver: Saver) {
  return new Vault(await store.load(), { onChange: (c) => saver.push(c) });
}

test("edits are saved, and a vault opened again has them", async () => {
  const store = new MemoryStore();
  const saver = new Saver(store);
  const vault = await openVault(store, saver);
  const a = vault.addChild(vault.rootId, { title: "Ideas" });
  vault.addChild(a.id, { title: "One" });
  vault.setMap(a.id, true);
  vault.delete(vault.addChild(vault.rootId, { title: "Gone" }).id);
  await saver.flush();
  assert.equal(saver.status, "saved");

  const again = await openVault(store, new Saver(store));
  assert.equal(again.rootId, vault.rootId);
  assert.deepEqual(
    again.children(again.rootId).map((n) => n.title),
    ["Ideas"],
  );
  assert.equal(again.get(a.id)!.isMap, true);
  assert.deepEqual(again.children(a.id).map((n) => n.title), ["One"]);
});

test("each edit is written as a step of its own, in order", async () => {
  const store = new MemoryStore();
  const saver = new Saver(store);
  const vault = await openVault(store, saver);
  await saver.flush();
  store.saves = [];
  for (let i = 0; i < 5; i++) vault.addChild(vault.rootId, { title: String(i) });
  await saver.flush();
  assert.deepEqual(
    store.saves.map((s) => s.map((c) => c.after.title)),
    [["0"], ["1"], ["2"], ["3"], ["4"]],
  );
});

test("a failed write is tried again, in order, until it works", async () => {
  const store = new MemoryStore();
  const saver = new Saver(store, { retryMs: 5 });
  const vault = await openVault(store, saver);
  await saver.flush();

  store.failing = new Error("disk full");
  const statuses: string[] = [];
  saver.onStatus(() => statuses.push(saver.status));
  const a = vault.addChild(vault.rootId, { title: "a" });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(saver.status, "failed");
  assert.equal(saver.error, "disk full");
  vault.update(a.id, { title: "b" });

  store.failing = null;
  await saver.flush();
  assert.equal(saver.status, "saved");
  assert.equal(saver.error, null);
  assert.deepEqual(statuses, ["saving", "failed", "saving", "saved"]);
  const saved = (await store.load()).find((n) => n.id === a.id)!;
  assert.equal(saved.title, "b");
});

test("removing for good takes its turn after the changes before it", async () => {
  const store = new MemoryStore();
  const saver = new Saver(store);
  const vault = new Vault(await store.load(), { onChange: (c) => saver.push(c), onPurge: (ids) => saver.purge(ids) });
  const a = vault.addChild(vault.rootId, { title: "a" });
  vault.delete(a.id);
  vault.emptyTrash();
  await saver.flush();
  assert.equal((await store.load()).some((n) => n.id === a.id), false);
});

test("the store is told whose each edit was", async () => {
  const store = new MemoryStore();
  const saver = new Saver(store);
  const vault = new Vault(await store.load(), { onChange: (c, origin) => saver.push(c, origin) });
  await saver.flush();
  store.saves = [];
  store.origins = [];
  vault.addChild(vault.rootId, { title: "mine 1" });
  vault.as("agent", () => vault.addChild(vault.rootId, { title: "agent 1" }));
  vault.as("agent", () => vault.addChild(vault.rootId, { title: "agent 2" }));
  vault.addChild(vault.rootId, { title: "mine 2" });
  await saver.flush();
  assert.deepEqual(store.origins, ["user", "agent", "agent", "user"]);
  const log = await store.history(10);
  assert.deepEqual(log.slice(0, 2).map((e) => [e.after.title, e.source]), [["mine 2", "user"], ["agent 2", "agent"]], "and the history has it");
});
