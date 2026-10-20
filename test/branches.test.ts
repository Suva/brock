import { test } from "node:test";
import assert from "node:assert/strict";
import { branchBeside, branchColour, newBranch, PALETTE } from "../src/core/branches.ts";
import { Vault } from "../src/core/vault.ts";

test("new branches take the side with fewer and the colour used least", () => {
  const vault = new Vault([]);
  const add = () => vault.addChild(vault.rootId, newBranch(vault.children(vault.rootId)));
  const [a, b, c] = [add(), add(), add()];
  assert.deepEqual([a.side, b.side, c.side], ["right", "left", "right"]);
  assert.deepEqual([a.color, b.color, c.color], PALETTE.slice(0, 3));
  vault.delete(b.id);
  assert.equal(add().color, PALETTE[1], "a colour freed is used again");
});

test("a branch beside another goes on its side", () => {
  const vault = new Vault([]);
  vault.addChild(vault.rootId, { side: "right" });
  const left = vault.addChild(vault.rootId, { side: "left" });
  assert.equal(branchBeside(vault.children(vault.rootId), left).side, "left");
});

test("branches without a colour of their own go by their place", () => {
  const vault = new Vault([]);
  vault.addChild(vault.rootId);
  vault.addChild(vault.rootId, { color: "#123456" });
  const branches = vault.children(vault.rootId);
  assert.equal(branchColour(branches, 0), PALETTE[0]);
  assert.equal(branchColour(branches, 1), "#123456");
});
