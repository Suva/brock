import { test } from "node:test";
import assert from "node:assert/strict";
import { fromOPML, importInto, readOutlines, toJSON, toMarkdown, toOPML } from "../src/core/exchange.ts";
import { Vault } from "../src/core/vault.ts";

function sample() {
  const vault = new Vault([]);
  vault.update(vault.rootId, { title: "Trip", body: "Two weeks in **May**." });
  const tokyo = vault.addChild(vault.rootId, { title: "Tokyo", icon: "🗼", color: "#e8590c" });
  const shibuya = vault.addChild(tokyo.id, { title: "Shibuya & Harajuku", body: "Crossing\n\nTakeshita Street" });
  const kyoto = vault.addChild(vault.rootId, { title: 'Kyoto "old"' });
  vault.setMap(kyoto.id, true);
  vault.addChild(kyoto.id, { title: "Temples" });
  vault.link(shibuya.id, kyoto.id);
  vault.toggleTask(shibuya.id);
  vault.tick(shibuya.id);
  vault.delete(vault.addChild(vault.rootId, { title: "Gone" }).id);
  return { vault, tokyo, shibuya, kyoto };
}

test("Markdown is a nested list with notes under their items", () => {
  const { vault } = sample();
  assert.equal(
    toMarkdown(vault, vault.rootId),
    [
      "# Trip",
      "",
      "Two weeks in **May**.",
      "",
      "- 🗼 Tokyo",
      "  - [x] Shibuya & Harajuku",
      "    Crossing",
      "",
      "    Takeshita Street",
      '- Kyoto "old"',
      "  - Temples",
      "",
    ].join("\n"),
  );
});

test("OPML escapes what it must and reads back the same outline", () => {
  const { vault } = sample();
  const opml = toOPML(vault, vault.rootId);
  assert.match(opml, /text="Shibuya &amp; Harajuku" _note="Crossing&#10;&#10;Takeshita Street"/);
  assert.match(opml, /text="Kyoto &quot;old&quot;"/);
  assert.doesNotMatch(opml, /Gone/, "deleted nodes stay out");
  const [root] = fromOPML(opml);
  assert.equal(root.title, "Trip");
  assert.deepEqual(
    root.children.map((c) => c.title),
    ["🗼 Tokyo", 'Kyoto "old"'],
  );
  assert.equal(root.children[0].children[0].body, "Crossing\n\nTakeshita Street");
});

test("OPML from other apps: notes, single quotes, comments, entities", () => {
  const outlines = fromOPML(`<?xml version="1.0"?>
    <!-- made elsewhere -->
    <opml version="1.0"><head><title>x</title><outline text="not in the body"/></head>
    <body>
      <outline text='First &#x1F600;' note="a note">
        <outline text="Inner"/>
      </outline>
      <outline title="Second"></outline>
    </body></opml>`);
  assert.deepEqual(
    outlines.map((o) => [o.title, o.body, o.children.length]),
    [
      ["First 😀", "a note", 1],
      ["Second", "", 0],
    ],
  );
  assert.throws(() => readOutlines("hello"), /not an OPML/);
  assert.throws(() => fromOPML("<html><body></body></html>"), /not an OPML/);
});

test("JSON comes back in whole: maps, icons, colours and links", () => {
  const { vault } = sample();
  const json = toJSON(vault, vault.rootId, 0);
  const other = new Vault([]);
  const [trip] = importInto(other, other.rootId, readOutlines(json), other.rootId);
  assert.equal(trip.title, "Trip");
  const [tokyo, kyoto] = other.children(trip.id);
  assert.equal(tokyo.icon, "🗼");
  assert.equal(tokyo.color, "#e8590c");
  assert.equal(kyoto.isMap, true);
  const shibuya = other.children(tokyo.id)[0];
  assert.deepEqual(shibuya.links, [kyoto.id], "links point at the new nodes");
  assert.equal(shibuya.task, "done", "and tasks come back done or not");
  other.undo();
  assert.deepEqual(other.children(other.rootId), [], "bringing it in is one step");
});

test("a file not from here, or from a newer version, is refused with a reason", () => {
  assert.throws(() => readOutlines('{"format":"other"}'), /not exported from this app/);
  assert.throws(() => readOutlines('{"format":"mindmap","version":99,"root":{}}'), /newer version/);
  assert.throws(() => readOutlines("{nope"), /not valid JSON/);
});

test("brought in under the centre, outlines become branches with sides and colours", () => {
  const vault = new Vault([]);
  const made = importInto(vault, vault.rootId, fromOPML('<opml><body><outline text="a"/><outline text="b"/></body></opml>'), vault.rootId);
  assert.deepEqual(
    made.map((n) => n.side),
    ["right", "left"],
  );
  assert.ok(made.every((n) => n.color));
});
