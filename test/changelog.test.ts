import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changesHtml, dateRelease, newer, notes, releases, waiting } from "../scripts/changelog.mjs";

const TEXT = `# What's new

Intro.

## Not released yet

- **New thing.** It does
  this, with \`code\`.

## 0.2.0 — 21 October 2026

The second.

- One <b>
- [Two](https://example.com) and [not](javascript:alert(1))

## 0.1.0 — 20 October 2026

- First
`;

test("releases are read newest first, without what is not released yet", () => {
  assert.deepEqual(
    releases(TEXT).map((r) => [r.version, r.date]),
    [
      ["0.2.0", "21 October 2026"],
      ["0.1.0", "20 October 2026"],
    ],
  );
});

test("a release takes what was not released yet, under its version and date, once", () => {
  const dated = dateRelease(TEXT, "0.3.0", "23 October 2026");
  assert.match(dated, /## Not released yet\n\n## 0\.3\.0 — 23 October 2026\n\n- \*\*New thing\.\*\*/);
  assert.deepEqual(releases(dated)[0].version, "0.3.0");
  assert.equal(dateRelease(dated, "0.3.0", "24 October 2026"), dated, "a second run changes nothing");
  assert.ok(waiting(TEXT) && !waiting(dated), "the check before a release sees what waits");
  assert.throws(() => dateRelease(dated, "0.4.0", "25 October 2026"), /nothing under "## Not released yet"/);
});

test("a version's notes are its section, with a link to the page", () => {
  assert.equal(notes(TEXT, "0.1.0"), "- First\n\n[Everything that changed in each version](https://brock.clysuva.com/changes.html)");
  assert.match(notes(dateRelease(TEXT, "0.3.0", "23 October 2026"), "0.3.0"), /^- \*\*New thing\.\*\* It does this, with `code`\.\n/, "an item carried on is one line");
  assert.throws(() => notes(TEXT, "9.9.9"), /no "## 9\.9\.9"/);
});

test("the page has each release, its lists and paragraphs, and no HTML from the text", () => {
  const html = changesHtml(TEXT);
  assert.ok(!html.includes("New thing"), "not released yet is left out");
  assert.match(html, /<section id="v0\.2\.0">\n<h2><a href="#v0\.2\.0">0\.2\.0<\/a> <span class="date">21 October 2026<\/span><\/h2>\n<p>The second\.<\/p>\n<ul>\n<li>One &lt;b&gt;<\/li>/);
  assert.match(html, /<a href="https:\/\/example\.com">Two<\/a> and \[not\]\(javascript:alert\(1\)\)/);
  const dated = changesHtml(dateRelease(TEXT, "0.3.0", "23 October 2026"));
  assert.ok(!changesHtml(TEXT, "0.1.0").includes("v0.2.0"), "a version newer than the downloads waits");
  assert.ok(newer("0.10.0", "0.9.1") && !newer("0.4.0", "0.4.0") && !newer("0.3.1", "0.4.0"));
  assert.match(dated, /<li><strong>New thing\.<\/strong> It does this, with <code>code<\/code>\.<\/li>/, "lines carried on join the item");
});

test("CHANGELOG.md reads: every release dated, versions in order, the newest the app's", () => {
  const text = readFileSync("CHANGELOG.md", "utf8");
  const list = releases(text);
  assert.ok(list.length > 0);
  for (const r of list) assert.match(r.date, /^\d{1,2} [A-Z][a-z]+ \d{4}$/, `${r.version} has a date`);
  for (let i = 1; i < list.length; i++) assert.ok(newer(list[i - 1].version, list[i].version), `${list[i - 1].version} comes after ${list[i].version}`);
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(list[0].version, version, "package.json's version is the newest in CHANGELOG.md");
});
