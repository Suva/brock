import { test } from "node:test";
import assert from "node:assert/strict";
import { copyOf, cut, paste } from "../src/core/clipboard.ts";
import { fromText } from "../src/core/exchange.ts";
import { Vault } from "../src/core/vault.ts";

function trip() {
  const vault = new Vault([]);
  const japan = vault.addChild(vault.rootId, { title: "Japan", side: "right" });
  const tokyo = vault.addChild(japan.id, { title: "Tokyo", body: "Two nights", icon: "🗼" });
  vault.addChild(tokyo.id, { title: "Shibuya" });
  vault.setMap(tokyo.id, true);
  const book = vault.addChild(japan.id, { title: "Book flights" });
  vault.toggleTask(book.id);
  const later = vault.addChild(vault.rootId, { title: "Later", side: "left" });
  const note = vault.addChild(later.id, { title: "See Tokyo" });
  vault.link(note.id, tokyo.id);
  vault.link(book.id, tokyo.id);
  return { vault, japan, tokyo, book, later, note };
}

const titles = (vault: Vault, id: string) => vault.children(id).map((n) => n.title);

test("a copy carries everything under it, maps inside included", () => {
  const { vault, japan, later } = trip();
  const clip = copyOf(vault, [japan.id]);
  const [pasted] = paste(vault, clip, later.id, vault.rootId);
  assert.notEqual(pasted.id, japan.id, "a copy is new nodes");
  assert.deepEqual(titles(vault, pasted.id), ["Tokyo", "Book flights"]);
  const [tokyo2, book2] = vault.children(pasted.id);
  assert.equal(tokyo2.isMap, true);
  assert.equal(tokyo2.icon, "🗼");
  assert.deepEqual(titles(vault, tokyo2.id), ["Shibuya"], "what is inside the map came too");
  assert.equal(book2.task, "open");
  assert.deepEqual(book2.links, [tokyo2.id], "links inside the copy point at the copy");
  vault.undo();
  assert.deepEqual(titles(vault, later.id), ["See Tokyo"], "pasting is one step");
});

test("links from a copy to nodes outside it are kept", () => {
  const { vault, tokyo, note, japan } = trip();
  const [copy] = paste(vault, copyOf(vault, [note.id]), japan.id, vault.rootId);
  assert.deepEqual(copy.links, [tokyo.id]);
});

test("cut and paste moves the same nodes, so links to them hold", () => {
  const { vault, japan, tokyo, later, note } = trip();
  const clip = cut(vault, [tokyo.id]);
  assert.equal(vault.isLive(tokyo.id), false, "cut is gone from its place");
  const [moved] = paste(vault, clip, later.id, vault.rootId);
  assert.equal(moved.id, tokyo.id, "the same node");
  assert.equal(vault.get(tokyo.id)!.parentId, later.id);
  assert.deepEqual(titles(vault, tokyo.id), ["Shibuya"]);
  assert.deepEqual(vault.get(note.id)!.links, [tokyo.id], "a link from elsewhere still leads to it");
  assert.deepEqual(titles(vault, japan.id), ["Book flights"]);
  vault.undo();
  vault.undo();
  assert.equal(vault.get(tokyo.id)!.parentId, japan.id, "undo puts it back where it was");
  assert.equal(vault.isLive(tokyo.id), true);
});

test("a cut pasted onto the centre becomes a branch; a second paste is a copy", () => {
  const { vault, book } = trip();
  const clip = cut(vault, [book.id]);
  const [first] = paste(vault, clip, vault.rootId, vault.rootId);
  assert.equal(first.id, book.id);
  assert.ok(vault.get(book.id)!.side && vault.get(book.id)!.color, "a side and a colour");
  const [second] = paste(vault, { ...clip, cut: null }, vault.rootId, vault.rootId);
  assert.notEqual(second.id, book.id);
});

test("a cut cannot be pasted into itself; it is copied there instead", () => {
  const { vault, japan, tokyo } = trip();
  const clip = cut(vault, [japan.id]);
  vault.restore(japan.id);
  const pasted = paste(vault, clip, tokyo.id, vault.rootId);
  assert.notEqual(pasted[0].id, japan.id);
});

test("text from other apps becomes outlines", () => {
  const md = fromText("- Plan\n  - [ ] Book flights\n    Compare prices\n  - [x] Pack\n- Tokyo\n");
  assert.deepEqual(
    md.map((o) => [o.title, o.children.map((c) => [c.title, c.task, c.body])]),
    [
      [
        "Plan",
        [
          ["Book flights", "open", "Compare prices"],
          ["Pack", "done", ""],
        ],
      ],
      ["Tokyo", []],
    ],
  );
  const indented = fromText("One\n\tTwo\n\t\tThree\nFour");
  assert.deepEqual(
    indented.map((o) => [o.title, o.children.map((c) => [c.title, c.children.map((g) => g.title)])]),
    [
      ["One", [["Two", ["Three"]]]],
      ["Four", []],
    ],
  );
  assert.deepEqual(fromText("Just one line").map((o) => o.title), ["Just one line"]);
  assert.deepEqual(fromText('<opml><body><outline text="From OPML"/></body></opml>').map((o) => o.title), ["From OPML"]);
});

test("what a copy puts on the clipboard for other apps reads back as the same tree", () => {
  const { vault, japan } = trip();
  const clip = copyOf(vault, [japan.id]);
  assert.equal(clip.text, "- Japan\n  - 🗼 Tokyo\n    Two nights\n    - Shibuya\n  - [ ] Book flights\n");
  const back = fromText(clip.text);
  assert.deepEqual(back[0].children.map((c) => c.title), ["🗼 Tokyo", "Book flights"]);
});
