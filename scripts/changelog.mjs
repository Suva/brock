// CHANGELOG.md: the changes in each release that someone using Brock would
// notice, written for them. The website's "What's new" page is made from it
// (`changesHtml`, by build-site.mjs), each release's notes on GitHub are its
// section (`notes`), and the app's update offer links to the page.
//
//   node scripts/changelog.mjs check            run by `npm version` first:
//                                               stops it, before anything
//                                               changes, if nothing is
//                                               waiting to be released
//   node scripts/changelog.mjs release          run by `npm version`: "Not
//                                               released yet" becomes the
//                                               new version, dated today
//   node scripts/changelog.mjs notes <version>  that version's notes, for its
//                                               release on GitHub
//
// The Markdown it knows is what the file uses: "## <version> — <date>"
// headings, "- " list items carried on by indented lines, paragraphs,
// **bold**, `code` and [text](https://…) links.

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const UNRELEASED = "Not released yet";
export const PAGE = "https://brock.clysuva.com/changes.html";

/** The sections of the file under its "## " headings, in order: { title, body }. */
function sections(text) {
  return text
    .split(/^## /m)
    .slice(1)
    .map((s) => {
      const end = s.indexOf("\n");
      return { title: (end < 0 ? s : s.slice(0, end)).trim(), body: end < 0 ? "" : s.slice(end + 1).trim() };
    });
}

/** The released versions, newest first: { version, date, body }. */
export function releases(text) {
  return sections(text)
    .filter((s) => s.title !== UNRELEASED)
    .map((s) => {
      const [version, date = ""] = s.title.split(" — ");
      return { version: version.trim(), date: date.trim(), body: s.body };
    });
}

/** Whether anything is written under "Not released yet". */
export function waiting(text) {
  return Boolean(sections(text).find((s) => s.title === UNRELEASED)?.body);
}

/**
 * The text with "Not released yet" turned into `version`, dated `date`.
 * Nothing changes if that version is there already, so running it twice does
 * no harm; it throws if nothing is waiting to be released.
 */
export function dateRelease(text, version, date) {
  if (releases(text).some((r) => r.version === version)) return text;
  if (!waiting(text)) throw new Error(`CHANGELOG.md has nothing under "## ${UNRELEASED}". Write down what this release changes first.`);
  // A fresh, empty section for what comes next, above the release.
  return text.replace(`## ${UNRELEASED}\n`, `## ${UNRELEASED}\n\n## ${version} — ${date}\n`);
}

/** A version's notes, for its release on GitHub and the update offer of copies from before the page. */
export function notes(text, version) {
  const release = releases(text).find((r) => r.version === version);
  if (!release) throw new Error(`CHANGELOG.md has no "## ${version}".`);
  // Each item on one line: 0.4.0's update offer shows the notes as plain text.
  const body = release.body.replace(/\n[ \t]+/g, " ");
  return `${body}\n\n[Everything that changed in each version](${PAGE})`;
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** **bold**, `code` and [text](https://…) in a line, as HTML; everything else as text. */
function inline(text) {
  const code = [];
  // Code first, kept aside, so nothing inside it is read as more Markdown.
  const kept = escape(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(c) - 1}\u0000`);
  return kept
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${code[Number(i)]}</code>`);
}

/** One release's body as HTML: lists of "- " items, carried on by indented lines, and paragraphs. */
function blocksHtml(body) {
  const blocks = [];
  let last = null;
  for (const line of body.split("\n")) {
    if (!line.trim()) last = null;
    else if (line.startsWith("- ")) blocks.push((last = { kind: "li", text: line.slice(2).trim() }));
    else if (last) last.text += ` ${line.trim()}`;
    else blocks.push((last = { kind: "p", text: line.trim() }));
  }
  let html = "";
  blocks.forEach((b, i) => {
    if (b.kind === "li" && blocks[i - 1]?.kind !== "li") html += "<ul>\n";
    html += `<${b.kind}>${inline(b.text)}</${b.kind}>\n`;
    if (b.kind === "li" && blocks[i + 1]?.kind !== "li") html += "</ul>\n";
  });
  return html;
}

/** Whether version `a` (as 0.4.1) comes after `b`. */
export function newer(a, b) {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

/**
 * The released versions as HTML for the "What's new" page, up to `upTo`, the
 * version whose installers the site links to: a release made but still being
 * built waits, as its downloads do. Changes not released yet are left out.
 */
export function changesHtml(text, upTo) {
  return releases(text)
    .filter((r) => !upTo || !newer(r.version, upTo))
    .map((r) => {
      const id = `v${escape(r.version)}`;
      const date = r.date ? ` <span class="date">${escape(r.date)}</span>` : "";
      return `<section id="${id}">\n<h2><a href="#${id}">${escape(r.version)}</a>${date}</h2>\n${blocksHtml(r.body)}</section>`;
    })
    .join("\n");
}

// Run as a script rather than imported by a test or the site's build.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const [command, version] = process.argv.slice(2);
  const text = readFileSync("CHANGELOG.md", "utf8");
  try {
    if (command === "check") {
      if (!waiting(text)) throw new Error(`CHANGELOG.md has nothing under "## ${UNRELEASED}". Write down what this release changes first.`);
    } else if (command === "release") {
      const { version } = JSON.parse(readFileSync("package.json", "utf8"));
      const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      const dated = dateRelease(text, version, date);
      if (dated === text) {
        console.log(`CHANGELOG.md already has ${version}.`);
      } else {
        writeFileSync("CHANGELOG.md", dated);
        execFileSync("git", ["add", "CHANGELOG.md"]);
        console.log(`CHANGELOG.md: what was not released yet is now ${version}, ${date}.`);
      }
    } else if (command === "notes" && version) {
      process.stdout.write(`${notes(text, version.replace(/^v/, ""))}\n`);
    } else {
      console.error("usage: node scripts/changelog.mjs check | release | notes <version>");
      process.exit(2);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
