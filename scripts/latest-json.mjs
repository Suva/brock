// Run by the release workflow: writes latest.json, which installed copies of
// the app read to learn of a new version (`plugins.updater` in
// tauri.conf.json). It names, for each system, the file the updater installs
// and that file's signature, made at build time with the release's private
// key; the app checks it against the public key it was built with.
//
//   node scripts/latest-json.mjs <folder of release files> <tag> <owner/repo> [notes file]
//
// The latest.json is written into the folder, beside the files.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [folder, tag, repo, notesFile] = process.argv.slice(2);
if (!folder || !tag || !repo) {
  console.error("usage: node scripts/latest-json.mjs <folder> <tag> <owner/repo> [notes file]");
  process.exit(1);
}

// The files the updater can install, by their endings. The Mac app is one
// for both kinds of Mac. On Linux the updater looks for the way the app was
// installed first (`linux-x86_64-deb`), then for the system alone, so a copy
// installed from the .deb gets a .deb and not the AppImage.
const kinds = [
  { ending: ".app.tar.gz", platforms: ["darwin-aarch64", "darwin-x86_64"] },
  { ending: "-setup.exe", platforms: ["windows-x86_64"] },
  { ending: ".AppImage", platforms: ["linux-x86_64", "linux-x86_64-appimage"] },
  { ending: ".deb", platforms: ["linux-x86_64-deb"] },
];

const files = readdirSync(folder);
const platforms = {};
for (const { ending, platforms: names } of kinds) {
  const file = files.find((f) => f.endsWith(ending));
  if (!file) throw new Error(`No ${ending} in ${folder}`);
  if (!files.includes(`${file}.sig`)) throw new Error(`${file} has no signature: is TAURI_SIGNING_PRIVATE_KEY set?`);
  const entry = {
    signature: readFileSync(join(folder, `${file}.sig`), "utf8").trim(),
    url: `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(file)}`,
  };
  for (const name of names) platforms[name] = entry;
}

const latest = {
  version: tag.replace(/^v/, ""),
  notes: notesFile ? readFileSync(notesFile, "utf8").trim() : "",
  pub_date: new Date().toISOString(),
  platforms,
};
writeFileSync(join(folder, "latest.json"), JSON.stringify(latest, null, 2) + "\n");
console.log(`latest.json for ${latest.version}: ${Object.keys(platforms).join(", ")}`);
