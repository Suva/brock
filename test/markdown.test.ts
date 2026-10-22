import { test } from "node:test";
import assert from "node:assert/strict";
import { inline, nodeLink, parse, setChecked } from "../src/core/markdown.ts";

test("blocks: headings, paragraphs, lists, quotes, code and rules", () => {
  const blocks = parse(
    ["# Plan", "", "First line", "goes on.", "", "- one", "- two", "1. first", "> quoted", "```", "**not bold**", "```", "---"].join(
      "\n",
    ),
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ["heading", "paragraph", "list", "list", "quote", "code", "rule"],
  );
  assert.deepEqual(blocks[1], { kind: "paragraph", children: [{ kind: "text", text: "First line goes on." }] });
  const [bullets, numbers] = [blocks[2], blocks[3]];
  assert.ok(bullets.kind === "list" && !bullets.ordered && bullets.items.length === 2);
  assert.ok(numbers.kind === "list" && numbers.ordered);
  assert.deepEqual(blocks[5], { kind: "code", text: "**not bold**" }, "nothing is read inside code");
});

test("checkboxes know their line, and can be ticked", () => {
  const text = "Packing\n- [ ] passport\n- [x] tickets";
  const [, list] = parse(text);
  assert.ok(list.kind === "list");
  assert.deepEqual(
    list.items.map((i) => [i.checked, i.line]),
    [
      [false, 1],
      [true, 2],
    ],
  );
  assert.equal(setChecked(text, 1, true), "Packing\n- [x] passport\n- [x] tickets");
  assert.equal(setChecked(text, 2, false), "Packing\n- [ ] passport\n- [ ] tickets");
});

test("inside a line: bold, italic, code", () => {
  assert.deepEqual(inline("a **b *c* d** `e*f*` g"), [
    { kind: "text", text: "a " },
    {
      kind: "strong",
      children: [
        { kind: "text", text: "b " },
        { kind: "em", children: [{ kind: "text", text: "c" }] },
        { kind: "text", text: " d" },
      ],
    },
    { kind: "text", text: " " },
    { kind: "code", text: "e*f*" },
    { kind: "text", text: " g" },
  ]);
  assert.deepEqual(inline("*a `b*` c*").filter((s) => s.kind === "code"), [{ kind: "code", text: "b*" }], "code wins over what is around it");
  assert.deepEqual(inline("snake_case_name stays"), [{ kind: "text", text: "snake_case_name stays" }]);
});

test("links: web addresses, nodes by id, nodes by title", () => {
  const spans = inline("See [the docs](https://example.com/a), [[Project X]], [it](node:01ABC) and https://x.org/y.");
  const links = spans.filter((s) => s.kind === "link");
  assert.deepEqual(
    links.map((l) => l.kind === "link" && l.to),
    [
      { kind: "web", url: "https://example.com/a" },
      { kind: "title", title: "Project X" },
      { kind: "node", id: "01ABC" },
      { kind: "web", url: "https://x.org/y" },
    ],
  );
  assert.deepEqual(spans.at(-1), { kind: "text", text: "." }, "the full stop after an address is the sentence's");
});

test("other kinds of link are left as text", () => {
  assert.deepEqual(inline("[click](javascript:alert(1))"), [{ kind: "text", text: "[click](javascript:alert(1))" }]);
  assert.deepEqual(inline("[file](file:///etc/passwd)"), [{ kind: "text", text: "[file](file:///etc/passwd)" }]);
});

test("a node link is written so it reads back", () => {
  const written = nodeLink("Trip [draft]", "01XYZ");
  assert.equal(written, "[Trip draft](node:01XYZ)");
  const [link] = inline(written);
  assert.deepEqual(link.kind === "link" && link.to, { kind: "node", id: "01XYZ" });
});

test("tables: header, alignment, ragged rows, and a paragraph before one", () => {
  const blocks = parse("Intro\n| a | b |\n|:--|--:|\n| 1 | **2** |\n| 3 |");
  assert.equal(blocks[0].kind, "paragraph");
  const t = blocks[1];
  assert.equal(t.kind, "table");
  if (t.kind !== "table") return;
  assert.deepEqual(t.align, ["left", "right"]);
  assert.equal(t.head.length, 2);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1].length, 2);
  assert.equal(t.rows[0][1][0].kind, "strong");
});

test("a line with a bar but no dashes under it is not a table", () => {
  assert.equal(parse("a | b\nc | d")[0].kind, "paragraph");
});
