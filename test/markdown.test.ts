import { test } from "node:test";
import assert from "node:assert/strict";
import { bareLinks, fileLink, filePath, inline, nodeLink, parse } from "../src/core/markdown.ts";

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

test("checkboxes know their line", () => {
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
});

test("files and folders: file: addresses, written out or in a link, spaces in <>", () => {
  const spans = inline("Designs at file:///Users/me/Acme/Designs%202026, the [brief](<file:///Users/me/Acme/The brief.pdf>) and [x](file:///C:/Work/a.txt).");
  const links = spans.filter((s) => s.kind === "link");
  assert.deepEqual(
    links.map((l) => l.kind === "link" && l.to),
    [
      { kind: "file", url: "file:///Users/me/Acme/Designs%202026" },
      { kind: "file", url: "file:///Users/me/Acme/The brief.pdf" },
      { kind: "file", url: "file:///C:/Work/a.txt" },
    ],
  );
  assert.deepEqual(links[0].kind === "link" && links[0].children, [{ kind: "text", text: "/Users/me/Acme/Designs 2026" }], "shown as its path");
  assert.deepEqual(spans.at(-1), { kind: "text", text: "." });
  assert.equal(filePath("file:///C:/Work/a%20b.txt"), "C:/Work/a b.txt");
  assert.equal(filePath("file://localhost/tmp/100%"), "/tmp/100%", "a stray % is kept");
  assert.deepEqual(inline("[web](<https://example.com/a b>)").filter((s) => s.kind === "link").length, 1, "<> works for any link");
  assert.deepEqual(inline("file:// alone"), [{ kind: "text", text: "file:// alone" }]);
});

test("brock: links open the window's panels, and only those named", () => {
  const links = inline("[tasks](brock:tasks), [all](BROCK:Maps) and [x](brock:quit)");
  assert.deepEqual(
    links.filter((s) => s.kind === "link").map((l) => l.kind === "link" && l.to),
    [
      { kind: "command", command: "tasks" },
      { kind: "command", command: "maps" },
    ],
  );
  assert.deepEqual(links.at(-1), { kind: "text", text: " and [x](brock:quit)" }, "an unknown one stays text");
  assert.equal(inline("[x](brock:toString)")[0].kind, "text", "nothing inherited counts as a command");
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

test("a dropped file's link names it and reads back to its path", () => {
  assert.equal(fileLink("/Users/me/The brief (v2).pdf"), "[The brief (v2).pdf](file:///Users/me/The%20brief%20%28v2%29.pdf)");
  assert.equal(fileLink("/Users/me/Designs/"), "[Designs](file:///Users/me/Designs)");
  assert.equal(fileLink("C:\\Work\\Ödön [old].txt"), "[Ödön old.txt](file:///C:/Work/%C3%96d%C3%B6n%20%5Bold%5D.txt)");
  for (const path of ["/Users/me/The brief (v2).pdf", "/tmp/100% #1?.txt"]) {
    const [link] = inline(fileLink(path));
    assert.ok(link.kind === "link" && link.to.kind === "file");
    assert.equal(filePath(link.to.url), path);
  }
});

test("bare links are found where they are, outside code and outside [text](target)", () => {
  const text = "See [[Plan B]], https://a.org/x. and `https://no.pe` or [y](https://link.ed) and file:///tmp/a%20b";
  assert.deepEqual(
    bareLinks(text).map((f) => [text.slice(f.from, f.to), f.target]),
    [
      ["[[Plan B]]", { kind: "title", title: "Plan B" }],
      ["https://a.org/x", { kind: "web", url: "https://a.org/x" }],
      ["file:///tmp/a%20b", { kind: "file", url: "file:///tmp/a%20b" }],
    ],
  );
});
